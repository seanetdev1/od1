const { planParties, mapParty, flagsToList, TYPE_FLAGS } = require('../../functions/partyMigrationPlan');

const party = (Id, PartyName, extra = {}) => ({
  Id, PartyName, PartyCode: `P${Id}`, CurrencyCode: 'USD', ...extra,
});

describe('mapParty', () => {
  it('uses the legacy party code, not a counter', () => {
    // The old import wrote `code: i` from the array index, so codes meant
    // nothing and changed whenever the import re-ran.
    expect(mapParty(party(7, 'ACME')).code).toBe('P7');
  });

  it('stores the currency code, not the currency id', () => {
    // The old import put CurrencyId into a STRING column, so every client
    // ended up with "3" where "USD" belonged.
    expect(mapParty(party(1, 'A', { CurrencyCode: 'AED' })).currency).toBe('AED');
    expect(mapParty(party(1, 'A', { CurrencyCode: null })).currency).toBe('PKR');
  });

  it('leaves a missing registration date null instead of inventing today', () => {
    expect(mapParty(party(1, 'A')).registerDate).toBeNull();
    expect(mapParty(party(1, 'A', { DateOfRegistration: '2019-04-01' })).registerDate)
      .toBeInstanceOf(Date);
  });

  it('marks a blacklisted party inactive rather than dropping it', () => {
    // Historical jobs still reference them.
    expect(mapParty(party(1, 'A')).active).toBe(true);
    expect(mapParty(party(1, 'A', { IsBlackList: true })).active).toBe(false);
  });

  it('resolves the sales rep through the employee map', () => {
    const employees = new Map([['55', 'uuid-emp-55']]);
    expect(mapParty(party(1, 'A', { SalesPersonId: 55 }), employees).salesRepresentatorId)
      .toBe('uuid-emp-55');
    // Unknown legacy id must be null, not the raw legacy number - the column
    // is a FK to Employees.
    expect(mapParty(party(1, 'A', { SalesPersonId: 999 }), employees).salesRepresentatorId)
      .toBeNull();
  });

  it('tidies the name', () => {
    expect(mapParty(party(1, '  ACME   LOGISTICS ')).name).toBe('ACME LOGISTICS');
  });
});

describe('flagsToList', () => {
  it('joins set flags without a trailing comma', () => {
    // The old version produced "Shipper, Consignee, " - the trailing comma
    // shows up in the UI and breaks any exact match.
    expect(flagsToList({ IsShipper: true, IsConsignee: true }, TYPE_FLAGS))
      .toBe('Shipper, Consignee');
  });

  it('returns null when nothing is set', () => {
    expect(flagsToList({}, TYPE_FLAGS)).toBeNull();
  });
});

describe('planParties', () => {
  const ctx = (over = {}) => ({
    existingClimaxIds: [],
    accountIds: [500, 501],
    employeeByClimaxId: new Map(),
    ...over,
  });

  it('links a party to its ledger account when the account exists', () => {
    const plan = planParties([party(1, 'ACME', { AccountId: 500 })], ctx());
    expect(plan.stats.withLedgerAccount).toBe(1);
    expect(plan.associations).toEqual([{ climaxId: 1, ChildAccountId: 500 }]);
    expect(plan.toCreate[0].nongl).toBe('0');
  });

  it('reports a party with no account in the source as non-GL', () => {
    const plan = planParties([party(1, 'NOTIFY ONLY')], ctx());
    expect(plan.problems.noLedgerAccount).toEqual([
      { id: 1, name: 'NOTIFY ONLY', partyType: 'unknown', reason: 'no account in source' },
    ]);
    expect(plan.toCreate[0].nongl).toBe('1');
    expect(plan.associations).toHaveLength(0);
  });

  it('reports a party whose account is missing from the chart', () => {
    // This is the silent failure being replaced: the old import created the
    // client as non-GL with no association and said nothing, so it could
    // never be invoiced and nobody knew until someone tried.
    const plan = planParties([party(1, 'ACME', { AccountId: 999 })], ctx());
    expect(plan.problems.unresolvedAccount).toEqual([
      { id: 1, name: 'ACME', accountId: 999 },
    ]);
    expect(plan.problems.noLedgerAccount[0].reason).toBe('account not in chart');
    expect(plan.associations).toHaveLength(0);
  });

  it('skips parties already imported', () => {
    const plan = planParties(
      [party(1, 'A', { AccountId: 500 }), party(2, 'B', { AccountId: 501 })],
      ctx({ existingClimaxIds: [1] })
    );
    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.toCreate.map((c) => c.climaxId)).toEqual([2]);
  });

  it('takes the first of a duplicated legacy id and reports the rest', () => {
    const plan = planParties([party(1, 'FIRST'), party(1, 'SECOND')], ctx());
    expect(plan.problems.duplicateClimaxIds).toEqual([1]);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].name).toBe('FIRST');
  });

  it('refuses a party with no name rather than storing a blank one', () => {
    const plan = planParties([party(1, '   '), party(2, 'REAL')], ctx());
    expect(plan.problems.missingName).toEqual([1]);
    expect(plan.toCreate.map((c) => c.name)).toEqual(['REAL']);
  });

  it('counts rows with no id instead of throwing on them', () => {
    const plan = planParties([{ PartyName: 'NO ID' }, party(2, 'FINE')], ctx());
    expect(plan.problems.missingId).toBe(1);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('summarises what will happen', () => {
    const plan = planParties([
      party(1, 'WITH', { AccountId: 500 }),
      party(2, 'WITHOUT'),
      party(3, 'DONE', { AccountId: 501 }),
    ], ctx({ existingClimaxIds: [3] }));

    expect(plan.stats).toEqual({
      source: 3,
      toCreate: 2,
      alreadyImported: 1,
      withLedgerAccount: 1,
      withoutLedgerAccount: 1,
      // These fixtures carry no PartyTypeId, so they all land under 'unknown':
      // 2 of 3 have an account, so it reads as a ledger type.
      byPartyType: { unknown: { total: 3, withAccount: 2, ledgerType: true } },
    });
  });

  describe('multiple email addresses', () => {
    const info = (Email) => mapParty({ Id: 1, PartyName: 'X', Email }).infoMail;

    it('normalises a dash separator to the comma form the app splits on', () => {
      // Odyssey splits party emails on [;,] (routes/invoice email suggestions),
      // so a dash-separated pair arrives as ONE unusable string. Three of
      // CargoLinkers' parties are stored this way.
      expect(info('naizmh@live.com-naizmh@fsd.comsats.net.pk'))
        .toBe('naizmh@live.com, naizmh@fsd.comsats.net.pk');
      expect(info('khalid.khan@lml.com- abdul.razzak@lml.com'))
        .toBe('khalid.khan@lml.com, abdul.razzak@lml.com');
    });

    it('does not split a hyphen that belongs inside an address', () => {
      // The reason addresses are EXTRACTED rather than the separator replaced.
      expect(info('abdul-razzak@my-company.com')).toBe('abdul-razzak@my-company.com');
      expect(info('info@sea-net.com.pk')).toBe('info@sea-net.com.pk');
    });

    it('leaves already-valid separators alone and tidies the spacing', () => {
      expect(info('a@b.com, c@d.com')).toBe('a@b.com, c@d.com');
      expect(info('a@b.com;c@d.com')).toBe('a@b.com, c@d.com');
      expect(info('a@b.com,     c@d.com,    e@f.com')).toBe('a@b.com, c@d.com, e@f.com');
    });

    it('de-duplicates case-insensitively, keeping the first spelling', () => {
      expect(info('a@b.com, A@B.COM')).toBe('a@b.com');
    });

    it('keeps text that is not an address rather than emptying the field', () => {
      // Losing it would be worse than carrying it: somebody wrote it down.
      expect(info('no email on file')).toBe('no email on file');
      expect(info('')).toBeNull();
      expect(info(null)).toBeNull();
    });
  });

  it('takes the NTN from EINNo, not NTNName', () => {
    // NTNName is empty on every one of CargoLinkers' 12,918 parties; EINNo
    // holds 1,008 real NTNs. Reading NTNName dropped every tax number, and an
    // NTN has to print on the invoice.
    expect(mapParty({ Id: 1, PartyName: 'X', EINNo: '1925643-4' }).ntn).toBe('1925643-4');
    // Empty string is not a value.
    expect(mapParty({ Id: 1, PartyName: 'X', EINNo: '', NTNName: '' }).ntn).toBeNull();
    // A source that does populate NTNName still works.
    expect(mapParty({ Id: 1, PartyName: 'X', NTNName: '7654321-0' }).ntn).toBe('7654321-0');
  });

  it('deactivates a party the source had switched off', () => {
    // IsInActive was not read before, so 92 parties CargoLinkers had turned
    // off imported as live and selectable. IsBlackList is set on none of them.
    expect(mapParty({ Id: 1, PartyName: 'X' }).active).toBe(true);
    expect(mapParty({ Id: 1, PartyName: 'X', IsInActive: true }).active).toBe(false);
    expect(mapParty({ Id: 1, PartyName: 'X', IsBlackList: true }).active).toBe(false);
  });

  it('separates expected non-GL parties from ones that should have an account', () => {
    // Type 4 is operational - shippers and notify parties, never invoiced -
    // and type 1 is a customer. Both appear in noLedgerAccount; only the
    // customer is worth acting on. Derived from the batch, not hardcoded.
    const rows = [
      party(1, 'CUSTOMER A', { AccountId: 500, PartyTypeId: 1 }),
      party(2, 'CUSTOMER B', { AccountId: 501, PartyTypeId: 1 }),
      party(3, 'CUSTOMER C NO ACCOUNT', { PartyTypeId: 1 }),
      party(4, 'NOTIFY ONE', { PartyTypeId: 4 }),
      party(5, 'NOTIFY TWO', { PartyTypeId: 4 }),
    ];
    const plan = planParties(rows, ctx({ accountIds: [500, 501] }));

    expect(plan.problems.noLedgerAccount).toHaveLength(3);
    expect(plan.problems.ledgerTypeWithoutAccount).toEqual([
      { id: 3, name: 'CUSTOMER C NO ACCOUNT', partyType: '1' },
    ]);
    expect(plan.stats.byPartyType['1'].ledgerType).toBe(true);
    expect(plan.stats.byPartyType['4'].ledgerType).toBe(false);
  });

  it('does not throw on an empty source', () => {
    expect(planParties([], ctx()).stats.source).toBe(0);
    expect(planParties(undefined, ctx()).canApply).toBe(true);
  });
});

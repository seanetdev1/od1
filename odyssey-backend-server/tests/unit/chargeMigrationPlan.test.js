const {
  planCharges, mapCharge, toLegacyId, isMnemonic,
} = require('../../functions/chargeMigrationPlan');

const charge = (Id, ChargesName, extra = {}) => ({
  Id, ChargesName, ChargesCode: `C${Id}`, ShortName: `S${Id}`,
  GL_Currencies: { CurrencyCode: 'USD' }, ...extra,
});

describe('mapCharge', () => {
  it('puts the legacy id in code, as an integer', () => {
    // Charges.code is an INTEGER column and /charges/create issues new codes
    // with max(code)+1, which is lexicographic on text ("9" > "100"). A string
    // code here would start handing out duplicates to hand-created charges.
    const m = mapCharge(charge('42', 'DOC FEE', { ChargesCode: 'DOCF' }));
    expect(m.code).toBe(42);
    expect(typeof m.code).toBe('number');
    expect(m.climaxId).toBe(42);
  });

  it('leaves code null when the legacy id is not a whole number', () => {
    // Rather than coerce NaN into a NOT NULL integer column. planCharges
    // rejects these rows outright.
    expect(mapCharge(charge('abc', 'X')).code).toBeNull();
    expect(mapCharge(charge(null, 'X')).code).toBeNull();
  });

  it('survives a charge with no currency', () => {
    // The old import read x.GL_Currencies.CurrencyCode unguarded, so one bad
    // row threw the entire charge master.
    expect(() => mapCharge(charge(1, 'X', { GL_Currencies: null }))).not.toThrow();
    expect(mapCharge(charge(1, 'X', { GL_Currencies: null })).currency).toBe('PKR');
  });

  it('marks a retired charge inactive rather than dropping it, as a boolean', () => {
    // status is a BOOLEAN column. Historical charge lines still reference
    // retired charges, but they should not appear in a picker as current.
    expect(mapCharge(charge(1, 'X')).status).toBe(true);
    expect(mapCharge(charge(1, 'X', { IsInActive: true })).status).toBe(false);
  });

  it('carries the reimbursable flag across', () => {
    // Gen_Charges.IsReimbursment marks a PASS-THROUGH charge - duty, taxes,
    // port and terminal charges the agent pays for the client and recharges at
    // cost. Dropping it (which the first version of this mapping did) posts
    // recharged duty into a revenue account, and on a goods declaration the
    // duty dwarfs the agency fee.
    expect(mapCharge(charge(1, 'CUSTOM DUTY', { IsReimbursment: true })).reimbursable).toBe(true);
    expect(mapCharge(charge(1, 'AGENCY FEE')).reimbursable).toBe(false);
  });

  it('treats a missing or falsey reimbursable flag as revenue', () => {
    // Fails toward "this is our income", which is the safe direction: an
    // unflagged charge shows up on the P&L where somebody will notice it,
    // rather than quietly moving money onto the balance sheet.
    for (const v of [undefined, null, false, 0, '']) {
      expect(mapCharge(charge(1, 'X', { IsReimbursment: v })).reimbursable).toBe(false);
    }
  });

  it('maps the calculation type and tax flag', () => {
    expect(mapCharge(charge(1, 'X', { PerUnitFixedId: 1 })).calculationType).toBe('Per Unit');
    expect(mapCharge(charge(1, 'X', { PerUnitFixedId: 2 })).calculationType).toBe('Per Shipment');
    expect(mapCharge(charge(1, 'X', { IsTaxable: true })).taxApply).toBe('Yes');
    expect(mapCharge(charge(1, 'X')).taxApply).toBe('No');
  });

  it('does not invent a party type from an id it cannot decode', () => {
    // DefaultPayablePartyId points at a party-type lookup that is not in the
    // export and not in the legacy schema backup. Decoding 1 -> Client on a
    // hunch would stamp most of the charge master with a value that looks
    // migrated and is unverified.
    for (const id of [1, 2, 3, 99, null, undefined]) {
      const m = mapCharge(charge(1, 'X', { DefaultPayablePartyId: id }));
      expect(m.defaultPaybleParty).toBe('Local-Agent');
      expect(m.defaultRecivableParty).toBe('Client');
    }
  });

  it('takes a taxable charge\'s rate from its tax authority', () => {
    // SERVICES CHARGES on CargoLinkers: linked to SALES TAX SRB at 15, the rate
    // all 23,586 of its taxed lines were charged at. Hardcoded '0' left it
    // taxable at 0%, so new customs lines picked up no tax.
    expect(mapCharge(charge(380, 'SERVICES CHARGES', { IsTaxable: true, TaxPercentage: 15 })).taxPerc).toBe('15');
  });

  it('has no rate when the charge is not taxable, or no authority is linked', () => {
    expect(mapCharge(charge(1, 'X', { IsTaxable: false, TaxPercentage: 15 })).taxPerc).toBe('0');
    expect(mapCharge(charge(1, 'X', { IsTaxable: true })).taxPerc).toBe('0');
    expect(mapCharge(charge(1, 'X', { IsTaxable: true, TaxPercentage: null })).taxPerc).toBe('0');
  });

  it('reports no fixed amount, because the source has none', () => {
    expect(mapCharge(charge(1, 'X', { IsTaxable: true })).fixAmount).toBe(0);
  });

  it('never leaves short blank, since the column is NOT NULL', () => {
    expect(mapCharge(charge(1, 'LONG NAME', { ShortName: null, InvoicePrintingName: null })).short)
      .toBe('LONG NAME');
    expect(mapCharge(charge(1, 'X', { ShortName: null, InvoicePrintingName: 'PRINTED' })).short)
      .toBe('PRINTED');
  });
});

describe('toLegacyId / isMnemonic', () => {
  it('accepts whole numbers as strings, rejects anything else', () => {
    expect(toLegacyId('42')).toBe(42);
    expect(toLegacyId(42)).toBe(42);
    expect(toLegacyId('4.5')).toBeNull();
    expect(toLegacyId('')).toBeNull();
    expect(toLegacyId('abc')).toBeNull();
  });

  it('tells a mnemonic code from a restated sequence number', () => {
    // Legacy charges up to ~204 carry a mnemonic; everything after is a
    // stringified number, so the legacy system drifted to numeric codes too.
    expect(isMnemonic('OFT')).toBe(true);
    expect(isMnemonic('192')).toBe(false);
    expect(isMnemonic(null)).toBe(false);
    expect(isMnemonic('  ')).toBe(false);
  });
});

describe('planCharges', () => {
  const ctx = (over = {}) => ({ existingClimaxIds: [], existingCodes: [], ...over });

  it('skips charges already imported instead of duplicating them', () => {
    // Without climaxId the old import had no way to tell, so a second run
    // duplicated the whole charge master.
    const plan = planCharges([charge(1, 'A'), charge(2, 'B')], ctx({ existingClimaxIds: [1] }));
    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.toCreate.map((c) => c.climaxId)).toEqual([2]);
  });

  it('counts charges whose source party id could not be decoded', () => {
    // Reported so it can be revisited with the lookup table in hand, rather
    // than disappearing into a default that looks deliberate.
    const plan = planCharges([
      charge(1, 'A', { DefaultPayablePartyId: 1 }),
      charge(2, 'B', { DefaultPayablePartyId: 99 }),
      charge(3, 'C'),                                  // null - nothing to decode
    ], ctx());
    expect(plan.stats.undecodablePayableParty).toBe(2);
  });

  it('counts mnemonic codes that have no column to land in', () => {
    const plan = planCharges([
      charge(1, 'A', { ChargesCode: 'OFT' }),
      charge(2, 'B', { ChargesCode: '192' }),
      charge(3, 'C', { ChargesCode: null }),
    ], ctx());
    expect(plan.stats.mnemonicsDropped).toBe(1);
  });

  it('reports a legacy id that collides with an existing charge code', () => {
    // A charge created by hand can already hold a code a legacy id is about to
    // claim. /charges/edit then refuses to save either of the pair.
    const plan = planCharges([charge(7, 'A')], ctx({ existingCodes: [7] }));
    expect(plan.problems.codeCollisions).toEqual([7]);
    expect(plan.canApply).toBe(true);       // a nuisance, not a broken link
    expect(plan.toCreate).toHaveLength(1);
  });

  it('does not report a collision when the code is free', () => {
    const plan = planCharges([charge(7, 'A')], ctx({ existingCodes: [8, 9] }));
    expect(plan.problems.codeCollisions).toEqual([]);
  });

  it('adopts a charge the old importer left without a legacy id', () => {
    // The old importer wrote the legacy id into `code` and dropped climaxId,
    // because the column did not exist. On a system that already ran it those
    // charges look unimported, so a re-run would duplicate the whole catalogue
    // and collide on every single code.
    const plan = planCharges(
      [charge(1, 'A'), charge(2, 'B')],
      ctx({ existingCodes: [1], adoptableByCode: new Map([['1', 55]]) }),
    );
    expect(plan.toAdopt).toEqual([{ rowId: 55, climaxId: 1 }]);
    expect(plan.toCreate.map((c) => c.climaxId)).toEqual([2]);
    // Adopted, so it must not also be reported as a collision.
    expect(plan.problems.codeCollisions).toEqual([]);
  });

  it('accepts adoptableByCode as a plain object', () => {
    const plan = planCharges([charge(1, 'A')], ctx({ adoptableByCode: { 1: 55 } }));
    expect(plan.toAdopt).toEqual([{ rowId: 55, climaxId: 1 }]);
  });

  it('prefers climaxId over adoption when both would match', () => {
    // Already adopted on an earlier run - do not touch it again.
    const plan = planCharges(
      [charge(1, 'A')],
      ctx({ existingClimaxIds: [1], adoptableByCode: new Map([['1', 55]]) }),
    );
    expect(plan.toAdopt).toEqual([]);
    expect(plan.stats.alreadyImported).toBe(1);
  });

  it('refuses a charge with no name', () => {
    const plan = planCharges([charge(1, '   '), charge(2, 'REAL')], ctx());
    expect(plan.problems.missingName).toEqual([1]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('counts rows with no usable id and duplicated ids', () => {
    const plan = planCharges([
      { ChargesName: 'NO ID' },
      charge('x', 'BAD ID'),
      charge(2, 'A'),
      charge(2, 'B'),
    ], ctx());
    expect(plan.problems.missingId).toBe(2);
    expect(plan.problems.duplicateClimaxIds).toEqual([2]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('never emits a row that would violate a NOT NULL column', () => {
    // The whole point of planning before applying: nothing reaches bulkCreate
    // that the table will reject half-way through.
    const plan = planCharges([
      charge(1, 'A'), charge(2, 'B', { ShortName: null, InvoicePrintingName: null }),
      charge(3, 'C', { GL_Currencies: null }),
    ], ctx());
    for (const row of plan.toCreate) {
      expect(Number.isInteger(row.code)).toBe(true);
      expect(row.name).toBeTruthy();
      expect(row.short).toBeTruthy();
      expect(row.currency).toBeTruthy();
      expect(row.calculationType).toBeTruthy();
      expect(row.defaultPaybleParty).toBeTruthy();
      expect(row.defaultRecivableParty).toBeTruthy();
      expect(row.taxApply).toBeTruthy();
      expect(row.taxPerc).toBeTruthy();
    }
  });

  it('summarises', () => {
    const plan = planCharges([
      charge(1, 'A'),
      charge(2, 'B', { IsInActive: true }),
      charge(3, 'C'),
    ], ctx({ existingClimaxIds: [3] }));

    expect(plan.stats.source).toBe(3);
    expect(plan.stats.toCreate).toBe(2);
    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.stats.inactive).toBe(1);
  });

  it('does not throw on an empty source', () => {
    expect(planCharges([], ctx()).stats.source).toBe(0);
    expect(planCharges(undefined, ctx()).canApply).toBe(true);
  });
});

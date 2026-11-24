const { planImport, mapAccount } = require('../../functions/coaMigrationPlan');

/**
 * The planner decides whether a chart-of-accounts import is safe to run.
 * Each case here is something the old /accounts/importAccount got wrong
 * silently.
 */

const acc = (Id, AccountName, ParentAccountId = null, extra = {}) => ({
  Id, AccountName, ParentAccountId, AccountCode: `C${Id}`, ...extra,
});

describe('mapAccount', () => {
  it('preserves the legacy id', () => {
    // Everything downstream links by legacy COA id - parties, voucher heads,
    // client associations - so this must not be regenerated.
    expect(mapAccount(acc(742, 'CASH')).id).toBe(742);
  });

  it('writes editable as the string the rest of the codebase reads', () => {
    // The column is a STRING and other code compares against '0'/'1'. The old
    // importer wrote a raw boolean.
    expect(mapAccount(acc(1, 'A', null, { IsVoucherEntryAllowed: true })).editable).toBe('1');
    expect(mapAccount(acc(1, 'A', null, { IsVoucherEntryAllowed: false })).editable).toBe('0');
    // Unset means allowed, matching the legacy default.
    expect(mapAccount(acc(1, 'A')).editable).toBe('1');
  });

  it('survives an account with no code', () => {
    // The old importer called AccountCode.toString() and threw on the whole
    // import for one bad row.
    expect(() => mapAccount({ Id: 1, AccountName: 'X', AccountCode: null })).not.toThrow();
    expect(mapAccount({ Id: 1, AccountName: 'X', AccountCode: null }).code).toBeNull();
    expect(mapAccount({ Id: 1, AccountName: 'X', AccountCode: 0 }).code).toBe('0');
  });

  it('never leaves subCategory null', () => {
    // ledgerMapping.resolveAccountType reads it to classify a voucher line;
    // null falls through to the wrong bucket without complaining.
    expect(mapAccount(acc(1, 'A')).subCategory).toBe('General');
    expect(mapAccount(acc(1, 'A', null, { SubCategory: { SubCategory: 'Bank' } })).subCategory).toBe('Bank');
  });

  it('tidies whitespace in names', () => {
    expect(mapAccount(acc(1, '  CASH   IN  HAND ')).title).toBe('CASH IN HAND');
  });
});

describe('planImport ordering', () => {
  it('puts every parent before its children whatever order the source is in', () => {
    // The old importer inserted in array order, so a child arriving first got
    // a ChildAccountId pointing at a row that did not exist yet. There is no
    // FK constraint, so nothing complained.
    const plan = planImport([
      acc(3, 'GRANDCHILD', 2),
      acc(1, 'ROOT'),
      acc(2, 'CHILD', 1),
    ]);

    const order = plan.ordered.map((a) => a.id);
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(3));
    expect(plan.canApply).toBe(true);
  });

  it('handles a chart that is already in the right order', () => {
    const plan = planImport([acc(1, 'ROOT'), acc(2, 'CHILD', 1)]);
    expect(plan.ordered.map((a) => a.id)).toEqual([1, 2]);
  });
});

describe('planImport problems', () => {
  it('reports a collision when the id belongs to something we did not import', () => {
    // This is the seeded chart of accounts on a fresh install: it occupies
    // ids 1..31, which the legacy data expects to own. Importing over it
    // would overwrite accounts the install is already using.
    const plan = planImport([acc(1, 'LEGACY ROOT')], [1]);
    expect(plan.problems.collisions).toEqual([1]);
    expect(plan.canApply).toBe(false);
    expect(plan.ordered).toHaveLength(0);
  });

  it('treats an id we imported earlier as a clean re-run, not a collision', () => {
    const plan = planImport([acc(1, 'ROOT')], [1], { migratedIds: [1] });
    expect(plan.problems.collisions).toEqual([]);
    expect(plan.skipped).toEqual([1]);
    expect(plan.canApply).toBe(true);
  });

  it('detaches an account whose parent is missing, and says so', () => {
    // Writing the dangling pointer is worse: /accounts/balanceSheet walks the
    // tree through `children`, so everything under a broken link disappears
    // from the report with no error.
    const plan = planImport([acc(5, 'STRAY', 999)]);
    expect(plan.problems.orphans).toEqual([
      { id: 5, title: 'STRAY', missingParent: 999 },
    ]);
    expect(plan.ordered[0].ChildAccountId).toBeNull();
    // Not blocking - the account is still worth having.
    expect(plan.canApply).toBe(true);
  });

  it('accepts a parent that is already in the target', () => {
    const plan = planImport([acc(2, 'CHILD', 1)], [1], { migratedIds: [1] });
    expect(plan.problems.orphans).toEqual([]);
    expect(plan.ordered[0].ChildAccountId).toBe(1);
  });

  it('detects a cycle and refuses to write the accounts in it', () => {
    const plan = planImport([acc(1, 'A', 2), acc(2, 'B', 1)]);
    expect(plan.problems.cycles.length).toBeGreaterThan(0);
    expect(plan.canApply).toBe(false);
    expect(plan.ordered.map((a) => a.id)).not.toContain(1);
    expect(plan.ordered.map((a) => a.id)).not.toContain(2);
  });

  it('reports duplicate ids rather than importing one twice', () => {
    const plan = planImport([acc(1, 'FIRST'), acc(1, 'SECOND')]);
    expect(plan.problems.duplicateIds).toEqual([1]);
    expect(plan.ordered).toHaveLength(1);
    expect(plan.ordered[0].title).toBe('FIRST');
  });

  it('skips rows with no id or no name instead of writing blanks', () => {
    const plan = planImport([
      { AccountName: 'NO ID' },
      acc(2, '   '),
      acc(3, 'FINE'),
    ]);
    expect(plan.problems.missingId).toBe(1);
    expect(plan.problems.missingTitle).toEqual([2]);
    expect(plan.ordered.map((a) => a.id)).toEqual([3]);
  });

  it('counts what it is going to do', () => {
    const plan = planImport([acc(1, 'A'), acc(2, 'B', 1), acc(3, 'C')], [3], { migratedIds: [3] });
    expect(plan.stats).toEqual({
      source: 3,
      usable: 3,
      toCreate: 2,
      alreadyImported: 1,
      blocked: 0,
    });
  });

  it('does not throw on an empty or missing source', () => {
    expect(planImport([]).canApply).toBe(true);
    expect(planImport(undefined).stats.source).toBe(0);
  });
});

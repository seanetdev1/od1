const { expand, legacyNamesFor, toGranularNames } = require('../../functions/permissions/grants');
const { byKey, PARTY_MODULES } = require('../../functions/permissions/catalog');

/* WHAT A USER'S STORED NAMES GRANT - functions/permissions/grants, since the
 * catalog changed on 2026-10-10 (the user's requests): a job's charges have a
 * module of their own, apart from the job's details, and Parties are three -
 * Non-GL, Customers (AR) and Vendors (AP). Older names keep meaning what they
 * meant; a save through the grid makes the rows say exactly what is ticked. */
const perms = (names) => [...expand(names).perms].sort();

describe('job charges, apart from the job', () => {
  test('a module of its own, with approve - deleting an invoice is the invoices’ now', () => {
    expect(byKey.jobCharges.actions).toEqual(['view', 'edit', 'approve']);
  });

  test('rows saved before it existed: the job rights cover the charges, as they did', () => {
    const p = perms(['perm:customs:view', 'perm:customs:edit']);
    expect(p).toEqual(expect.arrayContaining(['jobCharges:view', 'jobCharges:edit']));
    expect(p).not.toContain('jobCharges:approve');
  });

  test('saved through the grid since, only what is ticked - unticking every charges box sticks', () => {
    const names = toGranularNames(['perm:customs:view', 'perm:customs:edit'], undefined, { fromGrid: true });
    expect(names).toContain('perm:catalog:4');
    expect(perms(names)).toEqual(['customs:edit', 'customs:view']);
  });

  test('a legacy name keeps the charges of its jobs', () => {
    expect(perms(['ExSea'])).toEqual(expect.arrayContaining(['jobCharges:view', 'jobCharges:approve']));
  });

  test('charges alone put no job menu in the session', () => {
    expect(legacyNamesFor(['perm:jobCharges:view', 'perm:catalog:2'])).toEqual(['perm:jobCharges:view', 'perm:catalog:2']);
  });
});

describe('parties by kind', () => {
  test('three modules', () => {
    expect(PARTY_MODULES.map((m) => byKey[m].label)).toEqual([
      'Parties - Non-GL', 'Parties - Customers (AR)', 'Parties - Vendors (AP)',
    ]);
  });

  test('a grant of the old Parties module is a grant of each kind', () => {
    expect(perms(['perm:parties:view', 'perm:parties:edit', 'perm:catalog:2'])).toEqual([
      'customers:edit', 'customers:view', 'nonGlParties:edit', 'nonGlParties:view', 'vendors:edit', 'vendors:view',
    ]);
  });

  test('each legacy list name is its own kind', () => {
    const p = perms(['VendorList', 'perm:catalog:2']);
    expect(p).toEqual(['vendors:delete', 'vendors:edit', 'vendors:view']);
  });

  test('a user on legacy names only: every kind to view and edit, as everyone had', () => {
    expect(perms(['Voucher'])).toEqual(expect.arrayContaining([
      'nonGlParties:view', 'nonGlParties:edit', 'customers:view', 'customers:edit', 'vendors:view', 'vendors:edit',
    ]));
    expect(expand(['Voucher']).granular).toBe(false);
    expect(expand(['perm:vouchers:view']).granular).toBe(true);
  });
});

/* JOB INVOICES, apart from the charges (the user's request, 2026-10-20): a
 * user may enter charges and raise invoices without editing or approving them.
 * Older rows keep meaning what they meant until the user is saved again. */
describe('job invoices, apart from the charges', () => {
  test('a module of its own: raising one is not editing or approving it', () => {
    expect(byKey.jobInvoices.actions).toEqual(['view', 'raise', 'edit', 'delete', 'approve', 'unapprove']);
  });

  test('rows saved before the split: the charges rights cover the invoices, as they did', () => {
    expect(perms(['perm:jobCharges:view', 'perm:jobCharges:edit', 'perm:catalog:2'])).toEqual([
      'jobCharges:edit', 'jobCharges:view', 'jobInvoices:edit', 'jobInvoices:raise', 'jobInvoices:view',
    ]);
    expect(perms(['perm:jobCharges:approve', 'perm:jobCharges:delete', 'perm:catalog:2']))
      .toEqual(expect.arrayContaining(['jobInvoices:approve', 'jobInvoices:delete']));
  });

  test('and rows from before the charges had a module: the job rights carry all the way', () => {
    const p = perms(['perm:seaExport:view', 'perm:seaExport:edit', 'perm:seaExport:delete']);
    expect(p).toEqual(expect.arrayContaining(['jobInvoices:view', 'jobInvoices:raise', 'jobInvoices:edit', 'jobInvoices:delete']));
    expect(p).not.toContain('jobInvoices:approve');
  });

  test('saved through the grid since: raise without edit or approve sticks', () => {
    const names = toGranularNames(
      ['perm:jobCharges:view', 'perm:jobCharges:edit', 'perm:jobInvoices:view', 'perm:jobInvoices:raise'],
      undefined, { fromGrid: true },
    );
    expect(perms(names)).toEqual(['jobCharges:edit', 'jobCharges:view', 'jobInvoices:raise', 'jobInvoices:view']);
  });

  test('a save never writes a box the grid no longer has', () => {
    const names = toGranularNames(['perm:jobCharges:delete', 'perm:catalog:2']);
    expect(names).not.toContain('perm:jobCharges:delete');
    expect(names).toContain('perm:jobInvoices:delete');
  });

  test('a legacy name keeps both, every right', () => {
    expect(perms(['ExSea'])).toEqual(expect.arrayContaining([
      'jobCharges:approve', 'jobInvoices:raise', 'jobInvoices:edit', 'jobInvoices:delete', 'jobInvoices:approve',
    ]));
  });

  test('the old marker is a marker, not a right', () => {
    expect(perms(['perm:vouchers:view', 'perm:catalog:2'])).toEqual(['vouchers:view']);
  });
});

/* UNAPPROVE, APART FROM APPROVE (the user's request, 2026-10-24): an operator
 * raises invoices approved - posted to the ledger as they are made - and may
 * not take them back out of it. */
describe('unapproving an invoice, apart from approving it', () => {
  test('a right of its own, on job invoices and on Accounts invoices', () => {
    expect(byKey.jobInvoices.actions).toContain('unapprove');
    expect(byKey.invoices.actions).toEqual(['view', 'edit', 'delete', 'approve', 'unapprove']);
  });

  test('saved through the grid now: Approve without Unapprove sticks', () => {
    const names = toGranularNames(
      ['perm:jobInvoices:view', 'perm:jobInvoices:raise', 'perm:jobInvoices:approve', 'perm:invoices:view', 'perm:invoices:approve'],
      undefined, { fromGrid: true },
    );
    expect(names).toContain('perm:catalog:4');
    const p = perms(names);
    expect(p).toEqual(expect.arrayContaining(['jobInvoices:approve', 'invoices:approve']));
    expect(p).not.toContain('jobInvoices:unapprove');
    expect(p).not.toContain('invoices:unapprove');
  });

  test('rows saved before it: an invoice Approve still takes the approval back, until saved again', () => {
    for (const marker of ['perm:catalog:3', 'perm:catalog:2']) {
      expect(perms(['perm:invoices:view', 'perm:invoices:approve', marker])).toContain('invoices:unapprove');
    }
    // A charges Approve from before the invoices split covered the invoices - all of it.
    expect(perms(['perm:jobCharges:approve', 'perm:catalog:2'])).toEqual(expect.arrayContaining(['jobInvoices:approve', 'jobInvoices:unapprove']));
    // And catalog:3 rows are still complete for the invoices split - nothing carried from the charges.
    expect(perms(['perm:jobCharges:approve', 'perm:catalog:3'])).not.toContain('jobInvoices:approve');
  });

  test('a charges Approve is not an invoice Unapprove', () => {
    expect(perms(['perm:jobCharges:view', 'perm:jobCharges:approve', 'perm:catalog:4'])).not.toContain('jobInvoices:unapprove');
  });

  test('a legacy name, as before, has everything on its modules', () => {
    expect(perms(['Invoice/Bills'])).toContain('invoices:unapprove');
  });
});

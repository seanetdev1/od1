// Legacy direct job expense/revenue -> Direct Job E/R - see
// functions/directJobMigrationPlan. These pin what an entry becomes, and the
// rules the user set for what is kept: anything whose absence could change the
// ledger stays, and only an entry that never posted, or has nothing to link its
// voucher through, is left out.

const { planDirectJobs } = require('../../functions/directJobMigrationPlan');
const { lastDirectJobSeq } = require('../../functions/directJobNumber');

const header = (over = {}) => ({
  Id: 10, TranNumber: 'JER-132/27', TypeId: 1, TranModeId: 1, TranModeSubTypeId: null,
  SubCompanyId: 1, CurrencyId: 1, ExchangeRate: 1, SettlementAccountId: 5439, VoucherId: 900,
  SingleMultipleId: 2, PartyId: null, AddOn: '2026-09-21T10:00:00Z', ...over,
});
const line = (over = {}) => ({
  Id: 1, JobDirectId: 10, dLGJobId: 24013, ChargesId: 423, CurrencyId: 1, PerUnitFixedId: 1,
  Quantity: 1, Rate: 1000, Amount: 1000, NetAmount: 1000, ExchangeRate: 1, DiscountAmount: 0,
  JobFileNumber: 'F-1', ...over,
});
const ctx = (over = {}) => ({
  companyShortByLegacyId: new Map([['1', 'CL']]),
  currencyByLegacyId: new Map([['1', 'PKR'], ['10', 'AED']]),
  jobByLegacyId: new Map([['24013', { id: 7, jobNo: 'TP-2640/27' }]]),
  chargeByLegacyId: new Map([['423', 55]]),
  voucherByLegacyId: new Map([['900', 3001]]),
  accountIds: new Set([5439, 7418]),
  partyAccountByLegacyId: new Map(),
  existingEntryNos: new Set(),
  ...over,
});

describe('planDirectJobs', () => {
  test('an entry keeps its legacy number behind the company code, and links the imported voucher', () => {
    const { toCreate } = planDirectJobs([header()], [line()], ctx());
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0].entry).toMatchObject({
      Entry_No: 'CL-JER-132/27', Type: 'expense', Tran_Mode: 'Cash', SubType: 'cash',
      Account_No: 5439, Currency: 'PKR', Operation: 'logistics',
    });
    expect(toCreate[0].lines[0]).toMatchObject({
      Job_No: 'TP-2640/27', CustomsJobId: 7, Job_Id: null, Charge_Name: '55', Voucher_Id: 3001,
      Amount: 1000, Basis: 'unit',
    });
  });

  test('type and mode come across one for one: revenue by bank, and an Adjust entry', () => {
    const plan = planDirectJobs(
      [header({ Id: 1, TranNumber: 'JER-1/27', TypeId: 2, TranModeId: 2, TranModeSubTypeId: 5 }),
       header({ Id: 2, TranNumber: 'JER-2/27', TranModeId: 4, SettlementAccountId: 7418 })],
      [line({ JobDirectId: 1 }), line({ Id: 2, JobDirectId: 2 })],
      ctx(),
    );
    const [bank, adjust] = plan.toCreate.map((c) => c.entry);
    expect(bank).toMatchObject({ Type: 'revenue', Tran_Mode: 'Bank', SubType: 'cheque' });
    expect(adjust).toMatchObject({ Tran_Mode: 'Adjust', SubType: 'adjustment' });
  });

  test('ACH is a wire payment', () => {
    const { toCreate } = planDirectJobs([header({ TranModeId: 2, TranModeSubTypeId: 1 })], [line()], ctx());
    expect(toCreate[0].entry.SubType).toBe('wire transfer');
  });

  test('a line with no job is left out - the database requires one - and its entry still comes in', () => {
    const plan = planDirectJobs([header()], [line(), line({ Id: 2, dLGJobId: null, Amount: 400, NetAmount: 400 })], ctx());
    expect(plan.toCreate[0].lines).toHaveLength(1);
    expect(plan.toCreate[0].lines[0]).toMatchObject({ CustomsJobId: 7 });
    expect(plan.problems.linesWithoutJob).toHaveLength(1);
    // Still in the books through the voucher; reported, not lost silently.
    expect(plan.stats.leftOutAmount).toBe(400);
  });

  test('every line is attached to exactly one job, as Direct_Job_Association_one_job demands', () => {
    const plan = planDirectJobs([header()], [line(), line({ Id: 2, dLGJobId: 999 }), line({ Id: 3, dLGJobId: null })], ctx());
    for (const l of plan.toCreate.flatMap((c) => c.lines)) {
      expect([l.Job_Id, l.AviationJobId, l.CustomsJobId].filter((v) => v !== null && v !== undefined)).toHaveLength(1);
    }
    expect(plan.problems.jobNotImported).toHaveLength(1);
  });

  test('an entry none of whose lines has a job is skipped', () => {
    const plan = planDirectJobs([header()], [line({ dLGJobId: null })], ctx());
    expect(plan.toCreate).toEqual([]);
    expect(plan.problems.noAttachableLines).toHaveLength(1);
  });

  test('an entry that never posted, or has no lines, is left out - neither can change the ledger', () => {
    const plan = planDirectJobs(
      [header({ Id: 1, TranNumber: 'JER-93/27', VoucherId: null }),
       header({ Id: 2, TranNumber: 'JER-595/25' })],
      [line({ JobDirectId: 1 })],
      ctx(),
    );
    expect(plan.toCreate).toEqual([]);
    expect(plan.problems.noVoucher).toEqual(['JER-93/27']);
    expect(plan.problems.noLines).toEqual(['JER-595/25']);
  });

  test('an entry whose voucher the ledger stage has not imported waits, whole', () => {
    const plan = planDirectJobs([header({ VoucherId: 999 })], [line()], ctx());
    expect(plan.toCreate).toEqual([]);
    expect(plan.problems.voucherNotImported).toHaveLength(1);
  });

  test('a charge Odyssey does not have holds back the entry rather than dropping a line', () => {
    const plan = planDirectJobs([header()], [line(), line({ Id: 2, ChargesId: 1 })], ctx());
    expect(plan.toCreate).toEqual([]);
    expect(plan.problems.chargeMissing).toHaveLength(1);
  });

  test('a line tagged a foreign currency at rate 1 is taken as the entry currency', () => {
    const plan = planDirectJobs([header()], [line({ CurrencyId: 10 })], ctx());
    expect(plan.toCreate[0].lines[0].Currency).toBe('PKR');
    expect(plan.problems.currencyCorrected).toHaveLength(1);
  });

  test('Amount is the posted line total, quantity included', () => {
    const plan = planDirectJobs([header()], [line({ Quantity: 3, Rate: 500, Amount: 1500, NetAmount: 1500 })], ctx());
    expect(plan.toCreate[0].lines[0]).toMatchObject({ Quantity: 3, Amount: 1500 });
  });

  test('a sub-type with no mapping is reported, not guessed', () => {
    const plan = planDirectJobs([header({ TranModeId: 2, TranModeSubTypeId: 15 })], [line()], ctx());
    expect(plan.toCreate).toEqual([]);
    expect(plan.problems.unknownCode).toHaveLength(1);
  });

  test('an entry already in Odyssey is skipped, so the stage can run again', () => {
    const plan = planDirectJobs([header()], [line()], ctx({ existingEntryNos: new Set(['CL-JER-132/27']) }));
    expect(plan.toCreate).toEqual([]);
    expect(plan.stats.alreadyImported).toBe(1);
  });
});

describe('lastDirectJobSeq', () => {
  const rows = (...numbers) => numbers.map((n) => ({ Entry_No: n, createdAt: '2026-08-01' }));
  const opts = { code: 'DE', suffix: '27', yearFirst: false, yearStart: '2026-07-01' };

  test('compares as numbers - DE-10 is after DE-9', () => {
    expect(lastDirectJobSeq(rows('CL-DE-9/27', 'CL-DE-10/27'), opts)).toBe(10);
  });

  test('ignores other codes, migrated JER entries included', () => {
    expect(lastDirectJobSeq(rows('CL-JER-132/27', 'CL-DE-3/27'), opts)).toBe(3);
  });

  test('last year\'s 27th does not count as this year\'s entry', () => {
    // "CL-DE-27/26" read year-first would be FY27's 26th; it was made last year.
    const old = [{ Entry_No: 'CL-DE-27/26', createdAt: '2026-05-01' }];
    expect(lastDirectJobSeq(old, opts)).toBe(0);
  });

  test('...but a year-first entry made this year does, after a format switch', () => {
    const switched = [{ Entry_No: 'CL-DE-27/4', createdAt: '2026-08-01' }];
    expect(lastDirectJobSeq(switched, opts)).toBe(4);
  });

  // Config > Document Numbers can take the company prefix off: the sequence
  // must run straight on across the switch, either way.
  test('counts entries with and without the company prefix together', () => {
    expect(lastDirectJobSeq(rows('CL-DE-7/27', 'DE-8/27'), opts)).toBe(8);
    expect(lastDirectJobSeq(rows('DE-12/27', 'CL-DE-9/27'), opts)).toBe(12);
  });

  test('a code only counts as itself, not inside a longer one', () => {
    expect(lastDirectJobSeq(rows('CL-XDE-50/27', 'CL-DE-2/27'), opts)).toBe(2);
  });
});

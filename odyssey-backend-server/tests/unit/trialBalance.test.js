/**
 * The trial balance - functions/trialBalance.js.
 *
 * What is pinned here is what the old report got wrong: an Opening built from
 * every earlier entry (it was always empty), Debitors and Creditors chosen by
 * the true closing balance, groups that add up everything under them, and a
 * grand total of only what is listed. Income and expense are no different:
 * they carry their whole history, as in the ledger.
 */
const {
  REPORT_TYPES, utcOffsetOf, reportDay, dayStart, dayEnd,
  accountSumsSql, columnsFor, buildTrialBalance,
} = require('../../functions/trialBalance');

// A small chart, five roots as every install has them.
const accounts = [
  { id: 1, title: 'ASSETS', code: '1', ChildAccountId: null },
  { id: 10, title: 'DEBTORS', code: '11', ChildAccountId: 1 },
  { id: 100, title: 'Party A', code: '1102', ChildAccountId: 10 },
  { id: 101, title: 'Party B', code: '1101', ChildAccountId: 10 },
  { id: 11, title: 'BANK', code: '12', ChildAccountId: 1 },
  { id: 2, title: 'LAIBILITY', code: '2', ChildAccountId: null },
  { id: 20, title: 'CREDITORS', code: '21', ChildAccountId: 2 },
  { id: 200, title: 'Vendor C', code: '2101', ChildAccountId: 20 },
  { id: 21, title: 'ACCRUALS', code: '22', ChildAccountId: 2 },
  { id: 210, title: 'Unused accrual', code: '2201', ChildAccountId: 21 },
  { id: 3, title: 'CAPITAL', code: '3', ChildAccountId: null },
  { id: 30, title: 'OWNER', code: '31', ChildAccountId: 3 },
  { id: 4, title: 'REVENUE', code: '4', ChildAccountId: null },
  { id: 40, title: 'SALES', code: '41', ChildAccountId: 4 },
  { id: 5, title: 'EXPENSE', code: '5', ChildAccountId: null },
  { id: 50, title: 'RENT', code: '51', ChildAccountId: 5 },
];

// Net before From (debit positive); gross debits and credits in the period.
// Each column balances on its own.
const sums = [
  { id: 100, opening: '150', trDebit: '30', trCredit: '10' },
  { id: 101, opening: '-20', trDebit: '0', trCredit: '5' },
  { id: 11, opening: '500', trDebit: '110', trCredit: '100' },
  { id: 200, opening: '-300', trDebit: '0', trCredit: '0' },
  { id: 30, opening: '-200', trDebit: '0', trCredit: '0' },
  { id: 40, opening: '-460', trDebit: '0', trCredit: '80' },
  { id: 50, opening: '330', trDebit: '55', trCredit: '0' },
];

const build = (extra = {}) => buildTrialBalance({ accounts, sums, reportType: REPORT_TYPES.SIX, options: 'showall', ...extra });
const row = (r, title) => r.rows.find((x) => x.title === title);
const titles = (r) => r.rows.map((x) => x.title);
const one = (title, s) => buildTrialBalance({
  accounts: [{ id: 1, title: 'ASSETS', code: '1', ChildAccountId: null }, { id: 2, title, code: '11', ChildAccountId: 1 }],
  sums: [{ id: 2, trDebit: '0', trCredit: '0', ...s }],
});

describe('the figures', () => {
  test('Opening is every entry before From, not only the period\'s', () => {
    const a = row(build(), 'Party A');
    expect(a).toMatchObject({ opDebit: 150, opCredit: 0, trDebit: 30, trCredit: 10, clDebit: 170, clCredit: 0 });
  });

  test('income and expense carry their whole history - no restart at the financial year', () => {
    const r = build();
    expect(row(r, 'SALES')).toMatchObject({ opDebit: 0, opCredit: 460, trCredit: 80, clCredit: 540 });
    expect(row(r, 'RENT')).toMatchObject({ opDebit: 330, trDebit: 55, clDebit: 385 });
    expect(titles(r).some((t) => /BROUGHT FORWARD/i.test(t))).toBe(false);
  });

  test('every column balances', () => {
    expect(build().totals).toEqual({ opDebit: 980, opCredit: 980, trDebit: 195, trCredit: 195, clDebit: 1065, clCredit: 1065 });
  });

  test('a group adds up everything under it, each side on its own', () => {
    const r = build();
    // Party A 170 Dr and Party B 25 Cr - both shown, not netted to 145.
    expect(row(r, 'DEBTORS')).toMatchObject({ group: true, level: 2, opDebit: 150, opCredit: 20, clDebit: 170, clCredit: 25 });
    expect(row(r, 'ASSETS')).toMatchObject({ group: true, level: 1, clDebit: 680, clCredit: 25 });
  });

  test('money is added in cents', () => {
    expect(row(one('X', { opening: '0.1', trDebit: '0.2' }), 'X').clDebit).toBe(0.3);
  });
});

describe('what is listed', () => {
  test('depth first, by account code - numbers as numbers', () => {
    expect(titles(build())).toEqual([
      'ASSETS', 'DEBTORS', 'Party B', 'Party A', 'BANK',
      'LAIBILITY', 'CREDITORS', 'Vendor C',
      'CAPITAL', 'OWNER',
      'REVENUE', 'SALES',
      'EXPENSE', 'RENT',
    ]);
  });

  test('an account with nothing to show is left out, and so is a group left empty', () => {
    const r = build();
    expect(row(r, 'Unused accrual')).toBeUndefined();
    expect(row(r, 'ACCRUALS')).toBeUndefined();
  });

  test('an account picked is reported with everything under it', () => {
    const r = build({ accountId: '10' });
    expect(titles(r)).toEqual(['DEBTORS', 'Party B', 'Party A']);
    expect(r.rows.map((x) => x.level)).toEqual([1, 2, 2]);
    expect(r.totals).toMatchObject({ clDebit: 170, clCredit: 25 });
  });

  test('a single account picked is reported on its own', () => {
    expect(titles(build({ accountId: 100 }))).toEqual(['Party A']);
  });
});

describe('the four report types', () => {
  test('6-column shows all six; Exclude Opening hides the Opening pair and keeps the true Closing', () => {
    expect(build().columns).toEqual(['opDebit', 'opCredit', 'trDebit', 'trCredit', 'clDebit', 'clCredit']);
    const r = build({ options: 'excludeOpening' });
    expect(r.columns).toEqual(['trDebit', 'trCredit', 'clDebit', 'clCredit']);
    expect(row(r, 'Party A')).toEqual({ id: 100, code: '1102', title: 'Party A', level: 3, group: false, trDebit: 30, trCredit: 10, clDebit: 170, clCredit: 0 });
    // Only an opening balance, no movement: still listed - it has a closing one.
    expect(row(r, 'Vendor C')).toMatchObject({ clCredit: 300 });
  });

  test('2-column shows Closing only, and sends nothing else', () => {
    const r = build({ reportType: REPORT_TYPES.TWO });
    expect(r.columns).toEqual(['clDebit', 'clCredit']);
    expect(Object.keys(r.totals)).toEqual(['clDebit', 'clCredit']);
    expect(Object.keys(row(r, 'Party A'))).toEqual(['id', 'code', 'title', 'level', 'group', 'clDebit', 'clCredit']);
  });

  test('2-column leaves out an account whose movement brought it to nil; 6-column lists it', () => {
    const settled = (reportType) => buildTrialBalance({
      accounts: [{ id: 1, title: 'ASSETS', code: '1', ChildAccountId: null }, { id: 2, title: 'Settled', code: '11', ChildAccountId: 1 }],
      sums: [{ id: 2, opening: '40', trDebit: '0', trCredit: '40' }],
      reportType,
    });
    expect(settled(REPORT_TYPES.TWO).rows).toEqual([]);
    expect(titles(settled(REPORT_TYPES.SIX))).toEqual(['ASSETS', 'Settled']);
  });

  test('Debitors List: accounts whose closing balance is a debit, totalled alone', () => {
    const r = build({ reportType: REPORT_TYPES.DEBTORS });
    expect(r.columns).toEqual(['clDebit']);
    expect(titles(r)).toEqual(['ASSETS', 'DEBTORS', 'Party A', 'BANK', 'EXPENSE', 'RENT']);
    // Party B is in credit: not listed, and not in DEBTORS' figure either.
    expect(row(r, 'DEBTORS')).toMatchObject({ clDebit: 170 });
    expect(r.totals).toEqual({ clDebit: 1065 });
  });

  test('Creditors List: accounts whose closing balance is a credit, totalled alone', () => {
    const r = build({ reportType: REPORT_TYPES.CREDITORS });
    expect(r.columns).toEqual(['clCredit']);
    expect(titles(r)).toEqual([
      'ASSETS', 'DEBTORS', 'Party B',
      'LAIBILITY', 'CREDITORS', 'Vendor C',
      'CAPITAL', 'OWNER',
      'REVENUE', 'SALES',
    ]);
    expect(r.totals).toEqual({ clCredit: 1065 });
  });

  test('a debtor who paid more this period than was billed is still a debtor', () => {
    // 1,000 owed at From; billed 100, paid 300 in the period: the PERIOD is a
    // credit, the balance is not. The old report listed this as a creditor.
    const r = buildTrialBalance({
      accounts: [{ id: 1, title: 'ASSETS', code: '1', ChildAccountId: null }, { id: 2, title: 'Customer', code: '11', ChildAccountId: 1 }],
      sums: [{ id: 2, opening: '1000', trDebit: '100', trCredit: '300' }],
      reportType: REPORT_TYPES.DEBTORS,
    });
    expect(row(r, 'Customer')).toMatchObject({ clDebit: 800 });
  });

  test('an unknown report type is the 6-column one', () => {
    expect(build({ reportType: 'nonsense' }).reportType).toBe(REPORT_TYPES.SIX);
    expect(columnsFor(undefined)).toHaveLength(6);
  });
});

describe('charts that are not the usual shape', () => {
  test('a group posted to directly lists those entries as a line of its own', () => {
    const r = buildTrialBalance({
      accounts,
      sums: [...sums, { id: 10, opening: '7', trDebit: '0', trCredit: '0' }],
    });
    const at = titles(r).indexOf('DEBTORS');
    expect(r.rows[at]).toMatchObject({ group: true, opDebit: 157 });
    expect(r.rows[at + 1]).toMatchObject({ title: 'DEBTORS', group: false, level: 3, opDebit: 7 });
  });

  test('a loop in the chart ends the walk, not the request', () => {
    const looped = [
      { id: 1, title: 'ASSETS', code: '1', ChildAccountId: null },
      { id: 2, title: 'A', code: '11', ChildAccountId: 3 },
      { id: 3, title: 'B', code: '12', ChildAccountId: 2 },
    ];
    expect(() => buildTrialBalance({ accounts: looped, sums: [{ id: 2, opening: '5', trDebit: '0', trCredit: '0' }] })).not.toThrow();
  });
});

describe('dates', () => {
  test('a day is taken as it is', () => {
    expect(reportDay('2026-07-01')).toBe('2026-07-01');
  });

  test('an older link\'s ISO instant is the day it was in the reader\'s zone', () => {
    // 1 July 00:00 in Karachi is 30 June in UTC.
    expect(reportDay('2026-06-30T19:00:00.000Z', 300)).toBe('2026-07-01');
    expect(reportDay('2026-06-30T19:00:00.000Z', 0)).toBe('2026-06-30');
  });

  test('nothing usable is null', () => {
    ['', undefined, null, 'undefined', 'null', 'tomorrow', '2026-13-01'].forEach((v) => expect(reportDay(v)).toBeNull());
  });

  test('a day runs from its midnight to the next, in the reader\'s zone', () => {
    expect(dayStart('2026-07-01', 300).toISOString()).toBe('2026-06-30T19:00:00.000Z');
    expect(dayEnd('2026-07-01', 300).toISOString()).toBe('2026-07-01T19:00:00.000Z');
  });

  test('the offset defaults to Pakistan\'s when missing or nonsense', () => {
    expect(utcOffsetOf('300')).toBe(300);
    expect(utcOffsetOf('-240')).toBe(-240);
    [undefined, null, '', 'abc', '9999', '1.5'].forEach((v) => expect(utcOffsetOf(v)).toBe(300));
  });
});

describe('the query', () => {
  test('rupees: every voucher, by rupee value', () => {
    const sql = accountSumsSql({ pkr: true, company: 1 });
    expect(sql).toContain('vh."defaultAmount"');
    expect(sql).not.toContain(':currency');
    expect(sql).toContain('v."CompanyId" = :company');
  });

  test('a foreign currency: that currency\'s vouchers, by their own amount', () => {
    const sql = accountSumsSql({ pkr: false, company: null });
    expect(sql).toContain('v.currency = :currency');
    expect(sql).not.toContain('defaultAmount');
    expect(sql).not.toContain(':company');
  });

  test('dated by the line, as the ledger is', () => {
    expect(accountSumsSql()).toContain('vh."createdAt" < :toEnd');
    expect(accountSumsSql()).not.toContain('v."createdAt"');
  });

  test('no financial-year split: one opening, everything before From', () => {
    expect(accountSumsSql()).not.toContain(':yearStart');
    expect(accountSumsSql()).toContain('AS "opening"');
  });
});

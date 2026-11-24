const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* THE TRIAL BALANCE, FROM THE DATABASE - routes/misc/trialBalance.
 *
 * The arithmetic is pinned in tests/unit/trialBalance; this is the query
 * under it: that Opening reaches back past From - last year's income
 * included - that a line counts on ITS date and not its voucher's, where a
 * day begins and ends in Karachi, and that a foreign-currency report takes
 * that currency's vouchers at their own amount.
 *
 * One company of its own, so nothing else in the test database is counted. */
describe('the trial balance', () => {
  const stamp = Date.now();
  const at = (iso) => new Date(iso);
  let authHeader; let company;
  const made = { accounts: [], vouchers: [] };
  let party; let owner; let sales;

  const account = async (title, code, parent) => {
    const a = await db.Child_Account.create({ title, code, ChildAccountId: parent ? parent.id : null });
    made.accounts.push(a.id);
    return a;
  };

  // One voucher, two lines: `dr` debited and `cr` credited by the same amount.
  const entry = async ({ dr, cr, amount, defaultAmount = amount, when, linesWhen = when, currency = 'PKR' }) => {
    const no = made.vouchers.length + 1;
    const v = await db.Vouchers.create({
      voucher_No: no, voucher_Id: `${TEST_PREFIX}TB-${stamp}-${no}`, type: 'Journal Voucher', vType: 'JV',
      currency, CompanyId: company.id, createdAt: at(when), updatedAt: at(when),
    }, { fiscalYearCheck: false, silent: true });
    made.vouchers.push(v.id);
    for (const [acc, type] of [[dr, 'debit'], [cr, 'credit']]) {
      await db.Voucher_Heads.create({
        amount: String(amount), defaultAmount: String(defaultAmount), type, narration: v.voucher_Id,
        VoucherId: v.id, ChildAccountId: acc.id, createdAt: at(linesWhen), updatedAt: at(linesWhen),
      }, { silent: true });
    }
  };

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    company = await db.Company.create({ title: `${TEST_PREFIX}Trial Balance ${stamp}`, short: 'TTB' });

    const assets = await account(`${TEST_PREFIX}TB ASSETS ${stamp}`, '0001');
    const capital = await account(`CAPITAL ${TEST_PREFIX}${stamp}`, '0002');
    const revenue = await account(`REVENUE ${TEST_PREFIX}${stamp}`, '0003');
    party = await account(`${TEST_PREFIX}TB PARTY ${stamp}`, '000101', assets);
    owner = await account(`${TEST_PREFIX}TB OWNER ${stamp}`, '000201', capital);
    sales = await account(`${TEST_PREFIX}TB SALES ${stamp}`, '000301', revenue);

    // Last financial year: billed 1,000, and the owner put in 500.
    await entry({ dr: party, cr: sales, amount: 1000, when: '2026-03-10T07:00:00.000Z' });
    await entry({ dr: party, cr: owner, amount: 500, when: '2025-12-01T07:00:00.000Z' });
    // This year, before From.
    await entry({ dr: party, cr: sales, amount: 200, when: '2026-07-15T07:00:00.000Z' });
    // A voucher entered in the period whose lines stand on last year's date.
    await entry({ dr: party, cr: sales, amount: 70, when: '2026-08-20T07:00:00.000Z', linesWhen: '2026-06-20T07:00:00.000Z' });
    // The period.
    await entry({ dr: owner, cr: party, amount: 300, when: '2026-08-10T07:00:00.000Z' });
    // 23:30 on To, in Karachi - in. 00:10 the next day - out.
    await entry({ dr: party, cr: sales, amount: 50, when: '2026-09-30T18:30:00.000Z' });
    await entry({ dr: party, cr: sales, amount: 999, when: '2026-09-30T19:10:00.000Z' });
    // US$10 at 280.
    await entry({ dr: party, cr: sales, amount: 10, defaultAmount: 2800, currency: 'USD', when: '2026-08-25T07:00:00.000Z' });
  });

  afterAll(async () => {
    await db.Voucher_Heads.destroy({ where: { VoucherId: made.vouchers } });
    await db.Vouchers.destroy({ where: { id: made.vouchers }, fiscalYearCheck: false });
    await db.Child_Account.destroy({ where: { id: [...made.accounts].reverse() } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  const report = (headers = {}) => request(app).get('/misc/trialBalance/get')
    .set('Authorization', authHeader)
    .set({
      company: String(company.id), from: '2026-08-01', to: '2026-09-30', utcoffset: '300',
      currency: 'PKR', reporttype: '6- Columns Simplified View', options: 'showall', ...headers,
    });
  const row = (res, title) => res.body.result.rows.find((r) => r.title === title);

  it('opens with everything before From, and counts each line on its own date', async () => {
    const res = await report();
    expect(res.status).toBe(200);
    // 1,000 + 500 + 200 + the 70 dated June. In the period: 50 and US$10 (2,800)
    // in, 300 out; the 999 is the next day.
    expect(row(res, party.title)).toMatchObject({ opDebit: 1770, opCredit: 0, trDebit: 2850, trCredit: 300, clDebit: 4320, clCredit: 0 });
    expect(row(res, owner.title)).toMatchObject({ opCredit: 500, trDebit: 300, clCredit: 200 });
  });

  it('carries income\'s whole history - last financial year\'s included', async () => {
    const res = await report();
    // 1,000 in March and the 70 dated June (last year), 200 in July (this one).
    expect(row(res, sales.title)).toMatchObject({ opDebit: 0, opCredit: 1270, trCredit: 2850, clCredit: 4120 });
    expect(res.body.result.rows.some((r) => /BROUGHT FORWARD/i.test(r.title))).toBe(false);
    expect(res.body.result.totals).toEqual({ opDebit: 1770, opCredit: 1770, trDebit: 3150, trCredit: 3150, clDebit: 4320, clCredit: 4320 });
  });

  it('lists debtors and creditors by their closing balance', async () => {
    const debtors = await report({ reporttype: 'Debitors List' });
    expect(debtors.body.result.rows.filter((r) => !r.group).map((r) => r.title)).toEqual([party.title]);
    expect(debtors.body.result.totals).toEqual({ clDebit: 4320 });

    const creditors = await report({ reporttype: 'Creditors List' });
    expect(creditors.body.result.rows.filter((r) => !r.group).map((r) => r.title).sort())
      .toEqual([owner.title, sales.title].sort());
    expect(creditors.body.result.totals).toEqual({ clCredit: 4320 });
  });

  it('in a foreign currency, takes that currency\'s vouchers at their own amount', async () => {
    const res = await report({ currency: 'USD' });
    expect(row(res, party.title)).toMatchObject({ opDebit: 0, trDebit: 10, clDebit: 10 });
    expect(row(res, sales.title)).toMatchObject({ trCredit: 10, clCredit: 10 });
  });

  it('reads an older link\'s ISO dates as the days they were in Karachi', async () => {
    const res = await report({ from: '2026-07-31T19:00:00.000Z', to: '2026-09-30T05:00:00.000Z' });
    expect(res.body.result).toMatchObject({ from: '2026-08-01', to: '2026-09-30' });
    expect(row(res, party.title)).toMatchObject({ clDebit: 4320 });
  });

  it('refuses a report with no dates, or To before From', async () => {
    expect((await report({ from: '' })).status).toBe(400);
    const backwards = await report({ from: '2026-10-01' });
    expect(backwards.status).toBe(400);
    expect(backwards.body.result).toBe('To is before From.');
  });
});

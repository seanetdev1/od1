const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* THE ORDER OF A DAY'S ENTRIES IN THE LEDGER.
 *
 * Migrated SI / PI vouchers stand on their invoice's date at midnight, and a
 * freight invoice on its sailing date, so a day's invoices share one
 * timestamp. Ordered by createdAt alone, the ties came back in whatever order
 * Postgres found them - here, the order their lines were written, which is
 * deliberately the reverse of the order the vouchers were made. */
describe('the ledger lists a day\'s entries in the order they were made', () => {
  const stamp = Date.now();
  const DAY = new Date('2026-08-31T00:00:00.000Z');
  let authHeader; let company; let party; let income; let first; let second;

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    company = await db.Company.create({ title: `${TEST_PREFIX}Ledger Order ${stamp}`, short: 'TLO' });
    party = await db.Child_Account.create({ title: `${TEST_PREFIX}ORDER PARTY ${stamp}` });
    income = await db.Child_Account.create({ title: `${TEST_PREFIX}ORDER INCOME ${stamp}` });

    const voucher = (no) => db.Vouchers.create({
      voucher_No: no, voucher_Id: `${TEST_PREFIX}SI-${no}/27`, type: 'Job Recievable', vType: 'SI',
      CompanyId: company.id, createdAt: DAY, updatedAt: DAY,
    }, { fiscalYearCheck: false, silent: true });
    first = await voucher(1001);
    second = await voucher(1002);

    // The second voucher's lines are written FIRST.
    for (const v of [second, first]) {
      await db.Voucher_Heads.create({
        amount: '100', defaultAmount: '100', type: 'debit', narration: v.voucher_Id,
        VoucherId: v.id, ChildAccountId: party.id, createdAt: DAY, updatedAt: DAY,
      }, { silent: true });
      await db.Voucher_Heads.create({
        amount: '100', defaultAmount: '100', type: 'credit', narration: v.voucher_Id,
        VoucherId: v.id, ChildAccountId: income.id, createdAt: DAY, updatedAt: DAY,
      }, { silent: true });
    }
  });

  afterAll(async () => {
    await db.Voucher_Heads.destroy({ where: { VoucherId: [first.id, second.id] } });
    await db.Vouchers.destroy({ where: { id: [first.id, second.id] }, fiscalYearCheck: false });
    await db.Child_Account.destroy({ where: { id: [party.id, income.id] } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  const ledger = () => request(app).get('/accounts/getLedger')
    .set('Authorization', authHeader)
    .set('id', String(party.id)).set('to', '31-08-2026')
    .set('currency', 'PKR').set('company', String(company.id));

  it('puts the voucher made first first, whatever order its lines were written in', async () => {
    const res = await ledger();

    expect(res.body.status).toBe('success');
    expect(res.body.result.map((r) => r['Voucher.voucher_Id']))
      .toEqual([first.voucher_Id, second.voucher_Id]);
  });

  /* Each line carries when its voucher was ENTERED (Voucher.createdOn), which
   * the screen orders a day's entries by after the date (frontend
   * functions/ledgerOrder) - every entry in the order it was made. Invoice
   * numbers are no longer sent: the invoice-number order went 2026-11-10. */
  it('tells each line when its voucher was entered, and no invoice number', async () => {
    const entered = new Map([
      [first.id, new Date('2026-09-01T04:00:00.000Z')],
      [second.id, new Date('2026-09-02T09:30:00.000Z')],
    ]);
    for (const [id, at] of entered) {
      await db.Vouchers.update({ createdOn: at }, { where: { id }, hooks: false });
    }
    const res = await ledger();
    expect(res.body.result.map((r) => [r['Voucher.voucher_Id'], new Date(r['Voucher.createdOn']).toISOString()])).toEqual([
      [first.voucher_Id, entered.get(first.id).toISOString()],
      [second.voucher_Id, entered.get(second.id).toISOString()],
    ]);
    expect(res.body.result.some((r) => 'invoiceNo' in r)).toBe(false);
  });
});

const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* THE SEARCH BOX on the Payments & Receipts list - functions/payRecSearch
 * (the user, 2026-11-06). Through the real route, on real Postgres: a cheque
 * number, an amount and a date as the list prints it each find the receipt;
 * a date was read month first and matched to the instant, so none ever did. */
describe('searching the Payments & Receipts list', () => {
  const stamp = Date.now();
  // 10:00 UTC is 15:00 in the office - 15-09-2026 on the list.
  const DATE = '2026-09-15T10:00:00.000Z';
  const CHEQUE = `CHQ${stamp}`;
  let authHeader; let employeeId; let fiscalYear; let company; let party; let partyAccount; let bank;
  const voucherIds = [];

  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYear.id));
  const search = async (text) => {
    const res = await auth(request(app).get('/voucher/getAllJobPayRecVouchers'))
      .query({ companyid: company.id, page: 1, limit: 50, search: text });
    expect(res.body.status).toBe('success');
    return res.body.result.map((v) => v.id);
  };

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Search Co ${stamp}`, short: 'TSR' });
    partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}SEARCH PARTY ${stamp}`, subCategory: 'Customer' });
    bank = await db.Child_Account.create({ title: `${TEST_PREFIX}SEARCH BANK ${stamp}`, subCategory: 'Bank' });
    party = await db.Clients.create({ name: `${TEST_PREFIX}SEARCH PARTY ${stamp}` });
    await db.Client_Associations.create({ ClientId: party.id, ChildAccountId: partyAccount.id });

    const amount = 98765.43;
    const res = await auth(request(app).post('/voucher/makeTransaction')).send({
      invoices: [], edit: false, advance: true, payType: 'Recievable', transactionMode: 'Bank', subType: 'Cheque',
      checkNo: CHEQUE, checkDate: DATE, partyId: party.id, partyName: party.name, partyType: 'client', type: 'client',
      gainLoss: 0, totalReceiving: amount, companyId: company.id, currency: 'PKR', exRate: 1,
      fiscalYearId: fiscalYear.id, narration: '', tranDate: DATE, employeeId,
      transactions: [
        { accountName: 'party', accountType: 'partyAccount', onParty: true, partyId: party.id, currency: 'PKR', type: 'credit', credit: amount, debit: 0 },
        { accountName: 'bank', accountType: 'payAccount', partyId: bank.id, currency: 'PKR', type: 'debit', debit: amount, credit: 0 },
      ],
    });
    expect(res.body.status).toBe('success');
    voucherIds.push(res.body.result.id);
  });

  afterAll(async () => {
    await db.Voucher_Heads.destroy({ where: { VoucherId: voucherIds } });
    await db.Vouchers.destroy({ where: { id: voucherIds }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { ClientId: party.id } });
    await db.Clients.destroy({ where: { id: party.id } });
    await db.Child_Account.destroy({ where: { id: [partyAccount.id, bank.id] } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('by its cheque number', async () => {
    expect(await search(CHEQUE)).toEqual([voucherIds[0]]);
  });

  it('by its amount, with or without commas', async () => {
    expect(await search('98765.43')).toContain(voucherIds[0]);
    expect(await search('98,765.43')).toContain(voucherIds[0]);
  });

  it('by its date as the list prints it - and not by the day after', async () => {
    expect(await search('15-09-2026')).toContain(voucherIds[0]);
    expect(await search('2026-09-15')).toContain(voucherIds[0]);
    expect(await search('16-09-2026')).not.toContain(voucherIds[0]);
  });

  it('by the party name, as before; something that matches nothing finds nothing', async () => {
    expect(await search(`SEARCH PARTY ${stamp}`)).toEqual([voucherIds[0]]);
    expect(await search(`nothing-${stamp}`)).toEqual([]);
  });

  /* ONE VOUCHER BY ITS ID, in the list's shape - what the screen opens from
   * the Ledger, whatever page of the list it would be on (2026-11-20). Its own
   * company, whichever is picked. */
  it('by its id, from any company picked, in the list shape', async () => {
    const res = await auth(request(app).get('/voucher/getAllJobPayRecVouchers'))
      .query({ id: voucherIds[0], companyid: 999999, page: 1, limit: 1 });
    expect(res.body.result.map((v) => v.id)).toEqual([voucherIds[0]]);
    expect(res.body.result[0]).toHaveProperty('invoice');
    expect(res.body.result[0]).toHaveProperty('Invoice_Transactions');
    expect(res.body.result[0]).toHaveProperty('createdBy');
  });
});

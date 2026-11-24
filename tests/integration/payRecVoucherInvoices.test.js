const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* PAYMENTS & RECEIPTS LIST - each voucher shows ITS OWN invoices.
 * Matched by substring, a receipt settling invoice 9000123 ("9000123,") also
 * listed invoice 900012 - another party's - when both were on the page. */
describe('the invoices listed under each payment or receipt', () => {
  const stamp = Date.now();
  // Ids picked so one is a substring of the other, and far above the sequence.
  const SHORT = 900012; const LONG = 9000123;
  let authHeader; let company; const made = { invoices: [], vouchers: [] };

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    company = await db.Company.create({ title: `${TEST_PREFIX}PayRec Co ${stamp}`, short: 'TPR' });
    for (const [id, name] of [[SHORT, 'PARTY A'], [LONG, 'PARTY B']]) {
      await db.Invoice.destroy({ where: { id }, fiscalYearCheck: false });
      made.invoices.push(await db.Invoice.create({
        id, invoice_No: `${TEST_PREFIX}JI-${id}`, type: 'Job Invoice', payType: 'Recievable', party_Name: name,
        total: '1000', recieved: '1000', paid: '0', approved: '1', companyId: String(company.id), currency: 'PKR',
      }, { fiscalYearCheck: false }));
      made.vouchers.push(await db.Vouchers.create({
        voucher_No: made.vouchers.length + 1, voucher_Id: `${TEST_PREFIX}BRV-${id}`, type: 'Job Reciept', vType: 'BRV',
        CompanyId: company.id, partyName: name, invoices: `${id},`, currency: 'PKR',
      }, { fiscalYearCheck: false }));
    }
  });

  afterAll(async () => {
    await db.Vouchers.destroy({ where: { id: made.vouchers.map((v) => v.id) }, fiscalYearCheck: false });
    await db.Invoice.destroy({ where: { id: made.invoices.map((i) => i.id) }, fiscalYearCheck: false });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('lists each receipt\'s own invoice and nobody else\'s', async () => {
    const res = await request(app).get('/voucher/getAllJobPayRecVouchers')
      .set('Authorization', authHeader).query({ companyid: String(company.id), page: 1, limit: 50 });
    expect(res.body.status).toBe('success');
    const listed = Object.fromEntries(res.body.result.map((v) => [v.partyName, v.invoice.map((i) => i.id)]));
    expect(listed).toEqual({ 'PARTY A': [SHORT], 'PARTY B': [LONG] });
  });
});

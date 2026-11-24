/**
 * AN INVOICE A SEARCH NAMES, NOT ON THE LIST IT WAS SEARCHED IN, SAYS WHERE IT
 * IS (2026-11-16). SNS-AI-620/26 - an agent bill paid in full on 23 October by
 * SNS-ADJ-P-31/27 - showed on its job, and was "not found" on three screens:
 *
 *   Invoices / Bills     searched under Agent Invoice (Climax numbered agent
 *                        bills "AI" too); now the search also counts what it
 *                        finds under the other three lists.
 *   P&R, a payment       a search of the party's OUTSTANDING invoices; now one
 *                        that finds nothing says why the number is not there.
 *   P&R, the list        searched for vouchers, never by the invoices they
 *                        settled; now it is.
 *
 * Through the real routes, on real Postgres.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('a searched invoice that is not on the list says where it is', () => {
  const stamp = Date.now();
  const NO = `${TEST_PREFIX}AI-${stamp}/26`;
  let admin; let company; let client; let account; let bill; let voucher;

  beforeAll(async () => {
    admin = await loginAs('admin');
    company = await db.Company.create({ title: `${TEST_PREFIX}NotListed Co ${stamp}`, short: 'TNL' });
    client = await db.Clients.create({ name: `${TEST_PREFIX}RATHMANN ${stamp}` });
    account = await db.Child_Account.create({ title: `${TEST_PREFIX}RATHMANN ${stamp}`, subCategory: 'Vendor' });
    await db.Client_Associations.create({ ClientId: client.id, ChildAccountId: account.id });
    bill = await db.Invoice.create({
      invoice_No: NO, type: 'Agent Bill', payType: 'Payble', operation: 'AE', status: '1', approved: '1',
      roundOff: '0', currency: 'USD', ex_rate: '278.77', party_Id: String(account.id), party_Name: client.name,
      partyType: 'agent', paid: '496.49', recieved: '0', total: '496.49', companyId: String(company.id),
    }, { fiscalYearCheck: false });
    voucher = await db.Vouchers.create({
      voucher_No: 31, voucher_Id: `${TEST_PREFIX}ADJ-P-${stamp}`, type: 'Job Payment', vType: 'ADJ-P',
      currency: 'USD', exRate: '278.57', CompanyId: company.id, partyId: String(client.id), partyName: client.name,
      partyType: 'agent', invoices: `${bill.id},`,
    }, { fiscalYearCheck: false });
    await db.Invoice_Transactions.create({ InvoiceId: bill.id, VoucherId: voucher.id, amount: '496.49', gainLoss: '0' });
  });

  afterAll(async () => {
    await db.Invoice_Transactions.destroy({ where: { InvoiceId: bill.id } });
    await db.Vouchers.destroy({ where: { id: voucher.id }, fiscalYearCheck: false });
    await db.Invoice.destroy({ where: { id: bill.id }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { ClientId: client.id } });
    await db.Clients.destroy({ where: { id: client.id } });
    await db.Child_Account.destroy({ where: { id: account.id } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  describe('Invoices / Bills', () => {
    const list = (type, search) => request(app).get('/invoice/getFilteredInvoices')
      .query({ page: 1, limit: 20, ...(search ? { search } : {}) })
      .set('Authorization', admin.authHeader).set('companyid', String(company.id)).set('type', type);

    it('searched under Agent Invoice: none there, one under Agent Bill', async () => {
      const res = await list('Agent Invoice', NO);
      expect(res.status).toBe(200);
      expect(res.body.result).toEqual([]);
      expect(res.body.elsewhere).toEqual({ 'Agent Bill': 1 });
    });

    it('under Agent Bill it is listed, and is nowhere else', async () => {
      const res = await list('Agent Bill', NO);
      expect(res.body.result.map((r) => r.invoice_No)).toEqual([NO]);
      expect(res.body.elsewhere).toEqual({});
    });

    it('no search: nothing is counted elsewhere', async () => {
      const res = await list('Agent Invoice');
      expect(res.body.elsewhere).toEqual({});
    });
  });

  describe('Payments & Receipts - a payment to the party', () => {
    const search = (text, currency = 'USD', pay = 'Payble') => request(app).get('/invoice/getAllInvoicesByPartyId')
      .query({ search: text })
      .set('Authorization', admin.authHeader)
      .set('id', String(client.id)).set('companyid', String(company.id)).set('invoicecurrency', currency)
      .set('pay', pay).set('outstanding', 'true').set('page', '1').set('limit', '50');

    it('paid in full: not listed, and says so, with the voucher that paid it', async () => {
      const res = await search(NO);
      expect(res.body.status).toBe('success');
      expect(res.body.result).toEqual([]);
      expect(res.body.notListed).toEqual([expect.objectContaining({
        invoice_No: NO, reason: 'settled', settledBy: [voucher.voucher_Id], currency: 'USD',
      })]);
    });

    it('on a PKR payment the currency is the reason', async () => {
      const res = await search(NO, 'PKR');
      expect(res.body.notListed.map((x) => x.reason)).toEqual(['otherCurrency']);
    });

    it('a number that is no invoice: nothing to explain', async () => {
      const res = await search(`${TEST_PREFIX}NOPE-${stamp}`);
      expect(res.body.notListed).toEqual([]);
    });
  });

  describe('Payments & Receipts - the list', () => {
    it('finds the payment by the invoice it settled', async () => {
      const res = await request(app).get('/voucher/getAllJobPayRecVouchers')
        .set('Authorization', admin.authHeader)
        .query({ companyid: company.id, page: 1, limit: 50, search: NO });
      expect(res.body.status).toBe('success');
      expect(res.body.result.map((v) => v.id)).toEqual([voucher.id]);
    });
  });
});

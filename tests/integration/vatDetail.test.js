const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* THE VAT DETAIL, FROM THE DATABASE - routes/misc/vatDetail.
 *
 * The arithmetic is pinned in tests/unit/vatDetail; this is the reading of
 * it: the period is the INVOICE's date (in Karachi), only approved invoices,
 * the buyer is the party on the charge lines, the HS code is the customs job's
 * commodity's, and one company's numbers only. */
describe('the VAT Detail', () => {
  const stamp = Date.now();
  const SEQ = 90000000 + (stamp % 1000000);
  let authHeader; let company; let otherCompany; let buyer; let commodity; let job;
  const made = { invoices: [], numbers: [] };

  const document = async ({ when, approved = '1', companyId = company.id, seq, jobId = job.id, rate = 1750 }) => {
    const invoice = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}VAT-${stamp}-${seq}`, type: 'Job Invoice', payType: 'Recievable',
      approved, status: '1', operation: 'CC', currency: 'PKR', ex_rate: '1', total: String(rate * 1.15),
      party_Name: 'Billed As Typed', companyId: String(companyId), createdAt: new Date(when), updatedAt: new Date(when),
    }, { fiscalYearCheck: false, silent: true });
    made.invoices.push(invoice.id);
    await db.Charge_Head.create({
      InvoiceId: invoice.id, CustomsJobId: jobId, type: 'Recievable', partyId: String(buyer.id),
      charge: '1', particular: 'SERVICES CHARGES', qty: '1', rate_charge: String(rate), discount: '0',
      ex_rate: '1', tax_apply: true, taxPerc: '15', tax_amount: String(rate * 0.15),
      net_amount: String(rate), local_amount: String(rate * 1.15), currency: 'PKR', status: '1',
    });
    // An untaxed line on the same invoice - not on the return.
    await db.Charge_Head.create({
      InvoiceId: invoice.id, CustomsJobId: jobId, type: 'Recievable', partyId: String(buyer.id),
      charge: '2', particular: 'WHARFAGE', qty: '1', rate_charge: '9000', discount: '0', ex_rate: '1',
      tax_apply: false, tax_amount: '0', net_amount: '9000', local_amount: '9000', currency: 'PKR', status: '1',
    });
    const number = await db.Sales_Tax_Invoice.create({
      taxInvoiceNo: `${TEST_PREFIX}CL-${SEQ + seq}`, seq: SEQ + seq, CompanyId: companyId, InvoiceId: invoice.id,
    });
    made.numbers.push(number.id);
    return number.taxInvoiceNo;
  };

  let inside; let lastMinute; let unapproved; let nextDay; let otherCompanys;

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    company = await db.Company.create({ title: `${TEST_PREFIX}VAT Co ${stamp}`, short: 'TVA' });
    otherCompany = await db.Company.create({ title: `${TEST_PREFIX}VAT Other ${stamp}`, short: 'TVB' });
    buyer = await db.Clients.create({ name: `${TEST_PREFIX}VAT BUYER ${stamp}`, code: `${TEST_PREFIX}VB${stamp % 100000}`, ntn: '0704059-8', city: 'KARACHI,PAKISTAN' });
    commodity = await db.Commodity.create({ name: `${TEST_PREFIX}COTTON YARN ${stamp}`, hs: '520512' });
    job = await db.Customs_Job.create({ jobNo: `${TEST_PREFIX}TP-${stamp}`, companyId: String(company.id), CommodityId: commodity.id }, { fiscalYearCheck: false });

    inside = await document({ when: '2026-09-18T07:00:00.000Z', seq: 1 });
    // 23:30 on 30 September in Karachi - in; 00:10 on 1 October - out.
    lastMinute = await document({ when: '2026-09-30T18:30:00.000Z', seq: 2, rate: 2500 });
    nextDay = await document({ when: '2026-09-30T19:10:00.000Z', seq: 3 });
    unapproved = await document({ when: '2026-09-20T07:00:00.000Z', seq: 4, approved: '0' });
    otherCompanys = await document({ when: '2026-09-21T07:00:00.000Z', seq: 5, companyId: otherCompany.id });
  });

  afterAll(async () => {
    await db.Sales_Tax_Invoice.destroy({ where: { id: made.numbers } });
    await db.Charge_Head.destroy({ where: { InvoiceId: made.invoices } });
    await db.Invoice.destroy({ where: { id: made.invoices }, fiscalYearCheck: false });
    await db.Customs_Job.destroy({ where: { id: job.id }, fiscalYearCheck: false });
    await db.Commodity.destroy({ where: { id: commodity.id } });
    await db.Clients.destroy({ where: { id: buyer.id } });
    await db.Company.destroy({ where: { id: [company.id, otherCompany.id] } });
  });

  const report = (headers = {}) => request(app).get('/misc/vatDetail')
    .set('Authorization', authHeader)
    .set({ from: '2026-09-01', to: '2026-09-30', utcoffset: '300', company: String(company.id), ...headers });

  it('lists the approved Sale Tax Invoices dated in the period - Karachi days', async () => {
    const res = await report();
    expect(res.status).toBe(200);
    expect(res.body.result.rows.map((r) => r.documentNo)).toEqual([inside, lastMinute]);
    expect(res.body.result.rows.map((r) => r.documentNo)).not.toContain(unapproved);
    expect(res.body.result.rows.map((r) => r.documentNo)).not.toContain(nextDay);
    expect(res.body.result.rows.map((r) => r.documentNo)).not.toContain(otherCompanys);
  });

  it('names the buyer on the lines, with its NTN and district; the commodity\'s HS code', async () => {
    const [row] = (await report()).body.result.rows;
    expect(row).toMatchObject({
      sr: 1, ntn: '0704059-8', buyer: buyer.name, district: 'KARACHI,PAKISTAN',
      documentType: 'SI', date: '2026-09-18', hsCode: '520512', saleType: 'Services',
      rate: 15, value: 1750, tax: 263, withheld: 0,
    });
  });

  it('totals what it lists', async () => {
    expect((await report()).body.result.totals).toEqual({ value: 4250, tax: 638, withheld: 0 });
  });

  it('refuses a period it cannot read, or one that runs backwards', async () => {
    expect((await report({ from: '' })).status).toBe(400);
    expect((await report({ from: '2026-10-01' })).status).toBe(400);
  });
});

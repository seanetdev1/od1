const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const db = require('../../models');

/* The invoice print's Adjustment: what ADJ-R / ADJ-P vouchers settled on it,
 * apart from what receipts did - see functions/invoiceAdjustment. Sent with
 * the invoice the print loads (getInvoiceById, as the page, the bulk print and
 * the emailed PDF do). */
describe('an invoice\'s adjustment, for its print', () => {
  const stamp = Date.now();
  const made = { vouchers: [] };
  let admin; let fiscalYear; let company; let invoice; let plain;

  const voucher = async (vType, amount, inv = invoice) => {
    const v = await db.Vouchers.create({
      voucher_No: 1, voucher_Id: `${TEST_PREFIX}${vType}-${stamp}-${made.vouchers.length}`,
      type: 'Job Reciept', vType, CompanyId: company.id, FiscalYearId: fiscalYear.id,
    }, { fiscalYearCheck: false });
    made.vouchers.push(v);
    await db.Invoice_Transactions.create({ gainLoss: '0', amount: String(amount), InvoiceId: inv.id, VoucherId: v.id });
    return v;
  };
  const printed = async (inv) => (await request(app).get('/invoice/getInvoiceById')
    .set('Authorization', admin.authHeader).set('invoiceid', String(inv.id))).body.result.resultOne;

  beforeAll(async () => {
    admin = await loginAs('admin');
    fiscalYear = await anyFiscalYear();
    company = await db.Company.create({ title: `${TEST_PREFIX}Adjustment Co ${stamp}`, short: 'TAD' });
    const make = (n) => db.Invoice.create({
      invoice_No: `${TEST_PREFIX}ADJ-${stamp}-${n}/27`, type: 'Job Invoice', payType: 'Recievable', currency: 'PKR',
      total: '65470', recieved: '66470', paid: '0', approved: '1', roundOff: '0', companyId: String(company.id),
    }, { fiscalYearCheck: false });
    invoice = await make(1);
    plain = await make(2);
    await voucher('BRV', 65250);
    await voucher('ADJ-R', 1000);
    await voucher('ADJ-R', 220);
    await voucher('CRV', 500, plain);
  });

  afterAll(async () => {
    await db.Invoice_Transactions.destroy({ where: { VoucherId: made.vouchers.map((v) => v.id) } });
    await db.Vouchers.destroy({ where: { id: made.vouchers.map((v) => v.id) }, fiscalYearCheck: false });
    await db.Invoice.destroy({ where: { id: [invoice.id, plain.id] }, fiscalYearCheck: false });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('is what the adjustment vouchers settled - not the receipts', async () => {
    expect((await printed(invoice)).adjustment).toBe(1220);
  });

  it('is 0 on an invoice settled by receipts alone', async () => {
    expect((await printed(plain)).adjustment).toBe(0);
  });
});

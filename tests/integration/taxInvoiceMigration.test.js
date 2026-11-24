const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { assignTaxInvoiceNo } = require('../../functions/salesTaxInvoice');

// Legacy GST invoice numbers onto migrated client invoices -
// routes/taxInvoiceMigration and functions/taxInvoiceMigrationPlan.
describe('GST invoice number migration', () => {
  let admin, company;
  const invoices = [];
  const BASE = 942000;
  const CODE = 'TGM';

  const seedInvoice = async (legacyId, extra = {}) => {
    const inv = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}GSTM-${Date.now()}-${invoices.length}`, payType: 'Recievable',
      total: '2875', recieved: '0', paid: '0', approved: '1', companyId: company.id,
      climaxId: legacyId, ...extra,
    }, { fiscalYearCheck: false });
    invoices.push(inv);
    return inv;
  };
  const apply = (rows) => request(app).post('/taxInvoiceMigration/apply')
    .set('Authorization', admin.authHeader).send({ rows });

  beforeAll(async () => {
    admin = await loginAs('admin');
    // The first build of this table made (CompanyId, seq) unique for every
    // row; the model now limits that to numbers Odyssey issues. A database
    // created from the first build keeps the old index, so drop it here.
    await db.sequelize.query('DROP INDEX IF EXISTS "sales_tax_invoices_company_seq_unique"');
    company = await db.Company.create({ title: `${TEST_PREFIX}GSTM Co ${Date.now()}`, short: CODE });
  });

  afterAll(async () => {
    await db.Sales_Tax_Invoice.destroy({ where: { InvoiceId: invoices.map((i) => i.id) } });
    await db.Invoice.destroy({ where: { id: invoices.map((i) => i.id) }, fiscalYearCheck: false });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('attaches each legacy number to its client invoice - duplicates as issued - and runs again safely', async () => {
    const a = await seedInvoice(BASE + 1);
    const b = await seedInvoice(BASE + 2);
    // A vendor bill with the same legacy id counts in another table's ids.
    await seedInvoice(BASE + 1, { payType: 'Payble', type: 'Job Bill' });
    const rows = [
      { Id: BASE + 10, JobInvoiceId: BASE + 1, TaxInvoiceNo: 'CL-001' },
      { Id: BASE + 11, JobInvoiceId: BASE + 2, TaxInvoiceNo: 'CL-001' }, // the legacy system's duplicate
      { Id: BASE + 12, JobInvoiceId: BASE + 99, TaxInvoiceNo: 'CL-5' },   // no such invoice
    ];
    const res = await apply(rows);
    expect(res.body.result).toMatchObject({ created: 2, problems: { invoiceNotFound: { count: 1 } } });
    expect((await db.Sales_Tax_Invoice.findOne({ where: { InvoiceId: a.id } })).taxInvoiceNo).toBe('CL-001');
    expect((await db.Sales_Tax_Invoice.findOne({ where: { InvoiceId: b.id } })).seq).toBe(1);

    const again = await apply(rows);
    expect(again.body.result).toMatchObject({ created: 0, problems: { alreadyNumbered: 2 } });
  });

  it('a legacy invoice imported twice is not guessed at', async () => {
    await seedInvoice(BASE + 3);
    await seedInvoice(BASE + 3);
    const res = await apply([{ Id: BASE + 13, JobInvoiceId: BASE + 3, TaxInvoiceNo: 'CL-77' }]);
    expect(res.body.result).toMatchObject({ created: 0, problems: { ambiguous: { count: 1 } } });
  });

  it('the next number Odyssey issues follows the last migrated one', async () => {
    const old = await seedInvoice(BASE + 4);
    await apply([{ Id: BASE + 14, JobInvoiceId: BASE + 4, TaxInvoiceNo: 'CL-24295' }]);
    const fresh = await seedInvoice(null, { approved: '0' });
    const no = await db.sequelize.transaction((t) => assignTaxInvoiceNo({
      db, invoice: fresh.dataValues, charges: [{ type: 'Recievable', tax_apply: true, tax_amount: '375' }],
      companyCode: CODE, transaction: t,
    }));
    expect(no).toBe(`${CODE}-24296`);
    expect(old.id).toBeTruthy();
  });
});

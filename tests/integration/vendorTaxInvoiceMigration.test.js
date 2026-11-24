const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

// Legacy vendor tax invoice numbers onto migrated vendor bills -
// routes/vendorTaxInvoiceMigration and functions/vendorTaxInvoiceMigrationPlan.
describe('vendor tax invoice number migration', () => {
  let admin, company;
  const invoices = [];
  const BASE = 943000;

  const seedBill = async (legacyId, invoiceNo, extra = {}) => {
    const inv = await db.Invoice.create({
      invoice_No: invoiceNo, payType: 'Payble', type: 'Job Bill',
      total: '3000', recieved: '0', paid: '0', approved: '1', companyId: company.id,
      climaxId: legacyId, ...extra,
    }, { fiscalYearCheck: false });
    invoices.push(inv);
    return inv;
  };
  const post = (path, rows) => request(app).post(`/vendorTaxInvoiceMigration/${path}`)
    .set('Authorization', admin.authHeader).send({ rows });
  const numberOf = async (inv) => (await db.Invoice.findByPk(inv.id)).vendorTaxInvoiceNo;

  beforeAll(async () => {
    admin = await loginAs('admin');
    company = await db.Company.create({ title: `${TEST_PREFIX}VTIM Co ${Date.now()}`, short: 'TVM' });
  });

  afterAll(async () => {
    await db.Invoice.destroy({ where: { id: invoices.map((i) => i.id) }, fiscalYearCheck: false });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('puts each number on its bill, keeps one typed by hand, and runs again safely', async () => {
    const stamp = Date.now();
    const a = await seedBill(BASE + 1, `${TEST_PREFIX}JB-1-${stamp}`);
    const typed = await seedBill(BASE + 2, `${TEST_PREFIX}JB-2-${stamp}`, { vendorTaxInvoiceNo: 'BY-HAND' });
    // A client invoice with the same legacy id counts in another table's ids.
    const client = await seedBill(BASE + 1, `${TEST_PREFIX}JI-1-${stamp}`, { payType: 'Recievable', type: 'Job Invoice' });
    const rows = [
      { Id: BASE + 1, TranNumber: a.invoice_No, VendorTaxInvoiceNo: 'QITE0003124223' },
      { Id: BASE + 2, TranNumber: typed.invoice_No, VendorTaxInvoiceNo: 'IN260129732' },
      { Id: BASE + 99, TranNumber: 'JB-NONE', VendorTaxInvoiceNo: 'IN-0' },
    ];

    const plan = await post('plan', rows);
    expect(plan.body.result).toMatchObject({ toUpdate: 1, updated: 0 });
    expect(await numberOf(a)).toBeNull();

    const res = await post('apply', rows);
    expect(res.body.result).toMatchObject({
      updated: 1, problems: { billNotFound: { count: 1 }, different: { count: 1 } },
    });
    expect(await numberOf(a)).toBe('QITE0003124223');
    expect(await numberOf(typed)).toBe('BY-HAND');
    expect(await numberOf(client)).toBeNull();

    const again = await post('apply', rows);
    expect(again.body.result).toMatchObject({ updated: 0, problems: { alreadySet: 1 } });

    const verify = await request(app).get('/vendorTaxInvoiceMigration/verify').set('Authorization', admin.authHeader);
    expect(verify.body.result.withNumber).toBeGreaterThanOrEqual(2);
  });

  it('refuses a request without rows, and an oversized batch', async () => {
    expect((await request(app).post('/vendorTaxInvoiceMigration/apply').set('Authorization', admin.authHeader).send({})).status).toBe(400);
    const big = Array.from({ length: 5001 }, (_, i) => ({ Id: i, TranNumber: 'x', VendorTaxInvoiceNo: 'y' }));
    expect((await post('apply', big)).status).toBe(413);
  });
});

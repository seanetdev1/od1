const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* Raising a bill from a freight job's charges - /invoice/makeInvoiceNew.
 *
 * Found on SNS (AE job 14216): payables Climax had never billed would not bill
 * here. They came across with no invoiceType - the document the server sorts
 * lines onto - and no partyType. And the numbering step deleted the year's last
 * bill whenever it had no lines, meant for a half-raised one of our own but
 * equally true of a migrated bill Climax had emptied. */
describe('raising a bill from freight charges', () => {
  const stamp = Date.now();
  const made = { clients: [], accounts: [], links: [], invoices: [] };
  let authHeader; let employeeId; let fiscalYear; let company; let job;
  let vendor; let vendorAccount; let orphan;

  const auth = (req) => req
    .set('Authorization', authHeader)
    .set('x-fiscal-year-id', String(fiscalYear.id));

  const line = (over = {}) => db.Charge_Head.create({
    charge: `${TEST_PREFIX}Handling`, particular: 'HANDLING', type: 'Payble',
    partyId: vendor.id, name: vendor.name, qty: 1, rate_charge: '500', amount: '1',
    net_amount: '500', local_amount: '500', ex_rate: '1', currency: 'PKR',
    status: '1', pp_cc: 'PP', size_type: '', SEJobId: job.id, climaxId: null, ...over,
  });

  const raise = (charges) => auth(request(app).post('/invoice/makeInvoiceNew')).send({
    chargeList: charges.map((c) => c.get({ plain: true })),
    companyId: company.id, fiscalYearId: fiscalYear.id, type: 'AE', employeeId,
    shipDate: '2026-09-01',
  });

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
      made.fiscalYear = fiscalYear;
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Bill Co ${stamp}`, short: `TB${String(stamp).slice(-4)}` });
    job = await db.SE_Job.create({
      jobNo: `${TEST_PREFIX}AEJ-${stamp}`, operation: 'AE', companyId: String(company.id),
      FiscalYearId: fiscalYear.id,
    }, { fiscalYearCheck: false });

    vendorAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}VENDOR ${stamp}`, subCategory: 'Vendor' });
    made.accounts.push(vendorAccount);
    vendor = await db.Clients.create({ name: `${TEST_PREFIX}VENDOR ${stamp}`, types: 'Local Vendor' });
    orphan = await db.Clients.create({ name: `${TEST_PREFIX}NO ACCOUNT ${stamp}`, types: 'Local Vendor' });
    made.clients.push(vendor, orphan);
    made.links.push(await db.Client_Associations.create({ ClientId: vendor.id, ChildAccountId: vendorAccount.id }));

    // The year's last bill: MIGRATED, and empty - Climax had emptied it.
    made.migratedBill = await db.Invoice.create({
      invoice_No: `${company.short}-JB-5/${fiscalYear.suffix}`, invoice_Id: 5, type: 'Job Bill',
      payType: 'Payble', status: '1', approved: '1', companyId: String(company.id),
      climaxId: String(9000000 + (stamp % 100000)), FiscalYearId: fiscalYear.id,
    }, { fiscalYearCheck: false });
    made.invoices.push(made.migratedBill);
  });

  afterAll(async () => {
    const all = await db.Invoice.findAll({ where: { companyId: String(company.id) }, attributes: ['id'] });
    const ids = all.map((i) => i.id);
    await db.Charge_Head.destroy({ where: { SEJobId: job.id } });
    if (ids.length) await db.Invoice.destroy({ where: { id: ids }, fiscalYearCheck: false });
    await db.SE_Job.destroy({ where: { id: job.id }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { id: made.links.map((l) => l.id) } });
    await db.Clients.destroy({ where: { id: made.clients.map((c) => c.id) } });
    await db.Child_Account.destroy({ where: { id: made.accounts.map((a) => a.id) } });
    await db.History.destroy({ where: { EmployeeId: employeeId } });
    await db.Company.destroy({ where: { id: company.id } });
    if (made.fiscalYear) await made.fiscalYear.destroy();
  });

  it('bills a payable that came across with no document type, after the migrated bill, which it keeps', async () => {
    const c = await line({ invoiceType: null, partyType: null });
    const res = await raise([c]);

    expect(res.status).toBe(200);
    const bill = res.body.result.newInv;
    expect(bill.type).toBe('Job Bill');
    expect(bill.invoice_Id).toBe(6);
    expect(String(bill.party_Id)).toBe(String(vendorAccount.id));

    // Not deleted to free its number - it is a document Climax issued.
    expect(await db.Invoice.findByPk(made.migratedBill.id)).not.toBeNull();
    await c.reload();
    expect(c.InvoiceId).toBe(bill.id);
  });

  it('refuses a charge that is already on an invoice, and leaves it where it is', async () => {
    const c = await line({ invoiceType: 'Job Bill', partyType: 'vendor' });
    const first = await raise([c]);
    expect(first.status).toBe(200);
    const bill = first.body.result.newInv;
    const before = await db.Invoice.count({ where: { companyId: String(company.id) } });

    // A stale copy of the sheet, from before that bill was raised: the line
    // still looks unbilled. The server reads the database, not this.
    const stale = { ...c.get({ plain: true }), InvoiceId: null, invoice_id: null };
    const res = await auth(request(app).post('/invoice/makeInvoiceNew')).send({
      chargeList: [stale], companyId: company.id, fiscalYearId: fiscalYear.id, type: 'AE', employeeId,
      shipDate: '2026-09-01',
    });

    expect(res.status).toBe(409);
    expect(res.body.result).toMatch(/already invoiced/);
    expect(res.body.result).toContain(bill.invoice_No);
    await c.reload();
    expect(c.InvoiceId).toBe(bill.id);                       // not moved
    expect(await db.Invoice.count({ where: { companyId: String(company.id) } })).toBe(before); // nothing new
  });

  it('refuses a party with no ledger account, and says which', async () => {
    const c = await line({ partyId: orphan.id, name: orphan.name, invoiceType: 'Job Bill', partyType: 'vendor' });
    const res = await raise([c]);

    expect(res.status).toBe(500);
    expect(res.body.result).toMatch(/NO ACCOUNT .* has no ledger account/);
  });
});

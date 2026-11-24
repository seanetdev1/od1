const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const db = require('../../models');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');

/* WHO GENERATED IT - on the Invoice/Bills list and invoice page, the customs
 * job list and job page, and the freight job page. Invoices and customs jobs
 * have no creator column; the first History 'Create' row names them. */
describe('who created an invoice or a job', () => {
  const stamp = Date.now();
  let admin; let fiscalYear; let company; let invoice; let customsJob; let seJob;

  const auth = (req) => req.set('Authorization', admin.authHeader).set('x-fiscal-year-id', String(fiscalYear.id));

  beforeAll(async () => {
    admin = await loginAs('admin');
    fiscalYear = await anyFiscalYear();
    company = await db.Company.create({ title: `${TEST_PREFIX}Creator Co ${stamp}`, short: 'TCC' });
    invoice = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}JI-${stamp}`.toUpperCase(), type: 'Job Invoice', payType: 'Recievable', companyId: String(company.id),
      total: '100', approved: '0',
    }, { fiscalYearCheck: false });
    await db.History.create({ formName: 'Invoice', type: 'Create', docNo: invoice.invoice_No, EmployeeId: admin.employee.id });
    // A later edit by someone else does not make them the creator.
    const other = await loginAs('employee');
    await db.History.create({ formName: 'Invoice', type: 'Edit', docNo: invoice.invoice_No, EmployeeId: other.employee.id });

    customsJob = (await auth(request(app).post('/customsJob/create')).send({
      employeeId: admin.employee.id,
      data: { companyId: String(company.id), fiscalYearId: fiscalYear.id, gdNumber: `${TEST_PREFIX}GD-${stamp}`, direction: 'Import' },
    })).body.result;
    seJob = await db.SE_Job.create({
      jobNo: `${TEST_PREFIX}SEJ-${stamp}`, operation: 'SE', companyId: String(company.id), createdById: admin.employee.id,
      FiscalYearId: fiscalYear.id,
    }, { fiscalYearCheck: false });
    await new Promise((r) => setTimeout(r, 300)); // createHistory is not awaited by the route
  });

  afterAll(async () => {
    await db.Invoice.destroy({ where: { id: invoice.id }, fiscalYearCheck: false });
    if (customsJob?.id) await Customs_Job.destroy({ where: { id: customsJob.id }, fiscalYearCheck: false });
    await db.SE_Job.destroy({ where: { id: seJob.id }, fiscalYearCheck: false });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('the Invoice/Bills list and the invoice page name who generated it', async () => {
    const list = await auth(request(app).get('/invoice/getFilteredInvoices')).set('companyid', String(company.id)).set('type', 'Job Invoice');
    expect(list.body.result.find((r) => r.id === invoice.id).createdByName).toBe(admin.employee.name);
    const byNo = await auth(request(app).get('/invoice/getInvoiceByNo')).set('invoiceno', invoice.invoice_No);
    expect(byNo.body.result.resultOne.createdByName).toBe(admin.employee.name);
    // The invoice details page loads by id.
    const page = await auth(request(app).get('/invoice/getInvoiceById')).set('invoiceid', String(invoice.id));
    expect(page.body.result.resultOne.createdByName).toBe(admin.employee.name);
  });

  it('the customs job list and job page name who opened it', async () => {
    const list = await auth(request(app).get('/customsJob/get')).set('companyid', String(company.id));
    expect(list.body.result.find((r) => r.id === customsJob.id).createdByName).toBe(admin.employee.name);
    const page = await auth(request(app).get('/customsJob/getById')).set('id', String(customsJob.id));
    expect(page.body.result.createdByName).toBe(admin.employee.name);
  });

  it('the freight job page names who opened it', async () => {
    const page = await auth(request(app).get('/seaJob/getSEJobById')).set('id', String(seJob.id));
    expect(page.body.result.created_by.name).toBe(admin.employee.name);
  });
});

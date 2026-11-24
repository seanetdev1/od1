/**
 * The Invoices / Bills list names the JOB of a customs or aviation invoice,
 * and finds it by that number (2026-11-15).
 *
 * Those invoices carry no SEJobId - their job is on their charge lines
 * (CustomsJobId, or AviationConsignmentId and its flight) - and the list only
 * read SEJobId, so on a customs install every row's Job No. was blank and a
 * job number searched for nothing. See functions/invoiceJobNumbers.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const { Invoice, Charge_Head } = require('../../models');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');
const { Aviation_Job, Aviation_Consignment } = require('../../functions/Associations/aviationAssociations');

// A company nothing else uses, so these are the only invoices on its list.
const COMPANY = '990098';

describe('GET /invoice/getFilteredInvoices - the job of a customs or aviation invoice', () => {
  let authHeader;
  const stamp = Date.now();
  let customsJob; let customsInvoice; let flight; let consignment; let flightInvoice;

  beforeAll(async () => {
    ({ authHeader } = await loginAs('employee'));
    const fy = await anyFiscalYear();

    customsJob = await Customs_Job.create({ jobNo: `${TEST_PREFIX}CJ-${stamp}`, companyId: COMPANY, transportMode: 'Sea' });
    customsInvoice = await Invoice.create({
      invoice_No: `${TEST_PREFIX}CJINV-${stamp}`, type: 'Job Invoice', payType: 'Recievable', operation: 'CI',
      party_Id: '1', party_Name: `${TEST_PREFIX}Client`, total: '2500', companyId: COMPANY,
    }, { fiscalYearCheck: false });
    await Charge_Head.create({
      charge: `${TEST_PREFIX}Clearing`, type: 'Recievable', amount: '1', net_amount: '2500',
      InvoiceId: customsInvoice.id, CustomsJobId: customsJob.id,
    });

    flight = await Aviation_Job.create({
      companyId: COMPANY, jobId: 90777, jobNo: `${TEST_PREFIX}AVJ-${stamp}`, flightDate: '2026-09-01', FiscalYearId: fy.id,
    });
    consignment = await Aviation_Consignment.create({ AviationJobId: flight.id, awb: `${TEST_PREFIX}${stamp}`, sortOrder: 0 });
    flightInvoice = await Invoice.create({
      invoice_No: `${TEST_PREFIX}AVINV-${stamp}`, type: 'Job Invoice', payType: 'Recievable', operation: 'AE',
      party_Id: '1', party_Name: `${TEST_PREFIX}Agent`, total: '900', companyId: COMPANY,
    }, { fiscalYearCheck: false });
    await Charge_Head.create({
      charge: `${TEST_PREFIX}Freight`, type: 'Recievable', amount: '1', net_amount: '900',
      InvoiceId: flightInvoice.id, AviationConsignmentId: consignment.id,
    });
  });

  afterAll(async () => {
    await Charge_Head.destroy({ where: { InvoiceId: [customsInvoice?.id, flightInvoice?.id].filter(Boolean) } });
    await Invoice.destroy({ where: { companyId: COMPANY }, fiscalYearCheck: false });
    if (consignment) await Aviation_Consignment.destroy({ where: { id: consignment.id } });
    if (flight) await Aviation_Job.destroy({ where: { id: flight.id } });
    if (customsJob) await Customs_Job.destroy({ where: { id: customsJob.id } });
  });

  const list = (query = {}) => request(app)
    .get('/invoice/getFilteredInvoices')
    .query({ page: 1, limit: 20, ...query })
    .set('Authorization', authHeader)
    .set('companyid', COMPANY)
    .set('type', 'Job Invoice');

  it('names the customs job and the flight, from the charge lines', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.result.map((r) => [r.id, r]));
    expect(byId[customsInvoice.id].jobNo).toBe(customsJob.jobNo);
    expect(byId[flightInvoice.id].jobNo).toBe(flight.jobNo);
  });

  it('finds a customs invoice by its job number', async () => {
    const res = await list({ search: customsJob.jobNo });
    expect(res.body.result.map((r) => r.id)).toEqual([customsInvoice.id]);
    expect(res.body.count).toBe(1);
  });

  it('finds an aviation invoice by its flight number', async () => {
    const res = await list({ search: flight.jobNo });
    expect(res.body.result.map((r) => r.id)).toEqual([flightInvoice.id]);
  });

  it('a job number that is no invoice\'s finds nothing', async () => {
    const res = await list({ search: `${TEST_PREFIX}NO-SUCH-JOB-${stamp}` });
    expect(res.body.result).toEqual([]);
  });
});

/**
 * Job Balancing in every operation mode - routes/invoice /jobBalancing.
 *
 * The report is INVOICE-DRIVEN, not job-driven: it enumerates approved
 * invoices and reads its job columns off `Invoice.SE_Job`. Only a freight
 * invoice has one. An aviation invoice's charges hang off an AWB
 * (Charge_Heads.AviationConsignmentId) and a customs invoice's name a goods
 * declaration (Charge_Heads.CustomsJobId), so both arrive with SE_Job null and
 * every job column blank unless something fills them in.
 *
 * Two things do that, and NOTHING PROVED EITHER OF THEM UNTIL NOW. The route
 * calls attachAviationContext and attachCustomsContext - both of which have
 * unit tests, neither of which had a test that the ROUTE calls them - and the
 * screen's job-type filter has to offer 'AV' and 'CC', because the filter is
 * matched against Invoice.operation and ticking any type without them hides
 * the rows entirely.
 *
 * That second one is the failure worth pinning: it does not look like a bug.
 * The report comes back, with rows in it, and the aviation ones are simply
 * absent - which reads as "no invoices that month" rather than as a filter
 * excluding a whole operation.
 *
 * Freight is asserted alongside throughout, because the point is that the
 * other two modes work without it moving.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Op } = require('sequelize');
const db = require('../../models');
const { SE_Job, Delivery_Order } = require('../../functions/Associations/jobAssociations/seaExport');
const {
  Aviation_Job, Aviation_Consignment, Aviation_Carrier,
} = require('../../functions/Associations/aviationAssociations');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');
const { Charge_Head, Invoice } = require('../../functions/Associations/incoiceAssociations');
const { Clients } = require('../../functions/Associations/clientAssociation');
const { FiscalYears, Company } = require('../../models');
const { pkDay } = require('../../functions/pkDay');

describe('Job Balancing across operation modes', () => {
  let authHeader; let companyId; let createdCompanyId; let fiscalYearId;
  let clientId; let carrierId;
  let seJobId; let avJobId; let ccJobId; let consignmentId;
  const invoiceIds = {};

  // The report ranges on Invoice.createdAt, and the fixtures are created now.
  const TODAY = require('moment')().format('YYYY-MM-DD') /* the server's day, not UTC's */;

  const auth = (req) => req.set('Authorization', authHeader);

  const balancing = (over = {}) =>
    auth(request(app).get('/invoice/jobBalancing')).set({
      company: 'all',
      from: TODAY,
      to: TODAY,
      paytype: 'All',
      jobtypes: '',
      ...over,
    });

  /** The row for one of this suite's invoices, or undefined. */
  const rowFor = (res, key) =>
    (res.body.result || []).find((r) => r.id === invoiceIds[key]);

  const makeInvoice = async (key, operation, extra = {}) => {
    const inv = await Invoice.create({
      invoice_No: `${TEST_PREFIX}JB-${key}`,
      type: 'Job Invoice',
      payType: 'Recievable',
      status: '0',
      approved: '1',
      operation,
      currency: 'PKR',
      ex_rate: '1',
      total: '1000',
      paid: '0',
      recieved: '0',
      party_Name: TEST_PREFIX + 'Party',
      companyId,
      ...extra,
    }, { fiscalYearCheck: false });
    invoiceIds[key] = inv.id;
    return inv;
  };

  const cleanup = async () => {
    const invs = await Invoice.findAll({
      where: { invoice_No: { [Op.like]: TEST_PREFIX + 'JB-%' } },
      attributes: ['id'],
    });
    const ids = invs.map((i) => i.id);
    if (ids.length) await Charge_Head.destroy({ where: { InvoiceId: ids } });
    if (ids.length) await Invoice.destroy({ where: { id: ids }, fiscalYearCheck: false });

    await Aviation_Consignment.destroy({ where: { awb: TEST_PREFIX + 'JBAWB' } });
    await Aviation_Job.destroy({ where: { jobNo: TEST_PREFIX + 'JB-AVJ' } });
    await Customs_Job.destroy({ where: { jobNo: TEST_PREFIX + 'JB-CCJ' } });
    const seJobs = await SE_Job.findAll({ where: { jobNo: TEST_PREFIX + 'JB-SEJ' }, attributes: ['id'] });
    if (seJobs.length) await Delivery_Order.destroy({ where: { SEJobId: seJobs.map((j) => j.id) } });
    await SE_Job.destroy({ where: { jobNo: TEST_PREFIX + 'JB-SEJ' }, fiscalYearCheck: false });
    await Aviation_Carrier.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
    await Clients.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
  };

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    await cleanup();

    const year = await FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    fiscalYearId = year ? year.id : (await FiscalYears.create({
      label: TEST_PREFIX + 'FY', suffix: '99',
      startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
    })).id;

    let company = await Company.findOne({ order: [['id', 'ASC']] });
    if (!company) {
      company = await Company.create({ title: TEST_PREFIX + 'JB Co', short: 'JBC' });
      createdCompanyId = company.id;
    }
    companyId = String(company.id);

    clientId = (await Clients.create({ name: TEST_PREFIX + 'JB Client', code: TEST_PREFIX + 'JBC' })).id;
    carrierId = (await Aviation_Carrier.create({
      name: TEST_PREFIX + 'JB Air', prefix: '771', category: 'GAM',
    })).id;

    // --- freight: the path that already worked, kept as the control --------
    seJobId = (await SE_Job.create({
      jobNo: TEST_PREFIX + 'JB-SEJ', subType: 'FCL', operation: 'SE',
      companyId, ClientId: clientId,
    }, { fiscalYearCheck: false })).id;
    await Delivery_Order.create({ date: '2026-07-22', SEJobId: seJobId });

    const seInv = await makeInvoice('SE', 'SE', { SEJobId: seJobId });
    await Charge_Head.create({
      charge: '1', type: 'Recievable', currency: 'PKR', qty: '1',
      rate_charge: '1000', amount: '1000', ex_rate: '1', local_amount: '1000',
      net_amount: '1000', InvoiceId: seInv.id, SEJobId: seJobId,
    });

    // --- aviation: charges hang off an AWB, which belongs to a flight ------
    avJobId = (await Aviation_Job.create({
      jobNo: TEST_PREFIX + 'JB-AVJ', flightNo: 'JB-900',
      origin: 'KHI', destination: 'JED', flightDate: TODAY, companyId,
      operatingCarrierId: carrierId,
    })).id;
    consignmentId = (await Aviation_Consignment.create({
      awb: TEST_PREFIX + 'JBAWB', grossWeight: 100, chargeableWeight: 100,
      AviationJobId: avJobId, AviationCarrierId: carrierId,
    })).id;

    const avInv = await makeInvoice('AV', 'AV');
    await Charge_Head.create({
      charge: '1', type: 'Recievable', currency: 'USD', qty: '100',
      rate_charge: '2', amount: '200', ex_rate: '280', local_amount: '56000',
      net_amount: '200', InvoiceId: avInv.id, AviationConsignmentId: consignmentId,
    });

    // --- customs: charges name the goods declaration directly --------------
    ccJobId = (await Customs_Job.create({
      jobNo: TEST_PREFIX + 'JB-CCJ', gdNumber: 'KAPE-7777', blNo: 'BL-7777',
      direction: 'Import', transportMode: 'Sea', companyId, clientId,
    })).id;

    const ccInv = await makeInvoice('CC', 'CC');
    await Charge_Head.create({
      charge: '1', type: 'Recievable', currency: 'PKR', qty: '1',
      rate_charge: '5000', amount: '5000', ex_rate: '1', local_amount: '5000',
      net_amount: '5000', InvoiceId: ccInv.id, CustomsJobId: ccJobId,
    });

    // A vendor's bill on the same declaration, with the number on the tax
    // invoice the vendor sent.
    const ccBill = await makeInvoice('CCBILL', 'CC', {
      type: 'Job Bill', payType: 'Payble', vendorTaxInvoiceNo: 'QITE0003124223',
    });
    await Charge_Head.create({
      charge: '1', type: 'Payble', currency: 'PKR', qty: '1',
      rate_charge: '3000', amount: '3000', ex_rate: '1', local_amount: '3000',
      net_amount: '3000', InvoiceId: ccBill.id, CustomsJobId: ccJobId,
    });

    // Unapproved, to prove the report only reports what has been posted.
    await makeInvoice('DRAFT', 'AV', { approved: '0' });
  });

  afterAll(async () => {
    await cleanup();
    if (createdCompanyId) await Company.destroy({ where: { id: createdCompanyId } });
  });

  describe('every mode reaches the report', () => {
    it('returns the freight, aviation and customs invoices together', async () => {
      const res = await balancing();
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');

      expect(rowFor(res, 'SE')).toBeTruthy();
      expect(rowFor(res, 'AV')).toBeTruthy();
      expect(rowFor(res, 'CC')).toBeTruthy();
    });

    it('leaves an unapproved invoice out', async () => {
      // The report is of posted money; a draft has not reached the ledger.
      expect(rowFor(await balancing(), 'DRAFT')).toBeUndefined();
    });
  });

  describe('the job columns', () => {
    it('reads a freight row off SE_Job, as it always did', async () => {
      const row = rowFor(await balancing(), 'SE');
      expect(row.SE_Job).toBeTruthy();
      expect(row.SE_Job.jobNo).toBe(TEST_PREFIX + 'JB-SEJ');
      // And carries neither of the other two blocks.
      expect(row.aviation).toBeNull();
      expect(row.customs).toBeNull();
    });

    it('sends what the print needs: the operation and the DO date', async () => {
      // operation turns an air job's LCL subType into "Air" on the print, and
      // decides which screen the Job No opens; the DO date fills its column.
      const row = rowFor(await balancing(), 'SE');
      expect(row.SE_Job.operation).toBe('SE');
      expect(row.SE_Job.Delivery_Order.date).toBe('2026-07-22');
    });

    it('fills an aviation row from the flight behind its AWB', async () => {
      // Without this the row arrives with every job column blank - the report
      // shows a total against a nameless job.
      const row = rowFor(await balancing(), 'AV');
      expect(row.SE_Job).toBeNull();
      expect(row.customs).toBeNull();

      expect(row.aviation).toBeTruthy();
      expect(row.aviation.jobId).toBe(avJobId);
      expect(row.aviation.jobNo).toBe(TEST_PREFIX + 'JB-AVJ');
      expect(row.aviation.flightNo).toBe('JB-900');
      // The AWB list is what the report shows in place of a BL number.
      expect(row.aviation.awbs.length).toBeGreaterThan(0);
    });

    it('fills a customs row from its goods declaration', async () => {
      const row = rowFor(await balancing(), 'CC');
      expect(row.SE_Job).toBeNull();
      expect(row.aviation).toBeNull();

      expect(row.customs).toBeTruthy();
      expect(row.customs.jobId).toBe(ccJobId);
      expect(row.customs.jobNo).toBe(TEST_PREFIX + 'JB-CCJ');
      expect(row.customs.gdNumber).toBe('KAPE-7777');
    });

    // The Vendor Tax Inv # column read a field the route did not select, so
    // it was empty whatever the bill held (the user's report, 2026-10-14).
    it("sends a bill's vendor tax invoice number", async () => {
      const res = await balancing();
      expect(rowFor(res, 'CCBILL').vendorTaxInvoiceNo).toBe('QITE0003124223');
      expect(rowFor(res, 'CC').vendorTaxInvoiceNo).toBeNull();
    });

    it('gives every row a job the screen can name and open', async () => {
      /* The screen reads `SE_Job?.jobNo || aviation?.jobNo || customs?.jobNo`
       * and clicks through on whichever id is present. A row with none of the
       * three is a line of money belonging to nothing. */
      const res = await balancing();
      for (const key of ['SE', 'AV', 'CC']) {
        const row = rowFor(res, key);
        const jobNo = row.SE_Job?.jobNo || row.aviation?.jobNo || row.customs?.jobNo;
        expect(jobNo).toBeTruthy();
      }
    });
  });

  describe('the job-type filter', () => {
    /* Matched against Invoice.operation. The screen offers 'AV' under aviation
     * and 'CC' under customs (see the frontend's jobTypeOptions); without
     * those entries ticking ANY type hid a whole operation, and a report that
     * comes back with rows in it but silently missing an operation reads as
     * "no invoices that month" rather than as a filter doing this. */
    it('selects the aviation invoices, and only those', async () => {
      const res = await balancing({ jobtypes: 'AV' });
      expect(rowFor(res, 'AV')).toBeTruthy();
      expect(rowFor(res, 'SE')).toBeUndefined();
      expect(rowFor(res, 'CC')).toBeUndefined();
    });

    it('selects the customs invoices, and only those', async () => {
      const res = await balancing({ jobtypes: 'CC' });
      expect(rowFor(res, 'CC')).toBeTruthy();
      expect(rowFor(res, 'SE')).toBeUndefined();
      expect(rowFor(res, 'AV')).toBeUndefined();
    });

    it('still selects freight on its own', async () => {
      const res = await balancing({ jobtypes: 'SE' });
      expect(rowFor(res, 'SE')).toBeTruthy();
      expect(rowFor(res, 'AV')).toBeUndefined();
    });

    it('takes several types at once', async () => {
      const res = await balancing({ jobtypes: 'AV,CC' });
      expect(rowFor(res, 'AV')).toBeTruthy();
      expect(rowFor(res, 'CC')).toBeTruthy();
      expect(rowFor(res, 'SE')).toBeUndefined();
    });

    it('returns every operation when no type is ticked', async () => {
      const res = await balancing({ jobtypes: '' });
      expect(rowFor(res, 'SE')).toBeTruthy();
      expect(rowFor(res, 'AV')).toBeTruthy();
      expect(rowFor(res, 'CC')).toBeTruthy();
    });
  });

  describe('the period', () => {
    it('is bounded, and excludes a range that ended before these were raised', async () => {
      const res = await balancing({ from: '2020-01-01', to: '2020-01-31' });
      expect(rowFor(res, 'SE')).toBeUndefined();
      expect(rowFor(res, 'AV')).toBeUndefined();
      expect(rowFor(res, 'CC')).toBeUndefined();
    });
  });

  /* PENDING - the jobs in the period with no approved invoice of the side
   * asked for, in place of the invoices (2026-11-20) - functions/
   * jobBalancingPending. */
  describe('Pending', () => {
    let pendingJobId;
    // Pending dates a job by its jobDate, else the day it was entered IN
    // PAKISTAN - the freight job here has no jobDate. TODAY is the machine's
    // day: on CI (UTC) between 19:00 and midnight that is still yesterday in
    // Karachi's terms, and the v1.3.04 tag run (20:41 UTC) failed on it.
    const PK_TODAY = pkDay(new Date().toISOString());
    const pending = (over = {}) => balancing({ options: 'pending', from: PK_TODAY, to: PK_TODAY, ...over });
    beforeAll(async () => {
      pendingJobId = (await SE_Job.create({
        jobNo: TEST_PREFIX + 'JB-SEJ-PENDING', subType: 'FCL', operation: 'SE', companyId, ClientId: clientId, jobDate: PK_TODAY,
      }, { fiscalYearCheck: false })).id;
    });
    afterAll(() => SE_Job.destroy({ where: { id: pendingJobId }, fiscalYearCheck: false }));

    it('lists a job with no invoice, and not the jobs invoiced', async () => {
      const res = await pending({ paytype: 'Recievable' });
      expect(res.status).toBe(200);
      const rows = res.body.result;
      expect(rows.find((r) => r.SE_Job?.id === pendingJobId)).toMatchObject({
        pending: true, invoice_No: 'Not invoiced', total: '0', party_Name: TEST_PREFIX + 'JB Client',
      });
      expect(rows.some((r) => r.SE_Job?.id === seJobId)).toBe(false);
      expect(rows.some((r) => r.customs?.jobId === ccJobId)).toBe(false);
      // Nothing else of the report's: no invoices, no advances.
      expect(rows.every((r) => r.pending)).toBe(true);
    });

    it('by side: a job billed but never invoiced to the client is pending as a receivable only', async () => {
      // The freight job has an approved receivable and no bill.
      const payable = await pending({ paytype: 'Payble' });
      expect(payable.body.result.some((r) => r.SE_Job?.id === seJobId)).toBe(true);
      // The declaration has both.
      expect(payable.body.result.some((r) => r.customs?.jobId === ccJobId)).toBe(false);
    });
  });
});

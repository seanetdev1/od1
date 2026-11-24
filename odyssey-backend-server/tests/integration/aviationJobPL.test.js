/**
 * Aviation flights showing up in Job Profit/Loss - GET /misc/profitLoss/job.
 *
 * The route enumerates SE_Job, so flights were invisible: the type filter
 * offered "Aviation" and always returned nothing. These tests go through the
 * real endpoint against a real database, because the thing that broke was the
 * query, not the arithmetic - the row shaping is covered by the unit tests.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const { anyCompany } = require('../helpers/company');
const { Op } = require('sequelize');
const {
  Aviation_Job, Aviation_Consignment,
} = require('../../functions/Associations/aviationAssociations');
const { Charge_Head, Invoice } = require('../../functions/Associations/incoiceAssociations');
const { FiscalYears, Company, Clients, Charges } = require('../../models');

describe('Job Profit/Loss sees aviation - routes/misc/profitLoss.js', () => {
  let authHeader; let employeeId; let fiscalYearId; let companyId;
  let jobId; let shipperId; let chargeMaster; let invoiceIds = [];

  const auth = (req) => req
    .set('Authorization', authHeader)
    .set('x-fiscal-year-id', String(fiscalYearId));

  // Wide enough that the flight created below always falls inside it.
  const range = { from: '2000-01-01', to: '2099-12-31' };

  const report = (headers = {}) =>
    auth(request(app).get('/misc/profitLoss/job')).set({ ...range, ...headers });

  // Asserts the shape too: a 500 comes back as an error object, and silently
  // treating that as "no rows" would make a broken report look like a working
  // filter.
  const rowFor = (res, id) => {
    expect(Array.isArray(res.body.result)).toBe(true);
    return res.body.result.find((r) => r.id === id && r.operation === 'AV');
  };

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));

    const year = await anyFiscalYear();
    fiscalYearId = year ? year.id : null;
    // NOT company 4: the report reads '4' as its legacy "companies 1 and 3"
    // alias (routes/misc/profitLoss.js), so a flight on a company that happens
    // to have id 4 vanishes from its own filtered report. Which company is
    // lowest depends on what earlier test files left behind and how far the
    // id sequence has moved, so this failed the day another suite created one.
    companyId = String((await anyCompany({ where: { id: { [Op.ne]: 4 } } })).id);

    const shipper = await Clients.create({
      name: TEST_PREFIX + 'PL Shipper', code: 'TPL', types: 'Shipper', active: true,
    });
    shipperId = shipper.id;

    // Created here rather than looked up: the test database ships with no
    // charge master, so a findOne() would be null and every assertion that
    // depends on a charge would silently skip.
    chargeMaster = await Charges.create({
      code: 9910, name: TEST_PREFIX + 'PL Freight', short: 'TPLF',
      currency: 'PKR', calculationType: 'Per Unit', status: true,
      defaultPaybleParty: 'Shipper', defaultRecivableParty: 'Shipper',
      taxApply: 'false', taxPerc: '0',
    });

    // A flight with two AWBs: one billed 145,600 receivable, one 98,000 payable.
    const created = await auth(request(app).post('/aviationJob/create')).send({
      employeeId, fiscalYearId,
      data: {
        companyId, fiscalYearId, flightNo: 'ER-PL1',
        origin: 'LHE', destination: 'JED', flightDate: '2026-09-04', status: 'Active',
        consignments: [
          {
            awb: 'PL-AWB-1', shipperId, grossWeight: 520, volume: 3.2, pieces: 10,
            charges: chargeMaster
              ? [{ charge: chargeMaster.id, type: 'Recievable', qty: 520, rate_charge: 280 }]
              : [],
          },
          {
            awb: 'PL-AWB-2', shipperId, grossWeight: 200, volume: 1.1, pieces: 4,
            charges: chargeMaster
              ? [{ charge: chargeMaster.id, type: 'Payble', qty: 200, rate_charge: 490 }]
              : [],
          },
        ],
      },
    });
    jobId = created.body.result.id;

    // Raise an APPROVED invoice per direction, the way /makeInvoice does:
    // total is the sum of its charges' local_amount.
    const lines = created.body.result.Aviation_Consignments;
    for (const [index, payType] of [[0, 'Recievable'], [1, 'Payble']]) {
      const charges = await Charge_Head.findAll({
        where: { AviationConsignmentId: lines[index].id },
      });
      if (!charges.length) continue;
      const total = charges.reduce((t, c) => t + Number(c.local_amount || 0), 0);
      const inv = await Invoice.create({
        invoice_No: `${TEST_PREFIX}PL-${payType}`, invoiceType: 'Job Invoice',
        type: 'Job Invoice', operation: 'AV', payType, approved: '1', status: '1',
        currency: 'PKR', ex_rate: '1', total: String(total),
        recieved: '0', paid: '0', companyId, SEJobId: null,
      }, { fiscalYearCheck: false });
      invoiceIds.push(inv.id);
      await Charge_Head.update(
        { InvoiceId: inv.id, status: '1' },
        { where: { id: charges.map((c) => c.id) } }
      );
    }
  });

  afterAll(async () => {
    if (invoiceIds.length) {
      await Charge_Head.update({ InvoiceId: null }, { where: { InvoiceId: invoiceIds } });
      await Invoice.destroy({ where: { id: invoiceIds }, fiscalYearCheck: false });
    }
    const lines = await Aviation_Consignment.findAll({
      where: { AviationJobId: jobId || -1 }, attributes: ['id'],
    });
    if (lines.length) {
      await Charge_Head.destroy({ where: { AviationConsignmentId: lines.map((l) => l.id) } });
      await Aviation_Consignment.destroy({ where: { AviationJobId: jobId } });
    }
    if (jobId) await Aviation_Job.destroy({ where: { id: jobId }, fiscalYearCheck: false });
    await Clients.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
    await Charges.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
  });

  it('returns the flight as a row', async () => {
    const res = await report();
    expect(res.status).toBe(200);
    expect(rowFor(res, jobId)).toBeDefined();
  });

  it('gives the row the flight job number and an AV operation', async () => {
    const row = rowFor(await report(), jobId);
    expect(row.jobNo).toMatch(/-AVJ-/);
    expect(row.operation).toBe('AV');
    expect(row.subType).toBe('AIR');
  });

  it('totals weight across the AWBs on board', async () => {
    expect(rowFor(await report(), jobId).weight).toBe(720);
  });

  it('carries both invoices, on the right sides of the ledger', async () => {
    const row = rowFor(await report(), jobId);
    const receivable = row.Invoices.filter((i) => i.payType === 'Recievable');
    const payable = row.Invoices.filter((i) => i.payType === 'Payble');
    expect(receivable).toHaveLength(1);
    expect(payable).toHaveLength(1);
    expect(Number(receivable[0].total)).toBeCloseTo(520 * 280, 2);
    expect(Number(payable[0].total)).toBeCloseTo(200 * 490, 2);
  });

  it('supplies the associations the report reads unguarded', async () => {
    // x.Client.name and x.local_vendor.name have no optional chaining in
    // Report.js, so a missing object takes down the Excel export.
    const row = rowFor(await report(), jobId);
    for (const key of ['Client', 'shipper', 'consignee', 'local_vendor',
                       'overseas_agent', 'shipping_line', 'sales_representator', 'Bl']) {
      expect(row[key]).toBeTruthy();
      expect(typeof row[key].name === 'string' || key === 'Bl').toBe(true);
    }
  });

  it('names the shipper as the client when the flight has only one', async () => {
    expect(rowFor(await report(), jobId).Client.name).toBe(TEST_PREFIX + 'PL Shipper');
  });

  describe('filters', () => {
    it('includes the flight when Aviation is ticked', async () => {
      expect(rowFor(await report({ jobtype: 'AV' }), jobId)).toBeDefined();
    });

    it('drops it when only freight types are ticked', async () => {
      expect(rowFor(await report({ jobtype: 'SE,SI,AE,AI' }), jobId)).toBeUndefined();
    });

    it('drops it when a sales representative is required', async () => {
      // A flight has none, so it cannot satisfy that filter. A well-formed but
      // unused UUID: Employees.id is a uuid column, and a bare '1' makes the
      // FREIGHT half of the query fail before aviation is even reached.
      const res = await report({ salesrepresentative: '00000000-0000-4000-8000-000000000000' });
      expect(res.status).toBe(200);
      expect(rowFor(res, jobId)).toBeUndefined();
    });

    it('drops it when an overseas agent is required', async () => {
      const res = await report({ overseasagent: '999999' });
      expect(res.status).toBe(200);
      expect(rowFor(res, jobId)).toBeUndefined();
    });

    it('matches on the AWB shipper for the client filter', async () => {
      expect(rowFor(await report({ client: String(shipperId) }), jobId)).toBeDefined();
    });

    it('drops it for a different client', async () => {
      expect(rowFor(await report({ client: '-1' }), jobId)).toBeUndefined();
    });

    it('respects the company filter', async () => {
      expect(rowFor(await report({ company: companyId }), jobId)).toBeDefined();
      expect(rowFor(await report({ company: 'all' }), jobId)).toBeDefined();
    });

    it('drops it when the date range ends before the flight', async () => {
      expect(rowFor(await report({ from: '2000-01-01', to: '2000-01-02' }), jobId)).toBeUndefined();
    });

    it('ranges on the FLIGHT date, not on when the record was typed', async () => {
      // The flight departs 2026-09-04; the record was created today. Asking
      // for September 2026 must find it even though it was not typed then.
      const res = await report({ from: '2026-09-01', to: '2026-09-30' });
      expect(rowFor(res, jobId)).toBeDefined();
    });

    it('excludes a flight whose DEPARTURE is outside the range', async () => {
      // The record was created today, so a today-only window would match it if
      // the filter were still reading createdAt.
      const today = require('moment')().format('YYYY-MM-DD') /* the server's day, not UTC's */;
      expect(rowFor(await report({ from: today, to: today }), jobId)).toBeUndefined();
    });

    it('includes the last day of the range', async () => {
      // Inclusive of `to`, matching what the freight side's "< to + 1 day"
      // amounts to on a timestamp.
      expect(rowFor(await report({ from: '2026-09-04', to: '2026-09-04' }), jobId)).toBeDefined();
    });

    it('shows the flight date in the row, so it agrees with the filter', async () => {
      const row = rowFor(await report({ from: '2026-09-01', to: '2026-09-30' }), jobId);
      expect(String(row.createdAt).slice(0, 10)).toBe('2026-09-04');
    });

    it('does not 500 when a company is chosen with no sub-type ticked', async () => {
      // This threw on req.headers.subtype.split(",") and failed the whole
      // report, freight rows included.
      expect((await report({ company: companyId })).status).toBe(200);
    });

    it('keeps AIR working as a sub-type for aviation', async () => {
      expect(rowFor(await report({ subtype: 'AIR' }), jobId)).toBeDefined();
      expect(rowFor(await report({ subtype: 'FCL,LCL' }), jobId)).toBeUndefined();
    });
  });

  describe('a flight with no flight date recorded', () => {
    let undatedId; let undatedInvoiceId;

    beforeAll(async () => {
      const created = await auth(request(app).post('/aviationJob/create')).send({
        employeeId, fiscalYearId,
        data: {
          companyId, fiscalYearId, flightNo: 'ER-NODATE',
          origin: 'LHE', destination: 'JED', flightDate: null, status: 'Active',
          consignments: [{
            awb: 'PL-AWB-NODATE', shipperId, grossWeight: 100,
            charges: [{ charge: chargeMaster.id, type: 'Recievable', qty: 100, rate_charge: 10 }],
          }],
        },
      });
      undatedId = created.body.result.id;

      const charges = await Charge_Head.findAll({
        where: { AviationConsignmentId: created.body.result.Aviation_Consignments[0].id },
      });
      const inv = await Invoice.create({
        invoice_No: TEST_PREFIX + 'PL-NODATE', invoiceType: 'Job Invoice',
        type: 'Job Invoice', operation: 'AV', payType: 'Recievable',
        approved: '1', status: '1', currency: 'PKR', ex_rate: '1',
        total: '1000', recieved: '0', paid: '0', companyId, SEJobId: null,
      }, { fiscalYearCheck: false });
      undatedInvoiceId = inv.id;
      await Charge_Head.update({ InvoiceId: inv.id }, { where: { id: charges.map((c) => c.id) } });
    });

    afterAll(async () => {
      if (undatedInvoiceId) {
        await Charge_Head.update({ InvoiceId: null }, { where: { InvoiceId: undatedInvoiceId } });
        await Invoice.destroy({ where: { id: undatedInvoiceId }, fiscalYearCheck: false });
      }
      const lines = await Aviation_Consignment.findAll({
        where: { AviationJobId: undatedId || -1 }, attributes: ['id'],
      });
      if (lines.length) {
        await Charge_Head.destroy({ where: { AviationConsignmentId: lines.map((l) => l.id) } });
        await Aviation_Consignment.destroy({ where: { AviationJobId: undatedId } });
      }
      if (undatedId) await Aviation_Job.destroy({ where: { id: undatedId }, fiscalYearCheck: false });
    });

    it('still appears, ranged on when the record was created', async () => {
      // Otherwise it would vanish from every date-ranged report and take its
      // revenue with it - worse than showing it in an approximate period.
      const today = require('moment')().format('YYYY-MM-DD') /* the server's day, not UTC's */;
      expect(rowFor(await report({ from: today, to: today }), undatedId)).toBeDefined();
    });

    it('is not swept into an unrelated period', async () => {
      expect(rowFor(await report({ from: '2000-01-01', to: '2000-01-02' }), undatedId))
        .toBeUndefined();
    });
  });
});

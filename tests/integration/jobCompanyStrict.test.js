const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');
const { Aviation_Job } = require('../../functions/Associations/aviationAssociations');

/* NO COMPANY PICKED: NO JOBS LISTED, AND NO JOB SAVED.
 *
 * Every job list is filtered by the company picked in the header, and used to
 * drop the filter when none came - a user with no company picked saw every
 * company's jobs and saved theirs under none, hidden from everyone working in
 * a company (15 customs jobs on CargoLinkers). Freight, aviation and customs
 * all follow the same rule now - see functions/companyCodes. */
describe('the company a job list or job save is for', () => {
  const stamp = Date.now();
  const NO_COMPANY = /Pick your company at the top of the screen/;
  const BLANKS = [undefined, '', 'NaN', 'undefined', 'null'];
  let authHeader; let employeeId; let fiscalYear; let companyA; let companyB;
  const made = { sea: [], aviation: [], customs: [] };

  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYear.id));

  const seaJob = (companyId, over = {}) => auth(request(app).post('/seaJob/create')).send({
    employeeId,
    data: {
      operation: 'SE', companyId, fiscalYearId: fiscalYear.id, jobDate: '2026-09-01', shipDate: '2026-09-05',
      customCheck: [], transportCheck: [], equipments: [], approved: false, ...over,
    },
  });
  const flight = (companyId) => auth(request(app).post('/aviationJob/create')).send({
    employeeId, fiscalYearId: fiscalYear.id,
    data: { companyId, fiscalYearId: fiscalYear.id, flightNo: 'TS-1', origin: 'KHI', destination: 'DXB', flightDate: new Date().toISOString().slice(0, 10), status: 'Active' },
  });
  const customsJob = (companyId) => auth(request(app).post('/customsJob/create')).send({
    employeeId,
    data: { companyId, fiscalYearId: fiscalYear.id, direction: 'Import', transportMode: 'Sea', gdNumber: `${TEST_PREFIX}GD-${stamp}`, gdDate: '2026-09-01' },
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
    companyA = await db.Company.create({ title: `${TEST_PREFIX}Strict A ${stamp}`, short: `SA${String(stamp).slice(-3)}` });
    companyB = await db.Company.create({ title: `${TEST_PREFIX}Strict B ${stamp}`, short: `SB${String(stamp).slice(-3)}` });
  });

  afterAll(async () => {
    if (made.sea.length) await db.SE_Job.destroy({ where: { id: made.sea }, fiscalYearCheck: false });
    if (made.aviation.length) await Aviation_Job.destroy({ where: { id: made.aviation } });
    if (made.customs.length) await Customs_Job.destroy({ where: { id: made.customs }, fiscalYearCheck: false });
    await db.Company.destroy({ where: { id: [companyA.id, companyB.id] } });
    if (made.fiscalYear) await made.fiscalYear.destroy();
  });

  describe('a job list with no company picked shows no jobs, and says so', () => {
    it.each(BLANKS)('freight, company %p', async (companyid) => {
      const res = await auth(request(app).get('/seaJob/get')).query({ operation: 'SE', ...(companyid === undefined ? {} : { companyid }) });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'success', result: [], noCompany: true });
    });

    it.each(BLANKS)('aviation, company %p', async (companyid) => {
      let req = auth(request(app).get('/aviationJob/get'));
      if (companyid !== undefined) req = req.set('companyid', companyid);
      const res = await req;
      expect(res.body).toMatchObject({ status: 'success', result: [], noCompany: true });
    });

    it.each(BLANKS)('customs, company %p', async (companyid) => {
      let req = auth(request(app).get('/customsJob/get'));
      if (companyid !== undefined) req = req.set('companyid', companyid);
      const res = await req;
      expect(res.body).toMatchObject({ status: 'success', result: [], count: 0, noCompany: true });
    });

    it('a company picked lists its jobs, without the flag', async () => {
      const job = await seaJob(String(companyA.id));
      made.sea.push(job.body.result.id);
      const res = await auth(request(app).get('/seaJob/get')).query({ operation: 'SE', companyid: String(companyA.id) });
      expect(res.body.noCompany).toBeUndefined();
      expect(res.body.result.map((j) => j.id)).toContain(job.body.result.id);
    });
  });

  /* An unset dropdown sends "" - an air job saved with no airline, Transport
   * ticked with no transporter picked - and Postgres refused it for an integer
   * column: "invalid input syntax for type integer" (the user's report,
   * 2026-10-15). Saved as no link, on create and on edit. */
  describe('an unset link saves as none, not as an empty string', () => {
    it('creates an air job with no airline, and a job with Transport ticked and no transporter', async () => {
      const air = await seaJob(String(companyA.id), { operation: 'AE', airLineId: '', departureDate: '2026-09-05' });
      expect(air.body.status).toBe('success');
      made.sea.push(air.body.result.id);
      expect((await db.SE_Job.findByPk(air.body.result.id)).airLineId).toBeNull();

      const sea = await seaJob(String(companyA.id), {
        transportCheck: ['Transport'], transporterId: '', customCheck: ['Custom Clearance'], customAgentId: ' ', commodityId: '',
      });
      expect(sea.body.status).toBe('success');
      made.sea.push(sea.body.result.id);
      const saved = await db.SE_Job.findByPk(sea.body.result.id);
      expect([saved.transporterId, saved.customAgentId, saved.commodityId]).toEqual([null, null, null]);
    });

    it('edits one the same way', async () => {
      const job = await seaJob(String(companyA.id));
      made.sea.push(job.body.result.id);
      const res = await auth(request(app).post('/seaJob/edit')).send({
        employeeId,
        data: {
          id: job.body.result.id, operation: 'SE', companyId: String(companyA.id), fiscalYearId: fiscalYear.id,
          customCheck: [], transportCheck: ['Transport'], transporterId: '', equipments: [], approved: [], vesselId: '',
        },
      });
      expect(res.body.status).toBe('success');
      expect((await db.SE_Job.findByPk(job.body.result.id)).transporterId).toBeNull();
    });
  });

  describe('a job is not saved without a real company', () => {
    it.each(['', 'NaN', 'undefined', '999999999'])('freight, company %p - refused, nothing saved', async (companyId) => {
      const before = await db.SE_Job.count();
      const res = await seaJob(companyId);
      expect(res.status).toBe(400);
      expect(res.body.result).toMatch(NO_COMPANY);
      expect(await db.SE_Job.count()).toBe(before);
    });

    it.each(['', 'NaN', '999999999'])('aviation, company %p - refused, nothing saved', async (companyId) => {
      const before = await Aviation_Job.count();
      const res = await flight(companyId);
      expect(res.status).toBe(400);
      expect(res.body.result).toMatch(NO_COMPANY);
      expect(await Aviation_Job.count()).toBe(before);
    });

    it.each(['', 'NaN', '999999999'])('customs, company %p - refused, nothing saved', async (companyId) => {
      const before = await Customs_Job.count();
      const res = await customsJob(companyId);
      expect(res.status).toBe(400);
      expect(res.body.result).toMatch(NO_COMPANY);
      expect(await Customs_Job.count()).toBe(before);
    });
  });

  describe('an edit is refused without a company, and never moves the job to another', () => {
    it('freight', async () => {
      const job = (await seaJob(String(companyA.id))).body.result;
      made.sea.push(job.id);
      const edit = (companyId) => auth(request(app).post('/seaJob/edit')).send({
        employeeId, data: { ...job, companyId, customCheck: [], transportCheck: [], approved: false, equipments: [], customerRef: 'EDITED' },
      });

      const blank = await edit('');
      expect(blank.status).toBe(400);
      expect(blank.body.result).toMatch(NO_COMPANY);

      const elsewhere = await edit(String(companyB.id));
      expect(elsewhere.status).toBe(200);
      const after = await db.SE_Job.findByPk(job.id);
      expect(after.customerRef).toBe('EDITED');
      expect(String(after.companyId)).toBe(String(companyA.id));
    });

    it('aviation', async () => {
      const job = (await flight(String(companyA.id))).body.result;
      made.aviation.push(job.id);
      const edit = (companyId) => auth(request(app).post('/aviationJob/edit')).send({
        employeeId, data: { id: job.id, companyId, flightNo: 'TS-2' },
      });

      const blank = await edit('NaN');
      expect(blank.status).toBe(400);
      expect(blank.body.result).toMatch(NO_COMPANY);

      expect((await edit(String(companyB.id))).status).toBe(200);
      const after = await Aviation_Job.findByPk(job.id);
      expect(after.flightNo).toBe('TS-2');
      expect(String(after.companyId)).toBe(String(companyA.id));
    });

    it('customs', async () => {
      const job = (await customsJob(String(companyA.id))).body.result;
      made.customs.push(job.id);
      const res = await auth(request(app).post('/customsJob/edit')).send({ employeeId, data: { ...job, companyId: '' } });
      expect(res.status).toBe(400);
      expect(res.body.result).toMatch(NO_COMPANY);
    });
  });
});

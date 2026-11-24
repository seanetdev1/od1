/**
 * The Program Book - routes/customsJobs/plans.js, against Postgres.
 *
 * What a pure test cannot ask: that a move really numbers jobs in sequence and
 * writes their containers, that a moved plan stays frozen on every route, that
 * a refused save or move leaves nothing behind, and that the whole thing is
 * shut while Configuration says it is off.
 */
const request = require('supertest');
const app = require('../../index');
const { Op } = require('sequelize');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const { anyCompany } = require('../helpers/company');
const {
  Customs_Job, Customs_Container, Customs_Plan,
} = require('../../functions/Associations/customsAssociations');
const { Clients } = require('../../functions/Associations/clientAssociation');
const { FiscalYears, AppSetting } = require('../../models');
const db = require('../../models');

describe('Program Book - /customsJob/plans', () => {
  const KEY = 'customsPlanning';
  let admin; let employee; let fiscalYearId; let companyId; let shipper; let line; let kept;
  const jobIds = [];

  const auth = (req, who = admin) => req.set('Authorization', who.authHeader).set('x-fiscal-year-id', String(fiscalYearId));
  const setPlanning = (enabled, who = admin) => auth(request(app).post('/settings/customsPlanning'), who).send({ enabled });
  const book = () => auth(request(app).get('/customsJob/plans/get')).set('companyid', companyId);
  const save = (rows, over = {}) => auth(request(app).post('/customsJob/plans/save')).send({ companyId, rows, ...over });
  const move = (ids) => auth(request(app).post('/customsJob/plans/move'))
    .send({ companyId, ids, fiscalYearId, employeeId: admin.employee?.id });
  const remove = (ids) => auth(request(app).post('/customsJob/plans/delete')).send({ companyId, ids });
  const mine = async () => (await book()).body.result.filter((p) => String(p.invoiceNo || '').startsWith(TEST_PREFIX));

  beforeAll(async () => {
    admin = await loginAs('admin');
    employee = await loginAs('employee');
    const year = await anyFiscalYear();
    fiscalYearId = year.id;
    companyId = String((await anyCompany()).id);
    shipper = await Clients.create({ name: TEST_PREFIX + 'Plan Shipper', code: TEST_PREFIX + 'PS', types: 'Shipper' });
    line = await Clients.create({ name: TEST_PREFIX + 'Plan Line', code: TEST_PREFIX + 'PL', types: 'Shipping Line' });
    kept = (await AppSetting.findOne({ where: { key: KEY } }))?.value ?? null;
  });

  afterAll(async () => {
    const plans = await Customs_Plan.findAll({ where: { invoiceNo: { [Op.like]: TEST_PREFIX + '%' } } });
    const fromPlans = plans.map((p) => p.CustomsJobId).filter(Boolean);
    const ids = [...new Set([...jobIds, ...fromPlans])];
    await Customs_Plan.destroy({ where: { id: plans.map((p) => p.id) } });
    if (ids.length) {
      const jobs = await Customs_Job.findAll({ where: { id: ids }, attributes: ['jobNo'] });
      await db.History.destroy({ where: { formName: 'Customs Job', docNo: jobs.map((j) => j.jobNo) } });
      await Customs_Container.destroy({ where: { CustomsJobId: ids } });
      await Customs_Job.destroy({ where: { id: ids }, fiscalYearCheck: false });
    }
    await Clients.destroy({ where: { name: { [Op.like]: TEST_PREFIX + 'Plan%' } } });
    await AppSetting.destroy({ where: { key: KEY } });
    if (kept != null) await AppSetting.create({ key: KEY, value: kept });
  });

  describe('the switch', () => {
    it('is off until an admin turns it on - and off, the book is shut', async () => {
      await AppSetting.destroy({ where: { key: KEY } });
      expect((await auth(request(app).get('/settings/customsPlanning'), employee)).body.result).toEqual({ enabled: false });
      const shut = await book();
      expect(shut.status).toBe(403);
      expect(shut.body.result).toMatch(/Configuration > Customs/);
      expect((await setPlanning(true, employee)).status).toBe(403);
      expect((await setPlanning('yes')).status).toBe(400);
      expect((await setPlanning(true)).body.result).toEqual({ enabled: true });
      expect((await book()).status).toBe(200);
    });
  });

  describe('with planning on', () => {
    beforeAll(async () => { await setPlanning(true); });

    it('saves new rows without job numbers, skipping the blank ones', async () => {
      const res = await save([
        {
          rowNo: 1, shipperId: shipper.id, invoiceNo: TEST_PREFIX + 'INV-1', qty: 2, size: '40hc',
          pol: 'MEK', pod: 'AEJEA', shippingLineId: line.id, containers: 'MSKU1234567, TGHU7654321',
          gateInTime: '2026-10-08 14:30', vessel: 'MSC AURORA', cutOff: '2026-10-09 18:00', bookingNo: 'BK-1',
          currentStatus: 'Gate In', gdNumber: 'GD-1', remarks: 'first', vehicleDetail: 'JW 1, JW 2',
        },
        { rowNo: 2, shipperId: shipper.id, invoiceNo: TEST_PREFIX + 'INV-2', qty: 1, size: '20gp' },
        { rowNo: 3, status: 'Pending' },
      ]);
      expect(res.body).toEqual({ status: 'success', result: { created: 2, updated: 0 } });
      const rows = await mine();
      expect(rows.map((r) => r.invoiceNo)).toEqual([TEST_PREFIX + 'INV-1', TEST_PREFIX + 'INV-2']);
      expect(rows[0]).toMatchObject({
        status: 'Pending', size: '40HC', CustomsJobId: null, Customs_Job: null,
        shipper: { id: shipper.id }, shippingLine: { id: line.id },
      });
    });

    it('a bad row refuses the whole save, by its row number, and changes nothing', async () => {
      const [one, two] = await mine();
      const res = await save([
        { ...one, rowNo: 1, remarks: 'changed' },
        { ...two, rowNo: 2, status: 'Booked' },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.result).toBe('Row 2: "Booked" is not a job status - use Pending, Confirmed, Cancelled.');
      expect((await mine())[0].remarks).toBe('first');
    });

    it('moves nothing while any ticked plan is not confirmed', async () => {
      const [one, two] = await mine();
      await save([{ ...one, status: 'Confirmed' }]);
      const res = await move([one.id, two.id]);
      expect(res.status).toBe(409);
      expect(res.body.result).toBe(
        `Nothing was moved. ${TEST_PREFIX}Plan Shipper, invoice ${TEST_PREFIX}INV-2: `
        + 'it is Pending - set its Job Status to Confirmed first.',
      );
      expect((await mine()).every((p) => !p.CustomsJobId)).toBe(true);
    });

    it('moves confirmed plans to numbered jobs, in the book\'s order, with their containers', async () => {
      const [one, two] = await mine();
      await save([{ ...two, status: 'Confirmed' }]);
      const res = await move([two.id, one.id]);
      expect(res.body.status).toBe('success');
      const moved = res.body.result;
      jobIds.push(...moved.map((m) => m.jobId));
      expect(moved.map((m) => m.planId)).toEqual([one.id, two.id]);

      const jobs = await Customs_Job.findAll({ where: { id: moved.map((m) => m.jobId) }, order: [['id', 'ASC']] });
      expect(jobs[1].jobId).toBe(jobs[0].jobId + 1);
      expect(jobs.map((j) => j.jobNo)).toEqual(moved.map((m) => m.jobNo));
      expect(jobs[0].toJSON()).toMatchObject({
        direction: 'Export', transportMode: 'Sea', clientId: shipper.id, shipperId: shipper.id,
        invoiceNo: TEST_PREFIX + 'INV-1', pol: 'MEK', pod: 'AEJEA', shippingLineId: line.id,
        vesselOrFlight: 'MSC AURORA', carrierBookingNo: 'BK-1', gdNumber: 'GD-1',
        gateInTime: '2026-10-08 14:30', cutOff: '2026-10-09 18:00', currentStatus: 'Gate In',
        companyId, status: 'Incomplete',
      });
      const boxes = await Customs_Container.findAll({ where: { CustomsJobId: jobs[0].id }, order: [['sortOrder', 'ASC']] });
      expect(boxes.map((b) => [b.containerNo, b.sizeType, b.truckNo])).toEqual([
        ['MSKU1234567', '40HC', 'JW 1'], ['TGHU7654321', '40HC', 'JW 2'],
      ]);
      // Qty 1, no number yet: a row with the size, waiting for it.
      const waiting = await Customs_Container.findAll({ where: { CustomsJobId: jobs[1].id } });
      expect(waiting.map((b) => [b.containerNo, b.sizeType])).toEqual([['', '20GP']]);

      const after = await mine();
      expect(after.map((p) => p.Customs_Job?.jobNo)).toEqual(moved.map((m) => m.jobNo));
      // The book shows where each job has got to - its status on the jobs list.
      expect(after.map((p) => p.Customs_Job?.status)).toEqual(['Incomplete', 'Incomplete']);
      expect((await book()).body.counts.Moved).toBeGreaterThanOrEqual(2);
    });

    it('a moved plan is frozen: no edit, no delete, no second move', async () => {
      const [one] = await mine();
      const edit = await save([{ ...one, remarks: 'too late' }]);
      expect(edit.status).toBe(409);
      expect(edit.body.result).toMatch(new RegExp(`^${one.Customs_Job.jobNo.replace(/[/-]/g, '.')} is on the jobs list now`));
      expect((await remove([one.id])).status).toBe(409);
      const again = await move([one.id]);
      expect(again.status).toBe(409);
      expect(again.body.result).toContain(`it is already on the jobs list as ${one.Customs_Job.jobNo}.`);
    });

    it('the job keeps its size-only container row through an edit', async () => {
      const [, two] = await mine();
      const job = (await auth(request(app).get('/customsJob/getById')).set('id', String(two.CustomsJobId))).body.result;
      const res = await auth(request(app).post('/customsJob/edit')).send({
        employeeId: admin.employee?.id,
        data: { ...job, containerRows: job.Customs_Containers },
      });
      expect(res.body.status).toBe('success');
      expect(res.body.result.Customs_Containers.map((b) => b.sizeType)).toEqual(['20GP']);
    });

    it('deletes plans that were never moved', async () => {
      await save([{ rowNo: 1, shipperId: shipper.id, invoiceNo: TEST_PREFIX + 'INV-3' }]);
      const three = (await mine()).find((p) => p.invoiceNo === TEST_PREFIX + 'INV-3');
      expect((await remove([three.id])).body.result).toEqual({ deleted: 1 });
      expect((await mine()).some((p) => p.id === three.id)).toBe(false);
    });

    it('a plan needs a company, as the job it becomes does', async () => {
      const res = await save([{ invoiceNo: TEST_PREFIX + 'INV-4' }], { companyId: '' });
      expect(res.status).toBe(400);
      expect((await auth(request(app).get('/customsJob/plans/get'))).body.noCompany).toBe(true);
    });
  });
});

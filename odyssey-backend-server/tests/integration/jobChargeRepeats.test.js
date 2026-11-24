/**
 * One of each charge per side on a job's charge sheet - an install switch,
 * off until turned on (Configuration > Direct Job, asked 2026-11-17); see
 * functions/jobChargeRepeats. The Direct Job half is in directJob.test.js.
 *
 *   customs   /customsJob/create and /edit - refused BEFORE anything is
 *             written, so a refused create leaves no job behind
 *   freight   /invoice/saveHeadesNew, the freight job's Charges tab
 *
 * A sheet that already held a repeat may be saved as it is, not given another.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const { Op } = require('sequelize');
const db = require('../../models');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');
const { Charge_Head } = require('../../functions/Associations/incoiceAssociations');

const { FiscalYears, Charges, AppSetting } = db;

describe('one of each charge per side on the charge sheet', () => {
  let authHeader; let employeeId; let fiscalYearId; let companyId; let chargeMaster;
  let switchBefore; let modeBefore;
  const customsJobIds = [];
  let freightJob;

  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYearId));
  const setting = async (key, value) => {
    await AppSetting.destroy({ where: { key } });
    if (value !== null && value !== undefined) await AppSetting.create({ key, value: String(value) });
  };
  const setSwitch = (on) => setting('uniqueJobCharges', on);
  const line = (type, over = {}) => ({ charge: chargeMaster.id, type, qty: 1, rate_charge: 100, ...over });

  const createJob = async (gd, charges) => {
    const res = await auth(request(app).post('/customsJob/create')).send({
      employeeId,
      data: { companyId, fiscalYearId, direction: 'Import', transportMode: 'Sea', gdNumber: TEST_PREFIX + gd, gdDate: '2026-04-15', charges },
    });
    if (res.body?.result?.id) customsJobIds.push(res.body.result.id);
    return res;
  };
  const editJob = (data) => auth(request(app).post('/customsJob/edit')).send({ employeeId, data });

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    const year = await FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    fiscalYearId = year
      ? year.id
      : (await FiscalYears.create({
          label: TEST_PREFIX + 'FY', suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
        })).id;
    companyId = String((await anyCompany()).id);
    switchBefore = (await AppSetting.findOne({ where: { key: 'uniqueJobCharges' } }))?.value ?? null;
    modeBefore = (await AppSetting.findOne({ where: { key: 'operationMode' } }))?.value ?? null;
    await setting('operationMode', 'customs');
    await Charges.destroy({ where: { name: { [Op.like]: TEST_PREFIX + 'Repeat%' } } });
    chargeMaster = await Charges.create({
      code: 9811, name: TEST_PREFIX + 'Repeat Fee', short: 'TRPF', currency: 'PKR', calculationType: 'Per Unit',
      status: true, defaultPaybleParty: 'Shipper', defaultRecivableParty: 'Shipper', taxApply: 'false', taxPerc: '0',
    });
    freightJob = await db.SE_Job.create({ jobNo: `${TEST_PREFIX}RPT-${Date.now()}`, operation: 'SE' }, { fiscalYearCheck: false });
  });

  afterAll(async () => {
    if (customsJobIds.length) {
      await Charge_Head.destroy({ where: { CustomsJobId: customsJobIds } });
      await Customs_Job.destroy({ where: { id: customsJobIds }, fiscalYearCheck: false });
    }
    if (freightJob) {
      await Charge_Head.destroy({ where: { SEJobId: freightJob.id } });
      await db.History.destroy({ where: { docNo: freightJob.jobNo } });
      await db.SE_Job.destroy({ where: { id: freightJob.id }, fiscalYearCheck: false });
    }
    await Charges.destroy({ where: { name: { [Op.like]: TEST_PREFIX + 'Repeat%' } } });
    await setSwitch(switchBefore);
    await setting('operationMode', modeBefore);
  });

  describe('customs', () => {
    test('off: the same charge twice on Payable is saved, as it always was', async () => {
      await setSwitch(false);
      expect((await createJob('GD-RPT-OFF', [line('Payble'), line('Payble')])).status).toBe(200);
    });

    test('on: twice on Payable is refused, naming it - and no job is created', async () => {
      await setSwitch(true);
      const before = await Customs_Job.count();
      const res = await createJob('GD-RPT-ON', [line('Payble'), line('Payble')]);
      expect(res.status).toBe(400);
      expect(res.body.result).toContain(`${TEST_PREFIX}Repeat Fee is on the Payable side 2 times.`);
      expect(await Customs_Job.count()).toBe(before);
    });

    test('on: once on Payable and once on Receivable is fine', async () => {
      await setSwitch(true);
      expect((await createJob('GD-RPT-SIDES', [line('Payble'), line('Recievable')])).status).toBe(200);
    });

    test('on: a sheet that already held a repeat saves as it is, but cannot be given another', async () => {
      await setSwitch(false);
      const id = (await createJob('GD-RPT-OLD', [line('Payble'), line('Payble')])).body.result.id;
      await setSwitch(true);
      const sheet = (await Charge_Head.findAll({ where: { CustomsJobId: id }, raw: true }))
        .map((c) => ({ ...c, qty: 1, rate_charge: 100 }));
      const base = { id, companyId, fiscalYearId, direction: 'Import', transportMode: 'Sea', gdNumber: TEST_PREFIX + 'GD-RPT-OLD' };
      expect((await editJob({ ...base, charges: sheet })).status).toBe(200);
      const more = await editJob({ ...base, charges: [...sheet, line('Payble')] });
      expect(more.status).toBe(400);
      expect(await Charge_Head.count({ where: { CustomsJobId: id } })).toBe(2);
    });
  });

  describe('freight', () => {
    const save = (charges, deleteList = []) => auth(request(app).post('/invoice/saveHeadesNew'))
      .send({ id: freightJob.id, charges, deleteList, exRate: 1, employeeId });
    const freightLine = (type, over = {}) => ({
      charge: String(chargeMaster.id), particular: 'Repeat Fee', type, status: '0', qty: 1, currency: 'PKR', ex_rate: 1,
      rate_charge: '100', amount: '100', net_amount: '100', local_amount: '100', ...over,
    });

    test('on: a second Receivable of the charge is refused', async () => {
      await setSwitch(true);
      expect((await save([freightLine('Recievable')])).status).toBe(200);
      const res = await save([freightLine('Recievable')]);
      expect(res.status).toBe(400);
      expect(res.body.result).toContain('on the Receivable side 2 times');
    });

    test('on: rewriting the line already there is not a repeat', async () => {
      await setSwitch(true);
      const [saved] = await Charge_Head.findAll({ where: { SEJobId: freightJob.id }, raw: true });
      expect((await save([{ ...saved, rate_charge: '150' }])).status).toBe(200);
    });

    test('on: deleting the old one while adding a new one is fine', async () => {
      await setSwitch(true);
      const [saved] = await Charge_Head.findAll({ where: { SEJobId: freightJob.id }, raw: true });
      expect((await save([freightLine('Recievable')], [saved.id])).status).toBe(200);
    });
  });
});

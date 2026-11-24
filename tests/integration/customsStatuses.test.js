/**
 * Configuration > Customs > Statuses - /settings/customsStatuses, and the job
 * and Program Book routes reading it.
 *
 * The rules themselves are pinned in tests/unit/customsStatuses; this is that
 * the setting is kept, that only an admin changes it, that a status still on
 * a job is never removed, and that a job and a plan are saved and moved by
 * the statuses it lists rather than by the words the code used to know.
 */
const request = require('supertest');
const app = require('../../index');
const { Op } = require('sequelize');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const { anyCompany } = require('../helpers/company');
const { Customs_Job, Customs_Plan } = require('../../functions/Associations/customsAssociations');
const { Clients } = require('../../functions/Associations/clientAssociation');
const { FiscalYears, AppSetting } = require('../../models');
const db = require('../../models');

describe('customs statuses - /settings/customsStatuses', () => {
  const KEYS = ['customsStatuses', 'customsPlanning'];
  const kept = {};
  let admin; let employee; let fiscalYearId; let companyId; let client;
  const jobIds = [];

  const auth = (req, who = admin) => req.set('Authorization', who.authHeader).set('x-fiscal-year-id', String(fiscalYearId));
  const read = (who = admin) => auth(request(app).get('/settings/customsStatuses'), who);
  const write = (body, who = admin) => auth(request(app).post('/settings/customsStatuses'), who).send(body);
  const createJob = async (data = {}) => {
    const res = await auth(request(app).post('/customsJob/create')).send({
      employeeId: admin.employee?.id,
      data: {
        companyId, fiscalYearId, direction: 'Import', transportMode: 'Sea', clientId: client.id,
        gdNumber: `${TEST_PREFIX}ST-${Date.now()}`, ...data,
      },
    });
    if (res.body?.result?.id) jobIds.push(res.body.result.id);
    return res;
  };

  // The defaults as the screen would send them back, with changes.
  const defaults = async () => {
    const { job, plan } = (await read()).body.result;
    return { job, plan };
  };

  beforeAll(async () => {
    admin = await loginAs('admin');
    employee = await loginAs('employee');
    fiscalYearId = (await anyFiscalYear()).id;
    companyId = String((await anyCompany()).id);
    client = await Clients.create({ name: `${TEST_PREFIX}Status Client`, code: `${TEST_PREFIX}SC`, types: 'Shipper' });
    for (const key of KEYS) {
      kept[key] = (await AppSetting.findOne({ where: { key } }))?.value ?? null;
      await AppSetting.destroy({ where: { key } });
    }
  });

  afterAll(async () => {
    const plans = await Customs_Plan.findAll({ where: { invoiceNo: { [Op.like]: `${TEST_PREFIX}%` } } });
    const ids = [...new Set([...jobIds, ...plans.map((p) => p.CustomsJobId).filter(Boolean)])];
    await Customs_Plan.destroy({ where: { id: plans.map((p) => p.id) } });
    if (ids.length) {
      const jobs = await Customs_Job.findAll({ where: { id: ids }, attributes: ['jobNo'] });
      await db.History.destroy({ where: { formName: 'Customs Job', docNo: jobs.map((j) => j.jobNo) } });
      await db.Customs_Container.destroy({ where: { CustomsJobId: ids } });
      await Customs_Job.destroy({ where: { id: ids }, fiscalYearCheck: false });
    }
    await Clients.destroy({ where: { id: client.id } });
    for (const key of KEYS) {
      await AppSetting.destroy({ where: { key } });
      if (kept[key] != null) await AppSetting.create({ key, value: kept[key] });
    }
  });

  it('reads as the code worked before, to anyone; only an admin changes it', async () => {
    const res = await read(employee);
    expect(res.status).toBe(200);
    expect(res.body.result.job.map((s) => s.label)).toEqual(['In Process', 'On Vessel', 'DrayOff', 'Canceled']);
    expect(res.body.result.plan.map((s) => s.label)).toEqual(['Pending', 'Confirmed', 'Cancelled']);
    expect(res.body.result.rules.job.map((r) => r.id)).toEqual(['start', 'billable', 'finished']);
    expect((await write(await defaults(), employee)).status).toBe(403);
  });

  it('keeps a rename, a new status and its rules', async () => {
    const { job, plan } = await defaults();
    job[0].label = 'Under Clearance';
    job.splice(1, 0, { label: 'Docs Awaited', color: 'orange', rules: [], hidden: false });
    plan[0] = { ...plan[0], rules: ['shown'] };
    plan.splice(1, 0, { label: 'Docs Ready', color: 'cyan', rules: ['start', 'shown'], hidden: false });
    const res = await write({ job, plan });
    expect(res.status).toBe(200);
    const after = (await read()).body.result;
    expect(after.job.map((s) => [s.value, s.label])).toEqual([
      ['Incomplete', 'Under Clearance'], ['Docs Awaited', 'Docs Awaited'], ['Complete', 'On Vessel'],
      ['DrayOff', 'DrayOff'], ['Canceled', 'Canceled'],
    ]);
    expect(after.plan.find((s) => s.rules.includes('start')).value).toBe('Docs Ready');
  });

  it('a job is saved at a status by name or value - and refused one the list does not have', async () => {
    const byName = await createJob({ status: 'Docs Awaited' });
    expect(byName.body.status).toBe('success');
    expect(byName.body.result.status).toBe('Docs Awaited');
    const renamed = await createJob({ status: 'under clearance' });
    expect(renamed.body.result.status).toBe('Incomplete');
    const bad = await createJob({ status: 'Teleported' });
    expect(bad.status).toBe(400);
    expect(bad.body.result).toMatch(/^Status must be one of: Under Clearance, Docs Awaited, On Vessel, DrayOff, Canceled/);
  });

  it('a status still on a job is not removed - it is retired instead', async () => {
    const { job, plan } = await defaults();
    const res = await write({ job: job.filter((s) => s.value !== 'Docs Awaited'), plan });
    expect(res.status).toBe(400);
    expect(res.body.result).toMatch(/^Docs Awaited is on \d+ jobs? - untick Offered instead of removing it\.$/);
    job.find((s) => s.value === 'Docs Awaited').hidden = true;
    expect((await write({ job, plan })).status).toBe(200);
    // Retired, a job already at it still saves at it.
    const kept = await createJob({ status: 'Docs Awaited' });
    expect(kept.body.result.status).toBe('Docs Awaited');
  });

  it('the Program Book starts a row, and moves a plan, by its statuses', async () => {
    await auth(request(app).post('/settings/customsPlanning')).send({ enabled: true });
    const save = (rows) => auth(request(app).post('/customsJob/plans/save')).send({ companyId, rows });
    const mine = async () => (await auth(request(app).get('/customsJob/plans/get')).set('companyid', companyId))
      .body.result.filter((p) => String(p.invoiceNo || '').startsWith(TEST_PREFIX));

    expect((await save([{ invoiceNo: `${TEST_PREFIX}SINV-1`, status: '' }])).body.status).toBe('success');
    const [plan] = await mine();
    expect(plan.status).toBe('Docs Ready');

    const refused = await auth(request(app).post('/customsJob/plans/move'))
      .send({ companyId, ids: [plan.id], fiscalYearId, employeeId: admin.employee?.id });
    expect(refused.status).toBe(409);
    expect(refused.body.result).toMatch(/it is Docs Ready - set its Job Status to Confirmed first\.$/);

    // New jobs start at a status of the admin's choosing; the moved plan says so.
    const { job, plan: book } = await defaults();
    job.forEach((s) => { s.rules = s.rules.filter((r) => r !== 'start'); });
    job.find((s) => s.value === 'Docs Awaited').rules.push('start');
    job.find((s) => s.value === 'Docs Awaited').hidden = false;
    expect((await write({ job, plan: book })).status).toBe(200);
    await save([{ ...plan, status: 'Confirmed' }]);
    const moved = await auth(request(app).post('/customsJob/plans/move'))
      .send({ companyId, ids: [plan.id], fiscalYearId, employeeId: admin.employee?.id });
    expect(moved.body.status).toBe('success');
    jobIds.push(moved.body.result[0].jobId);
    const [after] = await mine();
    expect(after.Customs_Job.status).toBe('Docs Awaited');
  });
});

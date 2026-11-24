const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const db = require('../../models');
const grants = require('../../functions/permissions/grants');

/* NEW JOB ALERTS - "New job created: TP-123/27 by Admin" to the picked
 * designations, asked for once a minute (the user, 2026-11-23). */
describe('new job alerts', () => {
  const KEY = 'newJobAlerts';
  let admin; let ceo; let operator; let before; const made = [];

  const ask = (who, cursor) => request(app).get('/notifications/newJobs')
    .query(cursor || {}).set('Authorization', who.authHeader);
  const save = (designations, who = admin) => request(app).post('/settings/newJobAlerts')
    .set('Authorization', who.authHeader).send({ designations });
  const freightJob = async (data) => {
    const j = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}NJ-${Date.now()}-${made.length}`, operation: 'SE', companyId: '1', ...data },
      { fiscalYearCheck: false },
    );
    made.push(j.id);
    return j;
  };

  beforeAll(async () => {
    before = (await db.AppSetting.findOne({ where: { key: KEY } }))?.value;
    await db.AppSetting.destroy({ where: { key: KEY } });
    admin = await loginAs('admin');
    ceo = await loginAs('ceo');
    operator = await loginAs('gd operator');
  });

  beforeEach(() => grants._resetCache());

  afterAll(async () => {
    await db.SE_Job.destroy({ where: { id: made } });
    await db.Employee_Company.destroy({ where: { EmployeeId: ceo.employee.id } });
    await db.AppSetting.destroy({ where: { key: KEY } });
    if (before != null) await db.AppSetting.create({ key: KEY, value: before });
  });

  it('nobody gets them until designations are picked', async () => {
    const res = await ask(ceo);
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ subscribed: false });
  });

  it('the System login reads and sets who gets them; nobody else does', async () => {
    expect((await save(['ceo'], ceo)).status).toBe(403);
    expect((await request(app).get('/settings/newJobAlerts').set('Authorization', ceo.authHeader)).status).toBe(403);
    expect((await save(['ceo', 'janitor'])).status).toBe(400);
    const res = await save(['CEO']);
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ designations: ['ceo'] });
    const read = await request(app).get('/settings/newJobAlerts').set('Authorization', admin.authHeader);
    expect(read.body.result).toEqual({ designations: ['ceo'] });
    expect(read.body.designations).toContain('gd operator');
  });

  it('a first ask only sets the starting point; the next brings what was made since', async () => {
    await freightJob({ createdBy: 'Somebody Earlier' });
    const first = await ask(ceo);
    expect(first.body.result.subscribed).toBe(true);
    expect(first.body.result.jobs).toEqual([]);
    const { cursor } = first.body.result;
    expect(Object.keys(cursor)).toEqual(['freight', 'customs', 'aviation']);

    const job = await freightJob({ createdBy: 'Admin' });
    const next = await ask(ceo, cursor);
    expect(next.body.result.jobs).toEqual([{ kind: 'freight', id: job.id, jobNo: job.jobNo, createdBy: 'Admin' }]);
    expect(next.body.result.cursor.freight).toBe(job.id);

    // Asked again from there: nothing new.
    const again = await ask(ceo, next.body.result.cursor);
    expect(again.body.result.jobs).toEqual([]);
  });

  it('leaves out your own jobs and migrated ones, but moves past them', async () => {
    const { cursor } = (await ask(ceo)).body.result;
    const me = await db.Employees.findByPk(ceo.employee.id);
    await freightJob({ createdBy: me.name });
    const migrated = await freightJob({ createdBy: null, climaxId: 424242 });
    const res = await ask(ceo, cursor);
    expect(res.body.result.jobs).toEqual([]);
    expect(res.body.result.cursor.freight).toBe(migrated.id);
  });

  it('a designation not picked is told nothing', async () => {
    const res = await ask(operator, { freight: 0, customs: 0, aviation: 0 });
    expect(res.body.result).toEqual({ subscribed: false });
  });

  it('a user kept to some companies hears only of jobs in them', async () => {
    const { cursor } = (await ask(ceo)).body.result;
    const company = await anyCompany();
    const mine = String(company.id);
    await db.Employee_Company.create({ EmployeeId: ceo.employee.id, CompanyId: company.id });
    grants.invalidate(ceo.employee.id);
    const inMine = await freightJob({ createdBy: 'Admin', companyId: mine });
    await freightJob({ createdBy: 'Admin', companyId: `${mine}999` });
    const res = await ask(ceo, cursor);
    expect(res.body.result.jobs.map((j) => j.id)).toEqual([inMine.id]);
  });
});

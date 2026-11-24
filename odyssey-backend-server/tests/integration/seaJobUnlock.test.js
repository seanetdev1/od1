const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const db = require('../../models');

/* A CEO, CFO OR ADMIN CAN UNLOCK AN APPROVED FREIGHT JOB - routes/jobRoutes/sea
 * /unlock, as /customsJob/unlock does for an invoiced declaration.
 *
 * An approved job is locked on the screen, and once a charge on it is
 * approved it cannot be un-approved either. Unlock opens it for one save
 * without un-approving anything; the unlock and the save each leave their own
 * History entry, and the save is checked again on the server. */
describe('unlocking an approved freight job', () => {
  const stamp = Date.now();
  let authHeader; let employeeAuth; let employeeId; let fiscalYear; let company;
  let approvedJob; let openJob;
  const made = [];

  const auth = (req, header = authHeader) => req.set('Authorization', header)
    .set('x-fiscal-year-id', String(fiscalYear.id)).set('x-company-id', String(company.id));
  const createJob = async (approved) => {
    const res = await auth(request(app).post('/seaJob/create')).send({
      employeeId,
      data: {
        operation: 'SE', companyId: company.id, fiscalYearId: fiscalYear.id, jobDate: '2026-09-01', shipDate: '2026-09-05',
        customCheck: [], transportCheck: [], equipments: [], approved,
      },
    });
    expect(res.body.status).toBe('success');
    made.push(res.body.result.id);
    return res.body.result;
  };
  const unlock = (id, header) => auth(request(app).post('/seaJob/unlock'), header).send({ id, employeeId });
  const edit = (job, extra, header) => auth(request(app).post('/seaJob/edit'), header).send({
    employeeId,
    data: {
      ...job, companyId: company.id, customCheck: [], transportCheck: [], equipments: [], approved: true, ...extra,
    },
  });
  const historyOf = (type, jobNo) => db.History.count({ where: { formName: 'Job', type, docNo: jobNo } });

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    ({ authHeader: employeeAuth } = await loginAs('employee'));
    fiscalYear = await anyFiscalYear();
    company = await db.Company.create({ title: `${TEST_PREFIX}Unlock ${stamp}`, short: `UL${String(stamp).slice(-3)}` });
    approvedJob = await createJob(true);
    openJob = await createJob(false);
  });

  afterAll(async () => {
    const jobNos = [approvedJob?.jobNo, openJob?.jobNo].filter(Boolean);
    await db.History.destroy({ where: { formName: 'Job', docNo: jobNos } });
    if (made.length) await db.SE_Job.destroy({ where: { id: made }, fiscalYearCheck: false });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('refuses anyone who is not a CEO, CFO or admin', async () => {
    const res = await unlock(approvedJob.id, employeeAuth);
    expect(res.status).toBe(403);
    expect(await historyOf('Unlock', approvedJob.jobNo)).toBe(0);
  });

  it('records the unlock in History', async () => {
    const res = await unlock(approvedJob.id);
    expect(res.status).toBe(200);
    expect(res.body.result.jobNo).toBe(approvedJob.jobNo);
    expect(await historyOf('Unlock', approvedJob.jobNo)).toBe(1);
  });

  it('an unlocked save goes through, as its own History entry', async () => {
    const res = await edit(approvedJob, { unlocked: true, customerRef: `${TEST_PREFIX}REF` });
    expect(res.status).toBe(200);
    expect((await db.SE_Job.findByPk(approvedJob.id)).customerRef).toBe(`${TEST_PREFIX}REF`);
    expect(await historyOf('Edit (unlocked)', approvedJob.jobNo)).toBe(1);
  });

  it('refuses an unlocked save from anyone else, and changes nothing', async () => {
    const res = await edit(approvedJob, { unlocked: true, customerRef: `${TEST_PREFIX}OTHER` }, employeeAuth);
    expect(res.status).toBe(403);
    expect((await db.SE_Job.findByPk(approvedJob.id)).customerRef).toBe(`${TEST_PREFIX}REF`);
  });

  it('a job that is not approved is not locked', async () => {
    const res = await unlock(openJob.id);
    expect(res.status).toBe(409);
  });

  it('rejects an unusable id or a job that is not there', async () => {
    expect((await unlock('abc')).status).toBe(400);
    expect((await unlock(999999999)).status).toBe(404);
  });
});

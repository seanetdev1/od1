const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const db = require('../../models');

/* The freight job's Loading Program and Delivery Order tabs save, and save
 * again. A Delivery Order could only ever be saved once: every later save
 * threw before writing. */
describe('freight job Loading Program and Delivery Order', () => {
  const stamp = Date.now();
  let admin; let fiscalYear; let company; let job;

  const post = (path, body) => request(app).post(`/seaJob/${path}`)
    .set('Authorization', admin.authHeader).set('x-fiscal-year-id', String(fiscalYear.id))
    .send({ employeeId: admin.employee.id, SEJobId: job.id, ...body });
  const get = (path) => request(app).get(`/seaJob/${path}`)
    .set('Authorization', admin.authHeader).set('id', String(job.id));

  beforeAll(async () => {
    admin = await loginAs('admin');
    fiscalYear = await anyFiscalYear();
    company = await db.Company.create({ title: `${TEST_PREFIX}Tabs Co ${stamp}`, short: 'TTC' });
    job = await db.SE_Job.create({
      jobNo: `${TEST_PREFIX}SIJ-${stamp}`, operation: 'SI', companyId: String(company.id), createdById: admin.employee.id,
      FiscalYearId: fiscalYear.id,
    }, { fiscalYearCheck: false });
  });

  afterAll(async () => {
    await db.Loading_Program.destroy({ where: { SEJobId: job.id } });
    await db.Delivery_Order.destroy({ where: { SEJobId: job.id } });
    await db.SE_Job.destroy({ where: { id: job.id }, fiscalYearCheck: false });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('a Loading Program saves, and saves again over itself', async () => {
    const first = await post('upsertLoadingProgram', { berth: 'B-1', sobDate: '2026-10-01T00:00:00.000Z' });
    expect(first.status).toBe(200);
    const id = first.body.result[0].id;

    const again = await post('upsertLoadingProgram', { id, berth: 'B-7', gatePassDate: '2026-10-03T00:00:00.000Z' });
    expect(again.status).toBe(200);
    const saved = (await get('getLoadingProgram')).body.result;
    expect(saved).toMatchObject({ id, berth: 'B-7', gatePassDate: '2026-10-03T00:00:00.000Z' });
    expect(await db.Loading_Program.count({ where: { SEJobId: job.id } })).toBe(1);
  });

  it('a Delivery Order is numbered on its first save and updated on every later one', async () => {
    const first = await post('upsertDeliveryOrder', { operation: 'SI', companyId: String(company.id), remarks: 'one' });
    expect(first.status).toBe(200);
    const { id, doNo } = first.body.result[0];
    expect(doNo).toMatch(/^TTC-DO\d+-\d\d$/);

    // An edit of the saved order - this is the save that always failed.
    const edit = await post('upsertDeliveryOrder', { id, doNo, operation: 'SI', companyId: String(company.id), remarks: 'two' });
    expect(edit.status).toBe(200);
    expect((await get('getDeliveryOrder')).body.result).toMatchObject({ id, doNo, remarks: 'two' });

    // The number without the id still updates that order, not a second one.
    const noId = await post('upsertDeliveryOrder', { doNo, operation: 'SI', companyId: String(company.id), remarks: 'three' });
    expect(noId.status).toBe(200);
    expect(await db.Delivery_Order.count({ where: { SEJobId: job.id } })).toBe(1);
    expect((await get('getDeliveryOrder')).body.result).toMatchObject({ id, doNo, remarks: 'three' });
  });

  it('a Loading Program that cannot be saved says why', async () => {
    const res = await post('upsertLoadingProgram', { id: 'not-a-number' });
    expect(res.status).toBe(500);
    expect(res.body.result).not.toMatch(/reading 'name'/);
  });
});

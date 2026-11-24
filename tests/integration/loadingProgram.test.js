const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* SAVING A LOADING PROGRAM - /seaJob/upsertLoadingProgram.
 *
 * It was Model.upsert: INSERT ... ON CONFLICT ("id"), which a database whose
 * Loading_Programs has lost its primary key refuses outright. Now the job's
 * program is updated, or one is made - and a job keeps ONE, even when a save
 * arrives without the id. */
describe('saving a loading program', () => {
  let admin; let job;

  const save = (body) => request(app).post('/seaJob/upsertLoadingProgram')
    .set('Authorization', admin.authHeader).send({ employeeId: admin.id, ...body });

  beforeAll(async () => {
    admin = await loginAs('admin');
    job = await db.SE_Job.create({ jobNo: `${TEST_PREFIX}LP-${Date.now()}`, operation: 'SE' }, { fiscalYearCheck: false });
  });

  afterAll(async () => {
    await db.Loading_Program.destroy({ where: { SEJobId: job.id } });
    await db.SE_Job.destroy({ where: { id: job.id } });
  });

  it('makes the job\'s program, and answers with its id as before', async () => {
    const res = await save({ SEJobId: job.id, berth: 'QICT', wharf: 'QFS', loadingDate: '' });
    expect(res.body.status).toBe('success');
    const [row, created] = res.body.result;
    expect(created).toBe(true);
    expect(row).toMatchObject({ SEJobId: job.id, berth: 'QICT' });
    expect(row.id).toBeTruthy();
  });

  it('updates it by id', async () => {
    const existing = await db.Loading_Program.findOne({ where: { SEJobId: job.id } });
    const res = await save({ id: existing.id, SEJobId: job.id, berth: 'KICT' });
    expect(res.body.result[1]).toBe(false);
    expect(res.body.result[0]).toMatchObject({ id: existing.id, berth: 'KICT' });
  });

  it('a save without the id updates the job\'s program - never a second one', async () => {
    const res = await save({ SEJobId: job.id, berth: 'PICT' });
    expect(res.body.status).toBe('success');
    const rows = await db.Loading_Program.findAll({ where: { SEJobId: job.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].berth).toBe('PICT');
  });

  it('reads back what was saved', async () => {
    const res = await request(app).get('/seaJob/getLoadingProgram')
      .set('Authorization', admin.authHeader).set('id', String(job.id));
    expect(res.body.result).toMatchObject({ SEJobId: job.id, berth: 'PICT' });
  });
});

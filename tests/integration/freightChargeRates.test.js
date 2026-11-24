const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* A FREIGHT JOB'S CHARGE SHEET AND ITS USD RATES - /invoice/saveHeadesNew
 * (the user's requests, 2026-10-13). An open USD charge at a rate of 1 is
 * refused; the job keeps a Buying rate beside its Selling one (exRate). */
describe('freight charge rates', () => {
  const stamp = Date.now();
  let admin; let job;

  const save = (charges, rates = {}) => request(app).post('/invoice/saveHeadesNew')
    .set('Authorization', admin.authHeader)
    .send({ id: job.id, exRate: '280.5', exRateBuying: '279.25', employeeId: admin.employee.id, deleteList: [], charges, ...rates });
  const line = (over) => ({
    charge: `${TEST_PREFIX}OF`, particular: 'OCEAN FREIGHT', type: 'Recievable', currency: 'USD', status: '0',
    qty: '1', rate_charge: '100', amount: '1', net_amount: '100', ex_rate: '280.5', local_amount: '28050', SEJobId: job.id, ...over,
  });

  beforeAll(async () => {
    admin = await loginAs('admin');
    job = await db.SE_Job.create({ jobNo: `${TEST_PREFIX}RT-${stamp}`, operation: 'SE', exRate: '1' }, { fiscalYearCheck: false });
  });

  afterAll(async () => {
    await db.Charge_Head.destroy({ where: { SEJobId: job.id } });
    await db.SE_Job.destroy({ where: { id: job.id }, fiscalYearCheck: false });
  });

  it('an open USD charge at a rate of 1 is refused, and nothing is saved', async () => {
    const res = await save([line({ ex_rate: '1', local_amount: '100' })]);
    expect(res.status).toBe(400);
    expect(res.body.result).toBe('Charge line 1 (OCEAN FREIGHT, USD) needs an exchange rate above 1.');
    expect(await db.Charge_Head.count({ where: { SEJobId: job.id } })).toBe(0);
    expect((await db.SE_Job.findByPk(job.id, { raw: true })).exRate).toBe('1');
  });

  it('saved with its rate - and the job keeps both its Selling and its Buying rate', async () => {
    const res = await save([line(), line({ type: 'Payble', ex_rate: '279.25', local_amount: '27925' })]);
    expect(res.status).toBe(200);
    expect(await db.SE_Job.findByPk(job.id, { raw: true })).toMatchObject({ exRate: '280.5', exRateBuying: '279.25' });
  });

  it('a line already approved at 1 does not hold the sheet up', async () => {
    const res = await save([line(), line({ ex_rate: '1', status: '1' })]);
    expect(res.status).toBe(200);
  });
});

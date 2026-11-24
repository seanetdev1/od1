const request = require('supertest');
const app = require('../../index');
const { loginAs } = require('../helpers/auth');
const db = require('../../models');

/* Config > Report Columns: the columns a report opens with. Admin writes,
 * anyone reads (the report needs them), and only known reports exist. */
describe('report columns setting', () => {
  const KEY = 'reportColumns.jobBalancingGrid';
  let admin; let employee; let before;

  const get = () => request(app).get('/settings/reportColumns/jobBalancingGrid').set('Authorization', employee.authHeader);
  const save = (columns, who = admin) => request(app).post('/settings/reportColumns/jobBalancingGrid')
    .set('Authorization', who.authHeader).send({ columns });

  beforeAll(async () => {
    admin = await loginAs('admin');
    employee = await loginAs('employee');
    // Whatever the test database already holds is put back afterwards.
    before = await db.AppSetting.findOne({ where: { key: KEY } });
    if (before) before = before.value;
    await db.AppSetting.destroy({ where: { key: KEY } });
  });

  afterAll(async () => {
    await db.AppSetting.destroy({ where: { key: KEY } });
    if (before != null) await db.AppSetting.create({ key: KEY, value: before });
  });

  it('is unset to begin with - the report opens on its own columns', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.result).toBeNull();
  });

  it('keeps the columns an admin saves, in their order, once each', async () => {
    const res = await save(['invoice_No', 'jobCols.jobNo', 'balance', 'invoice_No']);
    expect(res.body.result).toEqual(['invoice_No', 'jobCols.jobNo', 'balance']);
    expect((await get()).body.result).toEqual(['invoice_No', 'jobCols.jobNo', 'balance']);
  });

  it('saved empty, goes back to the report\'s own columns', async () => {
    await save(['balance']);
    expect((await save([])).body.result).toBeNull();
    expect((await get()).body.result).toBeNull();
    expect(await db.AppSetting.count({ where: { key: KEY } })).toBe(0);
  });

  it('refuses what is not a list of column ids', async () => {
    expect((await save(['no', 'drop table;'])).status).toBe(400);
    expect((await save('balance')).status).toBe(400);
  });

  it('is an admin\'s to change', async () => {
    expect((await save(['balance'], employee)).status).toBe(403);
  });

  it('keeps the VAT Detail\'s apart from the Job Balancing grid\'s', async () => {
    const VAT_KEY = 'reportColumns.vatDetail';
    const vatBefore = await db.AppSetting.findOne({ where: { key: VAT_KEY } });
    try {
      await save(['balance']);
      const res = await request(app).post('/settings/reportColumns/vatDetail')
        .set('Authorization', admin.authHeader).send({ columns: ['buyer', 'tax', 'value'] });
      expect(res.body.result).toEqual(['buyer', 'tax', 'value']);
      const read = await request(app).get('/settings/reportColumns/vatDetail').set('Authorization', employee.authHeader);
      expect(read.body.result).toEqual(['buyer', 'tax', 'value']);
      expect((await get()).body.result).toEqual(['balance']);
    } finally {
      await db.AppSetting.destroy({ where: { key: VAT_KEY } });
      if (vatBefore) await db.AppSetting.create({ key: VAT_KEY, value: vatBefore.value });
    }
  });

  it('only for a report it knows', async () => {
    const res = await request(app).post('/settings/reportColumns/anything').set('Authorization', admin.authHeader).send({ columns: ['a'] });
    expect(res.status).toBe(404);
    expect(await db.AppSetting.count({ where: { key: 'reportColumns.anything' } })).toBe(0);
  });
});

/**
 * What a new Direct Job E / R entry starts as - /settings/directJobDefaultType
 * (Configuration > Direct Job), against Postgres.
 *
 * EXPENSE until an admin picks revenue (the user's call, 2026-10-20): most
 * entries made through Direct Job are costs.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs } = require('../helpers/auth');
const { AppSetting } = require('../../models');

describe('Direct Job default type - /settings/directJobDefaultType', () => {
  const KEY = 'directJobDefaultType';
  let admin; let employee; let kept;

  const read = (who) => request(app).get('/settings/directJobDefaultType').set('Authorization', who.authHeader);
  const save = (body, who = admin) => request(app).post('/settings/directJobDefaultType')
    .set('Authorization', who.authHeader).send(body);

  beforeAll(async () => {
    admin = await loginAs('admin');
    employee = await loginAs('employee');
    kept = (await AppSetting.findOne({ where: { key: KEY } }))?.value ?? null;
  });

  afterAll(async () => {
    await AppSetting.destroy({ where: { key: KEY } });
    if (kept != null) await AppSetting.create({ key: KEY, value: kept });
  });

  it('is expense until somebody picks revenue - and anyone can read it', async () => {
    await AppSetting.destroy({ where: { key: KEY } });
    const res = await read(employee);
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ type: 'expense' });
  });

  it('an admin can pick revenue; nobody else can', async () => {
    expect((await save({ type: 'revenue' }, employee)).status).toBe(403);
    expect((await save({ type: 'revenue' })).body.result).toEqual({ type: 'revenue' });
    expect((await read(employee)).body.result).toEqual({ type: 'revenue' });
    expect((await save({ type: 'expense' })).body.result).toEqual({ type: 'expense' });
  });

  it('refuses anything but the two', async () => {
    const res = await save({ type: 'income' });
    expect(res.status).toBe(400);
    expect(res.body.result).toMatch(/revenue or expense/);
  });

  it('a stored value it does not know reads as the default', async () => {
    await AppSetting.destroy({ where: { key: KEY } });
    await AppSetting.create({ key: KEY, value: 'garbage' });
    expect((await read(employee)).body.result).toEqual({ type: 'expense' });
  });
});

const request = require('supertest');
const app = require('../../index');
const { loginAs } = require('../helpers/auth');
const db = require('../../models');

/* REPORT DATES - where the period reports' From and To start (Configuration >
 * Reports; the user, 2026-11-11). The screens work the dates out
 * (functions/reportDates in the frontend); the server keeps the choice. */
describe('report dates setting', () => {
  const KEY = 'reportDates';
  let admin; let employee; let before;
  const get = (who) => request(app).get('/settings/reportDates').set('Authorization', who.authHeader);
  const set = (body, who = admin) => request(app).post('/settings/reportDates').set('Authorization', who.authHeader).send(body);

  beforeAll(async () => {
    admin = await loginAs('admin');
    employee = await loginAs('employee');
    before = (await db.AppSetting.findOne({ where: { key: KEY } }))?.value;
    await db.AppSetting.destroy({ where: { key: KEY } });
  });

  afterAll(async () => {
    await db.AppSetting.destroy({ where: { key: KEY } });
    if (before != null) await db.AppSetting.create({ key: KEY, value: before });
  });

  it('starts as it always was: start of the fiscal year to today, and lists the choices', async () => {
    const res = await get(employee);
    expect(res.body.result).toEqual({ from: 'fiscalStart', to: 'today' });
    expect(res.body.options).toEqual({ from: ['fiscalStart', 'yearStart'], to: ['today', 'fiscalEnd', 'yearEnd'] });
  });

  it('an admin sets it; every user reads it', async () => {
    expect((await set({ from: 'fiscalStart', to: 'fiscalEnd' })).body.result).toEqual({ from: 'fiscalStart', to: 'fiscalEnd' });
    expect((await get(employee)).body.result).toEqual({ from: 'fiscalStart', to: 'fiscalEnd' });
    expect((await set({ from: 'yearStart', to: 'yearEnd' })).body.result).toEqual({ from: 'yearStart', to: 'yearEnd' });
  });

  it('refuses a choice it does not know, or one missing - and keeps what was set', async () => {
    expect((await set({ from: 'fiscalStart', to: 'nextWeek' })).status).toBe(400);
    expect((await set({ to: 'today' })).status).toBe(400);
    expect((await get(employee)).body.result).toEqual({ from: 'yearStart', to: 'yearEnd' });
  });

  it('is an admin\'s to change', async () => {
    expect((await set({ from: 'fiscalStart', to: 'today' }, employee)).status).toBe(403);
  });

  it('a damaged stored value reads as the default, not an error', async () => {
    await db.AppSetting.update({ value: 'not json' }, { where: { key: KEY } });
    expect((await get(employee)).body.result).toEqual({ from: 'fiscalStart', to: 'today' });
  });
});

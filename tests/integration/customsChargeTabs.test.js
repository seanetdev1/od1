const request = require('supertest');
const app = require('../../index');
const { loginAs } = require('../helpers/auth');
const db = require('../../models');

/* CHARGES IN TABS - whether a customs job's Charges tab puts Receivable,
 * Payable and Summary on tabs of their own (Configuration > Customs; the user,
 * 2026-11-11: one install wants tabs, CargoLinkers does not). Layout only: the
 * job screen reads it, every user may; only an admin may change it. */
describe('customs charges in tabs setting', () => {
  const KEY = 'customsChargeTabs';
  let admin; let employee; let before;
  const get = (who) => request(app).get('/settings/customsChargeTabs').set('Authorization', who.authHeader);
  const set = (body, who = admin) => request(app).post('/settings/customsChargeTabs').set('Authorization', who.authHeader).send(body);

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

  it('is off until an admin turns it on - one page, as before', async () => {
    expect((await get(employee)).body.result).toEqual({ enabled: false });
  });

  it('an admin turns it on and off; every user reads it', async () => {
    expect((await set({ enabled: true })).body.result).toEqual({ enabled: true });
    expect((await get(employee)).body.result).toEqual({ enabled: true });
    expect((await set({ enabled: false })).body.result).toEqual({ enabled: false });
    expect((await get(employee)).body.result).toEqual({ enabled: false });
  });

  it('refuses anyone else, and anything but true or false - keeping what was set', async () => {
    await set({ enabled: true });
    expect((await set({ enabled: false }, employee)).status).toBe(403);
    expect((await set({ enabled: 'yes' })).status).toBe(400);
    expect((await set({})).status).toBe(400);
    expect((await get(employee)).body.result).toEqual({ enabled: true });
  });
});

const request = require('supertest');
const moment = require('moment');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* THE FREIGHT JOB COUNTERS - Jobs Today, This Week, This Month. Today
 * replaced the year (the user, 2026-11-23), and is Pakistan's today: the
 * servers run in UTC, whose midnight is 5 am here. */
describe('freight job counters', () => {
  const WIDGETS_KEY = 'dashboardWidgets';
  let ceo; let before; const made = [];

  const counters = async () => {
    const res = await request(app).get('/home/getDashboard').set('Authorization', ceo.authHeader);
    expect(res.status).toBe(200);
    return res.body.result;
  };
  const job = async (suffix) => {
    const j = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}CNT-${Date.now()}-${suffix}`, operation: 'SE' },
      { fiscalYearCheck: false },
    );
    made.push(j.id);
    return j;
  };

  beforeAll(async () => {
    // The default grid - CEO sees the job counters.
    before = (await db.AppSetting.findOne({ where: { key: WIDGETS_KEY } }))?.value;
    await db.AppSetting.destroy({ where: { key: WIDGETS_KEY } });
    ceo = await loginAs('ceo');
  });

  afterAll(async () => {
    await db.SE_Job.destroy({ where: { id: made } });
    if (before != null) await db.AppSetting.create({ key: WIDGETS_KEY, value: before });
  });

  it('counts today, the week and the month - no longer the year', async () => {
    const c = await counters();
    expect(c).toEqual(expect.objectContaining({
      dayCount: expect.any(Number), weekCount: expect.any(Number), monthCount: expect.any(Number),
    }));
    expect(c).not.toHaveProperty('yearCount');
  });

  it('a job opened now is today\'s; one opened before midnight in Pakistan is not', async () => {
    const start = await counters();
    await job('now');
    const lateYesterday = await job('yesterday');
    // 23:59 yesterday in Karachi - still "today" on a UTC clock until 19:00 UTC.
    const at = moment().utcOffset(300).startOf('day').subtract(1, 'minute').toDate();
    await db.sequelize.query('UPDATE "SE_Jobs" SET "createdAt" = :at WHERE id = :id',
      { replacements: { at, id: lateYesterday.id } });

    const end = await counters();
    expect(end.dayCount).toBe(start.dayCount + 1);
    expect(end.weekCount).toBe(start.weekCount + 2);
  });
});

const request = require('supertest');
const app = require('../../index');
const { loginAs } = require('../helpers/auth');
const db = require('../../models');
const grants = require('../../functions/permissions/grants');
const permissions = require('../../functions/permissions/middleware');
const { REFUSAL } = require('../../functions/dashboardWidgets');

/* WHICH DESIGNATION SEES WHICH HOME-PAGE WIDGET (Configuration > Dashboard
 * Widgets; the user, 2026-11-23). Per designation; CEO, CFO and admin see all
 * five until the grid is saved; the widgets' own routes refuse the rest. */
describe('dashboard widgets', () => {
  const KEY = 'dashboardWidgets';
  const ALL = ['jobCounters', 'incomeExpense', 'cashFlow', 'pendingInvoices', 'auditLog'];
  let admin; let ceo; let operator; let nobody; let before;

  const get = (who, path) => request(app).get(path).set('Authorization', who.authHeader);
  const mine = async (who) => (await get(who, '/home/widgets')).body.result.widgets;
  const save = (widgets, who = admin) => request(app).post('/settings/dashboardWidgets')
    .set('Authorization', who.authHeader).send({ widgets });

  // Every route a widget reads from, and the widget it belongs to.
  const ROUTES = [
    ['/home/getDashboard', 'jobCounters'],
    ['/customsJob/dashboard', 'jobCounters'],
    ['/aviationJob/dashboard', 'jobCounters'],
    ['/home/getCashFlowTwo', 'incomeExpense'],
    ['/home/getCashFlow', 'cashFlow'],
    ['/home/accounts/get', 'pendingInvoices'],
  ];

  beforeAll(async () => {
    before = (await db.AppSetting.findOne({ where: { key: KEY } }))?.value;
    await db.AppSetting.destroy({ where: { key: KEY } });
    admin = await loginAs('admin');
    ceo = await loginAs('ceo');
    operator = await loginAs('gd operator');
    nobody = await loginAs('employee');
  });

  beforeEach(() => grants._resetCache());

  afterAll(async () => {
    await db.AppSetting.destroy({ where: { key: KEY } });
    if (before != null) await db.AppSetting.create({ key: KEY, value: before });
  });

  it('starts at CEO, CFO and admin: all five for them, none for anyone else', async () => {
    expect(await mine(ceo)).toEqual(ALL);
    expect(await mine(admin)).toEqual(ALL);
    expect(await mine(operator)).toEqual([]);
    expect(await mine(nobody)).toEqual([]);
  });

  it('refuses a widget\'s route to a designation not ticked for it', async () => {
    for (const [path] of ROUTES) {
      const res = await get(operator, path);
      expect([path, res.status]).toEqual([path, 403]);
      expect(res.body.result).toBe(REFUSAL);
    }
  });

  it('answers a designation that is ticked', async () => {
    for (const [path] of ROUTES) {
      const res = await get(ceo, path);
      expect([path, res.status]).toEqual([path, 200]);
    }
  });

  it('the System login reads and saves the grid; nobody else does', async () => {
    const read = await get(admin, '/settings/dashboardWidgets');
    expect(read.status).toBe(200);
    expect(read.body.result.jobCounters).toEqual(['ceo', 'cfo', 'admin']);
    expect(read.body.widgets.map((w) => w.key)).toEqual(ALL);
    expect(read.body.designations).toContain('gd operator');
    expect((await get(ceo, '/settings/dashboardWidgets')).status).toBe(403);
    expect((await save({ jobCounters: ['ceo'] }, ceo)).status).toBe(403);
  });

  it('once saved, the ticks decide - for the screen and the routes', async () => {
    const res = await save({
      jobCounters: ['gd operator', 'Manager'],
      incomeExpense: ['ceo'], cashFlow: ['ceo'], pendingInvoices: ['ceo', 'cfo'], auditLog: ['admin'],
    });
    expect(res.status).toBe(200);
    expect(res.body.result.jobCounters).toEqual(['manager', 'gd operator']);

    expect(await mine(operator)).toEqual(['jobCounters']);
    expect(await mine(ceo)).toEqual(['incomeExpense', 'cashFlow', 'pendingInvoices']);
    // Unticking admin means it - its admin access does not bring them back.
    expect(await mine(admin)).toEqual(['auditLog']);

    expect((await get(operator, '/home/getDashboard')).status).toBe(200);
    expect((await get(operator, '/home/getCashFlowTwo')).status).toBe(403);
    expect((await get(ceo, '/home/getDashboard')).status).toBe(403);
    expect((await get(ceo, '/home/getCashFlowTwo')).status).toBe(200);
  });

  it('refuses a grid it does not understand, and keeps what was saved', async () => {
    expect((await save({ jobCounters: ['janitor'] })).status).toBe(400);
    expect((await save({ weather: ['ceo'] })).status).toBe(400);
    expect((await save(null)).status).toBe(400);
    expect(await mine(operator)).toEqual(['jobCounters']);
  });

  it('goes by the designation stored now, not the one the session was signed with', async () => {
    await db.Employees.update({ designation: 'ceo' }, { where: { id: operator.employee.id } });
    grants.invalidate(operator.employee.id);
    expect(await mine(operator)).toEqual(['incomeExpense', 'cashFlow', 'pendingInvoices']);
    await db.Employees.update({ designation: 'gd operator' }, { where: { id: operator.employee.id } });
  });

  it('offers the Audit Log only to a user its report\'s right lets through', async () => {
    await save({ auditLog: ['ceo'] });
    permissions._setModeForTest('enforce');
    try {
      // Saved through the permission grid with one unrelated right: no party
      // rights (the old access names bring those by default, and a party's
      // screen reads the same history), so the report's route would refuse.
      await db.Access_Levels.create({ EmployeeId: ceo.employee.id, access_name: 'perm:charges:view' });
      grants.invalidate(ceo.employee.id);
      expect(await mine(ceo)).not.toContain('auditLog');
      expect((await get(ceo, '/history/getHistory')).status).toBe(403);
      await db.Access_Levels.create({ EmployeeId: ceo.employee.id, access_name: 'perm:rptAuditLog:view' });
      grants.invalidate(ceo.employee.id);
      expect(await mine(ceo)).toContain('auditLog');
    } finally {
      permissions._setModeForTest(null);
      await db.Access_Levels.destroy({ where: { EmployeeId: ceo.employee.id } });
    }
    // Audit mode lets the report's route through, so the widget is offered.
    grants.invalidate(ceo.employee.id);
    expect(await mine(ceo)).toContain('auditLog');
  });

  it('a damaged stored value reads as the default, not an error', async () => {
    await db.AppSetting.update({ value: 'not json' }, { where: { key: KEY } });
    expect(await mine(ceo)).toEqual(ALL);
    expect(await mine(operator)).toEqual([]);
  });
});

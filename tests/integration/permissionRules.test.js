// Access control is complete by construction: every route Express registers
// has a rule in functions/permissions/routeRules.js, and every rule names
// modules and actions the catalog has. Then the rules themselves, end to end.

const request = require('supertest');
const app = require('../../index');
const { loginAs, createEmployee, signTokenFor, TEST_PREFIX } = require('../helpers/auth');
const { Access_Levels, Permission_Denial } = require('../../models');
const sessionManager = require('../../functions/sessionManager');
const { RULES, ruleFor, OPEN, SYSTEM } = require('../../functions/permissions/routeRules');
const catalog = require('../../functions/permissions/catalog');
const grants = require('../../functions/permissions/grants');
const permissions = require('../../functions/permissions/middleware');

function registeredRoutes() {
  const prefixOf = (layer) => {
    if (layer.regexp.fast_slash) return '';
    const m = layer.regexp.source.match(/^\^((?:\\\/[^\\?(]+)+)/);
    return m ? m[1].replace(/\\\//g, '/') : '';
  };
  const out = [];
  const walk = (stack, base) => {
    for (const layer of stack) {
      if (layer.route) {
        Object.keys(layer.route.methods).forEach((m) => out.push([m.toUpperCase(), base + layer.route.path]));
      } else if (layer.name === 'router' && layer.handle.stack) {
        walk(layer.handle.stack, base + prefixOf(layer));
      }
    }
  };
  walk(app._router.stack, '');
  return out;
}

describe('the route table', () => {
  const routes = registeredRoutes();

  it('finds the app\'s routes at all', () => {
    expect(routes.length).toBeGreaterThan(400);
  });

  it('has a rule for every registered route', () => {
    const missing = routes.filter(([m, p]) => ruleFor(m, p) === undefined).map(([m, p]) => `${m} ${p}`);
    expect(missing).toEqual([]);
  });

  it('has no rule for a route that does not exist', () => {
    const registered = new Set(routes.map(([m, p]) => `${m} ${p.length > 1 ? p.replace(/\/+$/, '') : p}`));
    const conditional = new Set(['POST /ollama/chatDB']); // mounted only with OLLAMA_ENABLED
    const stale = Object.keys(RULES)
      .map((k) => { const [m, p] = k.split(' '); return `${m} ${p.length > 1 ? p.replace(/\/+$/, '') : p}`; })
      .filter((k) => !registered.has(k) && !conditional.has(k));
    expect(stale).toEqual([]);
  });

  // A rule may be async - the party rules read what kind of party it is.
  it('only names modules and actions the catalog has', async () => {
    const bad = [];
    for (const [key, rule] of Object.entries(RULES)) {
      if (rule === OPEN || rule === SYSTEM) continue;
      const alternatives = typeof rule === 'function'
        ? [...await rule({ query: {}, body: {} }), ...await rule({ query: { operation: 'SE' }, body: { data: { operation: 'AI' } } })]
        : rule;
      for (const a of alternatives) {
        const [mod, action] = a.split(':');
        if (!catalog.byKey[mod]?.actions.includes(action)) bad.push(`${key}: ${a}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('enforcement', () => {
  async function userWith(names, designation = 'employee') {
    const employee = await createEmployee({ designation });
    if (names.length) await Access_Levels.bulkCreate(names.map((access_name) => ({ access_name, EmployeeId: employee.id })));
    const token = signTokenFor(employee);
    await sessionManager.setSession(employee.id, token);
    return { employee, auth: `Bearer ${token}` };
  }
  const isRefused = (res) => res.status === 403;

  beforeAll(() => permissions._setModeForTest('enforce'));
  afterAll(async () => {
    permissions._setModeForTest(null);
    await Permission_Denial.destroy({ where: {} });
  });
  beforeEach(() => grants._resetCache());

  it('lets a view-only user read invoices but not approve them', async () => {
    const { auth } = await userWith(['perm:invoices:view']);
    expect(isRefused(await request(app).get('/invoice/getFilteredInvoices').set('Authorization', auth))).toBe(false);
    const res = await request(app).post('/invoice/approve').set('Authorization', auth).send({});
    expect(res.status).toBe(403);
    expect(res.body.result).toMatch(/invoices - approve/);
  });

  it('gives a legacy access name every action on its module', async () => {
    const { auth } = await userWith(['Invoice/Bills']);
    expect(isRefused(await request(app).post('/invoice/approve').set('Authorization', auth).send({}))).toBe(false);
  });

  it('narrows the freight job list to the operation asked for', async () => {
    const { auth } = await userWith(['ExSea']);
    expect(isRefused(await request(app).get('/seaJob/get?operation=SE&companyid=1').set('Authorization', auth))).toBe(false);
    expect(isRefused(await request(app).get('/seaJob/get?operation=SI&companyid=1').set('Authorization', auth))).toBe(true);
  });

  it('keeps party editing for legacy users, but not for a user granted through the grid without it', async () => {
    const legacy = await userWith(['ExSea']);
    expect(isRefused(await request(app).post('/clientRoutes/editClient').set('Authorization', legacy.auth).send({}))).toBe(false);
    const granular = await userWith(['perm:seaExport:view']);
    expect(isRefused(await request(app).post('/clientRoutes/editClient').set('Authorization', granular.auth).send({}))).toBe(true);
  });

  it('leaves pickers open to everyone', async () => {
    const { auth } = await userWith(['perm:seaExport:view']);
    expect(isRefused(await request(app).get('/accounts/getAllChilds').set('Authorization', auth))).toBe(false);
    expect(isRefused(await request(app).get('/charges/get').set('Authorization', auth))).toBe(false);
  });

  it('gates reports on their own module', async () => {
    const { auth } = await userWith(['perm:invoices:view']);
    expect(isRefused(await request(app).get('/misc/trialBalance/get').set('Authorization', auth))).toBe(true);
    const reporter = await userWith(['TrialBalance']);
    expect(isRefused(await request(app).get('/misc/trialBalance/get').set('Authorization', reporter.auth))).toBe(false);
  });

  it('lets the admin designation and the admin access name do anything', async () => {
    const { authHeader: auth } = await loginAs('admin');
    expect(isRefused(await request(app).post('/invoice/approve').set('Authorization', auth).send({}))).toBe(false);
    const named = await userWith(['admin']);
    expect(isRefused(await request(app).post('/voucher/deleteVoucher').set('Authorization', named.auth).send({}))).toBe(false);
  });

  it('ends a deactivated user\'s session on their next request', async () => {
    const { employee, auth } = await userWith(['Invoice/Bills']);
    await employee.update({ active: '0' });
    grants.invalidate(employee.id);
    const res = await request(app).get('/invoice/getFilteredInvoices').set('Authorization', auth);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Account deactivated');
  });

  it('takes away a revoked grant without waiting for sign-in', async () => {
    const { employee, auth } = await userWith(['TrialBalance']);
    expect(isRefused(await request(app).get('/misc/trialBalance/get').set('Authorization', auth))).toBe(false);
    await Access_Levels.destroy({ where: { EmployeeId: employee.id } });
    grants.invalidate(employee.id);   // what editEmployee does
    expect(isRefused(await request(app).get('/misc/trialBalance/get').set('Authorization', auth))).toBe(true);
  });
});

describe('audit mode', () => {
  beforeAll(() => permissions._setModeForTest('audit'));
  afterAll(async () => {
    permissions._setModeForTest(null);
    await Permission_Denial.destroy({ where: {} });
  });

  it('lets a refused request through and logs it', async () => {
    const employee = await createEmployee({ designation: 'employee' });
    await Access_Levels.create({ access_name: 'perm:invoices:view', EmployeeId: employee.id });
    const token = signTokenFor(employee);
    await sessionManager.setSession(employee.id, token);

    const res = await request(app).get('/misc/trialBalance/get').set('Authorization', `Bearer ${token}`);
    expect(res.status).not.toBe(403);

    let row;
    for (let i = 0; i < 20 && !row; i += 1) {
      row = await Permission_Denial.findOne({ where: { EmployeeId: employee.id, path: '/misc/trialBalance/get' } });
      if (!row) await new Promise((r) => setTimeout(r, 50));
    }
    expect(row.mode).toBe('audit');
    expect(row.required).toBe('rptTrialBalance:view');
    await Access_Levels.destroy({ where: { EmployeeId: employee.id } });
  });
});

describe('the session token', () => {
  it('carries the legacy names the sidebar reads, for grants made through the grid', () => {
    const names = grants.legacyNamesFor(['perm:invoices:view', 'perm:rptLedger:view'], 'employee');
    expect(names).toEqual(expect.arrayContaining(['Invoice/Bills', 'Ledger']));
    expect(names).not.toContain('admin');
  });
});

describe('saving a user through the grid', () => {
  it('stores only names the catalog knows, with legacy names written out as what they grant', async () => {
    const { authHeader: auth } = await loginAs('admin'); // system on the exempt suite install
    const res = await request(app).post('/employeeRoutes/createEmployee').set('Authorization', auth).send({
      values: {
        empName: `${TEST_PREFIX}Grid ${Date.now()}`, userName: `${TEST_PREFIX}grid_${Date.now()}`, code: `${TEST_PREFIX}G${Date.now()}`,
        pass: 'grid-pass-123', selectDesignation: 'employee',
        permissions: ['perm:invoices:view', 'perm:invoices:fly', 'perm:nope:view', 'ExSea', 'perm:rptLedger:view'],
      },
    });
    expect(res.body.status).toBe('success');
    const stored = (await Access_Levels.findAll({ where: { EmployeeId: res.body.result.id } })).map((r) => r.access_name).sort();
    // ExSea is the sea export and customs jobs, their charges (2026-10-10) and
    // the invoices raised from them (2026-10-20), Unapprove included
    // (2026-10-24); a grid save is marked as complete (catalog:4).
    const exSea = [
      ...['view', 'edit', 'delete', 'approve'].flatMap((a) => [`perm:seaExport:${a}`, `perm:customs:${a}`]),
      ...['view', 'edit', 'approve'].map((a) => `perm:jobCharges:${a}`),
      ...['view', 'raise', 'edit', 'delete', 'approve', 'unapprove'].map((a) => `perm:jobInvoices:${a}`),
    ];
    expect(stored).toEqual(['perm:invoices:view', 'perm:rptLedger:view', 'perm:catalog:4', ...exSea].sort());
    await Access_Levels.destroy({ where: { EmployeeId: res.body.result.id } });
  });
});

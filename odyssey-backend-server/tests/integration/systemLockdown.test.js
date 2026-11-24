// The leased-install lockdown: Config, migration and user management belong to
// Seanet ("system"), who signs in with a credential signed by the licence
// server. The client's admin keeps everything else.
//
// Runs as a LEASED install with a throwaway key pair standing in for the
// licence server's (tests/setupTestDb.js pins the rest of the suite to exempt).

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../index');
const { loginAs, createEmployee, TEST_PREFIX } = require('../helpers/auth');
const { Employees, History } = require('../../models');
const systemAccess = require('../../functions/systemAccess');
const throttle = require('../../functions/loginThrottle');
const { hashPassword } = require('../../functions/password');
const { JWT_SECRET } = require('../../functions/secrets');
const sessionManager = require('../../functions/sessionManager');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const INSTALL = 'odyssey-lockdown-test';
const HOUR = 60 * 60 * 1000;
const SUPPORT_NAME = `${TEST_PREFIX}support`;

function credential(overrides = {}) {
  const json = JSON.stringify({
    typ: 'support', install_id: INSTALL, name: SUPPORT_NAME,
    iat: Date.now() - 60000, exp: Date.now() + 2 * HOUR, ...overrides,
  });
  const sig = crypto.sign(null, Buffer.from(systemAccess.SUPPORT_DOMAIN + json, 'utf8'), privateKey);
  return `${systemAccess.PREFIX}${Buffer.from(json).toString('base64url')}.${sig.toString('base64url')}`;
}

async function supportLogin(c = credential()) {
  const res = await request(app).post('/authRoutes/systemLogin').send({ credential: c });
  return { res, authHeader: res.body.token ? `Bearer ${res.body.token.replace('BearerSplit', '')}` : null };
}

beforeAll(() => {
  systemAccess._setConfigForTest({
    LICENSE_EXEMPT: false,
    INSTALL_ID: INSTALL,
    LICENSE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
  });
});
afterAll(() => systemAccess._setConfigForTest({ LICENSE_EXEMPT: true }));
beforeEach(() => throttle._reset());

describe('a client admin on a leased install', () => {
  let authHeader;
  beforeAll(async () => { ({ authHeader } = await loginAs('admin')); });

  it.each([
    ['post', '/settings/documentNumbering'],
    ['post', '/settings/operationMode'],
    ['get', '/settings/emailConfig'],
    ['post', '/companies/createCompany'],
    ['post', '/companies/bankAccount/create'],
    ['post', '/employeeRoutes/createEmployee'],
    ['post', '/employeeRoutes/editEmployee'],
    ['post', '/employeeRoutes/uploadEmployees'],
    ['get', '/migration/counts'],
    ['post', '/charges/bulkCreate'],
    ['post', '/seaJob/UploadSEJobs'],
    ['post', '/voucher/importLedger'],
    ['get', '/accounts/chartOfAccounts/seed'],
  ])('is refused %s %s with a "managed by Seanet" 403', async (method, path) => {
    const res = await request(app)[method](path).set('Authorization', authHeader).send({});
    expect(res.status).toBe(403);
    expect(res.body.result).toBe(systemAccess.MANAGED_MESSAGE);
  });

  it('can still read the settings every screen reads', async () => {
    const res = await request(app).get('/settings/documentNumbering').set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });

  it('can still see the staff list', async () => {
    const res = await request(app).get('/employeeRoutes/getEmployees').set('Authorization', authHeader);
    expect(res.status).toBe(200);
  });

  // Whoever runs the install holds JWT_SECRET, so can sign any claim they like.
  it('gets nothing from a self-made token that claims to be system', async () => {
    const admin = await createEmployee({ designation: 'admin' });
    for (const sc of [null, 'ods1.made.up', credential({ iat: Date.now() - 3 * HOUR, exp: Date.now() - HOUR })]) {
      const token = jwt.sign({ id: admin.id, username: admin.name, designation: 'admin', access: 'admin', system: true, sc }, JWT_SECRET);
      await sessionManager.setSession(admin.id, token);
      const res = await request(app).get('/migration/counts').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
  });
});

describe('Seanet support login', () => {
  it('rejects a credential for another install, a forged one, or none', async () => {
    for (const c of [credential({ install_id: 'odyssey-IFA' }), 'ods1.abc.def', '']) {
      const { res } = await supportLogin(c);
      expect(res.status).toBe(401);
    }
  });

  it('opens a session that can do what the client admin cannot', async () => {
    const { res, authHeader } = await supportLogin();
    expect(res.status).toBe(200);
    const counts = await request(app).get('/migration/counts').set('Authorization', authHeader);
    expect(counts.status).toBe(200);
    const verify = await request(app).get('/authRoutes/verifyLogin').set('Authorization', authHeader);
    expect(verify.body.system).toBe(true);
  });

  it('runs under a hidden account that is not staff and cannot sign in with a password', async () => {
    const { authHeader } = await supportLogin();
    const row = await Employees.unscoped().findOne({ where: { username: `__system__:${SUPPORT_NAME.toLowerCase()}` } });
    expect(row.designation).toBe(systemAccess.SYSTEM_DESIGNATION);
    expect(row.password).toBeNull();

    const list = await request(app).get('/employeeRoutes/getEmployees').set('Authorization', authHeader);
    expect(list.body.result.map((e) => e.id)).not.toContain(row.id);
    const picker = await request(app).get('/employeeRoutes/getEmployeesIdAndName').set('Authorization', authHeader);
    expect(picker.body.result.map((e) => e.value)).not.toContain(row.id);

    const edit = await request(app).post('/employeeRoutes/editEmployee').set('Authorization', authHeader)
      .send({ values: { id: row.id, accessLevels: [] } });
    expect(edit.status).toBe(404);
  });

  it('records the support person, not whoever the request body names, in the audit log', async () => {
    const { authHeader } = await supportLogin();
    const someoneElse = await createEmployee({ designation: 'employee' });
    const name = `${TEST_PREFIX}Audited ${Date.now()}`;
    const res = await request(app).post('/employeeRoutes/createEmployee').set('Authorization', authHeader).send({
      employeeId: someoneElse.id,
      values: {
        empName: name, userName: `${TEST_PREFIX}audited_${Date.now()}`, code: `${TEST_PREFIX}A${Date.now()}`,
        pass: 'whatever-pass', selectDesignation: 'employee', accessLevels: [],
      },
    });
    expect(res.body.status).toBe('success');

    const support = await Employees.unscoped().findOne({ where: { username: `__system__:${SUPPORT_NAME.toLowerCase()}` } });
    let row;
    for (let i = 0; i < 20 && !row; i += 1) {   // createHistory is not awaited by the route
      row = await History.findOne({ where: { formName: 'Employee', docNo: name } });
      if (!row) await new Promise((r) => setTimeout(r, 50));
    }
    expect(row.EmployeeId).toBe(support.id);
  });
});

describe('password login', () => {
  it('refuses an account whose designation was set to system, even with the right password', async () => {
    const e = await createEmployee({ designation: 'system', password: await hashPassword('right-pass-1') });
    const res = await request(app).post('/authRoutes/login').send({ username: e.username, password: 'right-pass-1' });
    expect(res.status).toBe(401);
  });

  it('refuses a deactivated account', async () => {
    const e = await createEmployee({ designation: 'employee', password: await hashPassword('right-pass-2') });
    await e.update({ active: '0' });
    const res = await request(app).post('/authRoutes/login').send({ username: e.username, password: 'right-pass-2' });
    expect(res.status).toBe(403);
  });

  it(`locks a username out after ${throttle.MAX_FAILURES} wrong passwords, right password or not`, async () => {
    const e = await createEmployee({ designation: 'employee', password: await hashPassword('right-pass-3') });
    for (let i = 0; i < throttle.MAX_FAILURES; i += 1) {
      const res = await request(app).post('/authRoutes/login').send({ username: e.username, password: 'wrong' });
      expect(res.status).toBe(401);
    }
    const locked = await request(app).post('/authRoutes/login').send({ username: e.username, password: 'right-pass-3' });
    expect(locked.status).toBe(429);
  });
});

describe('changing your own password', () => {
  it('needs the current password and at least 8 characters, then takes effect', async () => {
    const e = await createEmployee({ designation: 'employee', password: await hashPassword('old-pass-123') });
    const login = await request(app).post('/authRoutes/login').send({ username: e.username, password: 'old-pass-123' });
    const auth = `Bearer ${login.body.token.replace('BearerSplit', '')}`;

    const wrong = await request(app).post('/authRoutes/changePassword').set('Authorization', auth)
      .send({ currentPassword: 'nope', newPassword: 'new-pass-456' });
    expect(wrong.status).toBe(400);
    const short = await request(app).post('/authRoutes/changePassword').set('Authorization', auth)
      .send({ currentPassword: 'old-pass-123', newPassword: 'short' });
    expect(short.status).toBe(400);
    const ok = await request(app).post('/authRoutes/changePassword').set('Authorization', auth)
      .send({ currentPassword: 'old-pass-123', newPassword: 'new-pass-456' });
    expect(ok.status).toBe(200);

    await sessionManager.clearSession(e.id);
    const again = await request(app).post('/authRoutes/login').send({ username: e.username, password: 'new-pass-456' });
    expect(again.status).toBe(200);
    await sessionManager.clearSession(e.id);
  });
});

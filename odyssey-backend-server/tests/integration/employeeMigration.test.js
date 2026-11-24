const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/**
 * The employees stage, scoped to TAP_Employee: staff records, not accounts.
 */
describe('Employee migration', () => {
  let admin, user;
  const BASE = 970000;

  const emp = (n, name, extra = {}) => ({
    Id: BASE + n,
    EmployeeName: `${TEST_PREFIX}${name}`,
    EmployeeCode: `E${n}`,
    ...extra,
  });

  beforeAll(async () => {
    admin = await loginAs('admin');
    user = await loginAs('employee');
  });

  afterEach(async () => {
    await db.Employees.destroy({ where: { climaxId: { [db.Sequelize.Op.gte]: BASE } } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/employeeRoutes/migration/users/plan')
      .set('Authorization', user.authHeader).send({ users: [], employees: [] });
    expect(res.status).toBe(403);
  });

  it('imports staff records as records, not accounts', async () => {
    const res = await request(app).post('/employeeRoutes/migration/users/apply')
      .set('Authorization', admin.authHeader)
      .send({ users: [], employees: [emp(1, 'BOSS', { IsSalesMan: true })] });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);

    const row = await db.Employees.unscoped().findOne({ where: { climaxId: BASE + 1 } });
    // No login, no password, no designation - nobody signs in as one of these.
    expect(row.username).toBeNull();
    expect(row.password).toBeNull();
    expect(row.designation).toBeNull();
    // But the job link is preserved, which is the whole reason they exist.
    expect(row.climaxId).toBe(BASE + 1);
    expect(row.represent).toBe('sr');
  });

  it('is safe to run twice', async () => {
    const employees = [emp(1, 'BOSS'), emp(2, 'MANAGEMENT')];
    await request(app).post('/employeeRoutes/migration/users/apply')
      .set('Authorization', admin.authHeader).send({ users: [], employees });
    const second = await request(app).post('/employeeRoutes/migration/users/apply')
      .set('Authorization', admin.authHeader).send({ users: [], employees });

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.stats.alreadyImported).toBe(2);
    expect(await db.Employees.count({ where: { climaxId: [BASE + 1, BASE + 2] } })).toBe(2);
  });

  it('marks an inactive staff record inactive rather than dropping it', async () => {
    await request(app).post('/employeeRoutes/migration/users/apply')
      .set('Authorization', admin.authHeader)
      .send({ users: [], employees: [emp(3, 'LEFT', { IsInactive: true })] });

    const row = await db.Employees.findOne({ where: { climaxId: BASE + 3 } });
    expect(row.active).toBe('0');
  });

  it('names a record with no name after its id rather than storing a blank', async () => {
    await request(app).post('/employeeRoutes/migration/users/apply')
      .set('Authorization', admin.authHeader)
      .send({ users: [], employees: [{ Id: BASE + 4 }] });

    const row = await db.Employees.findOne({ where: { climaxId: BASE + 4 } });
    expect(row.name).toBe(`Employee ${BASE + 4}`);
  });

  it('verify counts records separately from accounts', async () => {
    await request(app).post('/employeeRoutes/migration/users/apply')
      .set('Authorization', admin.authHeader)
      .send({ users: [], employees: [emp(1, 'A'), emp(2, 'B')] });

    const res = await request(app).get('/employeeRoutes/migration/users/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result.recordsOnly).toBeGreaterThanOrEqual(2);
    expect(res.body.result.duplicateUsernames).toEqual([]);
  });
});

const request = require('supertest');
const app = require('../../index');
const { loginAs, createEmployee, TEST_PREFIX } = require('../helpers/auth');
const { Employees } = require('../../models');
const { verifyPassword } = require('../../functions/password');

// routes/employees/index.js: getEmployees (the full staff list) is CEO/CFO/
// admin; createEmployee/editEmployee are system only - Seanet on a leased
// install, the admin on an exempt one, which is what this suite runs as (see
// tests/setupTestDb.js; tests/integration/systemLockdown.test.js covers the
// leased side). getEmployeesIdAndName, getRepresentativeEmployees and
// getManagers are intentionally left ungated - they fill dropdowns elsewhere
// in the app for any logged-in user.
describe('Employees access control - list for CEO/CFO/admin, create/edit for system', () => {
  const restrictedDesignations = ['employee', 'manager', 'accountant'];
  const listOnlyDesignations = ['CEO', 'CFO'];

  const makeEmployeePayload = (suffix) => ({
    values: {
      code: `${TEST_PREFIX}code_${suffix}`,
      userName: `${TEST_PREFIX}user_${suffix}`,
      empName: `${TEST_PREFIX}Employee ${suffix}`,
      fatherName: 'Father Name',
      email: `${TEST_PREFIX}${suffix}@example.com`,
      pass: 'irrelevant-plaintext-pass',
      phone: '0300-0000000',
      address: 'Test Address',
      cnic: '00000-0000000-0',
      selectDesignation: 'employee',
      selectDepart: 'Operations',
      selectManager: '',
      date: '2024-01-01',
      bank: '',
      accountNo: '',
      represent: '',
      defaultCompanyId: null,
      accessLevels: [],
    },
    // employeeId / createdBy intentionally omitted - createHistory() then
    // fails its own not-null validation internally and silently no-ops
    // (same pattern already relied on by partyAccessControl.test.js), so
    // this doesn't leave a History row behind that we'd need to clean up.
  });

  describe.each(restrictedDesignations)('as a non-privileged "%s"', (designation) => {
    let authHeader;

    beforeAll(async () => {
      ({ authHeader } = await loginAs(designation));
    });

    it('is blocked (403) from listing employees via /employeeRoutes/getEmployees', async () => {
      const res = await request(app)
        .get('/employeeRoutes/getEmployees')
        .set('Authorization', authHeader);
      expect(res.status).toBe(403);
    });

    it('is blocked (403) from creating an employee via /employeeRoutes/createEmployee', async () => {
      const res = await request(app)
        .post('/employeeRoutes/createEmployee')
        .set('Authorization', authHeader)
        .send(makeEmployeePayload(`${Date.now()}_blocked`));
      expect(res.status).toBe(403);
    });

    it('is blocked (403) from editing an employee via /employeeRoutes/editEmployee', async () => {
      const res = await request(app)
        .post('/employeeRoutes/editEmployee')
        .set('Authorization', authHeader)
        .send({ values: { id: '00000000-0000-0000-0000-000000000000', accessLevels: [] } });
      expect(res.status).toBe(403);
    });

    it('can still hit /employeeRoutes/getEmployeesIdAndName (ungated on purpose)', async () => {
      const res = await request(app)
        .get('/employeeRoutes/getEmployeesIdAndName')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.result)).toBe(true);
    });

    it('can still hit /employeeRoutes/getRepresentativeEmployees (ungated on purpose)', async () => {
      const res = await request(app)
        .get('/employeeRoutes/getRepresentativeEmployees')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result).toHaveProperty('Sr');
      expect(res.body.result).toHaveProperty('Dr');
      expect(res.body.result).toHaveProperty('Ar');
    });

    it('can still hit /employeeRoutes/getManagers (ungated on purpose), without password hashes', async () => {
      await createEmployee({ designation: 'manager' });
      const res = await request(app)
        .get('/employeeRoutes/getManagers')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result.length).toBeGreaterThan(0);
      res.body.result.forEach((row) => expect(row).not.toHaveProperty('password'));
    });
  });

  describe.each(listOnlyDesignations)('as a "%s"', (designation) => {
    let authHeader;

    beforeAll(async () => {
      ({ authHeader } = await loginAs(designation));
    });

    it('can list employees, and the list carries no password hashes', async () => {
      // The list shows active '1' staff; the helper stores 'true'.
      const listed = await createEmployee({ designation: 'employee' });
      await listed.update({ active: '1' });
      const res = await request(app)
        .get('/employeeRoutes/getEmployees')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.result.length).toBeGreaterThan(0);
      res.body.result.forEach((row) => expect(row).not.toHaveProperty('password'));
    });

    // A CEO or CFO used to be able to create an admin, or reset the admin's
    // password and sign in as them.
    it('cannot create or edit an employee (403)', async () => {
      const created = await request(app)
        .post('/employeeRoutes/createEmployee')
        .set('Authorization', authHeader)
        .send(makeEmployeePayload(`${Date.now()}_${designation}_nocreate`));
      expect(created.status).toBe(403);

      const edited = await request(app)
        .post('/employeeRoutes/editEmployee')
        .set('Authorization', authHeader)
        .send({ values: { id: '00000000-0000-0000-0000-000000000000', accessLevels: [] } });
      expect(edited.status).toBe(403);
    });
  });

  describe('as the admin of an exempt install (system)', () => {
    const designation = 'admin';
    let authHeader;

    beforeAll(async () => {
      ({ authHeader } = await loginAs(designation));
    });

    it('can list employees via /employeeRoutes/getEmployees', async () => {
      const res = await request(app)
        .get('/employeeRoutes/getEmployees')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.result)).toBe(true);
    });

    it('can create an employee via /employeeRoutes/createEmployee', async () => {
      const suffix = `${Date.now()}_${designation}`;
      const res = await request(app)
        .post('/employeeRoutes/createEmployee')
        .set('Authorization', authHeader)
        .send(makeEmployeePayload(suffix));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result).toHaveProperty('id');
      expect(res.body.result.username).toBe(`${TEST_PREFIX}user_${suffix}`);
      expect(res.body.result).not.toHaveProperty('password');
    });

    it('reports status "exists" (still HTTP 200) when code or username is already taken', async () => {
      const suffix = `${Date.now()}_${designation}_dupe`;
      const payload = makeEmployeePayload(suffix);
      const first = await request(app)
        .post('/employeeRoutes/createEmployee')
        .set('Authorization', authHeader)
        .send(payload);
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('success');

      const second = await request(app)
        .post('/employeeRoutes/createEmployee')
        .set('Authorization', authHeader)
        .send(payload);
      expect(second.status).toBe(200);
      expect(second.body.status).toBe('exists');
    });

    it('can edit an employee via /employeeRoutes/editEmployee', async () => {
      const suffix = `${Date.now()}_${designation}_edit`;
      const created = await request(app)
        .post('/employeeRoutes/createEmployee')
        .set('Authorization', authHeader)
        .send(makeEmployeePayload(suffix));
      expect(created.body.status).toBe('success');
      const id = created.body.result.id;

      const payload = makeEmployeePayload(suffix);
      payload.values.id = id;
      payload.values.empName = `${TEST_PREFIX}Renamed ${suffix}`;

      const res = await request(app)
        .post('/employeeRoutes/editEmployee')
        .set('Authorization', authHeader)
        .send(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });

    // The list no longer sends hashes, so the form submits the password blank
    // unless one was typed - and blank must leave it alone.
    it('keeps the password when an edit leaves it blank, and sets it when one is typed', async () => {
      const suffix = `${Date.now()}_${designation}_pass`;
      const payload = makeEmployeePayload(suffix);
      payload.values.pass = 'original-pass-1';
      const created = await request(app)
        .post('/employeeRoutes/createEmployee')
        .set('Authorization', authHeader)
        .send(payload);
      const id = created.body.result.id;
      const stored = async () => (await Employees.unscoped().findByPk(id)).password;
      const before = await stored();

      payload.values.id = id;
      payload.values.pass = '';
      await request(app).post('/employeeRoutes/editEmployee').set('Authorization', authHeader).send(payload);
      expect(await stored()).toBe(before);

      payload.values.pass = 'replaced-pass-2';
      await request(app).post('/employeeRoutes/editEmployee').set('Authorization', authHeader).send(payload);
      expect(await verifyPassword('replaced-pass-2', await stored())).toBe(true);
    });

    it('cannot give anyone the reserved system designation', async () => {
      const payload = makeEmployeePayload(`${Date.now()}_reserved`);
      payload.values.selectDesignation = 'system';
      const res = await request(app)
        .post('/employeeRoutes/createEmployee')
        .set('Authorization', authHeader)
        .send(payload);
      expect(res.status).toBe(400);
    });
  });

  it('no longer serves the unguarded /employeeRoutes/createAccess', async () => {
    const { authHeader } = await loginAs('employee');
    const res = await request(app)
      .get('/employeeRoutes/createAccess')
      .set('Authorization', authHeader)
      .send([{ access_name: 'admin', EmployeeId: '00000000-0000-0000-0000-000000000000' }]);
    expect(res.status).toBe(404);
  });

  it('rejects requests with no auth token at all (401, before the designation check ever runs)', async () => {
    const res = await request(app).get('/employeeRoutes/getEmployees');
    expect(res.status).toBe(401);
  });
});

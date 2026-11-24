// A user restricted to some companies (Employee_Company) is refused a request
// that names any other, and offered only theirs. No rows = every company.

const request = require('supertest');
const app = require('../../index');
const { loginAs, createEmployee, signTokenFor, TEST_PREFIX } = require('../helpers/auth');
const { Company, Employee_Company, Access_Levels, Invoice } = require('../../models');
const sessionManager = require('../../functions/sessionManager');
const grants = require('../../functions/permissions/grants');
const companyAccess = require('../../functions/companyAccess');

// Inside one describe so the cleanup runs before tests/setupTestDb.js closes
// the connection - a top-level afterAll here runs after it.
describe('company access', () => {
  let mine;
  let other;
  const made = [];

  beforeAll(async () => {
    mine = await Company.create({ title: `${TEST_PREFIX}Mine Co`, short: 'TMC' });
    other = await Company.create({ title: `${TEST_PREFIX}Other Co`, short: 'TOC' });
    made.push(mine, other);
  });
  afterAll(async () => {
    await Employee_Company.destroy({ where: { CompanyId: made.map((c) => c.id) } });
    await Company.destroy({ where: { id: made.map((c) => c.id) } });
  });
  beforeEach(() => grants._resetCache());

  async function userIn(companyIds, names = ['admin']) {
    const employee = await createEmployee({ designation: 'employee' });
    await Access_Levels.bulkCreate(names.map((access_name) => ({ access_name, EmployeeId: employee.id })));
    if (companyIds.length) await Employee_Company.bulkCreate(companyIds.map((CompanyId) => ({ EmployeeId: employee.id, CompanyId })));
    const token = signTokenFor(employee);
    await sessionManager.setSession(employee.id, token);
    return { employee, auth: `Bearer ${token}` };
  }

  describe('a user restricted to one company', () => {
    let auth;
    beforeAll(async () => { ({ auth } = await userIn([mine.id])); });

    it('is refused a request naming another company, wherever it names it', async () => {
      const asQuery = await request(app).get(`/customsJob/get?companyId=${other.id}`).set('Authorization', auth);
      expect(asQuery.status).toBe(403);
      const asHeader = await request(app).get('/seaJob/get?operation=SE').set('companyid', String(other.id)).set('Authorization', auth);
      expect(asHeader.status).toBe(403);
      const asJobData = await request(app).post('/customsJob/create').set('Authorization', auth).send({ data: { companyId: other.id } });
      expect(asJobData.status).toBe(403);
    });

    it('is not refused for their own company', async () => {
      const res = await request(app).get(`/customsJob/get?companyId=${mine.id}`).set('Authorization', auth);
      expect(res.status).not.toBe(403);
    });

    /* "ALL" IS THEIR COMPANIES (2026-10-24). It was refused - and Job
     * Balancing's page, which loads on the server, crashed on the refusal
     * with a bare 500. Now it is every company they work in, and a report
     * never shows them more - not even when no company is named, which the
     * reports used to read as every company on the install. */
    describe("Job Balancing, for 'all'", () => {
      const invoices = [];
      const jobBalancing = (company) => {
        const req = request(app).get('/invoice/jobBalancing').set('Authorization', auth)
          .set('from', '2026-01-01').set('to', '2026-12-31').set('paytype', 'All');
        return company === undefined ? req : req.set('company', company);
      };
      const listed = (res) => res.body.result.map((i) => i.id).filter((id) => invoices.includes(id));

      beforeAll(async () => {
        for (const c of [mine, other]) {
          const inv = await Invoice.create({
            invoice_No: `${TEST_PREFIX}CA-${c.id}-${Date.now()}`, type: 'Job Invoice', payType: 'Recievable',
            partyType: 'client', party_Name: 'X', currency: 'PKR', total: '100', approved: '1',
            companyId: String(c.id), createdAt: new Date('2026-06-01T00:00:00Z'),
          }, { fiscalYearCheck: false });
          invoices.push(inv.id);
        }
      });
      afterAll(async () => { await Invoice.destroy({ where: { id: invoices }, fiscalYearCheck: false }); });

      it("shows their own company - not refused, not everyone's", async () => {
        const res = await jobBalancing('all');
        expect(res.status).toBe(200);
        expect(listed(res)).toEqual([invoices[0]]);
      });

      it("nor everyone's when no company is named", async () => {
        expect(listed(await jobBalancing(undefined))).toEqual([invoices[0]]);
      });

      it('and refuses a list that names another company', async () => {
        expect((await jobBalancing(`${mine.id},${other.id}`)).status).toBe(403);
      });
    });

    // The picker's own company rides on every request; a stale one must not lock
    // them out of the request that loads the picker and puts it right.
    it('is not refused for a stale company in the header, and is offered only their own', async () => {
      const res = await request(app).get('/companies/mine').set('x-company-id', String(other.id)).set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(res.body.restricted).toBe(true);
      expect(res.body.result.map((c) => c.id)).toEqual([mine.id]);
    });
  });

  describe('a user with no company rows', () => {
    it('works in every company, and is offered all of them', async () => {
      const { auth } = await userIn([]);
      expect((await request(app).get(`/customsJob/get?companyId=${other.id}`).set('Authorization', auth)).status).not.toBe(403);
      const res = await request(app).get('/companies/mine').set('Authorization', auth);
      expect(res.body.restricted).toBe(false);
      expect(res.body.result.map((c) => c.id)).toEqual(expect.arrayContaining([mine.id, other.id]));
    });
  });

  describe('the header company', () => {
    it('counts only when the user may work in it', () => {
      const req = { headers: { 'x-company-id': String(other.id) } };
      expect(companyAccess.ambientCompany(req, null)).toBe(other.id);
      expect(companyAccess.ambientCompany(req, new Set([String(mine.id)]))).toBeNull();
      expect(companyAccess.ambientCompany({ headers: {} }, null)).toBeNull();
    });
  });

  describe('saving a user\'s companies', () => {
    it('stores the list, and an empty list means every company again', async () => {
      const { authHeader } = await loginAs('admin'); // system on the exempt suite install
      const base = {
        empName: `${TEST_PREFIX}Co ${Date.now()}`, userName: `${TEST_PREFIX}co_${Date.now()}`, code: `${TEST_PREFIX}C${Date.now()}`,
        pass: 'company-pass-1', selectDesignation: 'employee', accessLevels: [],
      };
      const created = await request(app).post('/employeeRoutes/createEmployee').set('Authorization', authHeader)
        .send({ values: { ...base, companyIds: [String(mine.id)] } });
      const id = created.body.result.id;
      expect((await Employee_Company.findAll({ where: { EmployeeId: id } })).map((r) => r.CompanyId)).toEqual([mine.id]);

      const list = await request(app).get('/employeeRoutes/getEmployees').set('Authorization', authHeader);
      // getEmployees lists active '1' staff; createEmployee stores 1.
      expect(list.body.result.find((e) => e.id === id).companyIds).toEqual([mine.id]);

      await request(app).post('/employeeRoutes/editEmployee').set('Authorization', authHeader)
        .send({ values: { ...base, id, companyIds: [] } });
      expect(await Employee_Company.count({ where: { EmployeeId: id } })).toBe(0);
    });
  });
});

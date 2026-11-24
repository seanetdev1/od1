// Per-company master data (functions/companySeparation.js): with a table
// switched on, lists made while working in a company show only the records it
// may see; lookups by id are never narrowed; records created in a company
// start out as that company's.

const request = require('supertest');
const app = require('../../index');
const { createEmployee, signTokenFor, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const sessionManager = require('../../functions/sessionManager');
const separation = require('../../functions/companySeparation');
const grants = require('../../functions/permissions/grants');

const { Company, Commodity, Clients, Record_Company, Employee_Company, Access_Levels, AppSetting } = db;

describe('per-company master data', () => {
  let a;
  let b;
  let auth;
  let previous;
  const commodities = [];

  const list = async (companyId, search) => {
    const res = await request(app).get(`/commodity/get?limit=200&search=${encodeURIComponent(search)}`)
      .set('Authorization', auth).set('x-company-id', String(companyId));
    expect(res.status).toBe(200);
    return { names: res.body.result.map((c) => c.name), total: res.body.pagination.totalRecords };
  };

  beforeAll(async () => {
    a = await Company.create({ title: `${TEST_PREFIX}Sep A`, short: 'TSA' });
    b = await Company.create({ title: `${TEST_PREFIX}Sep B`, short: 'TSB' });
    const employee = await createEmployee({ designation: 'employee' });
    await Access_Levels.create({ access_name: 'admin', EmployeeId: employee.id });
    const token = signTokenFor(employee);
    await sessionManager.setSession(employee.id, token);
    auth = `Bearer ${token}`;
    previous = (await AppSetting.findOne({ where: { key: separation.SETTING_KEY } }))?.value ?? null;
  });

  afterAll(async () => {
    await Record_Company.destroy({ where: { entity: 'Commodity', recordId: commodities.map((c) => String(c.id)) } });
    await Commodity.destroy({ where: { id: commodities.map((c) => c.id) } });
    await Employee_Company.destroy({ where: { CompanyId: [a.id, b.id] } });
    await Company.destroy({ where: { id: [a.id, b.id] } });
    if (previous !== null) await AppSetting.update({ value: previous }, { where: { key: separation.SETTING_KEY } });
    else await AppSetting.destroy({ where: { key: separation.SETTING_KEY } });
    separation._resetCache();
  });

  beforeEach(() => grants._resetCache());

  it('shows every record everywhere while the table is not separated', async () => {
    await separation.writeSeparation({ commodity: false });
    const tag = `${TEST_PREFIX}off${Date.now()}`;
    const c = await Commodity.create({ name: `${tag} rice` });
    commodities.push(c);
    await separation.setCompaniesOf('commodity', c.id, [a.id]);
    expect((await list(b.id, tag)).names).toEqual([`${tag} rice`]);
  });

  describe('with commodities separated', () => {
    const tag = `${TEST_PREFIX}sep${Date.now()}`;
    let onlyA;
    let shared;

    beforeAll(async () => {
      await separation.writeSeparation({ commodity: true });
      onlyA = await Commodity.create({ name: `${tag} only-a` });
      shared = await Commodity.create({ name: `${tag} shared` });
      commodities.push(onlyA, shared);
      await separation.setCompaniesOf('commodity', onlyA.id, [a.id]);
    });

    it('lists a company\'s own records and the shared ones, and counts the same', async () => {
      const inA = await list(a.id, tag);
      expect(inA.names.sort()).toEqual([`${tag} only-a`, `${tag} shared`]);
      expect(inA.total).toBe(2);
      const inB = await list(b.id, tag);
      expect(inB.names).toEqual([`${tag} shared`]);
      expect(inB.total).toBe(1);
    });

    it('never narrows a lookup by id', async () => {
      const res = await request(app).post('/commodity/edit').set('Authorization', auth).set('x-company-id', String(b.id))
        .send({ data: { id: onlyA.id, name: `${tag} only-a` } });
      expect(res.body.status).toBe('success');
      expect(res.body.result.id).toBe(onlyA.id);
    });

    it('gives a record created in a company to that company', async () => {
      const res = await request(app).post('/commodity/create').set('Authorization', auth).set('x-company-id', String(b.id))
        .send({ data: { name: `${tag} made-in-b` } });
      expect(res.body.status).toBe('success');
      commodities.push({ id: res.body.result.id });
      expect(await separation.companiesOf('commodity', res.body.result.id)).toEqual([b.id]);
      expect((await list(a.id, tag)).names).not.toContain(`${tag} made-in-b`);
    });

    it('can share a record, and an empty list makes it every company\'s again', async () => {
      const share = await request(app).post('/companies/visibility').set('Authorization', auth)
        .send({ table: 'commodity', recordId: onlyA.id, companyIds: [a.id, b.id] });
      expect(share.body.result).toEqual([a.id, b.id].sort((x, y) => x - y));
      expect((await list(b.id, tag)).names).toContain(`${tag} only-a`);

      await request(app).post('/companies/visibility').set('Authorization', auth)
        .send({ table: 'commodity', recordId: onlyA.id, companyIds: [] });
      const read = await request(app).get(`/companies/visibility?table=commodity&recordId=${onlyA.id}`).set('Authorization', auth);
      expect(read.body.result).toEqual([]);
    });

    it('does not narrow a request that asks for all companies', async () => {
      await separation.setCompaniesOf('commodity', onlyA.id, [a.id]);
      const res = await request(app).get(`/commodity/get?limit=200&search=${encodeURIComponent(tag)}&companyId=all`)
        .set('Authorization', auth).set('x-company-id', String(b.id));
      expect(res.body.result.map((c) => c.name)).toContain(`${tag} only-a`);
    });
  });

  it('narrows the staff pickers to who works in the company, with employees separated', async () => {
    await separation.writeSeparation({ employees: true });
    const inA = await createEmployee({ designation: 'employee' });
    await inA.update({ active: '1' });
    await Employee_Company.create({ EmployeeId: inA.id, CompanyId: a.id });

    const pick = async (companyId) => (await request(app).get('/employeeRoutes/getEmployeesIdAndName')
      .set('Authorization', auth).set('x-company-id', String(companyId))).body.result.map((e) => e.value);
    expect(await pick(a.id)).toContain(inA.id);
    expect(await pick(b.id)).not.toContain(inA.id);
    await Employee_Company.destroy({ where: { EmployeeId: inA.id } });
  });

  it('leaves parties alone when only commodities are separated', async () => {
    await separation.writeSeparation({ commodity: true, parties: false });
    const party = await Clients.create({ name: `${TEST_PREFIX}Sep Party ${Date.now()}`, types: 'Shipper' });
    await separation.setCompaniesOf('parties', party.id, [a.id]);
    const res = await request(app).get('/clientRoutes/getClientsForSelect').set('Authorization', auth).set('x-company-id', String(b.id));
    expect(res.body.result.map((p) => p.id)).toContain(party.id);
    await Record_Company.destroy({ where: { entity: 'Clients', recordId: String(party.id) } });
  });
});

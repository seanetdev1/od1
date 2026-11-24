const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('Job migration (job records only)', () => {
  let admin, user, company, client;
  const BASE = 980000;

  const job = (n, over = {}) => ({
    Id: BASE + n,
    JobNumber: `${TEST_PREFIX}JOB-${n}/24`,
    SubCompanyId: company?.climaxId,
    ClientId: client?.climaxId,
    ...over,
  });

  const body = (operation, jobs, over = {}) => ({
    operation, jobs,
    PropertiesLOV: [], Parties_Locations: [], IncoTerms: [], UNAirport: [], UNLocation: [],
    ...over,
  });

  const apply = (operation, jobs, over) => request(app).post('/jobMigration/apply')
    .set('Authorization', admin.authHeader).send(body(operation, jobs, over));

  const plan = (operation, jobs, over) => request(app).post('/jobMigration/plan')
    .set('Authorization', admin.authHeader).send(body(operation, jobs, over));

  beforeAll(async () => {
    admin = await loginAs('admin');
    user = await loginAs('employee');
    company = await db.Company.create({
      title: `${TEST_PREFIX}CO`, short: 'TCO', climaxId: BASE + 1,
    });
    client = await db.Clients.create({
      name: `${TEST_PREFIX}CLIENT`, climaxId: BASE + 2,
    });
  });

  afterAll(async () => {
    await db.Company.destroy({ where: { id: company.id } });
    await db.Clients.destroy({ where: { id: client.id } });
  });

  afterEach(async () => {
    await db.SE_Job.destroy({ where: { climaxId: { [db.Sequelize.Op.gte]: BASE } } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/jobMigration/plan')
      .set('Authorization', user.authHeader).send(body('SE', []));
    expect(res.status).toBe(403);
  });

  it('imports job records and resolves their foreign keys', async () => {
    const res = await apply('SE', [job(1)]);

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);

    const row = await db.SE_Job.findOne({ where: { climaxId: BASE + 1 } });
    expect(row.jobNo).toBe(`${TEST_PREFIX}JOB-1/24`);
    expect(row.operation).toBe('SE');
    expect(String(row.companyId)).toBe(String(company.id));
    expect(String(row.ClientId)).toBe(String(client.id));
  });

  it('imports ONLY the job record - no B/Ls, equipment or charge lines', async () => {
    // The scope of this stage. The old receiver walked a nested payload and
    // created all of these; this one must not, even when they are present.
    const blsBefore = await db.Bl.count();
    const equipBefore = await db.SE_Equipments.count();
    const headsBefore = await db.Charge_Head.count();

    const res = await apply('SE', [job(1, {
      SExp_BL: { Id: 1, HBLNo: 'SHOULD-NOT-IMPORT' },
      SExp_SeaExportJob_Equipment: [{ EquipCode: '20GP', Quantity: 2 }],
      SeaExportJob_ChargesRecv: [{ Id: 1, ChargesId: 1 }],
    })]);

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);
    expect(await db.Bl.count()).toBe(blsBefore);
    expect(await db.SE_Equipments.count()).toBe(equipBefore);
    expect(await db.Charge_Head.count()).toBe(headsBefore);
  });

  it('does not fail the batch when a vessel does not resolve', async () => {
    // The old receiver read `vessel.id` unguarded, so one job with an
    // unresolvable vessel threw and took the other nine in its batch with it.
    const res = await apply('SE', [
      job(1, { VesselId: 999999, VoyageNo: 'V1' }),
      job(2),
      job(3),
    ]);

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(3);
    const stranded = await db.SE_Job.findOne({ where: { climaxId: BASE + 1 } });
    expect(stranded.vesselId).toBeNull();
  });

  it('skips a job with no job number instead of throwing', async () => {
    const res = await apply('SE', [job(1, { JobNumber: null }), job(2)]);

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);
    expect(res.body.result.problems.missingJobNo).toEqual([BASE + 1]);
  });

  it('reports unresolved links, which a row count cannot see', async () => {
    const res = await plan('SE', [job(1, { SubCompanyId: 999999, CommodityId: 888888 })]);

    expect(res.body.result.unresolved.company).toBe(1);
    expect(res.body.result.unresolved.commodity).toBe(1);
    expect(res.body.result.stats.withoutCompany).toBe(1);
    expect(res.body.result.canApply).toBe(true);
  });

  it('keeps the four operations separate in one table', async () => {
    await apply('SE', [job(1)]);
    await apply('SI', [job(2)]);
    await apply('AE', [job(3, { FlightNo: 'EK601' })]);
    await apply('AI', [job(4)]);

    const rows = await db.SE_Job.findAll({
      where: { climaxId: { [db.Sequelize.Op.gte]: BASE } }, raw: true,
    });
    expect(rows.map((r) => r.operation).sort()).toEqual(['AE', 'AI', 'SE', 'SI']);
    expect(rows.find((r) => r.operation === 'AE').flightNo).toBe('EK601');
  });

  it('is safe to run twice', async () => {
    await apply('SE', [job(1), job(2)]);
    const second = await apply('SE', [job(1), job(2)]);

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.stats.alreadyImported).toBe(2);
    expect(await db.SE_Job.count({ where: { climaxId: { [db.Sequelize.Op.gte]: BASE } } })).toBe(2);
  });

  it('treats the same legacy id under a different operation as a different job', async () => {
    // Legacy ids are only unique within their own job table.
    await apply('SE', [job(1)]);
    const res = await apply('AE', [job(1)]);

    expect(res.body.result.created).toBe(1);
    expect(await db.SE_Job.count({ where: { climaxId: BASE + 1 } })).toBe(2);
  });

  it('plan writes nothing', async () => {
    const res = await plan('SE', [job(1)]);

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(await db.SE_Job.count({ where: { climaxId: BASE + 1 } })).toBe(0);
  });

  it('rejects a body with no valid operation', async () => {
    const res = await request(app).post('/jobMigration/apply')
      .set('Authorization', admin.authHeader).send({ operation: 'XX', jobs: [] });
    expect(res.status).toBe(400);
  });

  it('refuses an oversized batch rather than timing out', async () => {
    const huge = Array.from({ length: 501 }, (_, i) => job(i + 100));
    const res = await apply('SE', huge);

    expect(res.status).toBe(413);
    expect(res.body.result).toMatch(/exceeds the 500-row limit/);
  });

  it('verify reports jobs with no company as invisible', async () => {
    await apply('SE', [job(1, { SubCompanyId: 999999 })]);

    const res = await request(app).get('/jobMigration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result.withoutCompany).toBeGreaterThan(0);
    expect(res.body.result.healthy).toBe(false);
    expect(res.body.result.byOperation).toHaveProperty('SE');
  });
});

const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('Job equipment migration', () => {
  let admin, user, seJob, siJob;
  const BASE = 993000;

  const equip = (n, over = {}) => ({
    Id: BASE + n, SEJobId: BASE + 1, EquipCode: '40HC', Quantity: 2,
    PerUnitWeight: 3800, dDGNonDGId: 2, ...over,
  });

  const sizeTypes = [
    { EquipCode: '40HC', Teus: 2, PerUnitWeight: 3750 },
    { EquipCode: '20GP', Teus: 1, PerUnitWeight: 2200 },
  ];

  const send = (path, body) => request(app).post(`/jobEquipmentMigration/${path}`)
    .set('Authorization', admin.authHeader).send({ sizeTypes, ...body });
  const apply = (body) => send('apply', body);
  const plan = (body) => send('plan', body);

  beforeAll(async () => {
    admin = await loginAs('admin');
    user = await loginAs('employee');
    seJob = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}SEJOB`, operation: 'SE', climaxId: BASE + 1 },
      { fiscalYearCheck: false },
    );
    siJob = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}SIJOB`, operation: 'SI', climaxId: BASE + 2 },
      { fiscalYearCheck: false },
    );
  });

  afterAll(async () => {
    await db.SE_Job.destroy({ where: { id: [seJob.id, siJob.id] } });
  });

  afterEach(async () => {
    await db.SE_Equipments.destroy({ where: { SEJobId: [seJob.id, siJob.id] } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/jobEquipmentMigration/plan')
      .set('Authorization', user.authHeader).send({ operation: 'SE', rows: [] });
    expect(res.status).toBe(403);
  });

  it('imports equipment with the weight on the row, not the catalogue default', async () => {
    const res = await apply({ operation: 'SE', rows: [equip(10, { PerUnitWeight: 3800 })] });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);

    const row = await db.SE_Equipments.findOne({ where: { climaxId: BASE + 10 } });
    expect(String(row.gross)).toBe('3800');      // not 3750
    expect(String(row.teu)).toBe('2');           // TEU only exists on the catalogue
    expect(String(row.SEJobId)).toBe(String(seJob.id));
    expect(row.climaxId).toBe(BASE + 10);        // never set by the old import
  });

  it('falls back to the catalogue weight when the row has none', async () => {
    await apply({ operation: 'SE', rows: [equip(10, { PerUnitWeight: null })] });

    const row = await db.SE_Equipments.findOne({ where: { climaxId: BASE + 10 } });
    expect(String(row.gross)).toBe('3750');
  });

  it('does not fail the batch on a size code the catalogue does not list', async () => {
    // The old import read the catalogue entry unguarded, so one unknown size
    // code threw inside the job's transaction and took the batch with it.
    const res = await apply({
      operation: 'SE',
      rows: [equip(10, { EquipCode: 'NOSUCH', PerUnitWeight: null }), equip(11), equip(12)],
    });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(3);
    expect(res.body.result.problems.unknownSizeType).toContain('NOSUCH');

    const odd = await db.SE_Equipments.findOne({ where: { climaxId: BASE + 10 } });
    expect(odd.size).toBe('NOSUCH');
    expect(odd.teu === null || String(odd.teu) === '').toBe(true);
  });

  it('attaches SI equipment through SIJobId', async () => {
    const res = await apply({
      operation: 'SI',
      rows: [{ Id: BASE + 20, SIJobId: BASE + 2, EquipCode: '20GP', Quantity: 1 }],
    });

    expect(res.body.result.created).toBe(1);
    const row = await db.SE_Equipments.findOne({ where: { climaxId: BASE + 20 } });
    expect(String(row.SEJobId)).toBe(String(siJob.id));
    expect(String(row.teu)).toBe('1');
  });

  it('skips equipment whose job is not in Odyssey', async () => {
    const res = await apply({
      operation: 'SE', rows: [equip(10), equip(11, { SEJobId: 777777 })],
    });

    expect(res.body.result.created).toBe(1);
    expect(res.body.result.problems.orphaned).toContain(777777);
  });

  it('is safe to run twice - the job keeps the equipment it already has', async () => {
    const body = { operation: 'SE', rows: [equip(10), equip(11)] };
    await apply(body);
    const second = await apply(body);

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.stats.skippedJobs).toBe(2);
    expect(await db.SE_Equipments.count({ where: { SEJobId: seJob.id } })).toBe(2);
  });

  it('plan writes nothing', async () => {
    const res = await plan({ operation: 'SE', rows: [equip(10)] });

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(await db.SE_Equipments.count({ where: { SEJobId: seJob.id } })).toBe(0);
  });

  it('rejects an air operation, which has no equipment', async () => {
    for (const operation of ['AE', 'AI', 'XX']) {
      expect((await apply({ operation, rows: [] })).status).toBe(400);
    }
  });

  it('refuses an oversized batch', async () => {
    const huge = Array.from({ length: 2001 }, (_, i) => equip(i + 100));
    expect((await apply({ operation: 'SE', rows: huge })).status).toBe(413);
  });

  it('verify reports detached equipment and rows with no legacy id', async () => {
    await apply({ operation: 'SE', rows: [equip(10)] });
    // What the old import produced: equipment with no legacy id.
    const legacyish = await db.SE_Equipments.create({
      size: '20GP', qty: '1', SEJobId: seJob.id,
    });

    const res = await request(app).get('/jobEquipmentMigration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result.equipment).toBeGreaterThan(0);
    expect(res.body.result.withoutClimaxId).toBeGreaterThan(0);
    expect(res.body.result).toHaveProperty('jobsWithEquipment');
    expect(res.body.result).toHaveProperty('withoutTeu');

    await db.SE_Equipments.destroy({ where: { id: legacyish.id } });
  });
});

const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('B/L children migration', () => {
  let admin, user, seJob, aiJob, seBl, aeBl, aiBl;
  const BASE = 997000;

  const equip = (n, over = {}) => ({
    Id: BASE + n, SEBLId: BASE + 1, ContainerNo: `${TEST_PREFIX}C${n}`,
    SealNo: `S${n}`, EquipCode: '40HC', GrossWt: 1000, NetWt: 800,
    WTUnitId: 2, LoadTypeId: 2, ...over,
  });
  const awb = (Id, over = {}) => ({
    Id, NoOfPcs1: 5, UnitOfPcs1: 'CTN', GrossWeight1: '120', UnitOfWeightId1: 2,
    RateClass1: 'Q', ItemNumber1: 'IT-1', ChargeableWeight1: '130',
    RatePerCharge1: '2.5', ItemTotal1: '325', LineWeight1: '120', ...over,
  });

  const send = (path, body) => request(app).post(`/blChildMigration/${path}`)
    .set('Authorization', admin.authHeader).send(body);
  const apply = (body) => send('apply', body);
  const plan = (body) => send('plan', body);

  // No `silent: true` here: that suppresses the automatic updatedAt, and
  // unlike the migration mapper this fixture does not supply its own.
  const makeBl = (climaxId, operation, SEJobId) => db.Bl.create({
    operation, climaxId, SEJobId, hbl: `${TEST_PREFIX}${operation}-${climaxId}`,
  });

  beforeAll(async () => {
    admin = await loginAs('admin');
    user = await loginAs('employee');
    seJob = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}SEJOB`, operation: 'SE', climaxId: BASE + 90 },
      { fiscalYearCheck: false },
    );
    aiJob = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}AIJOB`, operation: 'AI', climaxId: BASE + 91 },
      { fiscalYearCheck: false },
    );
    seBl = await makeBl(BASE + 1, 'SE', seJob.id);
    aeBl = await makeBl(BASE + 2, 'AE', null);
    aiBl = await makeBl(BASE + 3, 'AI', aiJob.id);
  });

  afterAll(async () => {
    await db.Bl.destroy({ where: { id: [seBl.id, aeBl.id, aiBl.id] } });
    await db.SE_Job.destroy({ where: { id: [seJob.id, aiJob.id] } });
  });

  afterEach(async () => {
    const where = { BlId: [seBl.id, aeBl.id, aiBl.id] };
    await db.Container_Info.destroy({ where });
    await db.Stamps.destroy({ where });
    await db.Dimensions.destroy({ where });
    await db.Item_Details.destroy({ where });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/blChildMigration/plan')
      .set('Authorization', user.authHeader)
      .send({ kind: 'containers', operation: 'SE', rows: [] });
    expect(res.status).toBe(403);
  });

  it('imports containers with the tare weight the source actually has', async () => {
    // The old import computed GrossWt - NetWt, ignoring the TareWt column.
    const res = await apply({
      kind: 'containers', operation: 'SE',
      rows: [equip(10, { TareWt: 150 })],
      packing: [{ PackCode: 'CTN', PackName: 'CARTON' }],
    });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);

    const row = await db.Container_Info.findOne({ where: { climaxId: BASE + 10 } });
    expect(String(row.tare)).toBe('150');
    expect(String(row.BlId)).toBe(String(seBl.id));
    expect(row.climaxId).toBe(BASE + 10);     // never set by the old import
  });

  it('does not write NaN when a weight is missing', async () => {
    await apply({
      kind: 'containers', operation: 'SE',
      rows: [equip(10, { TareWt: null, GrossWt: 1000, NetWt: null })],
    });

    const row = await db.Container_Info.findOne({ where: { climaxId: BASE + 10 } });
    expect(row.tare === null || String(row.tare) === '').toBe(true);
    expect(String(row.tare)).not.toBe('NaN');
  });

  it('migrates the container free-day counts', async () => {
    const res = await apply({
      kind: 'containers', operation: 'SE',
      rows: [equip(10, { dFreeDaysDetention: 7, dFreeDaysDemurrage: 5, dFreeDaysPlugIn: 2 })],
    });

    expect(res.body.result.created).toBe(1);
    const row = await db.Container_Info.findOne({ where: { climaxId: BASE + 10 } });
    expect(String(row.detention)).toBe('7');
    expect(String(row.demurge)).toBe('5');
    expect(String(row.plugin)).toBe('2');
  });

  it('imports stamps through the stamp lookup', async () => {
    const res = await apply({
      kind: 'stamps', operation: 'SE',
      rows: [{ Id: BASE + 20, SEBLId: BASE + 1, StampId: 7, StampGroupId: 3 }],
      stamps: [{ Id: 7, StampCode: 'ST7', StampName: 'ORIGINAL' }],
    });

    expect(res.body.result.created).toBe(1);
    const row = await db.Stamps.findOne({ where: { climaxId: BASE + 20 } });
    expect(row.code).toBe('ST7');
    expect(row.stamps).toBe('ORIGINAL');
    expect(String(row.BlId)).toBe(String(seBl.id));
  });

  it('imports air dimensions, which were never imported at all before', async () => {
    const res = await apply({
      kind: 'dimensions', operation: 'AE',
      rows: [{ Id: BASE + 30, AEBLId: BASE + 2, dLength: '10', dWidth: '5', dHeight: '2',
        NoOfPcs: '3', Volume: '100', VolumetricWeight: '50' }],
    });

    expect(res.body.result.created).toBe(1);
    const rows = await db.Dimensions.findAll({ where: { BlId: aeBl.id }, raw: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].length).toBe('10');
    expect(rows[0].qty).toBe('3');
  });

  it('resolves air-import dimensions through the job to its waybill', async () => {
    // AImp_AirImportJob_BLDimension is keyed by AIJobId, not a B/L id.
    const res = await apply({
      kind: 'dimensions', operation: 'AI',
      rows: [{ Id: BASE + 31, AIJobId: BASE + 91, dLength: '7' }],
    });

    expect(res.body.result.created).toBe(1);
    const rows = await db.Dimensions.findAll({ where: { BlId: aiBl.id }, raw: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].length).toBe('7');
  });

  it('expands a waybill\'s inline blocks into rate lines', async () => {
    const res = await apply({
      kind: 'items', operation: 'AE',
      rows: [awb(BASE + 2, { NoOfPcs2: 3, UnitOfPcs2: 'PLT', NoOfPcs3: 0 })],
    });

    // One source row, two rate lines.
    expect(res.body.result.stats.source).toBe(1);
    expect(res.body.result.created).toBe(2);

    const rows = await db.Item_Details.findAll({ where: { BlId: aeBl.id }, raw: true });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.unit).sort()).toEqual(['CTN', 'PLT']);
    expect(rows.find((r) => r.unit === 'CTN').total).toBe('325');
  });

  it('skips a row whose B/L is not in Odyssey', async () => {
    const res = await apply({
      kind: 'containers', operation: 'SE',
      rows: [equip(10), equip(11, { SEBLId: 888888 })],
    });

    expect(res.body.result.created).toBe(1);
    expect(res.body.result.problems.orphaned).toContain(888888);
  });

  it('is safe to run twice - the B/L keeps the children it already has', async () => {
    const body = { kind: 'containers', operation: 'SE', rows: [equip(10), equip(11)] };
    await apply(body);
    const second = await apply(body);

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.stats.skippedParents).toBe(2);
    expect(await db.Container_Info.count({ where: { BlId: seBl.id } })).toBe(2);
  });

  it('plan writes nothing', async () => {
    const res = await plan({ kind: 'containers', operation: 'SE', rows: [equip(10)] });

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(await db.Container_Info.count({ where: { BlId: seBl.id } })).toBe(0);
  });

  it('rejects a kind that does not exist for the operation', async () => {
    // Containers are sea only; dimensions and rate lines are air only.
    expect((await apply({ kind: 'containers', operation: 'AE', rows: [] })).status).toBe(400);
    expect((await apply({ kind: 'dimensions', operation: 'SE', rows: [] })).status).toBe(400);
    expect((await apply({ kind: 'nonsense', operation: 'SE', rows: [] })).status).toBe(400);
  });

  it('refuses an oversized batch', async () => {
    const huge = Array.from({ length: 2001 }, (_, i) => equip(i + 100));
    const res = await apply({ kind: 'containers', operation: 'SE', rows: huge });
    expect(res.status).toBe(413);
  });

  it('verify reports detached children and rows with no legacy id', async () => {
    await apply({ kind: 'containers', operation: 'SE', rows: [equip(10)] });
    // What the old import produced: a container with no legacy id.
    const legacyish = await db.Container_Info.create({ no: `${TEST_PREFIX}OLD`, BlId: seBl.id });

    const res = await request(app).get('/blChildMigration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result.containers).toBeGreaterThan(0);
    expect(res.body.result.containersWithoutClimaxId).toBeGreaterThan(0);
    expect(res.body.result).toHaveProperty('seaBlsWithContainers');
    expect(res.body.result).toHaveProperty('airBlsWithItems');

    await db.Container_Info.destroy({ where: { id: legacyish.id } });
  });
});

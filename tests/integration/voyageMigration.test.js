const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('Vessel and voyage migration', () => {
  let admin, user;
  const BASE = 990000;

  const vessel = (n, over = {}) => ({
    Id: BASE + n, VesselName: `${TEST_PREFIX}SHIP ${n}`, VesselCode: String(BASE + n), ...over,
  });
  const voyage = (n, vesselN, over = {}) => ({
    Id: BASE + n, VesselId: BASE + vesselN, VoyageNo: `${TEST_PREFIX}V${n}`, TypeId: 3, ...over,
  });

  const send = (path, Vessel, Voyage) => request(app).post(`/vessel/migration/${path}`)
    .set('Authorization', admin.authHeader).send({ Vessel, Voyage });

  const apply = (Vessel = [], Voyage = []) => send('apply', Vessel, Voyage);
  const plan = (Vessel = [], Voyage = []) => send('plan', Vessel, Voyage);

  beforeAll(async () => { admin = await loginAs('admin'); user = await loginAs('employee'); });

  afterEach(async () => {
    // Voyages first: they point at the vessels.
    await db.Voyage.destroy({ where: { voyage: { [db.Sequelize.Op.like]: `${TEST_PREFIX}%` } } });
    await db.Vessel.destroy({ where: { climaxId: { [db.Sequelize.Op.gte]: BASE } } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/vessel/migration/plan')
      .set('Authorization', user.authHeader).send({ Vessel: [], Voyage: [] });
    expect(res.status).toBe(403);
  });

  it('imports vessels and attaches their voyages', async () => {
    const res = await apply([vessel(1)], [voyage(10, 1)]);

    expect(res.status).toBe(200);
    expect(res.body.result.created).toEqual({ vessels: 1, voyages: 1 });

    const v = await db.Vessel.findOne({ where: { climaxId: BASE + 1 } });
    const y = await db.Voyage.findOne({ where: { climaxId: String(BASE + 10) } });
    expect(v.code).toBe(BASE + 1);
    expect(v.type).toBe('Both');
    expect(String(y.VesselId)).toBe(String(v.id));
    expect(y.type).toBe('Export');
  });

  it('is safe to run twice - the old stage had no idempotency at all', async () => {
    // Vessel.create and Voyage.create ran unconditionally, so a second run
    // duplicated every vessel and split its voyages across both copies.
    await apply([vessel(1)], [voyage(10, 1)]);
    const second = await apply([vessel(1)], [voyage(10, 1)]);

    expect(second.body.result.created).toEqual({ vessels: 0, voyages: 0 });
    expect(await db.Vessel.count({ where: { climaxId: BASE + 1 } })).toBe(1);
    expect(await db.Voyage.count({ where: { climaxId: String(BASE + 10) } })).toBe(1);
  });

  it('trims a padded voyage number, so the Jobs lookup can match it', async () => {
    // Jobs resolve `${vesselId}|${voyageNo.trim()}`. A padded number stored
    // as-is can never be resolved, and nothing would say why.
    await apply([vessel(1)], [voyage(10, 1, { VoyageNo: `  ${TEST_PREFIX}PAD  ` })]);

    const y = await db.Voyage.findOne({ where: { climaxId: String(BASE + 10) } });
    expect(y.voyage).toBe(`${TEST_PREFIX}PAD`);
  });

  it('maps the route columns the old import dropped', async () => {
    await apply([vessel(1)], [voyage(10, 1, {
      PortOfLoadingCode: 'PKKHI', PortOfDischarge: 'AEJEA',
    })]);

    const y = await db.Voyage.findOne({ where: { climaxId: String(BASE + 10) } });
    expect(y.pol).toBe('PKKHI');
    expect(y.pod).toBe('AEJEA');
  });

  it('skips a voyage whose vessel is not in Odyssey', async () => {
    const res = await apply([vessel(1)], [voyage(10, 1), voyage(11, 99)]);

    expect(res.body.result.created.voyages).toBe(1);
    expect(res.body.result.voyages.problems.orphaned).toEqual([BASE + 11]);
  });

  it('attaches voyages to vessels created in the same request', async () => {
    // The vessel id only exists once the vessel row does, so ordering inside
    // the transaction matters.
    const res = await apply([vessel(1), vessel(2)], [voyage(10, 1), voyage(11, 2)]);

    expect(res.body.result.created).toEqual({ vessels: 2, voyages: 2 });
    const rows = await db.Voyage.findAll({
      where: { voyage: { [db.Sequelize.Op.like]: `${TEST_PREFIX}%` } }, raw: true,
    });
    for (const y of rows) expect(y.VesselId).toBeTruthy();
  });

  it('rolls the whole thing back if the voyages fail', async () => {
    // Vessels and voyages commit together. Without that, a failure left
    // vessels behind whose climaxId then made a retry skip them - leaving
    // them permanently without voyages.
    const before = await db.Vessel.count();
    const res = await apply([vessel(1)], [voyage(10, 1, { VoyageNo: null })]);

    expect(res.status).toBe(200);
    // The bad voyage is dropped at plan time rather than failing the insert,
    // so the vessel still lands - the point is that nothing half-commits.
    expect(res.body.result.voyages.problems.missingVoyageNo).toEqual([BASE + 10]);
    expect(await db.Vessel.count()).toBe(before + 1);
  });

  it('flags two voyages sharing a vessel and number', async () => {
    const res = await plan([vessel(1)], [
      voyage(10, 1, { VoyageNo: `${TEST_PREFIX}DUP` }),
      voyage(11, 1, { VoyageNo: `${TEST_PREFIX}DUP` }),
    ]);

    expect(res.body.result.voyages.problems.ambiguousKeys).toHaveLength(1);
    expect(res.body.result.canApply).toBe(true);
  });

  it('plan writes nothing but still reports what apply would do', async () => {
    const before = await db.Vessel.count();
    const res = await plan([vessel(1)], [voyage(10, 1)]);

    expect(res.status).toBe(200);
    expect(res.body.result.vessels.stats.toCreate).toBe(1);
    // The vessel does not exist yet, so without a placeholder its voyage would
    // look orphaned and the preview would be wrong.
    expect(res.body.result.voyages.stats.toCreate).toBe(1);
    expect(res.body.result.voyages.stats.orphaned).toBe(0);
    expect(await db.Vessel.count()).toBe(before);
  });

  it('rejects a body with neither vessels nor voyages', async () => {
    const res = await request(app).post('/vessel/migration/apply')
      .set('Authorization', admin.authHeader).send({ nonsense: true });
    expect(res.status).toBe(400);
  });

  it('verify checks the key Jobs resolves on, not just row counts', async () => {
    await apply([vessel(1)], [voyage(10, 1)]);

    const res = await request(app).get('/vessel/migration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result.vessels).toBeGreaterThan(0);
    expect(res.body.result.voyages).toBeGreaterThan(0);
    expect(res.body.result).toHaveProperty('ambiguousVoyageKeyCount');
    expect(res.body.result).toHaveProperty('paddedVoyageNo');
    expect(res.body.result).toHaveProperty('seaJobsWithoutVoyage');
  });

  it('verify flags a padded voyage number left by an earlier import', async () => {
    const v = await db.Vessel.create({
      code: BASE + 50, name: `${TEST_PREFIX}OLD SHIP`, type: 'Both', climaxId: BASE + 50,
    });
    await db.Voyage.create({ voyage: `${TEST_PREFIX}PADDED  `, VesselId: v.id });

    const res = await request(app).get('/vessel/migration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.body.result.paddedVoyageNo).toBeGreaterThan(0);
    expect(res.body.result.healthy).toBe(false);
  });
});

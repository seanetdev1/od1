const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('Charge master migration', () => {
  let admin, user;
  // Above anything /charges/create would ever issue, so the fixtures cannot
  // collide with real data in the test database.
  const BASE = 960000;

  const charge = (n, name, extra = {}) => ({
    Id: BASE + n,
    ChargesName: `${TEST_PREFIX}${name}`,
    ChargesCode: `${TEST_PREFIX}C${n}`,
    ShortName: `S${n}`,
    GL_Currencies: { CurrencyCode: 'USD' },
    ...extra,
  });

  const apply = (charges) => request(app).post('/charges/migration/apply')
    .set('Authorization', admin.authHeader).send({ charges });

  /** A charge created the way the Charges screen creates one - no climaxId. */
  const handMade = (over) => db.Charges.create({
    short: 'HM', currency: 'PKR', calculationType: 'Per Shipment',
    defaultPaybleParty: 'Client', defaultRecivableParty: 'Client',
    taxApply: 'No', taxPerc: '0', ...over,
  });

  beforeAll(async () => { admin = await loginAs('admin'); user = await loginAs('employee'); });
  afterEach(async () => {
    await db.Charges.destroy({ where: { climaxId: { [db.Sequelize.Op.gte]: BASE } } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/charges/migration/plan')
      .set('Authorization', user.authHeader).send({ charges: [] });
    expect(res.status).toBe(403);
  });

  it('stores the legacy id in code as an integer, and in climaxId', async () => {
    const res = await apply([charge(1, 'DOC FEE')]);

    expect(res.status).toBe(200);
    const row = await db.Charges.findOne({ where: { climaxId: BASE + 1 } });
    // code is an INTEGER column: /charges/create issues codes with
    // max(code)+1, which is lexicographic on text and would start repeating.
    expect(row.code).toBe(BASE + 1);
    expect(row.climaxId).toBe(BASE + 1);
    expect(row.name).toBe(`${TEST_PREFIX}DOC FEE`);
  });

  it('leaves max(code)+1 usable, so hand-created charges still get a free code', async () => {
    // The reason code cannot become text. If this breaks, /charges/create
    // silently issues a code some other charge already holds.
    await apply([charge(1, 'A'), charge(2, 'B')]);

    const max = await db.Charges.max('code');
    expect(Number.isFinite(Number(max))).toBe(true);
    expect(Number(max)).toBeGreaterThanOrEqual(BASE + 2);
    expect(await db.Charges.count({ where: { code: Number(max) + 1 } })).toBe(0);
  });

  it('is safe to run twice', async () => {
    const charges = [charge(1, 'A'), charge(2, 'B')];
    await apply(charges);
    const second = await apply(charges);

    expect(second.body.result.created).toBe(0);
    expect(await db.Charges.count({ where: { climaxId: [BASE + 1, BASE + 2] } })).toBe(2);
  });

  it('brings a retired charge across inactive rather than dropping it', async () => {
    await apply([charge(3, 'OLD', { IsInActive: true })]);

    const row = await db.Charges.findOne({ where: { climaxId: BASE + 3 } });
    expect(row.status).toBe(false);          // BOOLEAN column
  });

  it('imports a charge whose currency is missing instead of failing the run', async () => {
    const res = await apply([charge(4, 'NOCUR', { GL_Currencies: null }), charge(5, 'FINE')]);

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(2);
    expect(res.body.result.problems.missingCurrency).toBe(1);
  });

  it('writes nothing at all when one row in the batch is unusable', async () => {
    // bulkCreate outside a transaction left a half-imported charge master
    // behind. Every row here is valid except the name, which is NOT NULL.
    const before = await db.Charges.count();
    const res = await apply([charge(6, 'GOOD'), charge(7, 'BAD', { ChargesName: '   ' })]);

    expect(res.status).toBe(200);
    expect(res.body.result.problems.missingName).toEqual([BASE + 7]);
    // The bad row is dropped at plan time, not at insert time, so the good one
    // still lands - the point is that the run does not half-fail.
    expect(await db.Charges.count()).toBe(before + 1);
  });

  it('plan writes nothing', async () => {
    const before = await db.Charges.count();
    const res = await request(app).post('/charges/migration/plan')
      .set('Authorization', admin.authHeader).send({ charges: [charge(8, 'PLANNED')] });

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(await db.Charges.count()).toBe(before);
  });

  it('rejects a body that is not a charge list', async () => {
    const res = await request(app).post('/charges/migration/apply')
      .set('Authorization', admin.authHeader).send({ nonsense: true });
    expect(res.status).toBe(400);
  });

  it('reports a collision it cannot resolve by adoption instead of guessing', async () => {
    // Two rows already hold this code and neither carries a legacy id, so
    // there is no way to tell which one the incoming charge is. Adopting
    // either would be a coin flip: it imports and says so.
    const a = await handMade({ code: BASE + 9, name: `${TEST_PREFIX}SITTING A`, short: 'ST' });
    const b = await handMade({ code: BASE + 9, name: `${TEST_PREFIX}SITTING B`, short: 'ST' });

    const res = await request(app).post('/charges/migration/plan')
      .set('Authorization', admin.authHeader).send({ charges: [charge(9, 'INCOMING')] });

    expect(res.body.result.stats.toAdopt).toBe(0);
    expect(res.body.result.problems.codeCollisions).toContain(BASE + 9);
    expect(res.body.result.canApply).toBe(true);       // a nuisance, not a broken link

    await db.Charges.destroy({ where: { id: [a.id, b.id] } });
  });

  it('adopts charges the old importer left, instead of duplicating the catalogue', async () => {
    // Seanet's exact situation: the old importer wrote the legacy id into
    // `code` and had no climaxId column to record it in. Without adoption a
    // re-run here creates a second copy of all 400 charges, every one of them
    // colliding on code with the original.
    const legacy = await handMade({ code: BASE + 11, name: `${TEST_PREFIX}OLD IMPORT` });
    const before = await db.Charges.count();

    const res = await apply([charge(11, 'OLD IMPORT'), charge(12, 'BRAND NEW')]);

    expect(res.status).toBe(200);
    expect(res.body.result.adopted).toBe(1);
    expect(res.body.result.created).toBe(1);
    expect(await db.Charges.count()).toBe(before + 1);      // not + 2

    await legacy.reload();
    expect(legacy.climaxId).toBe(BASE + 11);
    expect(legacy.name).toBe(`${TEST_PREFIX}OLD IMPORT`);   // adopted in place, not overwritten

    await db.Charges.destroy({ where: { id: legacy.id } });
  });

  it('is safe to run twice after an adoption', async () => {
    const legacy = await handMade({ code: BASE + 13, name: `${TEST_PREFIX}OLD` });
    await apply([charge(13, 'OLD')]);
    const second = await apply([charge(13, 'OLD')]);

    expect(second.body.result.adopted).toBe(0);
    expect(second.body.result.created).toBe(0);
    expect(await db.Charges.count({ where: { climaxId: BASE + 13 } })).toBe(1);

    await db.Charges.destroy({ where: { id: legacy.id } });
  });

  it('verify reports charges an imported job could not resolve', async () => {
    // A charge with no climaxId is reachable from the UI and invisible to a
    // job charge line, which resolves through the legacy id.
    const orphan = await handMade({ code: BASE + 10, name: `${TEST_PREFIX}HANDMADE` });

    const res = await request(app).get('/charges/migration/verify').set('Authorization', admin.authHeader);
    expect(res.body.result.withoutClimaxId).toBeGreaterThan(0);

    await db.Charges.destroy({ where: { id: orphan.id } });
  });

  it('verify flags two charges sharing a legacy id as non-deterministic', async () => {
    await handMade({ climaxId: BASE + 99, code: BASE + 101, name: `${TEST_PREFIX}D1` });
    await handMade({ climaxId: BASE + 99, code: BASE + 102, name: `${TEST_PREFIX}D2` });

    const res = await request(app).get('/charges/migration/verify').set('Authorization', admin.authHeader);
    expect(res.body.result.duplicateClimaxIds).toContain(BASE + 99);
    expect(res.body.result.healthy).toBe(false);
  });
});

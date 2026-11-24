const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('Commodity master migration', () => {
  let admin, user;
  const BASE = 970000;

  const commodity = (n, name, extra = {}) => ({
    Id: BASE + n,
    CommodityName: `${TEST_PREFIX}${name}`,
    HSCode: '770000',
    CCargoTypeID: '1',
    IsInActive: false,
    IsHazmatProduct: false,
    ...extra,
  });

  const CargoTypes = [
    { Id: 1, CCargoTypeName: 'General' },
    { Id: 2, CCargoTypeName: 'Car' },
  ];

  const apply = (Commodities, extra = {}) => request(app).post('/commodity/migration/apply')
    .set('Authorization', admin.authHeader).send({ Commodities, ...extra });

  const plan = (Commodities, extra = {}) => request(app).post('/commodity/migration/plan')
    .set('Authorization', admin.authHeader).send({ Commodities, ...extra });

  beforeAll(async () => { admin = await loginAs('admin'); user = await loginAs('employee'); });
  afterEach(async () => {
    await db.Commodity.destroy({ where: { climaxId: { [db.Sequelize.Op.gte]: BASE } } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/commodity/migration/plan')
      .set('Authorization', user.authHeader).send({ Commodities: [] });
    expect(res.status).toBe(403);
  });

  it('stores the hazmat flag in the form every screen reads', async () => {
    // The old import wrote the boolean straight into a string column, so the
    // screens' `isHazmat == 1` never matched and hazardous commodities
    // rendered as safe.
    const res = await apply([
      commodity(1, 'ACID', { IsHazmatProduct: true }),
      commodity(2, 'STEEL'),
    ]);

    expect(res.status).toBe(200);
    const acid = await db.Commodity.findOne({ where: { climaxId: BASE + 1 } });
    const steel = await db.Commodity.findOne({ where: { climaxId: BASE + 2 } });
    expect(acid.isHazmat).toBe('1');
    expect(steel.isHazmat).toBe('0');
    expect(acid.isHazmat == 1).toBe(true);      // the exact test the UI makes
  });

  it('corrects a hazmat flag the old import left unreadable', async () => {
    // Seanet's situation: these rows are already in the system and in use.
    const stale = await db.Commodity.create({
      name: `${TEST_PREFIX}OLD ACID`, climaxId: BASE + 3, isHazmat: 'true', cargoType: 'GL',
    });
    const before = await db.Commodity.count();

    const res = await apply([commodity(3, 'OLD ACID', { IsHazmatProduct: true })]);

    expect(res.status).toBe(200);
    expect(res.body.result.repaired).toBe(1);
    expect(res.body.result.created).toBe(0);
    expect(await db.Commodity.count()).toBe(before);     // corrected, not duplicated

    await stale.reload();
    expect(stale.isHazmat).toBe('1');
    expect(stale.name).toBe(`${TEST_PREFIX}OLD ACID`);   // corrected in place
  });

  it('verify reports unreadable hazmat flags a row count cannot see', async () => {
    const stale = await db.Commodity.create({
      name: `${TEST_PREFIX}MISLABELLED`, climaxId: BASE + 4, isHazmat: 'false', cargoType: 'GL',
    });

    const res = await request(app).get('/commodity/migration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.body.result.unreadableHazmat).toBeGreaterThan(0);
    expect(res.body.result.healthy).toBe(false);

    await db.Commodity.destroy({ where: { id: stale.id } });
  });

  it('is safe to run twice', async () => {
    const rows = [commodity(5, 'A'), commodity(6, 'B')];
    await apply(rows);
    const second = await apply(rows);

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.repaired).toBe(0);
    expect(await db.Commodity.count({ where: { climaxId: [BASE + 5, BASE + 6] } })).toBe(2);
  });

  it('decodes the cargo type when the lookup is supplied', async () => {
    await apply([
      commodity(7, 'GENERAL CARGO', { CCargoTypeID: '1' }),
      commodity(8, 'A VEHICLE', { CCargoTypeID: '2' }),
    ], { CargoTypes });

    const gl = await db.Commodity.findOne({ where: { climaxId: BASE + 7 } });
    const car = await db.Commodity.findOne({ where: { climaxId: BASE + 8 } });
    expect(gl.cargoType).toBe('GL');
    expect(car.cargoType).toBe('CAR');
  });

  it('falls back to GL and says so when no lookup is supplied', async () => {
    // A legacy server that has not been restarted 404s the lookup. That is a
    // fallback, not a failure - but it must not look like a decoded value.
    const res = await plan([commodity(9, 'X', { CCargoTypeID: '2' })]);

    expect(res.body.result.stats.cargoTypeLookupAvailable).toBe(false);
    expect(res.body.result.stats.undecodedCargoType).toBe(1);
    expect(res.body.result.guidance).toMatch(/cargo-type lookup was not supplied/);
  });

  it('writes the whole batch or none of it', async () => {
    // The old import issued one INSERT per row with no transaction, so a
    // failure at row 8,000 of 10,649 left 8,000 committed and no way to tell.
    const before = await db.Commodity.count();
    const rows = Array.from({ length: 120 }, (_, i) => commodity(100 + i, `BULK ${i}`));

    const res = await apply(rows);

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(120);
    expect(await db.Commodity.count()).toBe(before + 120);
  });

  it('plan writes nothing', async () => {
    const before = await db.Commodity.count();
    const res = await plan([commodity(10, 'PLANNED')]);

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(await db.Commodity.count()).toBe(before);
  });

  it('rejects a body that is not a commodity list', async () => {
    const res = await request(app).post('/commodity/migration/apply')
      .set('Authorization', admin.authHeader).send({ nonsense: true });
    expect(res.status).toBe(400);
  });

  it('imports a commodity with no HS code instead of failing the run', async () => {
    const res = await apply([commodity(11, 'NOHS', { HSCode: '' }), commodity(12, 'FINE')]);

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(2);
    expect(res.body.result.problems.missingHsCode).toBe(1);
  });

  it('verify flags two commodities sharing a legacy id as non-deterministic', async () => {
    const a = await db.Commodity.create({
      name: `${TEST_PREFIX}DUP A`, climaxId: BASE + 99, isHazmat: '0', cargoType: 'GL',
    });
    const b = await db.Commodity.create({
      name: `${TEST_PREFIX}DUP B`, climaxId: BASE + 99, isHazmat: '0', cargoType: 'GL',
    });

    const res = await request(app).get('/commodity/migration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.body.result.duplicateClimaxIds).toContain(BASE + 99);
    expect(res.body.result.healthy).toBe(false);

    await db.Commodity.destroy({ where: { id: [a.id, b.id] } });
  });
});

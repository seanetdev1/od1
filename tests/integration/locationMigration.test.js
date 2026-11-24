const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('Location migration (airports / ports / destinations)', () => {
  let admin, user;
  // Prefixed so the fixtures cannot collide with real reference data, and can
  // be cleaned up by prefix rather than by id.
  const P = `${TEST_PREFIX}`.slice(0, 4).toUpperCase() || 'ZZZZ';

  const airport = (n, over = {}) => ({
    airportCode: `${P}${n}`, airportName: `${P} AIRPORT ${n}`,
    city: 'TESTCITY', country: 'TESTLAND', ...over,
  });
  const port = (n, over = {}) => ({
    portId: `${P}P${n}`, portName: `${P} PORT ${n}`, portCountry: 'TESTLAND', ...over,
  });
  const destination = (n, over = {}) => ({ name: `${P} DEST ${n}`, ...over });

  const send = (body) => request(app).post('/locations/migration/apply')
    .set('Authorization', admin.authHeader).send(body);

  beforeAll(async () => { admin = await loginAs('admin'); user = await loginAs('employee'); });

  afterEach(async () => {
    const like = { [db.Sequelize.Op.like]: `${P}%` };
    await db.Airports.destroy({ where: { airportCode: like } });
    await db.Ports.destroy({ where: { portId: like } });
    await db.Destinations.destroy({ where: { name: { [db.Sequelize.Op.like]: `${P}%` } } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/locations/migration/apply')
      .set('Authorization', user.authHeader).send({ airports: [] });
    expect(res.status).toBe(403);
  });

  it('imports each of the three kinds', async () => {
    const a = await send({ airports: [airport(1), airport(2)] });
    const p = await send({ ports: [port(1)] });
    const d = await send({ destinations: [destination(1), destination(2)] });

    expect(a.body.result.created).toBe(2);
    expect(p.body.result.created).toBe(1);
    expect(d.body.result.created).toBe(2);
    expect(await db.Airports.count({ where: { airportCode: { [db.Sequelize.Op.like]: `${P}%` } } }))
      .toBe(2);
  });

  it('does not store a blank in a NOT NULL column', async () => {
    // bulkCreate does not run the notEmpty validators these models declare, so
    // without the plan step a blank city lands and renders as an empty cell.
    const res = await send({ airports: [airport(1), airport(2, { city: '' })] });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);
    expect(res.body.result.rejected).toBe(1);
    expect(res.body.result.rejectedSample[0].reason).toBe('city is blank');

    const rows = await db.Airports.findAll({
      where: { airportCode: { [db.Sequelize.Op.like]: `${P}%` } }, raw: true,
    });
    for (const r of rows) expect(String(r.city).trim()).not.toBe('');
  });

  it('trims padded values instead of storing them', async () => {
    // 265 airport names in the real export are space-padded. Padding is
    // invisible on screen and breaks exact-match search.
    await send({ airports: [airport(1, { airportName: `${P} PADDED   `, city: '  LONDON ' })] });

    const row = await db.Airports.findOne({ where: { airportCode: `${P}1` } });
    expect(row.airportName).toBe(`${P} PADDED`);
    expect(row.city).toBe('LONDON');
  });

  it('is safe to run twice', async () => {
    const airports = [airport(1), airport(2)];
    await send({ airports });
    const second = await send({ airports });

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.alreadyPresent).toBe(2);
    expect(await db.Airports.count({ where: { airportCode: { [db.Sequelize.Op.like]: `${P}%` } } }))
      .toBe(2);
  });

  it('de-duplicates within a batch, so a unique column does not reject it', async () => {
    // Destinations.name is UNIQUE and the legacy export repeats ~13,500 names.
    const res = await send({
      destinations: [destination(1), destination(1), { name: `${P} DEST 1 ` }, destination(2)],
    });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(2);
    expect(res.body.result.duplicatesInBatch).toBe(2);
  });

  it('dryRun plans without writing', async () => {
    const res = await send({ airports: [airport(1), airport(2)], dryRun: true });

    expect(res.status).toBe(200);
    expect(res.body.result.dryRun).toBe(true);
    expect(res.body.result.toCreate).toBe(2);
    expect(res.body.result.created).toBe(0);
    expect(await db.Airports.count({ where: { airportCode: { [db.Sequelize.Op.like]: `${P}%` } } }))
      .toBe(0);
  });

  it('refuses a batch larger than the limit rather than timing out', async () => {
    const huge = Array.from({ length: 2001 }, (_, i) => airport(i));
    const res = await send({ airports: huge });

    expect(res.status).toBe(413);
    expect(res.body.result).toMatch(/exceeds the 2000-row limit/);
  });

  it('rejects a body with no recognised kind', async () => {
    const res = await send({ nonsense: [] });
    expect(res.status).toBe(400);
  });

  it('verify counts blank and padded values a row count cannot see', async () => {
    // Written straight through the model to simulate what the old import left
    // behind - bulkCreate skips the validators, so these are reachable states.
    await db.Airports.bulkCreate([
      { airportCode: `${P}B1`, airportName: `${P} BLANK`, city: '', country: 'X' },
      { airportCode: `${P}B2`, airportName: `${P} PADDED  `, city: 'Y', country: 'Z' },
    ], { validate: false });

    const res = await request(app).get('/locations/migration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result.airportsWithBlankCityOrCountry).toBeGreaterThan(0);
    expect(res.body.result.paddedValues).toBeGreaterThan(0);
    expect(res.body.result.healthy).toBe(false);
  });

  it('verify flags duplicate port ids, which have no unique index to stop them', async () => {
    await db.Ports.bulkCreate([
      { portId: `${P}DUP`, portName: `${P} A`, portCountry: 'X' },
      { portId: `${P}DUP`, portName: `${P} B`, portCountry: 'X' },
    ]);

    const res = await request(app).get('/locations/migration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.body.result.duplicatePortIdCount).toBeGreaterThan(0);
    expect(res.body.result.healthy).toBe(false);
  });
});

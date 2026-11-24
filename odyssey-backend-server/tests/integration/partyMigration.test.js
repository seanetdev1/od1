const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/**
 * The rewritten parties stage. The case that matters most is the last one:
 * a client can import perfectly and still be unusable, because invoicing
 * needs the Client_Associations row, not the client row.
 */
describe('Parties migration', () => {
  let admin, user;
  const ACC = 940000;   // ledger account ids, clear of anything else
  const PARTY = 950000; // legacy party ids

  const party = (n, name, extra = {}) => ({
    Id: PARTY + n,
    PartyName: `${TEST_PREFIX}${name}`,
    PartyCode: `PC${n}`,
    CurrencyCode: 'USD',
    ...extra,
  });

  beforeAll(async () => {
    admin = await loginAs('admin');
    user = await loginAs('employee');
    await db.Child_Account.create({ id: ACC + 1, title: `${TEST_PREFIX}LEDGER`, subCategory: 'Customer' });
  });

  afterEach(async () => {
    const clients = await db.Clients.findAll({
      where: { climaxId: { [db.Sequelize.Op.gte]: PARTY } }, attributes: ['id'], raw: true,
    });
    const ids = clients.map((c) => c.id);
    if (ids.length) await db.Client_Associations.destroy({ where: { ClientId: ids } });
    await db.Clients.destroy({ where: { climaxId: { [db.Sequelize.Op.gte]: PARTY } } });
  });

  afterAll(async () => {
    await db.Child_Account.destroy({ where: { id: ACC + 1 } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/clientRoutes/migration/parties/plan')
      .set('Authorization', user.authHeader).send({ parties: [] });
    expect(res.status).toBe(403);
  });

  it('plans without writing', async () => {
    const res = await request(app).post('/clientRoutes/migration/parties/plan')
      .set('Authorization', admin.authHeader)
      .send({ parties: [party(1, 'ACME', { AccountId: ACC + 1 })] });

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(await db.Clients.count({ where: { climaxId: PARTY + 1 } })).toBe(0);
  });

  it('creates the client and its ledger link', async () => {
    const res = await request(app).post('/clientRoutes/migration/parties/apply')
      .set('Authorization', admin.authHeader)
      .send({ parties: [party(1, 'ACME', { AccountId: ACC + 1 })] });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);
    expect(res.body.result.associationsCreated).toBe(1);

    const client = await db.Clients.findOne({ where: { climaxId: PARTY + 1 } });
    expect(client.nongl).toBe('0');
    expect(client.code).toBe('PC1');            // the legacy code, not a counter
    expect(client.currency).toBe('USD');        // the code, not the id

    const link = await db.Client_Associations.findOne({ where: { ClientId: client.id } });
    expect(link.ChildAccountId).toBe(ACC + 1);
  });

  it('is safe to run twice', async () => {
    const parties = [party(1, 'ACME', { AccountId: ACC + 1 })];
    await request(app).post('/clientRoutes/migration/parties/apply')
      .set('Authorization', admin.authHeader).send({ parties });
    const second = await request(app).post('/clientRoutes/migration/parties/apply')
      .set('Authorization', admin.authHeader).send({ parties });

    expect(second.body.result.created).toBe(0);
    expect(await db.Clients.count({ where: { climaxId: PARTY + 1 } })).toBe(1);
  });

  it('reports a party whose ledger account is not in the chart', async () => {
    // The old import made this client non-GL and said nothing, so it could
    // never be invoiced and nobody found out until they tried.
    const res = await request(app).post('/clientRoutes/migration/parties/apply')
      .set('Authorization', admin.authHeader)
      .send({ parties: [party(2, 'ORPHAN', { AccountId: 777777 })] });

    expect(res.status).toBe(200);
    expect(res.body.result.problems.unresolvedAccount).toBe(1);
    expect(res.body.result.guidance).toContain('Chart of Accounts');

    const client = await db.Clients.findOne({ where: { climaxId: PARTY + 2 } });
    expect(client).not.toBeNull();      // still imported
    expect(client.nongl).toBe('1');     // but flagged as non-GL
  });

  it('does not invent a registration date', async () => {
    await request(app).post('/clientRoutes/migration/parties/apply')
      .set('Authorization', admin.authHeader)
      .send({ parties: [party(3, 'NODATE', { AccountId: ACC + 1 })] });

    const client = await db.Clients.findOne({ where: { climaxId: PARTY + 3 } });
    expect(client.registerDate).toBeNull();
  });

  it('verify separates invoiceable clients from the rest', async () => {
    await request(app).post('/clientRoutes/migration/parties/apply')
      .set('Authorization', admin.authHeader)
      .send({
        parties: [
          party(1, 'WITH', { AccountId: ACC + 1 }),
          party(2, 'WITHOUT'),
        ],
      });

    const res = await request(app).get('/clientRoutes/migration/parties/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result.withLedgerAccount).toBeGreaterThanOrEqual(1);
    expect(res.body.result.nonGl).toBeGreaterThanOrEqual(1);
    expect(res.body.result.brokenAssociations).toBe(0);
  });

  it('verify catches a ledger client whose link is missing', async () => {
    await request(app).post('/clientRoutes/migration/parties/apply')
      .set('Authorization', admin.authHeader)
      .send({ parties: [party(1, 'BROKEN', { AccountId: ACC + 1 })] });

    // Remove the join, leaving the client marked as a ledger client. This is
    // exactly what the old import produced, and what no client count shows.
    const client = await db.Clients.findOne({ where: { climaxId: PARTY + 1 } });
    await db.Client_Associations.destroy({ where: { ClientId: client.id } });

    const res = await request(app).get('/clientRoutes/migration/parties/verify')
      .set('Authorization', admin.authHeader);

    expect(res.body.result.glWithoutAccount).toBeGreaterThan(0);
    expect(res.body.result.healthy).toBe(false);
    expect(res.body.result.glWithoutAccountSample.some((c) => c.climaxId === PARTY + 1)).toBe(true);
  });
});

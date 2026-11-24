const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');

// Writes are CEO/CFO/admin only. READS are deliberately open to any
// authenticated user - see the getClients/getClientById cases below.
describe('Party (Clients) access control', () => {
  const restrictedDesignations = ['employee', 'manager', 'accountant'];
  const allowedDesignations = ['CEO', 'CFO', 'admin'];

  describe.each(restrictedDesignations)('as a non-privileged "%s"', (designation) => {
    let authHeader;

    beforeAll(async () => {
      ({ authHeader } = await loginAs(designation));
    });

    // DELIBERATE: reading the client list is NOT designation-gated. This test
    // asserted 403 and had been failing since it was written, because
    // routes/clients/index.js never had a guard on this route. Reviewed and
    // kept open on purpose - /setup/clientList is used by non-privileged staff.
    // Consequence, recorded here rather than left implicit: any authenticated
    // user can read every client record. If that changes, add CEO_CFO_ADMIN to
    // the route and flip this back to 403.
    it('allows any authenticated user to list clients via /clientRoutes/getClients', async () => {
      const res = await request(app)
        .get('/clientRoutes/getClients')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
    });

    it('is blocked (403) from creating a client via /clientRoutes/addClient', async () => {
      const res = await request(app)
        .post('/clientRoutes/addClient')
        .set('Authorization', authHeader)
        .send({ name: `${TEST_PREFIX}blocked_client` });
      expect(res.status).toBe(403);
    });

    // Same deliberate decision as getClients above - reads are open.
    // Asserts "not 403" rather than "200": this is an authorization test, and
    // the id below is deliberately nonexistent, so the handler's own lookup
    // result (200 or a 500 from the failed query) is beside the point.
    it('does not block reading a single client via /clientRoutes/getClientById', async () => {
      const res = await request(app)
        .get('/clientRoutes/getClientById')
        .set('Authorization', authHeader)
        .set('id', '00000000-0000-0000-0000-000000000000');
      expect(res.status).not.toBe(403);
    });

    it('is blocked (403) from deleting a client via /clientRoutes/deleteClient', async () => {
      const res = await request(app)
        .post('/clientRoutes/deleteClient')
        .set('Authorization', authHeader)
        .send({ id: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(403);
    });

    it('can still list parties for the charges picker via /clientRoutes/getClientsForSelect (ungated on purpose)', async () => {
      const res = await request(app)
        .get('/clientRoutes/getClientsForSelect')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.result)).toBe(true);
    });

    it('is blocked (403) from the Non-GL parties list via /nonGlParties/getParties', async () => {
      const res = await request(app)
        .get('/nonGlParties/getParties')
        .set('Authorization', authHeader);
      expect(res.status).toBe(403);
    });

    it('is blocked (403) from creating a Non-GL party via /nonGlParties/createNonGlParty', async () => {
      const res = await request(app)
        .post('/nonGlParties/createNonGlParty')
        .set('Authorization', authHeader)
        .send({ name: `${TEST_PREFIX}blocked_nongl`, operations: [], types: [] });
      expect(res.status).toBe(403);
    });
  });

  describe.each(allowedDesignations)('as a privileged "%s"', (designation) => {
    let authHeader;

    beforeAll(async () => {
      ({ authHeader } = await loginAs(designation));
    });

    it('can list clients via /clientRoutes/getClients', async () => {
      const res = await request(app)
        .get('/clientRoutes/getClients')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('can create a client via /clientRoutes/addClient', async () => {
      const res = await request(app)
        .post('/clientRoutes/addClient')
        .set('Authorization', authHeader)
        .send({ name: `${TEST_PREFIX}${designation}_client_${Date.now()}` });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result).toHaveProperty('id');
    });

    it('can list Non-GL parties via /nonGlParties/getParties', async () => {
      const res = await request(app)
        .get('/nonGlParties/getParties')
        .set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });
  });

  it('rejects requests with no auth token at all (401, before the designation check ever runs)', async () => {
    const res = await request(app).get('/clientRoutes/getClients');
    expect(res.status).toBe(401);
  });
});

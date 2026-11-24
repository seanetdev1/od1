const request = require('supertest');
const app = require('../../index');
const { loginAs, createEmployee, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* A PARTY'S CREDIT LIMITS AND SALES REP (the user's request, 2026-10-23).
 *
 * Credit Limit (Days) and Credit Limit (Amount) are saved with the party, a
 * blank box as "none set" rather than 0. The party's sales rep travels with
 * the job pick lists, so picking the client on a job can pick its rep. */
describe("a party's credit limits and sales rep", () => {
  const stamp = Date.now();
  let authHeader; let employeeId; let rep; const made = [];

  const create = (body) => request(app).post('/clientRoutes/createClient').set('Authorization', authHeader)
    .send({ types: ['Shipper'], operations: ['Sea Export'], city: 'KHI', pAccountName: '', employeeId, ...body });
  const edit = (data) => request(app).post('/clientRoutes/editClient').set('Authorization', authHeader)
    .send({ data: { types: ['Shipper'], operations: ['Sea Export'], ...data }, history: '', pAccountName: '', employeeId });

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    rep = await createEmployee({ name: `${TEST_PREFIX}REP ALI ${stamp}` });
    await rep.update({ represent: 'sr' });
  });

  afterAll(async () => {
    await db.Clients.destroy({ where: { id: made } });
  });

  it('saves the limits typed on a new party, and its sales rep', async () => {
    const res = await create({
      name: `${TEST_PREFIX}CREDIT PARTY ${stamp}`, salesRepresentatorId: rep.id,
      creditLimitDays: 30, creditLimitAmount: '250,000.50',
    });
    expect(res.body.status).toBe('success');
    made.push(res.body.result.id);

    const saved = await db.Clients.findByPk(res.body.result.id, { raw: true });
    expect(saved.creditLimitDays).toBe(30);
    expect(Number(saved.creditLimitAmount)).toBe(250000.5);
    expect(saved.salesRepresentatorId).toBe(rep.id);
  });

  it('clears a limit and the rep when their boxes are emptied, and keeps 0 as 0', async () => {
    const id = made[0];
    const party = await db.Clients.findByPk(id, { raw: true });
    const res = await edit({ ...party, creditLimitDays: '', creditLimitAmount: 0, salesRepresentatorId: '' });
    expect(res.body.status).toBe('success');

    const saved = await db.Clients.findByPk(id, { raw: true });
    expect(saved.creditLimitDays).toBeNull();
    expect(Number(saved.creditLimitAmount)).toBe(0);
    expect(saved.salesRepresentatorId).toBeNull();
  });

  it('refuses a limit that is not a number of the right kind, and saves nothing', async () => {
    const name = `${TEST_PREFIX}BAD CREDIT ${stamp}`;
    const res = await create({ name, creditLimitDays: 7.5 });
    expect(res.body).toEqual({ status: 'error', message: expect.stringContaining('whole number of days') });
    expect(await db.Clients.count({ where: { name } })).toBe(0);
  });

  it("lists each job client with the party's sales rep", async () => {
    const client = await db.Clients.create({
      name: `${TEST_PREFIX}REP CLIENT ${stamp}`, code: '0', types: 'Shipper', nongl: '0', active: true, salesRepresentatorId: rep.id,
    });
    made.push(client.id);
    const res = await request(app).get('/seaJob/getValues').set('Authorization', authHeader);
    const listed = res.body.result.party.client.find((c) => c.id === client.id);
    expect(listed).toMatchObject({ id: client.id, salesRepresentatorId: rep.id });
    expect(res.body.result.sr.map((e) => e.id)).toContain(rep.id);
  });
});

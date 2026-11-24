const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Vessel, Voyage, SE_Job, Record_Company, Company } = require('../../models');
require('../../functions/Associations/jobAssociations/seaExport'); // SE_Job's vesselId / VoyageId
const { Op } = require('sequelize');

// routes/vessel/index.js has no requireDesignation gate - any authenticated
// user can hit these. Basic CRUD smoke coverage per the task brief.
describe('Vessel/Voyage CRUD - routes/vessel/index.js', () => {
  let authHeader;

  beforeAll(async () => {
    ({ authHeader } = await loginAs('employee'));
  });

  afterAll(async () => {
    // Voyage.VesselId has a real FK to Vessel - delete voyages before vessels.
    const vessels = await Vessel.findAll({ where: { name: { [Op.like]: `${TEST_PREFIX}%` } } });
    const vesselIds = vessels.map((v) => v.id);
    if (vesselIds.length) {
      await Voyage.destroy({ where: { VesselId: { [Op.in]: vesselIds } } });
    }
    await Vessel.destroy({ where: { name: { [Op.like]: `${TEST_PREFIX}%` } } });
  });

  it('rejects requests with no auth token at all (401)', async () => {
    const res = await request(app).get('/vessel/getVessels');
    expect(res.status).toBe(401);
  });

  it('creates a vessel, auto-incrementing "code" from the current max', async () => {
    const res = await request(app)
      .post('/vessel/create')
      .set('Authorization', authHeader)
      .send({ data: { name: `${TEST_PREFIX}Vessel ${Date.now()}`, type: 'Both' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.result).toHaveProperty('code');
  });

  it('lists vessels via /vessel/getVessels and /vessel/get', async () => {
    const res1 = await request(app).get('/vessel/getVessels').set('Authorization', authHeader);
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('success');
    expect(Array.isArray(res1.body.result)).toBe(true);

    const res2 = await request(app).get('/vessel/get').set('Authorization', authHeader);
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('success');
  });

  it('edits a vessel', async () => {
    const created = (
      await request(app).post('/vessel/create').set('Authorization', authHeader).send({ data: { name: `${TEST_PREFIX}ToEdit ${Date.now()}`, type: 'Both' } })
    ).body.result;

    const res = await request(app)
      .post('/vessel/edit')
      .set('Authorization', authHeader)
      .send({ data: { ...created, name: `${TEST_PREFIX}Edited ${Date.now()}` } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  // BUG (documented, not fixed): the "name already exists" branch of
  // POST /vessel/edit references an undefined variable `result` (only
  // `exists` is in scope there - `result` is declared inside the *other*
  // branch of the if/else). That throws a ReferenceError, which the
  // surrounding try/catch swallows and reports as a generic
  // {status:'error'} instead of the intended {status:'exists', result:exists}.
  // Practical effect: the frontend never gets a chance to show a friendly
  // "a vessel with that name already exists" message - it just sees a
  // generic error.
  // FIXED: this branch used to reference an undefined variable `result`
  // (only `exists` was in scope) inside createHistory(...), throwing a
  // ReferenceError that the outer catch silently swallowed - callers got
  // status:"error" instead of the intended status:"exists".
  it('reports status:"exists" (not "error") when renaming to another vessel\'s existing name', async () => {
    const suffix = Date.now();
    const a = (
      await request(app).post('/vessel/create').set('Authorization', authHeader).send({ data: { name: `${TEST_PREFIX}DupeA ${suffix}`, type: 'Both' } })
    ).body.result;
    const b = (
      await request(app).post('/vessel/create').set('Authorization', authHeader).send({ data: { name: `${TEST_PREFIX}DupeB ${suffix}`, type: 'Both' } })
    ).body.result;

    const res = await request(app)
      .post('/vessel/edit')
      .set('Authorization', authHeader)
      .send({ data: { ...b, name: a.name } }); // rename b to a's existing name
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('exists');
    expect(res.body.result.id).toBe(a.id);
  });

  it('creates and lists a voyage for a vessel', async () => {
    const vessel = (
      await request(app).post('/vessel/create').set('Authorization', authHeader).send({ data: { name: `${TEST_PREFIX}WithVoyage ${Date.now()}`, type: 'Export' } })
    ).body.result;

    const created = await request(app)
      .post('/vessel/createVoyage')
      .set('Authorization', authHeader)
      .send({ voyage: `${TEST_PREFIX}VOY-${Date.now()}`, VesselId: vessel.id, type: 'Export' });
    expect(created.status).toBe(200);
    expect(created.body.status).toBe('success');

    const list = await request(app)
      .post('/vessel/findVoyages')
      .set('Authorization', authHeader)
      .send({ id: vessel.id });
    expect(list.status).toBe(200);
    expect(list.body.status).toBe('success');
    expect(list.body.result.length).toBeGreaterThanOrEqual(1);
  });

  /* DELETE ONLY AN UNUSED VESSEL; a used one is refused, and can be made
   * inactive instead - off the freight job screen's picker, still on its
   * jobs (user's request, 2026-11-12). SE_Jobs.vesselId and VoyageId are
   * ON DELETE SET NULL: deleting a used vessel would not fail, it would
   * blank it on its jobs. */
  describe('deleting, and making inactive', () => {
    const jobs = [];
    const vessel = async (label) => (await request(app).post('/vessel/create').set('Authorization', authHeader)
      .send({ data: { name: `${TEST_PREFIX}${label} ${Date.now()}`, type: 'Both' } })).body.result;
    const voyage = async (v) => (await request(app).post('/vessel/createVoyage').set('Authorization', authHeader)
      .send({ voyage: `${TEST_PREFIX}VOY-${Date.now()}`, VesselId: v.id, type: 'Export' })).body.result;
    const job = async (fields) => {
      const j = await SE_Job.create({ jobNo: `${TEST_PREFIX}SE-${Date.now()}-${jobs.length}`, operation: 'SE', ...fields },
        { fiscalYearCheck: false });
      jobs.push(j);
      return j;
    };
    const del = (id) => request(app).post('/vessel/delete').set('Authorization', authHeader).send({ id });
    const setActive = (id, active) => request(app).post('/vessel/setActive').set('Authorization', authHeader).send({ id, active });

    afterAll(async () => {
      if (jobs.length) await SE_Job.destroy({ where: { id: jobs.map((j) => j.id) } });
    });

    it('new vessels start active', async () => {
      const v = await vessel('Fresh');
      expect(v.active).toBe(true);
    });

    it('deletes an unused vessel, with its voyages and company rows', async () => {
      const v = await vessel('Unused');
      await voyage(v);
      const company = await Company.findOne();
      if (company) await Record_Company.create({ entity: 'Vessel', recordId: String(v.id), CompanyId: company.id });

      const res = await del(v.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result).toMatch(/1 voyage/);
      expect(await Vessel.findByPk(v.id)).toBeNull();
      expect(await Voyage.count({ where: { VesselId: v.id } })).toBe(0);
      expect(await Record_Company.count({ where: { entity: 'Vessel', recordId: String(v.id) } })).toBe(0);
    });

    it('refuses a vessel a job uses, names the job, and changes nothing', async () => {
      const v = await vessel('OnAJob');
      const voy = await voyage(v);
      const j = await job({ vesselId: v.id, VoyageId: voy.id });

      const res = await del(v.id);
      expect(res.status).toBe(409);
      expect(res.body.status).toBe('inUse');
      expect(res.body.jobs).toBe(1);
      expect(res.body.jobNos).toEqual([j.jobNo]);
      expect(res.body.active).toBe(true);
      expect(res.body.result).toMatch(/cannot be deleted/);

      expect(await Vessel.findByPk(v.id)).not.toBeNull();
      expect(await Voyage.count({ where: { VesselId: v.id } })).toBe(1);
      const after = await SE_Job.findByPk(j.id);
      expect([after.vesselId, after.VoyageId]).toEqual([v.id, voy.id]);
    });

    it('counts a job that has only one of its voyages as a use too', async () => {
      const v = await vessel('ViaVoyage');
      const voy = await voyage(v);
      await job({ VoyageId: voy.id });

      const res = await del(v.id);
      expect(res.status).toBe(409);
      expect(res.body.jobs).toBe(1);
      expect(await Voyage.findByPk(voy.id)).not.toBeNull();
    });

    it('makes it inactive and active again, and the job screen is told', async () => {
      const v = await vessel('Toggle');
      await job({ vesselId: v.id });

      const off = await setActive(v.id, false);
      expect(off.status).toBe(200);
      expect(off.body.result.active).toBe(false);
      const values = await request(app).get('/seaJob/getValues').set('Authorization', authHeader);
      expect(values.body.result.vessel.find((x) => x.id === v.id)).toMatchObject({ active: false });

      // Refused again, and the answer says it is inactive already.
      const res = await del(v.id);
      expect(res.status).toBe(409);
      expect(res.body.active).toBe(false);

      const on = await setActive(v.id, 'true');
      expect(on.body.result.active).toBe(true);
    });

    it('keeps the status through an edit that does not send it, and takes it when it does', async () => {
      const v = await vessel('EditKeeps');
      await setActive(v.id, false);
      const { active, ...withoutStatus } = v;

      await request(app).post('/vessel/edit').set('Authorization', authHeader)
        .send({ data: { ...withoutStatus, name: `${TEST_PREFIX}EditKept ${Date.now()}` } });
      expect((await Vessel.findByPk(v.id)).active).toBe(false);

      await request(app).post('/vessel/edit').set('Authorization', authHeader)
        .send({ data: { ...withoutStatus, active: true } });
      expect((await Vessel.findByPk(v.id)).active).toBe(true);
    });

    it('answers a missing or unknown vessel plainly', async () => {
      expect((await del(undefined)).status).toBe(400);
      expect((await del(2147483000)).status).toBe(404);
      expect((await setActive(2147483000, false)).status).toBe(404);
      expect((await setActive(1)).status).toBe(400);
    });
  });

  /* Setup > Vessels, one page at a time and searched on the server (user's
   * request, 2026-11-12) - GET /vessel/list, functions/vesselSearch. */
  describe('the list', () => {
    const stamp = `LST${Date.now()}`;
    let a; let b; let c;
    const list = (params) => request(app).get('/vessel/list').set('Authorization', authHeader).query(params);
    const create = async (name, type) => (await request(app).post('/vessel/create').set('Authorization', authHeader)
      .send({ data: { name: `${TEST_PREFIX}${name} ${stamp}`, type } })).body.result;

    beforeAll(async () => {
      a = await create('Anna', 'Both');
      b = await create('Bravo', 'Export');
      c = await create('Charlie', 'Import');
      await request(app).post('/vessel/setActive').set('Authorization', authHeader).send({ id: c.id, active: false });
    });

    it('pages newest first, every vessel on exactly one page, with the total', async () => {
      const one = await list({ search: stamp, page: 1, pageSize: 2 });
      const two = await list({ search: stamp, page: 2, pageSize: 2 });
      expect(one.status).toBe(200);
      expect(one.body.total).toBe(3);
      expect(one.body.result.map((v) => v.id)).toEqual([c.id, b.id]);
      expect(two.body.result.map((v) => v.id)).toEqual([a.id]);
    });

    it('counts every vessel when nothing is searched', async () => {
      const res = await list({});
      expect(res.body.total).toBe(await Vessel.count());
      expect(res.body.pageSize).toBe(25);
    });

    it('needs every word, and finds by type and by code', async () => {
      const ids = async (search) => (await list({ search, pageSize: 100 })).body.result.map((v) => v.id);
      expect(await ids(`${stamp} export`)).toEqual([b.id]);
      expect(await ids(`${stamp} BRAVO`)).toEqual([b.id]);
      expect(await ids(`${stamp} ${a.code}`)).toContain(a.id);
    });

    it('takes inactive and active as the status', async () => {
      const ids = async (search) => (await list({ search, pageSize: 100 })).body.result.map((v) => v.id);
      expect(await ids(`${stamp} inactive`)).toEqual([c.id]);
      expect(await ids(`${stamp} active`)).toEqual([b.id, a.id]);
    });

    it('treats % as a character, and copes with nonsense paging', async () => {
      expect((await list({ search: `${stamp} %` })).body.total).toBe(0);
      const odd = await list({ search: stamp, page: 'x', pageSize: '-3' });
      expect(odd.status).toBe(200);
      expect([odd.body.page, odd.body.pageSize, odd.body.result.length]).toEqual([1, 1, 1]);
    });
  });

  it('edits a voyage', async () => {
    const vessel = (
      await request(app).post('/vessel/create').set('Authorization', authHeader).send({ data: { name: `${TEST_PREFIX}WithVoyageEdit ${Date.now()}`, type: 'Export' } })
    ).body.result;
    const voyage = (
      await request(app)
        .post('/vessel/createVoyage')
        .set('Authorization', authHeader)
        .send({ voyage: `${TEST_PREFIX}VOY-EDIT-${Date.now()}`, VesselId: vessel.id, type: 'Export' })
    ).body.result;

    const res = await request(app)
      .post('/vessel/editVoyage')
      .set('Authorization', authHeader)
      .send({ id: voyage.id, voyage: `${TEST_PREFIX}VOY-RENAMED-${Date.now()}` });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });
});

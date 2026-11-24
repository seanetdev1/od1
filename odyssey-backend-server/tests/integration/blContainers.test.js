const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* Editing a BL that already has containers - POST /seaJob/editBl.
 *
 * The screen sends every container on the BL, the saved ones with their ids.
 * The route inserted them all, so a saved container went in a second time
 * under its own id and the save failed on Container_Infos_pkey ("Key (id)=
 * (4660) already exists") - on SNS, any sea BL with a container could no
 * longer be edited. Saved containers are now updated in place. */
describe('editing a BL with containers', () => {
  let admin; let job; let bl;
  const stamp = Date.now();

  const post = (body) => request(app).post('/seaJob/editBl')
    .set('Authorization', admin.authHeader).send(body);

  const body = (containers, extra = {}) => ({
    id: bl.id, SEJobId: job.id, operation: 'SE',
    hbl: bl.hbl, mbl: bl.mbl,
    Container_Infos: containers,
    Item_Details: [], Dimensions: [],
    deletingContinersList: [], deletingItemList: [], deletingDimensionsList: [],
    deleteArr: [], stamps: [],
    ...extra,
  });

  const saved = () => db.Container_Info.findAll({ where: { BlId: bl.id }, order: [['id', 'ASC']], raw: true });

  beforeAll(async () => {
    admin = await loginAs('admin');
    job = await db.SE_Job.create({ jobNo: `${TEST_PREFIX}BLC-${stamp}`, operation: 'SE' }, { fiscalYearCheck: false });
    bl = await db.Bl.create({ hbl: `${TEST_PREFIX}HBL-${stamp}`, mbl: `${TEST_PREFIX}MBL-${stamp}`, operation: 'SE', SEJobId: job.id });
    await db.Container_Info.create({
      BlId: bl.id, no: 'ECMU5181038', seal: 'R9408733', size: '40HC',
      gross: '6589', net: '5837.9', tare: '', pkgs: '518', unit: 'CARTONS', wtUnit: 'KG',
    });
  });

  afterAll(async () => {
    await db.Container_Info.destroy({ where: { BlId: bl.id } });
    await db.Stamps.destroy({ where: { BlId: bl.id } });
    await db.Bl.destroy({ where: { id: bl.id } });
    await db.SE_Job.destroy({ where: { id: job.id }, fiscalYearCheck: false });
  });

  it('saves, updating the container it already has instead of inserting it again', async () => {
    const [before] = await saved();
    const res = await post(body([{ ...before, seal: 'R9408999' }]));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    const after = await saved();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before.id, seal: 'R9408999', no: 'ECMU5181038' });
  });

  it('adds a new container alongside the saved one', async () => {
    const [existing] = await saved();
    const res = await post(body([
      existing,
      { id: null, no: 'TGHU1234567', seal: 'S1', size: '20GP', gross: 1000, net: 900, tare: 100, pkgs: 10, cbm: null },
    ]));

    expect(res.body.status).toBe('success');
    const after = await saved();
    expect(after.map((c) => c.no)).toEqual(['ECMU5181038', 'TGHU1234567']);
    expect(after[0].id).toBe(existing.id);
    // Figures are stored as text, as the screen reads them.
    expect(after[1]).toMatchObject({ gross: '1000', pkgs: '10' });
  });

  it('does not throw on a container with an empty weight, as migrated ones have', async () => {
    const containers = (await saved()).map((c) => ({ ...c, tare: null, net: null }));
    const res = await post(body(containers));
    expect(res.body.status).toBe('success');
  });

  /* The same April change hit the stamps, but quietly: each failed insert was
   * logged and swallowed, so the save said "success" and every change to an
   * existing stamp was lost. */
  it('updates a saved stamp, adds a new one, and deletes a removed one', async () => {
    const keep = await db.Stamps.create({ BlId: bl.id, code: '1', stamps: 'FREIGHT PREPAID', stamp_group: 'A' });
    const drop = await db.Stamps.create({ BlId: bl.id, code: '2', stamps: 'SHIPPED ON BOARD', stamp_group: 'A' });

    const res = await post(body(await saved(), {
      stamps: [
        { ...keep.get({ plain: true }), code: '3', stamps: 'FREIGHT COLLECT' },
        { id: null, code: '4', stamps: 'SAID TO CONTAIN', stamp_group: 'B' },
      ],
      deleteArr: [drop.id],
    }));

    expect(res.body.status).toBe('success');
    const stamps = await db.Stamps.findAll({ where: { BlId: bl.id }, order: [['id', 'ASC']], raw: true });
    expect(stamps.map((s) => [s.id === keep.id, s.stamps])).toEqual([
      [true, 'FREIGHT COLLECT'],
      [false, 'SAID TO CONTAIN'],
    ]);
    await db.Stamps.destroy({ where: { BlId: bl.id } });
  });

  it('removes a container the screen deleted', async () => {
    const [keep, drop] = await saved();
    const res = await post(body([keep], { deletingContinersList: [drop.id] }));
    expect(res.body.status).toBe('success');
    expect((await saved()).map((c) => c.id)).toEqual([keep.id]);
  });

  /* "In container info the rows are duplicating" (the user, 2026-11-02): the
   * screen kept a new row's empty id after saving, so the next save sent it
   * as new again and it went in twice. The reply carries the containers as
   * saved, the new one with its id, for the screen to keep. */
  it('sends back the containers as saved, so a second save adds nothing', async () => {
    const [existing] = await saved();
    const first = await post(body([existing, { id: null, no: 'MSKU7654321', seal: 'S2', size: '40HC', gross: 2000 }]));
    expect(first.body.status).toBe('success');
    const back = first.body.containers;
    expect(back.map((c) => c.no)).toEqual(['ECMU5181038', 'MSKU7654321']);
    expect(back.every((c) => Number.isInteger(c.id))).toBe(true);

    // What the screen sends next time: the reply's rows, ids and all.
    const second = await post(body(back));
    expect(second.body.status).toBe('success');
    expect((await saved()).map((c) => c.no)).toEqual(['ECMU5181038', 'MSKU7654321']);
  });

  /* A sea job's Weight is its BL's containers' gross (the user, 2026-11-02):
   * the job comes with them. */
  it('the job carries its BL\'s container weights', async () => {
    const res = await request(app).get('/seaJob/getSEJobById').set('Authorization', admin.authHeader).set('id', String(job.id));
    expect(res.body.status).toBe('success');
    expect(res.body.result.Bl.Container_Infos.map((c) => c.gross).sort()).toEqual(['2000', '6589']);
  });
});

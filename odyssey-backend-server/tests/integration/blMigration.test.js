const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('B/L and air-waybill migration', () => {
  let admin, user, seJob, aeJob;
  const BASE = 995000;

  const seaBl = (n, over = {}) => ({
    Id: BASE + n, SEJobId: BASE + 1, HBLNo: `${TEST_PREFIX}HBL-${n}`,
    MBLNo: `${TEST_PREFIX}MBL-${n}`, StatusId: 2, ...over,
  });
  const airBl = (n, over = {}) => ({
    Id: BASE + n, AEJobId: BASE + 2, HAWBNo: `${TEST_PREFIX}HAWB-${n}`,
    StatusId: 2, Shipper: 'AIR SHIPPER', PlaceOfIssue: 'DUBAI', ...over,
  });
  const detail = (n, over = {}) => ({
    SEBLId: BASE + n, Shipper: 'SEA SHIPPER\n12 DOCK RD', Consignee: 'SEA CONSIGNEE',
    PlaceOfIssue: 'KARACHI', PlaceOfIssueDate: '2024-01-02', ...over,
  });

  const send = (path, body) => request(app).post(`/blMigration/${path}`)
    .set('Authorization', admin.authHeader).send(body);

  const apply = (body) => send('apply', body);
  const plan = (body) => send('plan', body);

  beforeAll(async () => {
    admin = await loginAs('admin');
    user = await loginAs('employee');
    // The B/L stage attaches through the job's legacy id, so a job must exist.
    // fiscalYearCheck:false for the same reason the job migration passes it -
    // migrated history predates whatever fiscal year is selected now.
    seJob = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}SEJOB`, operation: 'SE', climaxId: BASE + 1 },
      { fiscalYearCheck: false },
    );
    aeJob = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}AEJOB`, operation: 'AE', climaxId: BASE + 2 },
      { fiscalYearCheck: false },
    );
  });

  afterAll(async () => {
    await db.SE_Job.destroy({ where: { id: [seJob.id, aeJob.id] } });
  });

  afterEach(async () => {
    await db.Bl.destroy({ where: { climaxId: { [db.Sequelize.Op.gte]: BASE } } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/blMigration/plan')
      .set('Authorization', user.authHeader).send({ operation: 'SE', bls: [] });
    expect(res.status).toBe(403);
  });

  it('imports the place and date of issue the old import silently dropped', async () => {
    // The old import wrote IssuePlace/IssueDate with a capital I, which the
    // model does not declare, so Sequelize dropped both on every B/L ever
    // created - and both print on the document.
    const res = await apply({ operation: 'SE', bls: [seaBl(10)], details: [detail(10)] });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);

    const row = await db.Bl.findOne({ where: { climaxId: BASE + 10 } });
    expect(row.issuePlace).toBe('KARACHI');
    expect(row.issueDate).toBe('2024-01-02');
  });

  it('attaches the B/L to its job and stamps the operation', async () => {
    await apply({ operation: 'SE', bls: [seaBl(10)], details: [detail(10)] });

    const row = await db.Bl.findOne({ where: { climaxId: BASE + 10 } });
    expect(String(row.SEJobId)).toBe(String(seJob.id));
    expect(row.operation).toBe('SE');
    expect(row.hbl).toBe(`${TEST_PREFIX}HBL-10`);
  });

  it('imports an air waybill from HAWBNo and its inline detail', async () => {
    const res = await apply({ operation: 'AE', bls: [airBl(11)] });

    expect(res.body.result.created).toBe(1);
    const row = await db.Bl.findOne({ where: { climaxId: BASE + 11 } });
    expect(row.operation).toBe('AE');
    expect(row.hbl).toBe(`${TEST_PREFIX}HAWB-11`);
    expect(row.shipperContent).toContain('<p>AIR SHIPPER</p>');
    expect(row.issuePlace).toBe('DUBAI');
    expect(String(row.SEJobId)).toBe(String(aeJob.id));
  });

  it('stores address lines as paragraphs, which is what the editor reads', async () => {
    // The B/L detail editor queries <p> elements and calls .replace() on the
    // value: plain text renders as one line, and a null white-screens the page.
    await apply({ operation: 'SE', bls: [seaBl(10)], details: [detail(10)] });

    const row = await db.Bl.findOne({ where: { climaxId: BASE + 10 } });
    expect(row.shipperContent).toContain('<p>SEA SHIPPER</p>');
    expect(row.shipperContent).toContain('<p>12 DOCK RD</p>');

    // Every content column must be a non-null string, whatever the source had.
    for (const col of ['shipperContent', 'consigneeContent', 'notifyOneContent',
      'notifyTwoContent', 'deliveryContent', 'marksContent', 'descOfGoodsContent',
      'grossWeightContent', 'measurementContent']) {
      expect(typeof row[col]).toBe('string');
      expect(row[col].length).toBeGreaterThan(0);
    }
  });

  it('imports ONLY the B/L - no containers, stamps or dimensions', async () => {
    // The scope of this stage. The old receiver walked a nested payload and
    // created all of these alongside the B/L.
    const containers = await db.Container_Info.count();
    const stamps = await db.Stamps.count();

    const res = await apply({
      operation: 'SE',
      bls: [seaBl(10, {
        SExp_BL_Equipment: [{ ContainerNo: 'SHOULD-NOT-IMPORT', SealNo: 'X' }],
        SExp_BL_Stamp: [{ StampId: 1 }],
      })],
      details: [detail(10)],
    });

    expect(res.body.result.created).toBe(1);
    expect(await db.Container_Info.count()).toBe(containers);
    expect(await db.Stamps.count()).toBe(stamps);
  });

  it('skips a B/L whose job is not in Odyssey rather than detaching it', async () => {
    const res = await apply({
      operation: 'SE',
      bls: [seaBl(10), seaBl(12, { SEJobId: 888888 })],
      details: [detail(10)],
    });

    expect(res.body.result.created).toBe(1);
    expect(res.body.result.problems.orphaned).toEqual([BASE + 12]);
  });

  it('imports a sea B/L with no detail row instead of throwing', async () => {
    // The old import read bl.SExp_BL_Detail.X unguarded, so a detail-less B/L
    // threw inside its job's transaction and took the batch with it.
    const res = await apply({ operation: 'SE', bls: [seaBl(10)], details: [] });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);
    expect(res.body.result.problems.missingDetail).toEqual([BASE + 10]);
  });

  it('is safe to run twice', async () => {
    const body = { operation: 'SE', bls: [seaBl(10)], details: [detail(10)] };
    await apply(body);
    const second = await apply(body);

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.stats.alreadyImported).toBe(1);
    expect(await db.Bl.count({ where: { climaxId: BASE + 10 } })).toBe(1);
  });

  it('treats the same legacy id under a different operation as a different B/L', async () => {
    // Legacy B/L ids are only unique within their own table.
    await apply({ operation: 'SE', bls: [seaBl(10)], details: [detail(10)] });
    const res = await apply({ operation: 'AE', bls: [airBl(10, { AEJobId: BASE + 2 })] });

    expect(res.body.result.created).toBe(1);
    expect(await db.Bl.count({ where: { climaxId: BASE + 10 } })).toBe(2);
  });

  it('plan writes nothing', async () => {
    const res = await plan({ operation: 'SE', bls: [seaBl(10)], details: [detail(10)] });

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(await db.Bl.count({ where: { climaxId: BASE + 10 } })).toBe(0);
  });

  it('rejects a body with no valid operation', async () => {
    const res = await request(app).post('/blMigration/apply')
      .set('Authorization', admin.authHeader).send({ operation: 'XX', bls: [] });
    expect(res.status).toBe(400);
  });

  it('refuses an oversized batch rather than timing out', async () => {
    const huge = Array.from({ length: 251 }, (_, i) => seaBl(i + 100));
    const res = await apply({ operation: 'SE', bls: huge, details: [] });

    expect(res.status).toBe(413);
    expect(res.body.result).toMatch(/exceeds the 250-row limit/);
  });

  it('verify reports B/Ls with no job and counts missing places of issue', async () => {
    await apply({ operation: 'SE', bls: [seaBl(10)], details: [detail(10, { PlaceOfIssue: null })] });

    const res = await request(app).get('/blMigration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result.byOperation).toHaveProperty('SE');
    expect(res.body.result.withoutIssuePlace).toBeGreaterThan(0);
    expect(res.body.result).toHaveProperty('withoutJob');
    expect(res.body.result).toHaveProperty('jobsWithMultipleBls');
  });
});

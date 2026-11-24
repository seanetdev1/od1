const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('Loading program migration', () => {
  let admin, user, seJob, otherJob;
  const BASE = 991000;

  const lp = (n, over = {}) => ({
    Id: BASE + n, SEJobId: BASE + 1,
    LocalCustomId: 1, WharfId: 2,
    AllocAvailableId: 1, ContAvalableId: 1,
    LoadingFlagId: 7, StatusId: 0, ContainerWTId: 0,
    OriginTerminalCode: 'KICT', EGMNo: `${TEST_PREFIX}EGM-${n}`,
    CRONumber: `${TEST_PREFIX}CRO-${n}`,
    SpecialInstruction: 'Load carefully', IsLoadingTerms: true,
    ...over,
  });

  const lookups = {
    localCustoms: [{ Id: 1, LocalCustomName: 'KARACHI CUSTOM' }],
    wharfs: [{ Id: 2, WharfName: 'WEST WHARF' }],
    lov: [{ Id: 1, LOVText: 'Yes' }, { Id: 2, LOVText: 'No' }, { Id: 7, LOVText: '999999' }],
    locations: [{ Id: 9, LocationName: 'DEPOT A' }],
  };

  const send = (path, body) => request(app).post(`/loadingProgramMigration/${path}`)
    .set('Authorization', admin.authHeader).send({ operation: 'SE', ...lookups, ...body });
  const apply = (body) => send('apply', body);
  const plan = (body) => send('plan', body);

  beforeAll(async () => {
    admin = await loginAs('admin');
    user = await loginAs('employee');
    seJob = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}SEJOB`, operation: 'SE', climaxId: BASE + 1 },
      { fiscalYearCheck: false },
    );
    otherJob = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}SEJOB2`, operation: 'SE', climaxId: BASE + 2 },
      { fiscalYearCheck: false },
    );
  });

  afterAll(async () => {
    await db.SE_Job.destroy({ where: { id: [seJob.id, otherJob.id] } });
  });

  afterEach(async () => {
    await db.Loading_Program.destroy({ where: { SEJobId: [seJob.id, otherJob.id] } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/loadingProgramMigration/plan')
      .set('Authorization', user.authHeader).send({ operation: 'SE', rows: [] });
    expect(res.status).toBe(403);
  });

  it('imports a loading program and attaches it to its job', async () => {
    const res = await apply({ rows: [lp(10)] });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);

    const row = await db.Loading_Program.findOne({ where: { SEJobId: seJob.id } });
    expect(row.egm).toBe(`${TEST_PREFIX}EGM-10`);
    expect(row.cro).toBe(`${TEST_PREFIX}CRO-10`);
    expect(row.loadingTerminal).toBe('KICT');
    expect(row.instruction).toBe('Load carefully');
  });

  it('decodes the lookups that resolve, and only those', async () => {
    await apply({ rows: [lp(10)] });

    const row = await db.Loading_Program.findOne({ where: { SEJobId: seJob.id } });
    expect(row.localCustom).toBe('KARACHI CUSTOM');
    expect(row.wharf).toBe('WEST WHARF');
    expect(row.allocAvailable).toBe('Yes');
    // The three whose only candidate lookup maps 7 -> "999999". A number where
    // a label belongs is worse than a blank.
    expect(row.loadingFlag).toBeNull();
    expect(row.status).toBeNull();
    expect(row.containerWt).toBeNull();
  });

  it('never writes the loading-terms flag into the terms text field', async () => {
    await apply({ rows: [lp(10, { IsLoadingTerms: true })] });

    const row = await db.Loading_Program.findOne({ where: { SEJobId: seJob.id } });
    expect(row.loadingTerms).toBeNull();
  });

  it('skips a program whose job is not in Odyssey', async () => {
    const res = await apply({ rows: [lp(10), lp(11, { SEJobId: 555555 })] });

    expect(res.body.result.created).toBe(1);
    expect(res.body.result.problems.orphaned).toContain(555555);
  });

  it('is safe to run twice - one per job', async () => {
    await apply({ rows: [lp(10)] });
    const second = await apply({ rows: [lp(10)] });

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.stats.skippedJobs).toBe(1);
    expect(await db.Loading_Program.count({ where: { SEJobId: seJob.id } })).toBe(1);
  });

  it('keeps only one program per job within a batch', async () => {
    const res = await apply({ rows: [lp(10), lp(11)] });   // both on job BASE+1

    expect(res.body.result.created).toBe(1);
    expect(res.body.result.problems.duplicateJobs).toContain(BASE + 1);
  });

  it('plan writes nothing', async () => {
    const res = await plan({ rows: [lp(10)] });

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(await db.Loading_Program.count({ where: { SEJobId: seJob.id } })).toBe(0);
  });

  it('rejects an operation other than sea export', async () => {
    for (const operation of ['SI', 'AE', 'AI']) {
      const res = await request(app).post('/loadingProgramMigration/apply')
        .set('Authorization', admin.authHeader).send({ operation, rows: [] });
      expect(res.status).toBe(400);
    }
  });

  it('refuses an oversized batch', async () => {
    const huge = Array.from({ length: 1001 }, (_, i) => lp(i + 100));
    expect((await apply({ rows: huge })).status).toBe(413);
  });

  it('verify reports coverage and detached programs', async () => {
    await apply({ rows: [lp(10)] });

    const res = await request(app).get('/loadingProgramMigration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result.loadingPrograms).toBeGreaterThan(0);
    expect(res.body.result).toHaveProperty('jobsWithProgram');
    expect(res.body.result).toHaveProperty('seJobs');
    expect(res.body.result).toHaveProperty('detached');
    expect(res.body.result).toHaveProperty('jobsWithMultiple');
  });
});

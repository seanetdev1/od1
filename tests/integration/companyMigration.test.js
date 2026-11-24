const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/**
 * Companies. The stage that can destroy the most, so most of these are about
 * what it refuses to do.
 */
describe('Company migration', () => {
  let admin, user;
  const BASE = 980000;

  const sub = (n, name, short) => ({ Id: BASE + n, Name: `${TEST_PREFIX}${name}`, ShortName: short });

  const cleanup = async () => {
    const ours = await db.Company.findAll({
      where: { title: { [db.Sequelize.Op.like]: `${TEST_PREFIX}%` } }, attributes: ['id'], raw: true,
    });
    const ids = ours.map((c) => c.id);
    if (ids.length) {
      await db.Vouchers.destroy({ where: { CompanyId: ids } });
      await db.Company.destroy({ where: { id: ids } });
    }
  };

  beforeAll(async () => { admin = await loginAs('admin'); user = await loginAs('employee'); });
  afterEach(cleanup);

  it('is admin only', async () => {
    const res = await request(app).post('/companies/migration/plan')
      .set('Authorization', user.authHeader).send({ SubCompanies: [] });
    expect(res.status).toBe(403);
  });

  it('plans without writing', async () => {
    const res = await request(app).post('/companies/migration/plan')
      .set('Authorization', admin.authHeader)
      .send({ SubCompanies: [sub(1, 'ALPHA', 'ALP')] });

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(await db.Company.count({ where: { climaxId: BASE + 1 } })).toBe(0);
  });

  it('imports companies with their legacy id kept for later linking', async () => {
    const res = await request(app).post('/companies/migration/apply')
      .set('Authorization', admin.authHeader)
      .send({ SubCompanies: [sub(1, 'ALPHA', 'ALP'), sub(2, 'BETA', 'BET')] });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(2);
    const alpha = await db.Company.findOne({ where: { climaxId: BASE + 1 } });
    expect(alpha.short).toBe('ALP');
    // Everything downstream resolves its company through this.
    expect(alpha.climaxId).toBe(BASE + 1);
  });

  it('updates rather than duplicating on a second run', async () => {
    const SubCompanies = [sub(1, 'ALPHA', 'ALP')];
    await request(app).post('/companies/migration/apply').set('Authorization', admin.authHeader).send({ SubCompanies });
    const second = await request(app).post('/companies/migration/apply').set('Authorization', admin.authHeader).send({ SubCompanies });

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.updated).toBe(1);
    expect(await db.Company.count({ where: { climaxId: BASE + 1 } })).toBe(1);
  });

  it('keeps companies not in the export unless told to replace', async () => {
    const keeper = await db.Company.create({ title: `${TEST_PREFIX}HANDMADE`, short: 'HM' });
    await request(app).post('/companies/migration/apply')
      .set('Authorization', admin.authHeader)
      .send({ SubCompanies: [sub(1, 'ALPHA', 'ALP')] });

    expect(await db.Company.findByPk(keeper.id)).not.toBeNull();
  });

  it('removes them when replaceExisting is passed', async () => {
    const doomed = await db.Company.create({ title: `${TEST_PREFIX}HANDMADE`, short: 'HM' });
    const res = await request(app).post('/companies/migration/apply')
      .set('Authorization', admin.authHeader)
      .send({ SubCompanies: [sub(1, 'ALPHA', 'ALP')], replaceExisting: true });

    expect(res.body.result.deleted).toBe(1);
    expect(await db.Company.findByPk(doomed.id)).toBeNull();
  });

  it('refuses to cascade away vouchers without force', async () => {
    // Vouchers.CompanyId is ON DELETE CASCADE, so this deletion would destroy
    // them silently. That is not something to arrive at by default.
    const doomed = await db.Company.create({ title: `${TEST_PREFIX}HASDATA`, short: 'HD' });
    await db.Vouchers.create({
      voucher_No: '1', voucher_Id: `${TEST_PREFIX}V1`,
      type: 'Job Payment', vType: 'BPV', CompanyId: doomed.id,
    }, { fiscalYearCheck: false });

    const res = await request(app).post('/companies/migration/apply')
      .set('Authorization', admin.authHeader)
      .send({ SubCompanies: [sub(1, 'ALPHA', 'ALP')], replaceExisting: true });

    expect(res.status).toBe(409);
    expect(res.body.result.cascadeDeletes.vouchers).toBe(1);
    expect(await db.Company.findByPk(doomed.id)).not.toBeNull();
  });

  it('goes ahead when force is passed, and reports what it cost', async () => {
    const doomed = await db.Company.create({ title: `${TEST_PREFIX}HASDATA`, short: 'HD' });
    await db.Vouchers.create({
      voucher_No: '1', voucher_Id: `${TEST_PREFIX}V2`,
      type: 'Job Payment', vType: 'BPV', CompanyId: doomed.id,
    }, { fiscalYearCheck: false });

    const res = await request(app).post('/companies/migration/apply')
      .set('Authorization', admin.authHeader)
      .send({ SubCompanies: [sub(1, 'ALPHA', 'ALP')], replaceExisting: true, force: true });

    expect(res.status).toBe(200);
    // Measured after the fact, not predicted.
    expect(res.body.result.cascadeLoss.vouchers).toBe(1);
    expect(await db.Company.findByPk(doomed.id)).toBeNull();
  });

  it('refuses two companies sharing a short code', async () => {
    // It is the prefix on every job, invoice and voucher number, so two
    // companies sharing one makes their paperwork indistinguishable.
    const res = await request(app).post('/companies/migration/apply')
      .set('Authorization', admin.authHeader)
      .send({ SubCompanies: [sub(1, 'ALPHA', 'DUP'), sub(2, 'BETA', 'DUP')] });

    expect(res.status).toBe(409);
    expect(await db.Company.count({ where: { climaxId: BASE + 1 } })).toBe(0);
  });

  it('skips a legacy row with no short code rather than creating a company with no prefix', async () => {
    const res = await request(app).post('/companies/migration/apply')
      .set('Authorization', admin.authHeader)
      .send({ SubCompanies: [{ Id: BASE + 9, Name: `${TEST_PREFIX}NOSHORT` }] });

    expect(res.body.result.stats.toCreate).toBe(0);
    expect(await db.Company.count({ where: { climaxId: BASE + 9 } })).toBe(0);
  });

  it('verify reports rows left pointing at a company that is gone', async () => {
    const doomed = await db.Company.create({ title: `${TEST_PREFIX}GONE`, short: 'GN' });
    const id = doomed.id;
    // SE_Jobs.companyId has no constraint, so this survives the delete.
    await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}J1`, companyId: id, operation: 'SE' },
      { fiscalYearCheck: false }
    );
    await db.Company.destroy({ where: { id } });

    const res = await request(app).get('/companies/migration/verify').set('Authorization', admin.authHeader);
    expect(res.body.result.danglingReferences.some((d) => d.table === 'jobs')).toBe(true);
    expect(res.body.result.healthy).toBe(false);

    await db.SE_Job.destroy({ where: { jobNo: `${TEST_PREFIX}J1` } });
  });
});

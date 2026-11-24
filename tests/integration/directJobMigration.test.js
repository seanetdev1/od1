const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

const { Op } = db.Sequelize;

// The customs Direct Job E/R migration stage - routes/directJobMigration.
// Legacy rows are sent exactly as /jobs/getDirectExpRev returns them; the
// Odyssey side they resolve against (company, clearing job, charge, account,
// the voucher the ledger stage imported) is seeded here with legacy ids.
describe('Direct Job E/R migration (customs)', () => {
  let admin, company, customsJob, charge, account, voucher, adjustVoucher, originalMode, addedRule;
  const BASE = 941000;   // clear of every other migration suite's legacy ids
  const SHORT = 'TDJ';

  const header = (over = {}) => ({
    Id: BASE + 1, TranNumber: 'JER-132/27', TypeId: 1, TranModeId: 1, TranModeSubTypeId: null,
    SubCompanyId: BASE, CurrencyId: 1, ExchangeRate: 1, SettlementAccountId: account.id,
    VoucherId: BASE + 50, SingleMultipleId: 2, PartyId: null,
    TranDate: '2026-09-21T00:00:00.000Z', AddOn: '2026-09-21T10:00:00.000Z', ...over,
  });
  const line = (over = {}) => ({
    Id: BASE + 100, JobDirectId: BASE + 1, dLGJobId: BASE + 2, ChargesId: BASE + 3, CurrencyId: 1,
    PerUnitFixedId: 1, Quantity: 1, Rate: 600, Amount: 600, NetAmount: 600, ExchangeRate: 1,
    DiscountAmount: 0, IsTaxApply: false, JobFileNumber: 'F-1', ...over,
  });
  const currencies = [{ Id: 1, CurrencyCode: 'PKR' }];
  const send = (path, body) => request(app).post(`/directJobMigration/${path}`)
    .set('Authorization', admin.authHeader).send(body);
  const setMode = async (mode) => {
    await db.AppSetting.destroy({ where: { key: 'operationMode' } });
    if (mode) await db.AppSetting.create({ key: 'operationMode', value: mode });
  };
  const seedVoucher = async (legacyId, amount) => {
    const v = await db.Vouchers.create({
      voucher_No: 1, voucher_Id: `${TEST_PREFIX}DJM-${legacyId}`, type: 'CASH PAYMENT VOUCHER',
      vType: 'CPV', CompanyId: company.id, climaxId: legacyId,
    }, { fiscalYearCheck: false });
    await db.Voucher_Heads.bulkCreate([
      { VoucherId: v.id, ChildAccountId: account.id, type: 'debit', amount: String(amount), defaultAmount: String(amount) },
      { VoucherId: v.id, ChildAccountId: account.id, type: 'credit', amount: String(amount), defaultAmount: String(amount) },
    ]);
    return v;
  };

  beforeAll(async () => {
    admin = await loginAs('admin');
    originalMode = (await db.AppSetting.findOne({ where: { key: 'operationMode' } }))?.value;
    await setMode('customs');
    // What cl-deploy/direct-job-adjustment-subtype.sql does on a real install.
    await db.sequelize.query(`ALTER TYPE "enum_Direct_Jobs_SubType" ADD VALUE IF NOT EXISTS 'adjustment'`);
    // And the rule cl-deploy/direct-job-all-modes.sql puts on every real
    // install but a model-synced test database lacks: one job per line. The
    // first run against CargoLinkers failed on exactly this, so it is mirrored
    // here - and removed afterwards only if this test added it.
    const [[rule]] = await db.sequelize.query(`
      SELECT count(*)::int AS n FROM pg_constraint
       WHERE conname = 'Direct_Job_Association_one_job'`);
    addedRule = rule.n === 0;
    if (addedRule) {
      await db.sequelize.query(`
        ALTER TABLE "Direct_Job_Association" ADD CONSTRAINT "Direct_Job_Association_one_job"
        CHECK (num_nonnulls("Job_Id", "AviationJobId", "CustomsJobId") = 1)`);
    }

    company = await db.Company.create({ title: `${TEST_PREFIX}DJM Co`, short: SHORT, climaxId: BASE });
    customsJob = await db.Customs_Job.create({
      jobNo: 'TP-2640/27', climaxId: BASE + 2, direction: 'Import', transportMode: 'Sea',
    });
    charge = await db.Charges.create({
      code: BASE + 3, climaxId: BASE + 3, name: `${TEST_PREFIX}LIFT ON/OFF`, short: 'LOL',
      currency: 'PKR', calculationType: 'Per Unit', defaultPaybleParty: 'Client',
      defaultRecivableParty: 'Client', taxApply: 'No', taxPerc: '0',
    });
    account = await db.Child_Account.create({ title: `${TEST_PREFIX}CASH IN HAND`, subCategory: 'General' });
    voucher = await seedVoucher(BASE + 50, 1000);
    adjustVoucher = await seedVoucher(BASE + 51, 250);
  });

  afterAll(async () => {
    const entries = await db.Direct_Job.findAll({ where: { Entry_No: { [Op.like]: `${SHORT}-%` } } });
    await db.Direct_Job_Association.destroy({ where: { Direct_Job_Id: entries.map((e) => e.id) } });
    await db.Direct_Job.destroy({ where: { id: entries.map((e) => e.id) } });
    await db.Voucher_Heads.destroy({ where: { VoucherId: [voucher.id, adjustVoucher.id] } });
    await db.Vouchers.destroy({ where: { id: [voucher.id, adjustVoucher.id] }, fiscalYearCheck: false });
    await db.Customs_Job.destroy({ where: { id: customsJob.id } });
    await db.Charges.destroy({ where: { id: charge.id } });
    await db.Child_Account.destroy({ where: { id: account.id } });
    await db.Company.destroy({ where: { id: company.id } });
    await setMode(originalMode);
    if (addedRule) {
      await db.sequelize.query(`ALTER TABLE "Direct_Job_Association" DROP CONSTRAINT IF EXISTS "Direct_Job_Association_one_job"`);
    }
  });

  it('is for a customs install only', async () => {
    await setMode('freight');
    try {
      const res = await send('plan', { headers: [], lines: [], currencies });
      expect(res.status).toBe(409);
    } finally {
      await setMode('customs');
    }
  });

  it('plans without writing', async () => {
    const res = await send('plan', { headers: [header()], lines: [line()], currencies });
    expect(res.body.result.stats).toMatchObject({ entries: 1, entryLines: 1 });
    expect(await db.Direct_Job.count({ where: { Entry_No: `${SHORT}-JER-132/27` } })).toBe(0);
  });

  it('imports an entry against the clearing job and the voucher the ledger brought in, posting nothing', async () => {
    const headsBefore = await db.Voucher_Heads.count();
    const res = await send('apply', {
      headers: [
        header({ Id: BASE + 1 }),
        header({ Id: BASE + 2, TranNumber: 'JER-133/27', TranModeId: 4, VoucherId: BASE + 51 }),
        header({ Id: BASE + 3, TranNumber: 'JER-93/27', VoucherId: null }), // never posted
      ],
      lines: [
        line({ Id: BASE + 100, JobDirectId: BASE + 1, Amount: 600, NetAmount: 600 }),
        line({ Id: BASE + 101, JobDirectId: BASE + 1, dLGJobId: null, Amount: 400, NetAmount: 400 }),
        line({ Id: BASE + 102, JobDirectId: BASE + 2, Amount: 250, NetAmount: 250 }),
        line({ Id: BASE + 103, JobDirectId: BASE + 3 }),
      ],
      currencies,
    });
    expect(res.body).toMatchObject({ status: 'success', result: { created: 2, createdLines: 2 } });
    expect(res.body.result.problems.noVoucher.count).toBe(1);
    // The line with no job is left out - the database rule - and its 400 is
    // reported rather than lost; the entry itself still comes in.
    expect(res.body.result.problems.linesWithoutJob.count).toBe(1);
    expect(res.body.result.stats.leftOutAmount).toBe(400);
    expect(await db.Voucher_Heads.count()).toBe(headsBefore);

    const entry = await db.Direct_Job.findOne({
      where: { Entry_No: `${SHORT}-JER-132/27` },
      include: [{ model: db.Direct_Job_Association, as: 'Associations' }],
    });
    expect(entry).toMatchObject({ Type: 'expense', Tran_Mode: 'Cash', SubType: 'cash', Account_No: account.id });
    // AddOn 10:00 is Karachi wall clock - 05:00Z. See functions/legacyTime.
    expect(new Date(entry.createdAt).toISOString()).toBe('2026-09-21T05:00:00.000Z');
    expect(entry.Associations).toHaveLength(1);
    expect(entry.Associations[0]).toMatchObject({ CustomsJobId: customsJob.id, Job_No: 'TP-2640/27', Voucher_Id: voucher.id });

    const adjust = await db.Direct_Job.findOne({ where: { Entry_No: `${SHORT}-JER-133/27` } });
    expect(adjust).toMatchObject({ Tran_Mode: 'Adjust', SubType: 'adjustment' });
  });

  it('runs again without duplicating anything', async () => {
    const res = await send('apply', { headers: [header()], lines: [line()], currencies });
    expect(res.body.result).toMatchObject({ created: 0, stats: { alreadyImported: 1 } });
    expect(await db.Direct_Job.count({ where: { Entry_No: `${SHORT}-JER-132/27` } })).toBe(1);
  });

  it('verifies each migrated entry against its voucher, and names the one short by its left-out line', async () => {
    const res = await request(app).get('/directJobMigration/verify').set('Authorization', admin.authHeader);
    const flagged = res.body.result.notMatchingVoucherSample.map((s) => s.entryNo);
    expect(flagged).toContain(`${SHORT}-JER-132/27`);      // 600 of a 1,000 voucher
    expect(flagged).not.toContain(`${SHORT}-JER-133/27`);  // complete
  });

  it('is admin only', async () => {
    const user = await loginAs('employee');
    const res = await request(app).post('/directJobMigration/plan')
      .set('Authorization', user.authHeader).send({ headers: [], lines: [] });
    expect(res.status).toBe(403);
  });
});

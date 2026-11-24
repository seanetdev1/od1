/**
 * Direct Job E/R in every operation mode - routes/voucher/index.js.
 *
 * The screen was reachable in all three modes and worked in one. It listed
 * SE_Jobs in the picker, stored the chosen id in a column with a foreign key
 * to SE_Jobs, joined SE_Job to read it back, and picked its ledger account
 * from SE_Job.subType. Under aviation and customs the SE_Jobs table is empty,
 * so the picker came back with nothing, and had it not, the insert would have
 * been refused by the foreign key and the account lookup would have thrown on
 * a null job.
 *
 * These tests drive the whole round trip in a NON-FREIGHT mode: pick a job,
 * save the entry, read it back, and post it to the ledger. Freight is kept
 * alongside, because the point is that the third mode works without the first
 * one changing.
 */
const request = require('supertest');
const moment = require('moment');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Op } = require('sequelize');
const db = require('../../models');
const { Aviation_Job, Aviation_Carrier } = require('../../functions/Associations/aviationAssociations');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');
const { Direct_Job, Direct_Job_Association, FiscalYears, Company, AppSetting } = require('../../models');
const { Vouchers, Voucher_Heads } = require('../../functions/Associations/voucherAssociations');

describe('Direct Job E/R across operation modes', () => {
  let authHeader; let employeeId; let fiscalYearId; let companyId;
  let settlementAccount; let expenseAccount; let incomeAccount; let clearanceAccount;
  let aviationJobId; let customsJobId; let carrierId;
  let originalMode; let createdCompanyId;

  /* Direct_Job_Association.Job_No is validated against
   * ^[A-Z]{3}-[A-Z]+-\d+/\d{2}$ - the shape every real job number has - so the
   * usual __test__ prefix cannot be used here. These rows are cleaned up by id
   * instead. */
  const AV_JOB_NO = 'TST-AVJ-1/99';
  const CC_JOB_NO = 'TST-CCJ-1/99';

  const auth = (req) => req
    .set('Authorization', authHeader)
    .set('x-fiscal-year-id', String(fiscalYearId));

  /* The mode is normally a ONE-TIME LOCK (routes/settings refuses to change
   * it once the row exists), so it is set here through the model rather than
   * the route. Restored in afterAll: every other suite reads the same
   * database, and leaving it on 'aviation' would change what they see. */
  const setMode = async (mode) => {
    await AppSetting.destroy({ where: { key: 'operationMode' } });
    if (mode) await AppSetting.create({ key: 'operationMode', value: mode });
  };

  const account = (title) => db.Child_Account.create({
    title: TEST_PREFIX + title, subCategory: 'General',
  });

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));

    const row = await AppSetting.findOne({ where: { key: 'operationMode' } });
    originalMode = row ? row.value : null;

    await cleanup();

    const year = await FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    fiscalYearId = year
      ? year.id
      : (await FiscalYears.create({
          label: TEST_PREFIX + 'FY', suffix: '99',
          startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
        })).id;

    /* A REAL company row. Vouchers.CompanyId is a foreign key, so the usual
     * `?? '1'` fallback fails the insert on a database that has none - which
     * the throwaway test one does. */
    let company = await Company.findOne({ order: [['id', 'ASC']] });
    if (!company) {
      company = await Company.create({ title: TEST_PREFIX + 'DJ Co', short: 'DJC' });
      createdCompanyId = company.id;
    }
    companyId = String(company.id);

    settlementAccount = await account('DJ BANK');

    /* The accounts a Direct Job posts to are matched BY TITLE against the
     * chart of accounts, and an aviation entry posts to the AIR pair - which
     * is exactly the pair the old code could never reach. Created here under
     * their real titles because the test database ships with no chart. */
    expenseAccount = await db.Child_Account.create({ title: 'AIR FREIGHT EXPENSE', subCategory: 'General' });
    incomeAccount = await db.Child_Account.create({ title: 'AIR FREIGHT INCOME', subCategory: 'General' });
    // A customs job posts by direction; this fixture's is an import.
    clearanceAccount = await db.Child_Account.create({
      title: 'CLEARANCE EXPENSE - IMPORT', subCategory: 'General',
    });

    carrierId = (await Aviation_Carrier.create({
      name: TEST_PREFIX + 'DJ Air', prefix: '761', category: 'GAM',
    })).id;

    aviationJobId = (await Aviation_Job.create({
      jobNo: AV_JOB_NO, flightNo: 'DJ-100',
      origin: 'KHI', destination: 'JED', flightDate: '2026-07-15',
      companyId, operatingCarrierId: carrierId,
    })).id;

    customsJobId = (await Customs_Job.create({
      jobNo: CC_JOB_NO, gdNumber: 'KAPE-9999',
      blNo: 'BL-9999', vesselOrFlight: 'MV Test', direction: 'Import',
      companyId,
    })).id;
  });

  /* ONE CLEANUP, RUN BOTH BEFORE AND AFTER.
   *
   * Run first as well as last so the suite is re-runnable: a run whose
   * teardown failed leaves a carrier with this prefix behind, and the next run
   * then fails in setUp on the unique constraint - which reads as a broken
   * feature rather than as a dirty database.
   *
   * ORDER MATTERS throughout: an association row points at a voucher AND at a
   * job, so the lines go first and everything they referenced goes after.
   */
  const cleanup = async () => {
    const lines = await Direct_Job_Association.findAll({
      where: { Job_No: { [Op.in]: [AV_JOB_NO, CC_JOB_NO] } },
    });
    const voucherIds = [...new Set(lines.map((r) => r.Voucher_Id).filter(Boolean))];
    const jobIds = [...new Set(lines.map((r) => r.Direct_Job_Id).filter(Boolean))];

    if (lines.length) {
      await Direct_Job_Association.destroy({ where: { id: lines.map((r) => r.id) } });
    }
    if (voucherIds.length) {
      await Voucher_Heads.destroy({ where: { VoucherId: voucherIds } });
      await Vouchers.destroy({ where: { id: voucherIds } });
    }
    if (jobIds.length) await Direct_Job.destroy({ where: { id: jobIds } });

    await Aviation_Job.destroy({ where: { jobNo: AV_JOB_NO } });
    await Customs_Job.destroy({ where: { jobNo: CC_JOB_NO } });
    await Aviation_Carrier.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
    /* AND THE HEADS THAT POINT AT THIS SUITE'S ACCOUNTS.
     *
     * The sweep above follows the ASSOCIATION rows, which is right for a run
     * that finished. A run KILLED partway - a jest process stopped by hand,
     * or a watch that timed out - can leave a voucher head written and its
     * association row not, and nothing above then reaches that head. The
     * account it points at cannot be deleted, cleanup throws, and because
     * beforeAll calls it, EVERY test in the file fails on a foreign key that
     * has nothing to do with the feature.
     *
     * Found the hard way: 19 failures, all of them reading as a broken Direct
     * Job screen, all of them one stale row. */
    const TITLES = ['AIR FREIGHT EXPENSE', 'AIR FREIGHT INCOME', 'CLEARANCE EXPENSE - IMPORT'];
    const mine = await db.Child_Account.findAll({
      where: { [Op.or]: [
        { title: { [Op.in]: TITLES } },
        { title: { [Op.like]: TEST_PREFIX + '%' } },
      ] },
      attributes: ['id'],
    });
    if (mine.length) {
      const ids = mine.map((a) => a.id);
      await Voucher_Heads.destroy({ where: { ChildAccountId: ids } });
      /* And the ENTRIES settled through one of them. Direct_Jobs.Account_No is
         ON DELETE NO ACTION - deliberately, an entry must not quietly lose the
         account it was paid from - so a stray entry holds its account alive
         and every delete below fails behind it. */
      const strays = await Direct_Job.findAll({ where: { Account_No: ids }, attributes: ['id'] });
      if (strays.length) {
        const strayIds = strays.map((j) => j.id);
        await Direct_Job_Association.destroy({ where: { Direct_Job_Id: strayIds } });
        await Direct_Job.destroy({ where: { id: strayIds } });
      }
      await db.Child_Account.destroy({ where: { id: ids } });
    }
  };

  afterAll(async () => {
    await cleanup();
    if (createdCompanyId) await Company.destroy({ where: { id: createdCompanyId } });
    await setMode(originalMode);
  });

  const jobNumbers = (params = {}) =>
    auth(request(app).get('/voucher/getDirectJobNumbers')).query(params);

  const saveEntry = (jobId, jobNo, over = {}) =>
    auth(request(app).post('/voucher/saveDirectJob')).send({
      employeeId,
      fiscalYearId,
      direct_Job: {
        companyId,
        Type: 'expense',
        Operation: 'logistics',
        Job_Type: 'single',
        SubType: 'cash',
        Currency: 'PKR',
        Ex_Rate: 1,
        Tran_Mode: 'Cash',
        Account_No: settlementAccount.id,
        Paid_To: settlementAccount.id,
        Entry_Date: '2026-07-16',
        Add_By: 'tester',
        Narration: TEST_PREFIX + 'entry',
        ...over,
      },
      direct_Job_Association: [{
        Job_No: jobNo,
        Charge_Name: 'Handling',
        Quantity: 1,
        Currency: 'PKR',
        Ex_Rate: 1,
        Amount: 1000,
        Tax_Apply: false,
        Description: TEST_PREFIX + 'line',
        Job_Id: jobId,
      }],
    });

  describe('the job picker', () => {
    it('lists FLIGHTS under aviation, where it used to list nothing', async () => {
      await setMode('aviation');
      const res = await jobNumbers();

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('aviation');
      const mine = res.body.data.find((j) => j.id === aviationJobId);
      expect(mine).toBeTruthy();
      expect(mine.jobNo).toBe(AV_JOB_NO);
      expect(mine.ref1).toBe('DJ-100');
      expect(mine.ref2).toBe('KHI → JED');
      expect(mine.party2).toBe(TEST_PREFIX + 'DJ Air');
    });

    it('heads the columns for the mode, not for freight', async () => {
      await setMode('aviation');
      const labels = (await jobNumbers()).body.columns.map((c) => c.label);
      expect(labels).toContain('Flight #');
      expect(labels).not.toContain('HBL');
    });

    it('searches on the fields that mode actually has', async () => {
      await setMode('aviation');
      // Flight number, which a freight query has no column for.
      const byFlight = await jobNumbers({ search: 'DJ-100' });
      expect(byFlight.body.data.some((j) => j.id === aviationJobId)).toBe(true);

      const byCarrier = await jobNumbers({ search: 'DJ Air' });
      expect(byCarrier.body.data.some((j) => j.id === aviationJobId)).toBe(true);

      const miss = await jobNumbers({ search: 'NOTHINGLIKETHIS' });
      expect(miss.body.data.some((j) => j.id === aviationJobId)).toBe(false);
    });

    it('lists goods declarations under customs', async () => {
      await setMode('customs');
      const res = await jobNumbers({ search: 'KAPE-9999' });
      const mine = res.body.data.find((j) => j.id === customsJobId);
      expect(res.body.mode).toBe('customs');
      expect(mine).toBeTruthy();
      expect(mine.ref1).toBe('KAPE-9999');
      expect(res.body.columns.map((c) => c.label)).toContain('GD #');
    });

    // The screen's job box: a whole job number typed and left is that job
    // (asked 2026-11-13).
    it('finds a job by its whole number, any case, and nothing that merely contains it', async () => {
      await setMode('customs');
      const hit = await jobNumbers({ search: CC_JOB_NO.toLowerCase(), exact: 1 });
      expect(hit.status).toBe(200);
      expect(hit.body.data.map((j) => j.id)).toEqual([customsJobId]);
      expect(hit.body.data[0].jobNo).toBe(CC_JOB_NO);

      // Part of the number is not the number.
      const part = await jobNumbers({ search: CC_JOB_NO.slice(0, -1), exact: 1 });
      expect(part.body.data).toEqual([]);
      // A % typed is a character, not a wildcard.
      const wild = await jobNumbers({ search: 'TST-CCJ-%', exact: 1 });
      expect(wild.body.data).toEqual([]);
      // Nothing typed is no job, not every job.
      const none = await jobNumbers({ search: '', exact: 1 });
      expect(none.body.data).toEqual([]);
      // Other fields are for the search, not the box: the GD number is no job number.
      const byGd = await jobNumbers({ search: 'KAPE-9999', exact: 1 });
      expect(byGd.body.data).toEqual([]);
    });

    it('still lists freight jobs under freight', async () => {
      // The whole point: the third mode works without the first one changing.
      await setMode('freight');
      const res = await jobNumbers();
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('freight');
      expect(res.body.columns.map((c) => c.label)).toContain('HBL');
    });
  });

  describe('saving an entry against a flight', () => {
    let saved;

    beforeAll(async () => {
      await setMode('aviation');
      saved = await saveEntry(aviationJobId, AV_JOB_NO);
    });

    it('is accepted, where the foreign key used to refuse it', async () => {
      expect(saved.status).toBe(200);
      expect(saved.body.status).toBe('success');
      expect(saved.body.result.Entry_Number).toMatch(/-DE-\d+\/\d+$/);
    });

    it('stores the id in the aviation column and leaves the others null', async () => {
      const line = await Direct_Job_Association.findOne({
        where: { Direct_Job_Id: saved.body.result.id },
      });
      expect(line.AviationJobId).toBe(aviationJobId);
      expect(line.Job_Id).toBeNull();
      expect(line.CustomsJobId).toBeNull();
    });

    it('posts to the AIR pair, not to FCL FREIGHT', async () => {
      /* The old code read SE_Job.subType and chose between the LCL and FCL
       * accounts. A flight has no sub type, so it belongs to AIR - and the
       * lookup that used to decide this threw on a null job before it could. */
      const line = await Direct_Job_Association.findOne({
        where: { Direct_Job_Id: saved.body.result.id },
      });
      const heads = await Voucher_Heads.findAll({ where: { VoucherId: line.Voucher_Id } });
      const ids = heads.map((h) => h.ChildAccountId);
      expect(ids).toContain(expenseAccount.id);
    });

    it('reads back on the job screen, keyed on the aviation column', async () => {
      const res = await auth(request(app).get('/voucher/getJobData'))
        .set('id', String(aviationJobId));
      expect(res.status).toBe(200);
      expect(res.body.result.some((r) => r.Direct_Job_Id === saved.body.result.id)).toBe(true);
    });

    it('does not answer to a freight job id that happens to share the number', async () => {
      // What a single shared Job_Id column would have made silent.
      await setMode('freight');
      const res = await auth(request(app).get('/voucher/getJobData'))
        .set('id', String(aviationJobId));
      expect(res.body.result.some((r) => r.Direct_Job_Id === saved.body.result.id)).toBe(false);
      await setMode('aviation');
    });

    it('opens for edit with the job still on it', async () => {
      const res = await auth(request(app).get('/voucher/getDirectJob'))
        .set('id', String(saved.body.result.id));
      expect(res.status).toBe(200);
      const line = res.body.result.Associations[0];
      // The screen coalesces the three columns; the aviation one is the set one.
      expect(line.Job_Id ?? line.AviationJobId ?? line.CustomsJobId).toBe(aviationJobId);
      expect(line.Job_No).toBe(AV_JOB_NO);
    });

    it('appears in the list with its job number', async () => {
      const res = await auth(request(app).get('/voucher/getDirectJobList'))
        .query({ page: 1, pageSize: 50 });
      expect(res.status).toBe(200);
      const mine = res.body.result.find((d) => d.id === saved.body.result.id);
      expect(mine).toBeTruthy();
      // The list reads the stored string, so it needs no join and is the same
      // in every mode.
      expect(mine.Associations[0].Job_No).toBe(AV_JOB_NO);
    });
  });

  /* The list screen: one page of entries and the true number of entries.
   * CargoLinkers (2026-11-12) showed 13k pages and took ~30 s - the count ran
   * across the lines, vouchers and voucher heads joined in, and each page
   * carried every line's whole job and voucher. */
  describe('the entry list', () => {
    let entry; let voucher;
    const list = (params) =>
      auth(request(app).get('/voucher/getDirectJobList')).query({ page: 1, pageSize: 50, ...params });

    beforeAll(async () => {
      await setMode('aviation');
      const line = (amount) => ({
        Job_No: AV_JOB_NO, Charge_Name: 'Handling', Quantity: 1, Currency: 'PKR',
        Ex_Rate: 1, Amount: amount, Tax_Apply: false, Description: TEST_PREFIX + 'line', Job_Id: aviationJobId,
      });
      const res = await auth(request(app).post('/voucher/saveDirectJob')).send({
        employeeId, fiscalYearId,
        direct_Job: {
          companyId, Type: 'expense', Operation: 'logistics', Job_Type: 'multiple', SubType: 'cash',
          Currency: 'PKR', Ex_Rate: 1, Tran_Mode: 'Cash', Account_No: settlementAccount.id,
          Paid_To: settlementAccount.id, Entry_Date: '2026-07-16', Add_By: 'tester',
          Narration: TEST_PREFIX + 'two lines',
        },
        direct_Job_Association: [line(1000), line(500)],
      });
      expect(res.status).toBe(200);

      /* Values the search must find, chosen so the time zone shows: the
       * voucher at 21:30 UTC on the 15th is the 16th in Pakistan, where the
       * screen prints it; the cheque at 20:00 UTC on 31 Aug is 1 Sep. */
      await Direct_Job.update(
        { Reference_No: 'REF-DJS-7731', Cheque_No: 'CHQ-77319', Cheque_Date: '2026-08-31T20:00:00.000Z' },
        { where: { id: res.body.result.id } },
      );
      const first = await Direct_Job_Association.findOne({ where: { Direct_Job_Id: res.body.result.id } });
      await Vouchers.update({ tranDate: '2026-07-15T21:30:00.000Z' }, { where: { id: first.Voucher_Id } });
      entry = await Direct_Job.findByPk(res.body.result.id);
      voucher = await Vouchers.findByPk(first.Voucher_Id);
    });

    // Our entry's number as a second word: every word must match, so the
    // answer is our entry exactly when the first word matches it.
    const finds = async (term) => {
      const res = await list({ search: `${term} ${entry.Entry_No}` });
      expect(res.status).toBe(200);
      return res.body.result.map((d) => d.id).includes(entry.id);
    };

    it('counts entries, not their lines and voucher heads', async () => {
      // Two lines on a voucher of at least two heads: the joined count said 4+.
      const res = await list();
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(await Direct_Job.count());
    });

    it('sends what the list shows, and not the jobs and heads it never read', async () => {
      const mine = (await list()).body.result.find((d) => d.id === entry.id);
      expect(mine.accountTitle).toBe(settlementAccount.title);
      expect(mine.Associations.map((a) => Number(a.Amount))).toEqual([1000, 500]);
      expect(mine.Associations[0].Job_No).toBe(AV_JOB_NO);
      expect(mine.Associations[0].Voucher.voucher_Id).toBeTruthy();
      expect(mine.Associations[0].Voucher.tranDate).toBeTruthy();
      expect(mine.Associations[0].AviationJob).toBeUndefined();
      expect(mine.Associations[0].Voucher.Voucher_Heads).toBeUndefined();
    });

    it('searches by entry number, and by type - an enum that used to answer 500', async () => {
      const byNo = await list({ search: entry.Entry_No });
      expect(byNo.status).toBe(200);
      expect(byNo.body.result.map((d) => d.id)).toContain(entry.id);
      expect(byNo.body.total).toBe(await Direct_Job.count({ where: { Entry_No: { [Op.iLike]: `%${entry.Entry_No}%` } } }));

      const byType = await list({ search: 'expense' });
      expect(byType.status).toBe(200);
      expect(byType.body.result.map((d) => d.id)).toContain(entry.id);
    });

    it.each([
      ['Job #', AV_JOB_NO],
      ['Account (its title, a word of it)', 'DJ BANK'],
      ['Currency', 'pkr'],
      ['Reference #', 'REF-DJS-7731'],
      ['the Cash tag', 'cash'],
      ['the Multiple tag', 'Multiple'],
      ['the Expense tag', 'EXPENSE'],
      ['Operation', 'LOGISTICS'],
      ['Cheque #', 'CHQ-77319'],
      ['Cheque Date, the Pakistan day', '01-Sep-2026'],
      ['Entry Date, the Pakistan day', '16-Jul-2026'],
      ['part of a date', 'Jul-2026'],
      ['Amount as shown', '1,500.00'],
      ['Amount without commas', '1500'],
    ])('finds an entry by %s', async (_label, term) => {
      expect(await finds(term)).toBe(true);
    });

    it('finds an entry by its Voucher # and Created By', async () => {
      expect(await finds(voucher.voucher_Id)).toBe(true);
      if (voucher.createdBy) expect(await finds(voucher.createdBy)).toBe(true);
    });

    it("finds a Climax voucher's maker by name, not by the address in its add log", async () => {
      // Raw: the audit stamps never let an update rewrite createdBy.
      await db.sequelize.query(
        `UPDATE "Vouchers" SET "createdBy" = 'DIRECTOR 1 # 192.168.50.213:51582' WHERE id = ${voucher.id}`,
      );
      expect(await finds('DIRECTOR')).toBe(true);
      expect(await finds('192.168.50.213')).toBe(false); // not on the screen
    });

    it('does not find it by the UTC day, which the screen never shows', async () => {
      expect(await finds('15-Jul-2026')).toBe(false);
      expect(await finds('31-Aug-2026')).toBe(false);
    });

    it('finds Adjust by the "Adjustment" the screen shows', async () => {
      await Direct_Job.update({ Tran_Mode: 'Adjust' }, { where: { id: entry.id } });
      try {
        expect(await finds('Adjustment')).toBe(true);
        expect(await finds('cash')).toBe(false);
      } finally {
        await Direct_Job.update({ Tran_Mode: 'Cash' }, { where: { id: entry.id } });
      }
    });

    it('finds a job on any line, not just the first one shown', async () => {
      const second = (await Direct_Job_Association.findAll({ where: { Direct_Job_Id: entry.id }, order: [['id', 'ASC']] }))[1];
      await second.update({ Job_No: 'TST-AVJ-2/99' });
      try {
        expect(await finds('TST-AVJ-2/99')).toBe(true);
      } finally {
        await second.update({ Job_No: AV_JOB_NO });
      }
    });

    it('treats % and _ as characters, not wildcards', async () => {
      expect(await finds('%')).toBe(false);
      expect(await finds('TST_AVJ')).toBe(false); // _ as a wildcard would match TST-AVJ
    });

    it('matches nothing for an amount the entry does not have', async () => {
      expect(await finds('1,499.00')).toBe(false);
    });

    it('dates an entry with no lines by when it was made, as the screen does', async () => {
      const bare = await Direct_Job.create({
        Entry_No: 'TST-DE-9001/99', Type: 'expense', Operation: 'logistics', Job_Type: 'single',
        SubType: 'cash', Currency: 'PKR', Ex_Rate: 1, Tran_Mode: 'Cash', Account_No: settlementAccount.id,
      });
      try {
        await db.sequelize.query(
          `UPDATE "Direct_Jobs" SET "createdAt" = '2026-03-01T20:00:00Z' WHERE id = ${bare.id}`,
        );
        const ids = async (search) => (await list({ search })).body.result.map((d) => d.id);
        expect(await ids('02-Mar-2026 TST-DE-9001/99')).toEqual([bare.id]);
        expect(await ids('01-Mar-2026 TST-DE-9001/99')).toEqual([]);
      } finally {
        await bare.destroy();
      }
    });

    it('shows each entry on exactly one page', async () => {
      const total = (await list()).body.total;
      const ids = [];
      for (let page = 1; page <= total; page++) {
        ids.push(...(await list({ page, pageSize: 1 })).body.result.map((d) => d.id));
      }
      expect(ids).toHaveLength(total);
      expect(new Set(ids).size).toBe(total);
    });
  });

  describe("opening a NEW entry", () => {
    /* The screen opens at /accounts/directJob/new and passes that 'new'
     * through as the id. Postgres rejects it as `invalid input syntax for type
     * integer`, so the ordinary act of starting an entry answered 500 with a
     * driver stack trace. */
    it('answers with no row rather than a 500', async () => {
      await setMode('aviation');
      const res = await auth(request(app).get('/voucher/getDirectJob')).set('id', 'new');
      expect(res.status).toBe(200);
      expect(res.body.result).toBeNull();
    });

    it('reports no direct entries for a job that does not exist yet', async () => {
      const res = await auth(request(app).get('/voucher/getJobData')).set('id', 'new');
      expect(res.status).toBe(200);
      expect(res.body.result).toEqual([]);
    });

    it('refuses to delete a non-numeric id instead of throwing', async () => {
      const res = await auth(request(app).post('/voucher/deleteDirectJob')).set('id', 'new');
      expect(res.status).toBe(400);
    });
  });

  describe('saving an entry against a goods declaration', () => {
    it('stores the id in the customs column and posts to CLEARANCE', async () => {
      await setMode('customs');
      const res = await saveEntry(customsJobId, CC_JOB_NO);
      expect(res.status).toBe(200);

      const line = await Direct_Job_Association.findOne({
        where: { Direct_Job_Id: res.body.result.id },
      });
      expect(line.CustomsJobId).toBe(customsJobId);
      expect(line.Job_Id).toBeNull();
      expect(line.AviationJobId).toBeNull();

      /* By DIRECTION, not by sub type. The old code would have sent this to
       * FCL FREIGHT EXPENSE - a goods declaration posted to freight. */
      const heads = await Voucher_Heads.findAll({ where: { VoucherId: line.Voucher_Id } });
      expect(heads.map((h) => h.ChildAccountId)).toContain(clearanceAccount.id);
    });
  });

  describe('a company code that is not three letters', () => {
    /* WHAT BROKE ON CARGOLINKERS.
     *
     * Entry_No and the line's Job_No were validated against [A-Z]{3} for the
     * company - true of SNS, ACS and CLS, and of nothing else. CargoLinkers is
     * CL, so every Direct Job E/R there was refused at save, with a message
     * quoting OUR company code back at a leased customer.
     *
     * The number is generated by the server (directJobEntryNo), so the test is
     * simply whether a two-letter company can save at all. */
    it('saves for a two-letter company, and numbers it with that code', async () => {
      await setMode('customs');
      const shortCo = await Company.create({ title: TEST_PREFIX + 'CL Co', short: 'CL' });

      const res = await auth(request(app).post('/voucher/saveDirectJob')).send({
        employeeId,
        fiscalYearId,
        direct_Job: {
          companyId: String(shortCo.id),
          Type: 'expense',
          Operation: 'logistics',
          Job_Type: 'single',
          SubType: 'cash',
          Tran_Mode: 'Cash',
          Entry_Date: '2026-09-17',
          Currency: 'PKR',
          Ex_Rate: 1,
          Account_No: settlementAccount.id,
          Paid_To: settlementAccount.id,
          Add_By: 'tester',
          Narration: TEST_PREFIX + 'two-letter company',
        },
        direct_Job_Association: [{
          Job_No: 'CL-CCJ-3/27',
          Charge_Name: 'Handling',
          Quantity: 1,
          Currency: 'PKR',
          Ex_Rate: 1,
          Amount: 500,
          Tax_Apply: false,
          Description: TEST_PREFIX + 'line',
          CustomsJobId: customsJobId,
        }],
      });

      expect(res.status).toBe(200);
      const saved = await Direct_Job.findOne({ where: { id: res.body.result.id } });
      // CL-DE-1/27 shape: the install's own code, not a three-letter one.
      expect(saved.Entry_No).toMatch(/^CL-DE-\d+\/\d+$/);
    });

    it('still refuses something that is not a document number', async () => {
      // The validator is loosened, not removed.
      await expect(
        Direct_Job.create({
          Entry_No: 'rubbish', Type: 'expense', Operation: 'logistics',
          Job_Type: 'single', SubType: 'cash', Entry_Date: '2026-09-17',
          companyId,
        }),
      ).rejects.toThrow(/document code/i);
    });
  });

  /* WHICH VOUCHER AN ENTRY POSTS.
   *
   * The route compared Tran_Mode to 'bank' / 'cash' while the screen sends
   * 'Bank' / 'Cash' / 'Adjust', so every entry fell through to a credit note
   * (expense) or a debit note (revenue): a cash payment numbered SNS-CN-12/27.
   * See functions/directJobVoucherType. */
  describe('the voucher it posts', () => {
    const voucherOf = async (res) => {
      const line = await Direct_Job_Association.findOne({ where: { Direct_Job_Id: res.body.result.id } });
      return Vouchers.findByPk(line.Voucher_Id);
    };

    beforeAll(() => setMode('aviation'));

    it.each([
      ['expense', 'Cash', 'CPV'],
      ['revenue', 'Cash', 'CRV'],
      ['expense', 'Bank', 'BPV'],
      ['revenue', 'Bank', 'BRV'],
      ['expense', 'Adjust', 'ADJ-P'],
      ['revenue', 'Adjust', 'ADJ-R'],
    ])('a %s by %s is a %s, as the screen sends the mode', async (Type, Tran_Mode, vType) => {
      const res = await saveEntry(aviationJobId, AV_JOB_NO, { Type, Tran_Mode });
      expect(res.status).toBe(200);
      const v = await voucherOf(res);
      expect(v.vType).toBe(vType);
      expect(v.voucher_Id).toContain(`${vType}-${v.voucher_No}/`);
      expect(res.body.result.Voucher_Number).toBe(v.voucher_Id);
    });

    it('moves an edited entry into the series of its new mode', async () => {
      const made = await saveEntry(aviationJobId, AV_JOB_NO, { Tran_Mode: 'Cash' });
      const before = await voucherOf(made);
      expect(before.vType).toBe('CPV');

      const edited = await saveEntry(aviationJobId, AV_JOB_NO, {
        id: made.body.result.id, Voucher_Id: before.id, Tran_Mode: 'Bank',
      });
      expect(edited.status).toBe(200);
      const after = await Vouchers.findByPk(before.id);
      expect(after.vType).toBe('BPV');
      expect(after.voucher_Id).toContain(`BPV-${after.voucher_No}/`);
    });

    /* Reported 2026-11-12 (unverified, from a user): editing an entry's amount
     * made a NEW voucher for the difference instead of changing its own. The
     * edit is sent as the screen sends it - the entry's id and the voucher id
     * read off the loaded entry (functions/directJobEntry directJobFromSaved
     * in the front end) - and every voucher is counted around it. */
    describe("editing an entry's amount", () => {
      const lineOf = (Amount) => ({
        Job_No: AV_JOB_NO, Charge_Name: 'Handling', Quantity: 1, Currency: 'PKR', Ex_Rate: 1,
        Amount, Tax_Apply: false, Description: TEST_PREFIX + 'line', Job_Id: aviationJobId,
      });
      const save = (direct_Job, lines) => auth(request(app).post('/voucher/saveDirectJob')).send({
        employeeId, fiscalYearId,
        direct_Job: {
          companyId, Type: 'expense', Operation: 'logistics', Job_Type: 'multiple', SubType: 'cash',
          Currency: 'PKR', Ex_Rate: 1, Tran_Mode: 'Cash', Account_No: settlementAccount.id,
          Paid_To: settlementAccount.id, Entry_Date: '2026-07-16', Add_By: 'tester',
          Narration: TEST_PREFIX + 'amount edit', ...direct_Job,
        },
        direct_Job_Association: lines,
      });
      // What the screen holds after opening the entry.
      const opened = async (id) => {
        const res = await auth(request(app).get('/voucher/getDirectJob')).set('id', String(id));
        const voucher = res.body.result.Associations.find((a) => a.Voucher).Voucher;
        return { id: res.body.result.id, Voucher_Id: voucher.id };
      };
      const headsOf = async (voucherId) => (await Voucher_Heads.findAll({ where: { VoucherId: voucherId } }))
        .map((h) => [h.ChildAccountId, h.type, Number(h.amount)])
        .sort((a, b) => a[1].localeCompare(b[1]) || a[2] - b[2]);
      const vouchersOf = async (entryId) => [...new Set(
        (await Direct_Job_Association.findAll({ where: { Direct_Job_Id: entryId } })).map((l) => l.Voucher_Id),
      )];

      it('changes the amount on the same voucher, and makes no other', async () => {
        const made = await save({}, [lineOf(1000)]);
        expect(made.status).toBe(200);
        const { id, Voucher_Id } = await opened(made.body.result.id);
        const number = (await Vouchers.findByPk(Voucher_Id)).voucher_Id;
        const vouchersBefore = await Vouchers.count();
        const entriesBefore = await Direct_Job.count();

        const edited = await save({ id, Voucher_Id }, [lineOf(1500)]);
        expect(edited.status).toBe(200);

        expect(edited.body.result.id).toBe(id);
        expect(edited.body.result.Voucher_Number).toBe(number);
        expect(await Vouchers.count()).toBe(vouchersBefore);
        expect(await Direct_Job.count()).toBe(entriesBefore);
        expect(await vouchersOf(id)).toEqual([Voucher_Id]);
        expect(await headsOf(Voucher_Id)).toEqual([
          [settlementAccount.id, 'credit', 1500],
          [expenseAccount.id, 'debit', 1500],
        ]);
      });

      it('adds a line to the same voucher, and makes no other', async () => {
        const made = await save({}, [lineOf(1000)]);
        const { id, Voucher_Id } = await opened(made.body.result.id);
        const vouchersBefore = await Vouchers.count();

        await save({ id, Voucher_Id }, [lineOf(1000), lineOf(250)]);

        expect(await Vouchers.count()).toBe(vouchersBefore);
        expect(await vouchersOf(id)).toEqual([Voucher_Id]);
        expect(await headsOf(Voucher_Id)).toEqual([
          [settlementAccount.id, 'credit', 1250],
          [expenseAccount.id, 'debit', 250],
          [expenseAccount.id, 'debit', 1000],
        ]);
      });

      it('lowers the amount on the same voucher, edited twice', async () => {
        const made = await save({}, [lineOf(1000)]);
        const { id, Voucher_Id } = await opened(made.body.result.id);
        const vouchersBefore = await Vouchers.count();

        await save({ id, Voucher_Id }, [lineOf(1200)]);
        await save(await opened(id), [lineOf(800)]);

        expect(await Vouchers.count()).toBe(vouchersBefore);
        expect(await headsOf(Voucher_Id)).toEqual([
          [settlementAccount.id, 'credit', 800],
          [expenseAccount.id, 'debit', 800],
        ]);
      });
    });

    it('keeps the number when an edit leaves the mode alone', async () => {
      const made = await saveEntry(aviationJobId, AV_JOB_NO, { Tran_Mode: 'Bank' });
      const before = await voucherOf(made);
      await saveEntry(aviationJobId, AV_JOB_NO, {
        id: made.body.result.id, Voucher_Id: before.id, Tran_Mode: 'Bank', Narration: TEST_PREFIX + 'edited',
      });
      const after = await Vouchers.findByPk(before.id);
      expect(after.voucher_Id).toBe(before.voucher_Id);
    });

    /* Reported 2026-10-21: cash entries stored the screen's default cheque
     * date (and any number typed), on the entry and on its voucher. */
    it('a cash entry keeps no cheque, on the entry or its voucher', async () => {
      const made = await saveEntry(aviationJobId, AV_JOB_NO, {
        Tran_Mode: 'Cash', Cheque_No: '12345', Cheque_Date: '2026-07-16T10:00:00.000Z',
      });
      expect(made.status).toBe(200);
      const entry = await Direct_Job.findByPk(made.body.result.id);
      expect([entry.Cheque_No, entry.Cheque_Date]).toEqual(['', null]);
      const v = await voucherOf(made);
      expect([v.chequeNo, v.chequeDate]).toEqual(['', null]);
    });

    it('a bank entry keeps its cheque, and moving it to cash clears it', async () => {
      const made = await saveEntry(aviationJobId, AV_JOB_NO, {
        Tran_Mode: 'Bank', Cheque_No: '12345', Cheque_Date: '2026-07-16T10:00:00.000Z',
      });
      const before = await voucherOf(made);
      expect(before.chequeNo).toBe('12345');
      expect(before.chequeDate).toBeTruthy();

      await saveEntry(aviationJobId, AV_JOB_NO, {
        id: made.body.result.id, Voucher_Id: before.id, Tran_Mode: 'Cash',
        Cheque_No: '12345', Cheque_Date: '2026-07-16T10:00:00.000Z',
      });
      const after = await Vouchers.findByPk(before.id);
      expect([after.vType, after.chequeNo, after.chequeDate]).toEqual(['CPV', '', null]);
      const entry = await Direct_Job.findByPk(made.body.result.id);
      expect([entry.Cheque_No, entry.Cheque_Date]).toEqual(['', null]);
    });

    it('retypes a credit note the old code issued when its entry is saved again', async () => {
      const made = await saveEntry(aviationJobId, AV_JOB_NO, { Tran_Mode: 'Cash' });
      const v = await voucherOf(made);
      await Vouchers.update(
        { vType: 'CN', voucher_Id: `${TEST_PREFIX}CN-${v.voucher_No}/99` },
        { where: { id: v.id }, fiscalYearCheck: false },
      );

      await saveEntry(aviationJobId, AV_JOB_NO, { id: made.body.result.id, Voucher_Id: v.id, Tran_Mode: 'Cash' });
      const after = await Vouchers.findByPk(v.id);
      expect(after.vType).toBe('CPV');
      expect(after.voucher_Id).not.toMatch(/CN/);
    });

    /* The ledger places an entry by its voucher lines' createdAt, which used to
     * be the moment of saving: a back-dated entry sat on the day it was keyed
     * in, and every edit moved it to the day of the edit. */
    describe('its ledger date', () => {
      const dayOf = (v) => moment(v).format('YYYY-MM-DD');
      const ledgerDays = async (voucherId) => {
        const v = await Vouchers.findByPk(voucherId);
        const heads = await Voucher_Heads.findAll({ where: { VoucherId: voucherId } });
        return { voucher: dayOf(v.createdAt), heads: [...new Set(heads.map((h) => dayOf(h.createdAt)))] };
      };

      it('is the Entry Date picked, not the day it was saved', async () => {
        const made = await saveEntry(aviationJobId, AV_JOB_NO, { Entry_Date: '2026-08-03' });
        expect(made.status).toBe(200);
        const v = await voucherOf(made);
        expect(await ledgerDays(v.id)).toEqual({ voucher: '2026-08-03', heads: ['2026-08-03'] });
      });

      it('stays on it when the entry is edited, and follows a new one', async () => {
        const made = await saveEntry(aviationJobId, AV_JOB_NO, { Entry_Date: '2026-08-03' });
        const v = await voucherOf(made);

        await saveEntry(aviationJobId, AV_JOB_NO, {
          id: made.body.result.id, Voucher_Id: v.id, Entry_Date: '2026-08-03', Narration: TEST_PREFIX + 'edited',
        });
        expect(await ledgerDays(v.id)).toEqual({ voucher: '2026-08-03', heads: ['2026-08-03'] });

        await saveEntry(aviationJobId, AV_JOB_NO, { id: made.body.result.id, Voucher_Id: v.id, Entry_Date: '2026-07-28' });
        expect(await ledgerDays(v.id)).toEqual({ voucher: '2026-07-28', heads: ['2026-07-28'] });
      });
    });

    it('refuses a mode it does not know, naming it, and writes nothing', async () => {
      const count = await Direct_Job.count();
      const res = await saveEntry(aviationJobId, AV_JOB_NO, { Tran_Mode: 'Cheque' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/"Cheque" is not Bank, Cash or Adjust/);
      expect(await Direct_Job.count()).toBe(count);
    });
  });

  describe('a missing ledger account', () => {
    it('is reported by name instead of failing on a null', async () => {
      await setMode('aviation');
      await db.Child_Account.destroy({ where: { title: 'AIR FREIGHT INCOME' } });

      // A revenue entry needs the income account, which has just been removed.
      const res = await saveEntry(aviationJobId, AV_JOB_NO, { Type: 'revenue' });

      expect(res.status).toBe(500);
      expect(String(res.body.error)).toMatch(/AIR FREIGHT INCOME/);
      expect(String(res.body.error)).not.toMatch(/Cannot read properties of null/);

      incomeAccount = await db.Child_Account.create({ title: 'AIR FREIGHT INCOME', subCategory: 'General' });
    });
  });

  /* A CUSTOMS LINE'S FILE # - the migrated customFileNo, or, where the
   * install says so (Essani, 2026-11-17: Configuration > Customs > Job
   * Screen), the job's S/R Page # (jobRef). */
  describe("a customs job's File #", () => {
    let formBefore;
    beforeAll(async () => {
      formBefore = (await AppSetting.findOne({ where: { key: 'customsJobForm' } }))?.value ?? null;
      await setMode('customs');
      await Customs_Job.update({ jobRef: 'TST-SR-1726', customFileNo: 'OLD-CF' }, { where: { id: customsJobId } });
    });
    afterAll(async () => {
      await AppSetting.destroy({ where: { key: 'customsJobForm' } });
      if (formBefore !== null) await AppSetting.create({ key: 'customsJobForm', value: formBefore });
    });
    const fileNoOf = async () => (await jobNumbers({ search: 'TST-SR-1726' })).body.data.find((j) => j.id === customsJobId);

    it('is the migrated file number on an install that has not said otherwise - and the job list finds the job by its S/R Page #', async () => {
      await AppSetting.destroy({ where: { key: 'customsJobForm' } });
      const mine = await fileNoOf();
      expect(mine).toBeTruthy();
      expect(mine.fileNo).toBe('OLD-CF');
    });

    it('is the S/R Page # with "Direct E/R File # from the S/R Page #" on', async () => {
      await AppSetting.destroy({ where: { key: 'customsJobForm' } });
      await AppSetting.create({ key: 'customsJobForm', value: JSON.stringify({ referenceLabel: 'File Job Number', directJobFileFromRef: true }) });
      expect((await fileNoOf()).fileNo).toBe('TST-SR-1726');
    });
  });

  /* ONE OF EACH CHARGE PER JOB (asked 2026-11-17) - an install switch, off
   * until turned on; see functions/jobChargeRepeats. Charge names of their
   * own, so the entries the tests above saved ('Handling') do not count. */
  describe('one of each charge per job', () => {
    const WEBOC = 'TST WEBOC TOKEN';
    const LABOUR = 'TST LABOUR';
    const setSwitch = async (on) => {
      await AppSetting.destroy({ where: { key: 'uniqueJobCharges' } });
      if (on !== null) await AppSetting.create({ key: 'uniqueJobCharges', value: String(on) });
    };
    let switchBefore;
    beforeAll(async () => {
      switchBefore = (await AppSetting.findOne({ where: { key: 'uniqueJobCharges' } }))?.value ?? null;
      await setMode('customs');
    });
    afterAll(() => setSwitch(switchBefore));

    const lineFor = (charge, over = {}) => ({
      Job_No: CC_JOB_NO, Charge_Name: charge, Quantity: 1, Currency: 'PKR', Ex_Rate: 1,
      Amount: 500, Tax_Apply: false, Description: TEST_PREFIX + 'line', Job_Id: customsJobId, ...over,
    });
    const save = (lines, over = {}) => auth(request(app).post('/voucher/saveDirectJob')).send({
      employeeId,
      fiscalYearId,
      direct_Job: {
        companyId, Type: 'expense', Operation: 'logistics', Job_Type: 'multiple', SubType: 'cash',
        Currency: 'PKR', Ex_Rate: 1, Tran_Mode: 'Cash', Account_No: settlementAccount.id,
        Paid_To: settlementAccount.id, Entry_Date: '2026-07-16', Add_By: 'tester',
        Narration: TEST_PREFIX + 'entry', ...over,
      },
      direct_Job_Association: lines,
    });
    const check = (lines, over = {}) => auth(request(app).post('/voucher/checkDirectJobCharges')).send({
      direct_Job: { Type: 'expense', ...over }, direct_Job_Association: lines,
    });

    it('off: the same charge again on the job is saved, as it always was', async () => {
      await setSwitch(false);
      expect((await save([lineFor(LABOUR)])).status).toBe(200);
      expect((await save([lineFor(LABOUR)])).status).toBe(200);
    });

    it('on: a second expense of a charge on the job is refused, naming the entry it is already on', async () => {
      await setSwitch(true);
      const first = await save([lineFor(WEBOC)]);
      expect(first.status).toBe(200);
      const count = await Direct_Job.count();

      const again = await save([lineFor(WEBOC)]);
      expect(again.status).toBe(400);
      expect(again.body.message).toContain(`${WEBOC} is already on ${CC_JOB_NO} as an expense, in ${first.body.result.Entry_Number}.`);
      // Nothing written.
      expect(await Direct_Job.count()).toBe(count);
    });

    it('on: twice on one job in the same entry is refused', async () => {
      await setSwitch(true);
      const res = await save([lineFor('TST CARTAGE'), lineFor('TST CARTAGE')]);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain(`TST CARTAGE is on ${CC_JOB_NO} 2 times in this entry.`);
    });

    it('on: the same charge as a REVENUE is allowed - the sides are checked apart', async () => {
      await setSwitch(true);
      const res = await check([lineFor(WEBOC)], { Type: 'revenue' });
      expect(res.status).toBe(200);
      expect(res.body.result.repeats).toEqual([]);
      // And as an expense, the same check finds it.
      const expense = await check([lineFor(WEBOC)]);
      expect(expense.body.result.repeats).toHaveLength(1);
    });

    it('on: an entry that already held a repeat can still be edited and saved', async () => {
      // LABOUR went on twice while the switch was off.
      await setSwitch(true);
      const entry = await Direct_Job_Association.findOne({
        where: { Charge_Name: LABOUR, CustomsJobId: customsJobId }, include: [{ model: Direct_Job, as: 'DirectJob' }],
      });
      const res = await save([lineFor(LABOUR, { Amount: 650 })], {
        id: entry.Direct_Job_Id, Voucher_Id: entry.Voucher_Id, Entry_No: entry.DirectJob.Entry_No,
      });
      expect(res.status).toBe(200);
      // But adding a second LABOUR line to it is a new repeat.
      const more = await save([lineFor(LABOUR), lineFor(LABOUR)], {
        id: entry.Direct_Job_Id, Voucher_Id: entry.Voucher_Id, Entry_No: entry.DirectJob.Entry_No,
      });
      expect(more.status).toBe(400);
    });
  });
});

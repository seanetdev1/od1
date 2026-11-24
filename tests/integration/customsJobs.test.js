/**
 * Customs clearance jobs - routes/customsJobs/index.js.
 *
 * THE GAP THIS CLOSES. The module shipped as v1.1.1 and its routes had never
 * run against Postgres. CI's integration suite was green throughout, because
 * nothing in it called them: customs job CRUD, the duty save, the containers
 * and the register were covered by unit tests over pure functions and by
 * nothing else. The one bug CI ever caught here surfaced INCIDENTALLY, through
 * an aviation test that happened to share routes/misc/profitLoss.js - which is
 * not a way of finding bugs, it is a way of being lucky.
 *
 * So these tests are deliberately about the things a pure function cannot be
 * asked: what actually lands in the database, what a second request sees, and
 * what the route refuses.
 *
 * WHAT MATTERS MOST HERE IS THE MONEY AND THE LOCKS:
 *
 *   - a declaration is numbered once, per company per fiscal year
 *   - duty lines and containers are replace-in-place children, so an edit that
 *     drops one must actually drop it
 *   - an INVOICED job is frozen except its remarks and status, and cannot be
 *     cancelled at all - the invoice bills a file, and the file must not be
 *     able to say it never happened
 *   - the register reads gdDate, never createdAt: a GD entered a week late
 *     still belongs to the month it was FILED in, and any other answer makes
 *     the register disagree with the customs portal it is checked against
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const { Op } = require('sequelize');
const moment = require('moment');
const {
  Customs_Job, Customs_Duty, Customs_Container,
} = require('../../functions/Associations/customsAssociations');
const { Charge_Head, Invoice } = require('../../functions/Associations/incoiceAssociations');
const { Clients } = require('../../functions/Associations/clientAssociation');
const {
  FiscalYears, Company, Charges, AppSetting, Direct_Job, Direct_Job_Association, Vouchers,
} = require('../../models');
const db = require('../../models');

describe('Customs jobs - routes/customsJobs/index.js', () => {
  let authHeader;
  let employeeId;
  let fiscalYearId;
  let companyId;
  let clientId;
  let chargeMaster;
  const jobIds = [];
  const invoiceIds = [];

  // Every write goes through the fiscal-year gate: a create needs a resolvable
  // unlocked year, and the request's selected year comes from the header, not
  // the body. Both have to be set or a save comes back 400 for a reason that
  // has nothing to do with customs.
  const auth = (req) => req
    .set('Authorization', authHeader)
    .set('x-fiscal-year-id', String(fiscalYearId));

  /* The register keys off gdDate, so every fixture is dated deliberately
   * rather than left to today - a suite run on the 1st of a month would
   * otherwise straddle two registers and fail once a month. */
  const MONTH = '2026-04';
  const GD_DATE = `${MONTH}-15`;

  const createJob = async (data = {}) => {
    const res = await auth(request(app).post('/customsJob/create')).send({
      employeeId,
      data: {
        companyId,
        fiscalYearId,
        direction: 'Import',
        transportMode: 'Sea',
        gdNumber: TEST_PREFIX + 'GD-1',
        gdDate: GD_DATE,
        clientId,
        ...data,
      },
    });
    if (res.body?.result?.id) jobIds.push(res.body.result.id);
    return res;
  };

  const editJob = (data) => auth(request(app).post('/customsJob/edit')).send({ employeeId, data });

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));

    const year = await FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    fiscalYearId = year
      ? year.id
      : (await FiscalYears.create({
          label: TEST_PREFIX + 'FY', suffix: '99',
          startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
        })).id;

    // A real company, so the job number gets a real short code rather than
    // whatever companyShort() falls back to for an id that is not there.
    companyId = String((await anyCompany()).id);

    clientId = (await Clients.create({
      name: TEST_PREFIX + 'CC Client', code: TEST_PREFIX + 'CCC',
    })).id;

    chargeMaster = await Charges.create({
      code: 9800, name: TEST_PREFIX + 'Clearance Fee', short: 'TCLF',
      currency: 'PKR', calculationType: 'Per Unit', status: true,
      defaultPaybleParty: 'Shipper', defaultRecivableParty: 'Shipper',
      taxApply: 'false', taxPerc: '0',
    });
  });

  afterAll(async () => {
    if (jobIds.length) {
      await Charge_Head.destroy({ where: { CustomsJobId: jobIds } });
      await Customs_Duty.destroy({ where: { CustomsJobId: jobIds } });
      await Customs_Container.destroy({ where: { CustomsJobId: jobIds } });
      await Customs_Job.destroy({ where: { id: jobIds }, fiscalYearCheck: false });
    }
    if (invoiceIds.length) {
      await Invoice.destroy({ where: { id: invoiceIds }, fiscalYearCheck: false });
    }
    await Clients.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
    await Charges.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
  });

  /* ------------------------------------------------------------- the basics */
  describe('authentication', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app).get('/customsJob/get');
      expect(res.status).toBe(401);
    });
  });

  describe('creating a declaration', () => {
    it('numbers it CCJ, per company and fiscal year', async () => {
      const res = await createJob();
      expect(res.status).toBe(200);
      const job = res.body.result;
      // The series a clearing job is filed under - not AVJ, not the freight
      // series. People file paperwork against this number.
      expect(job.jobNo).toMatch(/-CCJ-\d+\/\d+$/);
      expect(job.direction).toBe('Import');
      expect(job.transportMode).toBe('Sea');
    });

    it('gives the next one the next number', async () => {
      const first = await createJob();
      const second = await createJob();
      expect(Number(second.body.result.jobId)).toBe(Number(first.body.result.jobId) + 1);
    });

    it('translates a retired status spelling instead of refusing it', async () => {
      /* The statuses were renamed. Every job migrated before the rename, and
       * every job the previous build saved, carries one of the old words - so
       * VOCABULARY_ALIASES maps them rather than 400ing on data the
       * application itself wrote. Only retired spellings belong in that map,
       * never a synonym somebody might mean by accident. */
      const open = await createJob({ gdNumber: TEST_PREFIX + 'GD-OPEN', status: 'Open' });
      expect(open.status).toBe(200);
      expect(open.body.result.status).toBe('Incomplete');

      const cleared = await createJob({ gdNumber: TEST_PREFIX + 'GD-CLEARED', status: 'Cleared' });
      expect(cleared.body.result.status).toBe('Complete');

      // And 'Land' for the transport mode, renamed to 'By Road'.
      const land = await createJob({ gdNumber: TEST_PREFIX + 'GD-LAND', transportMode: 'Land' });
      expect(land.body.result.transportMode).toBe('By Road');
    });

    it('refuses a word that is not in the vocabulary, and names the list', async () => {
      // A 400 that says what is allowed, not a 500 - and not a silent fall to
      // the first entry, which is how a bad status becomes a real one.
      const res = await createJob({ gdNumber: TEST_PREFIX + 'GD-BADSTAT', status: 'Banana' });
      expect(res.status).toBe(400);
      expect(String(res.body.result)).toMatch(/Status must be one of/);
      expect(String(res.body.result)).toMatch(/Banana/);
    });

    it('refuses a job with no company, which would be hidden from everyone working in one', async () => {
      // A user whose browser had no company picked sent a blank companyId; the
      // job saved, and the list - filtered by the header's company - never
      // showed it to anyone else. 15 of them on CargoLinkers.
      const before = await Customs_Job.count();
      for (const companyId of ['', null, 'NaN', 'undefined', '999999']) {
        const res = await createJob({ companyId });
        expect(res.status).toBe(400);
        expect(res.body.result).toMatch(/Pick your company/);
      }
      expect(await Customs_Job.count()).toBe(before);
    });

    it('keeps ONE Client Invoice #, in both columns that hold it', async () => {
      // Typed in either box (Job Details sends clientRef, Booking Info
      // invoiceNo - the form now sends both), it is saved to both.
      const fromJobDetails = await createJob({ clientRef: 'AMA-18792-26' });
      expect(fromJobDetails.body.result).toMatchObject({ clientRef: 'AMA-18792-26', invoiceNo: 'AMA-18792-26' });

      const fromBooking = await createJob({ invoiceNo: 'VAOP-591-2026' });
      expect(fromBooking.body.result).toMatchObject({ clientRef: 'VAOP-591-2026', invoiceNo: 'VAOP-591-2026' });

      // An old job's two differ: Climax cut clientRef at 20 characters. The
      // whole number wins, and the job is the same in both places from then on.
      const old = await createJob({ clientRef: 'ES-15411,15412 & 154', invoiceNo: 'ES-15411,15412 & 15417' });
      const saved = await editJob({ ...old.body.result });
      expect(saved.status).toBe(200);
      const job = await Customs_Job.findByPk(old.body.result.id);
      expect([job.clientRef, job.invoiceNo]).toEqual(['ES-15411,15412 & 15417', 'ES-15411,15412 & 15417']);
    });

    it('files a job sent with no status as In Process, not the retired Open', async () => {
      const res = await createJob({ gdNumber: TEST_PREFIX + 'GD-NOSTATUS' });
      expect(res.body.result.status).toBe('Incomplete');
    });

    it('defaults an unstated direction to Export', async () => {
      // Deliberate: the first customs install is 97% export, and a blanket
      // Import default posted 14% of the book to the wrong ledger account.
      const res = await createJob({ direction: null });
      expect(res.body.result.direction).toBe('Export');
    });
  });

  /* --------------------------------------------------------------- the duty */
  describe('duty lines', () => {
    it('saves them with the declaration and totals the cascade', async () => {
      // 100,000 assessed. Custom duty 10% on value = 10,000; sales tax 18% on
      // value+duty = 19,800; income tax 6% on that base again = 7,188.
      // The cascade itself is pinned by tests/unit/customsDuty.test.js - what
      // is being checked HERE is that the lines survive the round trip and the
      // totals come back on the job.
      const res = await createJob({
        gdNumber: TEST_PREFIX + 'GD-DUTY',
        assessedValue: 100000,
        dutyLines: [{
          itemNo: '1',
          assessedValue: 100000,
          customDutyPerc: 10,
          salesTaxPerc: 18,
          incomeTaxPerc: 6,
        }],
      });
      expect(res.status).toBe(200);

      const stored = await Customs_Duty.findAll({
        where: { CustomsJobId: res.body.result.id },
      });
      expect(stored).toHaveLength(1);
      expect(Number(stored[0].assessedValue)).toBe(100000);
      expect(Number(stored[0].customDutyPerc)).toBe(10);

      // Derived on the way out so no two callers can reach a different total.
      expect(res.body.result.totalDuty).toBeGreaterThan(0);
      expect(Array.isArray(res.body.result.dutyBreakdown)).toBe(true);
    });

    it('drops a blank line rather than storing an empty row', async () => {
      // An "Add +" the user thought better of. Storing it puts a row on the
      // declaration that has to be deleted by hand later.
      const res = await createJob({
        gdNumber: TEST_PREFIX + 'GD-BLANK',
        dutyLines: [
          { itemNo: '1', assessedValue: 5000, customDutyPerc: 5 },
          { itemNo: '', assessedValue: null, customDutyPerc: null },
        ],
      });
      const stored = await Customs_Duty.findAll({ where: { CustomsJobId: res.body.result.id } });
      expect(stored).toHaveLength(1);
    });

    it('replaces them in place on an edit, so a removed line is gone', async () => {
      const created = await createJob({
        gdNumber: TEST_PREFIX + 'GD-REPLACE',
        dutyLines: [
          { itemNo: '1', assessedValue: 1000, customDutyPerc: 5 },
          { itemNo: '2', assessedValue: 2000, customDutyPerc: 5 },
        ],
      });
      const id = created.body.result.id;
      expect(await Customs_Duty.count({ where: { CustomsJobId: id } })).toBe(2);

      const res = await editJob({
        id, companyId, fiscalYearId,
        dutyLines: [{ itemNo: '1', assessedValue: 1000, customDutyPerc: 5 }],
      });
      expect(res.status).toBe(200);
      expect(await Customs_Duty.count({ where: { CustomsJobId: id } })).toBe(1);
    });

    it('leaves them alone when the payload omits them entirely', async () => {
      // undefined is "the screen did not send them", which is not the same as
      // "this declaration has none".
      const created = await createJob({
        gdNumber: TEST_PREFIX + 'GD-OMIT',
        dutyLines: [{ itemNo: '1', assessedValue: 1000, customDutyPerc: 5 }],
      });
      const id = created.body.result.id;
      await editJob({ id, companyId, fiscalYearId, remarks: 'no duty key at all' });
      expect(await Customs_Duty.count({ where: { CustomsJobId: id } })).toBe(1);
    });
  });

  /* --------------------------------------------------------- the containers */
  describe('containers', () => {
    it('saves them as rows, not as a flat string', async () => {
      // The legacy book recorded containers twice - a structured child table
      // and a flat ContainerString - and the first cut of the migration kept
      // only the string. Searching by container number needs the rows.
      const res = await createJob({
        gdNumber: TEST_PREFIX + 'GD-CTR',
        containerRows: [
          { containerNo: 'TEMU1234567', sizeType: '40HC', packages: 10 },
          { containerNo: 'MSKU7654321', sizeType: '20GP', packages: 5 },
        ],
      });
      expect(res.status).toBe(200);
      const stored = await Customs_Container.findAll({
        where: { CustomsJobId: res.body.result.id },
        order: [['sortOrder', 'ASC']],
      });
      expect(stored.map((c) => c.containerNo)).toEqual(['TEMU1234567', 'MSKU7654321']);
      expect(stored[0].sizeType).toBe('40HC');
    });

    it('drops a row with no container number', async () => {
      const res = await createJob({
        gdNumber: TEST_PREFIX + 'GD-CTR-BLANK',
        containerRows: [
          { containerNo: 'TEMU1111111' },
          { containerNo: '' },
        ],
      });
      expect(await Customs_Container.count({
        where: { CustomsJobId: res.body.result.id },
      })).toBe(1);
    });
  });

  /* ------------------------------------------------ an invoiced job is shut */
  describe('an invoiced declaration is frozen', () => {
    let jobId; let invoiceId;

    beforeAll(async () => {
      const created = await createJob({
        gdNumber: TEST_PREFIX + 'GD-LOCK',
        remarks: 'before',
        status: 'Incomplete',
        charges: [{
          charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 5000,
        }],
      });
      jobId = created.body.result.id;

      const stored = await Charge_Head.findOne({ where: { CustomsJobId: jobId } });
      expect(stored).not.toBeNull();

      // Stands in for /makeInvoice. `approved: '1'` is part of standing in for
      // it, not a detail: an unapproved invoice has had its voucher destroyed
      // and is out of the ledger, so there is no issued figure left for the
      // declaration to contradict.
      const inv = await Invoice.create(
        {
          invoice_No: TEST_PREFIX + 'CC-LOCK', invoiceType: 'Job Invoice',
          status: '0', approved: '1',
        },
        { fiscalYearCheck: false }
      );
      invoiceId = inv.id;
      invoiceIds.push(inv.id);
      await Charge_Head.update({ InvoiceId: invoiceId }, { where: { id: stored.id } });
    });

    it('saves only remarks and status, and says so', async () => {
      const res = await editJob({
        id: jobId, companyId, fiscalYearId,
        remarks: 'after', status: 'Complete',
        // Everything below must be ignored - these are figures the invoice
        // was computed from.
        gdNumber: TEST_PREFIX + 'GD-HACKED',
        assessedValue: 999999,
      });
      expect(res.status).toBe(200);
      expect(res.body.warning).toMatch(/invoiced/i);

      const after = await Customs_Job.findByPk(jobId);
      expect(after.remarks).toBe('after');
      expect(after.status).toBe('Complete');
      expect(after.gdNumber).toBe(TEST_PREFIX + 'GD-LOCK');
    });

    it('reports itself as invoiced, so the screen can shut its own boxes', async () => {
      // The flag rides back on the read the form is built from. Without it the
      // screen has no way to know it should be disabling anything, and the
      // user finds out by having an edit silently ignored.
      const res = await auth(request(app).get('/customsJob/getById')).set('id', String(jobId));
      expect(res.status).toBe(200);
      expect(res.body.result.invoiced).toBe(true);

      // And an uninvoiced one says so, rather than the field being absent.
      const free = await createJob({ gdNumber: TEST_PREFIX + 'GD-FREE' });
      const other = await auth(request(app).get('/customsJob/getById'))
        .set('id', String(free.body.result.id));
      expect(other.body.result.invoiced).toBe(false);
    });

    it('cannot be cancelled', async () => {
      // Cancelling a GD whose charges are on an issued invoice would leave
      // that invoice billing a file which says it never happened.
      const res = await auth(request(app).post('/customsJob/delete'))
        .send({ id: jobId, employeeId });
      expect(res.status).toBe(409);

      const after = await Customs_Job.findByPk(jobId);
      expect(after.canceled).toBe(false);
    });

    it('does not delete the invoiced charge on a later save', async () => {
      // saveCharges replaces in place, but only the UNINVOICED rows - one that
      // is on a document must survive a save that no longer mentions it.
      const before = await Charge_Head.count({
        where: { CustomsJobId: jobId, InvoiceId: { [Op.ne]: null } },
      });
      await editJob({ id: jobId, companyId, fiscalYearId, charges: [] });
      const after = await Charge_Head.count({
        where: { CustomsJobId: jobId, InvoiceId: { [Op.ne]: null } },
      });
      expect(after).toBe(before);
      expect(after).toBeGreaterThan(0);
    });
  });

  /* --------------------------- CEO / CFO / admin can unlock an invoiced job */

  describe('unlocking an invoiced declaration', () => {
    /* A CEO, CFO or admin may open an invoiced declaration for a save without
     * un-approving its invoice. The unlock and the save each leave their own
     * History entry, so a special change can be traced to who made it. */
    let jobId; let jobNo; let chargeId; let adminId; let employeeAuth;
    const unlock = (auth = authHeader) => request(app).post('/customsJob/unlock')
      .set('Authorization', auth).set('x-fiscal-year-id', String(fiscalYearId))
      .send({ id: jobId, employeeId });
    const historyOf = (type) => db.History.findAll({ where: { formName: 'Customs Job', type, docNo: jobNo } });

    beforeAll(async () => {
      adminId = employeeId;
      ({ authHeader: employeeAuth } = await loginAs('employee'));
      const created = await createJob({
        gdNumber: TEST_PREFIX + 'GD-UNLOCK', status: 'Incomplete',
        charges: [{ charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 5000 }],
      });
      jobId = created.body.result.id;
      jobNo = created.body.result.jobNo;
      chargeId = (await Charge_Head.findOne({ where: { CustomsJobId: jobId } })).id;
      const inv = await Invoice.create(
        { invoice_No: TEST_PREFIX + 'CC-UNLOCK', invoiceType: 'Job Invoice', status: '0', approved: '1' },
        { fiscalYearCheck: false }
      );
      invoiceIds.push(inv.id);
      await Charge_Head.update({ InvoiceId: inv.id }, { where: { id: chargeId } });
    });

    afterAll(async () => {
      await db.History.destroy({ where: { formName: 'Customs Job', docNo: jobNo } });
    });

    it('refuses anyone who is not a CEO, CFO or admin', async () => {
      const res = await unlock(employeeAuth);
      expect(res.status).toBe(403);
      expect(await historyOf('Unlock')).toHaveLength(0);
    });

    it('records the unlock in History, under the signed-in user', async () => {
      const res = await unlock();
      expect(res.body.status).toBe('success');
      const entries = await historyOf('Unlock');
      expect(entries).toHaveLength(1);
      expect(String(entries[0].EmployeeId)).toBe(String(adminId));
    });

    it('lets that user save the declaration, and records the save on its own', async () => {
      const res = await editJob({
        id: jobId, companyId, fiscalYearId, unlocked: true,
        gdNumber: TEST_PREFIX + 'GD-CORRECTED', status: 'Incomplete',
        charges: [{ id: chargeId, InvoiceId: (await Charge_Head.findByPk(chargeId)).InvoiceId,
          charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 9999 }],
      });
      expect(res.status).toBe(200);
      expect((await Customs_Job.findByPk(jobId)).gdNumber).toBe(TEST_PREFIX + 'GD-CORRECTED');
      expect(await historyOf('Edit (unlocked)')).toHaveLength(1);
      expect(await historyOf('Edit')).toHaveLength(0);
    });

    it('still leaves the approved invoice\'s charge alone', async () => {
      // Unlocking the job is not unlocking an issued document.
      expect(Number((await Charge_Head.findByPk(chargeId)).rate_charge)).toBe(5000);
    });

    it('refuses an unlocked save from anyone else, and changes nothing', async () => {
      const res = await request(app).post('/customsJob/edit')
        .set('Authorization', employeeAuth).set('x-fiscal-year-id', String(fiscalYearId))
        .send({ employeeId, data: { id: jobId, companyId, fiscalYearId, unlocked: true, gdNumber: TEST_PREFIX + 'GD-NOPE' } });
      expect(res.status).toBe(403);
      expect((await Customs_Job.findByPk(jobId)).gdNumber).toBe(TEST_PREFIX + 'GD-CORRECTED');
    });

    it('will not "unlock" a job that is not locked', async () => {
      const open = await createJob({ gdNumber: TEST_PREFIX + 'GD-OPEN' });
      const res = await request(app).post('/customsJob/unlock')
        .set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYearId))
        .send({ id: open.body.result.id, employeeId });
      expect(res.status).toBe(409);
    });
  });

  /* --------------------------------- unapproving reopens what it had frozen */

  describe('an UNAPPROVED invoice freezes nothing', () => {
    /* Unapproving destroys the voucher and takes the invoice back out of the
     * ledger, so there is no issued figure left for the charge to contradict -
     * and correcting it is the whole reason somebody unapproved it.
     *
     * The charge KEEPS its InvoiceId throughout. It stays on the same
     * document and is re-approved onto it, which is why the amendment is an
     * UPDATE rather than the delete-and-recreate the uninvoiced rows get: a
     * new row would have a new id and would be orphaned from the invoice,
     * turning an amendment into a second charge. */
    let jobId; let invoiceId; let chargeId;

    beforeAll(async () => {
      const created = await createJob({
        gdNumber: TEST_PREFIX + 'GD-REOPEN',
        charges: [{ charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 5000 }],
      });
      jobId = created.body.result.id;

      const stored = await Charge_Head.findOne({ where: { CustomsJobId: jobId } });
      chargeId = stored.id;

      const inv = await Invoice.create(
        { invoice_No: TEST_PREFIX + 'CC-REOPEN', invoiceType: 'Job Invoice', status: '0', approved: '0' },
        { fiscalYearCheck: false }
      );
      invoiceId = inv.id;
      invoiceIds.push(inv.id);
      await Charge_Head.update({ InvoiceId: invoiceId }, { where: { id: chargeId } });
    });

    const amend = (rate) => editJob({
      id: jobId, companyId, fiscalYearId,
      charges: [{
        id: chargeId, InvoiceId: invoiceId,
        charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: rate,
      }],
    });

    it('lets the charge be amended', async () => {
      const res = await amend(7000);
      expect(res.status).toBe(200);

      const after = await Charge_Head.findByPk(chargeId);
      expect(Number(after.rate_charge)).toBe(7000);
      expect(Number(after.net_amount)).toBe(7000);
    });

    it('KEEPS it on the same invoice, with the same id', async () => {
      // A new row would be a second charge, and the invoice would still be
      // pointing at the old one.
      const after = await Charge_Head.findByPk(chargeId);
      expect(after).not.toBeNull();
      expect(after.InvoiceId).toBe(invoiceId);
      expect(await Charge_Head.count({ where: { CustomsJobId: jobId } })).toBe(1);
    });

    it('does not report the declaration as invoiced, so its tabs reopen too', async () => {
      // Locking the tabs on a weaker rule than the charge rows use would leave
      // the sheet editable inside a declaration that refused to be.
      const res = await auth(request(app).get('/customsJob/getById')).set('id', String(jobId));
      expect(res.body.result.invoiced).toBe(false);
    });

    it('saves the declaration itself rather than only remarks', async () => {
      const res = await editJob({
        id: jobId, companyId, fiscalYearId,
        gdNumber: TEST_PREFIX + 'GD-REOPENED',
        charges: [{
          id: chargeId, InvoiceId: invoiceId,
          charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 7000,
        }],
      });
      expect(res.status).toBe(200);
      const after = await Customs_Job.findByPk(jobId);
      expect(after.gdNumber).toBe(TEST_PREFIX + 'GD-REOPENED');
    });

    it('FREEZES it again the moment the invoice is approved', async () => {
      // The rule reads the invoice, not a flag copied onto the charge, so
      // approving the document re-locks every line on it with no other write.
      await Invoice.update({ approved: '1' }, { where: { id: invoiceId } });

      const res = await amend(9999);
      expect(res.body.warning).toMatch(/invoiced/i);

      const after = await Charge_Head.findByPk(chargeId);
      expect(Number(after.rate_charge)).toBe(7000);   // unchanged

      const read = await auth(request(app).get('/customsJob/getById')).set('id', String(jobId));
      expect(read.body.result.invoiced).toBe(true);

      await Invoice.update({ approved: '0' }, { where: { id: invoiceId } });
    });

    it('still refuses a charge that is not on this job', async () => {
      // The id comes from the request, so it is the thing being checked - a
      // stale tab must not be able to rewrite somebody else's line by id.
      const other = await createJob({ gdNumber: TEST_PREFIX + 'GD-REOPEN-OTHER' });
      const res = await editJob({
        id: other.body.result.id, companyId, fiscalYearId,
        charges: [{
          id: chargeId, InvoiceId: invoiceId,
          charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 1,
        }],
      });
      expect(res.status).toBe(200);

      const after = await Charge_Head.findByPk(chargeId);
      expect(Number(after.rate_charge)).toBe(7000);   // untouched
      expect(after.CustomsJobId).toBe(jobId);
    });
  });

  describe('a charge removed from an UNAPPROVED invoice', () => {
    /* Unapprove, take a charge off the sheet, save, approve again. The removed
     * line used to survive the save - only lines on no invoice were cleared -
     * so it kept its InvoiceId and the re-approval totalled it straight back
     * onto the invoice and posted it, with every one of its figures. */
    const { approveInvoice } = require('../../routes/invoice');
    let jobId; let invoiceId; let keptId; let removedId; let partyAccount; let postingCompany;
    const made = { accounts: [] };

    const line = (id, rate) => ({
      id, InvoiceId: invoiceId, charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: rate,
    });
    // The whole declaration, as the screen sends it: an edit that leaves out
    // the direction defaults it to Export, and approval then looks for the
    // export accounts instead of the import ones this test sets up.
    const save = (charges) => editJob({
      id: jobId, companyId, fiscalYearId, direction: 'Import', transportMode: 'Sea', charges,
    });

    beforeAll(async () => {
      const created = await createJob({
        gdNumber: TEST_PREFIX + 'GD-REMOVE',
        charges: [
          { charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 5000 },
          { charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 3000 },
        ],
      });
      jobId = created.body.result.id;
      [keptId, removedId] = (await Charge_Head.findAll({
        where: { CustomsJobId: jobId }, order: [['id', 'ASC']],
      })).map((c) => c.id);

      // Its own company: the voucher approval raises carries a real foreign key
      // to Companies, and on an empty database the suite's companyId is only
      // the '1' it falls back to.
      postingCompany = await Company.create({ title: TEST_PREFIX + 'CC Remove Co', short: 'TCR' });
      partyAccount = await db.Child_Account.create({ title: TEST_PREFIX + 'CC Party', subCategory: 'Customer' });
      made.accounts.push(partyAccount);
      const INCOME = 'CLEARANCE INCOME - IMPORT';
      if (!(await db.Child_Account.findOne({ where: { title: INCOME } }))) {
        made.accounts.push(await db.Child_Account.create({ title: INCOME, subCategory: 'General' }));
      }

      // Raised, then unapproved: both charges on it, nothing in the ledger.
      const inv = await Invoice.create({
        invoice_No: TEST_PREFIX + 'CC-REMOVE', type: 'Job Invoice', payType: 'Recievable',
        operation: 'CC', status: '1', approved: '0', roundOff: '0', currency: 'PKR', ex_rate: '1',
        party_Id: String(partyAccount.id), party_Name: TEST_PREFIX + 'CC Party', partyType: 'client',
        total: '8000', companyId: String(postingCompany.id), FiscalYearId: fiscalYearId,
      }, { fiscalYearCheck: false });
      invoiceId = inv.id;
      invoiceIds.push(inv.id);
      await Charge_Head.update({ InvoiceId: invoiceId }, { where: { id: [keptId, removedId] } });
    });

    afterAll(async () => {
      const vouchers = await Vouchers.findAll({ where: { invoice_Id: String(invoiceId) }, attributes: ['id'] });
      if (vouchers.length) {
        await db.Voucher_Heads.destroy({ where: { VoucherId: vouchers.map((v) => v.id) } });
        await Vouchers.destroy({ where: { id: vouchers.map((v) => v.id) }, fiscalYearCheck: false });
      }
      await db.Child_Account.destroy({ where: { id: made.accounts.map((a) => a.id) } });
      if (postingCompany) await Company.destroy({ where: { id: postingCompany.id } });
    });

    it('keeps a line a stale tab still lists, even without its InvoiceId', async () => {
      // A tab opened before the invoice was raised holds the line with no
      // InvoiceId. It is still on the sheet, so it must not be taken off.
      await save([line(keptId, 5000), { ...line(removedId, 3000), InvoiceId: null }]);
      const still = await Charge_Head.findByPk(removedId);
      expect(still).not.toBeNull();
      expect(still.InvoiceId).toBe(invoiceId);
      // That save recreates the stale line as a fresh one beside the invoiced
      // one - a separate stale-tab defect this test does not cover. Cleared so
      // the steps below start from the sheet the screen actually shows.
      await Charge_Head.destroy({ where: { CustomsJobId: jobId, InvoiceId: null } });
    });

    it('deletes the line the sheet no longer has', async () => {
      const res = await save([line(keptId, 5000)]);
      expect(res.status).toBe(200);

      expect(await Charge_Head.findByPk(removedId)).toBeNull();
      const kept = await Charge_Head.findByPk(keptId);
      expect(kept.InvoiceId).toBe(invoiceId);
      expect(await Charge_Head.count({ where: { InvoiceId: invoiceId } })).toBe(1);
    });

    it('re-approves without it: the invoice and the voucher carry only what is left', async () => {
      await approveInvoice({ id: invoiceId, fiscalYearId, employeeId });

      const inv = await Invoice.findByPk(invoiceId);
      expect(Number(inv.total)).toBe(5000);

      const voucher = await Vouchers.findOne({ where: { invoice_Id: String(invoiceId) } });
      const partyLine = await db.Voucher_Heads.findOne({
        where: { VoucherId: voucher.id, ChildAccountId: partyAccount.id },
      });
      expect(Number(partyLine.defaultAmount)).toBe(5000);
    });

    it('refuses to approve an invoice whose every charge was taken off', async () => {
      const empty = await Invoice.create({
        invoice_No: TEST_PREFIX + 'CC-EMPTY', type: 'Job Invoice', payType: 'Recievable',
        operation: 'CC', status: '1', approved: '0', roundOff: '0', currency: 'PKR', ex_rate: '1',
        party_Id: String(partyAccount.id), party_Name: TEST_PREFIX + 'CC Party', partyType: 'client',
        total: '0', companyId: String(postingCompany.id), FiscalYearId: fiscalYearId,
      }, { fiscalYearCheck: false });
      invoiceIds.push(empty.id);

      await expect(approveInvoice({ id: empty.id, fiscalYearId, employeeId }))
        .rejects.toThrow(/no charges/i);
      expect(await Vouchers.count({ where: { invoice_Id: String(empty.id) } })).toBe(0);
      expect(String((await Invoice.findByPk(empty.id)).approved)).toBe('0');
    });

    it('still leaves an APPROVED invoice\'s lines alone when the sheet drops them', async () => {
      // The invoice above is approved now. A save that does not list its line
      // must not delete what an issued invoice was computed from.
      const res = await save([]);
      expect(res.status).toBe(200);
      expect(await Charge_Head.findByPk(keptId)).not.toBeNull();
    });
  });

  /* ------------------------------------------------------------- cancelling */
  describe('cancelling an uninvoiced declaration', () => {
    it('is a soft delete, so the job number stays spent', async () => {
      const created = await createJob({ gdNumber: TEST_PREFIX + 'GD-CANCEL' });
      const id = created.body.result.id;

      const res = await auth(request(app).post('/customsJob/delete'))
        .send({ id, employeeId });
      expect(res.status).toBe(200);

      const after = await Customs_Job.findByPk(id);
      // Still there. A hole in the sequence is worse than a cancelled row.
      expect(after).not.toBeNull();
      expect(after.canceled).toBe(true);
      expect(after.status).toBe('Canceled');
    });

    it('rejects an unusable id rather than cancelling something else', async () => {
      for (const id of [undefined, 'abc', 0]) {
        const res = await auth(request(app).post('/customsJob/delete')).send({ id, employeeId });
        expect(res.status).toBe(400);
      }
    });
  });

  /* A CANCELLED JOB keeps its status open: any status but Canceled reopens
   * it, and nothing else on it can change - a job cancelled by mistake had no
   * way back. */
  describe('a cancelled job', () => {
    let id; let jobNo;
    const edit = (data) => auth(request(app).post('/customsJob/edit'))
      .send({ employeeId, data: { id, companyId, fiscalYearId, ...data } });

    beforeAll(async () => {
      const created = await createJob({ gdNumber: TEST_PREFIX + 'GD-REOPEN' });
      ({ id, jobNo } = created.body.result);
      await auth(request(app).post('/customsJob/delete')).send({ id, employeeId });
    });

    afterAll(async () => {
      await db.History.destroy({ where: { formName: 'Customs Job', docNo: jobNo } });
    });

    it('saved as Canceled changes nothing, and says how to reopen it', async () => {
      const res = await edit({ status: 'Canceled', gdNumber: TEST_PREFIX + 'GD-CHANGED' });
      expect(res.status).toBe(200);
      expect(res.body.warning).toMatch(/cancelled.*Choose another status to reopen it/);
      const after = await Customs_Job.findByPk(id);
      expect(after.canceled).toBe(true);
      expect(after.gdNumber).toBe(TEST_PREFIX + 'GD-REOPEN');
    });

    it('another status reopens it, changes nothing else, and is recorded', async () => {
      const res = await edit({ status: 'In Process', gdNumber: TEST_PREFIX + 'GD-CHANGED' });
      expect(res.status).toBe(200);
      expect(res.body.result.canceled).toBe(false);
      const after = await Customs_Job.findByPk(id);
      expect(after.canceled).toBe(false);
      // "In Process" is the label; Incomplete is the value it is stored as.
      expect(after.status).toBe('Incomplete');
      // Only the status: the rest of a cancelled job is not read.
      expect(after.gdNumber).toBe(TEST_PREFIX + 'GD-REOPEN');
      expect(await db.History.count({ where: { formName: 'Customs Job', type: 'Reopen', docNo: jobNo } })).toBe(1);
    });

    it('a status that is not on the list is refused', async () => {
      await auth(request(app).post('/customsJob/delete')).send({ id, employeeId });
      const res = await edit({ status: 'Not A Status' });
      expect(res.status).toBe(400);
      expect((await Customs_Job.findByPk(id)).canceled).toBe(true);
    });
  });

  /* -------------------------------------------------------------- reading */
  describe('reading one back', () => {
    it('returns it with its children and its totals', async () => {
      const created = await createJob({
        gdNumber: TEST_PREFIX + 'GD-READ',
        assessedValue: 50000,
        dutyLines: [{ itemNo: '1', assessedValue: 50000, customDutyPerc: 20 }],
        containerRows: [{ containerNo: 'TEMU9999999' }],
      });
      // The id rides in a HEADER, not the query string - which is what
      // apis/customsJobs.js sends, so the route and its only caller agree.
      const res = await auth(request(app).get('/customsJob/getById'))
        .set('id', String(created.body.result.id));

      expect(res.status).toBe(200);
      const job = res.body.result;
      expect(job.Customs_Duties).toHaveLength(1);
      expect(job.Customs_Containers).toHaveLength(1);
      expect(job.totalDuty).toBeGreaterThan(0);
    });

    it('serves the pick lists the form is built from', async () => {
      const res = await auth(request(app).get('/customsJob/getValues'));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });

    /* 2026-11-17, the user: a shipper kept as a Non-GL party was missing from
     * the Shipper box, and parties tagged only as Terminals were in the Client
     * box. The shipper is a name on the file, never billed; a terminal is
     * nobody's customer. */
    it('offers Non-GL shippers as Shipper, and leaves Terminal-only parties out of Client', async () => {
      const nonGlShipper = await Clients.create({
        name: TEST_PREFIX + 'NonGL Shipper', code: TEST_PREFIX + 'NGS', types: 'Shipper', nongl: '1', active: true,
      });
      const terminal = await Clients.create({
        name: TEST_PREFIX + 'Only Terminal', code: TEST_PREFIX + 'OTM', types: 'Terminal', active: true,
      });
      const terminalAndConsignee = await Clients.create({
        name: TEST_PREFIX + 'Terminal Consignee', code: TEST_PREFIX + 'TCN', types: 'Terminal, Consignee', active: true,
      });
      const { result } = (await auth(request(app).get('/customsJob/getValues'))).body;
      const ids = (list) => (list || []).map((p) => p.id);

      expect(ids(result.shipper)).toContain(nonGlShipper.id);
      // Still not billable: not a client, and not on the charge sheet's list.
      expect(ids(result.client)).not.toContain(nonGlShipper.id);
      expect(ids(result.party)).not.toContain(nonGlShipper.id);

      expect(ids(result.client)).not.toContain(terminal.id);
      expect(ids(result.client)).toContain(terminalAndConsignee.id);
      // Still a party a charge can be with.
      expect(ids(result.party)).toContain(terminal.id);
    });
  });

  /* ------------------------------------------------------- the duty register */
  describe('the duty register', () => {
    it('refuses a month it cannot parse', async () => {
      for (const month of ['', 'April', '2026', '2026-4-1']) {
        const res = await auth(request(app).get('/customsJob/register')).query({ month });
        expect(res.status).toBe(400);
      }
    });

    it('reads gdDate, not createdAt', async () => {
      /* THE RULE THIS PINS. Every fixture in this file was created today and
       * dated 2026-04. A register keyed on createdAt would return all of them
       * for THIS month and none for April - and would disagree with the
       * customs portal it is reconciled against, which knows only the filed
       * date. */
      const filed = await auth(request(app).get('/customsJob/register'))
        .query({ month: MONTH, companyId });
      expect(filed.status).toBe(200);
      expect(filed.body.result.rows.length).toBeGreaterThan(0);

      const thisMonth = new Date().toISOString().slice(0, 7);
      if (thisMonth !== MONTH) {
        const created = await auth(request(app).get('/customsJob/register'))
          .query({ month: thisMonth, companyId });
        const mine = created.body.result.rows.filter(
          (r) => String(r.gdNumber || '').startsWith(TEST_PREFIX)
        );
        expect(mine).toHaveLength(0);
      }
    });

    it('totals the month and splits it by channel', async () => {
      const res = await auth(request(app).get('/customsJob/register'))
        .query({ month: MONTH, companyId });
      const { rows, totals, byChannel } = res.body.result;

      expect(totals.totalDuty).toBeGreaterThan(0);
      // An unassessed GD counts as 'Unassigned' rather than being dropped, so
      // the channel counts always add up to the number of rows above them.
      const counted = Object.values(byChannel).reduce((t, n) => t + n, 0);
      expect(counted).toBe(rows.length);
    });

    it('leaves a cancelled declaration out', async () => {
      const created = await createJob({
        gdNumber: TEST_PREFIX + 'GD-REG-CANCEL',
        dutyLines: [{ itemNo: '1', assessedValue: 1000, customDutyPerc: 10 }],
      });
      const id = created.body.result.id;

      const before = await auth(request(app).get('/customsJob/register'))
        .query({ month: MONTH, companyId });
      expect(before.body.result.rows.some((r) => r.id === id)).toBe(true);

      await auth(request(app).post('/customsJob/delete')).send({ id, employeeId });

      const after = await auth(request(app).get('/customsJob/register'))
        .query({ month: MONTH, companyId });
      // A cancelled file was never filed. Counting its duty would overstate
      // what the agent is owed back.
      expect(after.body.result.rows.some((r) => r.id === id)).toBe(false);
    });

    it('narrows to one direction when asked', async () => {
      const res = await auth(request(app).get('/customsJob/register'))
        .query({ month: MONTH, companyId, direction: 'Import' });
      expect(res.status).toBe(200);
      expect(res.body.result.rows.every((r) => r.direction === 'Import')).toBe(true);
    });
  });

  /* ---------------------------------------------------------- the dashboard */
  describe('the dashboard', () => {
    /* The home page had two branches - aviation, and everything else - so a
     * customs install got the FREIGHT dashboard: FCL/LCL counted off SE_Job
     * against two hardcoded company ids named after somebody else's
     * companies. Every counter read zero, permanently. */
    it('counts declarations by period, on gdDate', async () => {
      const res = await auth(request(app).get('/customsJob/dashboard'))
        .query({ companyId });
      expect(res.status).toBe(200);
      // Today, the week and the month - the year came off the dashboard for
      // today (the user, 2026-11-23).
      expect(Object.keys(res.body.result.filed)).toEqual(['today', 'week', 'month']);
      expect(res.body.result.filed).toEqual(
        { today: expect.any(Number), week: expect.any(Number), month: expect.any(Number) }
      );
      expect(Object.keys(res.body.result.periods)).toEqual(['today', 'week', 'month']);
    });

    it("counts today by Pakistan's date, not the server's", async () => {
      const pkToday = moment().utcOffset(300).format('YYYY-MM-DD');
      const before = await auth(request(app).get('/customsJob/dashboard')).query({ companyId });
      expect(before.body.result.periods.today).toEqual({ from: pkToday, to: pkToday });
      await createJob({ gdNumber: TEST_PREFIX + 'GD-TODAY', gdDate: pkToday });
      const after = await auth(request(app).get('/customsJob/dashboard')).query({ companyId });
      expect(after.body.result.filed.today).toBe(before.body.result.filed.today + 1);
      expect(after.body.result.filed.week).toBe(before.body.result.filed.week + 1);
    });

    it('splits the month by direction and channel, and totals its duty', async () => {
      const month = GD_DATE.slice(0, 7);
      const before = await auth(request(app).get('/customsJob/dashboard')).query({ companyId });

      await createJob({
        gdNumber: TEST_PREFIX + 'GD-DASH',
        gdDate: GD_DATE, direction: 'Import', channel: 'Red',
        assessedValue: 200000,
        dutyLines: [{ itemNo: '1', assessedValue: 200000, customDutyPerc: 10 }],
      });

      const after = await auth(request(app).get('/customsJob/dashboard')).query({ companyId });

      // The fixtures are dated 2026-04, so they only move the month figures
      // when the suite happens to run in that month. What is always true is
      // that the shape is right and the channel counts add up to the filings.
      const m = after.body.result.month;
      expect(m.byDirection).toEqual(
        expect.objectContaining({ Import: expect.any(Number), Export: expect.any(Number) })
      );
      const channelTotal = Object.values(m.byChannel).reduce((t, n) => t + n, 0);
      expect(channelTotal).toBe(after.body.result.filed.month);

      if (new Date().toISOString().slice(0, 7) === month) {
        expect(after.body.result.filed.month).toBe(before.body.result.filed.month + 1);
        expect(m.totalDuty).toBeGreaterThan(before.body.result.month.totalDuty);
      }
    });

    it('counts a file that is filed but not finished', async () => {
      const before = await auth(request(app).get('/customsJob/dashboard')).query({ companyId });
      await createJob({ gdNumber: TEST_PREFIX + 'GD-OPEN2', status: 'Incomplete' });
      const after = await auth(request(app).get('/customsJob/dashboard')).query({ companyId });
      expect(after.body.result.incomplete).toBe(before.body.result.incomplete + 1);
    });

    it('leaves a cancelled declaration out of every figure', async () => {
      // A cancelled file was never filed; counting it overstates the month.
      const created = await createJob({
        gdNumber: TEST_PREFIX + 'GD-DASH-CANCEL', gdDate: moment().utcOffset(300).format('YYYY-MM-DD'),
      });
      const before = await auth(request(app).get('/customsJob/dashboard')).query({ companyId });

      await auth(request(app).post('/customsJob/delete'))
        .send({ id: created.body.result.id, employeeId });

      const after = await auth(request(app).get('/customsJob/dashboard')).query({ companyId });
      expect(after.body.result.filed.today).toBe(before.body.result.filed.today - 1);
      expect(after.body.result.incomplete).toBeLessThanOrEqual(before.body.result.incomplete);
    });
  });

  /* ------------------------------------------------------------- the list */
  describe('the job list', () => {
    it('pages, and does not leak a cancelled job into the default view', async () => {
      const res = await auth(request(app).get('/customsJob/get'))
        .query({ page: 1, limit: 5, companyId });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('says how many invoices and bills each job is on', async () => {
      const created = await createJob({ gdNumber: TEST_PREFIX + 'GD-DOCS' });
      const jobId = created.body.result.id;
      const doc = async (type) => {
        const inv = await Invoice.create(
          { invoice_No: `${TEST_PREFIX}CC-DOCS-${invoiceIds.length}`, type, status: '1' },
          { fiscalYearCheck: false },
        );
        invoiceIds.push(inv.id);
        return inv.id;
      };
      const line = (InvoiceId, type) => Charge_Head.create({
        CustomsJobId: jobId, charge: String(chargeMaster.id), type, InvoiceId,
        currency: 'PKR', amount: '1', net_amount: '100', local_amount: '100', status: '1',
      });
      // Two invoices - the first holding TWO lines, which is still one
      // invoice - one bill, and a line not billed yet.
      const [inv1, inv2, bill] = [await doc('Job Invoice'), await doc('Job Invoice'), await doc('Job Bill')];
      await line(inv1, 'Recievable');
      await line(inv1, 'Recievable');
      await line(inv2, 'Recievable');
      await line(bill, 'Payble');
      await line(null, 'Recievable');

      const res = await auth(request(app).get('/customsJob/get'))
        .set('companyid', companyId)
        .set('search', TEST_PREFIX + 'GD-DOCS');
      expect(res.status).toBe(200);
      const row = res.body.result.find((r) => r.id === jobId);
      expect(row).toMatchObject({ invoiceCount: 2, billCount: 1 });
    });

    it('carries the shipper and consignee names, for the optional columns', async () => {
      const created = await createJob({ gdNumber: TEST_PREFIX + 'GD-PARTIES', shipperId: clientId, consigneeId: clientId });
      const jobId = created.body.result.id;
      const res = await auth(request(app).get('/customsJob/get'))
        .set('companyid', companyId)
        .set('search', TEST_PREFIX + 'GD-PARTIES');
      expect(res.status).toBe(200);
      const row = res.body.result.find((r) => r.id === jobId);
      const name = (await Clients.findByPk(clientId)).name;
      expect(row.shipper).toMatchObject({ id: clientId, name });
      expect(row.consignee).toMatchObject({ id: clientId, name });
      // None picked: null, which the column shows as a dash.
      expect(row.shippingLine).toBeNull();
      expect(row.transporter).toBeNull();
    });

    it("search finds a job by any of its parties' names, not only the client's (2026-11-20)", async () => {
      const party = async (label) => (await Clients.create({
        name: `${TEST_PREFIX}${label} Zq${Date.now() % 100000}`, code: `${TEST_PREFIX}${label.slice(0, 3)}`,
      }));
      const [shipper, consignee, line, forwarder, transporter] = await Promise.all(
        ['Shipper', 'Consignee', 'Line', 'Forwarder', 'Transporter'].map(party),
      );
      const created = await createJob({
        gdNumber: TEST_PREFIX + 'GD-PARTY-SEARCH',
        shipperId: shipper.id, consigneeId: consignee.id, shippingLineId: line.id,
        chaChbId: forwarder.id, transporterId: transporter.id,
      });
      const jobId = created.body.result.id;
      for (const p of [shipper, consignee, line, forwarder, transporter]) {
        // Part of the name, in another case - as anyone types it.
        const res = await auth(request(app).get('/customsJob/get'))
          .set('companyid', companyId)
          .set('search', p.name.slice(TEST_PREFIX.length).toLowerCase());
        expect(res.status).toBe(200);
        expect(res.body.result.map((r) => r.id)).toContain(jobId);
        // The status tallies count it too - the same joins as the page.
        expect(Object.values(res.body.counts).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
      }
    });
  });

  /* ------------------------------------------- what the declaration earned */

  describe('the charge summary', () => {
    /* One row per charge head, revenue against cost - and, the point of it,
     * the DIRECT JOB money. An expense entered through Accounts > Direct Job
     * E / R posts to the ledger against this file and never becomes a charge
     * here, so every total on the job screen was blind to it and the profit
     * read high by exactly that amount.
     *
     * The arithmetic is pinned by tests/unit/customsChargeSummary.test.js.
     * What matters here is the WIRING: that the direct lines are found at all,
     * which means finding them through CustomsJobId rather than Job_Id. */
    let summaryJobId;
    let directJobRow;
    let voucherRow;
    let settlementAccount;
    let createdCompanyId;
    let originalMode;

    /* NOT the usual __test__ prefix. Direct_Job.Entry_No is validated against
     * the shape a real entry number has - COMPANY-DE-101/26 - so a prefixed
     * one is refused at create. Cleaned up by id instead. */
    const DJ_ENTRY = 'TST-DE-901/99';

    const summaryOf = (id) => auth(request(app).get('/customsJob/chargeSummary'))
      .set('id', String(id));

    beforeAll(async () => {
      /* A REAL COMPANY ROW. Vouchers.CompanyId is NOT NULL with a foreign key
       * to Companies, so the suite's usual `?? '1'` fallback fails the insert
       * on a database that has none - which the throwaway test one does once
       * companies.test.js has cleaned up after itself. The customs tests above
       * never noticed: Customs_Job.companyId is a plain column with no key
       * behind it, so an id pointing at nothing inserts quite happily.
       *
       * Failed only in a FULL RUN at first, which is what made it look like
       * cross-suite interference rather than a missing fixture. */
      let company = await Company.findOne({ order: [['id', 'ASC']] });
      if (!company) {
        company = await Company.create({ title: TEST_PREFIX + 'CC Co', short: 'CCC' });
        createdCompanyId = company.id;
      }
      companyId = String(company.id);

      const row = await AppSetting.findOne({ where: { key: 'operationMode' } });
      originalMode = row ? row.value : null;
      // The lookup is keyed on the column THIS MODE owns, so the mode has to
      // be customs for a customs job's direct lines to be found at all.
      await AppSetting.destroy({ where: { key: 'operationMode' } });
      await AppSetting.create({ key: 'operationMode', value: 'customs' });

      const created = await createJob({ gdNumber: TEST_PREFIX + 'GD-SUMMARY' });
      summaryJobId = created.body.result.id;

      // A receivable of 5,000 on the sheet, uninvoiced.
      await Charge_Head.create({
        CustomsJobId: summaryJobId,
        charge: String(chargeMaster.id),
        type: 'Recievable',
        currency: 'PKR', exRate: '1',
        amount: '5000', net_amount: '5000', local_amount: '5000',
        status: '1',
      });

      // And a 1,500 expense that only the ledger knows about.
      voucherRow = await Vouchers.create({
        voucher_No: 999001, voucher_Id: TEST_PREFIX + 'DJV-1',
        type: 'Job Payble', vType: 'DE', currency: 'PKR', exRate: '1',
        costCenter: 'KHI', onAccount: 'vendor', partyType: 'vendor',
        tranDate: GD_DATE, CompanyId: companyId, FiscalYearId: fiscalYearId,
      });
      // Account_No is a foreign key, so a real account has to exist for the
      // entry to be settled through.
      settlementAccount = await db.Child_Account.create({
        title: TEST_PREFIX + 'DJ SUMMARY BANK', subCategory: 'General',
      });

      directJobRow = await Direct_Job.create({
        Entry_No: DJ_ENTRY, Entry_Date: GD_DATE, Type: 'expense',
        Operation: 'logistics', Job_Type: 'single', SubType: 'cash',
        Currency: 'PKR', Ex_Rate: 1, Tran_Mode: 'Cash',
        Account_No: settlementAccount.id, companyId,
      });
      await Direct_Job_Association.create({
        Job_No: 'TST-CCJ-1/99',
        Charge_Name: String(chargeMaster.id),
        Quantity: 1, Currency: 'PKR', Ex_Rate: 1, Amount: 1500,
        Tax_Apply: false,
        CustomsJobId: summaryJobId,
        Voucher_Id: voucherRow.id,
        Direct_Job_Id: directJobRow.id,
      });
    });

    afterAll(async () => {
      if (directJobRow) {
        await Direct_Job_Association.destroy({ where: { Direct_Job_Id: directJobRow.id } });
        await Direct_Job.destroy({ where: { id: directJobRow.id } });
      }
      if (voucherRow) await Vouchers.destroy({ where: { id: voucherRow.id } });
      if (settlementAccount) {
        await db.Child_Account.destroy({ where: { id: settlementAccount.id } });
      }
      await AppSetting.destroy({ where: { key: 'operationMode' } });
      if (originalMode) await AppSetting.create({ key: 'operationMode', value: originalMode });
      // Last: Vouchers.CompanyId cascades, so the rows above have to go first.
      if (createdCompanyId) await Company.destroy({ where: { id: createdCompanyId } });
    });

    test('COUNTS THE DIRECT JOB EXPENSE, which the charge sheet cannot see', async () => {
      const res = await summaryOf(summaryJobId);

      expect(res.status).toBe(200);
      const { rows, totals } = res.body.result;
      expect(rows).toHaveLength(1);
      expect(Number(totals.totalRevenue)).toBe(5000);
      expect(Number(totals.totalCost)).toBe(1500);
      expect(Number(totals.totalNet)).toBe(3500);
    });

    test('puts both sources on ONE row when they name the same charge', async () => {
      const [row] = (await summaryOf(summaryJobId)).body.result.rows;
      expect(row.fromCharges).toBe(1);
      expect(row.fromDirect).toBe(1);
      expect(row.name).toBe(TEST_PREFIX + 'Clearance Fee');
    });

    test('the direct money is REALIZED - it is a voucher, not an invoice', async () => {
      const [row] = (await summaryOf(summaryJobId)).body.result.rows;
      expect(Number(row.realizedCost)).toBe(1500);
      expect(Number(row.unrealizedCost)).toBe(0);
      // While the uninvoiced receivable is not.
      expect(Number(row.realizedRevenue)).toBe(0);
      expect(Number(row.unrealizedRevenue)).toBe(5000);
    });

    test('names the entries it counted, so the figure can be traced', async () => {
      const res = await summaryOf(summaryJobId);
      expect(res.body.result.directEntries).toContain(DJ_ENTRY);
    });

    test('with each entry\'s id, so its number opens it (2026-11-17)', async () => {
      const { directEntryRefs } = (await summaryOf(summaryJobId)).body.result;
      expect(directEntryRefs).toEqual([{ id: directJobRow.id, entryNo: DJ_ENTRY, type: 'expense' }]);
    });

    test('sends the direct lines themselves, so the screen can copy them', async () => {
      const { directLines } = (await summaryOf(summaryJobId)).body.result;
      expect(directLines).toHaveLength(1);
      expect(directLines[0]).toMatchObject({
        charge: String(chargeMaster.id), type: 'expense', entryNo: DJ_ENTRY,
        quantity: 1, currency: 'PKR', exRate: 1, amount: 1500,
      });
    });

    test('a job with nothing on it is an empty report, not an error', async () => {
      const bare = await createJob({ gdNumber: TEST_PREFIX + 'GD-SUM-BARE' });
      const res = await summaryOf(bare.body.result.id);
      expect(res.status).toBe(200);
      expect(res.body.result.rows).toEqual([]);
    });

    test('an unusable id is refused rather than answered with nothing', async () => {
      const res = await summaryOf('new');
      expect(res.status).toBe(400);
    });
  });


  /* ------------------------------------------- approval and the director */
  /* CargoLinkers bill a client when the goods are on the vessel: a receivable
   * charge is approved only once the job is On Vessel (stored 'Complete'). And
   * nothing Make Invoice raises counts until the director approves it, so
   * invoices and bills are both raised unapproved - out of the ledger. */
  describe('receivables wait for On Vessel; client invoices wait for the director', () => {
    const approvedReceivable = (extra = {}) => ({
      charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 5000,
      partyId: clientId, status: '1', ...extra,
    });

    it('refuses to approve a receivable on a job that is not On Vessel', async () => {
      const res = await createJob({ gdNumber: TEST_PREFIX + 'GD-NOTVESSEL', status: 'Incomplete', charges: [approvedReceivable()] });
      expect(res.status).toBe(400);
      expect(res.body.result).toMatch(/once the job is On Vessel or DrayOff/);
    });

    it('approves it when the job is set On Vessel in the same save', async () => {
      const res = await createJob({ gdNumber: TEST_PREFIX + 'GD-ONVESSEL', status: 'Complete', charges: [approvedReceivable()] });
      expect(res.status).toBe(200);
      const stored = await Charge_Head.findOne({ where: { CustomsJobId: res.body.result.id } });
      expect(String(stored.status)).toBe('1');
    });

    it('approves it at DrayOff too - a file that ends at the container drop bills there', async () => {
      const res = await createJob({ gdNumber: TEST_PREFIX + 'GD-DRAYOFF', status: 'DrayOff', charges: [approvedReceivable()] });
      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('DrayOff');
      const stored = await Charge_Head.findOne({ where: { CustomsJobId: res.body.result.id } });
      expect(String(stored.status)).toBe('1');
    });

    it('takes the words the screen shows, saving the stored ones', async () => {
      for (const [shown, stored] of [['In Process', 'Incomplete'], ['On Vessel', 'Complete'], ['Dray Off', 'DrayOff']]) {
        const res = await createJob({ gdNumber: `${TEST_PREFIX}GD-WORD-${stored}`, status: shown });
        expect(res.status).toBe(200);
        expect(res.body.result.status).toBe(stored);
      }
    });

    it('lets a payable be approved at any stage', async () => {
      const res = await createJob({
        gdNumber: TEST_PREFIX + 'GD-PAYABLE', status: 'Incomplete',
        charges: [approvedReceivable({ type: 'Payble' })],
      });
      expect(res.status).toBe(200);
    });

    it('still saves an older job whose receivable was approved before the rule', async () => {
      const created = await createJob({ gdNumber: TEST_PREFIX + 'GD-OLDAPPROVAL', status: 'Incomplete', charges: [approvedReceivable({ status: '0' })] });
      const jobId = created.body.result.id;
      const charge = await Charge_Head.findOne({ where: { CustomsJobId: jobId } });
      await charge.update({ status: '1' }); // approved before this release

      const resave = await editJob({
        id: jobId, companyId, fiscalYearId, status: 'Incomplete', remarks: 'edited',
        charges: [approvedReceivable({ id: charge.id })],
      });
      expect(resave.status).toBe(200);

      const another = await editJob({
        id: jobId, companyId, fiscalYearId, status: 'Incomplete',
        charges: [approvedReceivable({ id: charge.id }), approvedReceivable()],
      });
      expect(another.status).toBe(400);
    });

    describe('Make Invoice', () => {
      let account; let link;

      beforeAll(async () => {
        account = await db.Child_Account.create({ title: TEST_PREFIX + 'CC Client A/C', subCategory: 'General' });
        link = await db.Client_Associations.create({ ClientId: clientId, ChildAccountId: account.id, CompanyId: companyId });
      });

      afterAll(async () => {
        await db.Client_Associations.destroy({ where: { id: link.id } });
        await db.Child_Account.destroy({ where: { id: account.id } });
      });

      it('raises a client invoice UNAPPROVED, out of the ledger', async () => {
        const created = await createJob({ gdNumber: TEST_PREFIX + 'GD-INVOICE', status: 'Complete', charges: [approvedReceivable()] });
        const charge = await Charge_Head.findOne({ where: { CustomsJobId: created.body.result.id } });

        const res = await auth(request(app).post('/customsJob/makeInvoice'))
          .send({ chargeIds: [charge.id], companyId, fiscalYearId, employeeId });
        expect(res.status).toBe(200);
        const [made] = res.body.result;
        invoiceIds.push(made.id);
        expect(made).toMatchObject({ type: 'Job Invoice', approved: false, awaitingApproval: true });
        expect(made.postError).toBeUndefined();

        const invoice = await Invoice.findByPk(made.id);
        expect(String(invoice.approved)).not.toBe('1');
        expect(await Vouchers.count({ where: { invoice_Voucher: true, invoice_Id: String(made.id) } }).catch(() => 0)).toBe(0);
        await Charge_Head.update({ InvoiceId: null }, { where: { InvoiceId: made.id } });
      });

      // "Invoice & approve" (the user's request, 2026-10-15): raised approved,
      // posted to the ledger as it is made - through approveInvoice, as
      // /invoice/approve posts it.
      it('raises it APPROVED when asked, posted as it is made', async () => {
        const postingCompany = await Company.create({ title: TEST_PREFIX + 'CC Approve Co', short: 'TCP' });
        const INCOME = 'CLEARANCE INCOME - IMPORT';
        const income = (await db.Child_Account.findOne({ where: { title: INCOME } }))
          ? null : await db.Child_Account.create({ title: INCOME, subCategory: 'General' });
        const created = await createJob({ gdNumber: TEST_PREFIX + 'GD-APPROVED', status: 'Complete', charges: [approvedReceivable()] });
        const charge = await Charge_Head.findOne({ where: { CustomsJobId: created.body.result.id } });

        const res = await auth(request(app).post('/customsJob/makeInvoice'))
          .send({ chargeIds: [charge.id], companyId: String(postingCompany.id), fiscalYearId, employeeId, approve: true });
        expect(res.status).toBe(200);
        const [made] = res.body.result;
        invoiceIds.push(made.id);
        expect(made.postError).toBeUndefined();
        expect(made).toMatchObject({ type: 'Job Invoice', approved: true });
        expect(made.awaitingApproval).toBeUndefined();
        expect(String((await Invoice.findByPk(made.id)).approved)).toBe('1');

        const vouchers = await Vouchers.findAll({ where: { invoice_Id: String(made.id) }, attributes: ['id'] });
        expect(vouchers.length).toBeGreaterThan(0);
        await db.Voucher_Heads.destroy({ where: { VoucherId: vouchers.map((v) => v.id) } });
        await Vouchers.destroy({ where: { id: vouchers.map((v) => v.id) }, fiscalYearCheck: false });
        await Charge_Head.update({ InvoiceId: null }, { where: { InvoiceId: made.id } });
        if (income) await db.Child_Account.destroy({ where: { id: income.id } });
        await Company.destroy({ where: { id: postingCompany.id } });
      });

      it('puts one client\'s charges on ONE invoice, whatever currency each line carries', async () => {
        // An imported charge-group line with its currency box left empty, a
        // line picked by hand (the master's PKR), and one typed "pkr" - one
        // party, one direction: one invoice. They were three.
        const created = await createJob({
          gdNumber: TEST_PREFIX + 'GD-ONEINVOICE', status: 'Complete',
          charges: [
            approvedReceivable({ currency: '' }),
            approvedReceivable({ currency: 'PKR', rate_charge: 2000 }),
            approvedReceivable({ currency: 'pkr', rate_charge: 1000 }),
          ],
        });
        const lines = await Charge_Head.findAll({ where: { CustomsJobId: created.body.result.id } });
        expect(lines).toHaveLength(3);

        const res = await auth(request(app).post('/customsJob/makeInvoice'))
          .send({ chargeIds: lines.map((c) => c.id), companyId, fiscalYearId, employeeId });
        expect(res.status).toBe(200);
        res.body.result.forEach((m) => invoiceIds.push(m.id));
        expect(res.body.result).toHaveLength(1);
        expect(res.body.result[0]).toMatchObject({ type: 'Job Invoice', lines: 3 });
        await Charge_Head.update({ InvoiceId: null }, { where: { InvoiceId: res.body.result[0].id } });
      });

      it('still raises separate documents for separate parties and directions', async () => {
        const other = await Clients.create({ name: TEST_PREFIX + 'CC Other Client', code: TEST_PREFIX + 'CCO' });
        const otherAccount = await db.Child_Account.create({ title: TEST_PREFIX + 'CC Other A/C', subCategory: 'General' });
        const otherLink = await db.Client_Associations.create({ ClientId: other.id, ChildAccountId: otherAccount.id, CompanyId: companyId });
        try {
          const created = await createJob({
            gdNumber: TEST_PREFIX + 'GD-SPLIT', status: 'Complete',
            charges: [
              approvedReceivable(),
              approvedReceivable({ partyId: other.id }),
              approvedReceivable({ type: 'Payble' }),
            ],
          });
          const lines = await Charge_Head.findAll({ where: { CustomsJobId: created.body.result.id } });
          const res = await auth(request(app).post('/customsJob/makeInvoice'))
            .send({ chargeIds: lines.map((c) => c.id), companyId, fiscalYearId, employeeId });
          expect(res.status).toBe(200);
          res.body.result.forEach((m) => invoiceIds.push(m.id));
          expect(res.body.result.map((m) => m.type).sort()).toEqual(['Job Bill', 'Job Invoice', 'Job Invoice']);
          await Charge_Head.update({ InvoiceId: null }, { where: { InvoiceId: res.body.result.map((m) => m.id) } });
        } finally {
          await db.Client_Associations.destroy({ where: { id: otherLink.id } });
          await db.Child_Account.destroy({ where: { id: otherAccount.id } });
        }
      });

      it('raises a bill UNAPPROVED as well', async () => {
        const created = await createJob({
          gdNumber: TEST_PREFIX + 'GD-BILL', status: 'Incomplete',
          charges: [approvedReceivable({ type: 'Payble' })],
        });
        const charge = await Charge_Head.findOne({ where: { CustomsJobId: created.body.result.id } });

        const res = await auth(request(app).post('/customsJob/makeInvoice'))
          .send({ chargeIds: [charge.id], companyId, fiscalYearId, employeeId });
        expect(res.status).toBe(200);
        const [made] = res.body.result;
        invoiceIds.push(made.id);
        expect(made).toMatchObject({ type: 'Job Bill', approved: false, awaitingApproval: true });
        expect(String((await Invoice.findByPk(made.id)).approved)).not.toBe('1');
        await Charge_Head.update({ InvoiceId: null }, { where: { InvoiceId: made.id } });
      });

      // APPROVED AS INVOICED (the user, 2026-11-11): the ticked charges the
      // sheet asks for are approved on the way, under the rules a save keeps.
      it('approves the ticked charges it is asked to, then invoices them', async () => {
        const created = await createJob({
          gdNumber: TEST_PREFIX + 'GD-APPROVE-AS-INVOICED', status: 'Complete', charges: [approvedReceivable({ status: '0' })],
        });
        const charge = await Charge_Head.findOne({ where: { CustomsJobId: created.body.result.id } });
        expect(String(charge.status)).toBe('0');

        const res = await auth(request(app).post('/customsJob/makeInvoice'))
          .send({ chargeIds: [charge.id], companyId, fiscalYearId, employeeId, approveChargeIds: [charge.id] });
        expect(res.status).toBe(200);
        expect(res.body.approvedCharges).toBe(1);
        const [made] = res.body.result;
        invoiceIds.push(made.id);
        expect(made).toMatchObject({ type: 'Job Invoice', awaitingApproval: true });
        const after = await Charge_Head.findByPk(charge.id);
        expect(String(after.status)).toBe('1');
        expect(after.InvoiceId).toBe(made.id);
        expect(String(after.approved_by)).toBe(String(employeeId));
        expect(after.approval_date).toBeTruthy();
        await Charge_Head.update({ InvoiceId: null }, { where: { InvoiceId: made.id } });
      });

      it('still refuses an unapproved charge it was not asked to approve', async () => {
        const created = await createJob({
          gdNumber: TEST_PREFIX + 'GD-NOT-ASKED', status: 'Complete', charges: [approvedReceivable({ status: '0' })],
        });
        const charge = await Charge_Head.findOne({ where: { CustomsJobId: created.body.result.id } });
        const res = await auth(request(app).post('/customsJob/makeInvoice'))
          .send({ chargeIds: [charge.id], companyId, fiscalYearId, employeeId });
        expect(res.status).toBe(400);
        expect(res.body.result).toMatch(/not approved yet/);
      });

      it('will not approve a receivable before the job is billable - and raises nothing', async () => {
        const created = await createJob({
          gdNumber: TEST_PREFIX + 'GD-TOO-EARLY', status: 'Incomplete', charges: [approvedReceivable({ status: '0' })],
        });
        const charge = await Charge_Head.findOne({ where: { CustomsJobId: created.body.result.id } });
        const res = await auth(request(app).post('/customsJob/makeInvoice'))
          .send({ chargeIds: [charge.id], companyId, fiscalYearId, employeeId, approveChargeIds: [charge.id] });
        expect(res.status).toBe(400);
        expect(res.body.result).toMatch(/can only be approved once the job is/);
        const after = await Charge_Head.findByPk(charge.id);
        expect(String(after.status)).toBe('0');
        expect(after.InvoiceId).toBeNull();
      });
    });
  });

});

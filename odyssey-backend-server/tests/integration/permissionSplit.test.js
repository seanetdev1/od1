const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const db = require('../../models');
const permissions = require('../../functions/permissions/middleware');
const grants = require('../../functions/permissions/grants');
const partyKind = require('../../functions/partyKind');
const { Charge_Head } = require('../../functions/Associations/incoiceAssociations');

/* THE USER'S REQUESTS OF 2026-10-10, ENFORCED:
 *   - a job's details apart from its charges (jobCharges), and
 *   - Parties as three: Non-GL, Customers (AR), Vendors (AP).
 * Through the routes, in enforce mode, with users set up in the grid. */
describe('job details apart from job charges; parties by kind', () => {
  const stamp = Date.now();
  let admin; let clerk; let accounts; let partyClerk; let vendorClerk;
  let fiscalYearId; let companyId; let clientId; let chargeMaster; let jobId;
  const made = { accounts: [], clients: [] };

  const as = (who) => (req) => req.set('Authorization', who.authHeader).set('x-fiscal-year-id', String(fiscalYearId));
  const grant = async (who, names) => {
    for (const n of [...names, 'perm:catalog:2']) {
      await db.Access_Levels.create({ EmployeeId: who.employee.id, access_name: n });
    }
    grants.invalidate(who.employee.id);
  };
  const charges = () => Charge_Head.findAll({ where: { CustomsJobId: jobId }, order: [['id', 'ASC']], raw: true });
  const editJob = (who, data) => as(who)(request(app).post('/customsJob/edit'))
    .send({ employeeId: who.employee.id, data: { id: jobId, companyId, fiscalYearId, ...data } });

  beforeAll(async () => {
    permissions._setModeForTest('enforce');
    partyKind._resetCache();
    admin = await loginAs('admin');
    clerk = await loginAs('employee');        // the job, not its charges
    accounts = await loginAs('employee');     // the charges, not the job
    partyClerk = await loginAs('employee');   // name-only parties only
    vendorClerk = await loginAs('employee');  // vendors only
    await grant(clerk, ['perm:customs:view', 'perm:customs:edit']);
    await grant(accounts, ['perm:customs:view', 'perm:jobCharges:view', 'perm:jobCharges:edit']);
    await grant(partyClerk, ['perm:nonGlParties:view', 'perm:nonGlParties:edit']);
    await grant(vendorClerk, ['perm:vendors:view', 'perm:vendors:edit']);

    const year = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    fiscalYearId = year ? year.id : (await db.FiscalYears.create({
      label: TEST_PREFIX + 'FY', suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
    })).id;
    companyId = String((await anyCompany()).id);
    clientId = (await db.Clients.create({ name: `${TEST_PREFIX}PS Client ${stamp}`, code: `${TEST_PREFIX}PS${stamp % 100000}` })).id;
    made.clients.push(clientId);
    chargeMaster = await db.Charges.create({
      code: 9802, name: TEST_PREFIX + 'Split Fee', short: 'TSPF', currency: 'PKR', calculationType: 'Per Unit',
      status: true, defaultPaybleParty: 'Shipper', defaultRecivableParty: 'Shipper', taxApply: 'false', taxPerc: '0',
    });
    const res = await as(admin)(request(app).post('/customsJob/create')).send({
      employeeId: admin.employee.id,
      data: {
        companyId, fiscalYearId, direction: 'Import', transportMode: 'Sea', clientId,
        gdNumber: `${TEST_PREFIX}GD-SPLIT`, gdDate: '2026-04-15', remarks: 'opened',
        charges: [{ charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 1000 }],
      },
    });
    expect(res.status).toBe(200);
    jobId = res.body.result.id;
  });

  afterAll(async () => {
    permissions._setModeForTest(null);
    await Charge_Head.destroy({ where: { CustomsJobId: jobId } });
    await db.Customs_Job.destroy({ where: { id: jobId } });
    await db.Charges.destroy({ where: { id: chargeMaster.id } });
    await db.Client_Associations.destroy({ where: { ClientId: made.clients } });
    await db.Clients.destroy({ where: { id: made.clients } });
    await db.Child_Account.destroy({ where: { id: made.accounts.slice().reverse() } });
  });

  describe('a job and its charges', () => {
    it('the job, not its charges: the declaration saves, the charge sheet stays as it was', async () => {
      const [line] = await charges();
      const res = await editJob(clerk, { remarks: 'by the clerk', charges: [{ ...line, rate_charge: 5 }] });
      expect(res.status).toBe(200);
      expect((await db.Customs_Job.findByPk(jobId, { raw: true })).remarks).toBe('by the clerk');
      expect(Number((await charges())[0].rate_charge)).toBe(1000);
    });

    it("and freight's charge routes refuse them", async () => {
      const res = await as(clerk)(request(app).post('/invoice/saveHeadesNew')).send({ charges: [], deleteList: [] });
      expect(res.status).toBe(403);
    });

    it('the charges, not the job: the charge sheet saves, the declaration stays as it was', async () => {
      const [line] = await charges();
      const res = await editJob(accounts, { remarks: 'by accounts', charges: [{ ...line, rate_charge: 1200 }] });
      expect(res.status).toBe(200);
      expect((await db.Customs_Job.findByPk(jobId, { raw: true })).remarks).toBe('by the clerk');
      expect(Number((await charges())[0].rate_charge)).toBe(1200);
    });

    it('says what each may do, for the screens', async () => {
      const res = await request(app).get('/authRoutes/myPermissions').set('Authorization', accounts.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.result).toMatchObject({ all: false, granular: true });
      expect(res.body.result.perms).toEqual(expect.arrayContaining(['jobCharges:edit', 'customs:view']));
      expect(res.body.result.perms).not.toContain('customs:edit');
    });
  });

  describe('parties by kind', () => {
    let debtors; let creditors; let customer; let vendor; let nonGl;
    const account = async (title, parent = null) => {
      const a = await db.Child_Account.create({ title: `${TEST_PREFIX}${title} ${stamp}`, subCategory: 'General', ChildAccountId: parent });
      made.accounts.push(a.id);
      return a;
    };
    const party = async (name, ledgerParent) => {
      const c = await db.Clients.create({ name: `${TEST_PREFIX}${name} ${stamp}`, code: `${TEST_PREFIX}K${name}${stamp % 10000}`, nongl: ledgerParent ? '0' : '1' });
      made.clients.push(c.id);
      if (ledgerParent) {
        const ledger = await account(`${name} LEDGER`, ledgerParent.id);
        await db.Client_Associations.create({ ClientId: c.id, ChildAccountId: ledger.id });
      }
      return c;
    };
    const create = (who, body) => request(app).post('/clientRoutes/createClient').set('Authorization', who.authHeader)
      .send({ types: [], operations: [], ...body });

    beforeAll(async () => {
      // A chart with no Party Accounts for these: its roots' titles decide.
      const assets = await account('ASSETS');
      const liabilities = await account('LIABILITIES');
      debtors = await account('SUNDRY DEBTORS', assets.id);
      creditors = await account('SUNDRY CREDITORS', liabilities.id);
      customer = await party('CUSTOMER', debtors);
      vendor = await party('VENDOR', creditors);
      nonGl = await party('NAMEONLY', null);
    });

    it('each party is the kind its ledger makes it', async () => {
      const kinds = await partyKind.partyKinds(db, [customer.id, vendor.id, nonGl.id]);
      expect([kinds.get(customer.id), kinds.get(vendor.id), kinds.get(nonGl.id)]).toEqual(['customer', 'vendor', 'nonGl']);
    });

    it('the list holds only the kinds a user may see', async () => {
      const res = await request(app).get('/clientRoutes/getClients').set('Authorization', partyClerk.authHeader);
      expect(res.status).toBe(200);
      const ids = res.body.result.map((c) => c.id);
      expect(ids).toContain(nonGl.id);
      expect(ids).not.toContain(customer.id);
      expect(ids).not.toContain(vendor.id);
      expect(res.body.result.find((c) => c.id === nonGl.id).kind).toBe('nonGl');
    });

    it('a vendor clerk gives a new party a payable ledger - the grid right, not the designation', async () => {
      const res = await create(vendorClerk, { name: `${TEST_PREFIX}NEW VENDOR ${stamp}`, pAccountName: creditors.id });
      expect(res.status).toBe(200);
      made.clients.push(res.body.result.id);
      const link = await db.Client_Associations.findOne({ where: { ClientId: res.body.result.id }, raw: true });
      expect(link).not.toBeNull();
      made.accounts.push(link.ChildAccountId);
    });

    it('but not a receivable one: that is a customer', async () => {
      const res = await create(vendorClerk, { name: `${TEST_PREFIX}NOT A CUSTOMER ${stamp}`, pAccountName: debtors.id });
      expect(res.status).toBe(403);
    });

    it('a Non-GL clerk makes name-only parties', async () => {
      const res = await create(partyClerk, { name: `${TEST_PREFIX}NAME ONLY NEW ${stamp}` });
      expect(res.status).toBe(200);
      made.clients.push(res.body.result.id);
      expect(res.body.result.nongl).toBe('1');
    });
  });
});

/* A grid save is marked as complete, so charges unticked there stay unticked
   rather than being carried back in from the job rights. */
describe('saving a user through the grid with no charges ticked', () => {
  it('keeps them without charges', async () => {
    const { authHeader } = await loginAs('admin');
    const res = await request(app).post('/employeeRoutes/createEmployee').set('Authorization', authHeader).send({
      values: {
        empName: `${TEST_PREFIX}NoCharges ${Date.now()}`, userName: `${TEST_PREFIX}nocharges_${Date.now()}`,
        code: `${TEST_PREFIX}NC${Date.now()}`, pass: 'grid-pass-123', selectDesignation: 'employee',
        permissions: ['perm:customs:view', 'perm:customs:edit'],
      },
    });
    expect(res.body.status).toBe('success');
    const g = await grants.grantsFor(res.body.result.id);
    expect(g.perms.has('customs:edit')).toBe(true);
    expect(g.perms.has('jobCharges:view')).toBe(false);
    await db.Access_Levels.destroy({ where: { EmployeeId: res.body.result.id } });
  });
});

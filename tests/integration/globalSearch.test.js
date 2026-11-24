const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const db = require('../../models');
const grants = require('../../functions/permissions/grants');
const permissions = require('../../functions/permissions/middleware');

/* THE HEADER'S SEARCH (the user, 2026-11-23): jobs, B/L & AWB, invoices &
 * bills, vouchers and parties - and a B/L or waybill number brings its job. */
describe('header search', () => {
  const stamp = String(Date.now()).slice(-8);
  const made = { jobs: [], bls: [], customs: [], invoices: [], vouchers: [], clients: [] };
  let admin; let narrow; let company; let fiscalYear; const fx = {};

  const search = async (q, who = admin) => {
    const res = await request(app).get('/search').query({ q }).set('Authorization', who.authHeader);
    expect(res.status).toBe(200);
    return res.body.result;
  };
  const ids = (list) => list.map((x) => `${x.kind}-${x.id}`);

  beforeAll(async () => {
    company = await anyCompany();
    fiscalYear = await anyFiscalYear();
    admin = await loginAs('admin');
    narrow = await loginAs('employee');

    fx.client = await db.Clients.create({ name: `${TEST_PREFIX}GLOBEX ${stamp}`, code: `GX${stamp}` });
    made.clients.push(fx.client.id);
    fx.job = await db.SE_Job.create({
      jobNo: `${TEST_PREFIX}SEJ-${stamp}/27`, operation: 'SE', subType: 'FCL', pol: 'PKKHI', pod: 'FRLEH',
      companyId: String(company.id), ClientId: fx.client.id,
    }, { fiscalYearCheck: false });
    made.jobs.push(fx.job.id);
    fx.bl = await db.Bl.create({ hbl: ` HB${stamp}`, mbl: `MB${stamp}`, operation: 'SE', SEJobId: fx.job.id });
    made.bls.push(fx.bl.id);
    fx.airJob = await db.SE_Job.create({
      jobNo: `${TEST_PREFIX}AEJ-${stamp}/27`, operation: 'AE', companyId: String(company.id),
    }, { fiscalYearCheck: false });
    made.jobs.push(fx.airJob.id);
    fx.awb = await db.Bl.create({ hbl: `HW${stamp}`, mbl: `MW${stamp}`, operation: 'AE', SEJobId: fx.airJob.id });
    made.bls.push(fx.awb.id);
    fx.customs = await db.Customs_Job.create({
      jobNo: `${TEST_PREFIX}TP-${stamp}/27`, direction: 'Export', companyId: String(company.id),
      gdNumber: `GD${stamp}`, blNo: `CB${stamp}`, clientId: fx.client.id,
    }, { fiscalYearCheck: false });
    made.customs.push(fx.customs.id);
    fx.invoice = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}JI-${stamp}/27`, invoice_Id: 1, type: 'Job Invoice', payType: 'Recievable',
      operation: 'SE', status: '1', approved: '0', roundOff: '0', currency: 'PKR', ex_rate: '1',
      party_Name: fx.client.name, partyType: 'client', total: '1500', companyId: String(company.id), FiscalYearId: fiscalYear.id,
    }, { fiscalYearCheck: false });
    made.invoices.push(fx.invoice.id);
    fx.voucher = await db.Vouchers.create({
      voucher_No: 990000 + Number(stamp.slice(-3)), voucher_Id: `${TEST_PREFIX}BPV-${stamp}`, vType: 'BPV',
      type: 'Bank Payment Voucher', currency: 'PKR', exRate: '1', CompanyId: company.id,
    }, { fiscalYearCheck: false });
    made.vouchers.push(fx.voucher.id);
  });

  beforeEach(() => grants._resetCache());

  afterAll(async () => {
    await db.Vouchers.destroy({ where: { id: made.vouchers } });
    await db.Invoice.destroy({ where: { id: made.invoices } });
    await db.Customs_Job_Status.destroy({ where: { CustomsJobId: made.customs } });
    await db.Customs_Job.destroy({ where: { id: made.customs } });
    await db.Bl.destroy({ where: { id: made.bls } });
    await db.SE_Job.destroy({ where: { id: made.jobs } });
    await db.Clients.destroy({ where: { id: made.clients } });
  });

  it('under two characters, nothing', async () => {
    const r = await search('S');
    expect([r.jobs, r.bls, r.invoices, r.vouchers, r.parties].every((l) => l.length === 0)).toBe(true);
  });

  it('a job by its number, as the row shows it', async () => {
    const r = await search(`SEJ-${stamp}`);
    const job = r.jobs.find((x) => x.id === fx.job.id);
    expect(job).toEqual(expect.objectContaining({
      kind: 'freightJob', tag: 'Sea Export Job', operation: 'SE', load: 'FCL', route: 'PKKHI → FRLEH', party: fx.client.name,
    }));
    expect(job.matchedOn).toBeUndefined();
  });

  it("a B/L's number: the B/L, and the job it belongs to, saying which number matched", async () => {
    const r = await search(`HB${stamp}`);
    const bl = r.bls.find((x) => x.kind === 'freightBl' && x.id === fx.bl.id);
    // Stored with a leading space; shown without.
    expect(bl).toEqual(expect.objectContaining({ no: `HB${stamp}`, tag: 'Sea B/L', house: `HB${stamp}`, master: `MB${stamp}`, houseName: 'HBL', masterName: 'MBL' }));
    const job = r.jobs.find((x) => x.id === fx.job.id);
    expect(job.matchedOn).toBe(`HBL HB${stamp}`);
  });

  it("an air job's MAWB is called that, and finds its job", async () => {
    const r = await search(`MW${stamp}`);
    expect(r.bls.find((x) => x.id === fx.awb.id)).toEqual(expect.objectContaining({ tag: 'Air AWB', masterName: 'MAWB' }));
    expect(r.jobs.find((x) => x.id === fx.airJob.id).matchedOn).toBe(`MAWB MW${stamp}`);
  });

  it('a customs job by its number, its GD, or its B/L - which brings the job too', async () => {
    expect(ids((await search(`TP-${stamp}`)).jobs)).toContain(`customsJob-${fx.customs.id}`);
    expect(ids((await search(`GD${stamp}`)).jobs)).toContain(`customsJob-${fx.customs.id}`);
    const r = await search(`CB${stamp}`);
    expect(r.bls.find((x) => x.id === fx.customs.id)).toEqual(expect.objectContaining({ tag: 'Customs B/L', jobNo: fx.customs.jobNo }));
    expect(r.jobs.find((x) => x.id === fx.customs.id).matchedOn).toBe(`B/L CB${stamp}`);
  });

  it('an invoice, a voucher and a party', async () => {
    const inv = (await search(`JI-${stamp}`)).invoices.find((x) => x.id === fx.invoice.id);
    expect(inv).toEqual(expect.objectContaining({ tag: 'Job Invoice', amount: 1500, currency: 'PKR', unapproved: true }));
    const v = (await search(`BPV-${stamp}`)).vouchers.find((x) => x.id === fx.voucher.id);
    expect(v).toEqual(expect.objectContaining({ tag: 'BPV', type: 'Bank Payment Voucher' }));
    expect(ids((await search(`GLOBEX ${stamp}`)).parties)).toContain(`party-${fx.client.id}`);
  });

  it('a kind the user may not see is left out (permissions enforced)', async () => {
    // One right that reaches none of these records. (A job right would not
    // do: until a user is saved again, it carries to the job's charges and
    // invoices - functions/permissions/grants.)
    await db.Access_Levels.create({ EmployeeId: narrow.employee.id, access_name: 'perm:commodity:view' });
    permissions._setModeForTest('enforce');
    try {
      const r = await search(stamp, narrow);
      expect(r).toEqual(expect.objectContaining({ jobs: [], bls: [], invoices: [], vouchers: [], parties: [] }));
    } finally {
      permissions._setModeForTest(null);
      await db.Access_Levels.destroy({ where: { EmployeeId: narrow.employee.id } });
    }
  });
});

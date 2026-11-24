const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const db = require('../../models');
const permissions = require('../../functions/permissions/middleware');
const grants = require('../../functions/permissions/grants');
const { Charge_Head } = require('../../functions/Associations/incoiceAssociations');

/* THE USER'S REQUEST OF 2026-10-20, ENFORCED: on a job, the charges and the
 * invoices raised from them are separate rights - a user may enter charges
 * and raise invoices, but not approve or unapprove them, or edit them.
 * Through the routes, in enforce mode, with a user set up in the grid. */
describe('job charges apart from job invoices', () => {
  const stamp = Date.now();
  let admin; let raiser; let fiscalYearId; let companyId; let clientId; let chargeMaster; let jobId;
  const invoices = [];

  const as = (who) => (req) => req.set('Authorization', who.authHeader).set('x-fiscal-year-id', String(fiscalYearId));
  const charges = () => Charge_Head.findAll({ where: { CustomsJobId: jobId }, order: [['id', 'ASC']], raw: true });
  const editJob = (who, data) => as(who)(request(app).post('/customsJob/edit'))
    .send({ employeeId: who.employee.id, data: { id: jobId, companyId, fiscalYearId, ...data } });

  beforeAll(async () => {
    permissions._setModeForTest('enforce');
    admin = await loginAs('admin');
    raiser = await loginAs('employee');
    // Saved through the grid after the split (catalog:3): exactly what is ticked.
    for (const n of [
      'perm:customs:view', 'perm:jobCharges:view', 'perm:jobCharges:edit',
      'perm:jobInvoices:view', 'perm:jobInvoices:raise', 'perm:catalog:3',
    ]) await db.Access_Levels.create({ EmployeeId: raiser.employee.id, access_name: n });
    grants.invalidate(raiser.employee.id);

    const year = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    fiscalYearId = year ? year.id : (await db.FiscalYears.create({
      label: TEST_PREFIX + 'FY', suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
    })).id;
    companyId = String((await anyCompany()).id);
    clientId = (await db.Clients.create({ name: `${TEST_PREFIX}CI Client ${stamp}`, code: `${TEST_PREFIX}CI${stamp % 100000}` })).id;
    chargeMaster = await db.Charges.create({
      code: 9803, name: TEST_PREFIX + 'CI Fee', short: 'TCIF', currency: 'PKR', calculationType: 'Per Unit',
      status: true, defaultPaybleParty: 'Shipper', defaultRecivableParty: 'Shipper', taxApply: 'false', taxPerc: '0',
    });
    const res = await as(admin)(request(app).post('/customsJob/create')).send({
      employeeId: admin.employee.id,
      data: {
        companyId, fiscalYearId, direction: 'Import', transportMode: 'Sea', clientId,
        gdNumber: `${TEST_PREFIX}GD-CI`, gdDate: '2026-04-15',
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
    if (invoices.length) await db.Invoice.destroy({ where: { id: invoices }, fiscalYearCheck: false });
    await db.Charges.destroy({ where: { id: chargeMaster.id } });
    await db.Clients.destroy({ where: { id: clientId } });
    await db.Access_Levels.destroy({ where: { EmployeeId: raiser.employee.id } });
  });

  it('says what they may do, for the screens', async () => {
    const res = await request(app).get('/authRoutes/myPermissions').set('Authorization', raiser.authHeader);
    expect(res.body.result.perms).toEqual(expect.arrayContaining(['jobCharges:edit', 'jobInvoices:raise']));
    for (const p of ['jobInvoices:edit', 'jobInvoices:approve', 'jobInvoices:delete', 'jobCharges:approve']) {
      expect(res.body.result.perms).not.toContain(p);
    }
  });

  it('enters charges - but approving a line on the sheet is held', async () => {
    const [line] = await charges();
    const res = await editJob(raiser, { charges: [{ ...line, rate_charge: 1100, status: '1' }] });
    expect(res.status).toBe(200);
    const [after] = await charges();
    expect(Number(after.rate_charge)).toBe(1100);
    expect(String(after.status)).toBe('0');
  });

  it('and approving one on its own is refused', async () => {
    const [line] = await charges();
    const res = await as(raiser)(request(app).post('/invoice/approveHeads')).send({ id: line.id });
    expect(res.status).toBe(403);
  });

  it('may raise an invoice - the request is let through to the route', async () => {
    const res = await as(raiser)(request(app).post('/customsJob/makeInvoice')).send({ chargeIds: [], companyId, fiscalYearId });
    expect(res.status).toBe(400);
    expect(res.body.result).toMatch(/No charges selected/);
  });

  it('but not raise one approved', async () => {
    const [line] = await charges();
    const res = await as(raiser)(request(app).post('/customsJob/makeInvoice'))
      .send({ chargeIds: [line.id], companyId, fiscalYearId, approve: true });
    expect(res.status).toBe(403);
    expect(res.body.result).toMatch(/not approve/);
  });

  // Invoicing approves the ticked charges it is asked to (2026-11-11) - for
  // whoever may approve charges. Not this user: refused, nothing raised.
  it('nor approve a charge by invoicing it', async () => {
    const [line] = await charges();
    expect(String(line.status)).toBe('0');
    const res = await as(raiser)(request(app).post('/customsJob/makeInvoice'))
      .send({ chargeIds: [line.id], companyId, fiscalYearId, approveChargeIds: [line.id] });
    expect(res.status).toBe(403);
    expect(res.body.result).toMatch(/approving charges needs the right/);
    const [after] = await charges();
    expect(String(after.status)).toBe('0');
    expect(after.InvoiceId).toBeNull();
  });

  it('nor approve, unapprove, edit or delete an invoice', async () => {
    for (const [method, url] of [
      ['post', '/invoice/approve'], ['post', '/invoice/unApprove'], ['post', '/invoice/changeDate'],
      ['post', '/invoice/changeCurrency'], ['post', '/invoice/roundOffInv'], ['post', '/invoice/addInvoiceNote'],
      ['get', '/invoice/deleteInvoice'],
    ]) {
      const res = await as(raiser)(request(app)[method](url)).send({ id: 0 });
      expect([url, res.status]).toEqual([url, 403]);
    }
  });

  it('nor change a charge that is on an unapproved invoice - it is left as it was, and said so', async () => {
    const invoice = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}CI-${stamp}`, type: 'Job Invoice', payType: 'Recievable', partyType: 'client',
      party_Name: 'CI', currency: 'PKR', ex_rate: '1', total: '1100', recieved: '0', paid: '0', approved: '0', companyId,
    }, { fiscalYearCheck: false });
    invoices.push(invoice.id);
    const [line] = await charges();
    await Charge_Head.update({ InvoiceId: invoice.id }, { where: { id: line.id } });

    const res = await editJob(raiser, { charges: [{ ...line, InvoiceId: invoice.id, rate_charge: 9999 }] });
    expect(res.status).toBe(200);
    expect(res.body.warning).toMatch(/unapproved invoice/);
    expect(Number((await charges())[0].rate_charge)).toBe(1100);

    // An admin may - the same save goes through.
    const ok = await editJob(admin, { charges: [{ ...line, InvoiceId: invoice.id, rate_charge: 1200 }] });
    expect(ok.status).toBe(200);
    expect(Number((await charges())[0].rate_charge)).toBe(1200);
    await Charge_Head.update({ InvoiceId: null }, { where: { id: line.id } });
  });
});

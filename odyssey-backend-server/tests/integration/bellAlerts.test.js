const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const db = require('../../models');
const grants = require('../../functions/permissions/grants');

/* THE BELL'S ALERTS (the user, 2026-11-23): Critical, Job Charges, Invoices
 * Due, Job Status - worked out from the data, Odyssey-made records only, both
 * sides of an invoice, each list per designation (Configuration > Bell
 * Alerts). And the customs status log that dates "On Vessel". */
describe('bell alerts', () => {
  const KEY = 'bellAlertLists';
  const DAYS_KEY = 'bellAlertDays';
  let beforeDays;
  const stamp = Date.now();
  const DAY = 86400000;
  const made = { invoices: [], seJobs: [], customsJobs: [], charges: [] };
  let admin; let ceo; let operator; let before; let company; let fiscalYear;
  const fx = {};

  const alerts = async (who) => {
    const res = await request(app).get('/notifications/alerts').set('Authorization', who.authHeader);
    expect(res.status).toBe(200);
    return res.body.result;
  };
  const ids = (list, kind) => (list?.items || []).filter((a) => a.kind === kind).map((a) => a.id);
  const backdate = (table, id, days, column = 'createdAt') => db.sequelize.query(
    `UPDATE "${table}" SET "${column}" = :at WHERE id = :id`,
    { replacements: { at: new Date(Date.now() - days * DAY), id } },
  );

  const invoice = async (label, days, data = {}) => {
    const inv = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}BA-${label}-${stamp}`, invoice_Id: 1, type: 'Job Invoice', payType: 'Recievable',
      operation: 'SE', status: '1', approved: '1', roundOff: '0', currency: 'PKR', ex_rate: '1',
      party_Name: `${TEST_PREFIX}PARTY ${label}`, partyType: 'client', total: '1000', recieved: '0', paid: '0',
      companyId: String(company.id), FiscalYearId: fiscalYear.id, ...data,
    }, { fiscalYearCheck: false });
    made.invoices.push(inv.id);
    await backdate('Invoices', inv.id, days);
    return inv;
  };
  const seJob = async (label, days) => {
    const j = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}BA-SE-${label}-${stamp}`, operation: 'SE', companyId: String(company.id) },
      { fiscalYearCheck: false },
    );
    made.seJobs.push(j.id);
    await backdate('SE_Jobs', j.id, days);
    return j;
  };
  const customsJob = async (label, days, status) => {
    const j = await db.Customs_Job.create({
      jobNo: `${TEST_PREFIX}BA-TP-${label}-${stamp}`, direction: 'Export', companyId: String(company.id), status,
    }, { fiscalYearCheck: false });
    made.customsJobs.push(j.id);
    await backdate('Customs_Jobs', j.id, days);
    return j;
  };

  beforeAll(async () => {
    before = (await db.AppSetting.findOne({ where: { key: KEY } }))?.value;
    beforeDays = (await db.AppSetting.findOne({ where: { key: DAYS_KEY } }))?.value;
    await db.AppSetting.destroy({ where: { key: [KEY, DAYS_KEY] } });
    company = await anyCompany();
    fiscalYear = await anyFiscalYear();
    admin = await loginAs('admin');
    ceo = await loginAs('ceo');
    operator = await loginAs('gd operator');

    fx.late = await invoice('LATE', 100);                                  // Critical
    fx.due = await invoice('DUE', 60, { payType: 'Payble', type: 'Job Bill' }); // Invoices Due, a bill
    fx.fresh = await invoice('FRESH', 20);                                 // neither
    fx.paid = await invoice('PAID', 100, { recieved: '1000' });            // settled
    fx.migrated = await invoice('MIG', 100, { climaxId: 900000 + (stamp % 1000) }); // migrated

    fx.bare = await seJob('BARE', 10);                                     // Job Charges
    fx.charged = await seJob('CHARGED', 10);
    const line = await db.Charge_Head.create({ SEJobId: fx.charged.id, charge: 'X', particular: 'Test line' });
    made.charges.push(line.id);
    fx.young = await seJob('YOUNG', 3);                                    // under 7 days

    fx.onVessel = await customsJob('VESSEL', 20, 'Complete');
    // It went On Vessel 10 days ago - the log the hooks wrote says now.
    await db.sequelize.query(
      'UPDATE "Customs_Job_Statuses" SET "changedOn" = :at WHERE "CustomsJobId" = :id',
      { replacements: { at: new Date(Date.now() - 10 * DAY), id: fx.onVessel.id } },
    );
    fx.justOnVessel = await customsJob('JUSTVESSEL', 20, 'Complete');      // log says today
    fx.inProcess = await customsJob('INPROCESS', 10, 'Incomplete');        // Job Status + Job Charges
  });

  beforeEach(() => grants._resetCache());

  afterAll(async () => {
    await db.Charge_Head.destroy({ where: { id: made.charges } });
    await db.Invoice.destroy({ where: { id: made.invoices } });
    await db.SE_Job.destroy({ where: { id: made.seJobs } });
    await db.Customs_Job_Status.destroy({ where: { CustomsJobId: made.customsJobs } });
    await db.Customs_Job.destroy({ where: { id: made.customsJobs } });
    await db.AppSetting.destroy({ where: { key: [KEY, DAYS_KEY] } });
    if (before != null) await db.AppSetting.create({ key: KEY, value: before });
    if (beforeDays != null) await db.AppSetting.create({ key: DAYS_KEY, value: beforeDays });
  });

  it('CEO, CFO and admin see all four lists until the grid is saved; others none', async () => {
    const all = await alerts(ceo);
    expect(all.lists).toEqual(['critical', 'jobCharges', 'invoicesDue', 'jobStatus']);
    // The header's totals: every distinct invoice and job, not only those sent.
    expect(all.totals.invoices).toBe(all.critical.items.filter((a) => a.kind === 'invoice').length
      + all.invoicesDue.count);
    expect(all.totals.jobs).toBeGreaterThanOrEqual(all.jobCharges.count);
    const none = await alerts(operator);
    expect(none.lists).toEqual([]);
    expect(none).not.toHaveProperty('critical');
  });

  it('Critical: an invoice over 90 days, and a job with no charges 7 days after going On Vessel', async () => {
    const a = await alerts(ceo);
    expect(ids(a.critical, 'invoice')).toContain(fx.late.id);
    expect(ids(a.critical, 'customsJob')).toContain(fx.onVessel.id);
    // On Vessel only today: not yet.
    expect(ids(a.critical, 'customsJob')).not.toContain(fx.justOnVessel.id);
    const item = a.critical.items.find((x) => x.kind === 'customsJob' && x.id === fx.onVessel.id);
    expect(item.dueDays).toBe(7);
    expect(Math.round((Date.now() - new Date(item.since).getTime()) / DAY)).toBe(10);
  });

  it('settled and migrated invoices are left out, and each invoice is in one list', async () => {
    const a = await alerts(ceo);
    const everyInvoice = [...ids(a.critical, 'invoice'), ...ids(a.invoicesDue, 'invoice')];
    expect(everyInvoice).not.toContain(fx.paid.id);
    expect(everyInvoice).not.toContain(fx.migrated.id);
    expect(everyInvoice).not.toContain(fx.fresh.id);
    expect(ids(a.invoicesDue, 'invoice')).not.toContain(fx.late.id);
  });

  it('Invoices Due: still due after 45 days, bills to pay as well', async () => {
    const a = await alerts(ceo);
    const due = a.invoicesDue.items.find((x) => x.id === fx.due.id);
    expect(due).toEqual(expect.objectContaining({ payType: 'Payble', owed: 1000, dueDays: 45, kind: 'invoice' }));
  });

  it('Job Charges: no charges 7 days after creation; an On Vessel one is Critical, not repeated', async () => {
    const a = await alerts(ceo);
    expect(ids(a.jobCharges, 'freightJob')).toContain(fx.bare.id);
    expect(ids(a.jobCharges, 'freightJob')).not.toContain(fx.charged.id);
    expect(ids(a.jobCharges, 'freightJob')).not.toContain(fx.young.id);
    expect(ids(a.jobCharges, 'customsJob')).toContain(fx.inProcess.id);
    expect(ids(a.jobCharges, 'customsJob')).not.toContain(fx.onVessel.id);
  });

  it('Job Status: customs jobs 7 days or more old, not yet at a finished status', async () => {
    const a = await alerts(ceo);
    expect(ids(a.jobStatus, 'customsJob')).toContain(fx.inProcess.id);
    expect(ids(a.jobStatus, 'customsJob')).not.toContain(fx.onVessel.id);
    expect(a.jobStatus.items.find((x) => x.id === fx.inProcess.id).status).toBe('In Process');
  });

  it('a designation sees what it is ticked for, and only that is worked out', async () => {
    expect((await request(app).post('/settings/bellAlertLists').set('Authorization', ceo.authHeader)
      .send({ widgets: { jobStatus: ['ceo'] } })).status).toBe(403);
    expect((await request(app).post('/settings/bellAlertLists').set('Authorization', admin.authHeader)
      .send({ widgets: { weather: ['ceo'] } })).status).toBe(400);
    const saved = await request(app).post('/settings/bellAlertLists').set('Authorization', admin.authHeader)
      .send({ widgets: { critical: ['ceo'], jobCharges: ['ceo'], invoicesDue: ['ceo'], jobStatus: ['gd operator'] } });
    expect(saved.status).toBe(200);
    const a = await alerts(operator);
    expect(a.lists).toEqual(['jobStatus']);
    expect(Object.keys(a).sort()).toEqual(['jobStatus', 'lists', 'totals']);
    expect((await alerts(ceo)).lists).toEqual(['critical', 'jobCharges', 'invoicesDue']);
    const read = await request(app).get('/settings/bellAlertLists').set('Authorization', admin.authHeader);
    expect(read.body.result.jobStatus).toEqual(['gd operator']);
    expect(read.body.widgets.map((w) => w.key)).toEqual(['critical', 'jobCharges', 'invoicesDue', 'jobStatus']);
  });

  it('the days each list checks against are set in Configuration (the user: Critical at 120)', async () => {
    const setDays = (days, who = admin) => request(app).post('/settings/bellAlertDays')
      .set('Authorization', who.authHeader).send({ days });
    const read = await request(app).get('/settings/bellAlertDays').set('Authorization', admin.authHeader);
    expect(read.body.result).toEqual({ critical: 90, due: 45, noCharges: 7, onVessel: 7, unfinished: 7 });
    expect(read.body.fields.map((f) => f.key)).toEqual(['critical', 'onVessel', 'noCharges', 'due', 'unfinished']);
    expect((await setDays({ critical: 120 }, ceo)).status).toBe(403);
    expect((await setDays({ critical: 40 })).status).toBe(400); // under Invoices Due's 45
    expect((await setDays({ critical: 'soon' })).status).toBe(400);

    const saved = await setDays({ critical: 120 });
    expect(saved.status).toBe(200);
    expect(saved.body.result).toEqual({ critical: 120, due: 45, noCharges: 7, onVessel: 7, unfinished: 7 });
    // Only what was sent changes.
    expect((await setDays({ noCharges: 14 })).body.result.critical).toBe(120);

    const a = await alerts(ceo);
    expect(ids(a.critical, 'invoice')).not.toContain(fx.late.id);
    const moved = a.invoicesDue.items.find((x) => x.id === fx.late.id);
    expect(moved).toEqual(expect.objectContaining({ dueDays: 45 }));
    // 14 days for Job Charges now: a 10-day-old job is not on it yet.
    expect(ids(a.jobCharges, 'freightJob')).not.toContain(fx.bare.id);
  });
});

describe('customs status log', () => {
  const made = [];
  afterAll(async () => {
    await db.Customs_Job_Status.destroy({ where: { CustomsJobId: made } });
    await db.Customs_Job.destroy({ where: { id: made } });
  });
  const rows = (id) => db.Customs_Job_Status.findAll({ where: { CustomsJobId: id }, order: [['id', 'ASC']], raw: true });

  it('records the status a job starts at, and each change - by bulk update too - once', async () => {
    const company = await anyCompany();
    const job = await db.Customs_Job.create({
      jobNo: `${TEST_PREFIX}SL-${Date.now()}`, direction: 'Export', companyId: String(company.id), status: 'Incomplete',
    }, { fiscalYearCheck: false });
    made.push(job.id);
    expect((await rows(job.id)).map((r) => r.status)).toEqual(['Incomplete']);

    await db.Customs_Job.update({ status: 'Complete' }, { where: { id: job.id } });
    await db.Customs_Job.update({ status: 'Complete', remarks: 'again' }, { where: { id: job.id } });
    await db.Customs_Job.update({ remarks: 'no status in this one' }, { where: { id: job.id } });
    const after = await rows(job.id);
    expect(after.map((r) => r.status)).toEqual(['Incomplete', 'Complete']);
    expect(new Date(after[1].changedOn).getTime()).toBeGreaterThan(Date.now() - 60000);
  });
});

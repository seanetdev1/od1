const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const { anyCompany } = require('../helpers/company');
const db = require('../../models');
const { writeSettings, KEY } = require('../../functions/creditControl/settings');
const { runDaily, runWeekly, LOG_KEY } = require('../../functions/creditControl/runner');

/* CREDIT CONTROL (the user's request, 2026-10-23) - through the runs and the
 * routes: a party over its Credit Limit (Amount) is blocked by the daily check
 * and cannot be a job's client until an approver lets it through; an approver
 * can pick it anyway; an omitted invoice no longer counts; the weekly report
 * lists invoices over its age. */
describe('credit control', () => {
  const stamp = Date.now();
  // admin asks and is refused at the job; staff (a manager) is refused the
  // approvers' and Config's routes - on a licence-exempt install, as CI is,
  // the admin counts as System and would be let into both.
  let admin; let ceo; let staff; let company; let fiscalYear;
  let over; let old; let overInvoice;
  const made = { clients: [], accounts: [], invoices: [], seJobs: [], customsJobs: [] };
  const sent = [];
  const sendMail = async (m) => { sent.push(m); };
  const renderPdf = async () => Buffer.from('%PDF-1.4');
  const daysAgo = (n) => new Date(Date.now() - n * 86400000);

  const as = (who) => (req) => req.set('Authorization', who.authHeader)
    .set('x-fiscal-year-id', String(fiscalYear.id)).set('x-company-id', String(company.id));
  const seaJob = (who, ClientId) => as(who)(request(app).post('/seaJob/create')).send({
    employeeId: who.employee.id,
    data: { operation: 'SE', companyId: company.id, fiscalYearId: fiscalYear.id, jobDate: '2026-09-01', ClientId, customCheck: [], transportCheck: [], equipments: [], approved: false },
  });
  const customsJob = (who, clientId) => as(who)(request(app).post('/customsJob/create')).send({
    employeeId: who.employee.id,
    data: { companyId: String(company.id), fiscalYearId: fiscalYear.id, direction: 'Import', transportMode: 'Sea', clientId },
  });
  const keep = (res, list) => { if (res.body?.result?.id) list.push(res.body.result.id); return res; };

  const party = async (name, limits) => {
    const account = await db.Child_Account.create({ title: name, subCategory: 'Customer' });
    const client = await db.Clients.create({ name, code: String(stamp % 100000), active: true, nongl: '0', ...limits });
    await db.Client_Associations.create({ ClientId: client.id, ChildAccountId: account.id });
    made.accounts.push(account.id); made.clients.push(client.id);
    return { client, account };
  };
  const invoice = async (account, name, { total, age, currency = 'PKR', exRate = '1' }) => {
    const inv = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}CC-${made.invoices.length}-${stamp}`, type: 'Job Invoice', payType: 'Recievable', partyType: 'client',
      party_Id: String(account.id), party_Name: name, currency, ex_rate: exRate, total: String(total), recieved: '0', paid: '0',
      approved: '1', companyId: String(company.id), createdAt: daysAgo(age),
    }, { fiscalYearCheck: false });
    made.invoices.push(inv.id);
    return inv;
  };
  // A bill we owe the party - what nets against its invoices.
  const bill = async (account, name, { total, age }) => {
    const b = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}CCB-${made.invoices.length}-${stamp}`, type: 'Job Bill', payType: 'Payble', partyType: 'vendor',
      party_Id: String(account.id), party_Name: name, currency: 'PKR', ex_rate: '1', total: String(total), recieved: '0', paid: '0',
      approved: '1', companyId: String(company.id), createdAt: daysAgo(age),
    }, { fiscalYearCheck: false });
    made.invoices.push(b.id);
    return b;
  };

  beforeAll(async () => {
    admin = await loginAs('admin');
    ceo = await loginAs('ceo');
    staff = await loginAs('manager');
    company = await anyCompany();
    fiscalYear = await anyFiscalYear();

    await writeSettings({ enabled: true, recipients: { extraAdmin: ['credit-admin@test.pk'] } });

    over = await party(`${TEST_PREFIX}OVER LIMIT ${stamp}`, { creditLimitDays: 30, creditLimitAmount: 1000 });
    overInvoice = await invoice(over.account, over.client.name, { total: 5000, age: 60 });
    // In dollars: 20 USD at 280 = PKR 5,600 towards the limit.
    await invoice(over.account, over.client.name, { total: 20, age: 2, currency: 'USD', exRate: '280' });

    old = await party(`${TEST_PREFIX}OLD DEBT ${stamp}`, {});
    await invoice(old.account, old.client.name, { total: 700, age: 120 });
  });

  afterAll(async () => {
    await db.AppSetting.destroy({ where: { key: [KEY, LOG_KEY, 'creditControlState'] } });
    await db.Credit_Omission.destroy({ where: { InvoiceId: made.invoices } });
    await db.Credit_Unblock_Request.destroy({ where: { ClientId: made.clients } });
    await db.Credit_Block.destroy({ where: { ClientId: made.clients } });
    if (made.seJobs.length) await db.SE_Job.destroy({ where: { id: made.seJobs }, fiscalYearCheck: false });
    if (made.customsJobs.length) await db.Customs_Job.destroy({ where: { id: made.customsJobs } });
    await db.Invoice.destroy({ where: { id: made.invoices }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { ClientId: made.clients } });
    await db.Clients.destroy({ where: { id: made.clients } });
    await db.Child_Account.destroy({ where: { id: made.accounts } });
  });

  it('the daily check blocks a party over its limit, and emails it - a party with no rep to the admin', async () => {
    const result = await runDaily({ mode: 'send', sendMail, renderPdf });
    const block = await db.Credit_Block.findOne({ where: { ClientId: over.client.id } });
    expect(block).toMatchObject({ active: true });
    expect(Number(block.balancePkr)).toBe(10600);
    expect(Number(block.limitPkr)).toBe(1000);

    // The party is named in the attached report, not in the short body.
    const mail = sent.find((m) => m.to === 'credit-admin@test.pk');
    expect(mail.subject).toMatch('Parties with no sales rep');
    expect(mail.html).not.toContain(overInvoice.invoice_No);
    expect(mail.attachments.map((a) => a.filename)).toEqual([
      expect.stringMatching(/^credit-control-\d{4}-\d{2}-\d{2}\.pdf$/),
      expect.stringMatching(/^credit-control-\d{4}-\d{2}-\d{2}\.csv$/),
    ]);
    expect(mail.attachments[0]).toMatchObject({ contentType: 'application/pdf' });
    expect(mail.attachments[0].content.toString()).toBe('%PDF-1.4');
    expect(mail.attachments[1].content).toContain(overInvoice.invoice_No); // 60 days against 30
    expect(result.blocked).toBeGreaterThanOrEqual(1);
  });

  it('an email whose report cannot be made is not sent without it - it fails, and says why', async () => {
    const before = sent.length;
    const noBrowser = async () => { throw new Error('no browser'); };
    const result = await runDaily({ mode: 'test', testTo: 'tester@test.pk', sendMail, renderPdf: noBrowser });
    expect(sent.length).toBe(before);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((r) => r.status === 'failed' && r.error === 'Could not make the PDF report: no browser')).toBe(true);
  });

  it('a preview changes nothing and sends nothing', async () => {
    const before = sent.length;
    const preview = await runDaily({ mode: 'preview', sendMail, renderPdf });
    expect(sent.length).toBe(before);
    const shown = preview.results.find((r) => r.status === 'preview' && r.reportHtml.includes(over.client.name));
    expect(shown.reportHtml).toContain(overInvoice.invoice_No);
    expect(shown.attachments[0]).toMatch(/^credit-control-.*\.pdf$/);
  });

  it('cannot be the client on a new job - freight or customs - for someone who is not an approver', async () => {
    const sea = await seaJob(admin, over.client.id);
    expect(sea.status).toBe(409);
    expect(sea.body.creditBlock).toMatchObject({ clientId: over.client.id, limitPkr: 1000 });
    const customs = await customsJob(admin, over.client.id);
    expect(customs.status).toBe(409);
    expect(customs.body.result).toMatch('over its credit limit');

    const listed = await as(admin)(request(app).get('/creditControl/blocked'));
    expect(listed.body.result).toMatchObject({ active: true, approver: false });
    expect(listed.body.result.blocked.map((b) => b.clientId)).toContain(over.client.id);
  });

  it('an approver picks it anyway', async () => {
    const res = keep(await seaJob(ceo, over.client.id), made.seJobs);
    expect(res.body.status).toBe('success');
  });

  it('a job that already had the client keeps saving', async () => {
    const job = made.seJobs[0];
    const saved = await db.SE_Job.findByPk(job, { raw: true });
    const res = await as(admin)(request(app).post('/seaJob/edit')).send({
      employeeId: admin.employee.id,
      data: { ...saved, companyId: company.id, customCheck: [], transportCheck: [], equipments: [], approved: false, fileNo: 'X' },
    });
    expect(res.body.status).toBe('success');
  });

  it('is asked for, and let through by an approver until a date', async () => {
    const asked = await as(admin)(request(app).post('/creditControl/requestUnblock')).send({ clientId: over.client.id, note: 'Urgent shipment' });
    expect(asked.body.status).toBe('success');
    const requestId = asked.body.result.id;
    expect(await db.Notifications.count({ where: { type: 'Credit', recordId: String(requestId), recipientId: ceo.employee.id } })).toBe(1);

    // Asking twice is one request.
    const again = await as(admin)(request(app).post('/creditControl/requestUnblock')).send({ clientId: over.client.id });
    expect(again.body.result).toMatchObject({ id: requestId, already: true });

    const refused = await as(staff)(request(app).post('/creditControl/decide')).send({ id: requestId, approve: true });
    expect(refused.status).toBe(403);

    const approved = await as(ceo)(request(app).post('/creditControl/decide')).send({ id: requestId, approve: true });
    expect(approved.body.status).toBe('success');
    expect(new Date(approved.body.result.approvedUntil).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
    expect(await db.Notifications.count({ where: { type: 'Credit', subType: 'unblockApproved', recipientId: admin.employee.id } })).toBe(1);

    const res = keep(await customsJob(admin, over.client.id), made.customsJobs);
    expect(res.body.status).toBe('success');

    // The next daily check keeps the approval while it runs.
    await runDaily({ mode: 'send', sendMail, renderPdf });
    const block = await db.Credit_Block.findOne({ where: { ClientId: over.client.id } });
    expect(block.active).toBe(true);
    expect(block.approvedUntil).not.toBeNull();
  });

  it('is blocked again when the approval is ended', async () => {
    await as(ceo)(request(app).post('/creditControl/reblock')).send({ clientId: over.client.id });
    expect((await seaJob(admin, over.client.id)).status).toBe(409);
  });

  it('an omitted invoice no longer counts - the party is back under, and unblocked on the pick', async () => {
    const refused = await as(staff)(request(app).post('/creditControl/omit')).send({ invoiceIds: [overInvoice.id], omit: true });
    expect(refused.status).toBe(403);
    const omitted = await as(ceo)(request(app).post('/creditControl/omit')).send({ invoiceIds: [overInvoice.id], omit: true, reason: 'Disputed' });
    expect(omitted.body.result).toEqual({ omitted: 1 });

    // 5,600 left against 1,000: still over.
    let check = await as(admin)(request(app).post('/creditControl/check')).send({ clientId: over.client.id });
    expect(check.body.result.block).toMatchObject({ balancePkr: 5600 });

    await db.Clients.update({ creditLimitAmount: 6000 }, { where: { id: over.client.id } });
    check = await as(admin)(request(app).post('/creditControl/check')).send({ clientId: over.client.id });
    expect(check.body.result.block).toBeNull();
    expect((await db.Credit_Block.findOne({ where: { ClientId: over.client.id } })).active).toBe(false);
  });

  it('the weekly report lists every party with invoices over the age, limit or not', async () => {
    const week = await runWeekly({ mode: 'preview' });
    const mail = week.results.find((r) => r.reportHtml.includes(old.client.name));
    expect(mail).toBeTruthy();
    expect(mail.subject).toMatch(/^Ageing over 90 days/);
    expect(mail.attachments[0]).toMatch(/^ageing-over-90-days-.*\.pdf$/);
    // The omitted one is in no email.
    expect(week.results.some((r) => r.reportHtml.includes(overInvoice.invoice_No))).toBe(false);
  });

  it('an invoice with less left on it than the ignore amount is in no email - one with exactly that, is', async () => {
    await writeSettings({ enabled: true, recipients: { extraAdmin: ['credit-admin@test.pk'] }, ignoreBelowAmount: 701 });
    let week = await runWeekly({ mode: 'preview' });
    expect(week.results.some((r) => r.reportHtml.includes(old.client.name))).toBe(false); // 700 left
    await writeSettings({ enabled: true, recipients: { extraAdmin: ['credit-admin@test.pk'] }, ignoreBelowAmount: 700 });
    week = await runWeekly({ mode: 'preview' });
    const mail = week.results.find((r) => r.reportHtml.includes(old.client.name));
    expect(mail.html).toContain('Invoices and bills with less than PKR 700.00 left on them are not included.');
    await writeSettings({ enabled: true, recipients: { extraAdmin: ['credit-admin@test.pk'] } });
  });

  it('an invoice older than the ignore limit is in no email', async () => {
    await writeSettings({ enabled: true, recipients: { extraAdmin: ['credit-admin@test.pk'] }, ignoreOlderThanDays: 100 });
    const week = await runWeekly({ mode: 'preview' });
    expect(week.results.some((r) => r.reportHtml.includes(old.client.name))).toBe(false); // 120 days old
    await writeSettings({ enabled: true, recipients: { extraAdmin: ['credit-admin@test.pk'] } });
  });

  it('the bills we owe a party count against its invoices: the limit is on the net (2026-10-26)', async () => {
    const both = await party(`${TEST_PREFIX}BOTH SIDES ${stamp}`, { creditLimitDays: 1, creditLimitAmount: 1000 });
    await invoice(both.account, both.client.name, { total: 3000, age: 5 });
    const ours = await bill(both.account, both.client.name, { total: 2500, age: 3 });
    const blockOf = () => db.Credit_Block.findOne({ where: { ClientId: both.client.id } });

    // 3,000 less 2,500 is 500 against 1,000: not over, not blocked. Its
    // overdue invoice is still reported - with the bill and the net beside it.
    await runDaily({ mode: 'send', sendMail, renderPdf });
    expect((await blockOf())?.active ?? false).toBe(false);
    const preview = await runDaily({ mode: 'preview' });
    const report = preview.results.find((r) => r.reportHtml.includes(both.client.name)).reportHtml;
    expect(report).toContain(ours.invoice_No);
    expect(report).toContain('Our open bills to them (1)');
    expect(report).toContain('= <b>net PKR 500.00</b>');

    const view = await as(ceo)(request(app).get('/creditControl/partyInvoices').query({ clientId: both.client.id }));
    expect(view.body.result).toMatchObject({ receivablePkr: 3000, payablePkr: 2500, balancePkr: 500 });
    expect(view.body.result.bills.map((b) => b.id)).toEqual([ours.id]);

    // The backlog takes out the bills dated before the day as well.
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const backlog = await as(ceo)(request(app).post('/creditControl/omitBefore')).send({ date: tomorrow, clientId: both.client.id, preview: true });
    expect(backlog.body.result).toEqual({ count: 2, invoices: 1, bills: 1 });

    // The bill paid, the 3,000 stands alone: over, and blocked.
    await db.Invoice.update({ paid: '2500' }, { where: { id: ours.id } });
    await runDaily({ mode: 'send', sendMail, renderPdf });
    expect(await blockOf()).toMatchObject({ active: true });
    expect(Number((await blockOf()).balancePkr)).toBe(3000);
    let check = await as(admin)(request(app).post('/creditControl/check')).send({ clientId: both.client.id });
    expect(check.body.result.block).toMatchObject({ balancePkr: 3000, limitPkr: 1000 });

    // Open again, the pick sees the net and lets it through.
    await db.Invoice.update({ paid: '0' }, { where: { id: ours.id } });
    check = await as(admin)(request(app).post('/creditControl/check')).send({ clientId: both.client.id });
    expect(check.body.result.block).toBeNull();
    expect((await blockOf()).active).toBe(false);
  });

  it("the settings and the runs are Config's", async () => {
    expect((await as(staff)(request(app).get('/creditControl/settings'))).status).toBe(403);
    expect((await as(ceo)(request(app).post('/creditControl/run')).send({ kind: 'daily', mode: 'preview' })).status).toBe(403);
  });
});

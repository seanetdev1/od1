const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const { anyCompany } = require('../helpers/company');
const db = require('../../models');
const { writeSettings, KEY, TOKEN_KEY } = require('../../functions/whatsapp/settings');
const { runDailyUpdate, LOG_KEY, STATE_KEY } = require('../../functions/whatsapp/runner');

/* THE WHATSAPP DAILY UPDATE (the user's request, 2026-10-24) - a job and its
 * invoice and bill entered today are in the day's report, per job; a send
 * uploads the PDF to Meta once and sends the approved template to each
 * recipient with the day's totals. Meta is faked - nothing leaves CI. */
describe('the WhatsApp daily update', () => {
  const stamp = Date.now();
  let admin; let staff; let company; let fiscalYear; let job;
  const made = { invoices: [], jobs: [], clients: [] };

  const as = (who) => (req) => req.set('Authorization', who.authHeader)
    .set('x-fiscal-year-id', String(fiscalYear.id)).set('x-company-id', String(company.id));

  beforeAll(async () => {
    admin = await loginAs('admin');
    staff = await loginAs('manager');
    company = await anyCompany();
    fiscalYear = await anyFiscalYear();
    const client = await db.Clients.create({ name: `${TEST_PREFIX}WA CLIENT ${stamp}`, code: String(stamp % 100000), active: true });
    made.clients.push(client.id);

    const res = await as(admin)(request(app).post('/seaJob/create')).send({
      employeeId: admin.employee.id,
      data: { operation: 'SE', companyId: company.id, fiscalYearId: fiscalYear.id, jobDate: '2026-09-01', ClientId: client.id, customCheck: [], transportCheck: [], equipments: [], approved: false },
    });
    expect(res.body.status).toBe('success');
    job = res.body.result;
    made.jobs.push(job.id);

    for (const [payType, total, type] of [['Recievable', '150000', 'Job Invoice'], ['Payble', '90000', 'Job Bill']]) {
      const inv = await db.Invoice.create({
        invoice_No: `${TEST_PREFIX}WA-${type}-${stamp}`, type, payType, partyType: 'client', party_Name: client.name,
        currency: 'PKR', ex_rate: '1', total, recieved: '0', paid: '0', approved: '0', companyId: String(company.id), SEJobId: job.id,
      }, { fiscalYearCheck: false });
      made.invoices.push(inv.id);
    }

    await writeSettings({
      enabled: true, connection: { phoneNumberId: '123456789012345' }, companies: [String(company.id)],
      recipients: [{ name: 'CEO', phone: '0300 1234567' }, { name: 'CFO', phone: '+92 321 7654321' }],
    }, 'TEST-TOKEN');
  });

  afterAll(async () => {
    await db.AppSetting.destroy({ where: { key: [KEY, TOKEN_KEY, LOG_KEY, STATE_KEY] } });
    await db.Invoice.destroy({ where: { id: made.invoices }, fiscalYearCheck: false });
    await db.History.destroy({ where: { formName: 'Job', docNo: job?.jobNo || '' } });
    await db.SE_Job.destroy({ where: { id: made.jobs }, fiscalYearCheck: false });
    await db.Clients.destroy({ where: { id: made.clients } });
  });

  it("puts today's booking and its invoice and bill in the report, per job", async () => {
    const day = await runDailyUpdate({ mode: 'preview' });
    expect(day.totals.bookings).toBeGreaterThanOrEqual(1);
    expect(day.html).toContain(job.jobNo);
    expect(day.html).toContain(`${TEST_PREFIX}WA-Job Invoice-${stamp}`);
    // The job's own figures: 150,000 selling, 90,000 buying.
    expect(day.html).toContain('150,000.00');
    expect(day.html).toContain('60,000.00');
    expect(day.params).toHaveLength(6);
    expect(day.text).toMatch(/^Here is your Odyssey daily update for /);
  });

  it('a send uploads the PDF once and sends the template to each recipient', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, json: async () => (url.endsWith('/media') ? { id: 'media-1' } : { messages: [{ id: `wamid.${calls.length}` }] }) };
    };
    const result = await runDailyUpdate({ mode: 'send', renderPdf: async () => Buffer.from('%PDF-1.4'), fetchImpl });

    expect(result).toMatchObject({ sent: 2, failed: 0 });
    expect(calls.filter((c) => c.url.endsWith('/media'))).toHaveLength(1);
    const messages = calls.filter((c) => c.url.endsWith('/messages')).map((c) => c.body);
    expect(messages.map((m) => m.to)).toEqual(['923001234567', '923217654321']);
    expect(messages[0].template).toMatchObject({ name: 'odyssey_daily_update', language: { code: 'en' } });
    expect(messages[0].template.components[0].parameters[0].document.id).toBe('media-1');
    expect(messages[0].template.components[1].parameters).toHaveLength(6);

    const log = await request(app).get('/whatsapp/log').set('Authorization', admin.authHeader);
    expect(log.body.result[0]).toMatchObject({ mode: 'send', sent: 2 });
  });

  it("says why Meta refused, per recipient, and logs it", async () => {
    const fetchImpl = async (url) => (url.endsWith('/media')
      ? { ok: true, status: 200, json: async () => ({ id: 'media-2' }) }
      : { ok: false, status: 400, json: async () => ({ error: { code: 131030, message: 'Recipient phone number not in allowed list' } }) });
    const result = await runDailyUpdate({ mode: 'test', testTo: '0333 1112223', renderPdf: async () => Buffer.from('%PDF'), fetchImpl });
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(result.results[0]).toMatchObject({ phone: '923331112223', status: 'failed' });
    expect(result.results[0].error).toMatch("allowed list");
  });

  it("is Config's, and never hands the token back", async () => {
    expect((await request(app).get('/whatsapp/settings').set('Authorization', staff.authHeader)).status).toBe(403);
    const res = await request(app).get('/whatsapp/settings').set('Authorization', admin.authHeader);
    expect(res.body.result.hasToken).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('TEST-TOKEN');
  });
});

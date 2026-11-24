const { normalizePhone, validate, withDefaults, TEMPLATE } = require('../../functions/whatsapp/settings');
const { buildReport, bodyParams, isQuiet, messageText, jobKeyOf } = require('../../functions/whatsapp/report');
const { reportHtml } = require('../../functions/whatsapp/pdfHtml');
const cloud = require('../../functions/whatsapp/cloudApi');
const { startOfDay } = require('../../functions/creditControl/clock');

describe('a WhatsApp number', () => {
  it('as the Cloud API takes it: digits, with the country code', () => {
    expect(normalizePhone('0300 1234567')).toBe('923001234567');
    expect(normalizePhone('+92 300-1234567')).toBe('923001234567');
    expect(normalizePhone('0092 300 1234567')).toBe('923001234567');
    expect(normalizePhone('050 123 4567', '971')).toBe('971501234567');
    expect(normalizePhone('+44 7700 900123')).toBe('447700900123');
  });
  it('or none', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('call me')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
  });
});

describe('the settings', () => {
  const ready = { enabled: true, connection: { phoneNumberId: '123456789012345' }, recipients: [{ name: 'CEO', phone: '0300 1234567' }] };

  it('are off until switched on, in the evening, Karachi time', () => {
    expect(withDefaults(null)).toMatchObject({ enabled: false, time: '20:00', timeZone: 'Asia/Karachi', sendWhenEmpty: true, template: { name: 'odyssey_daily_update', language: 'en' } });
  });

  it('keep the numbers in the form the API takes, once each', () => {
    const s = validate({ ...ready, recipients: [{ name: 'CEO', phone: '0300 1234567' }, { name: 'Again', phone: '+923001234567' }, { name: '', phone: '' }] });
    expect(s.recipients).toEqual([{ name: 'CEO', phone: '923001234567' }]);
  });

  it('refuse what would not send', () => {
    expect(() => validate({ ...ready, recipients: [] })).toThrow('at least one person');
    expect(() => validate({ ...ready, connection: { phoneNumberId: '' } })).toThrow('phone number ID is needed');
    expect(() => validate({ ...ready, connection: { phoneNumberId: '+92 300 1234567' } })).toThrow('not the phone number itself');
    expect(() => validate({ ...ready, recipients: [{ name: 'X', phone: 'abc' }] })).toThrow('Not a WhatsApp number');
    expect(() => validate({ ...ready, time: '8pm' })).toThrow('like 20:00');
    expect(() => validate({ ...ready, template: { name: 'Daily Update', language: 'en' } })).toThrow('lowercase');
    expect(() => validate({ ...ready, connection: { phoneNumberId: '123456789012345', apiVersion: '22' } })).toThrow('like v22.0');
  });

  it('the template to create has six variables, in order, and does not start or end with one', () => {
    for (let i = 1; i <= 6; i += 1) expect(TEMPLATE.body).toContain(`{{${i}}}`);
    expect(TEMPLATE.body).not.toContain('{{7}}');
    expect(TEMPLATE.body).not.toMatch(/^\{\{|\}\}$/);
    expect(TEMPLATE.body).not.toMatch(/\n/);
  });
});

describe("the day's report", () => {
  const inv = (id, payType, total, jobKey, extra = {}) => ({ id, invoice_No: `INV-${id}`, type: payType === 'Payble' ? 'Job Bill' : 'Job Invoice', payType, currency: 'PKR', ex_rate: '1', total: String(total), roundOff: '0', party_Name: 'ACME', approved: '0', jobKey, ...extra });
  const jobs = new Map([['freight:1', { kind: 'freight', jobNo: 'SE-2', type: 'Sea Export', client: 'ACME' }], ['customs:9', { kind: 'customs', jobNo: 'CC-1', type: 'Customs', client: 'GLOBEX' }]]);

  const report = buildReport({
    date: '2026-10-24',
    bookings: [{ jobNo: 'SE-3' }, { jobNo: 'SE-10' }],
    newInvoices: [
      inv(1, 'Recievable', 100000, 'freight:1'),
      inv(2, 'Payble', 60000, 'freight:1'),
      inv(3, 'Recievable', 100, 'customs:9', { currency: 'USD', ex_rate: '280' }),
      inv(4, 'Recievable', 5000, null),
    ],
    jobs,
    jobInvoices: [
      inv(1, 'Recievable', 100000, 'freight:1'), inv(2, 'Payble', 60000, 'freight:1'), inv(7, 'Payble', 10000, 'freight:1'),
      inv(3, 'Recievable', 100, 'customs:9', { currency: 'USD', ex_rate: '280' }),
    ],
  });

  it("each job's selling and buying that day, and its own to date", () => {
    const se = report.jobs.find((j) => j.jobNo === 'SE-2');
    expect(se).toMatchObject({ todaySelling: 100000, todayBuying: 60000, selling: 100000, buying: 70000, profit: 30000 });
    expect(se.newInvoices.map((l) => l.invoiceNo)).toEqual(['INV-1', 'INV-2']);
  });

  it('in rupees - a foreign invoice at its own rate', () => {
    expect(report.jobs.find((j) => j.jobNo === 'CC-1')).toMatchObject({ todaySelling: 28000, profit: 28000 });
  });

  it("the day's totals take in an invoice on no job too", () => {
    expect(report.unassigned.map((l) => l.invoiceNo)).toEqual(['INV-4']);
    expect(report.totals).toEqual({ bookings: 2, invoices: 4, jobs: 2, selling: 133000, buying: 60000, profit: 73000 });
  });

  it('the bookings in job order', () => {
    expect(report.bookings.map((b) => b.jobNo)).toEqual(['SE-3', 'SE-10']);
  });

  it("the template's variables, in its order", () => {
    expect(bodyParams(report)).toEqual(['24-10-2026', '2', '4', '133,000', '60,000', '73,000']);
    expect(messageText(TEMPLATE.body, bodyParams(report))).toMatch(/^Here is your Odyssey daily update for 24-10-2026\. New bookings entered today: 2\./);
  });

  it('a day with nothing entered is quiet', () => {
    const empty = buildReport({ date: '2026-10-25' });
    expect(isQuiet(empty)).toBe(true);
    expect(isQuiet(report)).toBe(false);
    expect(bodyParams(empty)).toEqual(['25-10-2026', '0', '0', '0', '0', '0']);
  });

  it('the PDF page: escaped, every section, a loss in red', () => {
    const html = reportHtml(buildReport({
      date: '2026-10-24', bookings: [{ jobNo: 'SE-1', client: 'A <B>' }],
      newInvoices: [inv(1, 'Payble', 500, 'freight:1')], jobs, jobInvoices: [inv(1, 'Payble', 500, 'freight:1')],
    }), { title: 'SEANET' });
    expect(html).toContain('A &lt;B&gt;');
    expect(html).toContain('Invoices and bills by job (1 job)');
    expect(html).toContain('class="neg">-500.00');
    const evening = new Date('2026-10-24T15:00:00Z'); // 20:00 in Karachi
    expect(reportHtml(buildReport({ date: '2026-10-24' }), { generatedAt: evening })).toContain('No jobs were entered today.');
    expect(reportHtml(buildReport({ date: '2026-01-08' }), { generatedAt: evening })).toContain('No jobs were entered that day.');
  });
});

describe('which job an invoice is on', () => {
  it('freight by its job, customs and aviation by their charge lines', () => {
    expect(jobKeyOf({ SEJobId: 4 }, new Map())).toBe('freight:4');
    expect(jobKeyOf({ Charge_Heads: [{ CustomsJobId: null }, { CustomsJobId: 9 }] }, new Map())).toBe('customs:9');
    expect(jobKeyOf({ Charge_Heads: [{ AviationConsignmentId: 3 }] }, new Map([[3, 77]]))).toBe('aviation:77');
    expect(jobKeyOf({ Charge_Heads: [] }, new Map())).toBeNull();
  });
});

describe("Meta's Cloud API", () => {
  const connection = { phoneNumberId: '111', apiVersion: 'v22.0' };
  const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

  it('the template message: the PDF as its document header, the totals as its body', () => {
    expect(cloud.templateMessage({ to: '923001234567', template: { name: 'odyssey_daily_update', language: 'en' }, mediaId: 'm1', filename: 'd.pdf', bodyParams: ['a', 'b'] })).toEqual({
      messaging_product: 'whatsapp', to: '923001234567', type: 'template',
      template: {
        name: 'odyssey_daily_update', language: { code: 'en' },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { id: 'm1', filename: 'd.pdf' } }] },
          { type: 'body', parameters: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
        ],
      },
    });
  });

  it('uploads the PDF and sends, with the token, to the phone number ID', async () => {
    const calls = [];
    const fetchImpl = (url, init) => { calls.push({ url, init }); return reply(200, url.endsWith('/media') ? { id: 'media-1' } : { messages: [{ id: 'wamid.1' }] }); };
    const mediaId = await cloud.uploadMedia({ connection, token: 'T', buffer: Buffer.from('%PDF'), filename: 'd.pdf', fetchImpl });
    const sent = await cloud.sendTemplate({ connection, token: 'T', fetchImpl, to: '92300', template: { name: 'x', language: 'en' }, mediaId, filename: 'd.pdf', bodyParams: [] });
    expect(mediaId).toBe('media-1');
    expect(sent).toEqual({ messageId: 'wamid.1' });
    expect(calls.map((c) => c.url)).toEqual(['https://graph.facebook.com/v22.0/111/media', 'https://graph.facebook.com/v22.0/111/messages']);
    expect(calls[1].init.headers.Authorization).toBe('Bearer T');
  });

  it("explains Meta's refusals in words the person setting it up can act on", async () => {
    const fetchImpl = () => reply(400, { error: { code: 132001, message: 'Template name does not exist in the translation' } });
    await expect(cloud.sendTemplate({ connection, token: 'T', fetchImpl, to: '1', template: { name: 'x', language: 'en' }, bodyParams: [] }))
      .rejects.toThrow('No approved template has that name in that language');
    await expect(cloud.uploadMedia({ connection, token: 'T', buffer: Buffer.from(''), filename: 'x', fetchImpl: () => Promise.reject(new Error('ENOTFOUND')) }))
      .rejects.toThrow('can it reach graph.facebook.com');
  });
});

describe('the day, in the install zone', () => {
  it("starts at the zone's midnight", () => {
    expect(startOfDay('2026-10-24', 'Asia/Karachi').toISOString()).toBe('2026-10-23T19:00:00.000Z');
  });
});

/* WHATSAPP DAILY UPDATE - a run, and when it happens.
 *
 *   preview  the day's message and report, for the screen; nothing is sent
 *   pdf      the report as a PDF - to look at, and the sample Meta asks for
 *            when the template is submitted
 *   test     sent to ONE number instead of the recipients
 *   send     sent to every recipient (what the evening run does)
 *
 * The PDF is uploaded once and the same media id sent to each recipient.
 * Every test and send is logged (readLog), with Meta's reason for any refusal.
 */
const { readSettings, readToken, normalizePhone, TEMPLATE } = require('./settings');
const { loadDay, companyTitle } = require('./data');
const { buildReport, bodyParams, isQuiet, messageText } = require('./report');
const { reportHtml } = require('./pdfHtml');
const cloud = require('./cloudApi');
const { localDate, partsIn } = require('../creditControl/clock');
const { claimRun, markPassed, readRunState, readRunLog, appendRunLog } = require('../scheduledRuns');

const LOG_KEY = 'whatsappUpdatesLog';
const STATE_KEY = 'whatsappUpdatesState';
const LOCK_KEY = 4915042; // creditControl/scheduler has 4915041

class RunError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

const readLog = () => readRunLog(LOG_KEY);

async function runDailyUpdate({
  mode = 'send', testTo = null, date = null, now = new Date(), settings = null, trigger = 'manual',
  renderPdf = null, fetchImpl = undefined,
} = {}) {
  settings = settings || await readSettings();
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDate(now, settings.timeZone);
  const report = buildReport(await loadDay({ date: day, settings }));
  const params = bodyParams(report);
  const text = messageText(TEMPLATE.body, params);
  const html = reportHtml(report, { title: await companyTitle(settings), generatedAt: now, timeZone: settings.timeZone });
  const filename = `daily-update-${day}.pdf`;
  const head = { kind: 'daily', mode, trigger, date: day, at: now.toISOString(), totals: report.totals, text };

  if (mode === 'preview') return { ...head, html, params };
  const render = renderPdf || require('../pdf').renderHtmlPdf;
  if (mode === 'pdf') return { ...head, filename, pdf: (await render(html, { landscape: true })).toString('base64') };

  if (mode === 'send' && isQuiet(report) && !settings.sendWhenEmpty) {
    const entry = { ...head, sent: 0, failed: 0, results: [], note: 'Nothing was entered today, and quiet days are not sent.' };
    await appendRunLog(LOG_KEY, entry);
    return entry;
  }

  const recipients = mode === 'test'
    ? [{ name: 'Test', phone: normalizePhone(testTo, settings.defaultCountryCode) }]
    : settings.recipients;
  if (mode === 'test' && !recipients[0].phone) throw new RunError(`Not a WhatsApp number: "${testTo || ''}".`);
  if (!recipients.length) throw new RunError('Nobody to send to - add a recipient in Config > WhatsApp.');
  const token = await readToken();
  const { connection, template } = settings;
  if (!token || !connection.phoneNumberId) throw new RunError('WhatsApp is not connected - the phone number ID and the access token are both needed (Config > WhatsApp).');

  const results = [];
  let error = null;
  try {
    const mediaId = await cloud.uploadMedia({ connection, token, buffer: await render(html, { landscape: true }), filename, fetchImpl });
    for (const r of recipients) {
      try {
        const { messageId } = await cloud.sendTemplate({ connection, token, fetchImpl, to: r.phone, template, mediaId, filename, bodyParams: params });
        results.push({ name: r.name, phone: r.phone, status: 'sent', messageId });
      } catch (e) {
        results.push({ name: r.name, phone: r.phone, status: 'failed', error: e.message });
      }
    }
  } catch (e) {
    error = e.message;
    recipients.forEach((r) => results.push({ name: r.name, phone: r.phone, status: 'failed', error: e.message }));
  }

  const entry = {
    ...head, sent: results.filter((r) => r.status === 'sent').length, failed: results.filter((r) => r.status === 'failed').length,
    results, error,
  };
  await appendRunLog(LOG_KEY, entry);
  return entry;
}

// ------------------------------------------------------------------ schedule

let timer = null;

/** One minute's question: is today's update due and not sent? */
async function tick(now = new Date(), { run = runDailyUpdate } = {}) {
  const settings = await readSettings();
  if (!settings.enabled) return false;
  const local = partsIn(now, settings.timeZone);
  if (local.time < settings.time) return false;
  if (!(await claimRun({ stateKey: STATE_KEY, lockKey: LOCK_KEY, kind: 'daily', date: local.date }))) return false;
  await run({ mode: 'send', now, settings, trigger: 'schedule' })
    .catch((err) => appendRunLog(LOG_KEY, { kind: 'daily', mode: 'send', trigger: 'schedule', at: new Date().toISOString(), date: local.date, error: err.message }).catch(() => {}));
  return true;
}

/** Turned on, or the time moved, after today's time has passed: tomorrow is the first. */
const markTodayIfPassed = (settings, now = new Date()) => markPassed({ stateKey: STATE_KEY, kind: 'daily', time: settings.time, timeZone: settings.timeZone, now });

const readState = () => readRunState(STATE_KEY);

function start({ intervalMs = 60 * 1000 } = {}) {
  if (timer) return timer;
  if (process.env.ODYSSEY_WHATSAPP === 'off') {
    console.log('[whatsapp] daily update disabled (ODYSSEY_WHATSAPP=off)');
    return null;
  }
  const safeTick = () => tick().catch((err) => console.error('[whatsapp] tick failed:', err.message));
  timer = setInterval(safeTick, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runDailyUpdate, tick, start, stop, readLog, readState, markTodayIfPassed, RunError, LOG_KEY, STATE_KEY };

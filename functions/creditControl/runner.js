/* CREDIT CONTROL - a run: the daily check and the weekly report.
 *
 * Three modes, so it can be tried before it is trusted (Config > Credit
 * Control):
 *   preview  compose every email and return them; nothing is sent or changed
 *   test     compose and send every one to ONE address instead of its
 *            recipients - to see them in a real inbox; nothing is changed
 *   send     the real thing: blocks set and lifted, emails to their people
 *
 * Every send and test is logged (readLog) - who it went to, and why an email
 * could not go: no address, the mail server refusing it.
 */
const db = require('../../models');
const { readSettings } = require('./settings');
const { localDate } = require('./clock');
const { evaluateDaily, evaluateWeekly, recipientsFor } = require('./rules');
const { loadOpenBalances, clientsWithLimits, recipientsContext } = require('./data');
const { dailyEmail, weeklyEmail, esc } = require('./mail');
const { syncBlocks } = require('./blocks');

const LOG_KEY = 'creditControlLog';
const LOG_SIZE = 40;

const readLog = async () => {
  try {
    const row = await db.AppSetting.findOne({ where: { key: LOG_KEY } });
    const list = row?.value ? JSON.parse(row.value) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
};

const appendLog = async (entry) => {
  const list = [entry, ...(await readLog())].slice(0, LOG_SIZE);
  const value = JSON.stringify(list);
  const row = await db.AppSetting.findOne({ where: { key: LOG_KEY } });
  if (row) await row.update({ value });
  else await db.AppSetting.create({ key: LOG_KEY, value });
};

/** Send what was composed, or hand it back. Each email's report goes as a
 * PDF (the user's request, 2026-10-26: the content in a PDF, not the body);
 * `renderPdf` is for tests. */
async function deliver(emails, { mode, testTo, sendMail, renderPdf = null }) {
  const { readEmailConfig } = require('../emailConfig');
  const send = sendMail || require('../mailer').sendMail;
  const cfg = mode === 'preview' ? null : await readEmailConfig();
  const fromName = cfg?.fromName || 'Odyssey';
  const fromEmail = cfg?.fromEmail || cfg?.user;

  const out = [];
  for (const e of emails) {
    const row = { to: e.to, cc: e.cc, subject: e.subject, parties: e.parties, invoices: e.invoices, overLimit: e.overLimit, problem: e.problem || null };
    if (mode === 'preview') {
      out.push({ ...row, status: 'preview', html: e.html, reportHtml: e.reportHtml, attachments: [e.reportName, ...e.attachments.map((a) => a.filename)].filter(Boolean) });
      continue;
    }
    const to = mode === 'test' ? [testTo] : e.to;
    if (!to.length) { out.push({ ...row, status: 'skipped', error: 'Nobody to send it to - no email address on the rep, the admins or management.' }); continue; }
    try {
      const html = mode === 'test'
        ? `<p style="font-family:Arial,sans-serif;font-size:12px;background:#fffbe6;border:1px solid #ffe58f;padding:6px 10px">TEST - would have gone to ${esc(e.to.join(', ') || 'nobody')}${e.cc.length ? `, CC ${esc(e.cc.join(', '))}` : ''}.</p>${e.html}`
        : e.html;
      // The report, made a PDF here - not in the body.
      const render = renderPdf || require('../pdf').renderHtmlPdf;
      const pdf = e.reportHtml
        ? await render(e.reportHtml).catch((err) => { throw new Error(`Could not make the PDF report: ${err.message}`); })
        : null;
      const attachments = [
        ...(pdf ? [{ filename: e.reportName, content: pdf, contentType: 'application/pdf' }] : []),
        ...e.attachments,
      ];
      await send({
        fromName, fromEmail, to: to.join(', '), cc: mode === 'test' ? [] : e.cc,
        subject: mode === 'test' ? `[TEST] ${e.subject}` : e.subject, html, attachments,
      });
      out.push({ ...row, status: 'sent', sentTo: to });
    } catch (err) {
      out.push({ ...row, status: 'failed', error: err.message });
    }
  }
  return out;
}

/** The companies a report covers, for its heading. */
const reportTitle = async (settings) => {
  try {
    const where = settings.companies?.length ? { id: settings.companies.map(Number).filter(Number.isFinite) } : {};
    const rows = await db.Company.findAll({ where, attributes: ['title'], order: [['id', 'ASC']], raw: true });
    return rows.map((c) => c.title).filter(Boolean).join(', ');
  } catch (_) {
    return '';
  }
};

const summary = (kind, mode, results, extra = {}) => ({
  kind, mode, at: new Date().toISOString(),
  emails: results.length,
  sent: results.filter((r) => r.status === 'sent').length,
  failed: results.filter((r) => r.status === 'failed').length,
  skipped: results.filter((r) => r.status === 'skipped').length,
  ...extra,
});

/**
 * THE DAILY CHECK. Overdue invoices and over-limit parties, emailed; parties
 * over their limit blocked, those back under unblocked (send mode only).
 */
async function runDaily({ mode = 'send', testTo = null, now = new Date(), settings = null, trigger = 'manual', sendMail = null, renderPdf = null } = {}) {
  settings = settings || await readSettings();
  const today = localDate(now, settings.timeZone);
  const clients = await clientsWithLimits();
  const { invoicesByClient, billsByClient } = await loadOpenBalances({ settings, clientIds: clients.map((c) => c.id), now });
  const evaluated = evaluateDaily({ clients, invoicesByClient, billsByClient });

  // The blocks, as this run leaves them - or, when nothing may change, as it
  // would leave them.
  let blockResult = { blocked: 0, lifted: 0, blocks: new Map() };
  if (settings.block.enabled && mode === 'send') {
    blockResult = await syncBlocks(evaluated, { now });
  } else {
    const rows = await db.Credit_Block.findAll();
    blockResult.blocks = new Map(rows.map((b) => [b.ClientId, b]));
    for (const e of evaluated.filter((x) => x.over)) {
      const b = blockResult.blocks.get(e.client.id);
      if (!b?.active) blockResult.blocks.set(e.client.id, { active: settings.block.enabled });
    }
  }

  // Only what the emails are for: an over-limit party is reported when that
  // check is on, its overdue invoices when that one is.
  const reportable = evaluated.filter((e) => (settings.daily.overLimit && e.over) || (settings.daily.overdue && e.overdue.length));
  const ctx = await recipientsContext(settings, [...new Set(reportable.map((e) => e.client.salesRepresentatorId).filter(Boolean))]);
  const title = await reportTitle(settings);
  const groups = recipientsFor(reportable, ctx);
  const emails = groups.map((g) => ({
    ...g,
    ...dailyEmail(g, {
      today, timeZone: settings.timeZone, blocks: blockResult.blocks, now, title,
      ignoreOlderThanDays: settings.ignoreOlderThanDays, ignoreBelowAmount: settings.ignoreBelowAmount,
      showOverdue: settings.daily.overdue, showOverLimit: settings.daily.overLimit,
    }),
  }));

  const results = await deliver(emails, { mode, testTo, sendMail, renderPdf });
  const result = summary('daily', mode, results, {
    trigger, date: today,
    // How many parties have a limit at all - so an empty run can say whether
    // there was nothing to check or nothing to report.
    checked: clients.length,
    parties: reportable.length,
    overdueInvoices: reportable.reduce((t, e) => t + (settings.daily.overdue ? e.overdue.length : 0), 0),
    overLimit: evaluated.filter((e) => e.over).length,
    blocked: blockResult.blocked, lifted: blockResult.lifted,
  });
  if (mode !== 'preview') await appendLog({ ...result, results: results.map(({ html, reportHtml, ...r }) => r) });
  return { ...result, results };
}

/** THE WEEKLY REPORT: every party's invoices over the age, to its rep. */
async function runWeekly({ mode = 'send', testTo = null, now = new Date(), settings = null, trigger = 'manual', sendMail = null, renderPdf = null } = {}) {
  settings = settings || await readSettings();
  const today = localDate(now, settings.timeZone);
  const { clients, invoicesByClient, billsByClient } = await loadOpenBalances({ settings, now });
  const entries = evaluateWeekly({ clients: [...clients.values()], invoicesByClient, billsByClient, ageDays: settings.weekly.ageDays });
  const ctx = await recipientsContext(settings, [...new Set(entries.map((e) => e.client.salesRepresentatorId).filter(Boolean))]);
  const groups = recipientsFor(entries, ctx);
  const title = await reportTitle(settings);
  const emails = groups.map((g) => ({ ...g, ...weeklyEmail(g, { today, ageDays: settings.weekly.ageDays, ignoreOlderThanDays: settings.ignoreOlderThanDays, ignoreBelowAmount: settings.ignoreBelowAmount, title }) }));

  const results = await deliver(emails, { mode, testTo, sendMail, renderPdf });
  const result = summary('weekly', mode, results, {
    trigger, date: today, ageDays: settings.weekly.ageDays, parties: entries.length,
    invoices: entries.reduce((t, e) => t + e.invoices.length, 0),
  });
  if (mode !== 'preview') await appendLog({ ...result, results: results.map(({ html, reportHtml, ...r }) => r) });
  return { ...result, results };
}

module.exports = { runDaily, runWeekly, readLog, appendLog, deliver, LOG_KEY };

/* CREDIT CONTROL - the emails, and the report each one carries (no database;
 * unit tested).
 *
 * One email per recipient group (rules.recipientsFor), not per party: a rep
 * with forty parties gets one email a day, not forty.
 *
 * THE BODY IS A SHORT SUMMARY; THE CONTENT IS AN ATTACHED PDF (the user's
 * request, 2026-10-26): the counts and totals in the email, and every party's
 * details and every invoice in the report - reportHtml, made a PDF by the
 * runner (functions/pdf renderHtmlPdf). The same invoices go as a CSV too,
 * for Excel. Each invoice is shown in its own currency; only the amount limit
 * is in rupees (the user's rule).
 *
 * BILLS TOO (the user's request, 2026-10-26): each party's open bills - what
 * we owe it - beside its invoices, and the net of the two, which is what the
 * amount limit is checked against (rules.position).
 */
const { localDate } = require('./clock');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ddmmyyyy = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-');
  return y && m && d ? `${d}-${m}-${y}` : '';
};

const TABLE = 'border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;margin:6px 0 14px';
const TH = 'border:1px solid #c9d1d9;background:#f2f4f7;padding:4px 8px;text-align:left;white-space:nowrap';
const TD = 'border:1px solid #d9dee4;padding:4px 8px;white-space:nowrap';
const NUM = `${TD};text-align:right`;
// A party's name may wrap - with the bills and the net, the tables are wide.
const NAME = 'border:1px solid #d9dee4;padding:4px 8px';

const table = (heads, rows) => `<table style="${TABLE}"><tr>${heads.map((h) => `<th style="${TH}">${esc(h)}</th>`).join('')}</tr>${rows.join('')}</table>`;
const tr = (cells) => `<tr>${cells.map(([v, style]) => `<td style="${style || TD}">${v}</td>`).join('')}</tr>`;

/** A party's details - who to chase, and on what terms. */
const partyCard = (client) => {
  const bits = [
    client.person1 && `Contact: ${esc(client.person1)}${client.mobile1 ? ` (${esc(client.mobile1)})` : ''}`,
    client.telephone1 && `Phone: ${esc(client.telephone1)}`,
    (client.accountsMail || client.infoMail) && `Email: ${esc(client.accountsMail || client.infoMail)}`,
    client.city && `City: ${esc(client.city)}`,
    client.creditLimitDays != null && client.creditLimitDays !== '' && `Credit: ${esc(client.creditLimitDays)} days`,
    client.creditLimitAmount != null && client.creditLimitAmount !== '' && `Limit: PKR ${money(client.creditLimitAmount)}`,
  ].filter(Boolean);
  return `<div style="font-family:Arial,sans-serif;font-size:13px;margin-top:10px"><b>${esc(client.name)}</b>${client.code ? ` (${esc(client.code)})` : ''}`
    + `${bits.length ? `<div style="font-size:12px;color:#555">${bits.join(' &middot; ')}</div>` : ''}</div>`;
};

/** Balances by currency - '1,200.00 PKR; 340.00 USD' - never added across. */
const byCurrency = (invoices) => {
  const totals = new Map();
  for (const i of invoices) totals.set(i.currency, (totals.get(i.currency) || 0) + i.balance);
  return [...totals.entries()].sort(([a], [b]) => (a === 'PKR' ? -1 : b === 'PKR' ? 1 : a.localeCompare(b)))
    .map(([c, t]) => `${c} ${money(t)}`).join('; ');
};

const greeting = (group) => {
  if (group.kind === 'noRep') {
    return '<p>These parties have <b>no sales rep</b>. Please set one on each in <b>Setup &gt; Parties &gt; Account Info</b>, so these emails reach the right person.</p>';
  }
  return `<p>Dear ${esc(group.rep?.name || 'colleague')},</p>`;
};

const problemNote = (group) => (group.problem ? `<p style="color:#b02a37">${esc(group.problem)}</p>` : '');

const footer = (extra, ignoreOlderThanDays, ignoreBelowAmount = 0) => `<p style="font-family:Arial,sans-serif;font-size:11px;color:#888;margin-top:18px">${extra} `
  + `${ignoreOlderThanDays > 0 ? `Invoices and bills older than ${ignoreOlderThanDays} days are not included. ` : ''}`
  + `${ignoreBelowAmount > 0 ? `Invoices and bills with less than PKR ${money(ignoreBelowAmount)} left on them are not included. ` : ''}`
  + 'Sent by Odyssey credit control.</p>';

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** A CSV Excel opens as it is: a byte-order mark, so it reads the text as UTF-8. */
const csv = (heads, rows) => `﻿${[heads, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

const repName = (group) => (group.kind === 'noRep' ? '(no sales rep)' : group.rep?.name || '');

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sumPkr = (invoices) => invoices.reduce((t, i) => t + i.balancePkr, 0);

/* The report, as a page for the PDF. Portrait A4. */
const REPORT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #1f2933; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  h3 { font-size: 13px; margin: 16px 0 4px; }
  .sub { color: #66737f; margin-bottom: 10px; }
  tr { page-break-inside: avoid; }
`;
const reportDocument = ({ title, subtitle, body }) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>`
  + `<style>${REPORT_CSS}</style></head><body><h1>${esc(title)}</h1><div class="sub">${subtitle}</div>${body}</body></html>`;

const forWhom = (group) => (group.kind === 'noRep' ? 'Parties with no sales rep' : `For ${esc(group.rep?.name || '')}`);

const attachedLine = (what, csvOf) => `<p>The full report - ${what} - is attached as a PDF${csvOf ? `, with the same ${csvOf} as a spreadsheet (CSV)` : ''}.</p>`;

const billsOf = (e) => e.bills || [];

/** Who owes whom, net. */
const netText = (pkr) => (pkr >= 0 ? `PKR ${money(pkr)}` : `PKR ${money(-pkr)} in their favour`);

/** A party's invoices less our bills to it - only where it has bills. */
const positionLine = (e) => (billsOf(e).length
  ? `<div style="font-size:12px;margin:2px 0 4px">Open invoices PKR ${money(e.receivablePkr)} &minus; our bills PKR ${money(e.payablePkr)} = <b>net ${netText(e.balancePkr)}</b></div>`
  : '');

const caption = (text) => `<div style="font-size:12px;margin-top:6px"><b>${text}</b></div>`;

const invoiceRow = (i, withDaysOver) => tr([
  [esc(i.invoiceNo)], [esc(i.jobNo || '')], [ddmmyyyy(i.date)], [i.ageDays, NUM], ...(withDaysOver ? [[i.daysOver, NUM]] : []),
  [esc(i.currency)], [money(i.amount), NUM], [money(i.balance), NUM],
]);

const billsTable = (bills) => caption(`Our open bills to them (${bills.length})`)
  + table(['Bill', 'Job', 'Date', 'Age (days)', 'Currency', 'Amount', 'Balance'], bills.map((b) => invoiceRow(b, false)));

/** The sentence about bills, for a body - '' when none of these parties has one. */
const billsSentence = (entries) => {
  const withBills = entries.filter((e) => billsOf(e).length);
  if (!withBills.length) return '';
  const owed = withBills.reduce((t, e) => t + e.payablePkr, 0);
  const net = withBills.reduce((t, e) => t + e.balancePkr, 0);
  const who = withBills.length === 1 ? 'one of these parties' : `${withBills.length} of these parties`;
  return `We owe ${who} <b>PKR ${money(owed)}</b> in open bills - net, ${net >= 0 ? `they owe PKR ${money(net)}` : `PKR ${money(-net)} in their favour`}.`;
};

/**
 * THE DAILY EMAIL. `group.entries` are evaluateDaily's: a party, its overdue
 * invoices, its open bills, its net, and whether that is over its amount
 * limit. `blocks`: Map(ClientId -> Credit_Block) as the run left them.
 *
 * Returns the short body (html), the report (reportHtml, reportName) and the
 * CSV (attachments).
 */
const dailyEmail = (group, { today, timeZone, blocks = new Map(), showOverdue = true, showOverLimit = true, now = new Date(), ignoreOlderThanDays = 0, ignoreBelowAmount = 0, title = '' }) => {
  const over = showOverLimit ? group.entries.filter((e) => e.over) : [];
  const overdue = showOverdue ? group.entries.filter((e) => e.overdue.length) : [];
  const reported = group.entries.filter((e) => (showOverLimit && e.over) || (showOverdue && e.overdue.length));
  const parties = reported.length;
  const invoiceCount = overdue.reduce((t, e) => t + e.overdue.length, 0);
  const withBills = reported.some((e) => billsOf(e).length);

  // ---- the body: what needs attention, in numbers
  const points = [];
  if (over.length) {
    const net = over.some((e) => billsOf(e).length) ? ' net of our bills' : '';
    points.push(`<li><b>${plural(over.length, 'party', 'parties')}</b> over the credit limit - owing PKR ${money(over.reduce((t, e) => t + e.balancePkr, 0))}${net}`
      + ` against limits of PKR ${money(over.reduce((t, e) => t + e.limitPkr, 0))}.</li>`);
  }
  if (overdue.length) {
    points.push(`<li><b>${plural(invoiceCount, 'overdue invoice')}</b> across ${plural(overdue.length, 'party', 'parties')}`
      + ` - PKR ${money(overdue.reduce((t, e) => t + sumPkr(e.overdue), 0))} outstanding.</li>`);
  }
  if (withBills) points.push(`<li>${billsSentence(reported)}</li>`);

  // ---- the report: everything, no cap
  let detail = '';
  if (over.length) {
    detail += '<h3>Over the credit limit</h3>';
    detail += table(['Party', 'Code', 'Invoices (PKR)', 'Our bills (PKR)', 'Net owed (PKR)', 'Limit (PKR)', 'Over by (PKR)', 'Jobs'], over.map((e) => {
      const block = blocks.get(e.client.id);
      const status = !block?.active ? 'Not blocked'
        : block.approvedUntil && new Date(block.approvedUntil) > now ? `Allowed until ${ddmmyyyy(localDate(block.approvedUntil, timeZone))}`
          : 'Blocked from new jobs';
      return tr([[esc(e.client.name), NAME], [esc(e.client.code)], [money(e.receivablePkr), NUM], [money(e.payablePkr), NUM],
        [money(e.balancePkr), NUM], [money(e.limitPkr), NUM], [money(e.balancePkr - e.limitPkr), NUM], [esc(status)]]);
    }));
  }
  if (reported.length) {
    detail += '<h3>By party</h3>';
    for (const e of reported) {
      detail += partyCard(e.client) + positionLine(e);
      const due = showOverdue ? e.overdue : [];
      if (due.length) {
        detail += caption(`Overdue invoices (${due.length})`)
          + table(['Invoice', 'Job', 'Date', 'Age (days)', 'Days over', 'Currency', 'Amount', 'Balance'], due.map((i) => invoiceRow(i, true)));
      }
      if (billsOf(e).length) detail += billsTable(billsOf(e));
    }
  }
  detail += footer('Open invoices and bills as of the morning of the report.', ignoreOlderThanDays, ignoreBelowAmount);
  const reportHtml = reportDocument({
    title: `Credit control - ${ddmmyyyy(today)}`,
    subtitle: `${forWhom(group)}${title ? ` &middot; ${esc(title)}` : ''}`,
    body: detail,
  });

  const rows = [];
  for (const e of reported) {
    const base = [e.client.name, e.client.code, repName(group)];
    for (const i of (showOverdue ? e.overdue : [])) {
      rows.push([...base, 'Invoice', i.invoiceNo, i.jobNo || '', ddmmyyyy(i.date), i.ageDays,
        e.client.creditLimitDays ?? '', i.daysOver, i.currency, i.amount.toFixed(2), i.balance.toFixed(2), i.balancePkr.toFixed(2)]);
    }
    for (const b of billsOf(e)) {
      rows.push([...base, 'Bill', b.invoiceNo, b.jobNo || '', ddmmyyyy(b.date), b.ageDays,
        '', '', b.currency, b.amount.toFixed(2), b.balance.toFixed(2), b.balancePkr.toFixed(2)]);
    }
  }
  const attachments = rows.length ? [{
    filename: `credit-control-${today}.csv`,
    content: csv(['Party', 'Code', 'Sales Rep', 'Kind', 'Number', 'Job', 'Date', 'Age (days)', 'Credit (days)', 'Days over', 'Currency', 'Amount', 'Balance', 'Balance (PKR)'], rows),
    contentType: 'text/csv; charset=utf-8',
  }] : [];

  const what = (overdue.length ? "each party's details, and every overdue invoice" : 'each party over its limit, and its status')
    + (withBills ? ', with the bills we owe them' : '');
  const html = `<div style="font-family:Arial,sans-serif;font-size:13px">${greeting(group)}${problemNote(group)}`
    + `<p>Credit control for ${ddmmyyyy(today)}:</p><ul style="margin:0 0 10px 18px;padding:0">${points.join('')}</ul>`
    + attachedLine(what, rows.length ? (withBills ? 'invoices and bills' : 'invoices') : '')
    + footer('These are open invoices as of this morning. An invoice drops off once it is paid.', ignoreOlderThanDays, ignoreBelowAmount)
    + '</div>';

  const who = group.kind === 'noRep' ? 'Parties with no sales rep' : group.rep?.name;
  const subjectWhat = [over.length && `${over.length} over the credit limit`, invoiceCount && plural(invoiceCount, 'overdue invoice')].filter(Boolean).join(', ');
  return {
    subject: `Credit control ${ddmmyyyy(today)} - ${who}: ${subjectWhat}`,
    html, reportHtml, reportName: `credit-control-${today}.pdf`,
    attachments, parties, invoices: invoiceCount, overLimit: over.length,
  };
};

/**
 * THE WEEKLY EMAIL: each party's invoices over `ageDays`, as an ageing report
 * - with every open bill we owe it and the net of all its open invoices less
 * those bills (evaluateWeekly).
 */
const weeklyEmail = (group, { today, ageDays, ignoreOlderThanDays = 0, ignoreBelowAmount = 0, title = '' }) => {
  const entries = group.entries;
  const invoiceCount = entries.reduce((t, e) => t + e.invoices.length, 0);
  const totalPkr = entries.reduce((t, e) => t + sumPkr(e.invoices), 0);
  const withBills = entries.some((e) => billsOf(e).length);

  const rows = [];
  for (const e of entries) {
    const base = [e.client.name, e.client.code, repName(group)];
    for (const i of e.invoices) {
      rows.push([...base, 'Invoice', i.invoiceNo, i.jobNo || '', ddmmyyyy(i.date), i.ageDays,
        i.currency, i.amount.toFixed(2), i.balance.toFixed(2), i.balancePkr.toFixed(2)]);
    }
    for (const b of billsOf(e)) {
      rows.push([...base, 'Bill', b.invoiceNo, b.jobNo || '', ddmmyyyy(b.date), b.ageDays,
        b.currency, b.amount.toFixed(2), b.balance.toFixed(2), b.balancePkr.toFixed(2)]);
    }
  }

  const html = `<div style="font-family:Arial,sans-serif;font-size:13px">${greeting(group)}${problemNote(group)}`
    + `<p>Open invoices over <b>${ageDays} days</b> old, as of ${ddmmyyyy(today)}: <b>${plural(invoiceCount, 'invoice')}</b>`
    + ` for ${plural(entries.length, 'party', 'parties')}, PKR ${money(totalPkr)} outstanding.</p>`
    + (withBills ? `<p>${billsSentence(entries)}</p>` : '')
    + attachedLine(`each party's details and every invoice${withBills ? ', with the bills we owe them' : ''}`, rows.length ? (withBills ? 'invoices and bills' : 'invoices') : '')
    + footer('Sent every week.', ignoreOlderThanDays, ignoreBelowAmount)
    + '</div>';

  let detail = table(['Party', 'Code', 'Invoices', 'Oldest (days)', 'Balance', 'Balance (PKR)', 'Our bills (PKR)', 'Net (PKR)'], entries.map((e) => tr([
    [esc(e.client.name), NAME], [esc(e.client.code)], [e.invoices.length, NUM], [e.invoices[0]?.ageDays ?? '', NUM],
    [esc(byCurrency(e.invoices))], [money(sumPkr(e.invoices)), NUM], [money(e.payablePkr || 0), NUM], [money(e.balancePkr ?? sumPkr(e.invoices)), NUM],
  ])));
  for (const e of entries) {
    detail += partyCard(e.client) + positionLine(e);
    detail += table(['Invoice', 'Job', 'Date', 'Age (days)', 'Currency', 'Amount', 'Balance'], e.invoices.map((i) => invoiceRow(i, false)));
    if (billsOf(e).length) detail += billsTable(billsOf(e));
  }
  detail += footer(`Open invoices over ${ageDays} days old, and every open bill. Net (PKR): all of a party's open invoices less those bills.`, ignoreOlderThanDays, ignoreBelowAmount);
  const reportHtml = reportDocument({
    title: `Ageing over ${ageDays} days - ${ddmmyyyy(today)}`,
    subtitle: `${forWhom(group)}${title ? ` &middot; ${esc(title)}` : ''}`,
    body: detail,
  });

  const who = group.kind === 'noRep' ? 'Parties with no sales rep' : group.rep?.name;
  return {
    subject: `Ageing over ${ageDays} days ${ddmmyyyy(today)} - ${who}: ${plural(entries.length, 'party', 'parties')}, ${plural(invoiceCount, 'invoice')}`,
    html, reportHtml, reportName: `ageing-over-${ageDays}-days-${today}.pdf`,
    attachments: rows.length ? [{
      filename: `ageing-over-${ageDays}-days-${today}.csv`,
      content: csv(['Party', 'Code', 'Sales Rep', 'Kind', 'Number', 'Job', 'Date', 'Age (days)', 'Currency', 'Amount', 'Balance', 'Balance (PKR)'], rows),
      contentType: 'text/csv; charset=utf-8',
    }] : [],
    parties: entries.length, invoices: invoiceCount, overLimit: 0,
  };
};

module.exports = { dailyEmail, weeklyEmail, csv, esc, money, ddmmyyyy };

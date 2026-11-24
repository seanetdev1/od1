/* WHATSAPP DAILY UPDATE - the attached report as HTML, for the PDF (no
 * database; unit tested). Landscape A4: the per-job table is wide. */
const { ddmmyyyy } = require('./report');
const { localDate } = require('../creditControl/clock');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n) => `<span class="${n < 0 ? 'neg' : ''}">${money(n)}</span>`;

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #1f2933; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .sub { color: #66737f; margin-bottom: 12px; }
  .tiles { display: flex; gap: 8px; margin-bottom: 14px; }
  .tile { flex: 1; border: 1px solid #d9dee4; border-radius: 6px; padding: 8px 10px; }
  .tile b { display: block; font-size: 15px; margin-top: 2px; }
  h2 { font-size: 13px; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f2f4f7; text-align: left; font-weight: 600; }
  th, td { border: 1px solid #d9dee4; padding: 4px 6px; vertical-align: top; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  tr { page-break-inside: avoid; }
  .neg { color: #b02a37; }
  .muted { color: #66737f; }
  .empty { color: #66737f; padding: 6px 0; }
  .inv { white-space: nowrap; }
`;

const invoiceList = (lines) => lines.map((l) => `<div class="inv">${esc(l.invoiceNo)} <span class="muted">${esc(l.selling ? 'invoice' : 'bill')} · ${esc(l.party)} · ${esc(l.currency)} ${money(l.amount)}${l.approved ? '' : ' · not approved'}</span></div>`).join('');

/** The report (./report.buildReport) as a page. */
const reportHtml = (report, { title = 'Odyssey', generatedAt = new Date(), timeZone = 'Asia/Karachi' } = {}) => {
  const t = report.totals;
  // "today" on the evening's report; a day looked back on is "that day".
  const day = report.date === localDate(generatedAt, timeZone) ? 'today' : 'that day';
  const when = new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(generatedAt);

  const bookings = report.bookings.length
    ? `<table><tr><th>Job</th><th>Type</th><th>Client</th><th>Sales rep</th><th>Details</th><th>Entered by</th></tr>${report.bookings.map((b) => `<tr>
        <td>${esc(b.jobNo)}</td><td>${esc(b.type)}</td><td>${esc(b.client)}</td><td>${esc(b.salesRep)}</td><td>${esc(b.detail)}</td><td>${esc(b.enteredBy)}</td></tr>`).join('')}</table>`
    : `<div class="empty">No jobs were entered ${day}.</div>`;

  const jobs = report.jobs.length
    ? `<table><tr><th>Job</th><th>Client</th><th>Raised today</th><th class="n">Selling today</th><th class="n">Buying today</th><th class="n">Job selling</th><th class="n">Job buying</th><th class="n">Job profit</th></tr>${report.jobs.map((j) => `<tr>
        <td>${esc(j.jobNo)}<div class="muted">${esc(j.type)}</div></td><td>${esc(j.client)}</td><td>${invoiceList(j.newInvoices)}</td>
        <td class="n">${money(j.todaySelling)}</td><td class="n">${money(j.todayBuying)}</td>
        <td class="n">${money(j.selling)}</td><td class="n">${money(j.buying)}</td><td class="n">${signed(j.profit)}</td></tr>`).join('')}</table>`
    : `<div class="empty">No invoices or bills were raised on a job ${day}.</div>`;

  const unassigned = report.unassigned.length
    ? `<h2>Not on a job (${report.unassigned.length})</h2><table><tr><th>Invoice</th><th>Type</th><th>Party</th><th class="n">Amount</th><th class="n">PKR</th></tr>${report.unassigned.map((l) => `<tr>
        <td>${esc(l.invoiceNo)}</td><td>${esc(l.type)}</td><td>${esc(l.party)}</td><td class="n">${esc(l.currency)} ${money(l.amount)}</td><td class="n">${money(l.pkr)}</td></tr>`).join('')}</table>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Daily update ${esc(ddmmyyyy(report.date))}</title><style>${CSS}</style></head><body>
    <h1>Daily update - ${esc(ddmmyyyy(report.date))}</h1>
    <div class="sub">${esc(title)} · made ${esc(when)} · in PKR, a foreign invoice at its own rate</div>
    <div class="tiles">
      <div class="tile">New bookings<b>${t.bookings}</b></div>
      <div class="tile">Invoices &amp; bills raised<b>${t.invoices}</b></div>
      <div class="tile">Selling<b>${money(t.selling)}</b></div>
      <div class="tile">Buying<b>${money(t.buying)}</b></div>
      <div class="tile">Profit<b>${signed(t.profit)}</b></div>
    </div>
    <h2>New bookings (${t.bookings})</h2>${bookings}
    <h2>Invoices and bills by job (${t.jobs} job${t.jobs === 1 ? '' : 's'})</h2>
    <div class="muted" style="margin-bottom:4px">Job selling, buying and profit are from every invoice and bill on the job so far, approved or not.</div>
    ${jobs}${unassigned}
  </body></html>`;
};

module.exports = { reportHtml };

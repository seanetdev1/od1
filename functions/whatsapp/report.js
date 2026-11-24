/* WHATSAPP DAILY UPDATE - the day's report, with no database (unit tested).
 *
 * THE DAY: what was ENTERED that day in the install's zone - jobs and
 * invoices by createdOn, the audit stamp. Not createdAt: a freight job's is
 * its job date and an invoice's the sailing day, either of which can be weeks
 * from when it was keyed in.
 *
 *   bookings   every job entered that day - freight, customs, aviation
 *   jobs       every job that had an invoice or bill raised that day (the
 *              user chose "per job"): that day's selling (receivable
 *              invoices) and buying (payable bills), and the job's own to
 *              date - selling, buying, profit - from every invoice on it
 *   totals     the day's: bookings, invoices raised, selling, buying, profit
 *
 * In rupees - a PKR invoice at 1 whatever its ex_rate says, a foreign one at
 * its own rate (functions/invoiceRate in the frontend).
 */
const { rateToLocal, num } = require('../creditControl/rules');

const pkr = (inv) => Math.round((num(inv.total) + num(inv.roundOff)) * rateToLocal(inv) * 100) / 100;
const isSelling = (inv) => String(inv.payType || '').toLowerCase() !== 'payble';

/** Which job an invoice belongs to - 'freight:12', 'customs:5', 'aviation:3' - or null. */
const jobKeyOf = (inv, consignmentJob) => {
  if (inv.SEJobId) return `freight:${inv.SEJobId}`;
  const lines = inv.Charge_Heads || [];
  const customs = lines.map((c) => c.CustomsJobId).find(Boolean);
  if (customs) return `customs:${customs}`;
  const consignment = lines.map((c) => c.AviationConsignmentId).find(Boolean);
  const flight = consignment ? consignmentJob.get(consignment) : null;
  return flight ? `aviation:${flight}` : null;
};

const byJobNo = (a, b) => String(a.jobNo || '').localeCompare(String(b.jobNo || ''), 'en', { numeric: true });

/**
 * `bookings`     [{ kind, jobNo, type, client, salesRep, enteredBy, detail }]
 * `newInvoices`  invoices raised that day, each with `jobKey` (or null)
 * `jobs`         Map(jobKey -> { kind, jobNo, type, client })
 * `jobInvoices`  every invoice on those jobs, each with `jobKey`
 */
const buildReport = ({ date, bookings = [], newInvoices = [], jobs = new Map(), jobInvoices = [] }) => {
  const toDate = new Map();
  for (const inv of jobInvoices) {
    if (!inv.jobKey) continue;
    if (!toDate.has(inv.jobKey)) toDate.set(inv.jobKey, { selling: 0, buying: 0, seen: new Set() });
    const t = toDate.get(inv.jobKey);
    if (t.seen.has(inv.id)) continue;
    t.seen.add(inv.id);
    if (isSelling(inv)) t.selling += pkr(inv); else t.buying += pkr(inv);
  }

  const rows = new Map();
  const unassigned = [];
  const line = (inv) => ({
    id: inv.id, invoiceNo: inv.invoice_No, type: inv.type, party: inv.party_Name || '',
    currency: String(inv.currency || '').toUpperCase() || 'PKR', amount: num(inv.total) + num(inv.roundOff),
    pkr: pkr(inv), selling: isSelling(inv), approved: String(inv.approved) === '1',
  });
  for (const inv of newInvoices) {
    const l = line(inv);
    if (!inv.jobKey || !jobs.has(inv.jobKey)) { unassigned.push(l); continue; }
    if (!rows.has(inv.jobKey)) {
      const job = jobs.get(inv.jobKey);
      const t = toDate.get(inv.jobKey) || { selling: 0, buying: 0 };
      rows.set(inv.jobKey, {
        key: inv.jobKey, ...job, newInvoices: [], todaySelling: 0, todayBuying: 0,
        selling: round(t.selling), buying: round(t.buying), profit: round(t.selling - t.buying),
      });
    }
    const r = rows.get(inv.jobKey);
    r.newInvoices.push(l);
    if (l.selling) r.todaySelling = round(r.todaySelling + l.pkr); else r.todayBuying = round(r.todayBuying + l.pkr);
  }

  const all = [...[...rows.values()].flatMap((r) => r.newInvoices), ...unassigned];
  const selling = round(all.filter((l) => l.selling).reduce((t, l) => t + l.pkr, 0));
  const buying = round(all.filter((l) => !l.selling).reduce((t, l) => t + l.pkr, 0));
  return {
    date,
    bookings: [...bookings].sort(byJobNo),
    jobs: [...rows.values()].sort(byJobNo),
    unassigned,
    totals: { bookings: bookings.length, invoices: newInvoices.length, jobs: rows.size, selling, buying, profit: round(selling - buying) },
  };
};

const round = (n) => Math.round(n * 100) / 100;

/** Rupees as the message shows them: whole, with separators. */
const wholePkr = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

const ddmmyyyy = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-');
  return y && m && d ? `${d}-${m}-${y}` : String(ymd || '');
};

/** The template's six variables, in its order - settings.TEMPLATE. */
const bodyParams = (report) => [
  ddmmyyyy(report.date),
  String(report.totals.bookings),
  String(report.totals.invoices),
  wholePkr(report.totals.selling),
  wholePkr(report.totals.buying),
  wholePkr(report.totals.profit),
];

/** Nothing entered that day. */
const isQuiet = (report) => report.totals.bookings === 0 && report.totals.invoices === 0;

/** The message as it reads, for the screen's preview - the template, filled in. */
const messageText = (templateBody, params) => params.reduce((text, p, i) => text.split(`{{${i + 1}}}`).join(p), templateBody);

module.exports = { jobKeyOf, buildReport, bodyParams, isQuiet, messageText, wholePkr, ddmmyyyy, pkr, isSelling };

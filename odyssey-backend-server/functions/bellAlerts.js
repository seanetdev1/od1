/* THE BELL'S ALERTS - three standing lists, worked out from the data each time
 * they are asked for (the user, 2026-11-23):
 *
 *   Critical      an invoice not settled for more than 90 days, and a customs
 *                 job with no charges 7 days after it went On Vessel
 *   Job Charges   a job with no charges 7 days after it was created
 *   Invoices Due  an invoice still due after 45 days
 *   Job Status    a customs job 7 days or more old that is still not On
 *                 Vessel (added the same day)
 *
 * The user's choices: only what was made in Odyssey (no climaxId) - migrated
 * books would bury them, CL's 72,000 balance-forward invoices above all - and
 * invoices both ways, to receive and to pay.
 *
 * My calls:
 *  - An invoice is in ONE list: 46-90 days is Invoices Due, over 90 Critical.
 *    A job On Vessel for 7 days with no charges is Critical and not repeated
 *    under Job Charges.
 *  - Approved invoices only (an unapproved one is not on the ledger), dated
 *    by the invoice's date (createdAt), counted in Pakistan days. "Settled"
 *    is the app's one rule (functions/invoiceOutstanding).
 *  - No charges = no charge line at all on the job, either side. Cancelled
 *    jobs are left out. Freight and customs jobs; aviation's charges hang off
 *    its consignments, and no install runs it.
 *  - On Vessel = the status stored as 'Complete'. Since when: the latest
 *    change to it in Customs_Job_Statuses (kept from 2026-11-23); a job that
 *    went On Vessel before that is counted from its creation.
 *  - "Still not On Vessel" = not yet at a FINISHED status (Configuration >
 *    Customs > Statuses: On Vessel, DrayOff and Canceled to begin with). An
 *    import job ends at DrayOff and never goes On Vessel; it would otherwise
 *    stay on the list for ever. Customs only - freight jobs have no such
 *    status. Measured from the job's creation.
 *  - Each list only for a user who may see its records (invoices, or the
 *    kind of job), and only in the companies they work in.
 *
 * WHO SEES WHICH LIST: per designation, Configuration > Bell Alerts (the
 * user, 2026-11-23). Until saved, CEO, CFO and admin see all four and nobody
 * else any - as the dashboard's widgets start (my call, following the user's
 * choice there). Seanet's System login sees all. A list not ticked is not
 * even worked out. The rights and companies above still apply on top.
 *
 * Each item carries `since` (when its clock started - the invoice's date, the
 * job's creation, or when it went On Vessel) and `dueDays` (how long it was
 * allowed), so the bell can say "Overdue by 12d 4h" (the look the user asked
 * for, 2026-11-23), and `party` - the invoice's party, or the job's client.
 */
const { SQL_OUTSTANDING_AMOUNT } = require('./invoiceOutstanding');
const { OPERATION_MODULE } = require('./permissions/catalog');
const { LINKING_REPORTS } = require('./permissions/routeRules');
const { designationGrid } = require('./designationGrid');

// The four lists, in the bell's order - the rows of Configuration > Bell Alerts.
const LISTS = Object.freeze([
  { key: 'critical', label: 'Critical', hint: 'Invoices not settled for longer than the Critical days, and customs jobs with no charges that many days after going On Vessel.' },
  { key: 'jobCharges', label: 'Job Charges', hint: 'Jobs with no charges the set number of days after they were created.' },
  { key: 'invoicesDue', label: 'Invoices Due', hint: 'Invoices still due after the set number of days (and not yet Critical).' },
  { key: 'jobStatus', label: 'Job Status', hint: 'Customs jobs the set number of days old or more that are not On Vessel (or another finished status) yet.' },
]);
const access = designationGrid({
  key: 'bellAlertLists', rows: LISTS, defaultDesignations: ['ceo', 'cfo', 'admin'], noun: 'list', plural: 'lists',
});

/* THE DAYS EACH LIST CHECKS AGAINST - set in Configuration > Bell Alerts (the
 * user, 2026-11-23: "invoice due over 90 days are critical, I should be able
 * to set it at 120 if I want, same with the others"). AppSetting
 * `bellAlertDays`; what is not saved reads as these. */
const DAYS_KEY = 'bellAlertDays';
const DAYS = Object.freeze({ critical: 90, due: 45, noCharges: 7, onVessel: 7, unfinished: 7 });
const DAY_FIELDS = Object.freeze([
  { key: 'critical', list: 'Critical', label: 'Invoice not settled for more than', after: 'days' },
  { key: 'onVessel', list: 'Critical', label: 'Job with no charges', after: 'days after going On Vessel' },
  { key: 'noCharges', list: 'Job Charges', label: 'Job with no charges', after: 'days after it was created' },
  { key: 'due', list: 'Invoices Due', label: 'Invoice still due after', after: 'days' },
  { key: 'unfinished', list: 'Job Status', label: 'Job not On Vessel', after: 'days or more after it was created' },
]);
const MAX_DAYS = 3650;

class DaysError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

const isWholeDays = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_DAYS;

/** What is stored, over the defaults - a number that is not a sensible one reads as its default. */
function daysWithDefaults(stored) {
  const out = { ...DAYS };
  if (stored && typeof stored === 'object') {
    for (const k of Object.keys(DAYS)) {
      const n = Number(stored[k]);
      if (isWholeDays(n)) out[k] = n;
    }
  }
  // Invoices Due must start before Critical, or its list could never fill.
  if (out.due >= out.critical) { out.due = DAYS.due < out.critical ? DAYS.due : out.critical - 1; }
  return out;
}

/** A save, checked and laid over `base` (what is stored): only what is sent changes. */
function validateDays(body, base = DAYS) {
  if (!body || typeof body !== 'object') throw new DaysError('Send the days as { critical, onVessel, noCharges, due, unfinished }.');
  for (const k of Object.keys(body)) {
    if (!(k in DAYS)) throw new DaysError(`Unknown setting: ${k}.`);
    if (!isWholeDays(Number(body[k])) || String(body[k]).trim() === '') {
      throw new DaysError(`${k} must be a whole number of days from 1 to ${MAX_DAYS}.`);
    }
  }
  const out = { ...DAYS, ...base };
  for (const k of Object.keys(body)) out[k] = Number(body[k]);
  if (out.due >= out.critical) {
    throw new DaysError(`Invoices Due (${out.due}) must be fewer days than Critical (${out.critical}) - an invoice past Critical is no longer listed as due.`);
  }
  return out;
}

async function readDays() {
  const row = await require('../models').AppSetting.findOne({ where: { key: DAYS_KEY } });
  let stored = null;
  try { stored = row?.value ? JSON.parse(row.value) : null; } catch (_) { stored = null; }
  return daysWithDefaults(stored);
}

async function writeDays(body) {
  const clean = validateDays(body, await readDays());
  const { AppSetting } = require('../models');
  const value = JSON.stringify(clean);
  const existing = await AppSetting.findOne({ where: { key: DAYS_KEY } });
  if (existing) await existing.update({ value });
  else await AppSetting.create({ key: DAYS_KEY, value });
  return clean;
}
const SHOWN = 200; // per list; the bell pages through them, and the count says how many in all
const ON_VESSEL = 'Complete';

// Pakistan's day, as the thresholds are counted (the servers run in UTC).
const PK_TODAY = "(now() AT TIME ZONE 'Asia/Karachi')::date";
const pkDayOf = (col) => `(${col} AT TIME ZONE 'Asia/Karachi')::date`;

const INVOICE_READERS = ['invoices', 'payments', 'jobInvoices', 'jobCharges', ...LINKING_REPORTS].map((m) => `${m}:view`);

/** May this user see records of a module? As the route table would let them. */
async function canSee(req, grants, alternatives) {
  if (req.user?.system === true || grants.all) return true;
  if (alternatives.some((a) => grants.perms.has(a))) return true;
  const { getMode } = require('./permissions/middleware');
  return (await getMode()) !== 'enforce';
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

async function overdueInvoices(sequelize, days) {
  const owed = SQL_OUTSTANDING_AMOUNT.replace(/"Invoice"\./g, 'i.');
  const [rows] = await sequelize.query(`
    SELECT i.id, i."invoice_No", i."party_Name", i."payType", i.type, i.currency, i."companyId", i."createdAt",
           (${owed}) AS owed, ${PK_TODAY} - ${pkDayOf('i."createdAt"')} AS days
    FROM "Invoices" i
    WHERE i.approved = '1' AND i."climaxId" IS NULL
      AND (${owed}) > 0.01
      AND ${PK_TODAY} - ${pkDayOf('i."createdAt"')} > ${Number(days.due)}
    ORDER BY i."createdAt" ASC, i.id ASC`);
  return rows.map((r) => ({ ...r, days: Number(r.days), owed: Math.round(Number(r.owed) * 100) / 100 }));
}

async function freightJobsWithoutCharges(sequelize, days) {
  const [rows] = await sequelize.query(`
    SELECT j.id, j."jobNo", j.operation, j."companyId", j."createdAt", cl.name AS party,
           ${PK_TODAY} - ${pkDayOf('j."createdAt"')} AS days
    FROM "SE_Jobs" j
    LEFT JOIN "Clients" cl ON cl.id = j."ClientId"
    WHERE j."climaxId" IS NULL AND coalesce(j.canceled, false) = false
      AND ${PK_TODAY} - ${pkDayOf('j."createdAt"')} > ${Number(days.noCharges)}
      AND NOT EXISTS (SELECT 1 FROM "Charge_Heads" c WHERE c."SEJobId" = j.id)
    ORDER BY j."createdAt" ASC, j.id ASC`);
  return rows.map((r) => ({ ...r, days: Number(r.days) }));
}

async function customsJobsWithoutCharges(sequelize, days) {
  const [rows] = await sequelize.query(`
    SELECT x.*, ${PK_TODAY} - ${pkDayOf('x."createdAt"')} AS days,
           CASE WHEN x."onVesselSince" IS NULL THEN NULL ELSE ${PK_TODAY} - ${pkDayOf('x."onVesselSince"')} END AS "onVesselDays"
    FROM (
      SELECT j.id, j."jobNo", j.status, j."companyId", j."createdAt", cl.name AS party,
             CASE WHEN j.status = :onVessel THEN coalesce(
               (SELECT max(s."changedOn") FROM "Customs_Job_Statuses" s
                WHERE s."CustomsJobId" = j.id AND s.status = :onVessel), j."createdAt") END AS "onVesselSince"
      FROM "Customs_Jobs" j
      LEFT JOIN "Clients" cl ON cl.id = j."clientId"
      WHERE j."climaxId" IS NULL AND coalesce(j.canceled, false) = false AND coalesce(j.status, '') <> 'Canceled'
        AND NOT EXISTS (SELECT 1 FROM "Charge_Heads" c WHERE c."CustomsJobId" = j.id)
        AND (${PK_TODAY} - ${pkDayOf('j."createdAt"')} > ${Number(days.noCharges)} OR j.status = :onVessel)
    ) x
    ORDER BY x."createdAt" ASC, x.id ASC`, { replacements: { onVessel: ON_VESSEL } });
  return rows.map((r) => ({
    ...r, days: Number(r.days), onVesselDays: r.onVesselDays === null ? null : Number(r.onVesselDays),
  }));
}

async function customsJobsNotFinished(sequelize, finished, days) {
  const [rows] = await sequelize.query(`
    SELECT j.id, j."jobNo", j.status, j."companyId", j."createdAt", cl.name AS party,
           ${PK_TODAY} - ${pkDayOf('j."createdAt"')} AS days
    FROM "Customs_Jobs" j
    LEFT JOIN "Clients" cl ON cl.id = j."clientId"
    WHERE j."climaxId" IS NULL AND coalesce(j.canceled, false) = false
      AND coalesce(j.status, '') NOT IN (:finished)
      AND ${PK_TODAY} - ${pkDayOf('j."createdAt"')} >= ${Number(days.unfinished)}
    ORDER BY j."createdAt" ASC, j.id ASC`, { replacements: { finished } });
  return rows.map((r) => ({ ...r, days: Number(r.days) }));
}

const inCompanies = (companies) => (r) => !companies || companies.has(String(r.companyId));
const list = (items) => ({ count: items.length, items: items.slice(0, SHOWN) });

/** The four lists for this request's user. */
async function alertsFor(req) {
  const db = require('../models');
  const { grantsFor } = require('./permissions/grants');
  const system = req.user?.system === true;
  const grants = system ? { all: true, perms: new Set(), companies: null } : await grantsFor(req.user.id);
  const mine = inCompanies(system ? null : (req.allowedCompanies || null));
  // The lists this designation is ticked for; the rest are not worked out.
  const lists = system ? [...access.ROW_KEYS] : access.rowsFor(grants.designation, await access.readGrid());
  const wants = (...keys) => keys.some((k) => lists.includes(k));
  const days = await readDays();

  const critical = [];
  const jobCharges = [];
  const invoicesDue = [];
  const jobStatus = [];

  if (wants('critical', 'invoicesDue') && await canSee(req, grants, INVOICE_READERS)) {
    for (const r of (await overdueInvoices(db.sequelize, days)).filter(mine)) {
      const late = r.days > days.critical;
      (late ? critical : invoicesDue).push({
        kind: 'invoice', id: r.id, invoiceNo: r.invoice_No, party: r.party_Name || '',
        payType: r.payType, type: r.type, currency: r.currency || 'PKR', owed: r.owed, days: r.days,
        since: iso(r.createdAt), dueDays: late ? days.critical : days.due,
        reason: late ? 'Not settled' : 'Invoice due',
      });
    }
  }

  const freightViews = Object.values(OPERATION_MODULE).map((m) => `${m}:view`);
  if (wants('jobCharges') && await canSee(req, grants, freightViews)) {
    for (const r of (await freightJobsWithoutCharges(db.sequelize, days)).filter(mine)) {
      const module = OPERATION_MODULE[String(r.operation || '').toUpperCase()];
      if (module && !(await canSee(req, grants, [`${module}:view`]))) continue;
      jobCharges.push({
        kind: 'freightJob', id: r.id, jobNo: r.jobNo, operation: r.operation, party: r.party || '', days: r.days,
        since: iso(r.createdAt), dueDays: days.noCharges, reason: 'No charges',
      });
    }
  }

  if (wants('critical', 'jobCharges') && await canSee(req, grants, ['customs:view'])) {
    for (const r of (await customsJobsWithoutCharges(db.sequelize, days)).filter(mine)) {
      const item = { kind: 'customsJob', id: r.id, jobNo: r.jobNo, party: r.party || '', days: r.days };
      if (r.onVesselDays !== null && r.onVesselDays > days.onVessel) {
        critical.push({
          ...item, onVesselDays: r.onVesselDays,
          since: iso(r.onVesselSince), dueDays: days.onVessel, reason: 'No charges, On Vessel',
        });
      } else if (r.days > days.noCharges) {
        jobCharges.push({ ...item, since: iso(r.createdAt), dueDays: days.noCharges, reason: 'No charges' });
      }
    }
  }

  if (wants('jobStatus') && await canSee(req, grants, ['customs:view'])) {
    const { readCustomsStatuses } = require('../routes/settings');
    const { valuesWith, labelOf } = require('./customsStatuses');
    const statuses = (await readCustomsStatuses()).job;
    const finished = [...new Set([...valuesWith(statuses, 'finished'), ON_VESSEL, 'Canceled'])];
    for (const r of (await customsJobsNotFinished(db.sequelize, finished, days)).filter(mine)) {
      jobStatus.push({
        kind: 'customsJob', id: r.id, jobNo: r.jobNo, party: r.party || '', days: r.days,
        status: labelOf(statuses, r.status) || 'No status',
        since: iso(r.createdAt), dueDays: days.unfinished, reason: 'Not On Vessel',
      });
    }
  }

  // Longest overdue first in each list.
  const overdue = (x) => (x.since ? Date.now() - new Date(x.since).getTime() : 0) - x.dueDays * 86400000;
  for (const l of [critical, jobCharges, invoicesDue, jobStatus]) l.sort((a, b) => overdue(b) - overdue(a));
  const all = { critical, jobCharges, invoicesDue, jobStatus };
  // Only the lists this user is shown - `lists` says which, in order.
  const out = { lists };
  for (const k of lists) out[k] = list(all[k]);
  // What the bell's header counts: distinct jobs and invoices across the
  // lists shown, in full - not just the ones sent (each list stops at SHOWN).
  const jobs = new Set();
  const invoices = new Set();
  for (const k of lists) {
    for (const a of all[k]) (a.kind === 'invoice' ? invoices : jobs).add(`${a.kind}-${a.id}`);
  }
  out.totals = { jobs: jobs.size, invoices: invoices.size };
  return out;
}

module.exports = {
  DAYS, DAY_FIELDS, MAX_DAYS, DaysError, SHOWN, ON_VESSEL, LISTS, access,
  daysWithDefaults, validateDays, readDays, writeDays, alertsFor,
};

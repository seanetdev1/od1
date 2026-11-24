/* NEW JOB ALERTS - "New job created: TP-123/27 by Admin", to the designations
 * picked in Configuration > New Job Alerts. The user's request, 2026-11-23: a
 * minute timer that checks whether any new jobs have been created and tells
 * the user, with the designations that get it chosen.
 *
 * How it works: each open screen asks GET /notifications/newJobs once a
 * minute, sending where it got to last time - the highest job id it has seen,
 * per kind of job. The server answers with the jobs made since, and where to
 * start next time. The first ask (no cursor) only sets the starting point, so
 * signing in does not replay the day's jobs.
 *
 * Nobody gets it until designations are picked (the user: "we select which
 * designation gets this notification").
 *
 * My calls:
 *  - Every kind of job the install has: freight (SE_Jobs, all four
 *    operations), customs and aviation. An install only has one in use.
 *  - Not your own: whoever made the job knows already. Matched by name -
 *    createdBy holds the name (functions/auditStamps).
 *  - Not migrated jobs (a climaxId): an import is not someone opening a job.
 *  - Only jobs in companies the user may work in (Employee_Company); none
 *    set = all, as everywhere else.
 *  - The designation as stored now (the grants cache, 30 s), not as the
 *    session token was signed with.
 */
const appSetting = () => require('../models').AppSetting;
const { DESIGNATIONS } = require('./creditControl/settings');

const KEY = 'newJobAlerts';
const DEFAULTS = Object.freeze({ designations: [] });

// The job tables, by the name the cursor carries.
const KINDS = Object.freeze([
  { kind: 'freight', model: 'SE_Job' },
  { kind: 'customs', model: 'Customs_Job' },
  { kind: 'aviation', model: 'Aviation_Job' },
]);
// At most this many jobs of a kind per ask; the rest come the next minute.
const BATCH = 50;

class SettingsError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

const norm = (d) => String(d ?? '').trim().toLowerCase();
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** What is stored, over the defaults: known designations, in list order. */
function withDefaults(stored) {
  const picked = isObject(stored) && Array.isArray(stored.designations) ? stored.designations.map(norm) : [];
  return { designations: DESIGNATIONS.filter((d) => picked.includes(d)) };
}

function validate(body) {
  if (!isObject(body) || !Array.isArray(body.designations)) {
    throw new SettingsError('Send { designations: [...] }.');
  }
  const unknown = body.designations.map(norm).filter((d) => !DESIGNATIONS.includes(d));
  if (unknown.length) throw new SettingsError(`Unknown designation: ${[...new Set(unknown)].join(', ')}.`);
  return withDefaults(body);
}

async function readSetting() {
  const row = await appSetting().findOne({ where: { key: KEY } });
  let stored = null;
  try { stored = row?.value ? JSON.parse(row.value) : null; } catch (_) { stored = null; }
  return withDefaults(stored);
}

async function writeSetting(body) {
  const clean = validate(body);
  const value = JSON.stringify(clean);
  const existing = await appSetting().findOne({ where: { key: KEY } });
  if (existing) await existing.update({ value });
  else await appSetting().create({ key: KEY, value });
  return clean;
}

const subscribed = (designation, setting) => {
  const d = norm(designation);
  return Boolean(d) && setting.designations.includes(d);
};

/** A cursor from the query string: a whole number per kind, or null for none sent. */
function readCursor(query = {}) {
  const out = {};
  let any = false;
  for (const { kind } of KINDS) {
    const n = Number(query[kind]);
    if (query[kind] !== undefined && Number.isInteger(n) && n >= 0) { out[kind] = n; any = true; }
  }
  return any ? out : null;
}

/** Which of the new rows to tell this user about. No database. */
function worthTelling(rows, { companies, me }) {
  const self = norm(me);
  return rows.filter((r) => r.climaxId === null || r.climaxId === undefined)
    .filter((r) => !companies || companies.has(String(r.companyId)))
    .filter((r) => !self || norm(r.createdBy) !== self);
}

/** The highest id of each kind - where a first ask starts. */
async function startingPoint(db) {
  const out = {};
  for (const { kind, model } of KINDS) out[kind] = Number(await db[model].max('id')) || 0;
  return out;
}

/** Jobs made since `cursor`, and where to start next time. */
async function jobsSince(db, cursor, { companies, me }) {
  const { Op } = db.Sequelize;
  const next = { ...cursor };
  const jobs = [];
  for (const { kind, model } of KINDS) {
    const from = cursor[kind];
    // A kind the screen did not send (it predates this kind) starts now.
    if (from === undefined) { next[kind] = Number(await db[model].max('id')) || 0; continue; }
    // Aviation jobs were never migrated, and have no climaxId.
    const migratable = Boolean(db[model].rawAttributes.climaxId);
    const rows = await db[model].findAll({
      where: { id: { [Op.gt]: from } },
      attributes: ['id', 'jobNo', 'createdBy', 'companyId', ...(migratable ? ['climaxId'] : [])],
      order: [['id', 'ASC']],
      limit: BATCH,
      raw: true,
    });
    if (rows.length) next[kind] = rows[rows.length - 1].id;
    for (const r of worthTelling(rows, { companies, me })) {
      jobs.push({ kind, id: r.id, jobNo: r.jobNo || '', createdBy: r.createdBy || '' });
    }
  }
  return { cursor: next, jobs };
}

module.exports = {
  KEY, DEFAULTS, KINDS, DESIGNATIONS, BATCH, SettingsError,
  withDefaults, validate, readSetting, writeSetting, subscribed, readCursor,
  worthTelling, startingPoint, jobsSince,
};

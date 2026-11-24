/**
 * Jobs - the rewritten migration stage. JOB RECORDS ONLY.
 *
 * SCOPE, deliberately narrow: this imports job rows and nothing else. The old
 * importJobs sent a deeply nested payload and the receiver walked it to create
 * the job plus its B/Ls, containers, stamps and charge lines in one pass -
 * which is exactly why a failure anywhere in that tree was indistinguishable
 * from a failure anywhere else, and why the stage could not say what had
 * landed. B/Ls, equipment and charge lines get their own stages.
 *
 * Until those stages exist, migrated jobs have no B/Ls and no charge lines.
 * That is the intended state, not a gap to be patched here.
 *
 * WHAT ELSE CHANGES
 *
 *   the fetch      importJobs pulled /getAll0, /getAll and /getAll1 - about 40
 *                  tables, including Gen_UNLocation (108,182 rows), the whole
 *                  chart of accounts, every party, voucher and invoice -
 *                  because it built foreign keys on the client. This resolves
 *                  them on the Odyssey side by legacy id instead, so it needs
 *                  /jobs/getJobRecords: four job tables and five small lookups.
 *
 *   a crash        The receiver reads `vessel.id` with no guard, on a lookup
 *                  that can miss. A sea job whose vessel does not resolve threw
 *                  a TypeError and took the rest of its batch down with it -
 *                  ten jobs at a time. Same shape of bug on
 *                  job.JobNumber.split() for a job with no number.
 *
 *   null links     A job whose client or company did not resolve was inserted
 *                  anyway, and a row count cannot see the difference. Every job
 *                  list is scoped by company, so a job with no companyId is
 *                  present in every count and invisible on every screen. That
 *                  is now reported before and after.
 *
 * The existing importJobs in steps.js and the /seaJob/Upload*Jobs receivers are
 * untouched.
 */

import axiosClient from 'apis/axiosClient';
import { buildJobLookups, attachResolved, countUnresolved } from './jobShape';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

// Matches the server's MAX_BATCH. Jobs are 66-column rows, so these are
// smaller than the location stage's batches.
const BATCH = 500;

/** Legacy table -> Odyssey `operation`. All four land in one table. */
const SOURCES = [
  ['SeaExportJob', 'SE'],
  ['SeaImportJob', 'SI'],
  ['AirExportJob', 'AE'],
  ['AirImportJob', 'AI'],
];

async function fetchJobRecords() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getJobRecords`);
    if (!data || !SOURCES.some(([t]) => Array.isArray(data[t]))) {
      throw new Error(
        `${LEGACY_API}/jobs/getJobRecords responded but carried no job tables. `
        + `Got: ${Object.keys(data || {}).join(', ') || '(nothing)'}`
      );
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getJobRecords does not exist on this legacy server. It was added for `
        + 'this stage - restart the legacy server to pick it up.'
      );
    }
    if (!err?.response) {
      throw new Error(
        `Could not reach the legacy server at ${LEGACY_API}. Check it is running and that `
        + 'NEXT_PUBLIC_CLIMAX_LEGACY_URL points at it.'
      );
    }
    throw err;
  }
}

function addUp(target, r) {
  target.created += r.created || 0;
  target.alreadyImported += r.stats?.alreadyImported || 0;
  target.missingJobNo += r.stats?.missingJobNo || 0;
  for (const [k, v] of Object.entries(r.unresolved || {})) {
    target.unresolved[k] = (target.unresolved[k] || 0) + v;
  }
  return target;
}

async function sendOperation(operation, jobs, ctx) {
  const { report, onProgress, total, doneBefore, apply } = ctx;
  const totals = { created: 0, alreadyImported: 0, missingJobNo: 0, unresolved: {} };

  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);

    // Only the jobs. The legacy lookups were resolved once, before this loop -
    // sending them per batch meant 259 MB of identical data across a run.
    const { data } = await axiosClient.post(
      apply ? '/jobMigration/apply' : '/jobMigration/plan',
      { operation, jobs: batch },
    );
    addUp(totals, data.result);

    const done = doneBefore + Math.min(i + BATCH, jobs.length);
    const pct = total ? Math.round((done / total) * 100) : 100;
    onProgress?.({ operation, done, total, percent: pct });
    report(
      `Jobs ${operation}: ${Math.min(i + BATCH, jobs.length).toLocaleString()} of `
      + `${jobs.length.toLocaleString()} (${pct}% of stage)`
    );
  }

  return totals;
}

export async function migrateJobs(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report('Jobs: fetching job records from the legacy system...');
  const data = await fetchJobRecords();

  // Resolved once for the whole run, not per batch.
  const lookups = buildJobLookups(data);

  // Every one of the four job tables, always. Which ones actually have rows is
  // reported below, so an empty table is visible rather than assumed.
  const present = SOURCES.map(([table, operation]) => [
    operation,
    Array.isArray(data[table]) ? data[table] : [],
    table,
  ]);

  const empty = present.filter(([, jobs]) => !jobs.length);
  if (empty.length) {
    report(
      `Jobs: no rows in ${empty.map(([op, , table]) => `${table} (${op})`).join(', ')} - `
      + 'nothing to import for those.'
    );
  }

  const batches = present
    .filter(([, jobs]) => jobs.length)
    .map(([operation, jobs]) => [operation, attachResolved(jobs, lookups, operation)]);

  const total = batches.reduce((n, [, jobs]) => n + jobs.length, 0);

  if (!total) {
    report('Jobs: the legacy export contains no jobs.');
    return { planned: null, applied: null, verification: null, noop: true, reason: 'No jobs in the source.' };
  }

  report(
    `Jobs: ${total.toLocaleString()} to ${apply ? 'import' : 'check'} - `
    + batches.map(([op, jobs]) => `${op} ${jobs.length.toLocaleString()}`).join(', ')
    + '. Job records only: no B/Ls, equipment or charge lines.'
  );

  const applied = {};
  let doneBefore = 0;

  for (const [operation, jobs] of batches) {
    applied[operation] = await sendOperation(operation, jobs, {
      report, onProgress, total, doneBefore, apply,
    });

    // Lookups that missed on the client, which the server cannot see: a job
    // with an unresolved cost centre or terminal shows blank in those fields.
    const missed = countUnresolved(jobs, operation);
    const missedList = Object.entries(missed).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
    if (missedList.length) {
      report(`Jobs ${operation}: legacy lookups that did not resolve - ${missedList.join(', ')}.`);
    }
    doneBefore += jobs.length;

    const a = applied[operation];
    report(
      `Jobs ${operation}: ${apply ? 'created' : 'would create'} ${a.created.toLocaleString()}, `
      + `${a.alreadyImported.toLocaleString()} already imported`
      + (a.missingJobNo ? `, ${a.missingJobNo} skipped with no job number` : '') + '.'
    );

    // Said per operation, because which lookup table is short differs between
    // sea and air and the totals would hide that.
    const u = a.unresolved || {};
    if (u.company) {
      report(
        `Jobs ${operation}: WARNING - ${u.company} job(s) could not resolve a company. Every job `
        + 'list is scoped by company, so those jobs will not appear on any screen. Check the '
        + 'Companies stage ran first.'
      );
    }
    const others = ['client', 'commodity', 'vessel', 'voyage', 'salesRep', 'overseasAgent',
      'shippingLine', 'consignee', 'shipper', 'airLine']
      .filter((k) => u[k])
      .map((k) => `${u[k]} ${k}`);
    if (others.length) {
      report(`Jobs ${operation}: unresolved links - ${others.join(', ')}.`);
    }
  }

  if (!apply) {
    report('Jobs: dry run - nothing was written.');
    return { planned: applied, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  report('Jobs: verifying...');
  const verifyRes = await axiosClient.get('/jobMigration/verify');
  const v = verifyRes.data.result;

  report(
    `Jobs: ${v.jobs.toLocaleString()} in the system - `
    + Object.entries(v.byOperation).map(([op, n]) => `${op} ${n.toLocaleString()}`).join(', ')
    + `. ${v.migrated.toLocaleString()} migrated, ${v.handCreated.toLocaleString()} created by hand.`
  );

  if (v.withoutCompany) {
    report(
      `Jobs: WARNING - ${v.withoutCompany} job(s) have no company and are invisible on every job `
      + `list. Sample: ${(v.withoutCompanySample || []).slice(0, 10).join(', ')}`
    );
  }
  if (v.duplicateClimaxIdCount) {
    report(
      `Jobs: WARNING - ${v.duplicateClimaxIdCount} legacy job id(s) imported more than once under `
      + `the same operation. Sample: ${(v.duplicateClimaxIds || []).slice(0, 10).join(', ')}`
    );
  }
  if (v.withoutJobNo) {
    report(`Jobs: WARNING - ${v.withoutJobNo} job(s) have no job number and cannot be searched.`);
  }

  const created = Object.values(applied).reduce((n, a) => n + a.created, 0);

  return {
    planned: applied,
    applied,
    verification: v,
    noop: created === 0,
    reason: created === 0 ? 'Every job was already imported.' : null,
  };
}

/** Plan only - writes nothing. */
export const planJobsOnly = (report, options = {}) =>
  migrateJobs(report, { ...options, apply: false });

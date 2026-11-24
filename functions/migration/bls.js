/**
 * B/Ls & Air Waybills - the rewritten migration stage. B/L RECORDS ONLY.
 *
 * SCOPE: B/L rows and nothing else. Containers, item details, stamps and
 * dimensions all hang off a B/L and get their own stages, exactly as the Jobs
 * stage imports jobs and not their B/Ls. The old /seaJob/Upload*Jobs receivers
 * still create the whole tree from a nested job payload, and are untouched.
 *
 * DEPENDS ON JOBS: a B/L is attached to its Odyssey job through that job's
 * legacy id, so the Jobs stage has to have run. A B/L whose job is missing is
 * skipped and reported rather than imported detached - every B/L screen opens
 * from its job, so a detached B/L is unreachable.
 *
 * What the old import lost, and this keeps:
 *
 *   place & date    It wrote IssuePlace and IssueDate with a capital I, while
 *   of issue        the model declares issuePlace and issueDate. Sequelize
 *                   silently drops attributes it does not know, so both have
 *                   never been migrated - on any B/L, on any of the four
 *                   operations - and both print on the document. No error was
 *                   ever raised, which is why it survived this long.
 *
 *   one bad row     bl.SExp_BL_Detail.X was read with no guard, so a sea B/L
 *                   with no detail row threw inside its job's transaction and
 *                   took the job and the rest of its batch with it.
 *
 *   repairability   The B/L was created as a side effect of importing its job,
 *                   so fixing a B/L meant re-importing the job. This stage can
 *                   be re-run on its own.
 *
 * Sea B/Ls keep their printable detail in a separate legacy table; air
 * waybills carry the same fields inline. Both are joined server-side.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

// B/Ls carry several TEXT columns, so batches are smaller than the jobs stage's.
const BATCH = 250;

/**
 * operation -> where its rows live in the legacy payload.
 *
 * `detail` is the sea detail table; air waybills carry their detail inline, so
 * they have none. `jobFields` is the projected job columns a B/L reads.
 */
const SOURCES = [
  { operation: 'SE', bls: 'SeaExportBL', details: 'SeaExportBLDetail', jobFields: 'SeaExportJobFields' },
  { operation: 'SI', bls: 'SeaImportBL', details: 'SeaImportBLDetail', jobFields: 'SeaImportJobFields' },
  { operation: 'AE', bls: 'AirExportBL', details: null, jobFields: 'AirExportJobFields' },
  { operation: 'AI', bls: 'AirImportBL', details: null, jobFields: 'AirImportJobFields' },
];

async function fetchBlRecords() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getBlRecords`);
    if (!data || !SOURCES.some((s) => Array.isArray(data[s.bls]))) {
      throw new Error(
        `${LEGACY_API}/jobs/getBlRecords responded but carried no B/L tables. `
        + `Got: ${Object.keys(data || {}).join(', ') || '(nothing)'}`
      );
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getBlRecords does not exist on this legacy server. It was added for `
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

/**
 * Only the detail rows this batch needs.
 *
 * The sea detail tables are one row per B/L, so sending all of them with every
 * batch would repeat the whole table ~N times - the mistake the jobs stage
 * made with its lookups.
 */
function detailsForBatch(operation, batch, allDetails) {
  if (!allDetails?.length) return [];
  const key = operation === 'SE' ? 'SEBLId' : 'SIBLId';
  const wanted = new Set(batch.map((b) => String(b?.Id)));
  return allDetails.filter((d) => d && wanted.has(String(d[key])));
}

/** Only the job rows this batch's B/Ls point at. */
function jobFieldsForBatch(operation, batch, allJobFields) {
  if (!allJobFields?.length) return [];
  const jobKey = { SE: 'SEJobId', SI: 'SIJobId', AE: 'AEJobId', AI: 'AIJobId' }[operation];
  const wanted = new Set(batch.map((b) => String(b?.[jobKey])));
  return allJobFields.filter((j) => j && wanted.has(String(j.Id)));
}

function addUp(target, r) {
  target.created += r.created || 0;
  target.alreadyImported += r.stats?.alreadyImported || 0;
  target.orphaned += r.stats?.orphaned || 0;
  target.missingHbl += r.stats?.missingHbl || 0;
  target.missingDetail += r.stats?.missingDetail || 0;
  target.withIssuePlace += r.stats?.withIssuePlace || 0;
  return target;
}

async function sendOperation(source, data, ctx) {
  const { report, onProgress, total, doneBefore, apply } = ctx;
  const { operation } = source;
  const bls = data[source.bls] || [];
  const allDetails = source.details ? (data[source.details] || []) : [];
  const allJobFields = data[source.jobFields] || [];

  const totals = {
    created: 0, alreadyImported: 0, orphaned: 0,
    missingHbl: 0, missingDetail: 0, withIssuePlace: 0,
  };

  for (let i = 0; i < bls.length; i += BATCH) {
    const batch = bls.slice(i, i + BATCH);

    const { data: res } = await axiosClient.post(
      apply ? '/blMigration/apply' : '/blMigration/plan',
      {
        operation,
        bls: batch,
        // Sliced to the batch, not the whole table.
        details: detailsForBatch(operation, batch, allDetails),
        jobFields: jobFieldsForBatch(operation, batch, allJobFields),
      },
    );
    addUp(totals, res.result);

    const done = doneBefore + Math.min(i + BATCH, bls.length);
    const pct = total ? Math.round((done / total) * 100) : 100;
    onProgress?.({ operation, done, total, percent: pct });
    report(
      `B/Ls ${operation}: ${Math.min(i + BATCH, bls.length).toLocaleString()} of `
      + `${bls.length.toLocaleString()} (${pct}% of stage)`
    );
  }

  return totals;
}

export async function migrateBls(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report('B/Ls & Air Waybills: fetching from the legacy system...');
  const data = await fetchBlRecords();

  const present = SOURCES.map((s) => ({ ...s, rows: Array.isArray(data[s.bls]) ? data[s.bls] : [] }));

  const empty = present.filter((s) => !s.rows.length);
  if (empty.length) {
    report(
      `B/Ls: no rows in ${empty.map((s) => `${s.bls} (${s.operation})`).join(', ')} - `
      + 'nothing to import for those.'
    );
  }

  const active = present.filter((s) => s.rows.length);
  const total = active.reduce((n, s) => n + s.rows.length, 0);

  if (!total) {
    report('B/Ls: the legacy export contains no B/Ls.');
    return { planned: null, applied: null, verification: null, noop: true, reason: 'No B/Ls in the source.' };
  }

  report(
    `B/Ls: ${total.toLocaleString()} to ${apply ? 'import' : 'check'} - `
    + active.map((s) => `${s.operation} ${s.rows.length.toLocaleString()}`).join(', ')
    + '. B/L records only: no containers, stamps or dimensions.'
  );

  const applied = {};
  let doneBefore = 0;

  for (const source of active) {
    applied[source.operation] = await sendOperation(source, data, {
      report, onProgress, total, doneBefore, apply,
    });
    doneBefore += source.rows.length;

    const a = applied[source.operation];
    report(
      `B/Ls ${source.operation}: ${apply ? 'created' : 'would create'} ${a.created.toLocaleString()}, `
      + `${a.alreadyImported.toLocaleString()} already imported.`
    );

    // Skipped, not imported detached - a B/L with no job cannot be opened.
    if (a.orphaned) {
      report(
        `B/Ls ${source.operation}: WARNING - ${a.orphaned.toLocaleString()} B/L(s) belong to a job `
        + 'that is not in Odyssey and were skipped. Every B/L opens from its job. Check the Jobs '
        + 'stage ran for this operation first.'
      );
    }
    if (a.missingDetail) {
      report(
        `B/Ls ${source.operation}: ${a.missingDetail} B/L(s) have no detail row, so they import `
        + 'with no printable content. The old import threw on these instead.'
      );
    }
    if (a.missingHbl) {
      report(`B/Ls ${source.operation}: ${a.missingHbl} B/L(s) have no B/L number.`);
    }
    if (a.withIssuePlace) {
      report(
        `B/Ls ${source.operation}: ${a.withIssuePlace.toLocaleString()} B/L(s) carry a place of `
        + 'issue that the old import silently dropped.'
      );
    }
  }

  if (!apply) {
    report('B/Ls: dry run - nothing was written.');
    return { planned: applied, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  // The MAWBs typed on air B/Ls go into the AWB stock as used, so the register
  // starts out knowing every number already flown. After ALL batches, not per
  // batch: a number on two jobs is registered to neither, and only the whole
  // table shows that. Re-running only adds what is missing.
  let mawbs = null;
  if (active.some((s) => s.operation === 'AE' || s.operation === 'AI')) {
    report('B/Ls: registering air waybill numbers in the AWB stock...');
    const { data: reg } = await axiosClient.post('/blMigration/registerMawbs', {});
    mawbs = reg.result;
    const c = mawbs.counts;
    report(
      `B/Ls: AWB stock - ${c.registered.toLocaleString()} registered, `
      + `${c.claimed.toLocaleString()} matched to stock already held, `
      + `${c.already.toLocaleString()} already registered.`
    );
    const problems = [
      [c.duplicate, 'on more than one job (registered to neither)'],
      [c.wrongCheckDigit, 'with a wrong check digit'],
      [c.invalidFormat, 'not 11 digits'],
      [c.noAirline, 'on a job with no airline'],
      [c.airlineMismatch, 'in stock under a different airline'],
      [c.takenByOtherJob, 'already used by another job'],
    ].filter(([n]) => n);
    if (problems.length) {
      report(
        'B/Ls: NOT registered - '
        + problems.map(([n, why]) => `${n.toLocaleString()} ${why}`).join(', ')
        + '. Those B/Ls still open and save; the MAWB has to be corrected before it can be '
        + 'changed. node scripts/backfillAwbl.js on the server writes the full list for operations.'
      );
    }
  }

  report('B/Ls: verifying...');
  const verifyRes = await axiosClient.get('/blMigration/verify');
  const v = verifyRes.data.result;

  report(
    `B/Ls: ${v.bls.toLocaleString()} in the system - `
    + Object.entries(v.byOperation).map(([op, n]) => `${op} ${n.toLocaleString()}`).join(', ')
    + `. ${v.migrated.toLocaleString()} migrated, ${v.handCreated.toLocaleString()} created by hand.`
  );

  if (v.withoutJob) {
    report(
      `B/Ls: WARNING - ${v.withoutJob} B/L(s) point at no job and cannot be opened from anywhere. `
      + `Sample: ${(v.withoutJobSample || []).slice(0, 10).join(', ')}`
    );
  }
  if (v.duplicateClimaxIdCount) {
    report(
      `B/Ls: WARNING - ${v.duplicateClimaxIdCount} legacy B/L id(s) imported more than once under `
      + 'the same operation.'
    );
  }
  if (v.jobsWithMultipleBls) {
    report(
      `B/Ls: ${v.jobsWithMultipleBls} job(s) have more than one B/L. The legacy tables treat that `
      + 'as impossible, and the job screen will show only one of them.'
    );
  }
  if (v.withoutParties) {
    report(
      `B/Ls: ${v.withoutParties} B/L(s) have neither a shipper nor a consignee and will print `
      + 'blank.'
    );
  }

  const created = Object.values(applied).reduce((n, a) => n + a.created, 0);

  return {
    planned: applied,
    applied,
    mawbs,
    verification: v,
    noop: created === 0,
    reason: created === 0 ? 'Every B/L was already imported.' : null,
  };
}

export const planBlsOnly = (report, options = {}) =>
  migrateBls(report, { ...options, apply: false });

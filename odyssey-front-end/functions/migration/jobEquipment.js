/**
 * Job equipment - what a job booked, as opposed to what a B/L carried.
 *
 * NOT the same as the containers on a B/L. Those come from SExp_BL_Equipment
 * and land in Container_Info (the B/L children stage); these come from
 * SExp_SeaExportJob_Equipment and land in SE_Equipments. The legacy table
 * names are nearly identical, so the distinction is worth stating: a job says
 * "two 40HC", a B/L says "container MSKU1234567, seal 998".
 *
 * Sea only - air jobs have no equipment at all.
 *
 * What the old import lost, and this keeps:
 *
 *   the real weight  It read the size type's catalogue PerUnitWeight while the
 *                    equipment row carries its own, so a job whose containers
 *                    were actually weighed got the catalogue figure instead.
 *   one bad row      That lookup was unguarded, so an equipment row with a
 *                    size code missing from the catalogue threw inside the
 *                    job's transaction and took the job and the rest of its
 *                    batch with it - the same shape as `vessel.id` in the jobs
 *                    receiver.
 *   legacy ids       climaxId was never set, so equipment could not be
 *                    verified or re-run.
 *   repairability    Equipment was created as a side effect of importing its
 *                    job, so fixing it meant re-importing the job.
 *
 * DEPENDS ON THE JOBS STAGE - equipment attaches through SE_Job.climaxId.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

const BATCH = 2000;

const SOURCES = [
  { operation: 'SE', table: 'SeaExportEquipment' },
  { operation: 'SI', table: 'SeaImportEquipment' },
];

async function fetchJobEquipment() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getJobChildRecords`);
    if (!data || !SOURCES.some((s) => Array.isArray(data[s.table]))) {
      throw new Error(
        `${LEGACY_API}/jobs/getJobChildRecords responded but carried no equipment tables. `
        + `Got: ${Object.keys(data || {}).join(', ') || '(nothing)'}`
      );
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getJobChildRecords does not exist on this legacy server. It was added `
        + 'for this stage - restart the legacy server to pick it up.'
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
  target.orphaned += r.stats?.orphaned || 0;
  target.skippedJobs += r.stats?.skippedJobs || 0;
  target.unknownSizeType += r.stats?.unknownSizeType || 0;
  return target;
}

async function sendOperation(source, data, ctx) {
  const { report, onProgress, total, doneBefore, apply } = ctx;
  const rows = data[source.table] || [];
  const sizeTypes = data.EquipmentSizeType || [];
  const totals = { created: 0, orphaned: 0, skippedJobs: 0, unknownSizeType: 0 };

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    const { data: res } = await axiosClient.post(
      apply ? '/jobEquipmentMigration/apply' : '/jobEquipmentMigration/plan',
      { operation: source.operation, rows: batch, sizeTypes },
    );
    addUp(totals, res.result);

    const done = doneBefore + Math.min(i + BATCH, rows.length);
    const pct = total ? Math.round((done / total) * 100) : 100;
    onProgress?.({ operation: source.operation, done, total, percent: pct });
    report(
      `Job equipment ${source.operation}: ${Math.min(i + BATCH, rows.length).toLocaleString()} `
      + `of ${rows.length.toLocaleString()} (${pct}% of stage)`
    );
  }

  return totals;
}

export async function migrateJobEquipment(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report('Job equipment: fetching from the legacy system...');
  const data = await fetchJobEquipment();

  const present = SOURCES.map((s) => ({
    ...s, rows: Array.isArray(data[s.table]) ? data[s.table] : [],
  }));

  const empty = present.filter((s) => !s.rows.length);
  if (empty.length) {
    report(
      `Job equipment: no rows in ${empty.map((s) => `${s.table} (${s.operation})`).join(', ')}.`
    );
  }

  const active = present.filter((s) => s.rows.length);
  const total = active.reduce((n, s) => n + s.rows.length, 0);

  if (!total) {
    report('Job equipment: the legacy export contains none.');
    return { planned: null, applied: null, verification: null, noop: true, reason: 'Nothing in the source.' };
  }

  report(
    `Job equipment: ${total.toLocaleString()} row(s) to ${apply ? 'import' : 'check'} - `
    + active.map((s) => `${s.operation} ${s.rows.length.toLocaleString()}`).join(', ')
    + '. This is what the job booked, not the containers on its B/L.'
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
      `Job equipment ${source.operation}: ${apply ? 'created' : 'would create'} `
      + `${a.created.toLocaleString()} row(s).`
      + (a.skippedJobs ? ` ${a.skippedJobs.toLocaleString()} job(s) already had equipment.` : '')
    );

    if (a.orphaned) {
      report(
        `Job equipment ${source.operation}: WARNING - ${a.orphaned.toLocaleString()} row(s) belong `
        + 'to a job that is not in Odyssey and were skipped. Check the Jobs stage ran for this '
        + 'operation.'
      );
    }
    if (a.unknownSizeType) {
      report(
        `Job equipment ${source.operation}: ${a.unknownSizeType} row(s) have a size code the `
        + 'catalogue does not explain, so they import with no TEU count. The old import threw on '
        + 'these instead.'
      );
    }
  }

  if (!apply) {
    report('Job equipment: dry run - nothing was written.');
    return { planned: applied, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  report('Job equipment: verifying...');
  const verifyRes = await axiosClient.get('/jobEquipmentMigration/verify');
  const v = verifyRes.data.result;

  report(
    `Job equipment: ${v.equipment.toLocaleString()} row(s) across `
    + `${v.jobsWithEquipment.toLocaleString()} of ${v.seaJobs.toLocaleString()} sea job(s).`
  );

  if (v.detached) {
    report(
      `Job equipment: WARNING - ${v.detached} row(s) point at no job. They belong to nothing and `
      + 'are invisible on every screen while still counting as imported.'
    );
  }
  if (v.duplicateClimaxIdCount) {
    report(
      `Job equipment: WARNING - ${v.duplicateClimaxIdCount} legacy id(s) imported more than once.`
    );
  }
  if (v.withoutTeu) {
    report(
      `Job equipment: ${v.withoutTeu.toLocaleString()} row(s) have no TEU count, which skews any `
      + 'TEU total the job list shows.'
    );
  }
  if (v.withoutClimaxId) {
    report(
      `Job equipment: ${v.withoutClimaxId.toLocaleString()} row(s) carry no legacy id - the old `
      + 'import never set one. Those cannot be matched on a re-run, only counted.'
    );
  }

  const created = Object.values(applied).reduce((n, a) => n + a.created, 0);

  return {
    planned: applied,
    applied,
    verification: v,
    noop: created === 0,
    reason: created === 0 ? 'Every job already had its equipment.' : null,
  };
}

export const planJobEquipmentOnly = (report, options = {}) =>
  migrateJobEquipment(report, { ...options, apply: false });

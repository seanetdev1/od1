/**
 * B/L children - containers, stamps, dimensions and air-waybill rate lines.
 *
 * These are the four things that hang off a B/L in Odyssey. The old import
 * created them as a side effect of importing a job, which meant a container
 * could never be fixed without re-importing its job.
 *
 * Not every kind exists for every operation:
 *
 *   containers   sea only    SExp_BL_Equipment, SImp_BL_Equipment
 *   stamps       SE/SI/AE    SExp_BL_Stamp, SImp_BL_Stamp, AExp_BL_Stamp
 *   dimensions   air only    AExp_BL_Dimension, AImp_AirImportJob_BLDimension
 *   items        air only    the waybill's four inline rate-line blocks
 *
 * What the old import lost, and this keeps:
 *
 *   tare weight    It computed GrossWt - NetWt while the source carries a real
 *                  TareWt column - and the subtraction yields NaN whenever
 *                  either weight is null.
 *   free days      detention, demurrage and plug-in were hardcoded to ''. The
 *                  source carries all three, and they are what a container is
 *                  billed against.
 *   form E date    `date` was set to the B/L's creation timestamp while the
 *                  column it sits beside holds the form E number.
 *   legacy ids     climaxId was never set on a container or a stamp, so
 *                  neither could be verified or re-run.
 *   dimensions     never imported at all - nothing in any receiver creates
 *                  them from a B/L.
 *
 * Air-import dimensions are keyed by job, not by B/L; they are resolved
 * through that job's waybill server-side.
 *
 * DEPENDS ON THE B/L STAGE - everything here attaches through Bl.climaxId.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

const BATCH = 2000;

/** kind + operation -> where its rows live in the legacy payload. */
const SOURCES = [
  { kind: 'containers', operation: 'SE', table: 'SeaExportEquipment' },
  { kind: 'containers', operation: 'SI', table: 'SeaImportEquipment' },
  { kind: 'stamps', operation: 'SE', table: 'SeaExportStamp' },
  { kind: 'stamps', operation: 'SI', table: 'SeaImportStamp' },
  { kind: 'stamps', operation: 'AE', table: 'AirExportStamp' },
  { kind: 'dimensions', operation: 'AE', table: 'AirExportDimension' },
  { kind: 'dimensions', operation: 'AI', table: 'AirImportDimension' },
  { kind: 'items', operation: 'AE', table: 'AirExportItems' },
  { kind: 'items', operation: 'AI', table: 'AirImportItems' },
];

async function fetchChildRecords() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getBlChildRecords`);
    if (!data || !SOURCES.some((s) => Array.isArray(data[s.table]))) {
      throw new Error(
        `${LEGACY_API}/jobs/getBlChildRecords responded but carried no child tables. `
        + `Got: ${Object.keys(data || {}).join(', ') || '(nothing)'}`
      );
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getBlChildRecords does not exist on this legacy server. It was added `
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
  target.skippedParents += r.stats?.skippedParents || 0;
  target.emptyBlocks += r.stats?.emptyBlocks || 0;
  return target;
}

async function sendSource(source, data, ctx) {
  const { report, onProgress, total, doneBefore, apply } = ctx;
  const rows = data[source.table] || [];
  const totals = { created: 0, orphaned: 0, skippedParents: 0, emptyBlocks: 0 };

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    const { data: res } = await axiosClient.post(
      apply ? '/blChildMigration/apply' : '/blChildMigration/plan',
      {
        kind: source.kind,
        operation: source.operation,
        rows: batch,
        // Small lookups, sent only for the kinds that read them.
        packing: source.kind === 'containers' ? (data.Packing || []) : [],
        stamps: source.kind === 'stamps' ? (data.Stamps || []) : [],
      },
    );
    addUp(totals, res.result);

    const done = doneBefore + Math.min(i + BATCH, rows.length);
    const pct = total ? Math.round((done / total) * 100) : 100;
    onProgress?.({ kind: source.kind, operation: source.operation, done, total, percent: pct });
    report(
      `${source.kind} ${source.operation}: ${Math.min(i + BATCH, rows.length).toLocaleString()} `
      + `of ${rows.length.toLocaleString()} (${pct}% of stage)`
    );
  }

  return totals;
}

export async function migrateBlChildren(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report('B/L children: fetching containers, stamps, dimensions and rate lines...');
  const data = await fetchChildRecords();

  const present = SOURCES.map((s) => ({
    ...s, rows: Array.isArray(data[s.table]) ? data[s.table] : [],
  }));

  const empty = present.filter((s) => !s.rows.length);
  if (empty.length) {
    report(
      `B/L children: no rows in ${empty.map((s) => `${s.table} (${s.kind}/${s.operation})`).join(', ')}.`
    );
  }

  const active = present.filter((s) => s.rows.length);
  const total = active.reduce((n, s) => n + s.rows.length, 0);

  if (!total) {
    report('B/L children: the legacy export contains none.');
    return { planned: null, applied: null, verification: null, noop: true, reason: 'Nothing in the source.' };
  }

  report(
    `B/L children: ${total.toLocaleString()} source row(s) to ${apply ? 'import' : 'check'} - `
    + active.map((s) => `${s.kind}/${s.operation} ${s.rows.length.toLocaleString()}`).join(', ')
    + '. Air rate lines expand from four inline blocks per waybill, so they produce more rows '
    + 'than they consume.'
  );

  const applied = {};
  let doneBefore = 0;

  for (const source of active) {
    const key = `${source.kind}/${source.operation}`;
    applied[key] = await sendSource(source, data, {
      report, onProgress, total, doneBefore, apply,
    });
    doneBefore += source.rows.length;

    const a = applied[key];
    report(
      `B/L children ${key}: ${apply ? 'created' : 'would create'} ${a.created.toLocaleString()} row(s).`
      + (a.skippedParents ? ` ${a.skippedParents.toLocaleString()} B/L(s) already had them.` : '')
    );

    if (a.orphaned) {
      report(
        `B/L children ${key}: WARNING - ${a.orphaned.toLocaleString()} row(s) belong to a B/L that `
        + 'is not in Odyssey and were skipped. Check the B/Ls stage ran for this operation.'
      );
    }
  }

  if (!apply) {
    report('B/L children: dry run - nothing was written.');
    return { planned: applied, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  report('B/L children: verifying...');
  const verifyRes = await axiosClient.get('/blChildMigration/verify');
  const v = verifyRes.data.result;

  report(
    `B/L children: ${v.containers.toLocaleString()} containers, ${v.stamps.toLocaleString()} stamps, `
    + `${v.dimensions.toLocaleString()} dimensions, ${v.items.toLocaleString()} rate lines across `
    + `${v.bls.toLocaleString()} B/L(s).`
  );
  report(
    `B/L children: ${v.seaBlsWithContainers.toLocaleString()} of ${v.seaBls.toLocaleString()} sea `
    + `B/Ls have containers; ${v.airBlsWithItems.toLocaleString()} of ${v.airBls.toLocaleString()} `
    + 'air waybills have rate lines.'
  );

  const detached = v.containersDetached + v.stampsDetached + v.dimensionsDetached + v.itemsDetached;
  if (detached) {
    report(
      `B/L children: WARNING - ${detached} row(s) point at no B/L. They belong to nothing and are `
      + 'invisible on every B/L screen while still counting as imported.'
    );
  }
  if (v.containersWithoutClimaxId || v.stampsWithoutClimaxId) {
    report(
      `B/L children: ${v.containersWithoutClimaxId.toLocaleString()} container(s) and `
      + `${v.stampsWithoutClimaxId.toLocaleString()} stamp(s) carry no legacy id - the old import `
      + 'never set one. Those cannot be matched on a re-run, only counted.'
    );
  }

  const created = Object.values(applied).reduce((n, a) => n + a.created, 0);

  return {
    planned: applied,
    applied,
    verification: v,
    noop: created === 0,
    reason: created === 0 ? 'Every B/L child was already imported.' : null,
  };
}

export const planBlChildrenOnly = (report, options = {}) =>
  migrateBlChildren(report, { ...options, apply: false });

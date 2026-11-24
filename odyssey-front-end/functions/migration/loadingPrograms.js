/**
 * Loading Programs - never migrated by any previous path.
 *
 * Nothing in any receiver has ever created a Loading_Program, so every
 * migrated sea export job currently has an empty one. This is not a rewrite of
 * a broken stage; it is data that has simply never come across.
 *
 * Sea export only - SExp_LoadingProgram is the only such table in the legacy
 * schema - and one per job, so a job that already has one is skipped.
 *
 * ON THE LOOKUPS: eight columns are ids rather than values, and only some of
 * them are decodable. Local custom and wharf resolve cleanly. Allocation and
 * container availability resolve through a shared misc table where 1 means
 * "Yes". The loading flag, status and container weight do NOT resolve to
 * anything meaningful - the loading flag's id maps to "999999" in the only
 * candidate table - so they are left empty rather than filled with a number
 * that would display as a label. The stage reports how many rows that affects.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

const BATCH = 1000;

async function fetchLoadingPrograms() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getLoadingPrograms`);
    if (!data || !Array.isArray(data.LoadingProgram)) {
      throw new Error(
        `${LEGACY_API}/jobs/getLoadingPrograms responded but carried no LoadingProgram array. `
        + `Got: ${Object.keys(data || {}).join(', ') || '(nothing)'}`
      );
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getLoadingPrograms does not exist on this legacy server. It was added `
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

export async function migrateLoadingPrograms(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report('Loading programs: fetching from the legacy system...');
  const data = await fetchLoadingPrograms();

  const rows = data.LoadingProgram || [];
  const lookups = {
    localCustoms: data.LocalCustom || [],
    wharfs: data.Wharf || [],
    lov: data.CommonLOV || [],
    locations: data.Locations || [],
  };

  if (!rows.length) {
    report('Loading programs: the legacy export contains none.');
    return { planned: null, applied: null, verification: null, noop: true, reason: 'Nothing in the source.' };
  }

  report(
    `Loading programs: ${rows.length.toLocaleString()} to ${apply ? 'import' : 'check'}. `
    + 'Sea export only, one per job - and never migrated before, so every job that has one '
    + 'is gaining data it did not have.'
  );

  const totals = { created: 0, skippedJobs: 0, orphaned: 0, notDecodableTotal: 0 };
  let undecoded = {};

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    const { data: res } = await axiosClient.post(
      apply ? '/loadingProgramMigration/apply' : '/loadingProgramMigration/plan',
      { operation: 'SE', rows: batch, ...lookups },
    );
    const r = res.result;

    totals.created += r.created || 0;
    totals.skippedJobs += r.stats?.skippedJobs || 0;
    totals.orphaned += r.stats?.orphaned || 0;
    totals.notDecodableTotal += r.stats?.notDecodableTotal || 0;
    for (const [k, v] of Object.entries(r.undecoded || {})) {
      undecoded[k] = (undecoded[k] || 0) + v;
    }

    const done = Math.min(i + BATCH, rows.length);
    const pct = Math.round((done / rows.length) * 100);
    onProgress?.({ done, total: rows.length, percent: pct });
    report(`Loading programs: ${done.toLocaleString()} of ${rows.length.toLocaleString()} (${pct}%)`);
  }

  report(
    `Loading programs: ${apply ? 'created' : 'would create'} ${totals.created.toLocaleString()}.`
    + (totals.skippedJobs ? ` ${totals.skippedJobs} job(s) already had one.` : '')
  );

  if (totals.orphaned) {
    report(
      `Loading programs: WARNING - ${totals.orphaned} belong to a job that is not in Odyssey and `
      + 'were skipped. Check the Jobs stage ran for sea export.'
    );
  }

  // Said plainly: these are fields that stay blank, and why.
  const missed = Object.entries(undecoded).filter(([, n]) => n);
  if (missed.length) {
    report(
      `Loading programs: lookups that did not resolve - ${missed.map(([k, n]) => `${n} ${k}`).join(', ')}.`
    );
  }
  if (totals.notDecodableTotal) {
    report(
      `Loading programs: ${totals.notDecodableTotal} field value(s) across loading flag, status `
      + 'and container weight are left empty on purpose - the legacy ids for those do not resolve '
      + 'to anything meaningful, and filling them would put a number where a label belongs.'
    );
  }

  if (!apply) {
    report('Loading programs: dry run - nothing was written.');
    return { planned: totals, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  report('Loading programs: verifying...');
  const verifyRes = await axiosClient.get('/loadingProgramMigration/verify');
  const v = verifyRes.data.result;

  report(
    `Loading programs: ${v.loadingPrograms.toLocaleString()} in the system, on `
    + `${v.jobsWithProgram.toLocaleString()} of ${v.seJobs.toLocaleString()} sea export job(s).`
  );

  if (v.detached) {
    report(
      `Loading programs: WARNING - ${v.detached} point at no job. A loading program opens only `
      + 'from its job, so those are unreachable.'
    );
  }
  if (v.jobsWithMultiple) {
    report(
      `Loading programs: WARNING - ${v.jobsWithMultiple} job(s) have more than one. The job screen `
      + 'loads only one, so the rest are invisible.'
    );
  }

  return {
    planned: totals,
    applied: totals,
    verification: v,
    noop: totals.created === 0,
    reason: totals.created === 0 ? 'Every job already had a loading program.' : null,
  };
}

export const planLoadingProgramsOnly = (report, options = {}) =>
  migrateLoadingPrograms(report, { ...options, apply: false });

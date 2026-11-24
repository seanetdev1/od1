/**
 * Clearing / transport jobs - the rewritten migration stage.
 *
 * Legacy Log_Job -> Customs_Job, with Log_DutyCalculation -> Customs_Duty.
 *
 * WHAT CHANGED FROM importLGJobs
 *
 *   the target     It wrote a clearing job into SE_Job with a forced
 *                  SE/SI/AE/AI operation. That was survivable while customs
 *                  mode relabelled the freight screens; it is not now that
 *                  Customs Job REPLACES them. Every LOG job imported the old
 *                  way would land in screens a customs install does not have,
 *                  and be invisible.
 *
 *   the duty       It imported none. Log_DutyCalculation - the rates the
 *                  declaration was actually assessed at, one row per item - was
 *                  simply not read. It is the reason a clearing agent keeps
 *                  these records at all.
 *
 *   the fetch      /jobs/getLOGJOB returns the whole Gen_UNLocation table -
 *                  108,182 rows - so the client could turn a POL code into a
 *                  port name. Customs_Job stores pol/pod as the CODE, exactly
 *                  as SE_Job does, so /jobs/getLGJobRecords sends the codes and
 *                  those rows never move.
 *
 *   the failure    The whole of it was `catch (e) { console.error(e) }`. A
 *                  failed post printed one line to a console nobody had open
 *                  and the stage reported success. And `JobNumber.split("-")[1]
 *                  .split("/")[0]` threw a TypeError on any job whose number
 *                  was not in that exact shape, taking the run with it.
 *
 *   the install    LG_COMPANY_ID, LG_COST_CENTER and MIGRATION_USER_ID were
 *                  hardcoded to one machine's values, then moved to env vars
 *                  that nobody sets. The company now comes from the legacy
 *                  SubCompanyId resolved through Company.climaxId, like every
 *                  other rewritten stage.
 *
 * The old importLGJobs is untouched and still exported; nothing points at it.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

// Matches the server's MAX_BATCH. A LOG job plus its duty lines is a wide
// payload, so these are smaller than the location stage's batches.
const BATCH = 500;

async function fetchLgJobRecords() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getLGJobRecords`);
    if (!data?.result || !Array.isArray(data.result.Job)) {
      throw new Error(
        `${LEGACY_API}/jobs/getLGJobRecords responded but carried no Job table. `
        + `Got: ${Object.keys(data?.result || {}).join(', ') || '(nothing)'}`
      );
    }
    return data.result;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getLGJobRecords does not exist on this legacy server. It was added `
        + 'for this stage - restart the legacy server to pick it up. NOTE the customs migration '
        + 'reads the CargoLinkers database (Climax-backup-server-CC), which is a different '
        + 'server from the freight one.'
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
 * The legacy lookups, resolved ONCE for the whole run.
 *
 * Sent with each batch as small objects rather than as tables: packing codes
 * are a few dozen rows and currencies fewer. This is what the freight stage
 * learned the hard way - attaching the full lookup tables to every batch
 * re-sent 259 MB of identical data across one run.
 */
function buildLookups(data) {
  const packing = {};
  for (const p of data.Packing || []) {
    if (p?.PackCode != null) packing[String(p.PackCode)] = p.PackName ?? null;
  }

  // Terminal, cargo type and Incoterms. Same treatment and same reason: a few
  // dozen rows each, resolved once so a migrated job stores the VALUE rather
  // than a legacy id nobody can read.
  const byId = (rows, key) => {
    const out = {};
    for (const r of rows || []) {
      if (r?.Id != null && r[key] != null) out[String(r.Id)] = r[key];
    }
    return out;
  };

  return {
    packing,
    // The currency a commercial invoice was raised in, keyed by legacy id.
    //
    // This was `{}` - a placeholder nothing ever filled, because the legacy
    // endpoint did not send the table. So `invoiceCurrency` resolved to null
    // on all 15,364 jobs while `invoiceValue` migrated intact: a figure with
    // no unit. It matters here more than it would on a PKR book - 60% of
    // these jobs are USD/EUR/GBP/AED, and of the 9,293 carrying a commercial
    // invoice value, 9,216 are in a foreign currency.
    currency: byId(data.Currencies, 'CurrencyCode'),
    cargoTypes: byId(data.CargoTypes, 'CargoTypeName'),
    incoTerms: byId(data.IncoTerms, 'IncoName'),
    terminals: byId(data.Terminals, 'LocationName'),
    cancelReasons: byId(data.CancelReasons, 'ReasonDesc'),
    // The CODE ('HO'), not the long name - it is what the rest of the app
    // stores in a cost-centre field.
    costCenters: byId(data.CostCenters, 'LOVCode'),
    containerTypes: byId(data.ContainerTypes, 'CargoTypeName'),
    deliveryTypes: byId(data.DeliveryTypes, 'DeliveryType'),
  };
}

/** Child rows for one batch of jobs, so a batch carries only its own. */
function childrenForJobs(rows, jobs, key) {
  const ids = new Set(jobs.map((j) => String(j.Id)));
  return (rows || []).filter((r) => ids.has(String(r?.[key])));
}

/** Duty rows for one batch of jobs, so a batch carries only its own. */
function dutyForJobs(allDuty, jobs) {
  const ids = new Set(jobs.map((j) => String(j.Id)));
  return (allDuty || []).filter((d) => ids.has(String(d?.LogJobId)));
}

function addUp(target, r) {
  target.created += r.created || 0;
  target.dutyCreated += r.dutyCreated || 0;
  target.containersCreated += r.containersCreated || 0;
  target.alreadyImported += r.stats?.alreadyImported || 0;
  target.missingJobNo += r.stats?.missingJobNo || 0;
  target.withoutDuty += r.stats?.withoutDuty || 0;
  for (const [k, v] of Object.entries(r.unresolved || {})) {
    target.unresolved[k] = (target.unresolved[k] || 0) + v;
  }
  for (const [k, list] of Object.entries(r.unknownCodes || {})) {
    for (const code of list) target.unknownCodes[k].add(code);
  }
  return target;
}

export async function migrateLgJobs(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report('Clearing jobs: fetching LOG job records from the legacy system...');
  const data = await fetchLgJobRecords();

  const jobs = data.Job || [];
  const duty = data.Duty || [];
  const lookups = buildLookups(data);

  if (!jobs.length) {
    report('Clearing jobs: the legacy export contains no LOG jobs.');
    return {
      planned: null, applied: null, verification: null,
      noop: true, reason: 'No LOG jobs in the source.',
    };
  }

  report(
    `Clearing jobs: ${jobs.length.toLocaleString()} to ${apply ? 'import' : 'check'}, `
    + `with ${duty.length.toLocaleString()} duty line(s) across them. `
    + 'Job records and duty only: no charge lines or invoices.'
  );

  // Columns this legacy database does not have.
  //
  // The Climax model files and the real schema have drifted - CargoLinkers'
  // Log_Job has 205 columns where the models declare 126, and the sets are not
  // nested. The server now drops what is absent instead of failing the whole
  // request on it, so these are fields that will simply be empty, and the
  // operator is better off knowing which than discovering it in the register.
  if (Array.isArray(data.missingColumns) && data.missingColumns.length) {
    report(
      `Clearing jobs: NOTE - this legacy database has no ${data.missingColumns.join(', ')} `
      + 'column on Log_Job, so those fields will be empty on every migrated job.'
    );
  }

  if (!duty.length) {
    report(
      'Clearing jobs: the legacy Log_DutyCalculation table is EMPTY, so no duty lines will be '
      + 'created. On this database duty is recorded as ordinary charge lines instead - which '
      + 'this stage does not import.'
    );
  }

  const totals = {
    created: 0, dutyCreated: 0, containersCreated: 0, alreadyImported: 0, missingJobNo: 0, withoutDuty: 0,
    unresolved: {},
    unknownCodes: { direction: new Set(), mode: new Set(), dutyPaidBy: new Set() },
  };

  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    const { data: res } = await axiosClient.post(
      apply ? '/lgJobMigration/apply' : '/lgJobMigration/plan',
      {
        jobs: batch,
        duty: dutyForJobs(duty, batch),
        containers: childrenForJobs(data.Containers, batch, 'LogJobId'),
        ...lookups,
      },
    );
    addUp(totals, res.result);

    const done = Math.min(i + BATCH, jobs.length);
    const pct = Math.round((done / jobs.length) * 100);
    onProgress?.({ done, total: jobs.length, percent: pct });
    report(
      `Clearing jobs: ${done.toLocaleString()} of ${jobs.length.toLocaleString()} (${pct}%)`
    );
  }

  report(
    `Clearing jobs: ${apply ? 'created' : 'would create'} ${totals.created.toLocaleString()} job(s) `
    + `${totals.dutyCreated.toLocaleString()} duty line(s) and `
    + `${totals.containersCreated.toLocaleString()} container(s), `
    + `${totals.alreadyImported.toLocaleString()} already imported`
    + (totals.missingJobNo ? `, ${totals.missingJobNo} skipped with no job number` : '') + '.'
  );

  // Not an error, but the number that separates "the duty did not come across"
  // from "there was none to come across".
  if (totals.withoutDuty) {
    report(
      `Clearing jobs: ${totals.withoutDuty.toLocaleString()} job(s) have no duty lines at all. `
      + 'That is expected for a file whose GD was never assessed - check a few against the '
      + 'legacy system before assuming it is right.'
    );
  }

  const u = totals.unresolved || {};
  if (u.company) {
    report(
      `Clearing jobs: WARNING - ${u.company} job(s) could not resolve a company. Every job list `
      + 'is scoped by company, so those jobs will not appear on any screen. Check the Companies '
      + 'stage ran first.'
    );
  }
  const others = ['client', 'commodity', 'shipper', 'consignee']
    .filter((k) => u[k]).map((k) => `${u[k]} ${k}`);
  if (others.length) {
    report(`Clearing jobs: unresolved links - ${others.join(', ')}.`);
  }

  // A legacy id the mapper's vocabularies did not recognise fell back to a
  // default. Said out loud, because the default is a fact nobody entered.
  for (const [field, codes] of Object.entries(totals.unknownCodes)) {
    if (codes.size) {
      report(
        `Clearing jobs: WARNING - unrecognised legacy ${field} code(s) `
        + `${[...codes].join(', ')}. Those jobs took the default; check what those ids mean `
        + 'in the legacy system and add them to lgJobMigrationPlan.js.'
      );
    }
  }

  if (!apply) {
    report('Clearing jobs: dry run - nothing was written.');
    return { planned: totals, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  report('Clearing jobs: verifying...');
  const verifyRes = await axiosClient.get('/lgJobMigration/verify');
  const v = verifyRes.data.result;

  report(
    `Clearing jobs: ${v.jobs.toLocaleString()} customs job(s) in the system - `
    + `${v.migrated.toLocaleString()} migrated, ${v.handCreated.toLocaleString()} created by hand, `
    + `carrying ${v.dutyLines.toLocaleString()} duty line(s).`
  );

  if (v.withoutCompany) {
    report(
      `Clearing jobs: WARNING - ${v.withoutCompany} job(s) have no company and are invisible on `
      + `every job list. Sample: ${(v.withoutCompanySample || []).slice(0, 10).join(', ')}`
    );
  }
  if (v.duplicateClimaxIdCount) {
    report(
      `Clearing jobs: WARNING - ${v.duplicateClimaxIdCount} legacy job id(s) imported more than `
      + `once. Sample: ${(v.duplicateClimaxIds || []).slice(0, 10).join(', ')}`
    );
  }
  if (v.withoutGdNumber) {
    report(
      `Clearing jobs: ${v.withoutGdNumber} migrated job(s) have no GD number. The legacy field is `
      + 'MachineNo - a file opened before its declaration was filed has none.'
    );
  }

  return {
    planned: totals,
    applied: totals,
    verification: v,
    noop: totals.created === 0,
    reason: totals.created === 0 ? 'Every clearing job was already imported.' : null,
  };
}

/** Plan only - writes nothing. */
export const planLgJobsOnly = (report, options = {}) =>
  migrateLgJobs(report, { ...options, apply: false });

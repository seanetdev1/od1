/**
 * Commodity master - the rewritten migration stage.
 *
 * 10,649 rows, the largest of the rewritten stages.
 *
 * What the old stage lost, and this keeps:
 *
 *   the hazmat flag   The real defect. isHazmat is a string column and the
 *                     source value is a boolean, so it stored "true"/"false".
 *                     Every screen tests it with `isHazmat == 1`, which
 *                     "true" never matches - so a hazardous commodity renders
 *                     as non-hazardous and its packing group, hazmat code,
 *                     chemical name and UNO code are disabled in the edit form
 *                     as though they did not apply. Re-running this stage
 *                     corrects rows the old import already wrote.
 *   all-or-nothing    One INSERT per row with no transaction: a failure at row
 *                     8,000 left 8,000 committed rows and no way to tell how
 *                     far it got. Now chunked inside a single transaction.
 *   the cargo type    Hardcoded to GL while CCargoTypeID carries a real id.
 *                     Decoded when the legacy server exposes the lookup.
 *   inactive          IsInActive was ignored. Nothing reads `active` today, so
 *                     this is recorded rather than dressed up as a fix.
 *
 * Gen_UnCommodity (/jobs/getLogCommodities, 6,608 rows of {HsCode,
 * HsDescription}) is deliberately NOT imported: it is an HS-code reference
 * table, not a commodity master, and loading it here would add 6,608 rows to
 * every commodity picker in the system.
 *
 * The existing importCommodities in steps.js is untouched.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

async function fetchCommodities() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getCommodities`);
    const rows = data?.Commodities || data;
    if (!Array.isArray(rows)) {
      throw new Error(
        `${LEGACY_API}/jobs/getCommodities responded but returned no commodities array. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return rows;
  } catch (err) {
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
 * The Gen_CommodityCargoType lookup, if this legacy server exposes it.
 *
 * Added for this stage, so a legacy server that has not been restarted will
 * 404. That is not a failure: without it every commodity falls back to GL,
 * which is exactly what the old import did unconditionally. The stage reports
 * which of the two happened rather than letting a silent fallback look like a
 * decoded value.
 */
async function fetchCargoTypes(report) {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getCommodityCargoTypes`);
    const rows = data?.CargoTypes || data;
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    report(
      'Commodities: the cargo-type lookup is not available on this legacy server, so cargo types '
      + 'fall back to GL. Restart it to pick up /jobs/getCommodityCargoTypes if you want them '
      + 'decoded.'
    );
    return [];
  }
}

export async function migrateCommodities(report = () => {}, { apply = true } = {}) {
  report('Commodities: fetching the commodity master...');
  const Commodities = await fetchCommodities();
  const CargoTypes = await fetchCargoTypes(report);

  report(`Commodities: planning ${Commodities.length}...`);
  const planRes = await axiosClient.post('/commodity/migration/plan', { Commodities, CargoTypes });
  const plan = planRes.data.result;

  // Said before applying, not after: this is a correction to rows that are
  // already in the system and already being used.
  if (plan.stats.toRepair) {
    report(
      `Commodities: ${plan.stats.toRepair} already-imported commodity/commodities have a hazmat `
      + 'flag the screens cannot read and show as non-hazardous. They will be corrected in place.'
    );
  }

  if (!apply) {
    report(
      `Commodities: ${plan.stats.toCreate} would be created, ${plan.stats.toRepair} corrected `
      + '(dry run).'
    );
    return { planned: plan, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  const nothingToDo = plan.stats.toCreate === 0 && plan.stats.toRepair === 0;
  if (nothingToDo) {
    report(`Commodities: all ${plan.stats.alreadyImported} already imported.`);
  } else {
    report(
      `Commodities: importing ${plan.stats.toCreate}, correcting ${plan.stats.toRepair}. `
      + 'This is the largest stage - it may take a moment.'
    );
    const applyRes = await axiosClient.post('/commodity/migration/apply', { Commodities, CargoTypes });
    plan.applied = applyRes.data.result;
    report(
      `Commodities: created ${plan.applied.created}, corrected ${plan.applied.repaired}.`
    );
  }

  report('Commodities: verifying...');
  const verifyRes = await axiosClient.get('/commodity/migration/verify');
  const v = verifyRes.data.result;

  report(
    `Commodities: ${v.commodities} in the system - ${v.migrated} migrated, ${v.hazmat} hazardous, `
    + `${v.withoutClimaxId} not reachable from an imported job.`
  );

  // Both of these are invisible to a row count, and both change what a user
  // sees on screen rather than how many rows exist.
  if (v.unreadableHazmat) {
    report(
      `Commodities: WARNING - ${v.unreadableHazmat} commodity/commodities still carry a hazmat `
      + 'flag the screens cannot read, so they render as non-hazardous whatever the source said.'
    );
  }
  if (v.duplicateClimaxIds.length) {
    report(
      `Commodities: WARNING - ${v.duplicateClimaxIds.length} legacy id(s) appear on more than one `
      + 'commodity, so which one a job line resolves to is not deterministic. Ids: '
      + v.duplicateClimaxIds.slice(0, 10).join(', ')
    );
  }
  if (plan.stats.missingHsCode) {
    report(`Commodities: ${plan.stats.missingHsCode} have no HS code in the source.`);
  }

  return {
    planned: plan,
    applied: plan.applied || null,
    verification: v,
    noop: nothingToDo,
    reason: nothingToDo ? `All ${plan.stats.alreadyImported} commodities already imported.` : null,
  };
}

export const planCommoditiesOnly = (report) => migrateCommodities(report, { apply: false });

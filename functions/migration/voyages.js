/**
 * Vessels & Voyages - the rewritten migration stage.
 *
 * 2,063 vessels and 2,020 voyages. Small, and the stage the Jobs stage leans
 * on hardest: a job resolves its voyage by Odyssey vessel id plus voyage
 * number, so anything that stops that pair matching is a job that silently
 * loses its voyage and says nothing about it.
 *
 * What the old stage lost, and this keeps:
 *
 *   idempotency     There was no climaxId check of any kind - Vessel.create and
 *                   Voyage.create ran unconditionally. Running the stage twice
 *                   duplicated all 2,063 vessels and all 2,020 voyages, and a
 *                   duplicated vessel splits its voyages across two vessel ids,
 *                   so jobs then resolve against whichever comes back first.
 *   trimmed numbers 11 voyage numbers are space-padded in the source. Jobs
 *                   match on the trimmed number, so a padded one stored as-is
 *                   can never be resolved.
 *   all-or-nothing  One create per row, no transaction: a failure part way left
 *                   some vessels with their voyages and some without, with no
 *                   safe way to retry.
 *   pol / pod       Gen_Voyage carries PortOfLoadingCode and PortOfDischarge
 *                   and both were dropped. Only 27 and 23 voyages have them,
 *                   but it is the only route information a voyage has.
 *
 * The existing importVoyages in steps.js is untouched.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

async function fetchVoyages() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getVoyages`);
    if (!data || (!Array.isArray(data.Vessel) && !Array.isArray(data.Voyage))) {
      throw new Error(
        `${LEGACY_API}/jobs/getVoyages responded but returned neither Vessel nor Voyage. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return { Vessel: data.Vessel || [], Voyage: data.Voyage || [] };
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

export async function migrateVoyages(report = () => {}, { apply = true } = {}) {
  report('Vessels & Voyages: fetching from the legacy system...');
  const { Vessel, Voyage } = await fetchVoyages();

  report(`Vessels & Voyages: planning ${Vessel.length} vessels and ${Voyage.length} voyages...`);
  const planRes = await axiosClient.post('/vessel/migration/plan', { Vessel, Voyage });
  const plan = planRes.data.result;

  const ve = plan.vessels.stats;
  const vo = plan.voyages.stats;

  // Said before applying, because each of these is a voyage a job will not
  // find later, and none of them is visible in a row count.
  if (vo.paddedVoyageNo) {
    report(
      `Vessels & Voyages: ${vo.paddedVoyageNo} voyage number(s) are space-padded in the source `
      + 'and will be trimmed. Jobs match a voyage on its trimmed number.'
    );
  }
  if (vo.orphaned) {
    report(
      `Vessels & Voyages: ${vo.orphaned} voyage(s) belong to a vessel that is not in Odyssey and `
      + 'will be skipped - there is nothing to attach them to.'
    );
  }
  if (vo.ambiguous) {
    report(
      `Vessels & Voyages: WARNING - ${vo.ambiguous} voyage(s) share a vessel and number with `
      + 'another. A job resolving that pair gets whichever comes back first, which is not '
      + 'deterministic.'
    );
  }

  if (!apply) {
    report(
      `Vessels & Voyages: ${ve.toCreate} vessels and ${vo.toCreate} voyages would be created `
      + '(dry run).'
    );
    return { planned: plan, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  const nothingToDo = ve.toCreate === 0 && vo.toCreate === 0;
  if (nothingToDo) {
    report(
      `Vessels & Voyages: already imported - ${ve.alreadyImported} vessels, `
      + `${vo.alreadyImported} voyages.`
    );
  } else {
    report(`Vessels & Voyages: importing ${ve.toCreate} vessels and ${vo.toCreate} voyages...`);
    const applyRes = await axiosClient.post('/vessel/migration/apply', { Vessel, Voyage });
    plan.applied = applyRes.data.result;
    report(
      `Vessels & Voyages: created ${plan.applied.created.vessels} vessels and `
      + `${plan.applied.created.voyages} voyages.`
    );
  }

  report('Vessels & Voyages: verifying...');
  const verifyRes = await axiosClient.get('/vessel/migration/verify');
  const v = verifyRes.data.result;

  report(
    `Vessels & Voyages: ${v.vessels} vessels and ${v.voyages} voyages in the system `
    + `(${v.migratedVessels} / ${v.migratedVoyages} migrated). `
    + `${v.vesselsWithoutVoyages} vessel(s) have no voyages, which is normal.`
  );

  if (v.duplicateVesselCount) {
    report(
      `Vessels & Voyages: WARNING - ${v.duplicateVesselCount} vessel(s) appear more than once for `
      + 'the same legacy id. The old import had no idempotency check, so a second run duplicated '
      + 'them - and their voyages are now split across both copies.'
    );
  }
  if (v.paddedVoyageNo) {
    report(
      `Vessels & Voyages: WARNING - ${v.paddedVoyageNo} voyage number(s) still carry padding from `
      + 'an earlier import. Jobs cannot resolve those.'
    );
  }
  if (v.orphanVoyages) {
    report(`Vessels & Voyages: WARNING - ${v.orphanVoyages} voyage(s) point at no vessel.`);
  }
  if (v.ambiguousVoyageKeyCount) {
    report(
      `Vessels & Voyages: WARNING - ${v.ambiguousVoyageKeyCount} vessel+voyage pair(s) are `
      + 'duplicated, so a job resolving one is not deterministic.'
    );
  }

  return {
    planned: plan,
    applied: plan.applied || null,
    verification: v,
    noop: nothingToDo,
    reason: nothingToDo ? 'Every vessel and voyage was already imported.' : null,
  };
}

export const planVoyagesOnly = (report) => migrateVoyages(report, { apply: false });

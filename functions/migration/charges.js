/**
 * Charge master - the rewritten migration stage.
 *
 * Small table, high consequence: every job charge line resolves its charge
 * through this, so a charge missing, duplicated, or imported under the wrong
 * code becomes thousands of job lines that cannot name what they are for.
 *
 * What the old stage lost, and this keeps:
 *
 *   idempotency       Charges had no climaxId column, so the legacy id the
 *                     frontend sent was silently dropped and nothing recorded
 *                     which legacy charge a row came from. There was no way to
 *                     tell a re-run from a first run, and running it twice
 *                     duplicated the entire charge master.
 *   all-or-nothing    bulkCreate outside a transaction: a failure part-way
 *                     left a half-imported charge master behind.
 *   one bad row       GL_Currencies was read unguarded, so a single charge with
 *                     no currency threw the whole import.
 *   inactive charges  IsInActive was ignored. Every row in the current export
 *                     is active, so this changes nothing today - it is one
 *                     export away from mattering.
 *
 * `code` still holds the legacy id, deliberately: it is an INTEGER column and
 * /charges/create issues new codes with max(code)+1. See the header of
 * functions/chargeMigrationPlan.js on the server for the full reasoning.
 *
 * The existing importCharges in steps.js is untouched.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

async function fetchCharges() {
  try {
    // POST, not GET - this is the legacy endpoint's existing shape, so the
    // stage runs without restarting that server.
    const { data } = await axiosClient.post(`${LEGACY_API}/charges/getAll`);
    if (!Array.isArray(data)) {
      throw new Error(
        `${LEGACY_API}/charges/getAll responded but returned no array. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return data;
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

export async function migrateCharges(report = () => {}, { apply = true } = {}) {
  report('Charges: fetching the charge master...');
  const charges = await fetchCharges();

  report(`Charges: planning ${charges.length}...`);
  const planRes = await axiosClient.post('/charges/migration/plan', { charges });
  const plan = planRes.data.result;

  if (plan.problems.codeCollisionCount) {
    report(
      `Charges: WARNING - ${plan.problems.codeCollisionCount} charge(s) would take a code an `
      + 'existing charge already holds. They import, but the pair is indistinguishable in a '
      + 'picker and neither can be saved from Setup > Charges until one is changed.'
    );
  }

  // Charges the old importer created carry the legacy id in `code` and no
  // climaxId, so they look unimported. They are claimed, not duplicated.
  if (plan.stats.toAdopt) {
    report(
      `Charges: ${plan.stats.toAdopt} were imported by the old importer and have no legacy id `
      + 'recorded. They will be adopted in place rather than imported again.'
    );
  }

  if (!apply) {
    report(
      `Charges: ${plan.stats.toCreate} would be created, ${plan.stats.toAdopt} adopted (dry run).`
    );
    return { planned: plan, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  const nothingToDo = plan.stats.toCreate === 0 && plan.stats.toAdopt === 0;
  if (nothingToDo) {
    report(`Charges: all ${plan.stats.alreadyImported} already imported.`);
  } else {
    report(`Charges: importing ${plan.stats.toCreate}, adopting ${plan.stats.toAdopt}...`);
    const applyRes = await axiosClient.post('/charges/migration/apply', { charges });
    plan.applied = applyRes.data.result;
    report(`Charges: created ${plan.applied.created}, adopted ${plan.applied.adopted}.`);
  }

  report('Charges: verifying job charge lines can resolve them...');
  const verifyRes = await axiosClient.get('/charges/migration/verify');
  const v = verifyRes.data.result;

  report(
    `Charges: ${v.charges} in the system - ${v.migrated} migrated, `
    + `${v.inactive} inactive, ${v.withoutClimaxId} not reachable from an imported job.`
  );

  // Said separately: these two are the ones that turn into unnamed charge
  // lines later, and neither is visible from a row count.
  if (v.duplicateClimaxIds.length) {
    report(
      `Charges: WARNING - ${v.duplicateClimaxIds.length} legacy id(s) appear on more than one `
      + 'charge, so which one a job line resolves to is not deterministic. Ids: '
      + v.duplicateClimaxIds.slice(0, 10).join(', ')
    );
  }
  if (plan.stats.undecodablePayableParty) {
    report(
      `Charges: ${plan.stats.undecodablePayableParty} charge(s) carry a default payable/receivable `
      + 'party id that this export cannot decode - the party-type lookup is not part of it - so '
      + 'they import as Local-Agent/Client like the rest. Set them in Setup > Charges if the '
      + 'distinction matters.'
    );
  }
  if (plan.stats.mnemonicsDropped) {
    report(
      `Charges: ${plan.stats.mnemonicsDropped} charge(s) have a mnemonic legacy code (OFT, STOR) `
      + 'that has no column in Odyssey, where `code` is a number. Their name and short name still '
      + 'come across.'
    );
  }

  return {
    planned: plan,
    applied: plan.applied || null,
    verification: v,
    noop: nothingToDo,
    reason: nothingToDo ? `All ${plan.stats.alreadyImported} charges already imported.` : null,
  };
}

export const planChargesOnly = (report) => migrateCharges(report, { apply: false });

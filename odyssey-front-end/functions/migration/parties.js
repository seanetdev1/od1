/**
 * Parties (clients and vendors) - the rewritten migration stage.
 *
 * Same sequence as the chart of accounts: fetch, plan, stop if blocked, apply
 * in one transaction, verify.
 *
 * The verify step matters more here than anywhere so far. Every party can
 * import successfully and the install still be unable to raise a single
 * invoice, because what makes a client usable is not the client row - it is
 * the Client_Associations row joining it to a ledger account. The old import
 * created the client as non-GL and moved on whenever that link could not be
 * made, with no error and no count, so the failure only surfaced when somebody
 * tried to invoice.
 *
 * The existing importParties in steps.js is untouched.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

async function fetchParties() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/parties/list`);
    if (!Array.isArray(data?.parties)) {
      throw new Error(
        `${LEGACY_API}/parties/list responded but returned no parties array. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return data.parties;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/parties/list returned 404. That endpoint is part of the rewritten `
        + 'migration, so the legacy Climax server is running a build from before it was '
        + 'added - restart it and try again.'
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
 * @param {(text: string) => void} report
 * @param {{ apply?: boolean }} options   apply:false stops after planning
 */
export async function migrateParties(report = () => {}, { apply = true } = {}) {
  report('Parties: fetching from the legacy system...');
  const parties = await fetchParties();

  report(`Parties: planning ${parties.length}...`);
  const planRes = await axiosClient.post('/clientRoutes/migration/parties/plan', { parties });
  const plan = planRes.data.result;

  const unresolved = plan.problems.unresolvedAccount;
  if (unresolved > 0) {
    // Not a hard stop - the parties are still worth having - but this almost
    // always means the chart of accounts has not been imported yet, and
    // importing parties first would leave most of them unable to be invoiced.
    report(
      `Parties: WARNING - ${unresolved} reference a ledger account that is not in this `
      + 'chart of accounts. Run Chart of Accounts first.'
    );
  }

  if (!apply) {
    report(
      `Parties: ${plan.stats.toCreate} would be created, `
      + `${plan.stats.withLedgerAccount} with a ledger account (dry run).`
    );
    return { planned: plan, applied: null, verification: null };
  }

  if (plan.stats.toCreate === 0) {
    report('Parties: already imported, nothing to do.');
  } else {
    report(`Parties: importing ${plan.stats.toCreate}...`);
    const applyRes = await axiosClient.post('/clientRoutes/migration/parties/apply', { parties });
    plan.applied = applyRes.data.result;
    report(
      `Parties: created ${plan.applied.created}, `
      + `${plan.applied.associationsCreated} linked to a ledger account.`
    );
  }

  report('Parties: verifying they can be invoiced...');
  const verifyRes = await axiosClient.get('/clientRoutes/migration/parties/verify');
  const v = verifyRes.data.result;

  if (!v.healthy) {
    console.warn('[parties] imported, but not all clients are usable:', v);
    report(
      `Parties: ${v.migrated} migrated, ${v.withLedgerAccount} invoiceable, `
      + `${v.nonGl} non-GL. PROBLEMS: ${v.glWithoutAccount} marked as ledger clients with no `
      + `account, ${v.brokenAssociations} broken links, `
      + `${v.duplicateClimaxIds.length} duplicated legacy ids.`
    );
  } else {
    report(
      `Parties: ${v.migrated} migrated, ${v.withLedgerAccount} invoiceable, `
      + `${v.nonGl} non-GL. Verified.`
    );
  }

  return { planned: plan, applied: plan.applied || null, verification: v };
}

/** Plan only - writes nothing. */
export const planPartiesOnly = (report) => migrateParties(report, { apply: false });

/**
 * Chart of accounts - the rewritten migration stage.
 *
 * The existing importCOA in steps.js is untouched. This is a separate stage
 * because the sequence is different, and the difference is the point:
 *
 *   1. fetch the legacy chart
 *   2. ask the backend what WOULD happen
 *   3. stop and report if anything blocks it
 *   4. apply, in one transaction
 *   5. verify the tree actually holds together afterwards
 *
 * The old stage did one POST and reported "COA Imported" whether or not the
 * accounts landed - the handler ran a loop of creates with no transaction, so
 * a failure part-way left half a chart and the UI still said it had worked.
 *
 * Nothing here writes until step 3 has passed, and step 5 checks the thing a
 * row count cannot see: whether every account can still reach a root.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

/**
 * @param {(text: string) => void} report  progress sink
 * @param {{ apply?: boolean }} options    apply:false stops after planning
 */
export async function migrateChartOfAccounts(report = () => {}, { apply = true } = {}) {
  report('Chart of accounts: fetching from the legacy system...');

  // The lean endpoint. /accounts/getAll pulls every voucher line in the
  // database to attach one unused field per account.
  let data;
  try {
    ({ data } = await axiosClient.get(`${LEGACY_API}/accounts/coa`));
  } catch (err) {
    // A bare "Request failed with status code 404" tells whoever is running
    // the migration nothing about what to do next, and this particular 404 has
    // exactly one cause worth naming.
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/accounts/coa returned 404. That endpoint is part of the rewritten `
        + 'migration, so the legacy Climax server is running a build from before it was '
        + 'added - restart it and try again. (Its /accounts/getAll still responds, which '
        + 'is why the server looks up.)'
      );
    }
    if (err?.code === 'ECONNREFUSED' || !err?.response) {
      throw new Error(
        `Could not reach the legacy server at ${LEGACY_API}. Check it is running and that `
        + 'NEXT_PUBLIC_CLIMAX_LEGACY_URL points at it.'
      );
    }
    throw err;
  }

  const accounts = data?.accounts;
  if (!Array.isArray(accounts)) {
    throw new Error(
      `${LEGACY_API}/accounts/coa responded but returned no accounts array. `
      + `Got: ${JSON.stringify(data).slice(0, 200)}`
    );
  }

  report(`Chart of accounts: planning ${accounts.length} accounts...`);
  const planRes = await axiosClient.post('/accounts/migration/coa/plan', { accounts });
  const plan = planRes.data.result;

  // Stop before writing anything. This is the step the old import did not have.
  if (!plan.canApply) {
    const p = plan.problems;
    throw new Error(
      `Chart of accounts cannot be imported: ${plan.guidance}`
      + (p.collisions.length ? ` First colliding ids: ${p.collisions.slice(0, 10).join(', ')}.` : '')
      + (p.cycles.length ? ` Loops: ${JSON.stringify(p.cycles.slice(0, 3))}.` : '')
    );
  }

  if (!apply) {
    report(`Chart of accounts: ${plan.stats.toCreate} would be created (dry run).`);
    return { planned: plan, applied: null, verification: null };
  }

  if (plan.stats.toCreate === 0) {
    report('Chart of accounts: already imported, nothing to do.');
  } else {
    report(`Chart of accounts: importing ${plan.stats.toCreate} accounts...`);
    const applyRes = await axiosClient.post('/accounts/migration/coa/apply', { accounts });
    plan.applied = applyRes.data.result;
  }

  // Verify AFTER, always - including on a re-run that created nothing, since
  // the point is the state of the tree, not the state of this run.
  report('Chart of accounts: verifying the tree...');
  const verifyRes = await axiosClient.get('/accounts/migration/coa/verify');
  const verification = verifyRes.data.result;

  if (!verification.healthy) {
    // Not thrown: the accounts are in, and refusing the stage now would
    // suggest they are not. Reported loudly so it is dealt with rather than
    // discovered when a report comes back empty.
    console.warn('[coa] imported, but the tree has problems:', verification);
    report(
      `Chart of accounts: imported ${verification.accounts}, but `
      + `${verification.danglingParents} broken parent link(s), `
      + `${verification.inLoops} in loops, `
      + `${verification.accountsWithoutSubCategory} without a sub-category.`
    );
  } else {
    report(
      `Chart of accounts: ${verification.accounts} accounts, `
      + `${verification.roots} roots, deepest branch ${verification.deepestBranch}. Verified.`
    );
  }

  return { planned: plan, applied: plan.applied || null, verification };
}

/** Plan only - for a "what would this do" button, writing nothing. */
export const planChartOfAccounts = (report) =>
  migrateChartOfAccounts(report, { apply: false });

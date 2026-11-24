/**
 * Companies - the rewritten migration stage.
 *
 * Companies sit at the top of everything: jobs, invoices, vouchers, bank
 * accounts and employees are all scoped by company, and the company's short
 * code becomes the prefix on every document number it issues. So this runs
 * first and gets a plan step that the others do not need.
 *
 * REPLACING IS DESTRUCTIVE AND CANNOT BE UNDONE BY RE-RUNNING
 *
 * Two relationships cascade:
 *
 *   Vouchers.CompanyId      ON DELETE CASCADE
 *   BankAccounts.CompanyId  ON DELETE CASCADE
 *
 * Deleting a company therefore does not fail - it silently takes every voucher
 * belonging to it. Jobs, invoices and employees have no constraint at all, so
 * those rows survive holding a company id that no longer exists, which is
 * quieter still: nothing complains until something tries to resolve it.
 *
 * The stage refuses to replace anything without being told to, and when told
 * it reports what the deletion actually cost rather than assuming it was free.
 *
 * The existing importCompanies in steps.js is untouched.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

async function fetchSubCompanies() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getSubCompanies`);
    const rows = data?.SubCompanies || data?.subCompanies || data;
    if (!Array.isArray(rows)) {
      throw new Error(
        `${LEGACY_API}/jobs/getSubCompanies responded but returned no companies array. `
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
 * @param {(text: string) => void} report
 * @param {{ apply?: boolean, replaceExisting?: boolean }} options
 *   replaceExisting removes companies the legacy export does not contain.
 *   Off by default, deliberately.
 */
export async function migrateCompanies(report = () => {}, options = {}) {
  const { apply = true, replaceExisting = false } = options;

  report('Companies: fetching from the legacy system...');
  const SubCompanies = await fetchSubCompanies();

  report(`Companies: planning ${SubCompanies.length}...`);
  const planRes = await axiosClient.post('/companies/migration/plan', { SubCompanies });
  const plan = planRes.data.result;

  if (!plan.canApply) {
    throw new Error(`Companies cannot be imported: ${plan.guidance}`);
  }

  // Say what a replace costs BEFORE doing it, every time - not only when it
  // happens to be expensive.
  if (replaceExisting && plan.stats.wouldDelete > 0) {
    const cascade = plan.replaceImpact.cascadeDeletes;
    const orphan = plan.replaceImpact.leftPointingAtNothing;
    report(
      `Companies: replacing - ${plan.stats.wouldDelete} existing company/companies will be `
      + `DELETED (${plan.wouldDelete.map((c) => c.short || c.title).join(', ')}). `
      + `That cascades to ${cascade.vouchers} voucher(s) and ${cascade.bankAccounts} bank `
      + `account(s), and leaves ${orphan.jobs} job(s), ${orphan.invoices} invoice(s) and `
      + `${orphan.employees} employee(s) pointing at a company id that no longer exists.`
    );
  }

  if (!apply) {
    report(
      `Companies: ${plan.stats.toCreate} would be created, ${plan.stats.toUpdate} updated, `
      + `${replaceExisting ? plan.stats.wouldDelete : 0} deleted (dry run).`
    );
    return { planned: plan, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  const nothingToDo =
    plan.stats.toCreate === 0 && plan.stats.toUpdate === 0 &&
    !(replaceExisting && plan.stats.wouldDelete > 0);

  if (nothingToDo) {
    report(`Companies: already imported - ${plan.stats.existing} in the system.`);
  } else {
    report(`Companies: importing ${plan.stats.toCreate} new, updating ${plan.stats.toUpdate}...`);
    const applyRes = await axiosClient.post('/companies/migration/apply', {
      SubCompanies, replaceExisting,
    });
    plan.applied = applyRes.data.result;

    const a = plan.applied;
    report(
      `Companies: created ${a.created}, updated ${a.updated}, deleted ${a.deleted}.`
      + (a.deleted
        ? ` Cascade removed ${a.cascadeLoss.vouchers} voucher(s) and `
          + `${a.cascadeLoss.bankAccounts} bank account(s).`
        : '')
    );
  }

  report('Companies: verifying...');
  const verifyRes = await axiosClient.get('/companies/migration/verify');
  const v = verifyRes.data.result;

  if (!v.healthy) {
    console.warn('[companies] imported, but something does not line up:', v);
    report(
      `Companies: ${v.companies} in the system, but `
      + `${v.danglingReferences.length} table(s) reference a company that no longer exists, `
      + `${v.duplicateShorts.length} duplicated short code(s), `
      + `${v.withoutShortCode} without a short code.`
    );
  } else {
    report(
      `Companies: ${v.companies} in the system (${v.migrated} migrated, `
      + `${v.handCreated} created by hand) - ${v.list.map((c) => c.short).join(', ')}. Verified.`
    );
  }

  return {
    planned: plan,
    applied: plan.applied || null,
    verification: v,
    noop: nothingToDo,
    reason: nothingToDo ? `All ${plan.stats.existing} company/companies already imported.` : null,
  };
}

/** Plan only - writes nothing, deletes nothing. */
export const planCompaniesOnly = (report) => migrateCompanies(report, { apply: false });

/** Import AND remove anything the legacy export does not contain. Destructive. */
export const replaceCompanies = (report) =>
  migrateCompanies(report, { apply: true, replaceExisting: true });

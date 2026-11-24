/**
 * Invoices raised against clearing jobs - GL_JobInvoice and GL_JobBill filtered
 * to LGJobId, into Invoice, with their charge lines pointed at them.
 *
 * On CargoLinkers that is 14,535 client invoices and 36,410 vendor bills. The
 * same two tables hold freight documents; the legacy endpoint filters on
 * LGJobId so this stage only ever sees clearing ones.
 *
 * A CUSTOMS INVOICE HAS NO JOB COLUMN. Invoice carries SEJobId and no customs
 * equivalent - a clearance invoice reaches its declaration through its charge
 * lines (Charge_Heads.CustomsJobId), which functions/customsInvoiceContext.js
 * resolves in reverse for the reports. So these land with a null job and that
 * is correct, not an orphan. The plan counts them separately.
 *
 * Which is also why the CLEARING CHARGE LINES STAGE MUST RUN FIRST: the link
 * this stage forms is Charge_Head -> Invoice, and there is nothing to link if
 * the charge lines are not there.
 *
 * Uses the same receiver as the freight invoices. The only change needed on the
 * Odyssey side was to stop discarding LG rows - see LINE_COLUMNS and the
 * isCustoms branch in functions/invoiceMigrationPlan.js.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

const PAGE = 5000;

/** [kind, label], in the order they are imported. */
const KINDS = [
  ['JobInvoice', 'client invoices'],
  ['JobBill', 'vendor bills'],
];

async function fetchPage(kind, offset) {
  try {
    const { data } = await axiosClient.get(
      `${LEGACY_API}/jobs/getLogInvoiceRecords`,
      { params: { table: kind, offset, limit: PAGE } },
    );
    if (!data || !Array.isArray(data.rows)) {
      throw new Error(
        `${LEGACY_API}/jobs/getLogInvoiceRecords returned no rows array for ${kind}. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getLogInvoiceRecords does not exist on this legacy server. It was `
        + 'added for this stage - restart the legacy server to pick it up. NOTE the customs '
        + 'migration reads the CargoLinkers database (Climax-backup-server-CC), which is a '
        + 'different server from the freight one.'
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
  target.alreadyImported += r.stats?.alreadyImported || 0;
  target.onCustomsJobs += r.stats?.onLogisticsJobs || 0;
  target.orphaned += r.stats?.orphaned || 0;
  target.openingBalances += r.stats?.openingBalances || 0;
  target.linkedLines += r.stats?.linkedChargeHeads || r.linkedChargeHeads || 0;
  target.unresolvedParty += r.stats?.unresolvedParty || 0;
  return target;
}

export async function migrateCustomsInvoices(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report(
    'Clearing invoices: the sales and purchase ledger for clearance work. '
    + 'Run the Clearing Charge Lines stage first - this stage links those lines to their invoice.'
  );

  const applied = {};
  let grandTotal = 0;
  let done = 0;

  const totals = {};
  for (const [kind] of KINDS) {
    const first = await fetchPage(kind, 0);
    totals[kind] = first.total || 0;
    grandTotal += totals[kind];
    totals[`${kind}__first`] = first;
  }

  report(
    `Clearing invoices: ${grandTotal.toLocaleString()} to ${apply ? 'import' : 'check'} - `
    + KINDS.map(([k, label]) => `${(totals[k] || 0).toLocaleString()} ${label}`).join(', ')
  );

  for (const [kind, label] of KINDS) {
    const total = totals[kind] || 0;
    if (!total) { report(`Clearing invoices ${label}: none.`); continue; }

    const acc = {
      created: 0, alreadyImported: 0, onCustomsJobs: 0,
      orphaned: 0, openingBalances: 0, linkedLines: 0, unresolvedParty: 0,
    };

    for (let offset = 0; offset < total; offset += PAGE) {
      const page = offset === 0 ? totals[`${kind}__first`] : await fetchPage(kind, offset);

      const { data: res } = await axiosClient.post(
        apply ? '/invoiceMigration/apply' : '/invoiceMigration/plan',
        {
          kind,
          rows: page.rows || [],
          // The junction rows for exactly these invoices - the only place the
          // invoice/charge-line relationship exists.
          links: page.links || [],
          parentKey: page.parentKey,
          currencies: page.Currencies || [],
        },
      );
      addUp(acc, res.result);

      done += (page.rows || []).length;
      const pct = grandTotal ? Math.round((done / grandTotal) * 100) : 100;
      onProgress?.({ kind, done, total: grandTotal, percent: pct });
      report(
        `Clearing invoices ${label}: ${done.toLocaleString()} of `
        + `${grandTotal.toLocaleString()} (${pct}%)`
      );
    }

    applied[kind] = acc;
    report(
      `Clearing invoices ${label}: ${apply ? 'created' : 'would create'} `
      + `${acc.created.toLocaleString()}, ${acc.alreadyImported.toLocaleString()} already imported.`
    );

    if (acc.linkedLines) {
      report(
        `Clearing invoices ${label}: ${acc.linkedLines.toLocaleString()} charge line(s) pointed at `
        + 'their invoice.'
      );
    }
    if (acc.unresolvedParty) {
      report(
        `Clearing invoices ${label}: WARNING - ${acc.unresolvedParty.toLocaleString()} invoice(s) `
        + 'could not resolve their party. Those cannot be chased or aged. Check the Parties stage.'
      );
    }
  }

  if (!apply) {
    report('Clearing invoices: dry run - nothing was written.');
    return { planned: applied, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  report('Clearing invoices: verifying...');
  const verifyRes = await axiosClient.get('/invoiceMigration/verify');
  const v = verifyRes.data.result;

  report(
    `Clearing invoices: ${(v.invoices ?? 0).toLocaleString()} invoice(s) in the system; `
    + `${(v.headsWithoutInvoice ?? 0).toLocaleString()} charge line(s) still point at none.`
  );

  // A charge line with no invoice is uninvoiced work, which is a real state -
  // but on a migrated book it usually means this stage has not finished.
  if (v.headsBroken) {
    report(
      `Clearing invoices: WARNING - ${v.headsBroken.toLocaleString()} charge line(s) point at an `
      + 'invoice that does not exist. That is a broken link, not an uninvoiced charge.'
    );
  }

  const created = KINDS.reduce((n, [k]) => n + (applied[k]?.created || 0), 0);
  return {
    planned: applied,
    applied,
    verification: v,
    noop: created === 0,
    reason: created === 0 ? 'Every clearing invoice was already imported.' : null,
  };
}

/** Plan only - writes nothing. */
export const planCustomsInvoicesOnly = (report, options = {}) =>
  migrateCustomsInvoices(report, { ...options, apply: false });

/**
 * Job charge lines - Charge_Head.
 *
 * 103,112 lines across eight legacy tables: payable and receivable for each of
 * the four job types. They land in one Odyssey table, separated by `type`.
 *
 * SCOPE: lines attached to their JOB, with their charge, party, amounts and
 * tax. The invoice link is left to the ledger stage - see below.
 *
 * What the old import lost, and this keeps:
 *
 *   the line amount  It hardcoded amount to "1" while both source tables carry
 *                    a real Amount column. Every migrated line claims its
 *                    amount is 1 while its net, tax and local amounts are
 *                    real - data that looks correct and is not.
 *   the tax flag     Derived as TaxAmount > 0 instead of read from IsTaxApply,
 *                    so a taxable line with zero tax reads as non-taxable.
 *   approval         ApprovedBy and ApprovedOn were never mapped, and the
 *                    field it did write - approved_date - is not one the model
 *                    declares, so Sequelize dropped it.
 *   one bad row      party.id was read off a lookup that can miss, so a single
 *                    charge line whose party is absent threw inside the job's
 *                    transaction and took the job and its batch with it.
 *   the query count  A charge lookup and a party lookup per line: ~206,000
 *                    queries for 103,000 lines. Now three per batch.
 *
 * WHY THERE IS NO INVOICE LINK YET
 *
 * Charge_Head.InvoiceId points at an Invoice, and invoices come from the
 * ledger stage, which has not been rewritten. This stage attaches lines to
 * jobs and leaves InvoiceId null, and verify counts it. Resolving it inline
 * from a payload that has no invoice tables is exactly how the original ended
 * up with every charge head carrying a null InvoiceId - the failure this whole
 * sequence exists to prevent.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

// The legacy endpoint is paged: all eight tables at once is ~103,000 rows and
// the request dies.
const PAGE = 10000;
const BATCH = 5000;

/** kind -> label, in the order they are imported. */
const KINDS = [
  'SeaExportPayb', 'SeaExportRecv',
  'SeaImportPayb', 'SeaImportRecv',
  'AirExportPayb', 'AirExportRecv',
  'AirImportPayb', 'AirImportRecv',
];

async function fetchPage(kind, offset) {
  try {
    const { data } = await axiosClient.get(
      `${LEGACY_API}/jobs/getChargeLines`,
      { params: { table: kind, offset, limit: PAGE } },
    );
    if (!data || !Array.isArray(data.rows)) {
      throw new Error(
        `${LEGACY_API}/jobs/getChargeLines returned no rows array for ${kind}. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getChargeLines does not exist on this legacy server. It was added for `
        + 'this stage - restart the legacy server to pick it up.'
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
  target.orphaned += r.stats?.orphaned || 0;
  target.unresolvedCharge += r.stats?.unresolvedCharge || 0;
  target.unresolvedParty += r.stats?.unresolvedParty || 0;
  target.netAmount += r.stats?.netAmount || 0;
  target.withoutDocument += r.stats?.withoutDocument || 0;
  return target;
}

export async function migrateChargeHeads(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report('Charge lines: this is the largest stage after locations - ~103,000 lines across eight tables.');

  const applied = {};
  let grandTotal = 0;
  let done = 0;

  // One pass to learn the totals, so progress is against a real denominator.
  const totals = {};
  for (const kind of KINDS) {
    const first = await fetchPage(kind, 0);
    totals[kind] = first.total || 0;
    grandTotal += totals[kind];
    // Keep the first page rather than fetching it twice.
    totals[`${kind}__first`] = first;
  }

  report(
    `Charge lines: ${grandTotal.toLocaleString()} to ${apply ? 'import' : 'check'} - `
    + KINDS.map((k) => `${k} ${(totals[k] || 0).toLocaleString()}`).join(', ')
  );

  for (const kind of KINDS) {
    const total = totals[kind] || 0;
    if (!total) { report(`Charge lines ${kind}: none.`); continue; }

    const acc = {
      created: 0, alreadyImported: 0, orphaned: 0,
      unresolvedCharge: 0, unresolvedParty: 0, netAmount: 0, withoutDocument: 0,
    };

    for (let offset = 0; offset < total; offset += PAGE) {
      const page = offset === 0 ? totals[`${kind}__first`] : await fetchPage(kind, offset);
      const rows = page.rows || [];
      const currencies = page.Currencies || [];

      for (let i = 0; i < rows.length; i += BATCH) {
        const { data: res } = await axiosClient.post(
          apply ? '/chargeHeadMigration/apply' : '/chargeHeadMigration/plan',
          {
            kind, rows: rows.slice(i, i + BATCH), currencies,
            // Which invoice document each line sits on - this is what the job
            // P&L splits revenue from cost on.
            jobInvoiceIds: page.jobInvoiceIds || [],
            jobBillIds: page.jobBillIds || [],
            agentIds: page.agentIds || [],
          },
        );
        addUp(acc, res.result);
      }

      done += rows.length;
      const pct = grandTotal ? Math.round((done / grandTotal) * 100) : 100;
      onProgress?.({ kind, done, total: grandTotal, percent: pct });
      report(`Charge lines ${kind}: ${done.toLocaleString()} of ${grandTotal.toLocaleString()} (${pct}%)`);
    }

    applied[kind] = acc;
    report(
      `Charge lines ${kind}: ${apply ? 'created' : 'would create'} ${acc.created.toLocaleString()}`
      + `, ${acc.alreadyImported.toLocaleString()} already imported`
      + `, net ${acc.netAmount.toLocaleString()}.`
    );

    if (acc.orphaned) {
      report(
        `Charge lines ${kind}: WARNING - ${acc.orphaned.toLocaleString()} line(s) belong to a job `
        + 'that is not in Odyssey and were skipped. That is money with no shipment behind it - '
        + 'check the Jobs stage ran for this operation.'
      );
    }
    if (acc.withoutDocument) {
      report(
        `Charge lines ${kind}: ${acc.withoutDocument.toLocaleString()} line(s) sit on no invoice `
        + 'document, so they contribute nothing to the job P&L. That is a real state for an '
        + 'uninvoiced charge, not necessarily a fault.'
      );
    }
    if (acc.unresolvedCharge || acc.unresolvedParty) {
      report(
        `Charge lines ${kind}: ${acc.unresolvedCharge.toLocaleString()} line(s) could not resolve `
        + `their charge and ${acc.unresolvedParty.toLocaleString()} their party. Those import with `
        + 'their money intact but nobody to attribute it to.'
      );
    }
  }

  if (!apply) {
    report('Charge lines: dry run - nothing was written.');
    return { planned: applied, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  report('Charge lines: verifying...');
  const verifyRes = await axiosClient.get('/chargeHeadMigration/verify');
  const v = verifyRes.data.result;

  report(
    `Charge lines: ${v.chargeLines.toLocaleString()} in the system - `
    + Object.entries(v.byType).map(([t, n]) => `${t} ${n.toLocaleString()}`).join(', ')
    + `. Net total ${v.netAmountTotal.toLocaleString()}.`
  );

  if (v.detached) {
    report(`Charge lines: WARNING - ${v.detached.toLocaleString()} line(s) point at no job.`);
  }
  if (v.duplicateClimaxIdCount) {
    report(`Charge lines: WARNING - ${v.duplicateClimaxIdCount} legacy id(s) imported twice.`);
  }
  if (v.amountIsOne) {
    report(
      `Charge lines: ${v.amountIsOne.toLocaleString()} line(s) have an amount of exactly 1. The `
      + 'old import wrote a literal 1 into every line it created, so a large number here means '
      + 'those rows came from that path and still need re-importing.'
    );
  }
  report(
    `Charge lines: ${v.withoutInvoice.toLocaleString()} line(s) have no invoice yet. That is `
    + 'expected - this stage attaches lines to jobs, and the invoice link is the ledger stage.'
  );

  const created = Object.values(applied).reduce((n, a) => n + a.created, 0);

  return {
    planned: applied,
    applied,
    verification: v,
    noop: created === 0,
    reason: created === 0 ? 'Every charge line was already imported.' : null,
  };
}

export const planChargeHeadsOnly = (report, options = {}) =>
  migrateChargeHeads(report, { ...options, apply: false });

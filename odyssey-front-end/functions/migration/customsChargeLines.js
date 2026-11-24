/**
 * Clearing-job charge lines - Log_Job_ChargesRecv / _ChargesPayb into
 * Charge_Head, attached by CustomsJobId.
 *
 * THIS IS WHERE THE MONEY IS. On CargoLinkers the clearing-job stage carries
 * 15,364 job headers and, because Log_DutyCalculation is empty there, no money
 * at all. These two tables hold 143,368 lines across 95% of those jobs - the
 * agency fees, and the duty, wharfage, cartage and port charges that a
 * declaration actually consists of.
 *
 * It is the SAME receiver as the freight charge lines. Log_Job_Charges* have
 * the same column names for the money, the same CustomerId/VendorId split and
 * the same ExchRateClient/ExchRateLine split as their eight freight
 * counterparts, so this stage adds two kinds to an existing map rather than a
 * second implementation - see functions/chargeHeadMigrationPlan.js KINDS.
 *
 * The one difference is the parent: these land on Charge_Heads.CustomsJobId,
 * never SEJobId.
 *
 * WHAT `invoiceType` IS FOR
 *
 * A line is a Job Invoice line or a Job Bill line depending on which legacy
 * junction table names it, and that is knowable before any invoice is
 * imported. The job P&L splits revenue from cost on exactly that field, so a
 * line with it null contributes to neither and the P&L reads empty. The legacy
 * endpoint resolves it per page.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

// 143,368 rows across two tables. Both are paged; asking for either whole kills
// the request.
const PAGE = 5000;
const BATCH = 2500;

/** kind -> the legacy table, in the order they are imported. */
const KINDS = ['CustomsRecv', 'CustomsPayb'];

async function fetchPage(kind, offset) {
  try {
    const { data } = await axiosClient.get(
      `${LEGACY_API}/jobs/getLogChargeLines`,
      { params: { kind, offset, limit: PAGE } },
    );
    if (!data || !Array.isArray(data.rows)) {
      throw new Error(
        `${LEGACY_API}/jobs/getLogChargeLines returned no rows array for ${kind}. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getLogChargeLines does not exist on this legacy server. It was added `
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

export async function migrateCustomsChargeLines(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report(
    'Clearing charge lines: the largest customs stage - the agency fees and the duty, '
    + 'wharfage and port charges that make up a declaration.'
  );

  const applied = {};
  let grandTotal = 0;
  let done = 0;

  // One pass for the totals, so progress runs against a real denominator.
  const totals = {};
  for (const kind of KINDS) {
    const first = await fetchPage(kind, 0);
    totals[kind] = first.total || 0;
    grandTotal += totals[kind];
    totals[`${kind}__first`] = first;
  }

  report(
    `Clearing charge lines: ${grandTotal.toLocaleString()} to ${apply ? 'import' : 'check'} - `
    + KINDS.map((k) => `${k} ${(totals[k] || 0).toLocaleString()}`).join(', ')
  );

  for (const kind of KINDS) {
    const total = totals[kind] || 0;
    if (!total) { report(`Clearing charge lines ${kind}: none.`); continue; }

    const acc = {
      created: 0, alreadyImported: 0, orphaned: 0,
      unresolvedCharge: 0, unresolvedParty: 0, netAmount: 0, withoutDocument: 0,
    };

    for (let offset = 0; offset < total; offset += PAGE) {
      const page = offset === 0 ? totals[`${kind}__first`] : await fetchPage(kind, offset);
      const rows = page.rows || [];
      const currencies = page.currencies || [];

      for (let i = 0; i < rows.length; i += BATCH) {
        const { data: res } = await axiosClient.post(
          apply ? '/chargeHeadMigration/apply' : '/chargeHeadMigration/plan',
          {
            kind, rows: rows.slice(i, i + BATCH), currencies,
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
      report(
        `Clearing charge lines ${kind}: ${done.toLocaleString()} of `
        + `${grandTotal.toLocaleString()} (${pct}%)`
      );
    }

    applied[kind] = acc;
    report(
      `Clearing charge lines ${kind}: ${apply ? 'created' : 'would create'} `
      + `${acc.created.toLocaleString()}, ${acc.alreadyImported.toLocaleString()} already `
      + `imported, net ${acc.netAmount.toLocaleString()}.`
    );

    if (acc.orphaned) {
      report(
        `Clearing charge lines ${kind}: WARNING - ${acc.orphaned.toLocaleString()} line(s) belong `
        + 'to a clearing job that is not in Odyssey and were skipped. That is money with no '
        + 'declaration behind it - check the Clearing Jobs stage ran first.'
      );
    }
    if (acc.withoutDocument) {
      report(
        `Clearing charge lines ${kind}: ${acc.withoutDocument.toLocaleString()} line(s) sit on no `
        + 'invoice document, so they contribute nothing to the job P&L. That is a real state for '
        + 'an uninvoiced charge, not necessarily a fault.'
      );
    }
    if (acc.unresolvedCharge || acc.unresolvedParty) {
      report(
        `Clearing charge lines ${kind}: ${acc.unresolvedCharge.toLocaleString()} line(s) could not `
        + `resolve their charge and ${acc.unresolvedParty.toLocaleString()} their party. Those `
        + 'import with their money intact but nobody to attribute it to - check the Charge Master '
        + 'and Parties stages ran first.'
      );
    }
  }

  if (!apply) {
    report('Clearing charge lines: dry run - nothing was written.');
    return { planned: applied, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  report('Clearing charge lines: verifying...');
  const verifyRes = await axiosClient.get('/chargeHeadMigration/verify');
  const v = verifyRes.data.result;

  report(
    `Clearing charge lines: ${(v.total ?? 0).toLocaleString()} charge line(s) in the system, `
    + `${(v.detached ?? 0).toLocaleString()} attached to no job.`
  );

  if (v.detached) {
    report(
      `Clearing charge lines: WARNING - ${v.detached.toLocaleString()} line(s) have neither a `
      + 'freight job nor a clearing job. They are invisible on every job screen.'
    );
  }

  const created = KINDS.reduce((n, k) => n + (applied[k]?.created || 0), 0);
  return {
    planned: applied,
    applied,
    verification: v,
    noop: created === 0,
    reason: created === 0 ? 'Every clearing charge line was already imported.' : null,
  };
}

/** Plan only - writes nothing. */
export const planCustomsChargeLinesOnly = (report, options = {}) =>
  migrateCustomsChargeLines(report, { ...options, apply: false });

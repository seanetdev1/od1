/**
 * Job invoices - Invoice, and the charge lines each one carries.
 *
 * 40,026 invoices across three legacy tables: 32,251 that belong to a job, and
 * 7,775 cutover opening balances that do not. Both are imported. The openings
 * land as Odyssey's own "Opening Invoice" / "Opening Bill" types with no job
 * and no charge lines, which is what an opening balance is.
 *
 * WHAT THIS STAGE IS FOR
 *
 * The charge-line stage attached 103,112 lines to their jobs and left every
 * InvoiceId null, because an invoice link resolved from a payload with no
 * invoices in it is a guess. This is the stage that has the invoices: the
 * legacy junction tables record which lines sit on which document, and
 * 102,820 of the 103,112 lines are named by exactly one of them.
 *
 * Until this runs, the job P&L reads every charge as unrealized - there is no
 * invoice to have been paid against.
 *
 * WHAT IS DELIBERATELY LEFT ALONE
 *
 *   paid / recieved      what was actually collected lives in
 *   Invoice_Transactions GL_InvAdjustments, hanging off GL_Invoices, which is
 *   status               the ledger stage. Invented here, every invoice would
 *                        read as settled. Left at zero they read as
 *                        outstanding - wrong, but visibly wrong.
 *
 * The old paths - /invoice/uploadbulkInvoices, /invoice/createBulkInvoices and
 * importLedger in steps.js - are untouched.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

// A page is a batch: the junction rows arrive with the invoices they belong
// to, and splitting the rows without splitting the links would make every
// second batch report lines whose invoice it simply had not been given.
const PAGE = 5000;

/**
 * Order matters. Two charge lines in this data sit on two invoices at once,
 * and Charge_Head.InvoiceId can only hold one. The link is first-wins, so
 * running job documents before agent documents makes the winner deterministic
 * and matches the precedence the charge-line stage used for invoiceType.
 */
const KINDS = [
  ['JobInvoice', 'client invoices'],
  ['JobBill', 'vendor bills'],
  ['AgentInvoice', 'agent invoices'],
];

async function fetchPage(kind, offset) {
  try {
    const { data } = await axiosClient.get(
      `${LEGACY_API}/jobs/getInvoiceRecords`,
      { params: { table: kind, offset, limit: PAGE } },
    );
    if (!data || !Array.isArray(data.rows)) {
      throw new Error(
        `${LEGACY_API}/jobs/getInvoiceRecords returned no rows array for ${kind}. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getInvoiceRecords does not exist on this legacy server. It was `
        + 'added for this stage - restart the legacy server to pick it up.'
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
  target.linked += r.linked || 0;
  const s = r.stats || {};
  for (const k of [
    'alreadyImported', 'openingBalances', 'orphaned', 'onLogisticsJobs', 'cancelled',
    'unresolvedParty', 'unresolvedCompany', 'unresolvedCurrency',
    'withoutSequence', 'linesLinked', 'linesUnresolved', 'linesOnLogisticsJobs',
    'agentDirectionFromHeader', 'agentDirectionUndecided', 'totalAmount',
    'openingsWithoutOperation', 'negativeAmounts',
  ]) {
    target[k] = (target[k] || 0) + (s[k] || 0);
  }
  target.mixedAgent += (r.problems?.mixedSideAgentInvoices || []).length;
  target.agentConflicts += (r.problems?.agentDirectionConflicts || []).length;
  target.statusMismatch += (r.problems?.statusContentMismatch || []).length;
  target.contradictory.push(...(r.problems?.contradictoryAmounts || []));
  return target;
}

function emptyAcc() {
  return {
    created: 0, linked: 0, mixedAgent: 0, agentConflicts: 0, statusMismatch: 0,
    contradictory: [],
  };
}

export async function migrateInvoices(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report(
    'Invoices: this is the stage that closes the invoice link left open by the charge lines.'
  );

  const applied = {};
  const totals = {};
  let grandTotal = 0;
  let done = 0;

  // One pass for the totals, so progress runs against a real denominator. The
  // first page is kept rather than fetched twice.
  for (const [kind] of KINDS) {
    const first = await fetchPage(kind, 0);
    totals[kind] = first.total || 0;
    totals[`${kind}__first`] = first;
    grandTotal += totals[kind];
  }

  report(
    `Invoices: ${grandTotal.toLocaleString()} legacy invoices to ${apply ? 'import' : 'check'} - `
    + KINDS.map(([k, label]) => `${(totals[k] || 0).toLocaleString()} ${label}`).join(', ')
    + '.'
  );

  for (const [kind, label] of KINDS) {
    const total = totals[kind] || 0;
    if (!total) { report(`Invoices ${label}: none.`); continue; }

    const acc = emptyAcc();

    for (let offset = 0; offset < total; offset += PAGE) {
      const page = offset === 0 ? totals[`${kind}__first`] : await fetchPage(kind, offset);

      const { data: res } = await axiosClient.post(
        apply ? '/invoiceMigration/apply' : '/invoiceMigration/plan',
        {
          kind,
          rows: page.rows || [],
          // The junction rows for exactly these invoices. This is the only
          // place the invoice/charge-line relationship exists.
          links: page.links || [],
          parentKey: page.parentKey,
          currencies: page.Currencies || [],
        },
      );
      addUp(acc, res.result);

      done += (page.rows || []).length;
      const pct = grandTotal ? Math.round((done / grandTotal) * 100) : 100;
      onProgress?.({ kind, done, total: grandTotal, percent: pct });
      report(`Invoices ${label}: ${done.toLocaleString()} of ${grandTotal.toLocaleString()} (${pct}%)`);
    }

    applied[kind] = acc;

    report(
      `Invoices ${label}: ${apply ? 'created' : 'would create'} ${acc.created.toLocaleString()}`
      + `, ${(acc.alreadyImported || 0).toLocaleString()} already imported`
      + `, ${(acc.linesLinked || 0).toLocaleString()} charge line(s) attached`
      + `, total ${Math.round(acc.totalAmount || 0).toLocaleString()}.`
    );

    if (acc.openingBalances) {
      report(
        `Invoices ${label}: ${acc.openingBalances.toLocaleString()} opening balance(s) imported as `
        + 'Opening Invoice / Opening Bill, with no job and no charge lines. They land fully '
        + 'outstanding, like every other invoice here - what has been settled against them is '
        + 'the ledger stage.'
      );
    }
    if (acc.negativeAmounts) {
      report(
        `Invoices ${label}: ${acc.negativeAmounts.toLocaleString()} invoice(s) carry a negative `
        + 'amount. Those are credit notes and are imported as they stand, not flipped.'
      );
    }
    if (acc.openingsWithoutOperation) {
      report(
        `Invoices ${label}: ${acc.openingsWithoutOperation.toLocaleString()} opening(s) have an `
        + 'operation code that no job-linked invoice uses, so their trade could not be decoded '
        + 'and was left empty rather than guessed.'
      );
    }
    if (acc.cancelled) {
      report(
        `Invoices ${label}: ${acc.cancelled.toLocaleString()} cancelled invoice(s) imported `
        + 'unapproved. Those were emptied in Climax - no charge lines, zero amount - but they '
        + 'still hold their invoice number and their ledger references, so they are kept rather '
        + 'than dropped. Unapproved is what keeps them out of the settlement screens.'
      );
    }
    if (acc.contradictory.length) {
      report(
        `Invoices ${label}: WARNING - ${acc.contradictory.length} invoice(s) hold two different `
        + 'amounts for the same figure. At an exchange rate of 1 the net and the local amount are '
        + 'the same number, so one of the two is wrong. The net was imported as-is; nothing here '
        + 'overrides a financial figure. Check each against its charge lines and its voucher:'
      );
      for (const c of acc.contradictory.slice(0, 10)) {
        report(
          `    ${c.invoice_No} (legacy id ${c.climaxId}): imported ${c.imported.toLocaleString()}, `
          + `but LocalAmount says ${Number(c.localAmount).toLocaleString()}.`
        );
      }
    }
    if (acc.statusMismatch) {
      report(
        `Invoices ${label}: WARNING - ${acc.statusMismatch.toLocaleString()} invoice(s) have a `
        + 'status that disagrees with whether they carry any charge lines. That does not happen '
        + 'in the current data; the live-status rule needs rechecking.'
      );
    }
    if (acc.orphaned) {
      report(
        `Invoices ${label}: WARNING - ${acc.orphaned.toLocaleString()} invoice(s) name a job that `
        + 'is not in Odyssey and were skipped. That is a billed shipment with nothing behind it - '
        + 'check the Jobs stage ran for that operation.'
      );
    }
    if (acc.onLogisticsJobs) {
      report(
        `Invoices ${label}: ${acc.onLogisticsJobs.toLocaleString()} invoice(s) belong to a `
        + 'logistics job, which is the lgJobs stage. Skipped, not lost.'
      );
    }
    if (acc.linesUnresolved) {
      report(
        `Invoices ${label}: ${acc.linesUnresolved.toLocaleString()} charge line(s) named by an `
        + 'invoice could not be found in Odyssey. Those invoices exist with fewer lines than the '
        + 'legacy document had - check the Job Charge Lines stage completed.'
      );
    }
    if (acc.unresolvedParty || acc.unresolvedCompany) {
      report(
        `Invoices ${label}: ${(acc.unresolvedParty || 0).toLocaleString()} could not resolve their `
        + `party and ${(acc.unresolvedCompany || 0).toLocaleString()} their company. They import `
        + 'with their money intact but nobody to bill it to.'
      );
    }
    if (acc.mixedAgent) {
      report(
        `Invoices ${label}: ${acc.mixedAgent.toLocaleString()} agent invoice(s) carry both `
        + 'receivable and payable lines. Their direction comes from the document header '
        + '(DebitCreditId), which answers it where counting lines cannot.'
      );
    }
    if (acc.agentConflicts) {
      report(
        `Invoices ${label}: WARNING - ${acc.agentConflicts.toLocaleString()} agent invoice(s) `
        + 'have a header direction that contradicts the side their own charge lines sit on. '
        + 'That does not happen in the current data; the DebitCreditId mapping needs rechecking.'
      );
    }
    if (acc.agentDirectionUndecided) {
      report(
        `Invoices ${label}: ${acc.agentDirectionUndecided.toLocaleString()} agent invoice(s) have `
        + 'neither a recognised header direction nor any lines to infer one from. They were '
        + 'imported as Agent Invoices.'
      );
    }
  }

  if (!apply) {
    report('Invoices: dry run - nothing was written.');
    return { planned: applied, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  report('Invoices: verifying...');
  const { data: verifyRes } = await axiosClient.get('/invoiceMigration/verify');
  const v = verifyRes.result;

  report(
    `Invoices: ${v.invoices.toLocaleString()} in the system - `
    + Object.entries(v.byType).map(([t, n]) => `${t} ${n.toLocaleString()}`).join(', ')
    + '.'
  );
  report(
    'Invoices: totals by type - '
    + Object.entries(v.totalByType)
      .map(([t, n]) => `${t} ${Math.round(n).toLocaleString()}`).join(', ')
    + '. Reconcile these against the legacy totals; a row count cannot tell you the money '
    + 'came across intact.'
  );
  report(
    `Invoices: ${v.chargeLinesLinked.toLocaleString()} of ${v.chargeLines.toLocaleString()} `
    + `charge line(s) now point at an invoice, ${v.chargeLinesUnlinked.toLocaleString()} still `
    + 'do not. That does not reach zero - 292 legacy lines sit on no invoice document at all, '
    + 'and the logistics-job lines wait on the lgJobs stage.'
  );

  if (v.cancelled) {
    report(
      `Invoices: ${v.cancelled.toLocaleString()} cancelled invoice(s) are in the system, `
      + 'unapproved and carrying no charges - that is what they are in Climax too.'
    );
  }
  if (v.liveWithoutLines) {
    report(
      `Invoices: ${v.liveWithoutLines.toLocaleString()} APPROVED invoice(s) have no charge lines, `
      + `worth ${Math.round(v.liveWithoutLinesValue).toLocaleString()}. An approved invoice with a `
      + 'total and no breakdown prints with an empty charge table. If that value is not zero, '
      + 'those lines did not come across.'
    );
  }
  if (v.chargeLinesPointingAtNothing) {
    report(
      `Invoices: WARNING - ${v.chargeLinesPointingAtNothing.toLocaleString()} charge line(s) point `
      + 'at an invoice that does not exist. The invoice tab throws on those.'
    );
  }
  if (v.chargeLinesTypeMismatch) {
    report(
      `Invoices: WARNING - ${v.chargeLinesTypeMismatch.toLocaleString()} charge line(s) disagree `
      + 'with their invoice about what kind of document it is. That puts cost on the revenue '
      + 'side of the job P&L.'
    );
  }
  if (v.openings) {
    report(
      `Invoices: ${v.openings.toLocaleString()} of those are opening balances, carried in at `
      + 'cutover with no job.'
    );
  }
  if (v.detached) {
    report(
      `Invoices: WARNING - ${v.detached.toLocaleString()} job invoice(s) point at no job. `
      + '(Opening balances are not counted here - they never had one.)'
    );
  }
  if (v.openingsWithJob) {
    report(
      `Invoices: WARNING - ${v.openingsWithJob.toLocaleString()} opening balance(s) are attached `
      + 'to a job. An opening carries no job by definition.'
    );
  }
  if (v.duplicateClimaxIdCount) {
    report(`Invoices: WARNING - ${v.duplicateClimaxIdCount} legacy id(s) imported twice.`);
  }
  if (v.duplicateInvoiceNumberCount) {
    report(
      `Invoices: WARNING - ${v.duplicateInvoiceNumberCount} invoice number(s) appear twice. `
      + 'Anything that looks an invoice up by number gets one of them arbitrarily.'
    );
  }
  if (v.withoutSequence) {
    report(
      `Invoices: ${v.withoutSequence.toLocaleString()} invoice(s) have no number sequence, so the `
      + '"what was the last invoice" lookup cannot see them and a new invoice may reuse a number.'
    );
  }
  if (v.datedToday) {
    report(
      `Invoices: ${v.datedToday.toLocaleString()} invoice(s) are dated today. Ageing and every `
      + 'invoice listing order on that date, so those lost their real one.'
    );
  }

  const created = Object.values(applied).reduce((n, a) => n + a.created, 0);

  return {
    planned: applied,
    applied,
    verification: v,
    noop: created === 0,
    reason: created === 0 ? 'Every invoice was already imported.' : null,
  };
}

export const planInvoicesOnly = (report, options = {}) =>
  migrateInvoices(report, { ...options, apply: false });

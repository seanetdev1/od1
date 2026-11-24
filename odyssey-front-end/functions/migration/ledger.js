/**
 * The ledger - vouchers, voucher heads, and invoice settlement.
 *
 * 53,129 vouchers carrying 121,967 detail lines, then 38,330 settlements.
 *
 * WHAT THIS STAGE IS FOR
 *
 * Every invoice imported so far reads as fully outstanding, because what was
 * actually collected against it lives in GL_InvAdjustments and nothing before
 * this stage read that table. This is what turns 40,026 invoices from "all
 * unpaid" into real balances, and the job P&L's realized/unrealized split from
 * "everything unrealized" into actual figures.
 *
 * TWO PHASES
 *
 *   1. vouchers      each voucher with its detail lines, in one transaction
 *   2. settlements   each adjustment as an Invoice_Transaction, and the
 *                    matching increment on the invoice
 *
 * Settlement runs second because it needs both sides to exist: it finds its
 * invoice by the operational document id, and its voucher through the head
 * carrying the legacy detail id that GL_InvAdjustments points at.
 *
 * WHAT IS FIXED RELATIVE TO THE OLD PATH
 *
 *   paid vs recieved  The old importer incremented BOTH by the settled amount
 *                     on every invoice, so everything read as fully paid and
 *                     fully received at once. Only one side moves now, decided
 *                     by the invoice's own payType.
 *   the party         Read from the line that actually carries it rather than
 *                     from line 0, which is sometimes the control account.
 *   re-running        Settlements carry their legacy id, so a re-run skips
 *                     exactly what it wrote. The old (invoice, voucher) guard
 *                     dropped a genuine second part-payment by the same
 *                     voucher as if it were a duplicate.
 *
 * /voucher/ledger.js and importLedger in steps.js are untouched.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

// A page is a batch: the detail lines arrive with the vouchers they belong to,
// and splitting the vouchers without splitting the lines would import vouchers
// whose lines the batch simply had not been given.
const VOUCHER_PAGE = 2000;
const SETTLEMENT_PAGE = 5000;

async function fetchPage(path, params, label) {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/${path}`, { params });
    if (!data || !Array.isArray(data.rows)) {
      throw new Error(
        `${LEGACY_API}/jobs/${path} returned no rows array. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/${path} does not exist on this legacy server. It was added for the `
        + `${label} stage - restart the legacy server to pick it up.`
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

function addUp(target, result, keys) {
  for (const k of keys) target[k] = (target[k] || 0) + (result.stats?.[k] || 0);
  target.created += result.created || 0;
  return target;
}

const VOUCHER_KEYS = [
  'alreadyImported', 'voided', 'withoutParty', 'withoutCompany', 'unresolvedAccounts',
  'payable', 'receivable', 'multiplePartyLines',
];
const SETTLEMENT_KEYS = [
  'alreadyImported', 'withoutInvoice', 'withoutVoucher', 'zeroAmount', 'negativeAmount',
  'settledToReceivable', 'settledToPayable', 'totalSettled',
];

export async function migrateLedger(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report('Ledger: vouchers and their heads first, then settlement against the invoices.');

  /* ---------------------------------------------------------------- phase 1 */

  const vAcc = { created: 0, heads: 0 };
  const vProblems = { unnumbered: 0, withoutLines: 0, unknownType: 0 };
  // How many settle a document, and so reach Payments & Receipts rather than
  // the Voucher List. Reported because the split is severe and worth seeing.
  let settling = 0;
  /* The vouchers Climax never numbered. Every batch skips them - a batch
   * cannot see the whole sequence, so a number invented there could belong to
   * a real voucher on a later page. Kept here with their lines, and numbered
   * into the gap they sit in once every page is in. See numberUnnumbered. */
  const unnumbered = { rows: [], details: [], settledDetailIds: [], currencies: [], voucherTypes: [] };

  const first = await fetchPage('getVoucherRecords', { limit: VOUCHER_PAGE, offset: 0 }, 'ledger');
  const voucherTotal = first.total || 0;
  report(`Ledger: ${voucherTotal.toLocaleString()} voucher(s) to ${apply ? 'import' : 'check'}.`);

  let done = 0;
  for (let offset = 0; offset < voucherTotal; offset += VOUCHER_PAGE) {
    const page = offset === 0
      ? first
      : await fetchPage('getVoucherRecords', { limit: VOUCHER_PAGE, offset }, 'ledger');

    const { data: res } = await axiosClient.post(
      apply ? '/ledgerMigration/vouchers/apply' : '/ledgerMigration/vouchers/plan',
      {
        rows: page.rows || [],
        // The lines a voucher is made of. A voucher without them has no party,
        // no account and no amount.
        details: page.details || [],
        // Which of those lines was applied to an invoice or bill. This decides
        // whether a voucher lands in Payments & Receipts or in the Voucher
        // List - see the backend's resolveVoucherType. Without it every cash
        // and bank voucher claims to be a settlement.
        settledDetailIds: page.settledDetailIds || [],
        currencies: page.Currencies || [],
        voucherTypes: page.VoucherTypes || [],
      },
    );

    addUp(vAcc, res.result, VOUCHER_KEYS);
    vAcc.heads += res.result.heads || 0;
    settling += res.result.settlesInvoice || 0;
    const skipped = new Set((res.result.problems?.unnumbered || []).map(String));
    vProblems.unnumbered += skipped.size;
    if (skipped.size) {
      const rows = (page.rows || []).filter((r) => skipped.has(String(r.Id)));
      const lineIds = new Set();
      for (const d of page.details || []) {
        if (skipped.has(String(d.VoucherId))) { unnumbered.details.push(d); lineIds.add(String(d.Id)); }
      }
      unnumbered.rows.push(...rows);
      unnumbered.settledDetailIds.push(
        ...(page.settledDetailIds || []).filter((id) => lineIds.has(String(id))),
      );
      unnumbered.currencies = page.Currencies || unnumbered.currencies;
      unnumbered.voucherTypes = page.VoucherTypes || unnumbered.voucherTypes;
    }
    vProblems.withoutLines += (res.result.problems?.withoutLines || []).length;
    vProblems.unknownType += (res.result.problems?.unknownVoucherType || []).length;

    done += (page.rows || []).length;
    const pct = voucherTotal ? Math.round((done / voucherTotal) * 100) : 100;
    onProgress?.({ phase: 'vouchers', done, total: voucherTotal, percent: pct });
    report(`Ledger vouchers: ${done.toLocaleString()} of ${voucherTotal.toLocaleString()} (${pct}%)`);
  }

  report(
    `Ledger vouchers: ${apply ? 'created' : 'would create'} ${vAcc.created.toLocaleString()} `
    + `with ${vAcc.heads.toLocaleString()} head(s), ${(vAcc.alreadyImported || 0).toLocaleString()} `
    + `already imported. ${(vAcc.payable || 0).toLocaleString()} payable, `
    + `${(vAcc.receivable || 0).toLocaleString()} receivable.`
  );

  // Which screen they land on. Worth stating outright rather than leaving to
  // be discovered: a voucher settles a document or it does not, and only the
  // ones that do belong in Payments & Receipts.
  report(
    `Ledger vouchers: ${settling.toLocaleString()} settle an invoice or bill and go to `
    + `Payments & Receipts; the rest go to the Voucher List.`
  );

  if (vAcc.withoutParty) {
    report(
      `Ledger vouchers: ${vAcc.withoutParty.toLocaleString()} have no party. Bank and cash `
      + 'payments for expenses, transfers and journals genuinely have none, so this is expected '
      + 'to be a few thousand rather than zero.'
    );
  }
  if (vProblems.unnumbered) {
    await numberUnnumbered(unnumbered, { apply, report, vAcc });
  }
  if (vProblems.withoutLines) {
    report(
      `Ledger vouchers: ${vProblems.withoutLines} voucher(s) have no detail lines and were `
      + 'skipped - they move no money and name no party or account.'
    );
  }
  if (vAcc.unresolvedAccounts) {
    report(
      `Ledger vouchers: WARNING - ${vAcc.unresolvedAccounts.toLocaleString()} line(s) name an `
      + 'account that is not in the chart of accounts. Those heads import with no account, so '
      + 'they appear in no ledger. Check the Chart of Accounts stage ran.'
    );
  }
  if (vProblems.unknownType) {
    report(`Ledger vouchers: ${vProblems.unknownType} voucher(s) have an unrecognised voucher type.`);
  }

  /* ---------------------------------------------------------------- phase 2 */

  const sAcc = { created: 0, invoicesTouched: 0 };
  const sProblems = { unknownInvoice: 0, unknownVoucher: 0 };

  const firstS = await fetchPage(
    'getInvoiceAdjustments', { limit: SETTLEMENT_PAGE, offset: 0 }, 'ledger',
  );
  const settlementTotal = firstS.total || 0;
  report(`Ledger: ${settlementTotal.toLocaleString()} settlement(s) to apply.`);

  done = 0;
  for (let offset = 0; offset < settlementTotal; offset += SETTLEMENT_PAGE) {
    const page = offset === 0
      ? firstS
      : await fetchPage('getInvoiceAdjustments', { limit: SETTLEMENT_PAGE, offset }, 'ledger');

    const { data: res } = await axiosClient.post(
      apply ? '/ledgerMigration/settlements/apply' : '/ledgerMigration/settlements/plan',
      {
        rows: page.rows || [],
        // Which operational invoice each accounting-invoice id belongs to.
        // This join exists only in the legacy database - see the planner.
        invoiceRefs: page.invoices || [],
      },
    );

    addUp(sAcc, res.result, SETTLEMENT_KEYS);
    sAcc.invoicesTouched += res.result.invoicesTouched || 0;
    sProblems.unknownInvoice += (res.result.problems?.unknownInvoice || []).length;
    sProblems.unknownVoucher += (res.result.problems?.unknownVoucher || []).length;

    done += (page.rows || []).length;
    const pct = settlementTotal ? Math.round((done / settlementTotal) * 100) : 100;
    onProgress?.({ phase: 'settlements', done, total: settlementTotal, percent: pct });
    report(`Ledger settlements: ${done.toLocaleString()} of ${settlementTotal.toLocaleString()} (${pct}%)`);
  }

  report(
    `Ledger settlements: ${apply ? 'created' : 'would create'} ${sAcc.created.toLocaleString()}`
    + `, ${(sAcc.alreadyImported || 0).toLocaleString()} already imported`
    + `, ${(sAcc.settledToReceivable || 0).toLocaleString()} received and `
    + `${(sAcc.settledToPayable || 0).toLocaleString()} paid`
    + `, total ${Math.round(sAcc.totalSettled || 0).toLocaleString()}.`
  );

  if (sAcc.withoutInvoice) {
    report(
      `Ledger settlements: WARNING - ${sAcc.withoutInvoice.toLocaleString()} settlement(s) name an `
      + 'invoice that is not in Odyssey. That is money applied to nothing - check the Job '
      + 'Invoices stage completed.'
    );
  }
  if (sAcc.withoutVoucher) {
    report(
      `Ledger settlements: ${sAcc.withoutVoucher.toLocaleString()} settlement(s) name a voucher `
      + 'line that was not imported. Those are the vouchers skipped above.'
    );
  }
  if (sAcc.negativeAmount) {
    report(
      `Ledger settlements: ${sAcc.negativeAmount.toLocaleString()} settlement(s) are negative - `
      + 'reversals, carried across as they stand.'
    );
  }

  if (!apply) {
    report('Ledger: dry run - nothing was written.');
    return { planned: { vAcc, sAcc }, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  /* ---------------------------------------------------------------- verify */

  report('Ledger: verifying...');
  const { data: verifyRes } = await axiosClient.get('/ledgerMigration/verify');
  const v = verifyRes.result;

  report(
    `Ledger: ${v.migratedVouchers.toLocaleString()} voucher(s) with `
    + `${v.voucherHeads.toLocaleString()} head(s) and ${v.transactions.toLocaleString()} `
    + 'settlement transaction(s).'
  );
  report(
    `Ledger: ${v.settledInvoices.toLocaleString()} invoice(s) now carry a settlement, `
    + `${v.unsettledInvoices.toLocaleString()} do not. Received ${Math.round(v.totalReceived).toLocaleString()}, `
    + `paid ${Math.round(v.totalPaid).toLocaleString()}. Reconcile those against `
    + 'GL_InvoiceBalance.SettledAmount.'
  );

  if (v.unbalancedVouchers) {
    report(
      `Ledger: WARNING - ${v.unbalancedVouchers.toLocaleString()} voucher(s) have debits and `
      + 'credits that do not match. The trial balance cannot reconcile those.'
    );
    for (const e of v.unbalancedExamples || []) {
      report(`    legacy voucher ${e.climaxId}: debit ${e.debit}, credit ${e.credit}`);
    }
  }
  if (v.bothSidesMoved) {
    report(
      `Ledger: WARNING - ${v.bothSidesMoved.toLocaleString()} invoice(s) have both paid AND `
      + 'recieved set. Those are the old importer’s signature and need re-importing.'
    );
  }
  if (v.transactionsWithoutInvoice || v.transactionsWithoutVoucher) {
    report(
      `Ledger: WARNING - ${v.transactionsWithoutInvoice.toLocaleString()} transaction(s) point at `
      + `no invoice and ${v.transactionsWithoutVoucher.toLocaleString()} at no voucher.`
    );
  }
  if (v.vouchersWithoutHeads) {
    report(`Ledger: ${v.vouchersWithoutHeads.toLocaleString()} voucher(s) have no heads.`);
  }
  if (v.headsWithoutAccount) {
    report(
      `Ledger: ${v.headsWithoutAccount.toLocaleString()} head(s) have no account, so they appear `
      + 'in no ledger.'
    );
  }
  if (v.overSettled) {
    report(
      `Ledger: ${v.overSettled.toLocaleString()} invoice(s) are settled beyond their own total. `
      + 'That is a real state for an overpayment, but worth checking:'
    );
    for (const e of v.overSettledExamples || []) {
      report(`    legacy ${e.type} ${e.climaxId}: total ${e.total}, settled ${e.settled}`);
    }
  }
  if (v.duplicateClimaxIdCount) {
    report(`Ledger: WARNING - ${v.duplicateClimaxIdCount} legacy voucher id(s) imported twice.`);
  }

  const created = vAcc.created + sAcc.created;

  return {
    planned: { vAcc, sAcc },
    applied: { vAcc, sAcc },
    verification: v,
    noop: created === 0,
    reason: created === 0 ? 'Every voucher and settlement was already imported.' : null,
  };
}

/**
 * Number and import the vouchers Climax never numbered - AFTER every numbered
 * voucher is in, so each fills the gap it sits in (SNS's TV of 7 Mar 2024
 * becomes SNS-TV-00031/24, between 00030 and 00034) and cannot take a number a
 * later page would have brought. BEFORE the settlement phase, which may point
 * at their lines. The server decides the numbers; see assignGapNumbers.
 */
async function numberUnnumbered(unnumbered, { apply, report, vAcc }) {
  const count = unnumbered.rows.length;
  if (!apply) {
    // A dry run has imported nothing, so there is no sequence yet to find a
    // gap in. Say what will happen rather than inventing numbers.
    report(
      `Ledger vouchers: ${count} voucher(s) have no number in Climax. On import, each is `
      + 'numbered into the gap it sits in, after every numbered voucher is in.'
    );
    return;
  }

  const { data: res } = await axiosClient.post('/ledgerMigration/vouchers/numberUnnumbered', {
    ...unnumbered,
    apply: true,
  });
  const r = res.result;

  vAcc.created += r.created || 0;
  vAcc.heads += r.heads || 0;

  report(
    `Ledger vouchers: ${count} voucher(s) had no number in Climax; ${r.assigned.length} numbered `
    + `into their gap and imported (${r.created} voucher(s), ${r.heads} head(s)).`
  );
  for (const a of r.assigned) report(`    legacy voucher ${a.legacyId} -> ${a.VoucherNo}`);
  if (r.unresolved.length) {
    report(
      `Ledger vouchers: WARNING - ${r.unresolved.length} could not be numbered and were NOT `
      + 'imported. Enter them by hand:'
    );
    for (const u of r.unresolved) report(`    legacy voucher ${u.legacyId}: ${u.reason}`);
  }
}

export const planLedgerOnly = (report, options = {}) =>
  migrateLedger(report, { ...options, apply: false });

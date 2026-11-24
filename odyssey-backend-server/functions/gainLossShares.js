/**
 * EACH INVOICE'S SHARE OF ITS RECEIPT'S OR PAYMENT'S EXCHANGE GAIN/LOSS.
 *
 * Invoice_Transactions.gainLoss holds the VOUCHER's whole gain/loss on every
 * invoice it knocks off (routes/voucher makeTransaction writes
 * req.body.gainLoss on each line). The Job P&L added it per line, so a
 * receipt settling nine invoices put its gain/loss on the jobs nine times:
 * SNS-BRV-356/27, -64,303.36 once in the ledger, -578,730 across the report
 * (the user, 2026-11-20: "job PnL has some calculation errors").
 *
 * The share is by each line's own rate difference - what made the gain or
 * loss on it:
 *     receivable   (voucher rate - invoice rate) x amount
 *     payable      (invoice rate - voucher rate) x amount
 * (positive is a gain), scaled so the lines add up to the voucher's stored
 * figure exactly - the one the ledger has. Checked on SNS's copy: the stored
 * totals ARE those sums. A PKR invoice has no exchange difference (its
 * ex_rate may be the charges' USD rate - functions/invoiceRate). Where the
 * rates give nothing to divide by, the split is by amount.
 *
 * Lines whose stored figures DIFFER already carry their own (not one total
 * repeated) and are left as they are.
 *
 * Pure - unit tested; voucherGainLossShares reads the lines.
 */
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const SAME = 0.005;

const weightOf = (l) => {
  if (String(l.currency || 'PKR').toUpperCase() === 'PKR') return 0;
  const diff = num(l.voucherRate) - num(l.invoiceRate);
  return (l.payType === 'Payble' ? -diff : diff) * num(l.amount);
};

/**
 * @param lines [{ id, voucherId, stored, amount, invoiceRate, voucherRate, currency, payType }]
 *              - EVERY line of each voucher, not only the report's
 * @returns Map(line id -> { stored, share })
 */
function gainLossShares(lines = []) {
  const byVoucher = new Map();
  for (const l of lines) {
    if (!byVoucher.has(l.voucherId)) byVoucher.set(l.voucherId, []);
    byVoucher.get(l.voucherId).push(l);
  }
  const out = new Map();
  for (const ls of byVoucher.values()) {
    const stored = ls.map((l) => num(l.stored));
    const total = stored[0];
    const repeated = stored.every((s) => Math.abs(s - total) < SAME);
    if (!repeated || ls.length === 1) {
      ls.forEach((l, i) => out.set(l.id, { stored: stored[i], share: stored[i] }));
      continue;
    }
    const weights = ls.map(weightOf);
    const sum = weights.reduce((a, b) => a + b, 0);
    const amounts = ls.map((l) => Math.abs(num(l.amount)));
    const amountSum = amounts.reduce((a, b) => a + b, 0);
    ls.forEach((l, i) => {
      let share;
      if (Math.abs(sum) > 1e-9) share = total * (weights[i] / sum);
      else if (amountSum > 0) share = total * (amounts[i] / amountSum);
      else share = total / ls.length;
      out.set(l.id, { stored: stored[i], share });
    });
  }
  return out;
}

/** The lines of these vouchers, all of them, and their shares. */
async function voucherGainLossShares(sequelize, voucherIds) {
  const ids = [...new Set((voucherIds || []).map((v) => parseInt(v, 10)).filter(Number.isFinite))];
  if (!ids.length) return new Map();
  const [rows] = await sequelize.query(`
    SELECT it.id, it."VoucherId" AS "voucherId", it."gainLoss" AS stored, it.amount,
           i.ex_rate AS "invoiceRate", i.currency, i."payType", v."exRate" AS "voucherRate"
    FROM "Invoice_Transactions" it
    JOIN "Invoices" i ON i.id = it."InvoiceId"
    JOIN "Vouchers" v ON v.id = it."VoucherId"
    WHERE it."VoucherId" IN (:ids)`, { replacements: { ids } });
  return gainLossShares(rows);
}

/**
 * The Job P&L's rows with each transaction's gain/loss its own share. A
 * row's figure may already be part of the line's (an invoice split across
 * jobs - customs and aviation multiply by the job's part), so it is scaled,
 * not replaced: share x (figure / stored).
 */
async function withGainLossShares(sequelize, rows) {
  const lines = [];
  for (const r of rows || []) {
    for (const inv of r.Invoices || []) {
      for (const t of inv.Invoice_Transactions || []) {
        if (num(t.gainLoss) !== 0 && t.VoucherId != null) lines.push(t);
      }
    }
  }
  if (!lines.length) return rows;
  const shares = await voucherGainLossShares(sequelize, lines.map((t) => t.VoucherId));
  for (const t of lines) {
    const s = shares.get(t.id);
    if (!s || !s.stored) continue;
    t.gainLoss = String(s.share * (num(t.gainLoss) / s.stored));
  }
  return rows;
}

module.exports = { gainLossShares, voucherGainLossShares, withGainLossShares, weightOf };

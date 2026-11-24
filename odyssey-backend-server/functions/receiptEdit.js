/**
 * WHAT A PAYMENT OR RECEIPT CHANGES ON AN INVOICE'S received / paid.
 *
 * A new one adds what it knocks off. An EDITED one used to SET the invoice's
 * received / paid to its own share - wiping whatever every other receipt had
 * paid on that invoice, Climax's included. On SNS (copy of 2026-11-05) that
 * left seven invoices short, and it has already cost money: ACS-JB-655/27
 * (Qatar Airways) read 1,055,510 unpaid after ADJ-P-39 was edited, and was
 * paid that again by ADJ-P-44. Hasnain Cargo's Job Balancing stood 484,643.90
 * above its ledger from two edits on 2026-11-04 (the user's report).
 *
 * Now an edit adds the DIFFERENCE: this save's share less what the voucher
 * carried against the invoice before - read from its own settlement rows
 * before they are replaced. A new voucher carried nothing, so it adds the
 * whole share, as it always did; an invoice taken off the receipt (share 0)
 * gives back what the receipt had paid on it.
 */
const { toCents } = require('./invoiceOwed');

/** What a voucher already carried against each invoice: InvoiceId (string) -> amount. */
async function priorShares(Invoice_Transactions, voucherId, transaction) {
  const shares = new Map();
  if (voucherId === undefined || voucherId === null || voucherId === '') return shares;
  const rows = await Invoice_Transactions.findAll({
    where: { VoucherId: voucherId }, attributes: ['InvoiceId', 'amount'], transaction,
  });
  for (const row of rows) {
    const key = String(row.InvoiceId);
    shares.set(key, toCents((shares.get(key) || 0) + Number(row.amount || 0)));
  }
  return shares;
}

/** What to add to the invoice's received / paid: this save's share less the voucher's earlier one. */
const settlementChange = (receiving, prior = 0) => toCents(toCents(receiving) - toCents(prior));

module.exports = { priorShares, settlementChange };

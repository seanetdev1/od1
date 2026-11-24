/**
 * The Voucher List's Net Amount (the user's request, 2026-10-26, after the
 * Voucher screen got Climax's Debit / Credit / Net Amount in v1.2.78).
 *
 * What a payment's bank or cash paid out, or a receipt's took in: its bank /
 * cash lines (accountType 'payAccount') on the voucher's own side - credit on
 * a BPV / CPV, debit on a BRV / CRV. On a voucher saved here that IS the
 * screen's Net Amount, because the screen makes the line from the other
 * lines' net (settlementAmount on the front end). A salary of 100,000 paid
 * with a 20,000 loan instalment held back reads 80,000, where the list's
 * Amount (the debit lines) reads 100,000.
 *
 * READ FROM THE LINE, not worked out from the others, because of how Climax
 * booked some. On the SNS copy 902 migrated payments and receipts are cash
 * drawn from or paid into the bank with BOTH lines marked bank / cash - the
 * others net to 0 - and one pays 25,000 of its 90,000 into another bank
 * account, which the others would put at 65,000.
 *
 * null for every other voucher - a journal, transfer, invoice, note or
 * opening balance has no bank or cash side, and nets to zero (every voucher on
 * the SNS copy balances).
 */
const PAYMENTS = new Set(['BPV', 'CPV']);
const RECEIPTS = new Set(['BRV', 'CRV']);

const vTypeOf = (vType) => String(vType || '').trim().toUpperCase();

const isPaymentOrReceipt = (vType) => PAYMENTS.has(vTypeOf(vType)) || RECEIPTS.has(vTypeOf(vType));

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

/** heads: [{ type, amount, defaultAmount, accountType }] -> { amount, amountPkr } or null. */
function netAmount(vType, heads = []) {
  if (!isPaymentOrReceipt(vType)) return null;
  const side = RECEIPTS.has(vTypeOf(vType)) ? 'debit' : 'credit';
  const bank = heads.filter((h) => h && h.accountType === 'payAccount' && h.type === side);
  if (!bank.length) return null;
  return {
    amount: round2(bank.reduce((t, h) => t + num(h.amount), 0)),
    amountPkr: round2(bank.reduce((t, h) => t + num(h.defaultAmount), 0)),
  };
}

module.exports = { netAmount, isPaymentOrReceipt };

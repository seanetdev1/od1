/**
 * CHEQUE RETURN - a bank payment or receipt whose cheque came back.
 *
 * Payments & Receipts > open the voucher > Cheque Return > Approve & Save
 * (the user's request, 2026-10-13). The return is its own voucher, CR, dated
 * the day the cheque came back, as Climax kept them ("CHEQUE RETURN",
 * "Reversal: Received Cheque # ..."). It does not touch the original: the
 * ledger shows the money arriving and then going back out.
 *
 *   - its lines are the original's, each on the other side - so a receipt's
 *     bank debit becomes a bank credit and the party is debited again, and any
 *     gain/loss, bank charge or tax line on it is undone with it;
 *   - the invoices the original settled are reopened by what it settled on
 *     each - routes/voucher /chequeReturn;
 *   - the original is marked by the return's returnOfId: it cannot be returned
 *     twice, edited or deleted, and the return cannot be deleted either.
 *
 * Only a bank voucher (BRV / BPV): a cash one has no cheque, and an
 * adjustment (ADJ-R / ADJ-P) moves nothing through a bank.
 *
 * No database - unit tested.
 */
const RETURN_VTYPE = 'CR';
const RETURN_TYPE = 'CHEQUE RETURN';
const BANK_VTYPES = ['BRV', 'BPV'];
const PAY_REC_TYPES = ['Job Reciept', 'Job Payment'];

/** Why this voucher's cheque cannot be returned - or null when it can. */
function returnRefusal(voucher, existingReturn) {
  if (!voucher) return 'Voucher not found.';
  if (voucher.vType === RETURN_VTYPE || voucher.returnOfId) return `${voucher.voucher_Id} is a cheque return itself.`;
  if (!PAY_REC_TYPES.includes(voucher.type)) return `${voucher.voucher_Id} is not a payment or receipt.`;
  if (!BANK_VTYPES.includes(String(voucher.vType || '').toUpperCase())) {
    return `Only a bank payment or receipt has a cheque to return - ${voucher.voucher_Id} is ${voucher.vType}.`;
  }
  if (existingReturn) return `This cheque was already returned - ${existingReturn.voucher_Id}.`;
  return null;
}

/** The return's narration - the original's, as Climax wrote it. */
const returnNarration = (voucher) => `Reversal: ${voucher.voucherNarration || voucher.voucher_Id}`;

/** The original's lines, each on the other side, at the same amounts and accounts. */
function returnLines(heads, narration) {
  return (Array.isArray(heads) ? heads : []).map((h) => ({
    amount: h.amount,
    defaultAmount: h.defaultAmount,
    type: h.type === 'debit' ? 'credit' : 'debit',
    accountType: h.accountType,
    ChildAccountId: h.ChildAccountId,
    narration,
  }));
}

/** Why an edit or delete of this payment or receipt is refused: its cheque was returned. */
const returnedRefusal = (returned) => (returned
  ? `This cheque was returned - ${returned.voucher_Id}. A returned payment or receipt cannot be changed or deleted.`
  : null);

module.exports = {
  RETURN_VTYPE, RETURN_TYPE, BANK_VTYPES,
  returnRefusal, returnNarration, returnLines, returnedRefusal,
};

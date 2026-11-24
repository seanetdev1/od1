/**
 * WHY A SEARCHED INVOICE IS NOT ON THE PAYMENTS & RECEIPTS LIST, in words.
 *
 * The server says which condition kept it off (functions/invoiceNotListed
 * there); this says it to the operator. From SNS (2026-11-16): SNS-AI-620/26
 * was searched for on a payment to its party and was "not found" - it had
 * been paid in full by SNS-ADJ-P-31/27, and nothing said so.
 */

/** What this voucher is, by its side. */
const voucherWord = (payType) => {
  if (payType === 'Payble') return 'payment';
  if (payType === 'Recievable') return 'receipt';
  return 'voucher';
};

/**
 * One line for one invoice the list left off.
 * @param item  { invoice_No, party_Name, payType, currency, reason, settledBy }
 * @param ctx   { currency, payType } - this voucher's
 */
export function notListedText(item, { currency, payType } = {}) {
  const no = item?.invoice_No || 'This invoice';
  switch (item?.reason) {
    case 'settled': {
      const by = (item.settledBy || []).filter(Boolean);
      const done = item.payType === 'Payble' ? 'paid' : 'received';
      return `${no} is already ${done} in full${by.length ? ` - by ${by.join(', ')}` : ''}.`;
    }
    case 'otherCurrency':
      return `${no} is in ${item.currency} - this ${voucherWord(payType)} is in ${currency}.`;
    case 'otherSide':
      return item.payType === 'Payble'
        ? `${no} is a bill (payable) - make a payment for it, not a receipt.`
        : `${no} is an invoice (receivable) - make a receipt for it, not a payment.`;
    case 'unapproved':
      return `${no} is not approved yet.`;
    case 'otherParty':
      return `${no} is against ${item.party_Name || 'another party'}, not this one.`;
    default:
      return null;
  }
}

/** The lines for every invoice the server explained, in its order. */
export const notListedLines = (items, ctx) => (items || [])
  .map((item) => notListedText(item, ctx))
  .filter(Boolean);

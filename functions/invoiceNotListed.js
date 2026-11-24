/**
 * WHY A SEARCHED INVOICE IS NOT ON THE PAYMENTS & RECEIPTS LIST.
 *
 * Found on SNS (2026-11-16): SNS-AI-620/26 showed on its job, and searching
 * its number on a payment for the party said only "No outstanding invoice for
 * this party matches". It had been paid in full on 23 October, by
 * SNS-ADJ-P-31/27 - the list is of what is still owed, so it was right to
 * leave it off, but nothing on the screen said so, and the invoice read as
 * lost.
 *
 * So when a search finds nothing, the route looks the number up again with
 * none of the list's conditions and says, for each invoice it finds, which
 * condition kept it off. The first that applies, in this order - a
 * different party makes the rest beside the point:
 *
 *   otherParty     raised against someone else
 *   unapproved     not approved, so not in the books to pay
 *   otherSide      a bill on a receipt, or an invoice on a payment
 *   otherCurrency  in another currency than this voucher's
 *   settled        nothing left on it (functions/invoiceOwed, the list's own
 *                  rule)
 *
 * None of them: it should have been listed, and is not explained - left out.
 *
 * No model imports - unit tested.
 */
const { isOwed } = require('./invoiceOwed');

/**
 * @param invoice  an Invoice row (plain or a model)
 * @param ctx      { partyIds: the ids the list matched party_Id on,
 *                   pay: 'Recievable' | 'Payble' | 'Both' | undefined,
 *                   currency: the voucher's }
 * @returns the reason, or null
 */
function whyNotListed(invoice, { partyIds = [], pay, currency } = {}) {
  if (!invoice) return null;
  if (!partyIds.map(String).includes(String(invoice.party_Id))) return 'otherParty';
  if (String(invoice.approved) !== '1') return 'unapproved';
  if (pay && pay !== 'Both' && invoice.payType !== pay) return 'otherSide';
  if (currency && invoice.currency !== currency) return 'otherCurrency';
  if (!isOwed(invoice)) return 'settled';
  return null;
}

/**
 * The invoices a search found off the list, each with its reason - and, when
 * settled, the vouchers that settled it (voucher numbers, in the order given).
 * @param settledBy  Map of invoice id -> [voucher numbers]
 */
function notListed(invoices, ctx, settledBy = new Map()) {
  return (invoices || [])
    .map((inv) => ({ inv, reason: whyNotListed(inv, ctx) }))
    .filter((x) => x.reason)
    .map(({ inv, reason }) => ({
      id: inv.id,
      invoice_No: inv.invoice_No,
      party_Name: inv.party_Name,
      payType: inv.payType,
      currency: inv.currency,
      reason,
      ...(reason === 'settled' ? { settledBy: settledBy.get(inv.id) || [] } : {}),
    }));
}

module.exports = { whyNotListed, notListed };

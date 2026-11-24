const { Op } = require('sequelize');

/**
 * What ADJUSTMENT vouchers settled on an invoice - the print's "Adjustment",
 * between Received (or Paid) and Balance, as Climax printed it.
 *
 * Every settlement against an invoice is an Invoice_Transactions row on the
 * voucher that made it. Receipts and payments are BRV / CRV / BPV / CPV; an
 * adjustment is an ADJ-R / ADJ-P voucher (the Direct Job E/R adjustments, and
 * Climax's, migrated - see functions/invoiceSettlement). The invoice's
 * recieved / paid already includes both, so the print takes this off it to show
 * Received and Adjustment apart; the Balance is the total less all of it.
 *
 * Rounded to the paisa; 0 when there is none.
 */
async function invoiceAdjustment({ Invoice_Transactions, Vouchers }, invoiceId) {
  if (!invoiceId) return 0;
  const rows = await Invoice_Transactions.findAll({
    where: { InvoiceId: invoiceId },
    attributes: ['amount'],
    include: [{ model: Vouchers, attributes: [], where: { vType: { [Op.like]: 'ADJ%' } }, required: true }],
  });
  return Math.round(rows.reduce((t, r) => t + (parseFloat(r.amount) || 0), 0) * 100) / 100;
}

module.exports = { invoiceAdjustment };

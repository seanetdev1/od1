/**
 * Payments & Receipts' voucher list rows, from the server's vouchers
 * (routes/voucher getAllJobPayRecVouchers). One function for the list and for
 * a voucher opened by its address, so the two open alike (2026-11-20).
 *
 * Each voucher's invoices get `receiving` - what this voucher knocked off each
 * one (its Invoice_Transactions) - and `constReceiving`, the same, kept.
 *
 * No React - unit tested.
 */
const PARTY_HEADS = ['partyAccount', 'General', 'Admin Expense'];

export function voucherRows(result) {
  const list = Array.isArray(result) ? result : [];
  for (const x of list) {
    for (const y of x.invoice || []) {
      y.receiving = 0;
      for (const z of x.Invoice_Transactions || []) {
        if (z.InvoiceId == y.id) y.receiving += parseFloat(z.amount);
      }
      y.constReceiving = y.receiving;
    }
  }
  return list.map((x) => ({
    id: x.id,
    voucherNo: x.voucher_Id,
    name: x.partyName,
    party: x.partyType,
    type: x.vType,
    data: x.createdAt,
    currency: x.currency,
    amount: (x.Voucher_Heads || [])
      .filter((y) => PARTY_HEADS.includes(y.accountType) && y.ChildAccountId === x.clientAssociation?.ChildAccountId)
      .reduce((sum, y) => sum + Number(y.amount || 0), 0) || 0,
    partyId: x.partyId,
    x,
  }));
}

/**
 * CHEQUE RETURN on Payments & Receipts - whether the open voucher can have its
 * cheque returned, and the CR's lines as the dialog previews them.
 *
 * The server decides (functions/chequeReturn there) and posts; this only
 * greys the toolbar button with the reason, and shows what Approve & Save
 * will post. Only a bank payment or receipt (BRV / BPV), and only once.
 *
 * No React - unit tested.
 */
const BANK_VTYPES = ['BRV', 'BPV'];

/** The toolbar's Cheque Return: { available, title }, and the return that holds it, if any. */
export function chequeReturnState(voucher) {
  if (!voucher) return { available: false, title: 'Open a voucher first' };
  if (voucher.returnedBy) {
    return { available: false, returnedBy: voucher.returnedBy, title: `Cheque already returned - ${voucher.returnedBy}` };
  }
  const vType = String(voucher.vType || '').toUpperCase();
  if (!BANK_VTYPES.includes(vType)) {
    return { available: false, title: `Only a bank payment or receipt has a cheque to return - this is ${voucher.vType || 'not one'}` };
  }
  return { available: true, title: 'Return this cheque - posts a CR reversing it' };
}

/** The voucher's lines, each on the other side - what the CR will post. */
export function returnPreview(heads) {
  return (Array.isArray(heads) ? heads : []).map((h) => {
    const amount = parseFloat(h.amount) || 0;
    const debit = h.type !== 'debit';
    return {
      account: h.Child_Account?.title || `Account ${h.ChildAccountId}`,
      accountType: h.accountType,
      debit: debit ? amount : 0,
      credit: debit ? 0 : amount,
    };
  });
}

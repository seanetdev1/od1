/**
 * Which invoices and bills a set of ticked charge lines belongs to, sorted by
 * what approving or unapproving them would mean.
 *
 * Editing a clearing job that has been invoiced means taking its documents out
 * of the books first: an approved invoice freezes its charges (functions/
 * invoiceLock on the server). One at a time that is a trip to each invoice and
 * back; the charge sheet does it in one action for the documents behind the
 * ticked lines, and approves them again once the edit is done.
 *
 * DISTINCT DOCUMENTS, not lines - one invoice carries several charges, and is
 * approved or unapproved once however many of them are ticked.
 *
 * A SETTLED document is set apart, never unapproved. Unapproving deletes its
 * voucher, and the receipt or payment that settled it would stay in the books
 * against nothing. The invoice screen refuses the same thing, and so does the
 * server (/invoice/unApprove) - this only says so before anyone presses.
 *
 * Pure, and free of the screen, so the rules are tested on their own.
 *
 * @param charges      the job's charge lines, each with its Invoice when billed
 * @param selectedIds  the ticked Charge_Head ids
 * @returns {{ toUnapprove, toApprove, settled }} each [{ id, invoice_No, type }]
 */
const isOn = (v) => String(v) === '1' || v === true;

export const isSettled = (invoice) => {
  if (!invoice) return false;
  const settledBy = invoice.payType === 'Recievable' ? invoice.recieved : invoice.paid;
  return (parseFloat(settledBy) || 0) !== 0;
};

export function invoiceApprovalTargets(charges, selectedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const seen = new Set();
  const toUnapprove = [];
  const toApprove = [];
  const settled = [];

  for (const c of charges || []) {
    if (!c || c.id == null || !selected.has(c.id)) continue;
    const inv = c.Invoice;
    const id = inv?.id ?? c.InvoiceId;
    if (id == null || seen.has(String(id))) continue;
    seen.add(String(id));

    const doc = { id, invoice_No: inv?.invoice_No || String(id), type: inv?.type || '' };
    if (isOn(inv?.approved)) {
      (isSettled(inv) ? settled : toUnapprove).push(doc);
    } else {
      toApprove.push(doc);
    }
  }

  return { toUnapprove, toApprove, settled };
}

/**
 * The ticked charges that are already on an invoice, and that invoice's
 * number(s) - for the freight charge sheet's Auto Invoice / Auto Bill / Auto
 * Agent Invoice buttons.
 *
 * Invoicing them again used to MOVE them: the server wrote each line onto the
 * new document, so the first invoice silently lost it and the charge was
 * billed twice. Now a selection holding one is refused outright, here and on
 * the server (/invoice/makeInvoiceNew), which reads the database rather than
 * trusting this copy of the sheet.
 *
 * No React - unit tested.
 */
export function alreadyInvoiced(charges) {
  const billed = (charges || []).filter((x) => x && (x.invoice_id || x.InvoiceId));
  return {
    count: billed.length,
    numbers: [...new Set(billed.map((x) => x.invoice_id).filter(Boolean))],
  };
}

/** The refusal, said the way the screen says it. Null when there is none. */
export function alreadyInvoicedMessage(charges) {
  const { count, numbers } = alreadyInvoiced(charges);
  if (!count) return null;
  return `${count} of the ticked charges ${count === 1 ? 'is' : 'are'} already invoiced`
    + (numbers.length ? ` (${numbers.join(', ')})` : '')
    + '. Untick them, or take them off that invoice first.';
}

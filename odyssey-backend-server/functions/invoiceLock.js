/**
 * Is this charge FROZEN by the invoice it sits on?
 *
 * BEING ON AN INVOICE IS NOT THE SAME AS BEING FROZEN BY ONE. An APPROVED
 * invoice has been posted to the ledger and issued, so rewriting its charges
 * would change what an issued document says. Unapproving it destroys the
 * voucher and takes it back out of the books - at which point there is nothing
 * left for the figures to contradict, and correcting them is the whole reason
 * somebody unapproved it.
 *
 * The charge KEEPS its InvoiceId throughout, so it stays on that invoice and is
 * re-approved onto the same document rather than onto a new one; approveInvoice
 * recomputes the total from the charges, so the corrected figures are what get
 * posted.
 *
 * A charge with an InvoiceId whose invoice could not be loaded is treated as
 * FROZEN. Guessing "unapproved" there would open an issued document for
 * editing, and the whole point of this rule is that it errs the safe way.
 *
 * ONE COPY, THREE CALLERS. Aviation has enforced this since AWBs were first
 * invoiceable; customs asked for it later, and the freight side will want it
 * eventually. A second copy of a rule about what may be rewritten in the ledger
 * is not a duplicate that might drift, it is one that WILL - and the two halves
 * would then disagree about whether an issued document can be edited, which is
 * not a disagreement anybody would notice until an auditor did.
 *
 * Mirrored in the frontend by isInvoiceLocked in functions/aviationPricing and
 * functions/customsPricing, which grey the row. THIS is what refuses the write.
 */
const isInvoiceLocked = (charge, invoice) => {
  if (!charge?.InvoiceId) return false;
  const inv = invoice ?? charge.Invoice ?? null;
  return String(inv?.approved ?? '1') === '1';
};

module.exports = { isInvoiceLocked };

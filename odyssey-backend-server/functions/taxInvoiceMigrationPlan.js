/**
 * Legacy GST invoice numbers -> Sales_Tax_Invoice, for the customs migration.
 * Pure, so it can be tested without a database.
 *
 * GL_JobInvoice_TaxInvoice gives each client invoice that carried sales tax
 * the number its Sale Tax Invoice was issued under (CL-24295). The invoice is
 * found through Invoice.climaxId - the legacy GL_JobInvoice.Id - among CLIENT
 * invoices only: a vendor bill's climaxId counts in a different table's ids.
 *
 * The number is brought across exactly as issued, duplicates included (the
 * legacy system gave 29 numbers to two invoices each) - see the index note on
 * models/Sales_Tax_Invoice. What cannot be placed is reported, never guessed:
 *   invoiceNotFound  no client invoice with that legacy id
 *   ambiguous        more than one - the same invoice imported twice
 *   alreadyNumbered  the invoice has its number already (a re-run)
 */

const key = (v) => (v === null || v === undefined ? '' : String(v));

/** The sequence in a GST number - "CL-24295" -> 24295, "CL-001" -> 1. */
const seqOf = (no) => {
  const m = String(no || '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
};

/**
 * @param rows  [{ Id, JobInvoiceId, TaxInvoiceNo }] from /jobs/getTaxInvoiceNumbers
 * @param ctx
 *   invoicesByLegacyId  Map legacy GL_JobInvoice.Id -> [{ id, companyId }]
 *   numberedInvoiceIds  Set of Invoice ids that already have a number
 */
function planTaxInvoiceNumbers(rows = [], ctx = {}) {
  const { invoicesByLegacyId = new Map(), numberedInvoiceIds = new Set() } = ctx;
  const toCreate = [];
  const problems = { invoiceNotFound: [], ambiguous: [], alreadyNumbered: 0, badNumber: [] };
  const planned = new Set();

  for (const r of rows) {
    const no = String(r.TaxInvoiceNo || '').trim();
    const seq = seqOf(no);
    if (!no || seq === null) { problems.badNumber.push(`${r.Id}: ${no}`); continue; }

    const matches = invoicesByLegacyId.get(key(r.JobInvoiceId)) || [];
    if (!matches.length) { problems.invoiceNotFound.push(no); continue; }
    if (matches.length > 1) { problems.ambiguous.push(no); continue; }

    const invoice = matches[0];
    if (numberedInvoiceIds.has(invoice.id) || planned.has(invoice.id)) { problems.alreadyNumbered += 1; continue; }
    planned.add(invoice.id);

    toCreate.push({
      taxInvoiceNo: no,
      seq,
      CompanyId: invoice.companyId === null || invoice.companyId === undefined ? null : Number(invoice.companyId),
      InvoiceId: invoice.id,
      climaxId: r.Id,
    });
  }
  return { toCreate, problems };
}

module.exports = { planTaxInvoiceNumbers, seqOf };

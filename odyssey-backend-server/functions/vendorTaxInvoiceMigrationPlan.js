/**
 * Legacy vendor tax invoice numbers -> Invoice.vendorTaxInvoiceNo, for the
 * customs migration (the user's request, 2026-10-14). Pure, so it can be
 * tested without a database.
 *
 * GL_JobBill.VendorTaxInvoiceNo is the number on the tax invoice a vendor sent
 * for a bill (QICT's "QITE0003124223", KICT's "IN260129732"). The bill is found
 * through Invoice.climaxId - the legacy GL_JobBill.Id - among VENDOR BILLS only:
 * a client invoice's climaxId counts in GL_JobInvoice's ids, which overlap.
 *
 * Nothing typed in Odyssey is overwritten. What cannot be placed is reported,
 * never guessed:
 *   billNotFound   no bill with that legacy id - run Clearing Invoices first
 *   ambiguous      more than one - the same bill imported twice
 *   wrongBill      the bill found has another number than the legacy one
 *                  (JB-8011/27 vs ...) - not this bill after all
 *   alreadySet     the bill has this number already (a re-run)
 *   different      the bill has a DIFFERENT number, typed in Odyssey - kept
 */
const key = (v) => (v === null || v === undefined ? '' : String(v));
const clean = (v) => key(v).replace(/\s+/g, ' ').trim();

/**
 * @param rows  [{ Id, TranNumber, VendorTaxInvoiceNo }] from /jobs/getVendorTaxInvoiceNumbers
 * @param ctx   billsByLegacyId  Map legacy GL_JobBill.Id -> [{ id, invoice_No, vendorTaxInvoiceNo }]
 */
function planVendorTaxInvoiceNumbers(rows = [], ctx = {}) {
  const { billsByLegacyId = new Map() } = ctx;
  const toUpdate = [];
  const problems = { billNotFound: [], ambiguous: [], wrongBill: [], different: [], alreadySet: 0, noNumber: 0 };
  const planned = new Set();
  for (const r of rows) {
    const no = clean(r.VendorTaxInvoiceNo);
    if (!no) { problems.noNumber += 1; continue; }
    const label = clean(r.TranNumber) || `GL_JobBill ${r.Id}`;
    const matches = billsByLegacyId.get(key(r.Id)) || [];
    if (!matches.length) { problems.billNotFound.push(label); continue; }
    if (matches.length > 1) { problems.ambiguous.push(label); continue; }
    const bill = matches[0];
    if (clean(r.TranNumber) && clean(bill.invoice_No) && clean(r.TranNumber) !== clean(bill.invoice_No)) {
      problems.wrongBill.push(`${label} (Odyssey ${bill.invoice_No})`);
      continue;
    }
    const current = clean(bill.vendorTaxInvoiceNo);
    if (current === no || planned.has(bill.id)) { problems.alreadySet += 1; continue; }
    if (current) { problems.different.push(`${bill.invoice_No}: ${current} (legacy ${no})`); continue; }
    planned.add(bill.id);
    toUpdate.push({ id: bill.id, vendorTaxInvoiceNo: no });
  }
  return { toUpdate, problems };
}

module.exports = { planVendorTaxInvoiceNumbers };

/**
 * The GST (sales tax) invoice number - see models/Sales_Tax_Invoice.
 *
 * An invoice gets one when it is APPROVED carrying at least one taxed
 * receivable line: a charge whose Tax box is ticked (Setup > Charges supplies
 * the rate) and whose tax came to something. Those lines are exactly what the
 * Sale Tax Invoice prints.
 *
 * Numbered per company, continuing from the highest number the company has -
 * migrated legacy numbers included - so CargoLinkers' next number follows the
 * last one the legacy system issued rather than starting again at 1.
 */

const { formatGstNumber, readGstFormat } = require('./gstNumberFormat');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const isTaxedFlag = (v) => v === true || v === 'true' || v === 1 || v === '1';

/** A line that goes on the Sale Tax Invoice. */
const isSalesTaxLine = (c) =>
  c && c.type === 'Recievable' && isTaxedFlag(c.tax_apply) && num(c.tax_amount) > 0;

/** Does this invoice, with these lines, need a GST invoice number? */
const needsTaxInvoiceNo = (invoice, charges) =>
  invoice?.payType === 'Recievable' && (charges || []).some(isSalesTaxLine);

/** The sequence in a GST number - "CL-24295" -> 24295, "CL-001" -> 1. */
const seqFrom = (taxInvoiceNo) => {
  const m = String(taxInvoiceNo || '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
};

/**
 * Give the invoice its GST number, inside the approval's transaction.
 *
 * An invoice that already has one keeps it - it was approved before,
 * unapproved to correct something, and is going out again under the number
 * the client already has.
 *
 * The advisory lock makes "highest + 1" safe under concurrency: a second
 * approval for the same company waits here until the first commits, and the
 * unique (CompanyId, seq) index is the backstop behind it.
 *
 * @returns the number, or null when the invoice needs none
 */
const assignTaxInvoiceNo = async ({ db, invoice, charges, companyCode, transaction }) => {
  if (!needsTaxInvoiceNo(invoice, charges)) return null;
  const { Sales_Tax_Invoice, sequelize } = db;

  const existing = await Sales_Tax_Invoice.findOne({ where: { InvoiceId: invoice.id }, transaction });
  if (existing) return existing.taxInvoiceNo;

  const companyId = invoice.companyId === null || invoice.companyId === undefined
    ? null : Number(invoice.companyId);
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
    replacements: { key: `sales_tax_invoice:${companyId}` }, transaction,
  });
  const last = await Sales_Tax_Invoice.max('seq', { where: { CompanyId: companyId }, transaction });
  const seq = (Number(last) || 0) + 1;
  // In the install's format - Configuration > Invoices (functions/
  // gstNumberFormat). Unset, {CODE}-# : CL-24295, as numbers always were.
  const taxInvoiceNo = formatGstNumber(await readGstFormat(db, transaction), { code: companyCode, seq });

  await Sales_Tax_Invoice.create({ taxInvoiceNo, seq, CompanyId: companyId, InvoiceId: invoice.id }, { transaction });
  return taxInvoiceNo;
};

module.exports = { isSalesTaxLine, needsTaxInvoiceNo, seqFrom, assignTaxInvoiceNo };

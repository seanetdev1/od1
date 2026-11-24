const {
  lastInYear, perCompany, formatNumber, codeFor,
} = require('./documentNumber');

/**
 * Invoice numbering, shared by the freight, aviation and customs invoicing
 * routes so the three cannot number differently.
 *
 * The last invoice of a TYPE (Job Invoice, Job Bill, Agent Invoice, Agent
 * Bill, Opening Invoice, Opening Bill) issued this fiscal year - found by type
 * and invoice_Id, never by the code or company printed in invoice_No, so
 * renaming a code in Config > Document Numbers or switching the company prefix
 * carries the sequence straight on. Per company while invoices carry the
 * prefix; shared across companies when they do not. See functions/
 * documentNumber.
 *
 * `include` / `attributes` pass through - makeInvoiceNew needs the last
 * invoice's charge lines to decide whether it can be reused.
 */
const lastInvoiceInYear = (Invoice, {
  type, companyId, suffix, settings, include, attributes, transaction,
}) => lastInYear(Invoice, {
  seqCol: 'invoice_Id',
  noCol: 'invoice_No',
  suffix,
  where: { type },
  company: { column: 'companyId', id: String(companyId) },
  scoped: perCompany(settings, 'invoices'),
  include,
  attributes,
  transaction,
});

/**
 * An invoice's number, laid out as Config > Document Numbers says. The four
 * job/agent types print their configured code; the opening types keep theirs
 * (`fixedCode`: OI / OB).
 */
const invoiceNumber = (settings, { type, fixedCode, company, seq, suffix }) => formatNumber(settings, {
  klass: 'invoices', company, code: codeFor(settings, 'invoices', type, fixedCode), seq, suffix,
});

module.exports = { lastInvoiceInYear, invoiceNumber };

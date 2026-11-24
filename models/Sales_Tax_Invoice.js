/**
 * The GST (sales tax) invoice number an invoice was issued under - CL-24295 -
 * printed as "GST Invoice #" on the Sale Tax Invoice.
 *
 * Its own sequence, apart from the invoice number: the legacy system numbered
 * every invoice carrying sales tax CL-1, CL-2 ... (23,047 of them on
 * CargoLinkers, in GL_JobInvoice_TaxInvoice), and the tax authority knows the
 * invoices by those numbers. One row per invoice that has one.
 *
 * A TABLE OF ITS OWN rather than a column on Invoices on purpose. The boot
 * sync creates missing tables but never alters existing ones (see
 * models/index.js), so a new Invoices column would break every invoice query
 * on an install until someone ran an ALTER by hand. A new table simply
 * appears.
 *
 * Assigned when an invoice with taxed receivable lines is APPROVED
 * (functions/salesTaxInvoice.js), and kept through an unapprove, so a
 * corrected and re-approved invoice goes out under the same number. Legacy
 * numbers come across in the customs migration.
 */
module.exports = (sequelize, DataTypes) => {
  const Sales_Tax_Invoice = sequelize.define("Sales_Tax_Invoice", {
    // What prints: the company code and the sequence, "CL-24295".
    taxInvoiceNo: { type: DataTypes.STRING, allowNull: false },
    // The sequence on its own, so the next number is a MAX rather than a
    // parse of every string.
    seq: { type: DataTypes.INTEGER, allowNull: false },
    CompanyId: { type: DataTypes.INTEGER },
    InvoiceId: { type: DataTypes.INTEGER, allowNull: false },
    // The legacy GL_JobInvoice_TaxInvoice.Id, for a migrated number.
    climaxId: { type: DataTypes.BIGINT },
  }, {
    indexes: [
      { name: "sales_tax_invoices_invoice_unique", unique: true, fields: ["InvoiceId"] },
      // Unique among the numbers ODYSSEY issues - climaxId null. The legacy
      // system gave 29 of its numbers to two invoices each, and a migrated
      // number is brought across as it was issued rather than refused; new
      // numbers always start above the highest migrated one, so the two sets
      // cannot meet.
      {
        name: "sales_tax_invoices_issued_seq_unique", unique: true,
        fields: ["CompanyId", "seq"], where: { climaxId: null },
      },
    ],
  });
  return Sales_Tax_Invoice;
};

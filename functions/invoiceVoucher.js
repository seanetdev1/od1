/**
 * The voucher(s) an invoice stands in the ledger by.
 *
 * Odyssey links an invoice's voucher by Vouchers.invoice_Id, and unapprove
 * and approve both looked for it there. A voucher MIGRATED from Climax carries
 * no such link - not one of CargoLinkers' 23,496 SI or 57,119 PI - so
 * unapproving a migrated invoice found nothing to take out, left the Climax
 * voucher in the ledger, and approving it again after the edit posted a
 * second voucher beside it: the invoice twice in the books.
 *
 * Climax names the invoice in every line of the voucher it raises for one:
 * "... Inv # JI-2710/27 Job Ref # ..." for an invoice, "Bill # JB-8012/27" for
 * a bill. Checked against both Climax databases - every job invoice, job bill
 * and agent invoice voucher carries its own number that way - and on
 * CargoLinkers every migrated SI and PI resolves to exactly one invoice by it.
 * So a migrated invoice's voucher is found by: migrated (climaxId), the vType
 * the invoice posts as, the same company, and a line naming this number - as
 * a whole number, so JI-271/27 never finds JI-2710/27.
 *
 * Only a migrated invoice is searched that way: one raised in Odyssey has no
 * Climax voucher, and the search scans voucher lines, so it is skipped.
 */
const { QueryTypes } = require('sequelize');

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The narration pattern (Postgres regex) naming this invoice number. */
function narrationPattern(invoiceNo) {
  return `(Inv|Bill) # ${escapeRegex(invoiceNo)}([ ,]|$)`;
}

/** The vType an invoice posts as: SI for a receivable, PI for a payable. */
const invoiceVType = (payType) => (payType === 'Recievable' ? 'SI' : 'PI');

/**
 * Ids of the Climax vouchers that posted this migrated invoice. Empty for an
 * invoice raised in Odyssey.
 *
 * @param invoice  needs id, invoice_No, payType, companyId and climaxId
 */
async function legacyVoucherIds(sequelize, invoice, { transaction } = {}) {
  if (!invoice || invoice.climaxId === null || invoice.climaxId === undefined || !invoice.invoice_No) return [];
  const rows = await sequelize.query(
    `SELECT v.id FROM "Vouchers" v
      WHERE v."climaxId" IS NOT NULL
        AND v."vType" = $1
        AND v."CompanyId"::text = $2
        AND (v."invoice_Id" IS NULL OR v."invoice_Id" = $3)
        AND EXISTS (SELECT 1 FROM "Voucher_Heads" h WHERE h."VoucherId" = v.id AND h.narration ~ $4)`,
    {
      bind: [invoiceVType(invoice.payType), String(invoice.companyId), String(invoice.id), narrationPattern(invoice.invoice_No)],
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  return rows.map((r) => r.id);
}

/** Ids of every voucher posting this invoice: Odyssey's own and Climax's. */
async function invoiceVoucherIds(sequelize, invoice, { transaction } = {}) {
  const linked = await sequelize.query(
    'SELECT id FROM "Vouchers" WHERE "invoice_Id" = $1',
    { bind: [String(invoice.id)], type: QueryTypes.SELECT, transaction },
  );
  const legacy = await legacyVoucherIds(sequelize, invoice, { transaction });
  return [...new Set([...linked.map((r) => r.id), ...legacy])];
}

module.exports = { narrationPattern, invoiceVType, legacyVoucherIds, invoiceVoucherIds };

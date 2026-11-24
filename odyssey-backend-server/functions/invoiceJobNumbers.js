// THE JOB AN INVOICE IS FOR, when the invoice row cannot say.
//
// A freight invoice carries its job (Invoice.SEJobId). A customs or aviation
// one does not: its job is on its CHARGE LINES - Charge_Head.CustomsJobId, or
// AviationConsignmentId and that consignment's flight. The Invoices / Bills
// list only looked at SEJobId, so on a customs install every row's Job No. was
// blank and searching by job number found nothing - all 81,331 of CL's
// invoices and bills (found 2026-11-15). Every one of them is on a single job.
//
// No index on Charge_Heads' InvoiceId or job columns: on CL's 225,000 lines a
// page's lookup costs ~75 ms and a search ~100 ms, so none is added here.

const CUSTOMS_JOB_NOS = `
  SELECT ch."InvoiceId" AS "invoiceId", cj."jobNo" AS "jobNo"
  FROM "Charge_Heads" ch JOIN "Customs_Jobs" cj ON cj."id" = ch."CustomsJobId"
  WHERE ch."InvoiceId" IN (:ids)`;
const AVIATION_JOB_NOS = `
  SELECT ch."InvoiceId" AS "invoiceId", aj."jobNo" AS "jobNo"
  FROM "Charge_Heads" ch
  JOIN "Aviation_Consignments" ac ON ac."id" = ch."AviationConsignmentId"
  JOIN "Aviation_Jobs" aj ON aj."id" = ac."AviationJobId"
  WHERE ch."InvoiceId" IN (:ids)`;

/**
 * invoice id -> job number, for the invoices given, from their charge lines.
 * An invoice whose lines name no customs or aviation job is not in the map.
 */
async function jobNumbersFromCharges(sequelize, invoiceIds) {
  const ids = [...new Set((invoiceIds || []).filter((id) => Number.isInteger(Number(id))).map(Number))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = await sequelize.query(`${CUSTOMS_JOB_NOS} UNION ${AVIATION_JOB_NOS}`, {
    replacements: { ids },
    type: sequelize.QueryTypes.SELECT,
  });
  for (const r of rows) {
    if (r.jobNo && !out.has(Number(r.invoiceId))) out.set(Number(r.invoiceId), r.jobNo);
  }
  return out;
}

/**
 * A where-clause literal: the invoice's charge lines are on a customs job or a
 * flight whose number matches `escapedLike` (already sequelize.escape()d, %s
 * and all). For the list's search, beside its SE_Job.jobNo branch.
 */
const chargeJobNoMatches = (Sequelize, escapedLike) => Sequelize.literal(`"Invoice"."id" IN (
  SELECT ch."InvoiceId" FROM "Charge_Heads" ch JOIN "Customs_Jobs" cj ON cj."id" = ch."CustomsJobId"
  WHERE cj."jobNo" ILIKE ${escapedLike}
  UNION
  SELECT ch."InvoiceId" FROM "Charge_Heads" ch
  JOIN "Aviation_Consignments" ac ON ac."id" = ch."AviationConsignmentId"
  JOIN "Aviation_Jobs" aj ON aj."id" = ac."AviationJobId"
  WHERE aj."jobNo" ILIKE ${escapedLike})`);

module.exports = { jobNumbersFromCharges, chargeJobNoMatches };

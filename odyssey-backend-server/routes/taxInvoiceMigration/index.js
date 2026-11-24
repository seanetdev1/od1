/**
 * GST invoice numbers migration - plan, apply, verify.
 *
 *   POST /taxInvoiceMigration/plan    what would happen, writes nothing
 *   POST /taxInvoiceMigration/apply   one batch, one transaction
 *   GET  /taxInvoiceMigration/verify  counts
 *
 * Legacy GL_JobInvoice_TaxInvoice into Sales_Tax_Invoice, linked to the client
 * invoices the invoice stage already imported. See
 * functions/taxInvoiceMigrationPlan.js for what is placed and what is reported.
 */

const routes = require('express').Router();
const db = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planTaxInvoiceNumbers } = require('../../functions/taxInvoiceMigrationPlan');

const { Op } = db.Sequelize;
// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;
const MAX_BATCH = 5000;

async function contextFor(rows, transaction) {
  const legacyIds = [...new Set(rows.map((r) => r.JobInvoiceId).filter((v) => v !== null && v !== undefined))];
  // Client invoices only: a vendor bill's climaxId counts in GL_JobBill's ids,
  // which overlap GL_JobInvoice's.
  const invoices = legacyIds.length
    ? await db.Invoice.findAll({
        attributes: ['id', 'companyId', 'climaxId'],
        where: { climaxId: { [Op.in]: legacyIds.map(String) }, payType: 'Recievable' },
        raw: true, transaction,
      })
    : [];
  const invoicesByLegacyId = new Map();
  for (const inv of invoices) {
    const k = String(inv.climaxId);
    if (!invoicesByLegacyId.has(k)) invoicesByLegacyId.set(k, []);
    invoicesByLegacyId.get(k).push(inv);
  }
  const numbered = invoices.length
    ? await db.Sales_Tax_Invoice.findAll({
        attributes: ['InvoiceId'],
        where: { InvoiceId: { [Op.in]: invoices.map((i) => i.id) } },
        raw: true, transaction,
      })
    : [];
  return { invoicesByLegacyId, numberedInvoiceIds: new Set(numbered.map((n) => n.InvoiceId)) };
}

const summarise = (plan) => ({
  toCreate: plan.toCreate.length,
  problems: {
    invoiceNotFound: { count: plan.problems.invoiceNotFound.length, sample: plan.problems.invoiceNotFound.slice(0, 25) },
    ambiguous: { count: plan.problems.ambiguous.length, sample: plan.problems.ambiguous.slice(0, 25) },
    badNumber: { count: plan.problems.badNumber.length, sample: plan.problems.badNumber.slice(0, 25) },
    alreadyNumbered: plan.problems.alreadyNumbered,
  },
});

const readRows = (body) => (Array.isArray(body?.rows) ? body.rows : null);

routes.post('/plan', SYSTEM, async (req, res) => {
  try {
    const rows = readRows(req.body);
    if (!rows) return res.status(400).json({ status: 'error', result: 'Send { rows: [...] } from /jobs/getTaxInvoiceNumbers.' });
    const plan = planTaxInvoiceNumbers(rows, await contextFor(rows));
    res.json({ status: 'success', result: { ...summarise(plan), created: 0 } });
  } catch (error) {
    console.error('[tax invoice migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/apply', SYSTEM, async (req, res) => {
  try {
    const rows = readRows(req.body);
    if (!rows) return res.status(400).json({ status: 'error', result: 'Send { rows: [...] } from /jobs/getTaxInvoiceNumbers.' });
    if (rows.length > MAX_BATCH) {
      return res.status(413).json({ status: 'error', result: `Batch of ${rows.length} exceeds the ${MAX_BATCH}-row limit.` });
    }
    let plan;
    await db.sequelize.transaction(async (t) => {
      plan = planTaxInvoiceNumbers(rows, await contextFor(rows, t));
      if (plan.toCreate.length) await db.Sales_Tax_Invoice.bulkCreate(plan.toCreate, { transaction: t });
    });
    res.json({ status: 'success', result: { ...summarise(plan), created: plan.toCreate.length } });
  } catch (error) {
    console.error('[tax invoice migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const [[v]] = await db.sequelize.query(`
      SELECT (SELECT count(*)::int FROM "Sales_Tax_Invoices") AS numbers,
             (SELECT count(*)::int FROM "Sales_Tax_Invoices" WHERE "climaxId" IS NOT NULL) AS migrated,
             (SELECT max(seq) FROM "Sales_Tax_Invoices") AS "highestSeq"`);
    res.json({ status: 'success', result: v });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

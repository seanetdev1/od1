/**
 * Vendor tax invoice numbers migration - plan, apply, verify.
 *
 *   POST /vendorTaxInvoiceMigration/plan    what would happen, writes nothing
 *   POST /vendorTaxInvoiceMigration/apply   one batch, one transaction
 *   GET  /vendorTaxInvoiceMigration/verify  counts
 *
 * Legacy GL_JobBill.VendorTaxInvoiceNo onto the vendor bills the Clearing
 * Invoices stage already imported (Invoice.vendorTaxInvoiceNo). Its own small
 * path, so it can be run on an install whose bills are already in - the user's
 * request, 2026-10-14. See functions/vendorTaxInvoiceMigrationPlan.js for what
 * is placed and what is reported.
 */

const routes = require('express').Router();
const db = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planVendorTaxInvoiceNumbers } = require('../../functions/vendorTaxInvoiceMigrationPlan');

const { Op } = db.Sequelize;
// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;
const MAX_BATCH = 5000;

async function contextFor(rows, transaction) {
  const legacyIds = [...new Set(rows.map((r) => r.Id).filter((v) => v !== null && v !== undefined))];
  // Vendor bills only: a client invoice's climaxId counts in GL_JobInvoice's
  // ids, which overlap GL_JobBill's.
  const bills = legacyIds.length
    ? await db.Invoice.findAll({
        attributes: ['id', 'invoice_No', 'climaxId', 'vendorTaxInvoiceNo'],
        where: { climaxId: { [Op.in]: legacyIds.map(String) }, payType: 'Payble' },
        raw: true, transaction,
      })
    : [];
  const billsByLegacyId = new Map();
  for (const bill of bills) {
    const k = String(bill.climaxId);
    if (!billsByLegacyId.has(k)) billsByLegacyId.set(k, []);
    billsByLegacyId.get(k).push(bill);
  }
  return { billsByLegacyId };
}

const sample = (list) => ({ count: list.length, sample: list.slice(0, 25) });
const summarise = (plan) => ({
  toUpdate: plan.toUpdate.length,
  problems: {
    billNotFound: sample(plan.problems.billNotFound),
    ambiguous: sample(plan.problems.ambiguous),
    wrongBill: sample(plan.problems.wrongBill),
    different: sample(plan.problems.different),
    alreadySet: plan.problems.alreadySet,
    noNumber: plan.problems.noNumber,
  },
});

const readRows = (body) => (Array.isArray(body?.rows) ? body.rows : null);
const NO_ROWS = 'Send { rows: [...] } from /jobs/getVendorTaxInvoiceNumbers.';

routes.post('/plan', SYSTEM, async (req, res) => {
  try {
    const rows = readRows(req.body);
    if (!rows) return res.status(400).json({ status: 'error', result: NO_ROWS });
    const plan = planVendorTaxInvoiceNumbers(rows, await contextFor(rows));
    res.json({ status: 'success', result: { ...summarise(plan), updated: 0 } });
  } catch (error) {
    console.error('[vendor tax invoice migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/apply', SYSTEM, async (req, res) => {
  try {
    const rows = readRows(req.body);
    if (!rows) return res.status(400).json({ status: 'error', result: NO_ROWS });
    if (rows.length > MAX_BATCH) {
      return res.status(413).json({ status: 'error', result: `Batch of ${rows.length} exceeds the ${MAX_BATCH}-row limit.` });
    }
    let plan;
    await db.sequelize.transaction(async (t) => {
      plan = planVendorTaxInvoiceNumbers(rows, await contextFor(rows, t));
      for (const u of plan.toUpdate) {
        // Only where it is still empty, should the bill have been given one
        // since the plan read it.
        await db.Invoice.update(
          { vendorTaxInvoiceNo: u.vendorTaxInvoiceNo },
          { where: { id: u.id, [Op.or]: [{ vendorTaxInvoiceNo: null }, { vendorTaxInvoiceNo: '' }] }, transaction: t },
        );
      }
    });
    res.json({ status: 'success', result: { ...summarise(plan), updated: plan.toUpdate.length } });
  } catch (error) {
    console.error('[vendor tax invoice migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const [[v]] = await db.sequelize.query(`
      SELECT count(*)::int AS bills,
             count(*) FILTER (WHERE COALESCE(TRIM("vendorTaxInvoiceNo"), '') <> '')::int AS "withNumber"
        FROM "Invoices" WHERE "payType" = 'Payble'`);
    res.json({ status: 'success', result: v });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

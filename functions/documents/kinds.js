/**
 * WHICH RECORDS CAN HAVE DOCUMENTS, AND WHO MAY DO WHAT WITH THEM.
 *
 * One entry per kind of record, keyed by its model name - the `entity` a
 * Document row carries. A kind not listed here cannot have documents at all:
 * the routes refuse it. Adding one is an entry here, plus the documents
 * button on its screen.
 *
 * THE RIGHTS ARE THE RECORD'S OWN (my call, 2026-11-13 - no new row in the
 * permission grid): whoever may open the record sees its documents; its
 * Create & edit right attaches one, its Delete right removes one. Attaching
 * is not editing the record, so a posted voucher or an approved invoice - shut
 * to edits - still takes a scan: the right is checked, the record's lock is
 * not. Each list mirrors the routes that open and change that record
 * (functions/permissions/routeRules.js).
 *
 *   model       the Sequelize model
 *   company     the record's company column - a user restricted to some
 *               companies sees no other company's documents
 *   number      what the record is called in the audit log
 *   rights(r)   { view, add, delete } - 'module:action' alternatives, any one
 *               will do; r is the record (its `attributes`)
 *   parent(id)  for an invoice: the job it was raised on, { entity, recordId }
 *               - whose documents of a type ticked "Shown on the job's
 *               invoices" show on the invoice too (the user's request,
 *               2026-11-13: an invoice scanned onto the job is on its invoices)
 */

const { Op } = require('sequelize');
const { OPERATION_MODULE, FREIGHT_JOBS, ALL_JOBS } = require('../permissions/catalog');
const { LINKING_REPORTS } = require('../permissions/routeRules');

let db;
const models = () => (db = db || require('../../models'));

/* THE JOB AN INVOICE WAS RAISED ON. A freight invoice names it (SEJobId). A
 * customs or aviation one does not: its charge lines do - a customs line its
 * job, an aviation line its air waybill, whose flight is the job - as the
 * reports find it (functions/customsInvoiceContext, aviationInvoiceContext). */
async function jobOfInvoice(invoiceId) {
  const { Invoice, Charge_Head, Aviation_Consignment } = models();
  const invoice = await Invoice.findByPk(invoiceId, { attributes: ['id', 'SEJobId'], raw: true });
  if (!invoice) return null;
  if (invoice.SEJobId) return { entity: 'SE_Job', recordId: String(invoice.SEJobId) };
  const line = await Charge_Head.findOne({
    where: { InvoiceId: invoice.id, [Op.or]: [{ CustomsJobId: { [Op.ne]: null } }, { AviationConsignmentId: { [Op.ne]: null } }] },
    attributes: ['CustomsJobId', 'AviationConsignmentId'],
    order: [['id', 'ASC']],
    raw: true,
  });
  if (line?.CustomsJobId) return { entity: 'Customs_Job', recordId: String(line.CustomsJobId) };
  if (line?.AviationConsignmentId) {
    const awb = await Aviation_Consignment.findByPk(line.AviationConsignmentId, { attributes: ['AviationJobId'], raw: true });
    if (awb?.AviationJobId) return { entity: 'Aviation_Job', recordId: String(awb.AviationJobId) };
  }
  return null;
}

const on = (action) => (...modules) => modules.flat().map((m) => `${m}:${action}`);
const view = on('view');
const edit = on('edit');
const del = on('delete');
// The record's own module(s), each right on them.
const own = (...modules) => ({ view: view(modules), add: edit(modules), delete: del(modules) });

// Every kind of voucher is one model, opened from the voucher, payment and
// receipt, opening balance and Direct Job screens (POST /voucher/voucherEdit).
const VOUCHER_MODULES = ['vouchers', 'payments', 'openingBalances', 'directJob'];
const INVOICE_MODULES = ['invoices', 'jobInvoices', 'openingBalances'];

const KINDS = {
  // Freight: sea and air, export and import - the module follows the job's
  // operation, as GET /seaJob/getValuesJobList's ?operation= does.
  SE_Job: {
    label: 'Job',
    model: 'SE_Job',
    company: 'companyId',
    number: 'jobNo',
    attributes: ['id', 'companyId', 'jobNo', 'operation'],
    rights: (r) => own(OPERATION_MODULE[r.operation] || FREIGHT_JOBS),
  },
  Customs_Job: {
    label: 'Job',
    model: 'Customs_Job',
    company: 'companyId',
    number: 'jobNo',
    attributes: ['id', 'companyId', 'jobNo'],
    rights: () => own('customs'),
  },
  Aviation_Job: {
    label: 'Job',
    model: 'Aviation_Job',
    company: 'companyId',
    number: 'jobNo',
    attributes: ['id', 'companyId', 'jobNo'],
    rights: () => own('aviation'),
  },
  Vouchers: {
    label: 'Voucher',
    model: 'Vouchers',
    company: 'CompanyId',
    number: 'voucher_Id',
    attributes: ['id', 'CompanyId', 'voucher_Id'],
    // As GET /voucher/getVoucherById - the reports that open one included.
    rights: () => ({
      view: view(VOUCHER_MODULES, LINKING_REPORTS),
      add: edit(VOUCHER_MODULES),
      delete: del(VOUCHER_MODULES),
    }),
  },
  Invoice: {
    label: 'Invoice',
    model: 'Invoice',
    company: 'companyId',
    number: 'invoice_No',
    attributes: ['id', 'companyId', 'invoice_No'],
    // As GET /invoice/getInvoiceById: a job's own screens read its invoices.
    rights: () => ({
      view: view(INVOICE_MODULES, 'payments', 'jobCharges', ALL_JOBS, LINKING_REPORTS),
      add: edit(INVOICE_MODULES),
      delete: del(INVOICE_MODULES),
    }),
    parent: jobOfInvoice,
  },
  // Direct Job Expense / Revenue. It carries no company of its own - the
  // vouchers it posts do - and its list shows every entry to whoever has
  // Direct Job, so neither is any company checked here.
  Direct_Job: {
    label: 'Direct Job',
    model: 'Direct_Job',
    company: null,
    number: 'Entry_No',
    attributes: ['id', 'Entry_No'],
    rights: () => own('directJob'),
  },
};

/** The kind for an entity name, or undefined. Own keys only: never 'constructor'. */
const kindOf = (entity) => (Object.prototype.hasOwnProperty.call(KINDS, entity) ? KINDS[entity] : undefined);

module.exports = { KINDS, kindOf, jobOfInvoice };

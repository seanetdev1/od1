const routes = require('express').Router();
// The home page's Pending Invoices/Bills - Configuration > Dashboard Widgets.
const { requireWidget } = require('../../functions/dashboardWidgets');
const Sequelize = require('sequelize');
const { Charge_Head, Invoice } = require("../../functions/Associations/incoiceAssociations");
const { SE_Job } = require("../../functions/Associations/jobAssociations/seaExport");
const { Clients } = require("../../functions/Associations/clientAssociation");
// Flight and goods-declaration context for invoices that have no SE_Job. The
// same helpers Job Balancing and Invoice Balancing use, so the dashboard names
// an aviation or customs invoice exactly the way those reports do.
const { Aviation_Job, Aviation_Consignment, Aviation_Carrier } = require("../../functions/Associations/aviationAssociations");
const { Customs_Job } = require("../../functions/Associations/customsAssociations");
const { attachAviationContext } = require("../../functions/aviationInvoiceContext");
const { attachCustomsContext } = require("../../functions/customsInvoiceContext");
const url='accounts';

/* WHAT "PENDING" MEANS HERE: money still owed.
 *
 * This used to ask SE_Job for jobs whose invoices were `approved:'0'`, which
 * was wrong twice over and showed an empty panel on any aviation or customs
 * install:
 *
 *   1. It was JOB-driven. Invoice.belongsTo(SE_Job) is the only job link there
 *      is, and an aviation invoice carries SEJobId: null - its charges hang
 *      off an AWB, a customs invoice's off a goods declaration. Neither could
 *      ever satisfy that inner join, so neither ever appeared.
 *
 *   2. It read `approved`, which is pending APPROVAL, not pending payment.
 *      Aviation and customs invoices are raised from already-approved charges
 *      and call approveInvoice() on creation, so they are never approved:'0'.
 *      Fixing the join alone would still have shown nothing.
 *
 * Now it is invoice-driven and asks the question the panel's title implies:
 * what is still outstanding. `approved` is reported per row rather than
 * filtered on, so an invoice that has not reached the ledger yet is visible
 * AND visibly distinct, instead of being either the only thing shown or not
 * shown at all.
 */

// The settlement rule - which column holds the money, and how much is left -
// lives in one file with BOTH its JavaScript and its SQL form, because this
// route needs both and two copies would eventually disagree. See the file.
const {
  num, settledOf, outstandingOf,
  SQL_OUTSTANDING_AMOUNT, SQL_IS_OUTSTANDING,
} = require("../../functions/invoiceOutstanding");

const OUTSTANDING = Sequelize.literal(SQL_IS_OUTSTANDING);

const LIMIT = 10;

routes.get(`/${url}/get`, requireWidget('pendingInvoices'), async(req, res) => {
  try {
    const rows = await Invoice.findAll({
      where: OUTSTANDING,
      attributes: [
        'id', 'invoice_No', 'type', 'payType', 'party_Name', 'currency',
        'total', 'paid', 'recieved', 'approved', 'createdAt', 'SEJobId',
      ],
      include: [
        // Needed by both context helpers below, which read the consignment and
        // goods-declaration ids off the charge lines.
        {
          model: Charge_Head,
          attributes: ['id', 'AviationConsignmentId', 'CustomsJobId'],
          required: false,
        },
        {
          model: SE_Job,
          attributes: ['id', 'jobNo', 'subType'],
          required: false,
          include: [{ model: Clients, attributes: ['name'], required: false }],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: LIMIT,
    });

    await attachAviationContext(rows, { Aviation_Consignment, Aviation_Job, Aviation_Carrier });
    await attachCustomsContext(rows, { Customs_Job });

    // The panel shows the ten most recent, so it has to say how many there
    // are - "10 most recent" of an unknown total is not an amount anybody can
    // act on. Counted separately rather than by lengthening the page.
    const [count, totals] = await Promise.all([
      Invoice.count({ where: OUTSTANDING }),
      Invoice.findAll({
        where: OUTSTANDING,
        attributes: [[Sequelize.literal(`SUM(${SQL_OUTSTANDING_AMOUNT})`), 'amount']],
        raw: true,
      }),
    ]);

    const result = rows.map((row) => {
      const inv = row.toJSON();
      const total = num(inv.total);
      const settled = settledOf(inv);
      const outstanding = outstandingOf(inv);

      // Where the invoice came from, in the one shape the screen renders.
      // A freight invoice names its job and client; an aviation one its flight;
      // a customs one its GD. Resolving it here keeps the panel from having to
      // know that three different modules exist.
      const source =
        inv.SE_Job ? {
          kind: 'freight',
          jobNo: inv.SE_Job.jobNo || '',
          detail: inv.SE_Job.subType || '',
          client: inv.SE_Job.Client?.name || '',
        }
        : inv.aviation ? {
          kind: 'aviation',
          jobNo: inv.aviation.jobNo || '',
          detail: [inv.aviation.flightNo, inv.aviation.sector].filter(Boolean).join(' · '),
          client: '',
        }
        : inv.customs ? {
          kind: 'customs',
          jobNo: inv.customs.jobNo || '',
          detail: inv.customs.gdNumber || '',
          client: '',
        }
        : null;

      return {
        id: inv.id,
        invoice_No: inv.invoice_No,
        type: inv.type,
        payType: inv.payType,
        party_Name: inv.party_Name || '',
        currency: inv.currency || '',
        total,
        settled,
        outstanding,
        // Reported, not filtered on - see the header comment.
        approved: inv.approved,
        createdAt: inv.createdAt,
        source,
      };
    });

    res.json({
      status: 'success',
      result,
      summary: {
        shown: result.length,
        count,
        amount: num(totals?.[0]?.amount),
      },
    });
  }
  catch (error) {
    // No .catch() on the query on purpose. It used to swallow the error and
    // log it, which left `result` undefined and still replied status:'success'
    // with no result at all - so a database failure reached the dashboard as
    // "Cannot read properties of undefined (reading 'map')" rather than as an
    // error.
    console.error(error);
    res.status(500).json({status:'error', result: error.message || error});
  }
});

module.exports = routes;

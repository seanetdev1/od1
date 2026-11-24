const { nextVoucherNo } = require("../../functions/voucherNumber");
// Legacy-import receivers are migration, which is Seanet's - see
// functions/systemAccess.js.
const { requireSystem: SYSTEM } = require('../../functions/systemAccess');
const { assignTaxInvoiceNo } = require("../../functions/salesTaxInvoice");
const { KEY: CUSTOMS_JOB_FORM_KEY, parseCustomsJobForm } = require("../../functions/customsJobForm");
// The invoice's rate from its lines, worked out again at approval.
const { exRatePatch } = require("../../functions/invoiceExRate");
// Which invoices still have money on them - one rule for every list.
const { OWED_SQL } = require("../../functions/invoiceOwed");
// Why an invoice a Payments & Receipts search named is not on its list.
const { whyNotListed, notListed } = require("../../functions/invoiceNotListed");
const { unappliedAdvances } = require("../../functions/jobBalancingAdvances");
const { pendingJobRows } = require("../../functions/jobBalancingPending");
const { pkDay } = require("../../functions/pkDay");
const { Charge_Head, Invoice, Invoice_Losses, Invoice_Transactions, Sales_Tax_Invoice } = require("../../functions/Associations/incoiceAssociations");
const { SE_Job, SE_Equipments, Bl, Container_Info ,Commodity, Delivery_Order} = require("../../functions/Associations/jobAssociations/seaExport");
const { Child_Account, Parent_Account } = require("../../functions/Associations/accountAssociations");
const { Access_Levels, Employees } = require("../../functions/Associations/employeeAssociations");
const { Vouchers, Voucher_Heads } = require("../../functions/Associations/voucherAssociations");
const { resolveSelectedFiscalYear } = require("../../functions/Associations/fiscalYearAssociations");
const { Client_Associations } = require("../../functions/Associations/clientAssociation");
const { linePartyOf } = require("../../functions/invoiceParty");
const { Voyage } = require('../../functions/Associations/vesselAssociations');
// Aviation invoices have no SE_Job; approve() reads the flight for its
// narration instead. See the comment where `job` is resolved.
const { Aviation_Job, Aviation_Consignment, Aviation_Carrier } = require("../../functions/Associations/aviationAssociations");
// Adds an `aviation` block to invoices that have no SE_Job, so the shared
// job-column reports can show the flight instead of a blank row. A freight
// invoice is returned untouched - see the file.
const { attachAviationContext } = require("../../functions/aviationInvoiceContext");
const aviationCtxModels = () => ({ Aviation_Consignment, Aviation_Job, Aviation_Carrier });
// The same for customs: a `customs` block on invoices that have no SE_Job, so
// the shared job-column reports can show the goods declaration instead of a
// blank row. One level shallower than aviation - a customs charge names its
// job directly - see the file.
const { Customs_Job, Customs_Container } = require("../../functions/Associations/customsAssociations");
const { attachCustomsContext } = require("../../functions/customsInvoiceContext");
const { customsVoucherNarration } = require("../../functions/customsVoucherNarration");
const customsCtxModels = () => ({ Customs_Job });
const { AppSetting } = require("../../models");
const { sheetRepeats, sheetRepeatsMessage, readUniqueJobCharges } = require("../../functions/jobChargeRepeats");
const { printPlaceNames } = require("../../functions/printPlaces");
const { readBankDefaults, withBankDefaults } = require("../../functions/bankAccountDefaults");

/**
 * The configured income/expense account ids, keyed by AIR/FCL/LCL.
 *
 * Read fresh on each approval rather than cached: this is a setting an admin
 * changes to fix a posting failure, and a cache would mean the fix does not
 * take effect until the server restarts. One indexed row, once per approval.
 * Never throws - a missing or malformed setting simply means "not configured",
 * and the caller falls back to matching by title.
 */
// This installation's cost centre code, from Configuration. Replaces the
// literal "KHI" that was typed into the two voucher builders below. No cycle:
// routes/settings only touches models.
const { readCostCenter, readAutoRoundOff, readJobBalancingAdvances } = require('../settings');
const { approvalRoundOff, hasRoundOff, isRoundable, roundOffHeads } = require('../../functions/invoiceRoundOff');
const { invoiceAdjustment } = require('../../functions/invoiceAdjustment');
const { currencyChange } = require('../../functions/invoiceCurrency');
const { foreignRateProblem } = require('../../functions/chargeExRate');
// Which ledger accounts a job's money posts to, shared with Direct Job E/R.
const { ledgerBucketsFor } = require('../../functions/ledgerBuckets');
// And how a bucket becomes a row in this install's chart: the configured id
// first, the seeded title as a fallback. Was written out here; Direct Job E/R
// needs the same rule, and two copies of it post the same job's money to two
// different accounts the first time one of them is changed.
const {
  readLedgerAccounts, makeAccountResolver, missingAccountMessage,
} = require('../../functions/ledgerAccounts');
// Sales tax off the income / expense line, onto its own account, once one is
// set in Configuration > Ledger Accounts.
const { invoiceTax, splitContra, lineTaxIn } = require('../../functions/invoiceTaxSplit');
// A charge line's approval, and a line already on an invoice, each need a right
// of their own since 2026-10-20 - functions/chargeRights.
const { chargeRightsNeeded, holdApprovals, openInvoiceLineIds, approvedInvoiceLock } = require('../../functions/chargeRights');
const { allowsPart } = require('../../functions/permissions/middleware');
const { Clients } = require("../../functions/Associations/clientAssociation");
// Charges: read at approval to find which lines are pass-through
// disbursements rather than revenue. See approveInvoice().
const { Accounts, Vessel, Transaction, Email_Suggestion, Company, BankAccount, Charges, FiscalYears, sequelize } = require("../../models");
// Company.hasMany(BankAccount) lives here - required so the include above works
// even if nothing else on this request path has pulled it in yet.
require("../../functions/Associations/companyAssociations");
const routes = require('express').Router();
const Sequelize = require('sequelize');
const moment = require("moment");
const { reportCompanies } = require('../../functions/companyAccess');
const { Client } = require("pg");
const Op = Sequelize.Op;
const { createHistory } = require('../../functions/history');
const { invoiceVoucherIds, legacyVoucherIds } = require('../../functions/invoiceVoucher');
const { creatorsOf } = require('../../functions/recordCreators');
const { jobNumbersFromCharges, chargeJobNoMatches } = require('../../functions/invoiceJobNumbers');
// The named date ranges a screen can ask for - calendar periods, matching the
// fortnight the books reconcile in. See the module.
const { resolvePeriod, toExclusive } = require('../../functions/reportPeriods');
const { verifyPrintToken } = require('../../functions/printToken');
const { renderInvoicePdf } = require('../../functions/pdf');
const { sendMail } = require('../../functions/mailer');

const numCPUs = require('os').cpus().length;
// Company code for document numbers (job/invoice/voucher/DO prefixes).
// Reads Company.short, which is set per install - these were hardcoded as
// SNS/CLS/ACS, which stamps Seanet's codes onto another company's documents.
const { companyShort } = require('../../functions/companyCodes');
// House style for invoice and voucher numbers - SNS-JI-1/27 or SNS-JI-27/1.
const { readNumbering } = require('../../functions/documentNumber');
const { lastInvoiceInYear, invoiceNumber } = require('../../functions/invoiceNumber');
const { voucherId } = require('../../functions/voucherNumber');

const chardHeadLogic = (currency) => {
  let result = { };
  if(currency!=undefined){
    result = { currency:currency }
  }
  return result;
};

routes.post("/updateCharges", async(req, res) => {
  try {
    // Two fixes here, both about the same thing - not lying to the client:
    //
    // 1. for...of, not forEach(async). forEach discards the promise its
    //    callback returns, so this handler used to send 'success' before a
    //    single row had been written, and any failure mid-way became an
    //    unhandled rejection that the catch below never saw.
    // 2. One transaction around the whole thing. An invoice and its charge
    //    heads have to move together; a partial write here leaves the ledger
    //    inconsistent, which is exactly the state a caller told 'success'
    //    will never think to check.
    await sequelize.transaction(async (t) => {
      for (const x of req.body.invoice) {
        await Invoice.update(x, { where: { id: x.id }, transaction: t });
        for (const y of req.body.charges) {
          if (x.type == y.invoiceType && y.InvoiceId == x.id) {
            await Charge_Head.update(
              { ...y, invoice_id: x.invoice_No, status: "1" },
              { where: { id: y.id }, transaction: t }
            );
          }
        }
      }
    });
    createHistory(req.body.employeeId, 'Invoice', 'Edit', req.body.invoice[0].invoice_No);
    res.json({status: 'success', result: 'result'});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.post("/saveHeades", async(req, res) => {

  const makeHeads = (data, id) => {
    let result = [];
    data.forEach((x, i)=>{
      result.push({...x, InvoiceId:id})
    });
    return result
  }
  try {
    const fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId);
    await Charge_Head.destroy({where:{id:req.body.deleteList}})
    let tempData = [...req.body.invoices];
    const prevInv = await Invoice.findAll({where:{SEJobId:req.body.invoices[0].SEJobId}});
    let tempPrevVal = [];
    prevInv.forEach((z)=>{
      tempPrevVal.push(z.dataValues)
    })
    tempData.forEach((x, i)=>{
      tempData[i].partyType=x.charges[0].partyType;  //<-- Defines The PartyType From Charge Head to Invoice
      tempPrevVal.forEach((y, j)=>{
        if(x.party_Id==y.party_Id && x.type==y.type){
          tempData[i].id=y.id;
          tempPrevVal.splice(j, 1);
        }
      })
    })
    req.body.invoices = tempData;
    for(let i = 0; i<req.body.invoices.length;i++){
      if(req.body.invoices[i].id==null){
        const result = await Invoice.create({ ...req.body.invoices[i], FiscalYearId: fiscalYear.id });
        await Charge_Head.bulkCreate(makeHeads(req.body.invoices[i].charges, result.id))
        createHistory(req.body.employeeId, 'Invoice', 'Create', result.invoice_No);
      }

      if(req.body.invoices[i].id!=null){
        for(let j = 0; j<req.body.invoices[i].charges.length;j++){
          await Invoice.update({currency:req.body.invoices[i].currency},{where:{id:req.body.invoices[i].id}});

          if(req.body.invoices[i].charges[j].id!=null){
            await Charge_Head.update(req.body.invoices[i].charges[j], {where:{id:req.body.invoices[i].charges[j].id}})
          }else{
            let val = {...req.body.invoices[i].charges[j], InvoiceId:req.body.invoices[i].id}
            await Charge_Head.create(val);
          }
        }
      }
    }
    res.json({status:'success'});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.get("/getJobInvoices", async(req, res) => {
  try {
    const result = await Invoice.findAll({
      where:{SEJobId:req.headers.id},
      include:[{
        model:Charge_Head,
      }]
    })
    res.json({status:'success', result:result});
    }
    catch (error) {
      console.error(error)
      res.status(500).json({status:'error', result: error.message || error });
    }
});

/**
 * One page of Invoices / Bills, filtered and searched BY THE SERVER.
 *
 * This used to return every invoice of a type in one response, and the screen
 * filtered that array in the browser. On a book of any age that is a table scan
 * sent over the wire so the browser can throw most of it away - and the search
 * box could only ever find what had already been downloaded. Both are the
 * server's job; the shape mirrors /voucher/getAllVouchers.
 *
 * ORDER IS PART OF THE CONTRACT, not a preference. OFFSET over an unordered
 * query is undefined: Postgres may return a row on page 1 and again on page 3,
 * and skip another entirely. There was no ORDER BY here before, which was
 * harmless only because nothing paged. Newest first matches the voucher list.
 *
 * SEARCH covers what the row actually shows, so anything on screen can be typed
 * into the box - including the job number, which lives on the joined SE_Job and
 * so is referenced as `$SE_Job.jobNo$`, the GST invoice number (CL-24295) on the
 * joined Sales_Tax_Invoice, and the amount as it is FORMATTED on screen rather
 * than only as it is stored. See the note on `bare` below.
 *
 * `subQuery: false` because of those joins. With a LIMIT and a condition on an
 * included table, Sequelize otherwise wraps the parent in a subquery that the
 * join is not inside, and the condition fails to resolve. Safe here and only
 * here: Invoice belongsTo SE_Job and hasOne Sales_Tax_Invoice (unique on
 * InvoiceId), one row to one row, so flattening the query cannot multiply
 * invoices and make LIMIT count the wrong thing.
 *
 * `total` is searched as text on purpose - the column is a STRING (see the
 * model), so it needs no cast, and a partial match on "1,250" is what someone
 * typing into a search box means.
 *
 * SCOPED BY COMPANY, like every other invoice route here. It never was, so this
 * list showed one company's books to another - and paging it only made that
 * harder to notice, because the rows from elsewhere were no longer all on
 * screen at once.
 *
 * A MISSING HEADER RETURNS NOTHING rather than everything. `companyId` is a
 * STRING column, so an absent header would otherwise filter on undefined,
 * which Sequelize drops - quietly restoring exactly the leak this closes.
 */
// The Invoices / Bills screen's four lists (its INVOICE_TYPES).
const LIST_TYPES = ['Job Invoice', 'Job Bill', 'Agent Invoice', 'Agent Bill'];

routes.get("/getFilteredInvoices", async(req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const search = String(req.query.search || '').trim();

    const companyId = String(req.headers.companyid || '').trim();
    if (!companyId) {
      return res.json({
        status: 'success', result: [], count: 0, page, limit, pages: 0,
      });
    }

    const and = [{ type: req.headers.type }, { companyId }];

    /* The invoice's DATE, between ?from and ?to - both 'YYYY-MM-DD',
     * inclusive, either one may be left open. Invoice has no date column;
     * createdAt is its date (a freight invoice is dated by its sailing), and
     * it is a timestamp, so the closing day is taken whole - see
     * functions/reportPeriods toExclusive. Neither given is the whole book, as
     * it always was. */
    const dateOf = (v) => {
      const m = moment(String(v || ''), 'YYYY-MM-DD', true);
      return m.isValid() ? m.format('YYYY-MM-DD') : null;
    };
    const from = dateOf(req.query.from);
    const to = dateOf(req.query.to);
    if (from || to) {
      const range = {};
      if (from) range[Op.gte] = from;
      if (to) range[Op.lt] = toExclusive({ to });
      and.push({ createdAt: range });
    }

    if (search) {
      const like = `%${search}%`;

      /* The AMOUNT is shown grouped and to two decimals - 13,570.00 - and
       * stored bare, as "13570". So someone who types what is on their screen
       * is searching for a string the column does not contain.
       *
       * Stripping the grouping and a trailing run of decimal zeros gives the
       * stored form back. Added as an EXTRA predicate rather than replacing the
       * plain one, so a partial number still works: "357" goes on matching
       * 13570 the way typing part of any other field does.
       */
      const bare = search.replace(/,/g, '').replace(/\.0*$/, '');
      const amountLikes = bare && bare !== search
        ? [{ total: { [Op.iLike]: `%${bare}%` } }]
        : [];

      and.push({
        [Op.or]: [
          { invoice_No: { [Op.iLike]: like } },
          { party_Name: { [Op.iLike]: like } },
          { partyType:  { [Op.iLike]: like } },
          { operation:  { [Op.iLike]: like } },
          { currency:   { [Op.iLike]: like } },
          { total:      { [Op.iLike]: like } },
          ...amountLikes,
          { '$SE_Job.jobNo$': { [Op.iLike]: like } },
          // A customs job or a flight - on the charge lines, not the invoice
          // (functions/invoiceJobNumbers).
          chargeJobNoMatches(Sequelize, sequelize.escape(like)),
          { '$Sales_Tax_Invoice.taxInvoiceNo$': { [Op.iLike]: like } },
        ],
      });
    }

    const { count, rows } = await Invoice.findAndCountAll({
      where: { [Op.and]: and },
      attributes:['id', 'invoice_No', 'status', 'operation', 'currency', 'ex_rate', 'party_Name', 'total', 'partyType', 'approved', 'createdBy'],
      // Charge_Head is NOT joined any more. The list renders no charge of any
      // kind, so every row of it was fetched, sent and discarded - and being a
      // hasMany it also forced `distinct` on the count.
      include:[
        { model:SE_Job, required: false, attributes:['jobNo'] },
        // The GST invoice number, shown on the list and searched.
        { model: Sales_Tax_Invoice, attributes: ['taxInvoiceNo'], required: false },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      subQuery: false,
    });

    /* WHAT THE SEARCH FINDS UNDER THE LIST'S OTHER CHOICES - "Agent Bill:
     * 1" - so the screen can say so. Each type is its own list, and a number
     * does not always say which: Climax numbered agent BILLS "AI" as well as
     * agent invoices (1,444 of them on SNS), so SNS-AI-620/26, an agent
     * bill, was searched for under Agent Invoice and was "not found"
     * (2026-11-16). The same conditions as the list but the type, counted
     * per type; only the screen's four. */
    const elsewhere = {};
    if (search) {
      const otherTypes = LIST_TYPES.filter((t) => t !== req.headers.type);
      const counts = await Invoice.count({
        where: { [Op.and]: [{ type: { [Op.in]: otherTypes } }, ...and.slice(1)] },
        include: [
          { model: SE_Job, required: false, attributes: [] },
          { model: Sales_Tax_Invoice, required: false, attributes: [] },
        ],
        group: ['Invoice.type'],
      });
      counts.forEach((c) => { if (Number(c.count) > 0) elsewhere[c.type] = Number(c.count); });
    }

    // Who generated each: its own stamp (functions/auditStamps), or for one
    // made before those, its first History entry (functions/recordCreators).
    const creators = await creatorsOf(require("../../models"), 'Invoice', rows.filter((r) => !r.createdBy).map((r) => r.invoice_No));
    // The job each is for: a freight invoice's own, else its charge lines'
    // customs job or flight - which the list showed blank on every customs
    // install (functions/invoiceJobNumbers).
    const chargeJobs = await jobNumbersFromCharges(sequelize, rows.filter((r) => !r.SE_Job?.jobNo).map((r) => r.id));
    res.json({
      status:'success',
      result: rows.map((r) => ({
        ...r.toJSON(),
        createdByName: r.createdBy || creators.get(r.invoice_No) || null,
        jobNo: r.SE_Job?.jobNo || chargeJobs.get(r.id) || null,
      })),
      count,
      page,
      limit,
      pages: Math.ceil(count / limit),
      elsewhere,
    });
  } catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.get("/getInvoiceByNo", async(req, res) => {
  try {
      const attr = [
        'name', 'address1', 'address1', 'person1', 'mobile1',
        'person2', 'mobile2', 'telephone1', 'telephone2', 'infoMail'
      ];
      const resultOne = await Invoice.findOne({
        where:{invoice_No:req.headers.invoiceno.toUpperCase()},
        include:[
          { model:Charge_Head },
          {
            model:SE_Job,
            attributes:[
              'jobNo', 'jobDate', 'shipDate', 'pol', 'pod', 'fd', 'vol', 
              'weight', 'pcs', 'flightNo', 'cwtClient', 'cwtLine', 'eta',
              'etd', 'arrivalDate', 'departureDate', 'customerRef'
            ],
            include:[
              { model:SE_Equipments , attributes:['qty', 'size'] },
              { 
                model:Bl , attributes:['mbl', 'hbl'],
                include:[{model:Container_Info, attributes:['no']}]
              },
              { model:Voyage , attributes:['voyage', 'importArrivalDate', 'exportSailDate'] },
              { model:Clients, attributes:attr },
              { model:Clients, as:'consignee', attributes:attr },
              { model:Clients, as:'shipper', attributes:attr },
              { model:Clients, as:'shipping_line', attributes:attr },
              { model:Employees, as:'sales_representator', attributes:['name'] },
              { model:Vessel, as:'vessel', attributes:['carrier', 'name'] },
              { model:Clients, as:'air_line', attributes:['name'] },
              { model:Commodity, as:'commodity', attributes:['name'] },
            ]
          },
          { model: Sales_Tax_Invoice, attributes: ['taxInvoiceNo'], required: false },
        ],
        order: [
          [{ model: Charge_Head }, 'id', 'ASC'],
        ]
      })
      await attachPrintContext(resultOne);
      // Who generated it: its own stamp, or its first History entry.
      if (resultOne) {
        resultOne.dataValues.createdByName = resultOne.createdBy
          || (await creatorsOf(require("../../models"), 'Invoice', [resultOne.invoice_No])).get(resultOne.invoice_No) || null;
      }
      res.json({status:'success', result:{ resultOne }});
    }
    catch (error) {
      res.status(500).json({status:'error', result: error.message || error });
    }
});

// Shared by /getInvoiceById and /getPrintData so the emailed/printed PDF can
// never drift out of sync with what the invoice viewer shows.
/**
 * What the customs invoice and the Sale Tax Invoice print beyond the invoice
 * and its lines - added to the single-invoice reads, so the interactive print
 * and the emailed PDF (/getPrintData) get the same.
 *
 *   customsJob  the declaration the invoice was raised from: job no, date and
 *               type, S/R page (jobRef), GD number and date, Form-E and MBL,
 *               terminal, packages, goods, the client's own invoice no. A
 *               customs invoice has no SE_Job; it reaches its job through its
 *               lines.
 *   recipient   the invoiced party in full - address, STRN and NTN - which
 *               the invoice row does not carry.
 *
 * THE RECIPIENT IS READ OFF THE LINES, NOT invoice.party_Id. party_Id means
 * two different things: an invoice raised here stores the party's LEDGER
 * ACCOUNT id (createInvoices, customs and aviation invoicing all do), a
 * migrated one stores the Clients id - and the two ranges overlap. CL-JI-1/27
 * has party_Id 7137, Velocity Textiles' account, and Clients 7137 is S & D
 * Chemicals, which is who the invoice printed as addressed to. A line's
 * partyId is the Clients id either way. Only an invoice whose lines name no
 * party falls back to the account, the convention for invoices raised here.
 *
 * Both null when there is nothing to find. Changes nothing else on the row.
 */
const PRINT_PARTY_ATTRS = ['name', 'address1', 'address2', 'strn', 'ntn'];
// The invoice's GST number, as every read the prints use joins it.
const GST_NUMBER = { model: Sales_Tax_Invoice, attributes: ['taxInvoiceNo'], required: false };
async function printRecipient(invoice) {
  const lineParty = (invoice.Charge_Heads || []).map((c) => c.partyId).find((id) => /^\d+$/.test(String(id ?? '')));
  if (lineParty) return Clients.findOne({ where: { id: lineParty }, attributes: PRINT_PARTY_ATTRS });
  const accountId = String(invoice.party_Id || '');
  if (!/^\d+$/.test(accountId)) return null;
  const link = await Client_Associations.findOne({ where: { ChildAccountId: accountId }, attributes: ['ClientId'] });
  return link?.ClientId ? Clients.findOne({ where: { id: link.ClientId }, attributes: PRINT_PARTY_ATTRS }) : null;
}
async function attachPrintContext(invoice) {
  if (!invoice) return invoice;
  const customsJobId = (invoice.Charge_Heads || []).map((c) => c.CustomsJobId).find(Boolean);
  const [customsJob, recipient] = await Promise.all([
    customsJobId
      ? Customs_Job.findOne({
          where: { id: customsJobId },
          attributes: [
            'id', 'jobNo', 'jobDate', 'jobType', 'jobRef', 'regPageNo', 'customFileNo',
            'gdNumber', 'gdDate', 'clientRef', 'packages', 'pkgUnit', 'invoiceNo',
            'goodsDescription', 'direction', 'transportMode', 'terminal', 'formENo', 'mblNo',
            // What an invoice template can print besides (functions/printingTemplate).
            'pol', 'pod', 'pofd', 'vesselOrFlight', 'voyageNo', 'blNo', 'blDate', 'igmNo',
            'indexNo', 'invoiceDate', 'invoiceValue', 'invoiceCurrency', 'grossWeight',
            'netWeight', 'deliveryLocation', 'containers', 'lcNo', 'gdType', 'collectorate',
            'shippingBillNo', 'etaDate', 'arrivalDate', 'sailingDate', 'cargoType', 'mblDate',
          ],
          // Printing Options can put the shipper in M/S instead of the
          // invoiced party - see CustomsInvoiceHeader. The consignee and the
          // containers are for invoice templates.
          include: [
            { model: Clients, as: 'shipper', attributes: PRINT_PARTY_ATTRS, required: false },
            { model: Clients, as: 'consignee', attributes: PRINT_PARTY_ATTRS, required: false },
            { model: Customs_Container, attributes: ['containerNo', 'sizeType'], required: false },
          ],
        })
      : null,
    printRecipient(invoice),
  ]);
  invoice.dataValues.customsJob = customsJob;
  invoice.dataValues.recipient = recipient;
  // The job's ports by name, from Setup - functions/printPlaces.
  invoice.dataValues.placeNames = await printPlaceNames(require("../../models"), invoice);
  // The print's Adjustment line - see functions/invoiceAdjustment.
  invoice.dataValues.adjustment = await invoiceAdjustment({ Invoice_Transactions, Vouchers }, invoice.id);
  invoice.dataValues.printSettings = await invoicePrintSettings();
  return invoice;
}

/* THE INSTALL'S WAY OF PRINTING, with the invoice, so the emailed PDF - a page
 * with no session to read settings with - prints as the screen does (Essani,
 * 2026-11-14):
 *   referenceLabel      the S/R Page #'s name (Configuration > Customs)
 *   containerNosInNote  a customs invoice's Note box lists its containers
 *   signDisclaimer      printed where the sign line was, when it is hidden
 *                       (both Configuration > Invoices) */
async function invoicePrintSettings() {
  const { AppSetting } = require("../../models");
  const rows = await AppSetting.findAll({
    where: { key: ['invoiceContainerNosInNote', 'invoiceSignDisclaimer', CUSTOMS_JOB_FORM_KEY] },
    raw: true,
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    referenceLabel: parseCustomsJobForm(byKey[CUSTOMS_JOB_FORM_KEY]).referenceLabel,
    containerNosInNote: byKey.invoiceContainerNosInNote === 'true',
    signDisclaimer: byKey.invoiceSignDisclaimer || '',
  };
}

const getInvoiceDetail = (id) => {
  const attr = [
    'name', 'address1', 'address1', 'person1', 'mobile1',
    'person2', 'mobile2', 'telephone1', 'telephone2', 'infoMail'
  ];
  return Invoice.findOne({
    where:{id:{ [Op.eq]: id }},
    include:[
      { model:Charge_Head },
      {
        model:SE_Job,
        attributes:[
          'jobNo', 'jobDate', 'shipDate', 'pol', 'pod', 'fd', 'vol', 'weight', 'pcs', 'flightNo', 'cwtClient', 'cwtLine', 'departureDate', 'customerRef'
        ],
        include:[
          { model:SE_Equipments , attributes:['qty', 'size'] },
          {
            model:Bl , attributes:['mbl', 'hbl'],
            include:[{model:Container_Info, attributes:['no']}]
          },
          { model:Voyage , attributes:['voyage', 'importArrivalDate', 'exportSailDate'] },
          { model:Clients, attributes:attr },
          { model:Clients, as:'consignee', attributes:attr },
          { model:Clients, as:'shipper', attributes:attr },
          { model:Clients, as:'shipping_line', attributes:attr },
          { model:Employees, as:'sales_representator', attributes:['name'] },
          { model:Vessel, as:'vessel', attributes:['carrier', 'name'] },
          { model:Clients, as:'air_line', attributes:['name'] },
        ]
      },
      { model: Sales_Tax_Invoice, attributes: ['taxInvoiceNo'], required: false },
    ],
    order: [
      [{ model: Charge_Head }, 'id', 'ASC'],
    ]
  }).then(attachPrintContext);
};

routes.get("/getInvoiceById", async(req, res) => {
  try {
      const resultOne = await getInvoiceDetail(req.headers.invoiceid);
      // Who generated it - see functions/recordCreators.
      if (resultOne) {
        const no = resultOne.invoice_No ?? resultOne.dataValues?.invoice_No;
        const name = (resultOne.createdBy ?? resultOne.dataValues?.createdBy)
          || (await creatorsOf(require("../../models"), 'Invoice', [no])).get(no) || null;
        if (resultOne.dataValues) resultOne.dataValues.createdByName = name; else resultOne.createdByName = name;
      }
      res.json({status:'success', result:{ resultOne }});
    }
    catch (error) {
      res.status(500).json({status:'error', result: error.message || error });
      console.error(error)
    }
});

// Token-gated (see functions/printToken.js) instead of session-gated: this is
// loaded by a headless browser (see functions/pdf.js) which has no login
// session, so it's exempted from the global auth middleware in index.js and
// does its own narrow, single-invoice, short-lived token check instead.
routes.get("/getPrintData", async(req, res) => {
  try {
    verifyPrintToken(req.headers.printtoken, req.headers.invoiceid);
    const resultOne = await getInvoiceDetail(req.headers.invoiceid);

    // The company's letterhead and bank accounts have to travel WITH the
    // payload here. This page is rendered by a headless browser with no login
    // and no redux store, so it cannot use functions/companyBranding.js the way
    // the interactive invoice screen does. Previously it didn't need them
    // because the name, logo and bank details were hardcoded in the frontend -
    // which is exactly what made the product un-leasable.
    let company = null;
    if (resultOne && resultOne.companyId != null) {
      company = await Company.findOne({
        where: { id: resultOne.companyId },
        attributes: ['id','title','short','logo','printLogo','address','phone','email','web','ntn','strn'],
        include: [{ model: BankAccount }],
      });
      // Flagged with the client / agent defaults, so the emailed PDF prints
      // the same account the invoice screen picks - see bankAccountDefaults.
      if (company) company = withBankDefaults(company.get({ plain: true }), await readBankDefaults(AppSetting));
    }

    res.json({status:'success', result:{ resultOne, company }});
  }
  catch (error) {
    res.status(401).json({status:'error', result: 'Invalid or expired print link.'});
  }
});

const { parseEmailList, isValidEmailList } = require('../../functions/emailList');

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// Plain-text default the user sees (and can edit) in the send-email preview.
const buildDefaultEmail = (invoice, employeeName) => {
  const subject = `Invoice ${invoice.invoice_No} - ${invoice.party_Name}`;
  const body =
`Dear ${invoice.party_Name},

Please find attached invoice ${invoice.invoice_No}${invoice.SE_Job?.jobNo ? ` for job ${invoice.SE_Job.jobNo}` : ''}, amount ${invoice.currency} ${invoice.total}.

This invoice is system generated and does not require a signature.

Regards,
${employeeName}`;
  return { subject, body };
};

// invoice.party_Id is a Child_Accounts.id (chart-of-accounts entry), not a
// Clients.id directly — resolve the actual party via Client_Associations.
const resolveInvoiceParty = async(partyId) => {
  const childAccount = await Child_Account.findOne({ where:{ id:partyId } });
  if (!childAccount) {
    return { error:'Could not resolve the account for this party.' };
  }
  const association = await Client_Associations.findOne({ where:{ ChildAccountId:childAccount.id } });
  if (!association) {
    return { error:'This party is not linked to a client record.' };
  }
  const party = await Clients.findOne({ where:{ id:association.ClientId } });
  if (!party) {
    return { error:'Could not find the client record for this party.' };
  }
  return { party };
};

// Bumps (or creates) the usage count for each address so it ranks higher in
// future /suggestEmails results — best-effort, never blocks the actual send.
const recordEmailUsage = async(emails) => {
  try {
    for (const email of emails) {
      const [row, created] = await Email_Suggestion.findOrCreate({
        where:{ email },
        defaults:{ usageCount:1, lastUsedAt:new Date() }
      });
      if (!created) {
        await row.update({ usageCount:row.usageCount + 1, lastUsedAt:new Date() });
      }
    }
  } catch (error) {
    console.error('recordEmailUsage failed:', error);
  }
};

routes.get("/suggestEmails", async(req, res) => {
  try {
    const q = (req.headers.q || '').trim();
    if (!q) {
      return res.json({ status:'success', result:[] });
    }
    const qLower = q.toLowerCase();

    const [history, employees, clients] = await Promise.all([
      Email_Suggestion.findAll({
        where:{ email:{ [Op.iLike]:`%${q}%` } },
        order:[['usageCount', 'DESC'], ['lastUsedAt', 'DESC']],
        limit:10,
      }),
      Employees.findAll({
        where:{ email:{ [Op.iLike]:`%${q}%` } },
        attributes:['email'],
        limit:10,
      }),
      Clients.findAll({
        where:{
          [Op.or]:[
            { infoMail:{ [Op.iLike]:`%${q}%` } },
            { accountsMail:{ [Op.iLike]:`%${q}%` } },
          ]
        },
        attributes:['infoMail', 'accountsMail'],
        limit:20,
      }),
    ]);

    const results = new Set();
    history.forEach(h => results.add(h.email));
    employees.forEach(e => e.email && results.add(e.email));
    clients.forEach(c => {
      [c.infoMail, c.accountsMail].forEach(field => {
        if (!field) return;
        field.split(/[;,]/).map(s => s.trim()).forEach(addr => {
          if (addr.toLowerCase().includes(qLower)) results.add(addr);
        });
      });
    });

    res.json({ status:'success', result:Array.from(results).slice(0, 10) });
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error.message || 'Failed to load email suggestions.' });
  }
});

routes.get("/getPartyEmails", async(req, res) => {
  try {
    const invoice = await Invoice.findOne({
      where:{ id:req.headers.invoiceid },
      include:[{ model:SE_Job, attributes:['jobNo'] }]
    });
    if (!invoice) {
      return res.json({ status:'error', result:'Invoice not found.' });
    }
    const { party, error } = await resolveInvoiceParty(invoice.party_Id);
    if (error) {
      return res.json({ status:'error', result:error });
    }
    const employee = await Employees.findOne({ where:{ id:req.headers.employeeid } });
    const { subject, body } = buildDefaultEmail(invoice, employee?.name || '');
    res.json({
      status:'success',
      result:{
        partyName:invoice.party_Name, infoMail:party.infoMail || '', accountsMail:party.accountsMail || '',
        defaultSubject:subject, defaultBody:body,
        defaultCc: process.env.DEFAULT_INVOICE_CC || '',
        defaultBcc: process.env.DEFAULT_INVOICE_BCC || '',
      }
    });
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error.message || 'Failed to load party emails.' });
  }
});

routes.post("/sendEmail", async(req, res) => {
  try {
    const { id, employeeId, to, cc, bcc, subject, body } = req.body;

    if (!isValidEmailList(to, { requireNonEmpty:true })) {
      return res.json({ status:'error', result:'Please provide a valid email address (or ; separated list) to send to.' });
    }
    if (!isValidEmailList(cc)) {
      return res.json({ status:'error', result:'One of the CC email addresses looks invalid.' });
    }
    if (!isValidEmailList(bcc)) {
      return res.json({ status:'error', result:'One of the BCC email addresses looks invalid.' });
    }

    const employee = await Employees.findOne({ where:{ id:employeeId } });
    if (!employee || !employee.email) {
      return res.json({ status:'error', result:'Your account has no email registered. Ask an admin to add one before sending invoices.' });
    }

    const invoice = await Invoice.findOne({
      where:{ id },
      include:[{ model:SE_Job, attributes:['jobNo'] }]
    });
    if (!invoice) {
      return res.json({ status:'error', result:'Invoice not found.' });
    }

    const fallback = buildDefaultEmail(invoice, employee.name);
    const finalSubject = (subject && subject.trim()) || fallback.subject;
    const finalBody = (body && body.trim()) || fallback.body;

    const pdfBuffer = await renderInvoicePdf(invoice.id);
    const toList = parseEmailList(to);
    const ccList = parseEmailList(cc);
    const bccList = parseEmailList(bcc);

    await sendMail({
      fromName: employee.name,
      fromEmail: employee.email,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: finalSubject,
      html: `<p>${escapeHtml(finalBody).replace(/\n/g, '<br/>')}</p>`,
      attachments: [
        { filename: `${invoice.invoice_No}.pdf`, content: pdfBuffer }
      ],
    });

    const historyNote = `Email Sent (${toList.join(', ')})${ccList.length ? ` [CC: ${ccList.length}]` : ''}${bccList.length ? ` [BCC: ${bccList.length}]` : ''}`;
    createHistory(employeeId, 'Invoice', historyNote, invoice.invoice_No);
    await recordEmailUsage([...toList, ...ccList, ...bccList]);
    res.json({ status:'success' });
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error.message || 'Failed to send invoice email.' });
  }
});

routes.get("/testResetSomeInvoices", async(req, res) => {
  try {

    const result = await Invoice.findAll({
      where:{
        id:[
          '965107244473122817', '965107244473253889', '965107244473286657', '965107244473319425', '965107244473450497', '965107244473483265', '965107244473516033', '965107244473548801', '965107244473581569', '965107244473614337', 965107244473909249,
          '965107244471975937', '965107244472008705', '965107244472172545', '965107244472500225', '965107244472532993', '965107244472565761', '965107244472598529', '965107244472631297', '965107244472827905', '965107244472991745',
          '965107244471353345', '965107244471418881', '965107244471451649', '965107244471484417', '965107244471615489', '965107244471648257', '965107244471713793', '965107244471844865', '965107244471877633', '965107244472041473'
        ]
      }
    });

    res.json({ status:'success', result:result });
  } catch (error) {

    res.status(500).json({status:'error', result: error.message || error });
  }
});

/**
 * The selected fiscal year's start and end, or null.
 *
 * Read through the same resolver every write path uses, so "fiscal year" on a
 * report means the year the session is actually working in rather than a
 * calendar guess. Returns null rather than throwing when none is selected -
 * resolvePeriod falls back to the fortnight, which is a short list, and a
 * missing selection should not stop a screen loading.
 */
const currentFiscalYearRange = async (req) => {
  try {
    const fy = await resolveSelectedFiscalYear(req.headers.fiscalyearid);
    return fy ? { startDate: fy.startDate, endDate: fy.endDate } : null;
  } catch (e) {
    return null;
  }
};

/**
 * The invoices a Payments & Receipts search names by NUMBER that the list
 * left off, with why - functions/invoiceNotListed. Looked up in the company
 * with none of the list's other conditions, at most five, and for one that is
 * settled the vouchers that settled it. By number only: a job, HBL or
 * container is on many invoices, most of them rightly elsewhere.
 */
const notListedInvoices = async ({ pattern, companyid, partyIds, pay, currency }) => {
  if (!pattern || !companyid) return [];
  const found = await Invoice.findAll({
    where: { companyId: String(companyid), invoice_No: { [Op.iLike]: pattern } },
    attributes: ['id', 'invoice_No', 'party_Id', 'party_Name', 'approved', 'payType', 'currency',
      'total', 'roundOff', 'paid', 'recieved'],
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    limit: 5,
    raw: true,
  });
  const ctx = { partyIds, pay, currency };
  const settledIds = found.filter((inv) => whyNotListed(inv, ctx) === 'settled').map((inv) => inv.id);
  const settledBy = new Map();
  if (settledIds.length) {
    const txs = await Invoice_Transactions.findAll({
      where: { InvoiceId: settledIds }, attributes: ['InvoiceId', 'VoucherId'], order: [['id', 'ASC']], raw: true,
    });
    const voucherIds = [...new Set(txs.map((t) => t.VoucherId).filter(Boolean))];
    const vouchers = voucherIds.length
      ? await Vouchers.findAll({ where: { id: voucherIds }, attributes: ['id', 'voucher_Id'], raw: true })
      : [];
    const numberOf = new Map(vouchers.map((v) => [v.id, v.voucher_Id]));
    txs.forEach((t) => {
      const no = numberOf.get(t.VoucherId);
      if (!no) return;
      const list = settledBy.get(t.InvoiceId) || [];
      if (!list.includes(no)) list.push(no);
      settledBy.set(t.InvoiceId, list);
    });
  }
  return notListed(found, ctx, settledBy);
};

// GET /getAllInvoicesByPartyId
routes.get("/getAllInvoicesByPartyId", async (req, res) => {
  try {
    const {
      id,
      type,
      pay,
      invoicecurrency,
      companyid,
      // edit // <-- intentionally unused to preserve original behavior
    } = req.headers;

    // Build the invoice filter exactly as before
    const where = {
      approved: "1",
      currency: invoicecurrency,
      companyId: companyid,
    };

    /* HOW FAR BACK TO LOOK, and how much of it to send.
     *
     * Some parties carry thousands of open invoices. Fetching all of them took
     * long enough to notice, and then put enough rows on the screen that
     * scrolling and typing lagged - the allocation grid re-renders every row as
     * a figure is entered into any one of them.
     *
     * BOTH ARE OPT-IN, and that is deliberate. A request that names no period
     * and no page behaves exactly as it always did, which is what the EDIT path
     * relies on: re-opening a saved voucher has to see every invoice that
     * voucher already allocated against, whenever they were raised and however
     * many pages down the list they would otherwise fall. Only the browse path
     * asks for a window.
     *
     * Dated on `createdAt` because there is nothing else - Invoice carries no
     * invoice-date column of its own - and applied as a half-open range, since
     * `createdAt` is a timestamp and `<= '2026-10-15'` compares against
     * midnight and drops most of that day's invoices. See functions/
     * reportPeriods. */
    let range = null;
    if (req.headers.period) {
      const fiscalYear = await currentFiscalYearRange(req);
      range = resolvePeriod(String(req.headers.period), {
        from: req.headers.from,
        to: req.headers.to,
        fiscalYear,
      });
      where.createdAt = {
        [Op.gte]: range.from,
        [Op.lt]: toExclusive(range),
      };
    }

    /* OUTSTANDING ONLY, when the screen says so.
     *
     * The browse list has always shown open invoices and dropped settled ones -
     * but it did that in the BROWSER, after the fetch. That was survivable
     * while it fetched everything; with a page and a window it is not, because
     * the count then describes one population and the rows another. The caption
     * said "95 in this period" over a handful of rows, and a page whose
     * invoices happened to be settled came back looking empty.
     *
     * So the same rule moves here, where the counting and the paging happen.
     * Written as a literal because total/paid/recieved are STRING columns -
     * every value in them parses as a number (checked), but the comparison has
     * to be numeric or '90' reads as less than '9'.
     *
     * OPT-IN, like the rest: the edit path needs settled invoices too, since a
     * voucher may already have settled the very invoice being re-opened. */
    /* WHAT "OUTSTANDING" MEANS - functions/invoiceOwed, the one rule.
     * What is owed is the ROUNDED total (round off included, as the ledger
     * and the knock-off have it) less what was received or paid; an invoice
     * is settled when that comes to under half a paisa. It was "total less
     * received is not exactly 0", so an invoice paid in full kept showing -
     * at 0.00 when a knock-off had left a hair of floating point in
     * `recieved`, at -0.44 when it had paid the round off too. */
    if (String(req.headers.outstanding || '') === 'true') {
      where[Op.and] = [
        ...(where[Op.and] || []),
        Sequelize.literal(OWED_SQL),
      ];
    }

    /* SEARCH, over what the Payments & Receipts list shows: the invoice number,
     * its job number, the job's HBL and MBL, a container on that bill, and -
     * when the text is a number - the amount.
     *
     * Done HERE rather than over the rows on screen, because the list is paged:
     * a search of the page in hand would say "not found" about an invoice
     * sitting on page three.
     *
     * Expressed on Invoice's own columns, with the job/bill/container matches as
     * sub-queries on SEJobId, so the count below - which runs with no joins -
     * counts exactly what the search found.
     *
     * A query-string parameter, not a header like the rest: a header must be
     * Latin-1, and a party or reference typed in any other script would make
     * the browser refuse to send the request at all. */
    const search = String(req.query.search ?? '').trim().slice(0, 100);
    // The user's own % and _ are text, not wildcards.
    const pattern = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    if (search) {
      const like = sequelize.escape(pattern);
      const matches = [
        { invoice_No: { [Op.iLike]: pattern } },
        Sequelize.literal(`"Invoice"."SEJobId" IN (SELECT "id" FROM "SE_Jobs" WHERE "jobNo" ILIKE ${like})`),
        Sequelize.literal(`"Invoice"."SEJobId" IN (SELECT "SEJobId" FROM "Bls" WHERE "hbl" ILIKE ${like} OR "mbl" ILIKE ${like})`),
        Sequelize.literal(`"Invoice"."SEJobId" IN (SELECT b."SEJobId" FROM "Bls" b JOIN "Container_Infos" c ON c."BlId" = b."id" WHERE c."no" ILIKE ${like})`),
      ];
      // An amount is looked for as typed on the screen, commas and all.
      const amount = search.replace(/,/g, '');
      if (/^\d+(\.\d+)?$/.test(amount)) {
        matches.push({ total: { [Op.like]: `%${amount}%` } });
      }
      where[Op.and] = [...(where[Op.and] || []), { [Op.or]: matches }];
    }

    const paged = req.headers.page !== undefined || req.headers.limit !== undefined;
    const page = Math.max(parseInt(req.headers.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.headers.limit, 10) || 50, 1), 500);
    /* 'Both' is the screen asking for payables AND receivables at once.
     *
     * That is what the agent branch used to do - it skipped this filter
     * entirely - except it was reachable only by first classifying the party as
     * an overseas agent. It is an explicit choice now, for any party. */
    if (pay && pay !== "Both") {
      where.payType = pay;
    }

    /* WHICH ID `party_Id` HOLDS DEPENDS ON WHAT WROTE THE INVOICE, and both
     * conventions are live in this database:
     *
     *   migrated and legacy invoices   the CLIENT id. Every one of the 79,283
     *                                  invoices on the customs install is this.
     *   aviation /makeInvoice          the LEDGER account id - see the note
     *                                  there, which is deliberate and says so.
     *
     * This route resolved the party's ledger account and matched on that ALONE,
     * so on a book written the first way it matched nothing at all and the
     * screen showed no invoices, ever. Matching either is what makes it work
     * without deciding which convention wins or migrating 79,283 rows.
     *
     * The association is now optional. It was a hard bail-out, which meant a
     * party with no ledger account returned an empty list rather than the
     * invoices it plainly has. */
    const account = await Client_Associations.findOne({
      where: { ClientId: parseInt(id, 10) },
      attributes: ["ChildAccountId"],
    });

    const partyIds = [String(id)];
    if (account && account.ChildAccountId) {
      partyIds.push(String(account.ChildAccountId));
    }
    where.party_Id = { [Op.in]: partyIds };

    // 2) Fetch invoices + SE_Job graph (but NOT transactions here)
    /* OLDEST FIRST - the order a party's invoices are settled in, which is
     * how Payments & Receipts is used: page 1 is the oldest outstanding. It
     * was newest first. The id breaks ties, so two invoices of one moment
     * never swap places between pages.
     *
     * ORDER MATTERS THE MOMENT OFFSET DOES: without it the database may return
     * a row on page 1 and again on page 3 and skip another entirely. Applied
     * on the unpaged path too - the edit flow - so a re-opened voucher lists
     * by date and time as well, whatever the screen does with it. */
    /* THE PAGE IS PICKED FIRST, BY INVOICE, then loaded with its job.
     *
     * One query did both, with subQuery: false - so LIMIT and OFFSET counted
     * the JOINED rows: one per equipment line and per container on the job's
     * BL. A job with 3 equipment lines and 4 containers used up 12 of a page's
     * "50", pages came back short, and the offset stepped over invoices that
     * then appeared on no page at all - while the count, taken without the
     * joins, promised pages that never showed them. Browsing the whole list
     * missed invoices that a search (a set small enough to fit one page)
     * found at once. */
    const ORDER = [['createdAt', 'ASC'], ['id', 'ASC']];
    let pageIds = null;
    if (paged) {
      const idRows = await Invoice.findAll({
        where, attributes: ['id'], order: ORDER, limit, offset: (page - 1) * limit, raw: true,
      });
      pageIds = idRows.map((r) => r.id);
    }
    const invoices = paged && !pageIds.length ? [] : await Invoice.findAll({
      where: paged ? { id: { [Op.in]: pageIds } } : where,
      subQuery: false,      // better plans with includes
      // Ordered whether paged or not: re-opening a voucher reads unpaged.
      order: ORDER,
      include: [
        {
          model: SE_Job,
          include: [
            { model: SE_Equipments, attributes: ["qty", "size"] },
            {
              model: Bl, required: false, attributes: ["mbl", "hbl"],
              include: [{ model: Container_Info, attributes: ["no"] }],
            },
          ],
        },
      ],
    });

    /* The count is of the WHOLE window, not the page, so the pager knows how
     * many pages there are - and counted only when something is paging, since
     * it is a second query the edit path has no use for. */
    const total = paged
      ? await Invoice.count({ where })
      : (invoices ? invoices.length : 0);

    if (!invoices || invoices.length === 0) {
      // Still carries the window it looked in. An empty list is the moment a
      // screen most needs to say "this fortnight", because the invoices are
      // very often there and simply older than the period asked for.
      return res.json({
        status: "success",
        result: [],
        period: range || null,
        count: 0,
        ...(paged ? { page, limit, pages: 0 } : {}),
        // A search that found nothing says why the invoice it named is not
        // here - paid, another currency, another party... See the function.
        ...(search ? {
          notListed: await notListedInvoices({ pattern, companyid, partyIds, pay, currency: invoicecurrency }),
        } : {}),
      });
    }

    // 3) Batch-load ALL transactions in ONE query and attach (avoid N+1)
    //
    // `Op` is the module-level one. It used to be re-required HERE, which made
    // it a function-scoped const - and a const is in its temporal dead zone
    // from the top of the function, not from the line that declares it. So the
    // party filter above, which reads Op long before this line runs, threw
    // "Cannot access 'Op' before initialization" even though Op is imported at
    // the top of the file. Same object either way; the local one just shadowed
    // it for the whole function.
    const invoiceIds = invoices.map((inv) => inv.id);

    // Detect FK name robustly (invoiceId vs InvoiceId)
    const txFk = Invoice_Transactions.rawAttributes.invoiceId
      ? "invoiceId"
      : (Invoice_Transactions.rawAttributes.InvoiceId ? "InvoiceId" : null);

    if (txFk) {
      const txRows = await Invoice_Transactions.findAll({
        where: { [txFk]: { [Op.in]: invoiceIds } },
      });

      // Group by invoice FK
      const txMap = new Map();
      for (const tx of txRows) {
        const key = tx[txFk];
        if (!txMap.has(key)) txMap.set(key, []);
        txMap.get(key).push(tx);
      }

      for (const inv of invoices) {
        inv.setDataValue("Invoice_Transactions", txMap.get(inv.id) || []);
      }
    } else {
      await Promise.all(
        invoices.map(async (inv) => {
          const list = await Invoice_Transactions.findAll({
            where: { InvoiceId: inv.id },
          });
          inv.setDataValue("Invoice_Transactions", list);
        })
      );
    }

    return res.json({
      status: "success",
      result: invoices,
      // Named so the screen can show what it actually fetched - "fortnight" on
      // the 2nd of a month is two days, and a list that looks empty should be
      // able to say why.
      period: range || null,
      count: total,
      ...(paged ? { page, limit, pages: Math.ceil(total / limit) } : {}),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/getAllOldInvoicesByPartyId", async(req, res) => {
  try {
    const result = await Invoice.findAll({
      where:{
        approved:"1",
        party_Id:req.headers.id,
        payType:req.headers.pay,
        status:"2",
        //...chardHeadLogic(req.headers.invoicecurrency)
      },
      attributes:['id','invoice_No', 'invoice_Id', 'recieved', 'paid', 'status', 'total', 'currency', 'roundOff', 'party_Id'],
      order:[['invoice_Id', 'ASC']],
      include:[
        {
          model:SE_Job,
          attributes:['jobNo', 'subType']
        },
        {
          model:Charge_Head,
          attributes:['net_amount', 'local_amount', 'currency', 'ex_rate']
        }
      ]
    });
    let partyAccount = null;
    if(result.length>0){
      if(req.headers.party=="vendor"||req.headers.party=="agent"){
        partyAccount = await Vendor_Associations.findAll({
          where:{
            VendorId:result[0].party_Id,
            CompanyId:req.headers.companyid  //<-- I'm Unsure About This 
          },
          include:[
            {
              model:Child_Account,
              include:[
                { 
                  model:Parent_Account,
                  where:{ 
                    title:req.headers.pay=="Recievable"?
                      "ACCOUNT RECEIVABLE":
                      "ACCOUNT PAYABLE" 
                  }
                }
              ]
            }
          ]
        })
      } else if(req.headers.party=="agent"){
        partyAccount = await Vendor_Associations.findAll({
          where:{
            VendorId:result[0].party_Id,
            CompanyId:req.headers.companyid  //<-- I'm Unsure About This 
          },
          include:[
            { model:Child_Account,
              include:[
                { model:Parent_Account, where:{ title:req.headers.pay=="Recievable"?"ACCOUNT RECEIVABLE":"ACCOUNT PAYABLE" } }
              ]
            }
          ]
        })
      } else {
        partyAccount = await Client_Associations.findAll({
          where:{ ClientId:result[0].party_Id, CompanyId:req.headers.companyid },
          include:[
            {
              model:Child_Account,
              include:[
                { model:Parent_Account, where:{ title:req.headers.pay=="Recievable"?"ACCOUNT RECEIVABLE":"ACCOUNT PAYABLE" } }
              ]
            }
          ]
        });
      }
    }
      res.json({ status:'success', result:result, account:partyAccount });
    }
    catch (error) {
      res.status(500).json({status:'error', result: error.message || error });
    }
});

routes.get("/deleteInvoice", async(req, res) => {
  try{
    const invoice = await Invoice.findOne({where:{id:req.headers.id}})
    await Charge_Head.update(
      { invoice_id: null, InvoiceId: null, status: 0 },
      { where: { InvoiceId: invoice.dataValues.id } }
    );
    await Invoice.destroy({where:{id:req.headers.id}})
    res.json({status:'success'});
  }catch(error){
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.get("/dateExperiment", async(req, res) => {
  try {
    const from = moment("2023-02-23");
    const to = moment("2023-02-25");
    const resultOne = await Invoice.findAll({
      where:{
        createdAt: {
          [Op.gte]: from.toDate(),
          [Op.lte]: to.toDate(),
          }
      },
      order: [[ 'createdAt', 'ASC' ]]
    });
    res.json({status:'success', result:{ resultOne }});
    }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.get("/getTransaction", async(req, res) => {
  try {
    let { history, offset, type } = req.headers;
    const count = await Vouchers.count({
      where:{ [Op.or]: [{type: 'Job Reciept'}, {type:'Job Payment'}] },
      });
    if (history=="false" & (type=="front" || type=="last")){
      offset = count - 1;
    } else if(history=="false" & (type=="first" || type=="back")){
      offset = 0
    }
    const result = await Vouchers.findAll({
      limit:1, offset:offset, where:{ [Op.or]: [{type: 'Job Reciept'}, {type:'Job Payment'}] },
    })
    // let ids = result[0].dataValues.invoices.split(", ")
    // const invoices = await Invoice.findAll({
    //   where:{id:ids},
    //   include:[{model:SE_Job, attributes:['jobNo', 'subType']}]
    // })
    await res.json({status: 'success', result:{result:result[0], count, offset}});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.get("/getAllInvoices", async(req, res) => {
  try{
    const account = req.headers.type == "client" ? Client_Associations : Vendor_Associations;
    // const obj = req.headers.type == "Client" ? { ClientId: parseInt(req.headers.id) } : { VendorId: parseInt(req.headers.id) };
    const acc = await account.findOne({
      where: {
        CompanyId: req.headers.companyid,
        ChildAccountId: parseInt(req.headers.id),
      },
    });
    const ClientId = req.headers.type == "client" ?acc.dataValues.ClientId.toString() : acc.dataValues.VendorId.toString()
    const result = await Invoice.findAll({
      where: {
        party_Id: ClientId,
        payType: req.headers.paytype,
        id: { [Op.ne]: req.headers.invoiceid }
      },
      include: [
        {
          model: Invoice_Transactions, // Add any desired attributes for Invoice_Transactions
        },
        {
          model: SE_Job,
          attributes: ['id', 'jobNo', 'subType'],
          include: [
            {
              model: Bl,
              attributes: ['hbl', 'mbl'],
              include: [
                {
                  model: Container_Info,
                  attributes: ['no']
                }
              ]
            }
          ]
        }
      ]
    });
    res.json({status: 'success', result: result});
  }catch(error){
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
})

routes.post("/createInvoiceTransaction", async(req, res) => {
  try {
    // Was forEach(async) with un-awaited calls inside it - so neither loop
    // waited for anything, and 'success' went out before the first write
    // landed. Settling an invoice and recording its exchange loss are one
    // accounting event, so they share a transaction.
    await sequelize.transaction(async (t) => {
      for (const x of req.body.invoices) {
        await Invoice.update(x, { where: { id: x.id }, transaction: t });
      }
      for (const y of req.body.invoiceLosses) {
        await Invoice_Transactions.upsert(y, { transaction: t });
      }
    });
    createHistory(req.body.employeeId, 'Invoice', 'Transaction', req.body.invoices[0].invoice_No);
    res.json({status: 'success', result: 'result'});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

// round off an invoice
/* The invoice page's Round Off box. An approved invoice is in the ledger with
 * the round off it was approved with, so it is refused here - unapprove first.
 * Approval works the figure out again from the total it posts; see
 * functions/invoiceRoundOff. */
routes.post("/roundOffInv", async(req, res) => {
  try {
    const invoice = await Invoice.findOne({ where: { id: req.body.id }, attributes: ['id', 'approved', 'type', 'currency'] });
    if (!invoice) return res.status(404).json({ status: 'error', result: 'Invoice not found.' });
    if (String(invoice.approved) === '1') {
      return res.status(400).json({ status: 'error', result: 'The invoice is approved - unapprove it to change its round off.' });
    }
    const roundOff = String(req.body.roundOff ?? '0');
    if (!/^[+-]?\d+(\.\d+)?$/.test(roundOff)) {
      return res.status(400).json({ status: 'error', result: 'Not a round off.' });
    }
    if (hasRoundOff(roundOff) && !isRoundable(invoice.dataValues)) {
      return res.status(400).json({ status: 'error', result: 'Only an invoice in rupees can be rounded off.' });
    }
    await Invoice.update({ roundOff }, { where:{id:req.body.id} });
    await res.json({status: 'success', result: 'result'});
    
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

// Approve or disapprove an invoice
/**
 * Change an invoice's date - and with it the date its SI / PI voucher stands
 * on in the ledger. The CFO's ruling (2026-10-02): an SI or PI always stands
 * on its invoice's date, so the two move together or not at all.
 *
 * WITHIN THE INVOICE'S OWN FISCAL YEAR. Its number carries that year's suffix
 * and its sequence is that year's; a JI-12/27 dated in another year is two
 * answers to one question. A locked year - or one other than the year the
 * user has selected - is refused by the fiscal-year hooks, as any edit is.
 *
 * EVERY VOUCHER POSTING IT moves: Odyssey's own, and Climax's for a migrated
 * invoice (functions/invoiceVoucher) - the voucher and every line, which is
 * what the ledger reads. An unapproved invoice has none; its approval posts
 * on whatever date it has by then.
 *
 * Stored as midnight UTC of the day picked - the shape migrated invoices and
 * their vouchers already have, and the same calendar day wherever it is read.
 */
routes.post("/changeDate", async (req, res) => {
  try {
    const date = String(req.body.date || '').trim();
    if (!moment(date, 'YYYY-MM-DD', true).isValid()) {
      return res.status(400).json({ status: 'error', result: 'Pick a valid date.' });
    }
    const invoice = await Invoice.findOne({
      where: { id: req.body.id },
      attributes: ['id', 'invoice_No', 'payType', 'companyId', 'climaxId', 'FiscalYearId', 'createdAt'],
    });
    if (!invoice) return res.status(404).json({ status: 'error', result: 'Invoice not found.' });

    const year = invoice.FiscalYearId ? await FiscalYears.findByPk(invoice.FiscalYearId) : null;
    if (year && (date < year.startDate || date > year.endDate)) {
      return res.status(400).json({
        status: 'error',
        result: `${invoice.invoice_No} belongs to fiscal year ${year.label} `
          + `(${moment(year.startDate).format('DD MMM YYYY')} to ${moment(year.endDate).format('DD MMM YYYY')}). `
          + 'Pick a date inside it.',
      });
    }

    const postedAt = new Date(`${date}T00:00:00.000Z`);
    const voucherIds = await sequelize.transaction(async (t) => {
      await Invoice.update({ createdAt: postedAt }, { where: { id: invoice.id }, transaction: t });
      const ids = await invoiceVoucherIds(sequelize, invoice, { transaction: t });
      if (ids.length) {
        await Vouchers.update({ createdAt: postedAt, tranDate: postedAt.toISOString() }, { where: { id: ids }, transaction: t });
        await Voucher_Heads.update({ createdAt: postedAt }, { where: { VoucherId: ids }, transaction: t });
      }
      return ids;
    });

    createHistory(req.body.employeeId, 'Invoice', 'Date Change', invoice.invoice_No);
    res.json({
      status: 'success',
      invoice: await Invoice.findOne({ where: { id: invoice.id } }),
      vouchersMoved: voucherIds.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post("/invApproveDisapp", async(req, res) => {
  try {
    await Invoice.update({ total:req.body.total, approved:req.body.approved, ex_rate:req.body.exRate, status:"1" }, { where:{id:req.body.id} });
    await res.json({status: 'success', result: 'result'});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

// Adds a note to invoice and also the currency
/* THE INVOICE'S CURRENCY - saved as soon as it is picked, its total rebuilt
   from the charge lines as approval does; refused on an approved invoice, and
   for a foreign currency the lines are not in. See functions/invoiceCurrency. */
routes.post("/changeCurrency", async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ where: { id: req.body.id } });
    if (!invoice) return res.status(404).json({ status: 'error', result: 'Invoice not found.' });
    const lines = await Charge_Head.findAll({
      where: { InvoiceId: invoice.id }, attributes: ['type', 'currency', 'net_amount', 'local_amount'], raw: true,
    });
    const change = currencyChange(invoice.dataValues, lines, req.body.currency);
    if (change.refusal) return res.status(409).json({ status: 'error', result: change.refusal });
    const from = invoice.currency;
    await invoice.update({ currency: change.currency, total: String(change.total) });
    createHistory(req.body.employeeId, 'Invoice', `Currency ${from || '-'} to ${change.currency}`, invoice.invoice_No);
    res.json({ status: 'success', result: { id: invoice.id, currency: change.currency, total: change.total } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post("/addInvoiceNote", async(req, res) => {
  try {
    // The note only. It used to write back the currency and total the screen
    // held too - stale ones, from a tab opened before a change - and was the
    // only way the currency box was ever saved (see /changeCurrency).
    const patch = { note:req.body.note };
    // The vendor's own tax invoice number, on a bill - entered here once it
    // arrives, after the bill was raised. Only when sent, so a screen that
    // does not show it never blanks it.
    if (req.body.vendorTaxInvoiceNo !== undefined) {
      patch.vendorTaxInvoiceNo = String(req.body.vendorTaxInvoiceNo ?? '').trim() || null;
    }
    await Invoice.update(patch, { where:{id:req.body.id} });
    createHistory(req.body.employeeId, 'Invoice', 'Add Note', req.body.invoice_No);
    await res.json({status: 'success', result: 'result'});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

/**
 * A charge row belongs to exactly one parent: a freight job, a customs job or
 * an aviation consignment - see functions/Associations/incoiceAssociations.
 * A row that names none of them is filled in from the freight job the request
 * is saving (`jobId`); one that already names a parent keeps it, so a customs
 * or aviation charge is never re-parented onto a freight job id.
 */
const CHARGE_PARENTS = ['SEJobId', 'CustomsJobId', 'AviationConsignmentId'];
const hasChargeParent = (x) => CHARGE_PARENTS.some((k) => x?.[k] !== undefined && x?.[k] !== null && x?.[k] !== '');
const withChargeParent = (x, jobId) =>
  (hasChargeParent(x) || jobId === undefined || jobId === null ? x : { ...x, SEJobId: jobId });

routes.post("/saveChargeHeades", async(req, res) => {
  const t = await sequelize.transaction();
  let committed = false;
  try {
    const jobId = req.body.id;
    const charges = Array.isArray(req.body.charges) ? req.body.charges : [];

    await Charge_Head.destroy({where:{id:req.body.deleteList}, transaction: t})
    await SE_Job.update({exRate:req.body.exRate}, {where:{id:jobId}, transaction: t})

    // Was `Promise.all([ charges.forEach(x => { Charge_Head.upsert(x) }) ])`,
    // which awaits nothing at all: forEach returns undefined, so Promise.all
    // resolved on [undefined] immediately while the upserts ran unwatched. Any
    // one of them rejecting became an unhandled rejection and crashed the
    // process. Same defect /saveHeadesNew below had.
    for (const x of charges) {
      await Charge_Head.upsert(withChargeParent(x, jobId), { transaction: t });
    }

    await t.commit();
    committed = true;

    createHistory(req.body.employeeId, 'Invoice', 'Round Off', req.body.invoice_No);
    res.json({status:'success'});
  }
  catch (error) {
    if (!committed) await t.rollback().catch(() => {});
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
});

// This api saves the heads added on the related Job
routes.post("/saveHeadesNew", async(req, res) => {
  try {
    const jobId = req.body.id;
    let charges = Array.isArray(req.body.charges) ? req.body.charges : [];

    // Every row must know what it belongs to. This endpoint is "save the
    // charges for job <id>", so a row that arrives with no parent is filled in
    // from the request rather than rejected - the UI can drop it when a charge
    // is added before the job finishes loading. A row with no parent AND no
    // job on the request has nowhere to go; that is how a charge row missing
    // its SEJobId used to take the whole server down.
    const orphans = charges.filter((x) => !hasChargeParent(x) && (jobId === undefined || jobId === null));
    if (orphans.length) {
      return res.status(400).json({
        status: 'error',
        result: `${orphans.length} charge row(s) are not attached to a job. Reopen the job and try again.`,
      });
    }
    // A USD (any foreign) charge still open to change needs a rate above 1 -
    // functions/chargeExRate.
    const rateProblem = foreignRateProblem(charges);
    if (rateProblem) return res.status(400).json({ status: 'error', result: rateProblem });

    /* WHAT THIS USER MAY CHANGE ON THE SHEET - functions/chargeRights. A line's
       approval is the charges' Approve right: without it, approvals stay as
       stored. A line on an unapproved invoice is part of that invoice: without
       the right to edit job invoices, it is neither rewritten nor deleted.
       Asked only when the save really changes one. */
    let held = false;
    let frozenWarning = null;
    // The lines this save touches, by id - whichever job they hang off: the
    // invoice screen's charge editor (Components/Shared/InvoiceEditor) saves
    // a customs or aviation invoice's lines through here as well.
    const deleteList = [].concat(req.body.deleteList ?? []).filter((id) => id !== null && id !== undefined && id !== '');
    const touched = [...charges.map((x) => x.id), ...deleteList].filter((id) => id !== null && id !== undefined && id !== '');
    {
      const stored = touched.length ? (await Charge_Head.findAll({
        where: { id: touched },
        include: [{ model: Invoice, attributes: ['id', 'approved', 'invoice_No'], required: false }],
      })).map((r) => r.get({ plain: true })) : [];

      /* A LINE ON AN APPROVED INVOICE IS FROZEN, whoever saves - functions/
         chargeRights approvedInvoiceLock. Removing one is refused (it left
         ACS-JB-818/27 approved with no lines, counted twice in Job P&L); any
         other change is dropped, so a stale copy of the sheet cannot detach a
         line from its invoice or undo its approval. */
      const lock = approvedInvoiceLock(charges, stored, { removed: deleteList });
      if (lock.refusal) return res.status(409).json({ status: 'error', result: lock.refusal });
      charges = lock.keep;
      frozenWarning = lock.warning;

      const need = chargeRightsNeeded(charges, stored, { removed: deleteList });
      if (need.approve && !(await allowsPart(req, ['jobCharges:approve', 'invoices:approve'], 'charge approval'))) {
        charges = holdApprovals(charges, stored);
      }
      if (need.invoiced && !(await allowsPart(req, ['jobInvoices:edit', 'invoices:edit'], 'invoiced charges'))) {
        const open = openInvoiceLineIds(stored);
        charges = charges.filter((x) => !open.has(String(x.id)));
        if (req.body.deleteList !== undefined) req.body.deleteList = deleteList.filter((id) => !open.has(String(id)));
        held = true;
      }
    }

    /* ONE OF EACH CHARGE PER SIDE, when the install has it on - see
       functions/jobChargeRepeats. The freight job's sheet as it will stand:
       its lines now, less those deleted or rewritten here, plus what was sent
       for it. Only when the save is for a job - the invoice screen's editor
       sends lines without one, changing lines already there. */
    const sheetJobId = parseInt(jobId, 10);
    if (Number.isFinite(sheetJobId) && await readUniqueJobCharges({ AppSetting })) {
      const before = await Charge_Head.findAll({ where: { SEJobId: sheetJobId }, attributes: ['id', 'type', 'charge'], raw: true });
      const gone = new Set([...[].concat(req.body.deleteList ?? []), ...charges.map((x) => x?.id)]
        .filter((id) => id !== null && id !== undefined && id !== '').map(String));
      const after = [
        ...before.filter((c) => !gone.has(String(c.id))),
        ...charges.filter((x) => !hasChargeParent(x) || String(x.SEJobId) === String(sheetJobId)),
      ];
      const repeats = sheetRepeats(after, before);
      if (repeats.length) {
        const masters = await Charges.findAll({
          where: { id: repeats.map((r) => parseInt(r.charge, 10)).filter(Number.isFinite) },
          attributes: ['id', 'name', 'short'],
        });
        return res.status(400).json({
          status: 'error',
          result: sheetRepeatsMessage(repeats, Object.fromEntries(masters.map((m) => [String(m.id), m.name || m.short]))),
        });
      }
    }

    // for...of, not forEach(async): the `await` in front of forEach awaited
    // undefined, so every upsert was still in flight when we replied.
    // One transaction for the delete, the exchange rate and the rows - they
    // are one save, and a half-applied charge sheet is a wrong job total.
    // (The delete and the rate update used to run before, and outside, it.)
    const moved = [];
    await sequelize.transaction(async (t) => {
      // Which invoices have a line changing party in this save - from the
      // lines as they stand, before the upsert overwrites them.
      const ids = charges.map((x) => x.id).filter((id) => id !== undefined && id !== null && id !== '');
      const before = ids.length
        ? await Charge_Head.findAll({ where: { id: ids }, attributes: ['id', 'partyId'], transaction: t })
        : [];
      const partyBefore = new Map(before.map((l) => [String(l.id), String(l.partyId)]));
      const movedInvoices = new Set(charges
        .filter((x) => x.InvoiceId != null && partyBefore.has(String(x.id)) && partyBefore.get(String(x.id)) !== String(x.partyId))
        .map((x) => x.InvoiceId));

      if (req.body.deleteList != undefined) {
        await Charge_Head.destroy({where:{id:req.body.deleteList}, transaction: t});
      }
      if (jobId != undefined) {
        // The job's USD rates: Selling (exRate) and Buying - the Charges
        // tab's Ex.Rate USD section, as Climax kept them on the job.
        await SE_Job.update({
          exRate: req.body.exRate,
          ...(req.body.exRateBuying !== undefined ? { exRateBuying: req.body.exRateBuying } : {}),
        }, {where:{id:jobId}, transaction: t});
      }
      for (const x of charges) {
        await Charge_Head.upsert(withChargeParent(x, jobId), { transaction: t });
      }
      for (const invoiceId of movedInvoices) {
        const invoice = await moveInvoiceToItsLines(invoiceId, t);
        if (invoice) moved.push(invoice);
      }
    });
    createHistory(req.body.employeeId, 'Invoice', 'Add Note', req.body.invoice_No);
    moved.forEach((invoice) => createHistory(req.body.employeeId, 'Invoice', 'Change Party', invoice.invoice_No));
    const warnings = [
      held ? 'Charges on an unapproved invoice were left as they were - changing them is editing the invoice, which needs the right to edit job invoices.' : null,
      frozenWarning,
    ].filter(Boolean);
    res.json({
      status: 'success',
      ...(warnings.length ? { warning: warnings.join(' ') } : {}),
    });
  }
  catch (error) {
    console.error(error)
    // A move refused below says why, in words; anything else is a 500.
    res.status(error.status || 500).json({status:'error', result: error.message || error });
  }
});

/**
 * AN INVOICE MOVES TO THE PARTY ITS LINES WERE MOVED TO - and keeps its
 * number. Raised to the wrong party, an invoice is un-approved, its lines are
 * given the right party on the charges screen, and saved: the same document,
 * now the new party's, which is what the user asked for (rather than the lines
 * leaving it, which would void the number and raise another).
 *
 * Refused, and the whole save with it, when that would leave a wrong
 * document: lines of two parties on one invoice, an approved invoice (its
 * voucher has posted to the old party), a party of another kind than the
 * document (an overseas agent on a Job Invoice would need an Agent Invoice and
 * its number series), or a party with no ledger account to post to.
 *
 * @returns the invoice when it moved, or null when it was already that party's.
 */
async function moveInvoiceToItsLines(invoiceId, t) {
  const refuse = (status, message) => Object.assign(new Error(message), { status });
  const invoice = await Invoice.findByPk(invoiceId, { transaction: t });
  if (!invoice) return null;
  const lines = await Charge_Head.findAll({
    where: { InvoiceId: invoiceId }, attributes: ['partyId', 'name', 'partyType', 'invoiceType'], transaction: t,
  });
  if (!lines.length) return null;
  if (new Set(lines.map((l) => String(l.partyId))).size > 1) {
    throw refuse(400, `${invoice.invoice_No} would have lines for two parties. Move all of its lines to the new party together.`);
  }
  const [line] = lines;
  const accounts = await Client_Associations.findAll({
    where: { ClientId: line.partyId }, attributes: ['ChildAccountId'], transaction: t,
  });
  // Already that party's - a line saved again under the party it had.
  if (accounts.some((a) => String(a.ChildAccountId) === String(invoice.party_Id))) return null;
  if (String(invoice.approved) === '1') {
    throw refuse(409, `${invoice.invoice_No} is approved. Un-approve it before moving it to another party.`);
  }
  const kind = (type) => String(type || '').replace(/^Old\s+/i, '');
  const an = (type) => `${/^[AEIOU]/i.test(type) ? 'an' : 'a'} ${type}`;
  if (line.invoiceType && invoice.type && kind(line.invoiceType) !== kind(invoice.type)) {
    throw refuse(400, `${invoice.invoice_No} is ${an(kind(invoice.type))}; ${line.name} would need ${an(kind(line.invoiceType))}. Pick a party of the same kind.`);
  }
  if (!accounts.length || accounts[0].ChildAccountId == null) {
    throw refuse(400, `${line.name} has no ledger account, so ${invoice.invoice_No} cannot move to it. Give the party an account in Setup > Parties first.`);
  }
  await invoice.update({
    party_Id: String(accounts[0].ChildAccountId),
    party_Name: line.name,
    partyType: line.partyType || invoice.partyType,
  }, { transaction: t });
  return invoice;
}

// This api shows the heads added on the related Job
routes.get("/getHeadesNew", async(req, res) => {
  try {
    const jobId = req.query.id || req.headers.id;
    if (!jobId) {
      return res.json({status:'error', result:'SEJobId parameter is required'});
    }
    const result = await Charge_Head.findAll({
      where: { SEJobId: jobId },
      include: [
        {
          model: Invoice,
          attributes: ['id', 'status', 'approved'],
          include: {
            model: Invoice_Transactions,
          }
        }
      ],
      order: [['id', 'ASC']] // or 'DESC' if you want descending
    });
    res.json({status:'success', result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
});

// This function is used in the API below helps to set invoice number according to the last generated invoice with fiscal year
const createInvoices = async (lastJB, init, type, companyId, operation, x, fiscalYear, numbering) => {
  try{
    let company = '';
    let inVoiceDeleteList = []
    let account = await Client_Associations.findOne({
      where:{
        ClientId: x.partyId
      }
    })
    // Said, not swallowed: without an account the document has nowhere to
    // post, and this used to fail further on as a bare "undefined" error.
    if (!account || account.ChildAccountId == null) {
      throw new Error(`${x.name || 'The selected party'} has no ledger account, so no ${type} can be raised for it. `
        + 'Give the party an account in Setup > Parties and try again.');
    }
    /* RECYCLE ONLY A DOCUMENT THIS SCREEN LEFT EMPTY. The last invoice of the
     * type being empty used to be enough to delete it and reuse its number -
     * meant for a raise that failed half way. A MIGRATED one is empty too when
     * Climax emptied or cancelled it, and deleting that throws away the record
     * of a number Climax issued (or, when the delete is refused, hands the new
     * document a number that is already taken). So: no legacy id, never
     * approved, no lines - otherwise it is a real document and the next number
     * is the one after it. */
    const recyclable = Boolean(lastJB)
      && lastJB?.Charge_Heads?.length == 0
      && (lastJB.climaxId === null || lastJB.climaxId === undefined)
      && String(lastJB.approved) !== '1';
    if(recyclable){
      inVoiceDeleteList.push(lastJB.id)
    }
    let addition = recyclable?0:1;
    company = await companyShort(companyId);
    const invoiceYear = fiscalYear.suffix;
    const nextInvoiceId = (lastJB == null || lastJB.invoice_Id == null)
      ? 1
      : parseInt(lastJB.invoice_Id) + parseInt(addition);
    let result = {
      invoice_No: invoiceNumber(numbering, { type, company, seq: nextInvoiceId, suffix: invoiceYear }),
      invoice_Id: nextInvoiceId,
      type:type,
      status: "1",
      companyId:companyId,
      operation:operation,
      payType: x.type,
      party_Id: account.ChildAccountId,
      party_Name: x.name,
      SEJobId: x.SEJobId,
      currency:(init=="JB"||init=="JI")?'PKR':x.currency,
      ex_rate:x.ex_rate,
      partyType:x.partyType,
      FiscalYearId: fiscalYear.id,
    }
    // Awaited: an un-awaited delete that failed went unnoticed while the new
    // document went out under the number it was meant to free.
    if (inVoiceDeleteList.length) await Invoice.destroy({where:{id:inVoiceDeleteList}})
    return result;
  }catch(e){
    console.error(e)
    // Rethrown: swallowing it returned nothing, and the caller then failed on
    // that nothing with a message about undefined rather than this one.
    throw e
  }

};

routes.get("/getAllInvoiceData", async(req, res) => {
  try{
    const InvTran = await Invoice_Transactions.findAll({
      where:{InvoiceId:req.headers.id}
    })

    let vouchers = []
    for(let x of InvTran){
      const voucher = await Vouchers.findOne({
        where:{
          id:x.dataValues.VoucherId
        }
      });
      vouchers.push(voucher.dataValues)
    }

    const heads = [];

    const rawPartyId = req.headers.party_id;
    // Coerce to number if numeric, else keep as-is (depends on your schema)
    const partyId = isNaN(Number(rawPartyId)) ? rawPartyId : Number(rawPartyId);

    for (const x of vouchers) {
      // Find association for this party (once per iteration; can be moved out if same for all vouchers)
      const partyAssoc = await Client_Associations.findOne({
        where: { ClientId: partyId },
        attributes: ['ChildAccountId']
      });

      // Build a unique list of candidate ChildAccountIds to check
      const candidateChildIds = Array.from(new Set(
        [partyId, partyAssoc?.ChildAccountId].filter(Boolean)
      ));

      const head = await Voucher_Heads.findAll({
        where: {
          VoucherId: x.id,
          ChildAccountId: { [Op.in]: candidateChildIds },
          // If you’re on Postgres and want case-insensitive, use Op.notILike
          narration: { [Op.notLike]: '%Ex-Rate%' }
          // narration: { [Op.notILike]: '%Ex-Rate%' } // Postgres only
        }
      });

      head.forEach((y) => {
        heads.push(y.dataValues);
      });
    }

    res.json({status:'success', result:{InvTran, vouchers, heads}});
  }catch(error){
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
})

// generate new invoice with invoice number (This API generates only invoice numbers)
routes.post("/makeInvoiceNew", async(req, res) => {
  try {
    /* ALREADY ON AN INVOICE: refused, as aviation and customs refuse it.
     * The lines are written back below with the new document's number and
     * id, so a charge that was already billed moved off its invoice onto
     * this one - the first invoice silently lost a line and the charge was
     * billed twice over. Read from the DATABASE, not from the request: the
     * request is the stale copy of the sheet that would make this happen. */
    const selectedIds = (req.body.chargeList || [])
      .map((x) => x?.id)
      .filter((id) => id !== undefined && id !== null && id !== '');
    if (selectedIds.length) {
      const billed = await Charge_Head.findAll({
        where: { id: selectedIds, InvoiceId: { [Op.ne]: null } },
        attributes: ['id', 'invoice_id'],
      });
      if (billed.length) {
        const numbers = [...new Set(billed.map((c) => c.invoice_id).filter(Boolean))];
        return res.status(409).json({
          status: 'error',
          result: `${billed.length} of the selected charges are already invoiced`
            + (numbers.length ? ` (${numbers.join(', ')})` : '')
            + '. Untick them, or take them off that invoice first.',
        });
      }
    }

    const company = await companyShort(req.body.companyId);
    const fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId);
    const invoiceYear = fiscalYear.suffix;

    // The last invoice of each type this year, found by type and invoice_Id -
    // not by parsing invoice_No, whose code and prefix Config > Document
    // Numbers can change (and not by createdAt, which on these rows is the
    // job's ship / departure date). See functions/invoiceNumber.
    const numbering = await readNumbering();
    const findLastInvoice = (type) => lastInvoiceInYear(Invoice, {
      type,
      companyId: req.body.companyId,
      suffix: invoiceYear,
      settings: numbering,
      // climaxId / approved decide whether an empty one may be recycled -
      // see createInvoices.
      attributes: ["id", "invoice_Id", "climaxId", "approved"],
      include: [{ model: Charge_Head, attributes: ['id'] }],
    });

    /* A line with no document type gets the one the charge sheet would give
     * it (ChargesComp/PartySearch): receivable -> Job Invoice, or Agent Invoice
     * for an agent; payable -> Job Bill, or Agent Bill. Migrated lines Climax
     * never invoiced arrived with none, matched no branch below, and an EMPTY
     * invoice was created for them. */
    const documentTypeOf = (x) => x.invoiceType || (x.type === 'Recievable'
      ? (x.partyType === 'agent' ? 'Agent Invoice' : 'Job Invoice')
      : (x.partyType === 'agent' ? 'Agent Bill' : 'Job Bill'));
    let result = (req.body.chargeList || []).map((x) => ({ ...x, invoiceType: documentTypeOf(x) }));
    let charges = [], createdInvoice = { };
    const lastJB = await findLastInvoice('Job Bill');
    const lastJI = await findLastInvoice('Job Invoice');
    const lastAI = await findLastInvoice('Agent Invoice');
    const lastAB = await findLastInvoice('Agent Bill');

    for(let x of result){
      if(x.invoiceType=="Job Bill"){
        if(Object.keys(createdInvoice).length==0){
          createdInvoice = await createInvoices(lastJB, "JB", "Job Bill", req.body.companyId, req.body.type, x, fiscalYear, numbering)
        }
        charges.push({...x, status:"1", invoice_id:createdInvoice.invoice_No })
      }
      if(x.invoiceType=="Job Invoice"){
        if(Object.keys(createdInvoice).length==0){
          createdInvoice = await createInvoices(lastJI, "JI", "Job Invoice", req.body.companyId,req.body.type, x, fiscalYear, numbering)
        }
        charges.push({...x, status:"1", invoice_id:createdInvoice.invoice_No })
      }
      if(x.invoiceType=="Agent Invoice"){
        if(Object.keys(createdInvoice).length==0){
          createdInvoice = await createInvoices(lastAI, "AI", "Agent Invoice", req.body.companyId,req.body.type, x, fiscalYear, numbering)
        }
        charges.push({...x, status:"1", invoice_id:createdInvoice.invoice_No })
      }
      if(x.invoiceType=="Agent Bill"){
        if(Object.keys(createdInvoice).length==0){
          createdInvoice = await createInvoices(lastAB, "AB", "Agent Bill", req.body.companyId , req.body.type , x, fiscalYear, numbering)
        }
        charges.push({...x, status:"1", invoice_id:createdInvoice.invoice_No })
      }
    };
    // Nothing was put on a document - say so, rather than create an empty one.
    if (!createdInvoice || !createdInvoice.invoice_No || !charges.length) {
      return res.status(400).json({
        status: 'error',
        result: 'None of the selected charges could be put on an invoice or bill. '
          + 'Check each has a party chosen, then try again.',
      });
    }
    const newInv = await Invoice.create({
      ...createdInvoice,
        createdAt: req.body.departureDate ? moment(req.body.departureDate).toDate() : moment(req.body.shipDate).toDate(),
        updatedAt: req.body.departureDate ? moment(req.body.departureDate).toDate() : moment(req.body.shipDate).toDate(),
    }, { silent: true });
    let chargesIds = []
    for(let x of charges){
      let chargeHeads = await Charge_Head.upsert({ ...x, InvoiceId:newInv.id, invoice_id: newInv.invoice_No });
      chargesIds.push(chargeHeads[0].dataValues.id)
    }
    createHistory(req.body.employeeId, 'Invoice', 'Create', newInv.invoice_No);
    await res.json({status: 'success', result: {chargesIds, newInv}});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.post("/openingInvoice", async(req, res) => {
  try{

    if (!req.body.date || !moment(req.body.date, moment.ISO_8601, true).isValid()) {
      return res.status(400).json({
        status: "error",
        message: "Invalid date received"
      });
    }
    const createdAt = moment(req.body.date).toDate();
    const company = await companyShort(req.body.companyId);
    const fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId);
    const invoiceYear = fiscalYear.suffix;
    // The last opening invoice / bill this year, by type and invoice_Id - see
    // functions/invoiceNumber. (Not createdAt: here that is the opening-balance
    // date, not when the row was made.)
    const numbering = await readNumbering();
    const openingType = req.body.type=="OI" ? 'Opening Invoice' : 'Opening Bill';
    const lastOpening = await lastInvoiceInYear(Invoice, {
      type: openingType, companyId: req.body.companyId, suffix: invoiceYear, settings: numbering,
    });
    const nextOpeningId = lastOpening != null ? parseInt(lastOpening.invoice_Id, 10) + 1 : 1;
    const invoice = {
      invoice_No: invoiceNumber(numbering, {
        type: openingType, fixedCode: req.body.type, company, seq: nextOpeningId, suffix: invoiceYear,
      }),
      invoice_Id: nextOpeningId,
      type: req.body.type=="OI"?"Opening Invoice":"Opening Bill",
      status: "1",
      operation: req.body.operation,
      currency: req.body.currency,
      ex_rate: req.body.exRate,
      party_Id: req.body.party_Id,
      party_Name: req.body.party_Name,
      paid: 0,
      recieved: 0,
      roundOff: 0,
      total: req.body.amount,
      approved: 0,
      companyId: req.body.companyId,
      createdAt: createdAt,
      SE_JobId: null,
      payType: req.body.payType,
      partyType: req.body.partyType,
      FiscalYearId: fiscalYear.id,
    }
    const invoices = await Invoice.create(invoice);

    // Counted on OI / OB - the vType this voucher is saved as. It used to count
    // SI / PI, so the OI sequence never advanced past what SI had reached and
    // two opening invoices in a row were given the same voucher number.
    const openingVType = invoices.dataValues.payType=="Recievable" ? "OI" : "OB";
    const nextNo = await nextVoucherNo(Vouchers, {
      vType: openingVType,
      CompanyId: invoices.dataValues.companyId,
      suffix: invoiceYear,
      settings: numbering,
    });

    vouchers = {
      type:invoices.dataValues.payType=="Recievable"?"Opening Reciept":"Opening Payment",
      vType:invoices.dataValues.payType=="Recievable"?"OI":"OB",
      CompanyId:invoices.dataValues.companyId,
      amount:"",
      currency:invoices.dataValues.currency,
      exRate:invoices.dataValues.ex_rate,
      chequeNo:"",
      payTo:"",
      // The installation's own cost centre (Configuration), not the literal
      // "KHI" that used to be typed here - which stamped Karachi on every
      // install's vouchers whether or not it was there. Defaults to KHI when
      // unset, so nothing moves for an install that never sets it.
      costCenter: await readCostCenter(),
      invoice_Voucher:"1",
      invoice_Id:invoices.dataValues.id,
      partyId: invoices.dataValues.party_Id,
      partyName: invoices.dataValues.party_Name,
      createdAt: invoices.dataValues.createdAt,
      updatedAt: invoices.dataValues.createdAt,
      voucher_No: nextNo,
      voucher_Id: voucherId(numbering, {
        vType: openingVType,
        company: await companyShort(invoices.dataValues.companyId),
        seq: nextNo,
        suffix: invoiceYear,
      }),
    }    

    const voucher = await Vouchers.create({
      ...vouchers, // Spread your `vouchers` object
      updatedAt: invoices.dataValues.createdAt, // Explicitly set updatedAt to createdAt
      FiscalYearId: fiscalYear.id,
    });
    let Voucher_Head = []
    let narration = `${req.body.type=="OI"?"Opening Invoice":"Opening Bill"} ${invoices.dataValues.invoice_No} From ${invoices.dataValues.party_Name}`

    let total = parseFloat(invoices.dataValues.total) + parseFloat(invoices.dataValues.roundOff)
    let defaultTotal = invoices.dataValues.currency!='PKR'?parseFloat(invoices.dataValues.total)*parseFloat(invoices.dataValues.ex_rate):parseFloat(invoices.dataValues.total)
    Voucher_Head.push({
      amount:total,
      defaultAmount: defaultTotal,
      type:invoices.dataValues.payType=="Recievable"?"debit":"credit",
      narration:narration,
      VoucherId:voucher.dataValues.id,
      accountType: "partyAccount",
      ChildAccountId:invoices.dataValues.party_Id,
      createdAt: invoices.dataValues.createdAt
    })
    Voucher_Head.push({
      amount:total,
      defaultAmount: defaultTotal,
      type:invoices.dataValues.payType!="Recievable"?"debit":"credit",
      narration:narration,
      VoucherId:voucher.dataValues.id,
      accountType: "payAccount",
      ChildAccountId:req.body.creditAccount,
      createdAt: invoices.dataValues.createdAt
    })

    await Promise.all(
      Voucher_Head.map(x => Voucher_Heads.create(x))
    );

    await Invoice.update(
        {
            approved: "1"
        },
        {
            where: {
                id: invoices.dataValues.id
            }
        }
    );
    
    createHistory(req.body.employeeId, 'Invoice', 'Approve', req.body.invoice_No);
    res.json({status:'success', result:{invoices}});
  }catch(e){
    console.error(e)
  }
})

routes.get("/getOpeningInvoices", async(req, res) => {
  try{
    let type = req.headers.type=='OI'?"Opening Invoice":"Opening Bill"
    const result = await Invoice.findAll({
      where: {
        type: type,
        companyId: req.headers.companyid,
      }
    })
    res.json({status: 'success', result: result});
  }catch(e){
    console.error(e)
    res.json({status: 'Error', result: e.message || e });
  }
})
routes.get("/getOpeningInvoice", async(req, res) => {
  try{
    let result = await Invoice.findOne({
      where: {
        id: req.headers.id
      }
    })
    let voucher = await Vouchers.findOne({
      where:{
        invoice_Id:req.headers.id
      },
      include:[{model:Voucher_Heads}]
    })
    if(result == null){
      voucher = await Vouchers.findOne({
        where:{id: req.headers.id},
        include:[{model:Voucher_Heads}]
      })
      if(voucher != null){
        result = await Invoice.findOne({
          where:{id:voucher.dataValues.invoice_Id}
        })
      }
    }
    res.json({status: 'success', result: {result, voucher}});
  }catch(e){
    console.error(e)
    res.json({status: 'Error', result: e.message || e });
  }
})

/* AN OPENING INVOICE OR BILL, with its voucher. The id is in body.headers -
 * how the screens have always sent it.
 *
 * Its voucher is found and removed FIRST, and all of it in one transaction:
 * the invoice was destroyed before its voucher was looked for, so one with no
 * voucher - a migrated opening invoice - threw on voucher.dataValues with the
 * invoice already gone, and the request was never answered, so the screen
 * hung with nothing said (found 2026-11-16). */
routes.post("/deleteOpeningInvoices", async(req, res) => {
  const id = req.body?.headers?.id ?? req.body?.id;
  if (!id) return res.status(400).json({ status: 'error', result: 'No invoice given.' });
  try{
    await sequelize.transaction(async (t) => {
      // invoice_Id is TEXT. Looked for with the number the screens send, the
      // database refused (character varying = integer) - so every delete took
      // the invoice and left its voucher in the ledger, and never answered.
      const voucher = await Vouchers.findOne({ where: { invoice_Id: String(id) }, transaction: t })
      if (voucher) {
        await Voucher_Heads.destroy({ where: { VoucherId: voucher.id }, transaction: t })
        await Vouchers.destroy({ where: { id: voucher.id }, transaction: t })
      }
      await Invoice.destroy({ where: { id }, transaction: t })
    })
    createHistory(req.body.employeeId, 'Invoice', 'Delete', req.body?.headers?.invoice_No || String(id));
    res.json({status: 'success', result: id});
  }catch(e){
    console.error(e)
    res.status(500).json({ status: 'error', result: e.message || 'Could not delete it.' });
  }
})

routes.get("/getInvoices", async(req, res) =>{
  try {
    const result = await Invoice.findAll({
      where: {SEJobId: req.headers.id},
      attributes: ['invoice_No', 'payType', 'total', 'recieved', 'ex_rate','approved'],
      include:[{
        model:Charge_Head,
        attributes:['charge'],
        where:{charge:{ [Op.ne]: null }}
      }]
    })
    res.json({status: 'success', result: result});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.post("/unApprove", async(req, res)=>{
  try{
    /* NOT ONE THAT HAS BEEN SETTLED. Unapproving deletes the invoice's voucher,
     * taking it out of the books - but the receipt or payment that settled it
     * stays in, against a document that no longer posts anything. The invoice
     * screen has always refused this by greying its toggle; it is enforced
     * here too because the customs charge sheet unapproves invoices in bulk,
     * and a rule about the ledger cannot live only in one button. */
    const target = await Invoice.findOne({
      where: { id: req.body.id },
      attributes: ['id', 'invoice_No', 'payType', 'paid', 'recieved', 'companyId', 'climaxId'],
    });
    if (!target) {
      return res.status(404).json({ status: 'error', result: 'Invoice not found.' });
    }
    const settledBy = parseFloat(target.payType === 'Recievable' ? target.recieved : target.paid) || 0;
    const settlements = await Invoice_Transactions.count({ where: { InvoiceId: target.id } });
    if (settledBy !== 0 || settlements > 0) {
      return res.status(409).json({
        status: 'error',
        result: `Invoice ${target.invoice_No} has payments or receipts against it and cannot be unapproved. `
          + 'Remove those first.',
      });
    }

    /* EVERY VOUCHER POSTING IT, and in one transaction with the flag.
     *
     * Found by invoice_Id alone, a MIGRATED invoice's voucher was never found:
     * Climax's carries no invoice_Id. It stayed in the ledger, and approving
     * the invoice again after the edit posted a second one beside it. See
     * functions/invoiceVoucher.
     *
     * An invoice can legitimately have no voucher: approval failed part way,
     * or it was unapproved once already. And the transaction means a voucher
     * that cannot be removed - a locked fiscal year - leaves the invoice
     * approved, rather than unapproved with its voucher still in the books. */
    const removed = await sequelize.transaction(async (t) => {
      await Invoice.update({ approved: 0 }, { where: { id: req.body.id }, transaction: t });
      await Charge_Head.update({ status: 0 }, { where: { InvoiceId: req.body.id }, transaction: t });
      const voucherIds = await invoiceVoucherIds(sequelize, target, { transaction: t });
      if (voucherIds.length) {
        await Voucher_Heads.destroy({ where: { VoucherId: voucherIds }, transaction: t });
        await Vouchers.destroy({ where: { id: voucherIds }, transaction: t });
      }
      return voucherIds.length;
    });
    // target, not inv: Invoice.update returns a row count, which has no
    // invoice_No - every unapprove was logged against "undefined".
    createHistory(req.body.employeeId, 'Invoice', 'Unapprove', target.invoice_No);
    // Returned for the same reason /approve returns it: the caller is holding
    // a copy whose `approved` flag has just changed, and re-approving later
    // will change `total` too. Sending the row back keeps the screen and the
    // database saying the same thing without a second request. The GST number
    // too: unapproving keeps it, and the screen must go on printing it.
    const invoice = await Invoice.findOne({ where: { id: req.body.id }, include: [GST_NUMBER] });
    res.json({status: 'success', voucherRemoved: removed > 0, invoice});
  }catch(e){
    console.error(e)
    // Was falling out of the catch without replying at all, so the caller sat
    // waiting on a request that had already failed.
    res.status(500).json({status:'error', result: e.message || e});
  }
})

/**
 * Approve an invoice: set it approved, approve its charges, and raise the
 * voucher and voucher heads that put it in the ledger.
 *
 * Extracted from the route handler so it can be called directly. Aviation
 * invoices are raised already-approved (routes/aviationJobs /makeInvoice), and
 * duplicating two hundred lines of ledger posting to do that would guarantee
 * the two drift apart. The route below is now a thin wrapper.
 *
 * Throws on failure; the caller decides what that means.
 */
const approveInvoice = async ({ id, fiscalYearId, employeeId }) => {
  const req = { body: { id, fiscalYearId, employeeId } };

  // Settings the posting needs, read BEFORE the transaction opens. These three
  // helpers cannot join a transaction, and calling them inside one means every
  // approval holds a pooled connection while it waits for a second: with the
  // default pool of five, five approvals at once would wait on each other
  // forever. Read up front, the transaction below runs on one connection.
  const pre = await Invoice.findOne({ where: { id: req.body.id }, attributes: ['companyId'] });
  if (!pre) throw new Error('Invoice not found.');
  const installCostCenter = await readCostCenter();
  const autoRoundOff = await readAutoRoundOff();
  const numbering = await readNumbering();
  const companyCode = await companyShort(pre.dataValues.companyId);

  /* ONE transaction for the whole posting: the approved flag, the charges, the
     voucher and every one of its heads land together or not at all.

     Before this, each write committed on its own. The approved flag was set
     BEFORE the ledger accounts were looked up, so a missing account left an
     approved invoice with no voucher behind it - the opposite of what the
     aviation and customs callers promise ("kept unapproved"). And the heads
     were written without being awaited, so a failure among them surfaced as an
     unhandled rejection after the caller had already been told it succeeded. */
  const invoiceNo = await sequelize.transaction(async (t) => {
    // Row-locked, so two approvals of the same invoice cannot both get past
    // the checks below: the second waits here until the first commits, then
    // sees it approved. Checked before the fiscal year, so an invoice that is
    // already approved says so rather than reporting a year problem.
    const Inv = await Invoice.findOne({where:{id:req.body.id}, transaction: t, lock: t.LOCK.UPDATE})
    if (!Inv) throw new Error('Invoice not found.');

    // Approving twice posted the invoice to the ledger twice. Both checks are
    // needed: migrated invoices are approved but their legacy vouchers carry
    // no invoice_Id, so the voucher check alone would let one be posted again;
    // and a voucher left behind by a half-finished unapprove means the ledger
    // already holds it whatever the flag says.
    if (String(Inv.dataValues.approved) === '1') {
      throw new Error(`Invoice ${Inv.dataValues.invoice_No} is already approved.`);
    }
    const alreadyPosted = await Vouchers.findOne({
      where: { invoice_Id: String(req.body.id) },
      attributes: ['voucher_Id'],
      transaction: t,
    });
    if (alreadyPosted) {
      throw new Error(
        `Invoice ${Inv.dataValues.invoice_No} is already in the ledger as ${alreadyPosted.voucher_Id}. Unapprove it before approving again.`
      );
    }
    // A MIGRATED invoice unapproved before unapprove could find its Climax
    // voucher still has that voucher in the ledger, posting the invoice as it
    // was before the edit. This approval replaces it rather than posting a
    // second one beside it - see functions/invoiceVoucher. Read by the payType
    // held now, before the charges below recompute it: it is the one the
    // Climax voucher was posted as.
    const stale = await legacyVoucherIds(sequelize, Inv.dataValues, { transaction: t });
    if (stale.length) {
      await Voucher_Heads.destroy({ where: { VoucherId: stale }, transaction: t });
      await Vouchers.destroy({ where: { id: stale }, transaction: t });
    }
    const fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId, t);
    const chargesHeads = await Charge_Head.findAll({
      where:{InvoiceId:req.body.id}, transaction: t
    })
    // Every charge taken off it on the sheet while it was unapproved: there is
    // nothing to post, and going on would put a zero voucher in the ledger.
    if (!chargesHeads.length) {
      throw new Error(
        `Invoice ${Inv.dataValues.invoice_No} has no charges on it, so there is nothing to post. Add a charge to it, or leave it unapproved.`
      );
    }
    // The GST invoice number, when the invoice carries taxed receivable lines
    // - the ones the Sale Tax Invoice prints. Inside this transaction, so an
    // approval that fails further down does not use a number up.
    await assignTaxInvoiceNo({
      db: require("../../models"),
      invoice: Inv.dataValues,
      charges: chargesHeads.map((c) => c.dataValues),
      companyCode,
      transaction: t,
    });
    let total = 0.0;
    let defaultTotal = 0.0
    let payble = false
    let receivable = false
    let vendor = false
    let payAmount = 0.0
    let recAmount = 0.0
    let defaultPayAmount = 0.0
    let defaultRecAmount = 0.0
    chargesHeads.forEach((x)=>{
      if(x.type!="Recievable"){
        payble = true
        payAmount += parseFloat(x.net_amount)
        defaultPayAmount += parseFloat(x.local_amount)
      }else{
        receivable = true
        recAmount += parseFloat(x.net_amount)
        defaultRecAmount += parseFloat(x.local_amount)
      }
      if(x.partyType=='vendor' || x.partyType=='agent'){
        vendor = true
      }
    })
    
    let invPayType = Inv.dataValues.payType
    if(payble && receivable){
      if(payAmount>recAmount){
        Inv.dataValues.currency!="PKR"?
        total = payAmount - recAmount:
        total = defaultPayAmount - defaultRecAmount
        defaultTotal = defaultPayAmount - defaultRecAmount
        invPayType = "Payble"
      }else{
        Inv.dataValues.currency!="PKR"?
        total = recAmount - payAmount:
        total = defaultRecAmount - defaultPayAmount
        defaultTotal = defaultRecAmount - defaultPayAmount
        invPayType = "Recievable"
      }
    }else{
      for(let x of chargesHeads){
        Inv.dataValues.currency=="PKR"?total += parseFloat(x.dataValues.local_amount):total += parseFloat(x.dataValues.net_amount)
        defaultTotal += parseFloat(x.dataValues.local_amount)
      }
    }
    const invoice = await Invoice.findOne({where:{id:req.body.id}, transaction: t})

    /* THE PARTY, FROM THE LINES. Changing the party on every charge and
     * approving again left the header - and so the voucher's party line,
     * which posts to party_Id - on the OLD party. When the lines agree on one
     * party that is not the header's, the header follows them: its ledger
     * account into party_Id, its name into party_Name. Lines that disagree,
     * or name nobody, leave the header as it is - see functions/invoiceParty. */
    const partyPatch = {};
    const lineParty = linePartyOf(chargesHeads);
    if (lineParty && lineParty.clientId) {
      const [client, links] = await Promise.all([
        Clients.findOne({ where: { id: lineParty.clientId }, attributes: ['id', 'name'], transaction: t }),
        Client_Associations.findAll({ where: { ClientId: lineParty.clientId }, attributes: ['ChildAccountId'], transaction: t }),
      ]);
      const accounts = [...new Set(links.map((l) => l.ChildAccountId).filter((v) => v !== null && v !== undefined))];
      if (client && accounts.length === 1) {
        // The lines' party has one account: post to it. Only when it differs -
        // a name formatted differently on the header is not a different party.
        if (String(accounts[0]) !== String(invoice.dataValues.party_Id)) {
          partyPatch.party_Id = String(accounts[0]);
          partyPatch.party_Name = client.name;
        }
      } else {
        /* No single account to move to. Refuse only when the header plainly
         * belongs to SOMEONE ELSE - its account is another party's - because
         * then approving would post this party's charges to them. Otherwise
         * there is nothing to say the party changed, and the invoice approves
         * as it always did. */
        const owner = /^\d+$/.test(String(invoice.dataValues.party_Id || ''))
          ? await Client_Associations.findOne({
            where: { ChildAccountId: invoice.dataValues.party_Id }, attributes: ['ClientId'], transaction: t,
          })
          : null;
        if (owner && String(owner.ClientId) !== String(lineParty.clientId)) {
          const who = client ? client.name : `party ${lineParty.clientId}`;
          throw new Error(
            `The charges on invoice ${invoice.dataValues.invoice_No} are now for ${who}, `
            + `which has ${accounts.length ? 'more than one ledger account' : 'no ledger account'} - `
            + 'so it cannot be posted to them. Give the party exactly one account in Setup > Parties and approve again.'
          );
        }
      }
    }

    // The round off, from the total being approved - see functions/invoiceRoundOff.
    const roundOff = approvalRoundOff(invoice.dataValues, total, autoRoundOff);
    // The rate, from the lines too - see functions/invoiceExRate. Before the
    // voucher below is built, which posts an agent invoice at this rate.
    const ratePatch = exRatePatch({
      invoice: invoice.dataValues, charges: chargesHeads.map((c) => c.dataValues), total, defaultTotal,
    });
    const inv = await invoice.update({total:total, approved:1, payType: invPayType, roundOff, ...partyPatch, ...ratePatch}, {transaction: t})
    await Charge_Head.update({approved:1, status:1}, {where:{InvoiceId:req.body.id}, transaction: t})
    const job = await SE_Job.findOne({where:{id:invoice.dataValues.SEJobId}, transaction: t})

    // An AVIATION invoice has no SE_Job - its charges hang off an AWB - so
    // `job` is null here and dereferencing it threw
    // "Cannot read properties of null (reading 'dataValues')".
    //
    // subType undefined falls through both ternaries to the AIR FREIGHT
    // accounts, which is right for an airline. jobNo comes from the flight
    // instead, so the ledger narration still names the job it belongs to.
    const subType = job?.dataValues?.subType;
    let jobNo = job?.dataValues?.jobNo;
    if (!job) {
      const consignmentId = chargesHeads[0]?.dataValues?.AviationConsignmentId;
      if (consignmentId) {
        const line = await Aviation_Consignment.findOne({
          where: { id: consignmentId },
          include: [{ model: Aviation_Job, attributes: ['jobNo'] }],
          transaction: t,
        });
        jobNo = line?.Aviation_Job?.jobNo || line?.awb;
      }
      jobNo = jobNo || invoice.dataValues.invoice_No;
    }

    // Which pair of ledger accounts this invoice posts to. The list moved to
    // functions/ledgerBuckets so Direct Job E/R posts to the same accounts -
    // it had its own copy with only the two freight buckets in it.

    // Is this a customs invoice, and which way does the declaration go?
    //
    // Read from the charge lines rather than the invoice: a customs charge
    // names its job directly (Charge_Heads.CustomsJobId) and Invoice carries no
    // customs foreign key at all - the same indirection
    // functions/customsInvoiceContext.js documents. Costs one query, and only
    // on an invoice that has no freight job.
    let customsDirection = null;
    // The declaration's own cost centre, where it records one. Null on a
    // freight invoice, which falls back to the installation's.
    let customsCostCenter = null;
    // Only the expense account looks at this - see expenseBucketFor.
    let customsCargoType = null;
    let customsTransportMode = null;
    // The declaration itself, for the voucher narration - see
    // functions/customsVoucherNarration.
    let customsJob = null;
    if (!job) {
      const customsJobId = chargesHeads.find((c) => c?.dataValues?.CustomsJobId)
        ?.dataValues?.CustomsJobId;
      if (customsJobId) {
        const cJob = await Customs_Job.findOne({
          where: { id: customsJobId },
          attributes: [
            'id', 'jobNo', 'direction', 'transportMode', 'costCenter', 'cargoType',
            'clientId', 'shipperId', 'invoiceNo', 'clientRef', 'formENo', 'gdNumber', 'customFileNo',
          ],
          // The narration names the shipper, the client where there is none.
          include: [
            { model: Clients, as: 'client', attributes: ['name'], required: false },
            { model: Clients, as: 'shipper', attributes: ['name'], required: false },
          ],
          transaction: t,
        });
        if (cJob) {
          customsJob = cJob.get({ plain: true });
          customsCostCenter = cJob.dataValues.costCenter || null;
          // Default Import, matching the model's own default: a file with no
          // direction recorded is far more likely an import than an export,
          // and the alternative is refusing to post it at all.
          customsDirection = cJob.dataValues.direction === 'Export' ? 'Export' : 'Import';
          // Decides the EXPENSE account only - see expenseBucketFor. Blank on
          // about a quarter of migrated jobs, which keeps the old account.
          customsCargoType = cJob.dataValues.cargoType || null;
          // Sea / Air / By Road picks the clearance accounts, with the direction.
          customsTransportMode = cJob.dataValues.transportMode || null;
          jobNo = cJob.dataValues.jobNo || jobNo;
        }
      }
    }

    // An aviation invoice - no freight job, lines on consignments - posts to
    // its own AVIATION accounts, or AIR's while those are unset.
    const aviation = !job && chargesHeads.some((c) => c?.dataValues?.AviationConsignmentId);
    /* Which accounts: a customs job by transport and direction (Sea / Air
     * Import, Export, By Road), a flight by AVIATION, freight by sub type -
     * each falling back, while its own row in Config > Ledger Accounts is
     * empty, to where it posted before - see ledgerBuckets.fallbacksFor. */
    const { bucket, expenseBucket: expBucket, fallbacks } = ledgerBucketsFor({
      subType, customsDirection, customsTransportMode, customsCargoType, aviation,
    });

    /* Config > Ledger Accounts wins over the seeded titles. Different installs
       name their chart of accounts differently, so a title is a guess and the
       configured id is a decision someone made; the titles stay as the
       fallback for an install that has never opened that screen. An invoice
       needs each account's PARENT, which is the only thing this caller asks
       for that Direct Job E/R does not. */
    const mapping = await readLedgerAccounts(AppSetting, t);
    const resolve = makeAccountResolver({
      Child_Account,
      mapping,
      bucket,
      expenseBucket: expBucket,
      fallbacks,
      findOptions: { include: [{ model: Child_Account, as: 'parent' }] },
      transaction: t,
    });
    /* The SALES TAX account - one pair for every job type, the TAX row of
       Config > Ledger Accounts. No seeded title and no fallback: unset, it is
       null and the tax stays in income / expense, as it always did. The side
       follows the invoice: tax on a sale to the income one, on a bill to the
       expense one. */
    const resolveTax = makeAccountResolver({
      Child_Account,
      mapping,
      bucket: 'TAX',
      findOptions: { include: [{ model: Child_Account, as: 'parent' }] },
      transaction: t,
    });
    const [incomeAccount, expenseAccount, disbursementAccount, taxAccount] = await Promise.all([
      resolve('income'),
      resolve('expense'),
      /* Only the customs buckets define one, and a freight approval must not
         go looking - the reimbursable split below is a query per invoice for a
         result that is always zero there. Asked of the JOB (a customs one)
         rather than of the resolver, because the settings screen offers a
         disbursement account for customs only and a stray id against a
         freight bucket would otherwise switch the split on. */
      customsDirection ? resolve('disbursement') : Promise.resolve(null),
      resolveTax(invPayType == 'Recievable' ? 'income' : 'expense'),
    ]);
    // How much of the total is tax - see functions/invoiceTaxSplit.
    const taxSplit = taxAccount
      ? invoiceTax({
          charges: chargesHeads.map((c) => c.dataValues),
          payType: invPayType,
          inPkr: Inv.dataValues.currency == 'PKR',
        })
      : { amount: 0, defaultAmount: 0 };

    /**
     * How much of this invoice is pass-through rather than the agency's own
     * income or cost.
     *
     * Charge_Head has NO foreign key to Charges - it stores the charge NAME as
     * a string - so the flag has to be matched by name. That is the only link
     * that exists today. It is exact and case-insensitive; a renamed charge
     * stops being recognised, which fails toward "treat it as revenue" rather
     * than toward silently moving money off the P&L.
     *
     * Only computed for customs invoices: reimbursable charges are a clearing
     * concept, and running this on every freight approval would be a query per
     * invoice for a result that is always zero.
     */
    let reimbursableTotal = 0;
    let reimbursableDefaultTotal = 0;
    if (disbursementAccount) {
      const flagged = await Charges.findAll({
        where: { reimbursable: true },
        attributes: ['name'],
        raw: true,
        transaction: t,
      });
      const names = new Set(
        flagged.map((c) => String(c.name || '').trim().toLowerCase()).filter(Boolean)
      );
      if (names.size) {
        for (const c of chargesHeads) {
          const name = String(c?.dataValues?.charge || '').trim().toLowerCase();
          if (!name || !names.has(name)) continue;
          const net = parseFloat(c.dataValues.net_amount) || 0;
          const local = parseFloat(c.dataValues.local_amount) || 0;
          // Its tax, when that goes to the tax account, is not a disbursement -
          // counting it in both would take it off the income line twice.
          const taxIn = taxAccount ? lineTaxIn(c.dataValues) : 0;
          reimbursableTotal += net - taxIn;
          reimbursableDefaultTotal += local - (taxIn && net ? (taxIn * local) / net : 0);
        }
      }
    }

    // A missing account used to surface as "Cannot read properties of null
    // (reading 'dataValues')" from inside the voucher-head builder, which says
    // nothing about what is actually wrong. Only the side this invoice posts
    // to is required, so a chart missing the other one still works.
    const receivableInvoice = invoice.dataValues.payType == "Recievable";
    const required = receivableInvoice ? incomeAccount : expenseAccount;
    if (!required) {
      throw new Error(missingAccountMessage({
        document: 'invoice',
        side: receivableInvoice ? 'income' : 'expense',
        bucket: receivableInvoice ? bucket : expBucket,
      }));
    }
    let account
    account = await Client_Associations.findOne({where:{ClientId:invoice.dataValues.party_Id}, transaction: t})

    /* THE INVOICE'S DATE, not the approval's. The ledger places every line by
     * createdAt, and this voucher used to take the moment of approval - so an
     * invoice raised on 31 August and approved on 2 September showed in
     * September. Customs raises every invoice unapproved for the director, so
     * that gap is the normal case there. The CFO's ruling (2026-10-02): an SI
     * or PI always stands on its invoice's date. Invoice has no date column of
     * its own; createdAt is it - a freight invoice is dated by the sailing. */
    const postedAt = invoice.dataValues.createdAt || new Date();

    const vouchers = {
      type:invoice.dataValues.payType=="Recievable"?"Job Recievable":"Job Payble",
      vType:invoice.dataValues.payType=="Recievable"?"SI":"PI",
      CompanyId:invoice.dataValues.companyId,
      amount:"",
      currency:invoice.dataValues.type=="Job Bill"?"PKR":invoice.dataValues.type=="Job Invoice"?"PKR":invoice.dataValues.currency,
      exRate:invoice.dataValues.type=="Job Bill"?"1":invoice.dataValues.type=="Job Invoice"?"1":invoice.dataValues.ex_rate,
      chequeNo:"",
      payTo:"",
      // A CUSTOMS invoice carries the cost centre of the declaration it was
      // raised from where the job records one; otherwise the installation's.
      // See models/Customs_Job.js costCenter.
      costCenter: customsCostCenter || installCostCenter,
      invoice_Voucher:"1",
      invoice_Id:invoice.dataValues.id,
      partyId: invoice.dataValues.party_Id,
      partyName: invoice.dataValues.party_Name,
      tranDate: new Date(postedAt).toISOString(),
      createdAt: postedAt,
    }

    const nextNo = await nextVoucherNo(Vouchers, {
      vType: vouchers.vType,
      CompanyId: invoice.dataValues.companyId,
      suffix: fiscalYear.suffix,
      transaction: t,
    });

    const voucher = await Vouchers.create({
      ...vouchers,
      voucher_No: nextNo,
      // The line breaks here used to sit OUTSIDE the ${} expressions rather
      // than inside them, so this produced a voucher_Id carrying literal
      // newlines and indentation instead of "SNS-CRV-1/25".
      voucher_Id: voucherId(numbering, {
        vType: vouchers.vType,
        company: companyCode,
        seq: nextNo,
        suffix: fiscalYear.suffix,
      }),
      FiscalYearId: fiscalYear.id,
    }, { transaction: t })

    let Voucher_Head = []
    // A customs invoice names the shipper, the client's invoice, Form-E, job,
    // invoice and GD - see functions/customsVoucherNarration. Freight and
    // aviation keep the line they have always had.
    let narration = customsJob
      ? customsVoucherNarration({
          payType: invoice.dataValues.payType,
          invoiceNo: invoice.dataValues.invoice_No,
          partyName: invoice.dataValues.party_Name,
          partyId: chargesHeads.map((c) => c?.dataValues?.partyId).find((id) => id != null),
          job: customsJob,
        })
      : `${invoice.dataValues.payType} Against Invoice ${invoice.dataValues.invoice_No} For Job# ${jobNo} From ${invoice.dataValues.party_Name}`

    /**
     * The contra side of the voucher - everything that is not the party line.
     *
     * Normally one head against income or expense. Two things can come off it
     * onto accounts of their own (functions/invoiceTaxSplit splitContra):
     *   - the SALES TAX on taxed lines, to the tax account, once one is set;
     *   - the reimbursable share of pass-through charges, to disbursements, so
     *     duty and taxes recharged at cost never reach the P&L.
     *
     * Returns an ARRAY so the caller pushes whatever came back. With neither
     * set it is one head, identical to what it produced before.
     */
    const contraHeads = (amount, defaultAmount, type, accountId) => {
      const accountFor = {
        main: accountId,
        tax: taxAccount?.dataValues?.id,
        disbursement: disbursementAccount?.dataValues?.id,
      };
      const narrationFor = {
        main: narration,
        tax: `${narration} (sales tax)`,
        disbursement: `${narration} (reimbursable disbursements)`,
      };
      return splitContra({
        amount,
        defaultAmount,
        tax: taxAccount ? taxSplit : {},
        reimbursable: disbursementAccount
          ? { amount: reimbursableTotal, defaultAmount: reimbursableDefaultTotal }
          : {},
      }).map((part) => ({
        amount: part.amount,
        defaultAmount: part.defaultAmount,
        type,
        narration: narrationFor[part.to],
        VoucherId: voucher.dataValues.id,
        ChildAccountId: accountFor[part.to],
      }));
    };

  /* The party line, the contra and - rounded down - the rounding line, each in
   * both amounts: see functions/invoiceRoundOff roundOffHeads. The five
   * branches this replaces set the rounded figure in `amount` only, which the
   * ledger does not read. */
  const sale = invoice.dataValues.payType=="Recievable";
  const shaped = roundOffHeads({ total, defaultTotal, roundOff: invoice.dataValues.roundOff });
  Voucher_Head.push({
    ...shaped.party,
    type: sale ? "debit" : "credit",
    narration:narration,
    VoucherId:voucher.dataValues.id,
    ChildAccountId:invoice.dataValues.party_Id,
  })
  Voucher_Head.push(...contraHeads(
    shaped.contra.amount,
    shaped.contra.defaultAmount,
    sale ? "credit" : "debit",
    sale ? incomeAccount.dataValues.id : expenseAccount.dataValues.id,
  ))
  if (shaped.rounding) {
    // Never split - it is not a charge. On the party's side, to the other
    // account: a sale's rounding down is an expense, a bill's is income.
    // Either can be missing from a chart that only needs the one side.
    const roundingAccount = sale ? expenseAccount : incomeAccount;
    if (!roundingAccount) {
      throw new Error(missingAccountMessage({
        document: 'invoice',
        side: sale ? 'expense' : 'income',
        bucket: sale ? expBucket : bucket,
      }));
    }
    Voucher_Head.push({
      ...shaped.rounding,
      type: sale ? "debit" : "credit",
      narration:narration,
      VoucherId:voucher.dataValues.id,
      ChildAccountId:roundingAccount.dataValues.id,
    })
  }

  // One at a time and awaited, inside the transaction. This was
  // `await Voucher_Head.map(async ...)`, which awaits an ARRAY of promises -
  // that returns at once, so the caller was told the invoice was posted while
  // its heads were still being written, and a failed head never reached it.
  for (const x of Voucher_Head) {
    await Voucher_Heads.create({ ...x, createdAt: postedAt }, { transaction: t })
  }
    return invoice.dataValues.invoice_No;
  });

  // After the commit, so the history never records an approval that rolled back.
  createHistory(req.body.employeeId, 'Invoice', 'Approve', invoiceNo);
  return req.body.id;
};

routes.post("/approve", async(req, res) => {
  try{
    const result = await approveInvoice({
      id: req.body.id,
      fiscalYearId: req.body.fiscalYearId,
      employeeId: req.body.employeeId,
    });
    // The APPROVED ROW, not just its id. Approving RECOMPUTES total and
    // payType from the charges - which is the whole point of being able to
    // unapprove, correct a rate and approve again - so a caller that keeps
    // showing the copy it already had is showing the figure from before the
    // correction. It is returned here rather than re-fetched by the caller so
    // there is no window in which the two disagree.
    //
    // WITH ITS GST NUMBER. Approval is what issues it, and the screen spreads
    // this row over the copy it had - which, before a first approval, has no
    // number. Without it here both prints showed GST Invoice # blank until the
    // invoice was opened again.
    const invoice = await Invoice.findOne({ where: { id: req.body.id }, include: [GST_NUMBER] });
    res.json({status: 'success', result, invoice});
  }catch(error){
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
})

/* The Charges tab's Approve button: flips one charge line on or off.
 *
 * AUDITED AS WHAT IT IS - form "Charges", the way the line actually went
 * (Approve or Unapprove), under its JOB's number. It was logged as an
 * "Invoice" "Approve/Unapprove" - neither an invoice nor a direction - with
 * req.body.invoice_No as the document, which the screen never sends, so every
 * entry had a blank Doc #. */
routes.post("/approveHeads", async(req, res) => {
  try{
    const result = await Charge_Head.findOne({where:{id:req.body.id}})
    const status = result.dataValues.status=="1"?"0":"1"
    await Charge_Head.update({status}, {where:{id:result.dataValues.id}})
    const job = result.SEJobId
      ? await SE_Job.findOne({ where: { id: result.SEJobId }, attributes: ['jobNo'] })
      : result.CustomsJobId
        ? await Customs_Job.findOne({ where: { id: result.CustomsJobId }, attributes: ['jobNo'] })
        : null;
    createHistory(req.body.employeeId, 'Charges', status=="1" ? 'Approve' : 'Unapprove', job?.jobNo || null);
    res.json({status: 'success', result: result});
  }catch(error){
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
})

routes.get('/getTaskInvoices', async(req, res) => {
  try {
    const result = await Invoice.findAll({ where: {status: "2" , approved: "1"}})
    res.json({status: 'success', result: result});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});


routes.get('/getCPUS', async(req, res) => {
  try {
    res.json({status: 'success', result: numCPUs});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
});


routes.get('/testGetLastInvoice', async(req, res) => {
  try {
    const lastJI = await Invoice.findOne({
      where:{type:'Job Invoice', invoice_Id:{[Op.ne]:null}},
      order: [['invoice_Id', 'DESC']],
      attributes:["invoice_Id"]
    });
    res.json({status: 'success', result: lastJI});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

/* WHICH INVOICES ARE A PARTY'S, for a report filtered to one party.
 *
 * invoice.party_Id is a LEDGER ACCOUNT id - one per company the party trades
 * with (Client_Associations) - or, on an invoice migrated while its party had
 * no single account, the party's Clients id (functions/invoiceMigrationPlan).
 * Matched on the Clients id only together with the party's name: an account id
 * and an unrelated party's Clients id can be the same number.
 *
 * Both balancing reports used findOne - the FIRST account only, losing the
 * others - and a party with no account was not filtered at all, so the report
 * showed every party's invoices as if they were the one picked.
 */
const partyInvoiceWhere = async (clientId) => {
  const [links, client] = await Promise.all([
    Client_Associations.findAll({ where: { ClientId: clientId }, attributes: ['ChildAccountId'] }),
    Clients.findOne({ where: { id: clientId }, attributes: ['id', 'name'] }),
  ]);
  const accounts = [...new Set(links.map((l) => l.ChildAccountId).filter(Boolean).map(String))];
  const either = [{ party_Id: String(clientId), party_Name: client?.name ?? null }];
  if (accounts.length) either.unshift({ party_Id: { [Op.in]: accounts } });
  return { [Op.or]: either };
};

routes.get("/jobBalancing", async (req, res) => {
  try {
    // The overseas agent wins when both are picked, as it always has.
    const pickedParty = [req.headers.overseasagent, req.headers.party]
      .find((p) => p && p !== 'undefined' && p !== 'null');
    const partyWhere = pickedParty ? await partyInvoiceWhere(pickedParty) : null;
    let invoiceObj = {
      createdAt: {
        [Op.gte]: moment(req.headers.from).toDate(),
        [Op.lte]: moment(req.headers.to).add(1, 'days').toDate(),
      },
      [Op.and]: [
        { type: { [Op.ne]: "Agent Invoice" } },
        { type: { [Op.ne]: "Old Agent Invoice" } },
        { type: { [Op.ne]: "Agent Bill" } },
        { type: { [Op.ne]: "Old Agent Bill" } },
      ]
    };
    if(req.headers.paytype!="All"){
      invoiceObj.payType=req.headers.paytype
    }
    if (partyWhere) invoiceObj[Op.and].push(partyWhere);
    // 'all' = every company on this installation, i.e. no filter. The report
    // filters used to hardcode Seanet's own companies, with '4' meaning "1 and
    // 3"; that legacy value still works so an existing saved filter does not
    // change behaviour, but the pickers now list the install's real companies
    // and offer 'all' instead.
    //
    // A user who works in some companies has their 'all' read as those -
    // functions/companyAccess widenAll / reportCompanies.
    const companies = reportCompanies(req.headers.company, req.allowedCompanies);
    if (companies) invoiceObj.companyId = { [Op.in]: companies };
    req.headers.currency?invoiceObj.currency=req.headers.currency:null;
    req.headers.jobtypes?.length>0?invoiceObj.operation=req.headers.jobtypes.split(","):null;
    let includeObj = [
      {
        /* ONLY WHAT THE REPORT READS - the first line's PP/CC (its F/Type
           column) - and in a query of its own. It was every column of every
           charge line, joined in with each job's containers: on SNS's copy a
           report from 2025 took ~170 s and sent 44 MB, and a From before 2026
           showed nothing at all (the user, 2026-11-20). Ordered by id, so
           "the first line" is the same line every run. The two job ids are
           how attachCustomsContext and attachAviationContext find a customs
           or aviation invoice's job. */
        model: Charge_Head,
        attributes: ['id', 'pp_cc', 'InvoiceId', 'CustomsJobId', 'AviationConsignmentId'],
        separate: true,
        order: [['id', 'ASC']],
      },
      {
      model:SE_Job,
      // operation: sea or air - what the printed J/Tp reads ("Air" rather
      // than the LCL every air job's subType carries), and what the Job No
      // link opens; without it every row opened as an air import.
      attributes: [ 'id', 'jobNo', 'operation', 'subType', 'fd', 'freightType', 'vol', 'weight', 'arrivalDate', 'shipDate'],
      include:[
        { model:Voyage, attributes:['voyage', 'importArrivalDate', 'exportSailDate'] },
        // The printed DO Date column.
        { model:Delivery_Order, attributes:['date'], required:false },
        { model:Clients, attributes:['code','name'] },
        { model:Bl, attributes:['hbl','mbl'] },
        { model:SE_Equipments, attributes:['qty', 'size'] },
        { model: Clients, as:'shipper', attributes:['name'] },
        {
          model: Clients,
          as:'consignee', 
          attributes:['name']
        },
        {
          model: Employees,
          as:'sales_representator', 
          attributes:['name']
        },
        {
          model: Vessel,
          as:'vessel', 
          attributes:['name']
        },
        {
          model: Clients,
          as:'shipping_line', 
          attributes:['name']
        },
      ],
    }]

    invoiceObj.approved = '1'

    /* PENDING - the jobs in the period with no invoice against them, in place
       of the invoices (the user, 2026-11-20) - functions/jobBalancingPending.
       The same job fields and links as an invoice row's, so the columns fill
       in alike. No advances: they belong to no job. */
    if (req.headers.options === 'pending') {
      const seJob = includeObj.find((i) => i.model === SE_Job);
      const pending = await pendingJobRows({
        sequelize, SE_Job, seJobAttributes: seJob.attributes, seJobInclude: seJob.include,
      }, {
        from: req.headers.from,
        to: req.headers.to,
        payType: req.headers.paytype,
        companies,
        jobtypes: req.headers.jobtypes,
        party: req.headers.party,
        overseasAgent: req.headers.overseasagent,
      });
      return res.json({ status: "success", result: pending });
    }

    req.headers.overseasagent?includeObj.where = {overseasAgentId:req.headers.overseasagent}:null;
    const result = await Invoice.findAll({
      where:invoiceObj,
      // vendorTaxInvoiceNo: the Vendor Tax Inv # column (customs). It was not
      // selected, so the column was empty whatever the bill held.
      attributes:['id','invoice_No', 'payType', 'currency', 'ex_rate', 'roundOff', 'total', 'paid', 'recieved', 'createdAt', 'party_Name', 'companyId', 'vendorTaxInvoiceNo'],
      include:includeObj,
      // By date and time, then by id - invoices stamped with the same
      // instant (a freight job's sailing day, a migrated invoice's date) in
      // the order they were raised rather than whatever order Postgres holds.
      order: [[ 'createdAt', 'ASC' ], [ 'id', 'ASC' ]],
    });
    await attachAviationContext(result, aviationCtxModels());
    await attachCustomsContext(result, customsCtxModels());

    /* ADVANCE MONEY NOT KNOCKED OFF, as rows of the report, so its bottom
     * line is the ledger's - functions/jobBalancingAdvances (the user's
     * request, 2026-11-06). Not when the report is narrowed to some job types
     * (an advance belongs to no job), nor to an overseas agent's jobs - and
     * not when the filter's Show Advance Transactions switch is off (the
     * user, 2026-11-10). The filter sends 'show' or 'hide' once the switch is
     * moved; sent nothing (the switch left alone, or a tab opened before it),
     * the install's setting decides - Configuration > Reports. */
    const given = (v) => v !== undefined && v !== null && v !== '' && v !== 'undefined' && v !== 'null';
    const showAdvances = req.headers.advances === 'hide' ? false
      : req.headers.advances === 'show' ? true
        : await readJobBalancingAdvances();
    let advances = [];
    if (showAdvances && !given(req.headers.jobtypes) && !given(req.headers.overseasagent)) {
      const accounts = given(req.headers.party)
        ? (await Client_Associations.findAll({ where: { ClientId: req.headers.party }, attributes: ['ChildAccountId'] }))
          .map((l) => l.ChildAccountId).filter(Boolean)
        : undefined;
      advances = await unappliedAdvances(sequelize, {
        upTo: moment(req.headers.to).add(1, 'days').toDate(),
        companies,
        currency: req.headers.currency,
        payType: req.headers.paytype,
        accounts,
      });
    }
    await res.json({ status: "success", result: [...result, ...advances] });
  } catch (error) {
    console.error(error)
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/invoiceBalancing", async (req, res) => {
  try {
    let invoiceObj = {
      createdAt: {
        [Op.gte]: moment(req.headers.from).toDate(),
        [Op.lte]: moment(req.headers.to).add(1, 'days').toDate(),
      },
      [Op.and]: [
        /* AGENT documents only - Agent Invoice / Agent Bill, and the agents'
           openings. "Anything but a Job Invoice/Bill" also took every CLIENT
           and VENDOR opening invoice into the agent report. partyType 'agent'
           is how Ageing tells them apart too. */
        { [Op.or]: [
          { type: { [Op.in]: ["Agent Invoice", "Old Agent Invoice", "Agent Bill", "Old Agent Bill"] } },
          { partyType: 'agent' },
        ] },
      ]
    };
    if (req.headers.paytype !== "All") {
      invoiceObj.payType = req.headers.paytype;
    }
    /* In the picked currency. PKR is the local view of every currency,
       converted on the page; a foreign one is that currency's invoices alone -
       it used to add USD, EUR and PKR amounts into one column. All is every
       currency as invoiced, totalled per currency on the page. */
    const currency = String(req.headers.currency || '').trim().toUpperCase();
    if (currency && !['PKR', 'ALL', 'UNDEFINED'].includes(currency)) {
      invoiceObj.currency = currency;
    }
    // 'all' = no company filter; "4" is the legacy Seanet "1 and 3" value; a
    // list is a restricted user's own 'all' (functions/companyAccess).
    const companies = reportCompanies(req.headers.company, req.allowedCompanies);
    if (companies) invoiceObj.companyId = { [Op.in]: companies };
    const agent = req.headers.overseasagent;
    if (agent && agent !== 'undefined' && agent !== 'null') {
      invoiceObj[Op.and].push(await partyInvoiceWhere(agent));
    }
    const result = await Invoice.findAll({
      where: invoiceObj,
      attributes: [
        "id", "invoice_No", "payType", "currency", "ex_rate", "roundOff", 
        "total", "paid", "recieved", "createdAt", "party_Name", "companyId"
      ],
      include: [
        {
          model: SE_Job,
          required: false,
          include: [
            { model: Clients, required: false, as: "shipper", attributes: ["name"] },
            { model: Clients, required: false, as: "Client", attributes: ["name"] },
            { model: Vessel, required: false, as: "vessel", attributes: ["name"] },
            { model: Voyage, required: false, as: "Voyage", attributes: ["voyage"] },
            { model: Employees, required: false, as: "sales_representator", attributes: ["name"] },
            { model: Bl, required: false, attributes: ["hbl", "mbl"] },
            { model: SE_Equipments, required: false, attributes: ["qty", "size"] },
          ],
          attributes: [
            "id", "fd", "freightType", "jobNo", "operation", "subType", "vol", 
            "weight", "container", "customerRef", "fileNo", "arrivalDate", "shipDate"
          ],
        },
        {
          model: Charge_Head,
        },
      ],
      /* By date, oldest first, as the report and its exports read. This sat
         INSIDE the SE_Job include, where it orders nothing about the invoices,
         so they came back in whatever order Postgres held them - and a
         migrated book is held in load order, 2026 before 2022. The id breaks
         ties within a day; the lines keep the order they were raised in. */
      order: [["createdAt", "ASC"], ["id", "ASC"], [Charge_Head, "id", "ASC"]],
    });
    await attachAviationContext(result, aviationCtxModels());
    await attachCustomsContext(result, customsCtxModels());
    res.json({ status: "success", result });
  } catch (error) {
    console.error(error);
    res.status(500).json({status:"error", result: error.message || error });
  }
});


// For Data Backup
routes.get("/invoiceTest", async (req, res) => {
  try {

    const from = moment("2023-09-08");
    const to   = moment("2023-09-10");
    const result = await Invoice.findAll({
      where:{
        createdAt: {
          [Op.gte]: from.toDate(),
          [Op.lte]: to.toDate(),
         }
      },
      order: [[ 'createdAt', 'ASC' ]]
    });

    await res.json({ status: "success", result: result });
  } catch (error) {
    console.error(error)
    res.status(500).json({status:"error", result: error.message || error });
  }
});

// For Data Backup
routes.post("/uploadbulkInvoicesTest", SYSTEM, async (req, res) => {
  try {
    const resultOne = await Clients.findOne({
      where:{name:req.body.party_Name},
      attributes:['id']
    })
    const resultTwo = await Vendors.findOne({
      where:{name:req.body.party_Name},
      attributes:['id']
    })
    createHistory(req.body.employeeId, 'Invoice', 'Upload', req.body.invoice_No);
    await res.json({ status:"success", result:resultOne?resultOne.id:resultTwo.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({status:"error", result: error.message || error });
  }
});

const setVoucherHeads = (id, heads) => {
  let result = [];
  heads.forEach((x) => {
    result.push({
      ...x,
      VoucherId: id,
      amount: `${x.amount}`
    });
  });
  return result;
};

routes.post("/uploadbulkInvoices", SYSTEM, async (req, res) => {
  try {
    temp = req.body
    voucher = temp.voucher
    delete temp.voucher
    let result
    try{
      result = await Invoice.create(temp, { fiscalYearCheck: false })

    }catch(e){
      console.error("Invoice creater",e)
    }
    let vouchers
    let invoiceNo = temp.invoice_No.slice(0, -2)
    try{
      const voucher = await Vouchers.findOne({
        where: {
          voucherNarration: {
            [Op.like]: `%${invoiceNo}%`
          }
        }
      });
      
      if (voucher) {
        const updatedInvoices = voucher.invoices ? `${voucher.invoices},${result.id}` : result.id;
        await Vouchers.update(
          {
            invoices: updatedInvoices,
          },
          {
            where: {
              id: voucher.id, 
            }
          }
        );
      }

    }catch(e){
      console.error("Voucher finder",e)
    }
    let Invoice_Transaction = {}
    for(let x of vouchers){
      if(x.voucherNarration.includes(invoiceNo)){
        Invoice_Transaction = {
          InvoiceId: result.dataValues.id,
          VoucherId: x.id
        }
        // Was `Voucher.update` - no such binding, so this threw a
        // ReferenceError the moment a voucher narration matched.
        await Vouchers.update(
          { invoices: result.dataValues.id }, // Fields to update
          { where: { id: x.id } }// Condition
        );
      }
    }
    let resultThree
    try{
      resultThree = await Invoice_Transactions.create({
        gainLoss: result.dataValues.payType=="Receivable"?(result.dataValues.total - result.dataValues.recieved):(result.dataValues.total - result.dataValues.paid),
        amount: result.dataValues.total,
        createdAt: result.dataValues.createdAt,
        ...Invoice_Transaction
      })
      
    }catch(e){
      console.error("Invoice Transaction creater",e)
    }
    res.json({ status: "success", result: result });
  } catch (error) {
    console.error(error)
    res.status(500).json({status:"error", result: error.message || error });
  }
})

routes.post("/updateVouchersWithInvoices", async (req, res) => {
  try {
    const allInvoices = await Invoice.findAll();
    for (const invoice of allInvoices) {
      
      const invoiceNo = invoice.dataValues.invoice_No;
      const invoiceId = invoice.dataValues.id;
      const vouchers = await Vouchers.findAll({
        where: {
          voucherNarration: {
            [Op.like]: `%${invoiceNo}%`
          }
        }
      });
      for (const voucher of vouchers) {
        const updatedInvoices = voucher.invoices ? `${voucher.invoices},${invoiceId}` : invoiceId;
        await Vouchers.update(
          {
            invoices: updatedInvoices,
          },
          {
            where: {
              id: voucher.id,
            }
          }
        );
      }
    }
    createHistory(req.body.employeeId, 'Invoice', 'Update', req.body.invoice_No);
    res.json({ status: 'success', message: 'All vouchers updated with invoice IDs.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// For Data Backup
routes.post("/createBulkInvoices", SYSTEM, async (req, res) => {
  try {
    temp = req.body
    voucher = temp.voucher
    delete temp.voucher
    const result = await Invoice.create(temp, { fiscalYearCheck: false })
    const resultC = await Client_Associations.findOne({
      where:{
        ClientId:req.body.party_Id,
        CompanyId: req.body.companyId
      },
    })
    const resultV = await Vendor_Associations.findOne({
      where:{
        VendorId:req.body.party_Id,
        CompanyId: req.body.companyId
      },
    })
    voucher.Voucher_Heads.forEach((x)=>{
      x.ChildAccountId = resultC?resultC.dataValues.ChildAccountId:resultV.dataValues.ChildAccountId
      x.narration = req.body.invoice_No 
    })
    // This bulk path has no resolved fiscal year of its own (it runs with
    // fiscalYearCheck:false), so it derives the suffix from the date the same
    // way it always has - July onwards belongs to the next year's book.
    const bulkSuffix = moment().month() >= 6 ? moment().add(1, 'year').format('YY') : moment().format('YY');
    const nextNo = await nextVoucherNo(Vouchers, {
      vType: voucher.vType,
      CompanyId: voucher.CompanyId,
      suffix: bulkSuffix,
    });
    const resultTwo = await Vouchers.create({
      ...voucher,
      partyId: req.body.party_Id,
      partyName: req.body.party_Name,
      voucher_No: nextNo,
      voucher_Id: voucherId(await readNumbering(), {
        vType: voucher.vType,
        company: await companyShort(voucher.CompanyId),
        seq: nextNo,
        suffix: bulkSuffix,
      }),
    }, { fiscalYearCheck: false })
    const resultThree = await Invoice_Transactions.create({
      gainLoss: result.dataValues.payType=="Receivable"?(result.dataValues.total - result.dataValues.recieved):(result.dataValues.total - result.dataValues.paid),
      amount: result.dataValues.total,
      createdAt: result.dataValues.createdAt,
      InvoiceId: result.dataValues.id,
      VoucherId: resultTwo.dataValues.id
    })

    let dataz = await setVoucherHeads(resultTwo.id, voucher.Voucher_Heads);
    const datab = await Voucher_Heads.bulkCreate(dataz);
    createHistory(req.body.employeeId, 'Invoice', 'Create', req.body.invoice_No);
    await res.json({ status: "success" });
  } catch (error) {
    console.error(error)
    res.status(500).json({status:"error", result: error.message || error });
  }
});

// For Data Backup
routes.get("/getClientsWithACPayble", async (req, res) => {
  try {
    const result = await Clients.findAll({
      include:[{
        model:Client_Associations,
        include:[{
          model:Parent_Account,
          where:{CompanyId:'1'}
        }]
      }]
    })
    await res.json({ status: "success", result});
  } catch (error) {
    console.error(error)
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/invoiceMatching", async (req, res) => {
  try {
    const result = await Invoice.findAll({})
    await res.json({ status: "success", result});
  } catch (error) {
    console.error(error)
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/ageingSummary", async (req, res) => {
  try {
    // ---------- 1) Helpers ----------
    const clean = (v) => {
      if (v == null) return null;
      const s = v.toString().trim();
      if (!s) return null;
      const low = s.toLowerCase();
      if (low === "undefined" || low === "null") return null;
      return s;
    };

    const splitList = (v) =>
      (v ?? "")
        .toString()
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

    // Try to detect column type safely
    const attrTypeKey = Invoice?.rawAttributes?.companyId?.type?.key; // e.g., 'STRING' or 'INTEGER'
    const isCompanyIdNumeric =
      typeof attrTypeKey === "string" &&
      ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "NUMBER"].includes(attrTypeKey.toUpperCase());

    // ---------- 2) Inputs (prefer query, fallback to headers) ----------
    const q = req.query || {};
    const h = req.headers || {};

    const fromRaw = q.from ?? h.from;
    const toRaw   = q.to   ?? h.to;

    // ---------- 3) Dates ----------
    const start = moment(fromRaw).startOf("day");
    const end   = moment(toRaw).endOf("day");

    if (!start.isValid() || !end.isValid()) {
      return res.status(400).json({ status: "error", message: "Invalid date format. Use DD-MM-YYYY" });
    }
    if (end.isBefore(start)) {
      return res.status(400).json({ status: "error", message: "`to` must be on/after `from`" });
    }

    // ---------- 4) WHERE ----------
    // BY THE INVOICE'S DATE. `from` is the report's CUT-OFF - an invoice dated
    // before it is left out, whatever is still owed on it - and `to` the last
    // date taken in (the user's request, 2026-10-09). It read updatedAt, which
    // moves on every receipt and approval and which every invoice migrated
    // from Climax has as the day of the migration - so the From date cut
    // nothing off. The screen ages each invoice by the same date, as on TODAY
    // - `to` only picks the invoices, so forward-dated ones can be taken in
    // (the user, 2026-11-02; functions/ageingRows in the frontend).
    const where = {
      createdAt: { [Op.between]: [start.toDate(), end.toDate()] },
    };

    // party_Id (ageing_account)
    const ageingAccount = clean(q.ageing_account ?? h.ageing_account);
    if (ageingAccount) {
      // Keep as string; your invoices show party_Id like "7328"
      where.party_Id = ageingAccount;
    }

    // companyId (handle type correctly)
    const companyTokens = splitList(q.ageing_company ?? h.ageing_company);
    if (companyTokens.length > 0) {
      if (isCompanyIdNumeric) {
        const asNumbers = companyTokens
          .map(n => Number(n))
          .filter(n => Number.isFinite(n));
        if (asNumbers.length > 0) {
          where.companyId = { [Op.in]: asNumbers };
        }
      } else {
        // Treat as strings to avoid varchar = integer errors
        where.companyId = { [Op.in]: companyTokens };
      }
    }

    // partyType (Agent -> ['agent'], default/local -> ['client','vendor'])
    const rawPartyType = (clean(q.ageing_partytype ?? h.ageing_partytype) ?? "").toLowerCase();
    if (rawPartyType === "agent") {
      where.partyType = { [Op.in]: ["agent"] };
    } else {
      // local/unspecified -> client & vendor
      where.partyType = { [Op.in]: ["client", "vendor"] };
    }

    // payType normalization to DB values ('Recievable' / 'Payble' as per your current data)
    const normalizePayTypeForDB = (s) => {
      const v = (s ?? "").toString().trim().toLowerCase();
      if (!v) return null;
      if (v === "recievable" || v === "receivable") return "Recievable";
      if (v === "payble" || v === "payable") return "Payble";
      return null;
    };
    const payTypes = splitList(q.ageing_rp ?? h.ageing_rp)
      .map(normalizePayTypeForDB)
      .filter(Boolean);
    if (payTypes.length > 0) {
      where.payType = { [Op.in]: payTypes };
    }

    // ONE currency, when one is picked. 'All' and 'All-PKR' read every
    // currency - the second is converted on the screen (functions/ageingCurrency
    // in the frontend). A rupee invoice may carry no currency at all, so PKR
    // takes those too.
    const ageingCurrency = clean(q.ageing_currency ?? h.ageing_currency);
    if (ageingCurrency && !/^all/i.test(ageingCurrency)) {
      const code = ageingCurrency.toUpperCase();
      where.currency = code === 'PKR' ? { [Op.or]: { [Op.eq]: 'PKR', [Op.is]: null } } : code;
    }

    // ONE SALES REP's parties, when one is picked: the rep set on the PARTY
    // (Setup > Parties), which is who a receivable belongs to in every mode -
    // a customs or aviation job has no rep of its own. Reached through the
    // party's ledger account, which is what an invoice names.
    const salesRepId = clean(q.ageing_salesrep ?? h.ageing_salesrep);
    if (salesRepId && !/^all$/i.test(salesRepId)) {
      const repClients = await Clients.findAll({ where: { salesRepresentatorId: salesRepId }, attributes: ['id'], raw: true });
      const links = repClients.length
        ? await Client_Associations.findAll({ where: { ClientId: repClients.map((c) => c.id) }, attributes: ['ChildAccountId'], raw: true })
        : [];
      const repAccounts = links.map((l) => String(l.ChildAccountId)).filter((x) => x && x !== 'null');
      const allowed = where.party_Id ? repAccounts.filter((a) => a === String(where.party_Id)) : repAccounts;
      if (!allowed.length) return res.json({ status: "success", temp: [] });
      where.party_Id = { [Op.in]: allowed };
    }

    // ---------- 5) Query invoices (no N+1 for transactions) ----------
    const invoices = await Invoice.findAll({
      where,
      include: [{ model: Invoice_Transactions }],
      order: [
        ["party_Id", "ASC"],
        ["createdAt", "ASC"],
        [Invoice_Transactions, "createdAt", "ASC"],
      ],
    });

    if (!invoices || invoices.length === 0) {
      return res.json({ status: "success", temp: [] });
    }

    // ---------- 6) Bulk-load accounts to avoid N+1 ----------
    const uniquePartyIds = [
      ...new Set(
        invoices
          .map(r => (r.party_Id ?? "").toString().trim())
          .filter(Boolean)
      )
    ];

    // Detect Child_Account.id type
    const acctIdTypeKey = Child_Account?.rawAttributes?.id?.type?.key;
    const acctIdIsNumeric =
      typeof acctIdTypeKey === "string" &&
      ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "NUMBER"].includes(acctIdTypeKey.toUpperCase());

    const accountWhereIds = acctIdIsNumeric
      ? uniquePartyIds.map(v => Number(v)).filter(Number.isFinite)
      : uniquePartyIds;

    const accounts = await Child_Account.findAll({
      where: { id: { [Op.in]: accountWhereIds } },
      attributes: ["id", "title", "code"],
    });

    const accountMap = new Map(
      accounts.map(a => [String(a.id), a.get({ plain: true })])
    );

    // ---------- 7) Enrich + group to [{ partyName, invoices: [...] }] ----------
    const groupedMap = new Map(); // key by party_Id
    for (const inv of invoices) {
      const plain = inv.get ? inv.get({ plain: true }) : inv;
      const key = String(plain.party_Id ?? "");
      if (!key) continue;

      const acc = accountMap.get(key);
      const enriched = {
        ...plain,
        partyName: acc?.title ?? plain.party_Name ?? null,
        partyCode: acc?.code ?? null,
      };

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          partyId: key,
          partyName: enriched.partyName ?? "(Unknown)",
          partyCode: enriched.partyCode ?? "(Unknown)",
          invoices: [],
        });
      }
      groupedMap.get(key).invoices.push(enriched);
    }

    // Each party's SALES REP - set on the party, reached through its account.
    const repLinks = await Client_Associations.findAll({
      where: { ChildAccountId: accountWhereIds },
      attributes: ['ChildAccountId', 'ClientId'],
      raw: true,
    });
    const repClients = repLinks.length
      ? await Clients.findAll({
          where: { id: [...new Set(repLinks.map((l) => l.ClientId))] },
          attributes: ['id'],
          include: [{ model: Employees, as: 'sales_representator', attributes: ['name'], required: false }],
        })
      : [];
    const repByClient = new Map(repClients.map((c) => [String(c.id), c.sales_representator?.name || null]));
    const repByAccount = new Map(repLinks.map((l) => [String(l.ChildAccountId), repByClient.get(String(l.ClientId)) || null]));

    const temp = Array.from(groupedMap.entries()).map(([partyId, { partyName, partyCode, invoices }]) => ({
      partyName,
      partyCode,
      salesRep: repByAccount.get(String(partyId)) || null,
      invoices,
    }));
    return res.json({ status: "success", temp });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: "error", message: "Internal server error", result: error.message || error });
  }
});

routes.get("/jobPnLSummary", async (req, res) => {
  try{
    const query = req.query || {};
    if (!pkDay(query.from) || !pkDay(query.to)) {
      console.error("Invalid date format for jobPnLSummary:", { from: query.from, to: query.to });
      return res.status(400).json({ status: "error", message: "Invalid date format" });
    }

    // Determine which SE_Job fields to include (vol, weight, shpVol, teu)
    const includeFields = query.includeFields ? query.includeFields.split(",").map(f => f.trim()) : [];
    const validSEJobFields = ['vol', 'weight', 'shpVol', 'teu'];
    const selectedFields = includeFields.filter(f => validSEJobFields.includes(f));

    // One reckoning for the Summary and the Comparison - getClientSummary.
    const clientMap = await getClientSummary(query.from, query.to, query.company, includeFields, req.allowedCompanies);

    // Format and return client-wise summary with P&L
    const result = Array.from(clientMap.values()).map(client => {
      const summary = {
        clientId: client.clientId,
        clientName: client.clientName,
        totalRevenue: parseFloat(client.totalRevenue.toFixed(2)),
        totalExpense: parseFloat(client.totalExpense.toFixed(2)),
        totalProfitLoss: parseFloat((client.totalRevenue - client.totalExpense).toFixed(2)),
        GP: parseFloat(parseFloat((client.totalRevenue - client.totalExpense).toFixed(2)) / (client.totalRevenue > 0 ? client.totalRevenue : 1) * 100).toFixed(2),
        jobCount: client.jobCount
      };

      // Add selected field totals
      selectedFields.forEach(field => {
        const totalKey = `total${field.charAt(0).toUpperCase()}${field.slice(1)}`;
        if (client[totalKey] !== undefined) {
          summary[totalKey] = parseFloat(client[totalKey].toFixed(2));
        }
      });

      return summary;
    }).sort((a, b) => a.clientName.localeCompare(b.clientName)); // Sort by client name alphabetically

    return res.json({ status: "success", result });

  }catch(error){
    console.error(error);
    return res.status(500).json({ status: "error", message: "Internal server error", result: error.message || error });
  }
});

/* A JOB'S MONEY, AS THE REPORT TAB AND THE LEDGER HAVE IT - each approved
 * invoice's total, PKR at 1 and any other currency at the invoice's rate
 * (functions/invoiceRate: a PKR invoice may carry the charges' USD rate).
 *
 * It was the charge lines' local amounts, by the line's side. An agent
 * invoice is posted NET - SNS-AI-186/27: 737 USD to FCL FREIGHT INCOME - but
 * its lines are the gross freight both ways (10,450 and 9,713), so the
 * Summary showed 2.9m of revenue and 2.7m of cost where the Report and the
 * ledger show 0.2m of revenue: ~84m of SNS's revenue from 1 July read
 * differently on the two tabs (the user, 2026-11-20: amounts not matching).
 * The profit came out the same either way. */
const invoicePkr = (inv) => {
  const total = parseFloat(inv?.total) || 0;
  if (String(inv?.currency || 'PKR').toUpperCase() === 'PKR') return total;
  return total * (parseFloat(inv?.ex_rate) || 0);
};

// Helper function to get client summary for a date range. `from` and `to` as
// the screen sent them; the job's own date decides (see /misc/profitLoss/job).
const getClientSummary = async (from, to, company, includeFields, allowedCompanies = null) => {
  // Determine which SE_Job fields to include (vol, weight, shpVol, teu)
  const validSEJobFields = ['vol', 'weight', 'shpVol', 'teu'];
  const selectedFields = includeFields.filter(f => validSEJobFields.includes(f));
  const seJobAttributes = ['id', 'jobNo', 'subType', 'ClientId', ...selectedFields];

  // BY THE JOB'S OWN DATE, in Pakistan days, as the Report tab - it went by
  // when the record was entered, which on a migrated job can be weeks off.
  const jobDay = `COALESCE(NULLIF(left("SE_Job"."jobDate", 10), ''), to_char("SE_Job"."createdAt" AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD'))`;
  const jobWhereClause = {
    [Op.and]: [Sequelize.where(Sequelize.literal(jobDay), { [Op.between]: [pkDay(from) || '0000-01-01', pkDay(to) || '9999-12-31'] })],
  };

  // 'all' = no company filter; '4' is the legacy Seanet "1 and 3" value; a
  // list is a restricted user's own 'all' (functions/companyAccess).
  const companies = reportCompanies(company, allowedCompanies);
  if (companies) jobWhereClause.companyId = { [Op.in]: companies };

  const jobs = await SE_Job.findAll({
    where: jobWhereClause,
    attributes: seJobAttributes,
    include:[
      {
        model: Clients,
        attributes: ['id', 'name'],
        required: false
      },
      {
        model: Invoice,
        attributes: ['id', 'payType', 'currency', 'ex_rate', 'total'],
        required: false,
        where: { approved: "1" }
      }
    ]
  });

  // Group by ClientId and calculate revenue, expense, P&L
  const clientMap = new Map();

  for (const job of jobs) {
    const clientId = job.ClientId;

    if (!clientId) continue; // Skip jobs without a client

    // Initialize client entry if not exists
    if (!clientMap.has(clientId)) {
      clientMap.set(clientId, {
        clientId: clientId,
        clientName: job.Client?.name || "(Unknown)",
        totalRevenue: 0,
        totalExpense: 0,
        jobCount: 0
      });

      // Initialize field totals if selected
      selectedFields.forEach(field => {
        clientMap.get(clientId)[`total${field.charAt(0).toUpperCase()}${field.slice(1)}`] = 0;
      });
    }

    const client = clientMap.get(clientId);
    client.jobCount += 1;

    // Add job field values to totals if selected
    selectedFields.forEach(field => {
      const totalKey = `total${field.charAt(0).toUpperCase()}${field.slice(1)}`;
      if (job[field] !== undefined) {
        client[totalKey] += parseFloat(job[field]) || 0;
      }
    });

    for (const inv of job.Invoices || []) {
      if (inv.payType === 'Recievable') client.totalRevenue += invoicePkr(inv);
      else if (inv.payType === 'Payble') client.totalExpense += invoicePkr(inv);
    }
  }

  return clientMap;
};

routes.get("/jobPnLComparison", async (req, res) => {
  try{
    const query = req.query || {};
    const from1 = moment(query.from1).startOf("day");
    const to1   = moment(query.to1).endOf("day");
    const from2 = moment(query.from2).startOf("day");
    const to2   = moment(query.to2).endOf("day");
    
    if (!from1.isValid() || !to1.isValid() || !from2.isValid() || !to2.isValid()) {
      console.error("Invalid date format for jobPnLComparison:", { from1: query.from1, to1: query.to1, from2: query.from2, to2: query.to2 });
      return res.status(400).json({ status: "error", message: "Invalid date format" });
    }

    // Determine which SE_Job fields to include (vol, weight, shpVol, teu)
    const includeFields = query.includeFields ? query.includeFields.split(",").map(f => f.trim()) : [];
    const validSEJobFields = ['vol', 'weight', 'shpVol', 'teu'];
    const selectedFields = includeFields.filter(f => validSEJobFields.includes(f));
    const company = query.company;

    // Get summaries for both periods
    // The dates as sent - getClientSummary reads them as Pakistan days.
    const clientMap1 = await getClientSummary(query.from1, query.to1, company, includeFields, req.allowedCompanies);
    const clientMap2 = await getClientSummary(query.from2, query.to2, company, includeFields, req.allowedCompanies);

    // Combine all client IDs
    const allClientIds = new Set([...clientMap1.keys(), ...clientMap2.keys()]);

    // Build comparison result
    const result = Array.from(allClientIds).map(clientId => {
      const client1 = clientMap1.get(clientId) || (() => {
        const defaultClient = {
          clientId,
          clientName: clientMap2.get(clientId)?.clientName || "(Unknown)",
          totalRevenue: 0,
          totalExpense: 0,
          jobCount: 0
        };
        selectedFields.forEach(field => {
          defaultClient[`total${field.charAt(0).toUpperCase()}${field.slice(1)}`] = 0;
        });
        return defaultClient;
      })();
      const client2 = clientMap2.get(clientId) || (() => {
        const defaultClient = {
          clientId,
          clientName: client1.clientName,
          totalRevenue: 0,
          totalExpense: 0,
          jobCount: 0
        };
        selectedFields.forEach(field => {
          defaultClient[`total${field.charAt(0).toUpperCase()}${field.slice(1)}`] = 0;
        });
        return defaultClient;
      })();

      // Calculate GP for each period
      const gp1 = parseFloat((client1.totalRevenue - client1.totalExpense)/parseFloat(client1.totalRevenue || 1).toFixed(2)) * 100;
      const gp2 = parseFloat((client2.totalRevenue - client2.totalExpense)/parseFloat(client2.totalRevenue || 1).toFixed(2)) * 100;
      const variance = parseFloat((gp1 - gp2).toFixed(2));

      const comparison = {
        clientId: clientId,
        clientName: client1.clientName,
        period1: {
          totalRevenue: parseFloat(client1.totalRevenue.toFixed(2)),
          totalExpense: parseFloat(client1.totalExpense.toFixed(2)),
          PnL: parseFloat((client1.totalRevenue - client1.totalExpense).toFixed(2)),
          GP: gp1,
          jobCount: client1.jobCount
        },
        period2: {
          totalRevenue: parseFloat(client2.totalRevenue.toFixed(2)),
          totalExpense: parseFloat(client2.totalExpense.toFixed(2)),
          PnL: parseFloat((client2.totalRevenue - client2.totalExpense).toFixed(2)),
          GP: gp2,
          jobCount: client2.jobCount
        },
        variance: variance
      };

      // Add selected field totals for both periods
      selectedFields.forEach(field => {
        const totalKey = `total${field.charAt(0).toUpperCase()}${field.slice(1)}`;
        comparison.period1[totalKey] = parseFloat((client1[totalKey] || 0).toFixed(2));
        comparison.period2[totalKey] = parseFloat((client2[totalKey] || 0).toFixed(2));
      });

      return comparison;
    }).sort((a, b) => a.clientName.localeCompare(b.clientName)); // Sort by client name alphabetically

    return res.json({ status: "success", result });

  }catch(error){
    console.error(error);
    return res.status(500).json({ status: "error", message: "Internal server error", result: error.message || error });
  }
});


// The router is the default export (index.js mounts it with app.use). The
// aviation module also needs approveInvoice directly, so it hangs off the
// router rather than changing the export shape every existing require expects.
routes.approveInvoice = approveInvoice;

module.exports = routes;
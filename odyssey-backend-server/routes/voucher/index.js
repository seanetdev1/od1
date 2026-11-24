const { nextVoucherNo } = require("../../functions/voucherNumber");
// What a receipt adds to an invoice, stored to the paisa.
const { toCents } = require("../../functions/invoiceOwed");
const { priorShares, settlementChange } = require("../../functions/receiptEdit");
const { partyAmount, planSettlement } = require("../../functions/advanceSettlement");
const { payRecSearchWhere } = require("../../functions/payRecSearch");
const { marksParty, lineAccountId } = require("../../functions/paymentLines");
const { Vouchers, Voucher_Heads, Office_Vouchers } = require("../../functions/Associations/voucherAssociations");
const { resolveSelectedFiscalYear } = require("../../functions/Associations/fiscalYearAssociations");
const { Child_Account, Parent_Account } = require("../../functions/Associations/accountAssociations");
const { SE_Job, SE_Equipments, Bl, Container_Info ,Commodity} = require("../../functions/Associations/jobAssociations/seaExport");
const routes = require("express").Router();
const Sequelize = require("sequelize");
const moment = require("moment");
const { Employees } = require("../../functions/Associations/employeeAssociations");
const { Clients, Client_Associations } = require("../../functions/Associations/clientAssociation");
// const { Vendors, Vendor_Associations } = require("../../functions/Associations/vendorAssociations");
const { Charge_Head, Invoice, Invoice_Transactions } = require("../../functions/Associations/incoiceAssociations");
const { Accounts, sequelize, Direct_Job, Direct_Job_Association } = require('../../models/');
const db = require("../../models/");
const { voucherSource, refusalFor } = require("../../functions/voucherSource");
const { settlementFor } = require("../../functions/invoiceSettlement");
const { isCashVoucher, noCheque } = require("../../functions/cashCheque");
const { netAmount, isPaymentOrReceipt } = require("../../functions/voucherNet");
/* DIRECT JOB E/R IN EVERY OPERATION MODE.
 *
 * The screen was hard-wired to freight: it listed SE_Jobs, stored the id in a
 * column with a foreign key to SE_Jobs, joined SE_Job to read it back, and
 * picked its ledger account from SE_Job.subType. Under aviation and customs
 * the SE_Jobs table is empty, so the picker came back with nothing and there
 * was no job an entry could be attached to.
 *
 * directJobJobSource is the one place that maps the install's mode to its job
 * table, its id column on Direct_Job_Association and the picker's headings.
 * ledgerBuckets is the account mapping, shared with invoice approval so the
 * two post the same job's money to the same accounts. */
const { Aviation_Job } = require("../../functions/Associations/aviationAssociations");
const { Customs_Job } = require("../../functions/Associations/customsAssociations");
const directJobJobSource = require("../../functions/directJobJobSource");
const { directJobSearchWhere, escapeLike } = require("../../functions/directJobSearch");
const {
  chargeKey, directJobRepeats, directJobRepeatsMessage, readUniqueJobCharges,
} = require("../../functions/jobChargeRepeats");
const { readCustomsJobForm } = require("../../functions/customsJobForm");
const { ledgerBucketsFor } = require("../../functions/ledgerBuckets");
/* And how a bucket becomes a row in THIS install's chart of accounts: the id
 * chosen in Config > Ledger Accounts first, the seeded title only as a
 * fallback. Shared with invoice approval - this screen used to match by title
 * and nothing else, so an install that had chosen its accounts on the settings
 * screen could approve an invoice against them and then be told, on the next
 * direct entry for the same job, to go and create an account by the seeded
 * name. */
const {
  readLedgerAccounts, makeAccountResolver, missingAccountMessage,
} = require("../../functions/ledgerAccounts");
const { AppSetting } = require("../../models/");
const { readOperationMode } = require("../settings");

// The Sequelize model behind each mode's job source. Kept here rather than in
// directJobJobSource so that module stays free of model imports and its
// mapping can be tested without a database.
const JOB_MODELS = {
  [directJobJobSource.FREIGHT]: SE_Job,
  [directJobJobSource.AVIATION]: Aviation_Job,
  [directJobJobSource.CUSTOMS]: Customs_Job,
};

/**
 * The job include for the mode this install runs in.
 *
 * `required: false` throughout: a Direct Job line whose job has since been
 * deleted must still be listed, not silently dropped from the entry it is part
 * of - the money is still on the voucher either way.
 */
const jobInclude = (mode) => {
  const src = directJobJobSource.sourceFor(mode);
  return { model: JOB_MODELS[src.mode], as: src.alias, required: false };
};

/**
 * What the picker needs to show one job, per mode.
 *
 * Returned as { where, include, attributes } so the route builds one query and
 * the per-mode knowledge stays in one place.
 *
 * EXACT is the job box on the screen: a whole job number typed and left is
 * that job (asked 2026-11-13). The job number itself, any case, and nothing
 * that merely contains it - "CCJ-1/27" is not "CCJ-11/27". Escaped, so a %
 * or _ typed is a character and not a wildcard.
 */
const jobQueryFor = (mode, search, exact = false) => {
  const like = exact
    ? { [Op.iLike]: escapeLike(search) }
    : { [Op.iLike]: `%${search}%` };
  if (exact) {
    const q = jobQueryFor(mode, '');
    return { ...q, where: { jobNo: like } };
  }

  if (mode === directJobJobSource.AVIATION) {
    return {
      attributes: ['id', 'jobNo', 'flightNo', 'origin', 'destination', 'flightDate'],
      include: [{
        model: db.Aviation_Carrier, as: 'operatingCarrier',
        attributes: ['id', 'name'], required: false,
      }],
      where: search ? { [Op.or]: [
        { jobNo: like }, { flightNo: like },
        { origin: like }, { destination: like },
        { '$operatingCarrier.name$': like },
      ] } : {},
    };
  }

  if (mode === directJobJobSource.CUSTOMS) {
    return {
      // jobRef is the S/R Page #, the line's File # on an install that says so;
      // customFileNo otherwise (directJobJobSource).
      attributes: ['id', 'jobNo', 'jobRef', 'customFileNo', 'gdNumber', 'blNo', 'vesselOrFlight'],
      include: [{ model: Clients, as: 'client', attributes: ['id', 'name'], required: false }],
      where: search ? { [Op.or]: [
        { jobNo: like }, { jobRef: like }, { gdNumber: like }, { blNo: like },
        { vesselOrFlight: like }, { '$client.name$': like },
      ] } : {},
    };
  }

  // Freight - the original query, unchanged.
  return {
    attributes: ['id', 'jobNo', 'fileNo'],
    include: [
      { model: Clients, attributes: ['name'], required: false },
      { model: Clients, as: 'consignee', attributes: ['name'], required: false },
      { model: Bl, attributes: ['hbl', 'mbl'], required: false },
    ],
    where: search ? { [Op.or]: [
      { jobNo: like },
      { '$Client.name$': like },
      { '$consignee.name$': like },
      { '$Bl.hbl$': like },
      { '$Bl.mbl$': like },
    ] } : {},
  };
};

/**
 * A row id from a header or a query, or null.
 *
 * The Direct Job screen opens at /accounts/directJob/new and passes that 'new'
 * straight through as the id, so these handlers are routinely asked for a row
 * whose id is not a number. Postgres rejects it as `invalid input syntax for
 * type integer`, which surfaces as a 500 with a driver stack trace - on the
 * ordinary path of creating an entry.
 */
const rowId = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The ledger account one Direct Job line posts to.
 *
 * Was: read SE_Job.subType, choose between the LCL and FCL pair. That threw
 * under aviation and customs, where the SE_Job lookup returns null - and would
 * have posted a flight to FCL FREIGHT if it had not.
 *
 * Now the bucket comes from the job the line is actually against: a customs
 * job by its direction, a freight job by its sub type, and a flight - which
 * has neither - to AVIATION (AIR while unset). Same mapping invoice approval uses.
 */
const directJobBuckets = async (mode, jobId, type, t) => {
  const side = type === 'revenue' ? 'income' : 'expense';
  const model = JOB_MODELS[directJobJobSource.sourceFor(mode).mode];

  let subType;
  let customsDirection;
  let customsCargoType;
  let customsTransportMode;
  if (jobId && model) {
    if (mode === directJobJobSource.CUSTOMS) {
      const job = await model.findOne({
        where: { id: jobId },
        // cargoType decides the EXPENSE account only - see expenseBucketFor.
        attributes: ['direction', 'cargoType', 'transportMode'],
        transaction: t,
      });
      customsDirection = job?.direction === 'Export' ? 'Export' : job ? 'Import' : undefined;
      customsCargoType = job?.cargoType;
      customsTransportMode = job?.transportMode;
    } else if (mode === directJobJobSource.FREIGHT) {
      const job = await model.findOne({ where: { id: jobId }, attributes: ['subType'], transaction: t });
      // A job that has been deleted since the line was typed leaves subType
      // undefined, which falls to AIR rather than throwing on a null.
      subType = job?.subType;
    }
  }

  /* The expense side of a clearance job is chosen by cargo type where one is
   * recorded; income and everything else by the job's own bucket. Direct Job
   * E/R has to agree with the invoice about this, or the same job's costs
   * land in two accounts depending on which screen posted them. */
  // A flight posts to AVIATION (AIR's accounts while that is unset) - the same
  // rule invoice approval uses, so a flight's direct costs and its invoices
  // land in the same accounts.
  const aviation = mode === directJobJobSource.AVIATION;
  return {
    side,
    ...ledgerBucketsFor({ subType, customsDirection, customsTransportMode, customsCargoType, aviation }),
  };
};

/**
 * The Child_Account one Direct Job line posts to.
 *
 * Throws with the two ways out rather than returning null: there is nowhere
 * sensible to put the money, and a voucher head built on a null account used
 * to fail as "Cannot read properties of null", several frames away from
 * anything that explained it.
 */
const directJobAccount = async (mode, jobId, type, t) => {
  const { side, bucket, expenseBucket, fallbacks } = await directJobBuckets(mode, jobId, type, t);
  const resolve = makeAccountResolver({
    Child_Account,
    mapping: await readLedgerAccounts(AppSetting, t),
    bucket,
    expenseBucket,
    fallbacks,
    transaction: t,
  });
  const account = await resolve(side);
  if (!account) {
    throw new Error(missingAccountMessage({
      document: 'entry',
      side,
      bucket: side === 'expense' ? expenseBucket : bucket,
    }));
  }
  return account;
};

// Voucher / receipt number prefix for a company.
//
// Was hardcoded at seven sites as
//     CompanyId == 1 ? "SNS" : CompanyId == 2 ? "CLS" : "ACS"
// which stamps our three company codes onto every voucher number. On a leased
// install that produced voucher ids like "SNS-PV-1043/25" for a client with no
// connection to Seanet - the same class of leak as the hardcoded logos and bank
// details, but printed on every voucher and receipt.
//
// Company.short is exactly this value and is set per install (and populated
// from Gen_SubCompanies.ShortName by the migration). Cached because voucher
// creation is a hot path.
// companyShort / companyIdFromNumber moved to functions/companyCodes.js so the
// ledger importer resolves company codes the same way this file does, rather
// than carrying a second copy that could drift.
const { companyShort, companyIdFromNumber } = require('../../functions/companyCodes');

// House style for voucher and direct-job entry numbers - SNS-CRV-1/27 or
// SNS-CRV-27/1. See functions/documentNumber.
const { readNumbering, perCompany, formatNumber } = require('../../functions/documentNumber');
const { voucherId } = require('../../functions/voucherNumber');
const { lastDirectJobSeq } = require('../../functions/directJobNumber');

/**
 * The next DR/DE entry number for a direct job.
 *
 * A direct job has no numeric sequence column, so the next number is read back
 * out of the entry numbers already issued: this company's own code, this
 * fiscal year, compared as numbers. It used to take the alphabetically last
 * number of any year and code - so "DE-9" outranked "DE-10" and a migrated
 * "JER-132" outranked both. See functions/directJobNumber.
 *
 * One function rather than the two copies of the lookup that were here,
 * because a fix to one of them would have been a fix to half the direct jobs
 * in the app.
 */
const directJobEntryNo = async (direct_Job, fiscalYear, transaction) => {
  // An entry is an accounting document, so it follows the VOUCHERS layout in
  // Config > Document Numbers. DE / DR are fixed codes.
  const settings = await readNumbering();
  const company = await companyShort(direct_Job.companyId);
  const code = direct_Job.Type == 'revenue' ? 'DR' : 'DE';
  const suffix = fiscalYear.suffix;

  // Direct_Jobs has no company column - the company is only in the text. So:
  //   prefix on   this company's prefixed entries AND every unprefixed one
  //               (issued while the prefix was off, when the sequence was
  //               shared - counting them can only move the number up)
  //   prefix off  every entry of this code, any company
  // Either way switching the prefix never restarts the sequence or reuses a
  // number. The year is checked in lastDirectJobSeq.
  const { Op } = Sequelize;
  const rows = await Direct_Job.findAll({
    where: perCompany(settings, 'vouchers')
      ? { [Op.or]: [
          { Entry_No: { [Op.like]: `${company}-${code}-%` } },
          { Entry_No: { [Op.like]: `${code}-%` } },
        ] }
      : { Entry_No: { [Op.like]: `%${code}-%` } },
    attributes: ['Entry_No', 'createdAt'],
    raw: true,
    transaction,
  });
  const last = lastDirectJobSeq(rows, {
    code, suffix, yearFirst: settings.yearFirst.vouchers, yearStart: fiscalYear.startDate,
  });

  return formatNumber(settings, { klass: 'vouchers', company, code, seq: last + 1, suffix });
};

const { directJobVoucherType, keepsVoucherType } = require('../../functions/directJobVoucherType');

/* The voucher type a direct job posts - BPV/BRV, CPV/CRV, ADJ-P/ADJ-R, see
 * functions/directJobVoucherType. An unknown mode is a 400 naming it, not a
 * credit note. */
const directJobVType = (direct_Job) => {
  const vType = directJobVoucherType(direct_Job.Type, direct_Job.Tran_Mode);
  if (!vType) {
    const err = new Error(`Tran Mode "${direct_Job.Tran_Mode ?? ''}" is not Bank, Cash or Adjust.`);
    err.status = 400;
    throw err;
  }
  return vType;
};

/* The next number in that type's series for the year, laid out by Config >
 * Document Numbers - for a new entry, and for an edited one whose type
 * changed. */
const directJobVoucherNumber = async (vType, companyId, fiscalYear, transaction) => {
  const voucher_No = await nextVoucherNo(Vouchers, {
    vType, CompanyId: companyId, suffix: fiscalYear.suffix, transaction,
  });
  return {
    vType,
    voucher_No,
    voucher_Id: voucherId(await readNumbering(), {
      vType, company: await companyShort(companyId), seq: voucher_No, suffix: fiscalYear.suffix,
    }),
  };
};

const { Op, literal } = Sequelize;
const { createHistory } = require('../../functions/history');
const { pickedDate, ledgerDateOf, openingBalanceRedate } = require('../../functions/voucherDate');
const { invoiceIdsOf } = require('../../functions/voucherInvoices');
const {
  RETURN_VTYPE, RETURN_TYPE, returnRefusal, returnNarration, returnLines, returnedRefusal,
} = require('../../functions/chequeReturn');
// The cheque return pointing at a voucher, if its cheque came back.
const returnOf = (id, transaction) => (id
  ? Vouchers.findOne({ where: { returnOfId: id }, attributes: ['id', 'voucher_Id'], transaction })
  : null);
const e = require("express");

//Voucher Types
// (For Jobs)
// Job Reciept 
// Job Recievable
// Job Payment 
// Job Payble
// 0 Unpaid
// 1 Fully-paid
// 2 Half-paid

// (For Expense)
// Expenses Payment
// Office_Vouchers

// Double-entry sanity check: a voucher's Voucher_Heads must always net to
// zero (total debit == total credit). Amounts are stored as strings and
// can in principle carry a stray sign, so this is the backstop that keeps
// a mistyped negative amount from ever reaching the trial balance.
const getVoucherBalance = (heads) => {
  let totalDebit = 0;
  let totalCredit = 0;
  (heads || []).forEach((x) => {
    const amount = parseFloat(x.amount) || 0;
    const type = (x.type || "").trim().toLowerCase();
    if (type === "credit") {
      totalCredit += amount;
    } else {
      totalDebit += amount;
    }
  });
  return {
    totalDebit,
    totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
  };
};

const setVoucherHeads = (id, heads, curr) => {
  let result = [];
  heads.forEach((x) => {
    console.log("X>",x)
    result.push({
      ...x,
      VoucherId: id,
      amount: `${x.amount}`,
      defaultAmount: curr=="PKR"?`${x.amount}`:'0',
    });
  });
  console.log("Result>",result)
  return result;
};

routes.post("/ApproveOfficeVoucher", async (req, res) => {
  try {
    const result = await Office_Vouchers.update(
      { approved: req.body.approved, VoucherId: req.body.VoucherId },
      { where: { id: req.body.id } }
    );
    createHistory(req.body.employeeId, 'Voucher', 'Approve', result.name);
    res.json({ status: "success", result: result });
  } catch (error) {
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.post("/recordReverse", async (req, res) => {
  try {
    const result = await Vouchers.findOne({
      where: { id: req.body.VoucherId },
      include: [{ model: Voucher_Heads }]
    })
    await Office_Vouchers.update(
      { reverseAmount: req.body.reverseAmount, paid: req.body.paid },
      { where: { id: req.body.id } }
    );
    res.json({ status: "success", result: result });
  } catch (error) {
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.post("/OfficeVoucherUpsert", async (req, res) => {
  try {
    const result = await Office_Vouchers.upsert(req.body);
    createHistory(req.body.employeeId, 'Voucher', 'Upsert', result.name);
    res.json({ status: "success", result: result });
  } catch (error) {
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/OfficeVoucherById", async (req, res) => {
  try {
    const result = await Office_Vouchers.findOne({
      where: { id: req.headers.id },
      include: [{ model: Employees, attributes: ['name'] },
      { model: Vouchers, attributes: ['voucher_Id'] }],
    })
    res.json({ status: "success", result: result });
  } catch (error) {
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/OfficeAllVouchers", async (req, res) => {
  try {
    const result = await Office_Vouchers.findAll({
      attributes: ['id', 'EmployeeId', 'amount', 'requestedBy', 'preparedBy', 'approved', 'paid'],
      where: { CompanyId: req.headers.companyid },
      include: [
        { model: Employees, attributes: ['name'] },
        { model: Vouchers, attributes: ['voucher_Id'] },
      ]
    })
    res.json({ status: "success", result: result });
  } catch (error) {
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/getAllVoucehrHeads", async (req, res) => {
  try {
    console.log("Running API")
    // Was `Invoices` - the model is `Invoice`, so this threw a ReferenceError.
    const invoices = await Invoice.findAll();

    // Update each invoice with the modified invoice_No
    for (const invoice of invoices) {
      const modifiedInvoiceNo = invoice.invoice_No?.endsWith('-O') 
        ? invoice.invoice_No.slice(0, -2) 
        : invoice.invoice_No;
      await invoice.update({ invoice_No: modifiedInvoiceNo });
    }

    res.json({ status: "success", message: "Invoice numbers updated successfully" });
  } catch (error) {
    console.error("Error updating invoice numbers:", error);
    res.status(500).json({ status: "error", result: error.message });
  }
});


routes.post("/voucherCreation", async (req, res) => {
  try {
    console.log("Request Body:",req.body)
    const fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId);
    const nextNo = await nextVoucherNo(Vouchers, {
      vType: req.body.vType,
      CompanyId: req.body.CompanyId,
      suffix: fiscalYear.suffix,
    });
      const result = await Vouchers.create({
        ...req.body,
        voucher_No: nextNo,
        voucher_Id: !req.body.voucher_Id ? voucherId(await readNumbering(), {
          vType: req.body.vType,
          company: await companyShort(req.body.CompanyId),
          seq: nextNo,
          suffix: fiscalYear.suffix,
        }) : req.body.voucher_Id,
        FiscalYearId: fiscalYear.id,
      }).catch();
      let dataz = await setVoucherHeads(result.id, req.body.Voucher_Heads, req.body.currency);
      const VH = await Voucher_Heads.bulkCreate(dataz);
      createHistory(req.body.employeeId, 'Voucher', 'Create', result.voucher_No);
      res.json({ status: "success", result: result });
  } catch (error) {
    console.log(error)
    res.status(500).json({status:"error", result: error.message || error });
  }
});

/* CHEQUE RETURN - Payments & Receipts > open a bank voucher > Cheque Return
 * > Approve & Save. A CR voucher on the day the cheque came back, every line of
 * the original on the other side; the invoices it settled reopened by what it
 * settled on each. One transaction. See functions/chequeReturn.
 *
 * Replaces /cheaqueReturned, which nothing called: it gave the return the
 * original's number, posted whatever lines the browser sent, and wiped EVERY
 * settlement on the invoice - other receipts' too - marking it unpaid. */
routes.post("/chequeReturn", async (req, res) => {
  let fiscalYear;
  try {
    fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId);
  } catch (e) {
    return res.status(500).json({ status: 'error', result: e.message });
  }

  const t = await sequelize.transaction();
  try {
    // Locked, so a second press while the first is posting waits and then
    // finds the return the first one made.
    const original = await Vouchers.findOne({
      where: { id: req.body.voucherId }, transaction: t, lock: t.LOCK.UPDATE,
    });
    const existing = original
      ? await Vouchers.findOne({ where: { returnOfId: original.id }, attributes: ['id', 'voucher_Id'], transaction: t })
      : null;
    const refusal = returnRefusal(original, existing);
    if (refusal) {
      await t.rollback();
      return res.status(400).json({ status: 'error', result: refusal });
    }

    const heads = await Voucher_Heads.findAll({ where: { VoucherId: original.id }, order: [['id', 'ASC']], transaction: t });
    const postedAt = ledgerDateOf(req.body.date);
    const narration = returnNarration(original);
    const CompanyId = original.CompanyId;

    const v = {
      type: RETURN_TYPE, vType: RETURN_VTYPE,
      currency: original.currency, exRate: original.exRate,
      chequeNo: original.chequeNo, chequeDate: original.chequeDate,
      costCenter: original.costCenter, invoices: original.invoices, onAccount: original.onAccount,
      partyId: original.partyId, partyName: original.partyName, partyType: original.partyType,
      subType: original.subType, CompanyId,
      voucherNarration: narration,
      tranDate: postedAt.toISOString(), createdAt: postedAt,
      FiscalYearId: fiscalYear.id,
      returnOfId: original.id,
    };
    v.voucher_No = await nextVoucherNo(Vouchers, {
      vType: RETURN_VTYPE, CompanyId, suffix: fiscalYear.suffix, transaction: t,
    });
    v.voucher_Id = voucherId(await readNumbering(), {
      vType: RETURN_VTYPE, company: await companyShort(CompanyId), seq: v.voucher_No, suffix: fiscalYear.suffix,
    });
    const cheque = await Vouchers.create(v, { transaction: t });

    for (const line of returnLines(heads, narration)) {
      await Voucher_Heads.create({ ...line, VoucherId: cheque.id, createdAt: postedAt }, { transaction: t });
    }

    // Each invoice gives back what THIS voucher settled on it - not the
    // invoice's whole received/paid, which other receipts may share.
    const settled = await Invoice_Transactions.findAll({ where: { VoucherId: original.id }, transaction: t });
    for (const x of settled) {
      const invoice = await Invoice.findOne({ where: { id: x.InvoiceId }, transaction: t });
      const field = invoice?.payType === 'Recievable' ? 'recieved' : invoice?.payType === 'Payble' ? 'paid' : null;
      if (!field) continue;
      await Invoice.update(
        { [field]: toCents(parseFloat(invoice[field] || 0) - parseFloat(x.amount || 0)).toString() },
        { where: { id: invoice.id }, transaction: t }
      );
    }
    await Invoice_Transactions.destroy({ where: { VoucherId: original.id }, transaction: t });

    await t.commit();
    await createHistory(req.body.employeeId, 'Payment Receipt', 'Cheque Return', original.voucher_No);
    res.json({ status: 'success', result: cheque });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post("/voucherEdit", async (req, res) => {
  try {
    // A cheque return stays as posted: its lines mirror the voucher it
    // reverses, and the invoices it reopened depend on it. The link itself is
    // never taken from the form either.
    const editing = await Vouchers.findOne({
      where: { id: req.body.id },
      attributes: ['voucher_Id', 'returnOfId', 'createdAt', 'vType', 'FiscalYearId'],
    });
    if (editing?.returnOfId) {
      return res.status(400).json({ status: 'error', result: `${editing.voucher_Id} is a cheque return. It cannot be edited.` });
    }
    delete req.body.returnOfId;

    /* THE DATE THE LINES STAND ON. The ledger places a line by its own
     * createdAt, and the lines are deleted and written again below - with
     * whatever date the form sent. The Opening Balance screen sends none, so
     * every edit moved its lines to the moment of the edit while the voucher
     * kept its date. Now: the date sent, else the voucher's own.
     *
     * An OPENING BALANCE entered in Odyssey (it has a fiscal year; a migrated
     * one has none and keeps Climax's date) that stands after the first day of
     * its year was put there by the old rule - editing it moves it to the day
     * before the year opens. One on or before the first day is kept. See
     * functions/voucherDate openingBalanceRedate. */
    let postedAt = pickedDate(req.body.createdAt) || editing?.createdAt || undefined;
    if (editing?.vType === 'OP' && editing.FiscalYearId) {
      const fy = await db.FiscalYears.findByPk(editing.FiscalYearId, { attributes: ['startDate'] });
      if (fy) postedAt = openingBalanceRedate(editing.createdAt, fy);
    }
    delete req.body.createdAt;
    // One transaction, and for...of rather than forEach(async). This handler
    // deletes every head then re-inserts them: with forEach's discarded
    // promises, a failure part-way through committed the DELETE and only some
    // of the re-inserts, leaving a voucher whose heads no longer balance -
    // and still replied "success". Now it is all-or-nothing.
    await sequelize.transaction(async (t) => {
      await Vouchers.update(
        { ...req.body, ...(postedAt ? { createdAt: postedAt } : {}) },
        { where: { id: req.body.id }, transaction: t },
      )
      await Voucher_Heads.destroy({ where: { VoucherId: req.body.id }, transaction: t })
      for (const x of req.body.Voucher_Heads) {
        await Voucher_Heads.upsert(
          { ...x, VoucherId: req.body.id, createdAt: postedAt },
          { transaction: t }
        );
      }
    });
    const res1 = await Vouchers.findOne({
      where: {id: req.body.id}
    })
    createHistory(req.body.employeeId, 'Voucher', 'Edit', res1.voucher_no);
    await res.json({ status: "success" });
  } catch (error) {
    console.log(error)
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.post("/deleteVoucher", async (req, res) => {
  try {
    let obj = {};
    if (req.body.type == "VoucherId Exists") {
      obj = { id: req.body.id }
    } else {
      obj = {
        invoice_Voucher: "1",
        invoice_Id: req.body.id.toString(),
      }
    }
    const findAll = await Vouchers.findAll({
      where: obj,
    });
    const aReturn = findAll.find((x) => x.returnOfId);
    if (aReturn) {
      return res.status(400).json({
        status: 'error',
        result: `${aReturn.voucher_Id} is a cheque return. It cannot be deleted - the invoices it reopened would stay open.`,
      });
    }
    for(let x of findAll){

      const resultOne = await Voucher_Heads.destroy({
        where: { VoucherId: x.dataValues.id },
      });
      const resultTwo = await Vouchers.destroy({
        where: { id: x.dataValues.id },
      });
    }
    createHistory(req.body.employeeId, 'Voucher', 'Delete', findAll[0].voucher_No);
    await res.json({ status: "success", result: { findAll } });
  } catch (error) {
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/getAccountActivity", async (req, res) => {
  try {
    const debitaccount = req.headers.debitaccount || "";
    const creditaccount = req.headers.creditaccount || "";
    console.log(debitaccount, typeof(debitaccount))
    console.log(creditaccount, typeof(creditaccount))
    let obj = {};
    if (debitaccount && creditaccount) {
      obj = {
        [Op.or]: [
          { ChildAccountId: debitaccount, type: "debit" },
          { ChildAccountId: creditaccount, type: "credit" },
        ],
      };
    } else if (debitaccount) {
      obj = { ChildAccountId: debitaccount, type: "debit" };
    } else if (creditaccount) {
      obj = { ChildAccountId: creditaccount, type: "credit" };
    } else {
      obj = {};
    }
    const result = await Vouchers.findAll({
      attributes: ["voucher_Id", "currency", "exRate", "createdAt"],
      where: {
        createdAt: {
          [Op.gte]: moment(req.headers.from).toDate(),
          [Op.lte]: moment(req.headers.to).add(1, "days").toDate(),
        },
      },
      include: [
        {
          model: Voucher_Heads,
          where: obj,
          required: true,
          attributes: ["amount", "type", "defaultAmount"],
          include: [
            {
              model: Child_Account,
              attributes: ["id", "title"],
            },
          ],
        },
      ],
      // Same-day vouchers in the order they were made - see the ledger's
      // fetchLedgerRows (routes/accounts) for why createdAt alone ties.
      order: [["createdAt", "ASC"], ["id", "ASC"]],
    });
    await res.json({ status: "success", result: result });
  } catch (error) {
    console.error(error)
    res.status(500).json({status:"error", result: error.message || error });
  }
});

/**
 * The Voucher List - everything that is NOT a settlement.
 *
 *   GET /voucher/getAllVouchers?page=1&limit=20&search=...
 *   headers: id = companyId
 *
 * PAGED AND SEARCHED ON THE SERVER. It used to be neither: findAll with no
 * limit, every matching voucher and its heads serialised into one response,
 * and the screen slicing twenty rows out of the array it already held. That is
 * 59,745 vouchers and 63,094 heads on the first customs install - fetched in
 * full, on every page load, to show twenty. The reported `count` was the
 * literal 1.
 *
 * It got worse rather than being noticed, because until the voucher-type fix
 * most of a clearing agent's book sat on the Payments & Receipts screen, which
 * has always been paged. Sending the 7,000-odd non-settling vouchers here -
 * which is where they belong - is what made this the largest list in the app.
 *
 * SEARCH IS THE SAME FIELDS THE SCREEN USED TO FILTER ON, moved into the WHERE
 * so it searches the whole book rather than the page in the browser's memory.
 * voucher_No is cast because it is an integer column and the box is free text.
 *
 * THE DEBIT-HEAD JOIN IS NOW OUTER. It was `where: { type: 'debit' }` on the
 * include, which Sequelize reads as required - an INNER join that silently
 * dropped every voucher with no debit head. That is 269 rows on this install:
 * sales invoices, opening balances and a handful of payments that were simply
 * absent from the list with nothing to say so. They now appear, with the zero
 * their heads add up to.
 *
 * NET AMOUNT (2026-10-26): each payment and receipt also carries netAmount /
 * netAmountPkr - what its bank or cash paid out or took in, see
 * functions/voucherNet. Added beside Voucher_Heads rather than by sending the
 * credit heads too, so a screen that adds the heads up keeps its figure.
 */
/* The three tabs the Voucher List is split into, as the SERVER understands
 * them. They were a client-side filter over the whole table - which only works
 * while the whole table is in the browser, and stops working the moment the
 * list is paged: page one of twenty rows may hold no SI/PI at all, and that
 * tab would read as empty with 14,530 of them in the book.
 *
 * GENERAL IS EVERYTHING ELSE, deliberately, not a list of six codes. The old
 * filter named CPV/CRV/BPV/BRV/JV/TV, so a voucher whose vType was none of the
 * eleven codes across the three tabs appeared in NO tab: 616 of them on the
 * first customs install - 593 credit notes (ADJ-P), 17 cheque returns and 6
 * debit notes - present in the database, absent from every screen. A catch-all
 * cannot have that failure.
 */
const VOUCHER_TABS = {
  sipi:    ['SI', 'PI'],
  opening: ['OP', 'OB', 'OI'],
};
const NON_GENERAL = [...VOUCHER_TABS.sipi, ...VOUCHER_TABS.opening];

routes.get("/getAllVouchers", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const search = String(req.query.search || '').trim();

    // The two the Payments & Receipts screen owns. Everything else is a
    // voucher in its own right and belongs here - see resolveVoucherType in
    // functions/ledgerMapping.
    const and = [
      { type: { [Op.ne]: "Job Payment" } },
      { type: { [Op.ne]: "Job Reciept" } },
    ];

    // Which tab is asking. Anything unrecognised is General, which is the
    // catch-all - see VOUCHER_TABS.
    const category = String(req.query.category || 'general');
    if (VOUCHER_TABS[category]) {
      and.push({ vType: { [Op.in]: VOUCHER_TABS[category] } });
    } else {
      // NOT IN would drop a NULL vType, which is the one thing a catch-all
      // must not do - but the column is NOT NULL in the model and in the
      // database, so there is nothing to drop and no null branch to write.
      and.push({ vType: { [Op.notIn]: NON_GENERAL } });
    }

    if (search) {
      const like = `%${search}%`;
      const isNumeric = search !== '' && !isNaN(Number(search));
      and.push({
        [Op.or]: [
          { voucher_Id: { [Op.iLike]: like } },
          { chequeNo: { [Op.iLike]: like } },
          { payTo: { [Op.iLike]: like } },
          { chequeDate: { [Op.iLike]: like } },
          { vType: { [Op.iLike]: like } },
          { currency: { [Op.iLike]: like } },
          { partyName: { [Op.iLike]: like } },
          // An integer column against a free-text box.
          ...(isNumeric
            ? [Sequelize.where(
                Sequelize.cast(Sequelize.col("Vouchers.voucher_No"), "TEXT"),
                { [Op.iLike]: like },
              )]
            : []),
        ],
      });
    }

    const { count, rows } = await Vouchers.findAndCountAll({
      where: { CompanyId: req.headers.id, [Op.and]: and },
      include: [{
        model: Voucher_Heads,
        // amount in the voucher's currency, defaultAmount in rupees - the list
        // shows both on a foreign-currency voucher.
        attributes: ['type', 'amount', 'defaultAmount'],
        // The condition belongs in the JOIN, not the WHERE - see the header.
        // `separate` is not used: these are read per page, so it is twenty
        // parents' heads, not the table.
        where: { type: "debit" },
        required: false,
      }],
      // Newest first by date, and within a date by the order they were made:
      // vouchers dated the same day share a midnight createdAt, so on its own
      // that left them in no particular order - and paged with OFFSET, one
      // could show on two pages and another on none.
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      limit,
      offset: (page - 1) * limit,
      // One voucher has many heads, so without this the count is the number of
      // HEADS and the pager runs off the end of the list.
      distinct: true,
    });

    // The bank / cash lines of the page's payments and receipts - twenty
    // vouchers' worth at most - for their Net Amount.
    const settling = rows.filter((v) => isPaymentOrReceipt(v.vType)).map((v) => v.id);
    const bankLines = settling.length
      ? await Voucher_Heads.findAll({
          where: { VoucherId: settling, accountType: 'payAccount' },
          attributes: ['VoucherId', 'type', 'amount', 'defaultAmount', 'accountType'],
          raw: true,
        })
      : [];
    const result = rows.map((v) => {
      const net = netAmount(v.vType, bankLines.filter((h) => h.VoucherId === v.id));
      return { ...v.toJSON(), netAmount: net ? net.amount : null, netAmountPkr: net ? net.amountPkr : null };
    });

    res.json({
      status: "success",
      result,
      count,
      page,
      limit,
      pages: Math.ceil(count / limit),
    });
  } catch (error) {
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/testgetAll", async (req, res) => {
  try {
    const result = await Vouchers.findAll({
      where: {
        CompanyId: req.headers.id,
      },
      attributes: ['createdAt', 'voucher_Id'],
      order: [["createdAt", "DESC"]],
    });
    await res.json({ status: "success", result: result, count:1 });
  } catch (error) {
    res.status(500).json({status:"error", result: error.message || error });
  }
});

// routes.get("/getAllJobPayRecVouchers", async (req, res) => {
//   try {
//     const page = parseInt(req.headers.page) || 1;
//     const limit = parseInt(req.headers.limit) || 50;
//     const search = (req.headers.search || "").trim()
//     const offset = (page - 1) * limit;

//     const isValidDate = !isNaN(Date.parse(search));

//     const searchCondition = search
//       ? {
//           [Op.or]: [
//             { voucher_No: { [Op.ilike]: `%${search}%` } },
//             { voucher_Id: { [Op.ilike]: `%${search}%` } },
//             { partyName: { [Op.ilike]: `%${search}%` } },
//             { type: { [Op.ilike]: `%${search}%` } },
//             { currency: { [Op.ilike]: `%${search}%` } },
//             ...(isValidDate
//               ? [{ tranDate: new Date(search) }]
//               : [])
//           ]
//         }
//       : {};

//     // Get total count for pagination
//     const total = await Vouchers.count({
//       where: {
//         CompanyId: req.headers.companyid,
//         vType: { [Op.notIn]: ["OP", "SI", "PI", "OI", "OB"] },
//         type: { [Op.in]: ["Job Payment", "Job Reciept"] },
//         ...searchCondition
//       },
//     });

//     // Fetch only the records for the current page    
//     const result = await Vouchers.findAll({
//       order: [["createdAt", "DESC"]],
//       where: {
//         CompanyId: req.headers.companyid,
//         vType: { [Op.notIn]: ["OP", "SI", "PI", "OI", "OB"] },
//         type: { [Op.in]: ["Job Payment", "Job Reciept"] },
//         ...searchCondition
//       },
//       include: [
//         { model: Invoice_Transactions },
//         {
//           model: Voucher_Heads,
//           attributes: ["type", "amount", "accountType", "ChildAccountId"],
//           // required: false,
//           where: search
//             ? { amount: { [Op.like]: `%${search}%` } }
//             : undefined
//         }
//       ],
//       limit,
//       offset,
//     });

//     const partyIds = result
//       .map(v => v.dataValues.partyId)
//       .filter(Boolean);

//     if (partyIds.length) {
//       const clientAssociations = await Client_Associations.findAll({
//         where: { ClientId: { [Op.in]: partyIds } }
//       });

//       const clientMap = {};
//       clientAssociations.forEach(ca => {
//         clientMap[ca.ClientId] = ca;
//       });

//       result.forEach(voucher => {
//         voucher.dataValues.clientAssociation =
//           clientMap[voucher.dataValues.partyId] || null;
//       });
//     }

//     let invoice = [];
//     result.forEach((x) => {
//       x.dataValues.invoices?.split(",").forEach((y) => {
//         if (y) invoice.push(y);
//       });
//     });

//     const invoices = await Invoice.findAll({
//       where: { id: { [Op.in]: invoice } },
//       include: [
//         {
//           model: SE_Job,
//           include: [
//             { model: SE_Equipments, attributes: ["qty", "size"] },
//             { model: Bl, required: false, attributes: ["mbl", "hbl"] },
//           ],
//         },
//         { model: Invoice_Transactions },
//       ],
//     });

//     result.forEach((x) => {
//       const inv = invoices
//         .filter((y) => x.dataValues.invoices?.includes(y.dataValues.id))
//         .map((y) => ({ ...y.dataValues }));
//       x.dataValues.invoice = inv;
//     });

//     res.json({
//       status: "success",
//       result: result,
//       total,
//       page,
//       totalPages: Math.ceil(total / limit),
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({status:"error", result: error.message || error });
//   }
// });

routes.get("/getAllJobPayRecVouchers", async (req, res) => {
  try {
    // -------------------------
    // Pagination & Search
    // -------------------------
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = (page - 1) * limit;
    const search = (req.query.search || "").trim();
    const companyId = req.query.companyid;
    /* ONE VOUCHER BY ITS ID, in the list's own shape - what the screen opens
       when it is sent to /accounts/paymentReceipt/<id> (from the Ledger, a
       Job Balancing advance row). It only ever looked in the page of the list
       it had loaded, so anything older than that page did not open (the user,
       2026-11-20). Its own company, whichever is picked. */
    const oneId = rowId(req.query.id);

    // -------------------------
    // Build Search Condition
    // -------------------------
    // Voucher no, name, type, currency, cheque no, amount, and the date as the
    // list shows it - functions/payRecSearch.
    const searchCondition = oneId ? { id: oneId } : payRecSearchWhere(search, { Op, Sequelize, sequelize });

    // -------------------------
    // Query (find + count)
    // -------------------------
    const { count: total, rows: result } =
      await Vouchers.findAndCountAll({
        // Newest first by date and time; the id settles vouchers dated the
        // same instant, newest entry first.
        order: [["createdAt", "DESC"], ["id", "DESC"]],
        distinct: true,    
        where: {
            // By id: any company - but a user kept to some companies, only theirs.
            ...(oneId
              ? (Array.isArray(req.allowedCompanies) && req.allowedCompanies.length
                ? { CompanyId: { [Op.in]: req.allowedCompanies.map(String) } }
                : {})
              : { CompanyId: companyId }),
            vType: { [Op.notIn]: ["OP", "SI", "PI", "OI", "OB"] },
            type: { [Op.in]: ["Job Payment", "Job Reciept"] },
            ...searchCondition
          },
        include: [
          { model: Invoice_Transactions },
          {
            model: Voucher_Heads,
            attributes: ["type", "amount", "accountType", "ChildAccountId"],
            required: false
          }
        ],
        limit,
        offset
      });

    // Which of these had their cheque returned - the screen greys Cheque
    // Return, Make Transaction and Delete on them, and says by which CR.
    if (result.length) {
      const returns = await Vouchers.findAll({
        where: { returnOfId: { [Op.in]: result.map((v) => v.id) } },
        attributes: ['returnOfId', 'voucher_Id'],
      });
      const byOriginal = new Map(returns.map((r) => [r.returnOfId, r.voucher_Id]));
      result.forEach((v) => { v.dataValues.returnedBy = byOriginal.get(v.id) || null; });
    }

    // -------------------------
    // Attach Client Association
    // -------------------------
    const partyIds = result
      .map(v => v.dataValues.partyId)
      .filter(Boolean);

    if (partyIds.length) {
      const clientAssociations =
        await Client_Associations.findAll({
          where: { ClientId: { [Op.in]: partyIds } }
        });

      const clientMap = {};
      clientAssociations.forEach(ca => {
        clientMap[ca.ClientId] = ca;
      });

      result.forEach(voucher => {
        voucher.dataValues.clientAssociation =
          clientMap[voucher.dataValues.partyId] || null;
      });
    }

    // -------------------------
    // Collect Invoice IDs
    // -------------------------
    // Whole ids, never a substring of the text - see functions/voucherInvoices.
    const invoiceIds = [...new Set(result.flatMap((v) => [...invoiceIdsOf(v.dataValues.invoices)]))];

    // -------------------------
    // Fetch Invoices
    // -------------------------
    const invoices = invoiceIds.length
      ? await Invoice.findAll({
          where: { id: { [Op.in]: invoiceIds } },
          include: [
            {
              model: SE_Job,
              include: [
                { model: SE_Equipments, attributes: ["qty", "size"] },
                { model: Bl, required: false, attributes: ["mbl", "hbl"] }
              ]
            },
            { model: Invoice_Transactions }
          ]
        })
      : [];

    // -------------------------
    // Attach Invoices to Vouchers
    // -------------------------
    result.forEach(voucher => {
      const own = invoiceIdsOf(voucher.dataValues.invoices);
      voucher.dataValues.invoice = invoices
        .filter((inv) => own.has(String(inv.id)))
        .map((inv) => inv.dataValues);
    });

    // -------------------------
    // Final Response
    // -------------------------
    res.json({
      status: "success",
      result,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch vouchers",
      error
    });
  }
});

routes.get("/getVoucherById", async (req, res) => {
  try {
    console.log(">>>",req.headers.id)
    const result = await Vouchers.findOne({
      where: { id: req.headers.id },
      include: [
        {
          model: Voucher_Heads,
          include:[{
            model:Child_Account,
            attributes:['title']
          }]
        }
      ],
      // The lines in the order they were made (the user's request,
      // 2026-10-22). With no order Postgres returns them as stored, and saving
      // a voucher rewrites its lines, so an edited voucher came back shuffled.
      order: [[Voucher_Heads, 'id', 'ASC']],
    });
    // The record it belongs to, if another screen made it - the Voucher
    // screen shows it, and leaves changing it to that screen
    // (functions/voucherSource). Beside `result`, so no reader's shape moves.
    const source = result ? await voucherSource(result, db) : null;
    await res.json({ status: "success", result: result, source });
  } catch (error) {
    console.error(error)
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/getVoucherByIdAdvanced", async (req, res) => {
  try {
    const result = await Vouchers.findOne({
      where: { id: req.headers.id },
      include: [{
        model: Voucher_Heads,
        include: [{
          model: Child_Account,
          include: [{
            model: Child_Account,
            as: 'parent',
            include: [{
              model: Child_Account,
              as: 'parent'
            }]
          }]
        }]
      }],
      // In the order they were made - see getVoucherById.
      order: [[Voucher_Heads, 'id', 'ASC']],
    });
    await res.json({ status: "success", result: result });
  } catch (error) {
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/getVouchersByEmployeeId", async (req, res) => {
  try {
    const result = await Office_Vouchers.findAll({
      where: { EmployeeId: req.headers.id },
    });
    await res.json({ status: "success", result: result });
  } catch (error) {
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.post("/deleteBaseVoucher", async (req, res) => {
  try {
    const res1 = await Vouchers.findOne({
      where: {id: req.body.id}
    })
    if (!res1) return res.status(404).json({ status: "error", result: "That voucher no longer exists." });
    // The Voucher screen and the Voucher List delete through here; a voucher
    // another record made is deleted with that record (functions/
    // voucherSource). Opening balances' own list deletes theirs here too.
    const source = await voucherSource(res1, db);
    if (source && !source.opening) {
      return res.status(409).json({ status: "error", result: refusalFor(res1, source, 'Delete'), source });
    }
    await Voucher_Heads.destroy({ where: { VoucherId: req.body.id } })
    await Vouchers.destroy({ where: { id: req.body.id } })

    createHistory(req.body.employeeId, 'BaseVoucher', 'Delete', res1.voucher_No);
    await res.json({ status: "success" });
  } catch (error) {
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.post("/getChildAccountIds", async (req, res) => {
  let accountsList = req.body.list;
  let newList = [];
  try {
    // The contra account must belong to the company the opening balance is
    // being posted for. This was hardcoded to CompanyId 3, so on an install
    // with no company 3 the lookup returned null and the next use of its id
    // threw - opening balances failed with a bare 500 and no message. Where a
    // company 3 did exist, the posting went to the wrong company's contra
    // account, which is worse than failing.
    const contraAccount = await Child_Account.findOne({
      where: { title: "CONTRA ACCOUNT OPENINIG" },
      attributes: ['id', 'title'],
      include: [{
        model: Parent_Account,
        where: { CompanyId: req.body.company },
        attributes: ['CompanyId', 'title']
      }]
    });

    if (!contraAccount) {
      return res.status(400).json({
        status: 'error',
        result:
          'No "CONTRA ACCOUNT OPENINIG" account exists for this company. ' +
          'It is part of the chart of accounts - create the chart for this ' +
          'company before entering opening balances.',
      });
    }
    // Read-only, but forEach(async) broke it just as badly: res.json below
    // ran before any of these pushes had happened, so callers got a newList
    // that was empty or partial depending on timing.
    for (const x of accountsList) {
      await Child_Account.findOne({
        where: { title: x.title },
        attributes: ['id'],
        include: [{
          model: Parent_Account,
          where: { CompanyId: req.body.company }
        }]
      }).then((y) => {
        newList.push({
          "type": "Opening Balance",
          "vType": "OP",
          "currency": req.body.currency,
          "exRate": "1",
          "costCenter": "KHI",
          "CompanyId": req.body.company,
          Voucher_Heads: [
            {
              title: "CONTRA ACCOUNT OPENINIG",
              ChildAccountId: contraAccount.id,
              amount: x.amount,
              type: x.type == "debit" ? "debit" : "credit",
              defaultAmount: x.amount,
            },
            {
              title: x.title,
              ChildAccountId: y?.id,
              amount: x.amount,
              type: x.type == "debit" ? "credit" : "debit",
              defaultAmount: x.amount,
            },
          ]
        })
      })
    }
    // Same account, already fetched above - it was queried a second time with
    // the same hardcoded company id.
    res.json({ status: "success", result: { newList, childTwo: contraAccount } });
  } catch (error) {
    res.status(500).json({status:"error" });
  }
});

routes.post("/deletePaymentReceipt", async(req, res) => {
  try {
    const returned = returnedRefusal(await returnOf(req.body.id));
    if (returned) return res.status(400).json({ status: 'error', result: returned });
    const trans = await Invoice_Transactions.findAll({where:{VoucherId:req.body.id}})
    for (let x of trans) {
      const invoice = await Invoice.findOne({ where: { id: x.dataValues.InvoiceId } });
      console.log(x.dataValues)
      if (invoice) {
        let updateData = { status: "1" };
        console.log("Invoice to be deleted>>>",invoice.dataValues)
        if (invoice.dataValues.payType === "Recievable") {
          updateData.recieved = toCents(parseFloat(invoice.dataValues.recieved) - parseFloat(x.dataValues.amount)).toString();
        } else if (invoice.dataValues.payType === "Payble") {
          updateData.paid = toCents(parseFloat(invoice.dataValues.paid) - parseFloat(x.dataValues.amount)).toString();
        }
        console.log("Update Data>>>", updateData)
        const updateInvoice = await Invoice.update(updateData, {
          where: { id: x.dataValues.InvoiceId }
        });
      }
    }
    await Voucher_Heads.destroy({where:{VoucherId:req.body.id}})
    await Invoice_Transactions.destroy({where:{VoucherId:req.body.id}})
    const res1 = await Vouchers.findOne({
      where: {id: req.body.id}
    })
    await Vouchers.destroy({where:{id:req.body.id}})
    createHistory(req.body.employeeId, 'Payment Receipt', 'Delete', res1?.voucher_No);
    res.json({status:'success',});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

// routes.post("/makeTransaction", async(req, res) => {
//   const t = await sequelize.transaction()
//   try {
//     let invoices = req.body.invoices;
//     let invoicesList = ""
//     let narration  = ""
//     if(req.body.totalReceiving>0){
//       narration = `Received ${req.body.subType}`
//     }else{
//       narration = `Paid ${req.body.subType}`
//     }
//     if(req.body.advance){
//       if(req.body.payType == 'Recievable'){
//         narration = `Received ${req.body.subType}`
//       }else{
//         narration = `Paid ${req.body.subType}`
//       }
//     }
//     narration = req.body.checkNo?narration+" "+req.body.checkNo:narration
//     narration = req.body.checkDate?narration+", Date: "+moment(req.body.checkDate).format('YYYY-MM-DD'):narration
//     let i = 0
//     for(let x of invoices){
//       if(x.receiving!=0){
//         if(!req.body.edit){
//           if(x.payType=="Recievable"){
//             const updateInvoice = await Invoice.update(
//               {
//                 recieved: literal(`CAST("recieved" AS numeric) + ${x.receiving}`), // Cast `recieved` to numeric, then add
//                 status: "1",
//               },
//               { where: { id: x.id }, transaction: t }
//             );
            
//           }else{
//             const updateInvoice = await Invoice.update(
//               {
//                 paid: literal(`CAST("paid" AS numeric) + ${x.receiving}`), // Cast `recieved` to numeric, then add
//                 status: "1",
//               },
//               { where: { id: x.id }, transaction: t }
//             );

//           }
//         }else{
//           if(x.payType=="Recievable"){
//             const updateInvoice = await Invoice.update(
//               {
//                 recieved: x.receiving, // Cast `recieved` to numeric, then add
//                 status: "1",
//               },
//               { where: { id: x.id }, transaction: t }
//             );
            
//           }else{

//             const updateInvoice = await Invoice.update(
//               {
//                 paid: x.receiving, // Cast `recieved` to numeric, then add
//                 status: "1",
//               },
//               { where: { id: x.id }, transaction: t }
//             );
//           }
//         }
//         invoicesList += `${x.id},`
//         if(i == 0){
//           narration = `${narration}, Against`
//           x.SE_Job?.Bl?.hbl?narration = `${narration}, HBL# ${x.SE_Job?.Bl?.hbl}`:null
//           x.SE_Job?.Bl?.mbl?narration = `${narration}, MBL# ${x.SE_Job?.Bl?.mbl}`:null
//         }
//         narration = `${narration}, Invoice# ${x.invoice_No}`
//         if(i == invoices.length-1){
//           narration = `${narration}, Job# ${x.SE_Job?.jobNo}`
//           narration = `${narration}, For ${x.party_Name}`
//         }
//       }
//       i++
//     }
//     let vID = req.body.voucherId
//     let vouchers
//     if(!req.body.edit){
//       console.log(req.body.transactionMode, req.body.payType)
//       let temp
//       if(req.body.partyType != 'agent' ){
//         if(req.body.transactionMode=="Cash"){
//           if(req.body.payType=="Recievable"){
//             temp = "CRV"
//           }else{
//             temp = "CPV"
//           }
//         }else if(req.body.transactionMode=="Bank"){
//           if(req.body.payType=="Recievable"){
//             temp = "BRV"
//           }else{
//             temp = "BPV"
//           }
//         }else if(req.body.transactionMode=="Adjust"){
//           if(req.body.payType=="Recievable"){
//             temp = "ADJ-R"
//           }else{
//             temp = "ADJ-P"
//           }
//         }
//       }else{
//         if(req.body.transactionMode=="Cash"){
//           temp = 'C'
//         }else if(req.body.transactionMode=="Bank"){
//           temp = 'B'
//         }else if(req.body.transactionMode=="Adjust"){
//           temp = 'ADJ-'
//         }
//         req.body.transactions.forEach(x=>{
//           if(x.accountType=="payAccount"){
//             x.credit != 0? temp += "P" : temp += "R"
//           }
          
//         })
//         if(req.body.transactionMode!="Adjust"){
//           temp += "V"
//         }
//       }
//       let v = {
//         type: `Job ${req.body.payType=="Recievable"?"Reciept":"Payment"}`,
//         vType: temp,
//         currency: req.body.currency,
//         exRate: req.body.exRate,
//         chequeNo: req.body.checkNo,
//         chequeDate: req.body.checkDate,
//         costCenter: 'KHI',
//         invoices: invoicesList,
//         onAccount: req.body.type,
//         partyId: req.body.partyId,
//         partyName: req.body.partyName,
//         partyType: req.body.partyType,
//         tranDate: req.body.tranDate,
//         subType: req.body.subType,
//         CompanyId: req.body.companyId,
//         voucherNarration: req.body.narration==""?narration:req.body.narration,
//         createdAt: req.body.tranDate
//       }
//       console.log(v.vType)
//       const lastVoucher = await Vouchers.findOne({
//         where: {
//           vType: v.vType,
//           CompanyId: v.CompanyId,
//         },
//         order: [["voucher_No", "DESC"]],
//       })
//       if(lastVoucher==null){
//         v.voucher_No = 1
//         v.voucher_Id = `${v.CompanyId == 1 ? "SNS" : v.CompanyId == 2 ? "CLS" : "ACS"}-${v.vType}-${v.voucher_No}/${await getActiveFiscalYearSuffix()}`
//       }else{
//         v.voucher_No = lastVoucher.voucher_No + 1
//         v.voucher_Id = `${v.CompanyId == 1 ? "SNS" : v.CompanyId == 2 ? "CLS" : "ACS"}-${v.vType}-${v.voucher_No}/${await getActiveFiscalYearSuffix()}`
//       }
//       vouchers = await Vouchers.create(
//         v,
//         {
//           transaction: t
//         }
//       )
//       vID = vouchers.id
//     }else{
//       console.log(narration)
//       const vouchers = await Vouchers.update(
//         { invoices: invoicesList,
//           voucherNarration: narration
//          }, // Data to update
//         { where: { id: vID }, transaction: t }      // Query options
//       );
//       await Voucher_Heads.destroy({
//         where:{
//           VoucherId: vID
//         },
//         transaction: t
//       })
//     }
//     let account
//     account = await Client_Associations.findOne({
//       where: { ClientId: req.body.partyId }
//     })
    
//     for(let x of req.body.transactions){
//       let amount = 0.0
//       if(x.type=='credit'){
//         amount = x.credit
//       }else {
//         amount = x.debit
//       }
//       if(x.accountName!="Total"){
//         if(x.accountType=='partyAccount'){
//           await Voucher_Heads.create(
//             {
//               amount: amount,
//               defaultAmount: x.currency=="PKR"?amount:amount*req.body.exRate,
//               type: x.type,
//               accountType: x.accountType,
//               VoucherId: vID,
//               ChildAccountId: account.ChildAccountId,
//               narration: narration,
//               createdAt: req.body.tranDate
//             }, {
//               transaction: t
//             }
//           )
//         }else{
//           if(x.partyId == req.body.partyId){
//             await Voucher_Heads.create(
//               {
//                 amount: amount,
//                 defaultAmount: x.currency=="PKR"?amount:amount*req.body.exRate,
//                 type: x.type,
//                 accountType: x.accountType,
//                 VoucherId: vID,
//                 ChildAccountId: account.ChildAccountId,
//                 narration: req.body.narration==""?narration:req.body.narration,
//                 createdAt: req.body.tranDate
//               },
//               {
//                 transaction: t
//               }
//             )
//           }else{
//             await Voucher_Heads.create(
//               {
//                 amount: amount,
//                 defaultAmount: x.currency=="PKR"?amount:amount*req.body.exRate,
//                 type: x.type,
//                 accountType: x.accountType,
//                 VoucherId: vID,
//                 ChildAccountId: x.partyId,
//                 narration: req.body.narration==""?narration:req.body.narration,
//                 createdAt: req.body.tranDate
//               },
//               {
//                 transaction: t
//               }
//             )
//           }
//         }
//     }
//     }
//     for(let x of invoices){
//       if(!req.body.edit){
//         if(x.receiving!=0){
//           let a = await Invoice_Transactions.create(
//             {
//               gainLoss: req.body.gainLoss,
//               amount: x.receiving,
//               InvoiceId: x.id,
//               VoucherId: vID
              
//             },
//             {
//               transaction: t
//             }
//           )
//         }
//       }else{
//         let a = await Invoice_Transactions.destroy({
//           where: {
//             InvoiceId: x.id,
//             VoucherId: vID
//           },
//           transaction: t
//         })
//         if(x.receiving!=0){
//           let b = await Invoice_Transactions.create(
//             {
//               gainLoss: req.body.gainLoss,
//               amount: x.receiving,
//               InvoiceId: x.id,
//               VoucherId: vID
              
//             },
//             {
//               transaction: t
//             }
//           )
//         }
//       }
//     }
//     await t.commit();
//     createHistory(req.body.employeeId, 'Transaction', 'Create', vouchers.voucher_No);
//     res.json({status:'success', result: vouchers});
//   }
//   catch (error) {
//     await t.rollback();
//     console.log(error)
//     res.status(500).json({status:'error', result: error.message || error });
//   }
// });

routes.post("/makeTransaction", async (req, res) => {
  const transactionLines = (req.body.transactions || []).filter((x) => x.accountName !== "Total");
  const totalDebit = transactionLines.reduce((sum, x) => sum + (parseFloat(x.debit) || 0), 0);
  const totalCredit = transactionLines.reduce((sum, x) => sum + (parseFloat(x.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    return res.json({
      status: 'error',
      result: `Transaction is unbalanced: total debit ${totalDebit.toFixed(2)} does not equal total credit ${totalCredit.toFixed(2)}`,
    });
  }

  // Every amount that will be settled must be a real number, checked BEFORE
  // anything is written. They reach SQL below through literal(), which does no
  // escaping of its own: the value was pasted straight into the UPDATE, so any
  // logged-in user could send a "receiving" that ran SQL of their choosing.
  const badInvoice = (req.body.invoices || []).find(
    (x) => x.receiving !== 0 && !Number.isFinite(Number(x.receiving))
  );
  if (badInvoice) {
    return res.status(400).json({
      status: 'error',
      result: `Invalid amount for invoice ${badInvoice.invoice_No || badInvoice.id}.`,
    });
  }

  // A payment or receipt whose cheque came back stays as it was posted.
  if (req.body.edit) {
    const returned = returnedRefusal(await returnOf(req.body.voucherId));
    if (returned) return res.status(400).json({ status: 'error', result: returned });
  }

  // Cash has no cheque - not on the voucher, not in its narration. See
  // functions/cashCheque. An edit clears one an earlier save stored.
  if (req.body.transactionMode === "Cash") {
    const { chequeNo, chequeDate } = noCheque();
    Object.assign(req.body, { checkNo: chequeNo, checkDate: chequeDate });
  }

  let fiscalYear;
  try {
    fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId);
  } catch (e) {
    return res.status(500).json({status:'error', result: e.message });
  }

  const t = await sequelize.transaction();

  try {
    const invoices = req.body.invoices;
    let invoicesList = "";
    let narration = "";
    // The picked date, read strictly - a 'DD-MM-YYYY' one is taken day first,
    // where `new Date()` took it month-first. See functions/voucherDate.
    const postedAt = ledgerDateOf(req.body.tranDate);

    // Base narration
    if (req.body.totalReceiving > 0) {
      narration = `Received ${req.body.subType}`;
    } else {
      narration = `Paid ${req.body.subType}`;
    }

    if (req.body.advance) {
      narration =
        req.body.payType === "Recievable"
          ? `Received ${req.body.subType}`
          : `Paid ${req.body.subType}`;
    }

    if (req.body.checkNo) {
      narration += ` ${req.body.checkNo}`;
    }

    if (req.body.checkDate) {
      narration += `, Date: ${moment(req.body.checkDate).format("YYYY-MM-DD")}`;
    }

    // =========================
    // Invoice Updates
    // =========================
    // On an edit, what this voucher already carried against each invoice -
    // read before its settlement rows are replaced below. An edit adds the
    // difference; it used to SET received / paid to its own share, wiping
    // every other receipt's (functions/receiptEdit).
    const prior = req.body.edit
      ? await priorShares(Invoice_Transactions, req.body.voucherId, t)
      : new Map();
    for (let i = 0; i < invoices.length; i++) {
      const x = invoices[i];
      const change = settlementChange(x.receiving, prior.get(String(x.id)));

      // Taken off an edited receipt (0 now, something before): it gives back
      // what the receipt had paid on the invoice.
      if (x.receiving !== 0 || change !== 0) {
        const column = x.payType === "Recievable" ? "recieved" : "paid";
        await Invoice.update(
          {
            // Escaped as well as validated above: the check is what makes it
            // a number, escape() is what keeps it one if the check is ever
            // loosened. To the paisa: a knock-off's last share is whatever
            // floating point left over (1234.5599999999999), and stored as it
            // came it kept a fully paid invoice open by a hair.
            [column]: literal(`ROUND(COALESCE(CAST("${column}" AS numeric), 0) + ${sequelize.escape(change)}, 2)`),
            status: "1"
          },
          { where: { id: x.id }, transaction: t }
        );
      }

      if (x.receiving !== 0) {
        invoicesList += `${x.id},`;

        if (i === 0) {
          narration += ", Against";
          if (x.SE_Job?.Bl?.hbl) narration += `, HBL# ${x.SE_Job.Bl.hbl}`;
          if (x.SE_Job?.Bl?.mbl) narration += `, MBL# ${x.SE_Job.Bl.mbl}`;
        }

        narration += `, Invoice# ${x.invoice_No}`;

        if (i === invoices.length - 1) {
          narration += `, Job# ${x.SE_Job?.jobNo}`;
          narration += `, For ${x.party_Name}`;
        }
      }
    }

    // =========================
    // Voucher Creation / Update
    // =========================
    let vID = req.body.voucherId;
    let vouchers;
    // What the screen's narration box held - or, left empty, the one built
    // above. The voucher and every one of its lines carry the same text.
    const voucherNarration = req.body.narration === "" ? narration : req.body.narration;

    if (!req.body.edit) {
      let temp = "";

      if (req.body.partyType !== "agent") {
        if (req.body.transactionMode === "Cash") {
          temp = req.body.payType === "Recievable" ? "CRV" : "CPV";
        } else if (req.body.transactionMode === "Bank") {
          temp = req.body.payType === "Recievable" ? "BRV" : "BPV";
        } else if (req.body.transactionMode === "Adjust") {
          temp = req.body.payType === "Recievable" ? "ADJ-R" : "ADJ-P";
        }
      } else {
        if (req.body.transactionMode === "Cash") temp = "C";
        else if (req.body.transactionMode === "Bank") temp = "B";
        else if (req.body.transactionMode === "Adjust") temp = "ADJ-";

        req.body.transactions.forEach(x => {
          if (x.accountType === "payAccount") {
            temp += x.credit !== 0 ? "P" : "R";
          }
        });

        if (req.body.transactionMode !== "Adjust") {
          temp += "V";
        }
      }

      const v = {
        type: `Job ${req.body.payType === "Recievable" ? "Reciept" : "Payment"}`,
        vType: temp,
        currency: req.body.currency,
        exRate: req.body.exRate,
        chequeNo: req.body.checkNo,
        chequeDate: req.body.checkDate,
        costCenter: "KHI",
        invoices: invoicesList,
        onAccount: req.body.type,
        partyId: req.body.partyId,
        partyName: req.body.partyName,
        partyType: req.body.partyType,
        tranDate: pickedDate(req.body.tranDate) ? postedAt.toISOString() : req.body.tranDate,
        subType: req.body.subType,
        CompanyId: req.body.companyId,
        voucherNarration,
        createdAt: postedAt
      };

      const yearSuffix = fiscalYear.suffix;
      v.voucher_No = await nextVoucherNo(Vouchers, {
        vType: v.vType,
        CompanyId: v.CompanyId,
        suffix: yearSuffix,
        transaction: t,
      });

      // Laid out by Config > Document Numbers like every other voucher. This
      // one was a template literal that ignored the order setting.
      v.voucher_Id = voucherId(await readNumbering(), {
        vType: v.vType,
        company: await companyShort(v.CompanyId),
        seq: v.voucher_No,
        suffix: yearSuffix,
      });
      v.FiscalYearId = fiscalYear.id;

      vouchers = await Vouchers.create(v, { transaction: t });
      vID = vouchers.id;
    } else {
      /* AN EDIT SAVES THE VOUCHER WITH ITS LINES. It used to rewrite only the
       * lines: the rate, currency and cheque stayed as first entered, and the
       * header got the automatic narration while the typed one went to the
       * lines. The Payments & Receipts screen reads the header and the ledger
       * reads the lines, so the two disagreed. ACS-ADJ-P-38/27 was re-saved at
       * 334.44 with "LDP PAID TO TCI..." and still opened at 328 with "Paid
       * Cheque ADJUSTMENT...". An edit that moved the date moves the voucher
       * with its lines. */
      const header = { invoices: invoicesList, voucherNarration };
      for (const [field, value] of [
        ['currency', req.body.currency], ['exRate', req.body.exRate], ['subType', req.body.subType],
        ['chequeNo', req.body.checkNo], ['chequeDate', req.body.checkDate],
      ]) {
        if (value !== undefined) header[field] = value;
      }
      if (pickedDate(req.body.tranDate)) Object.assign(header, { tranDate: postedAt.toISOString(), createdAt: postedAt });
      await Vouchers.update(header, { where: { id: vID }, transaction: t });
      // For the history line below - an edit has no new voucher to name.
      vouchers = await Vouchers.findByPk(vID, { attributes: ['id', 'voucher_No'], transaction: t });

      await Voucher_Heads.destroy({
        where: { VoucherId: vID },
        transaction: t
      });
    }

    // =========================
    // Voucher Heads
    // =========================
    const account = await Client_Associations.findOne({
      where: { ClientId: req.body.partyId }
    });

    // The party's own lines by the screen's mark, not by an id that a bank
    // account can share with the party - functions/paymentLines.
    const marked = marksParty(req.body.transactions);
    for (const x of req.body.transactions) {
      if (x.accountName === "Total") continue;

      const amount = x.type === "credit" ? x.credit : x.debit;
      const defaultAmount =
        x.currency === "PKR" ? amount : amount * req.body.exRate;

      await Voucher_Heads.create(
        {
          amount,
          defaultAmount,
          type: x.type,
          accountType: x.accountType,
          VoucherId: vID,
          ChildAccountId: lineAccountId(x, {
            partyId: req.body.partyId, partyAccountId: account.ChildAccountId, marked,
          }),
          narration: voucherNarration,
          createdAt: postedAt
        },
        { transaction: t }
      );
    }

    // =========================
    // Invoice Transactions
    // =========================
    for (const x of invoices) {
      if (req.body.edit) {
        await Invoice_Transactions.destroy({
          where: { InvoiceId: x.id, VoucherId: vID },
          transaction: t
        });
      }

      if (x.receiving !== 0) {
        await Invoice_Transactions.create(
          {
            gainLoss: req.body.gainLoss,
            amount: x.receiving,
            InvoiceId: x.id,
            VoucherId: vID
          },
          { transaction: t }
        );
      }
    }

    await t.commit();
    // An edit was logged as a Create with no number - four of them for
    // ACS-ADJ-P-38/27 on 2026-10-07, none saying which voucher.
    await createHistory(req.body.employeeId, "Transaction", req.body.edit ? "Edit" : "Create", vouchers?.voucher_No);

    res.json({ status: "success", result: vouchers });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({status:"error", result: error.message || error });
  }
});
``

/* SETTLE AN ADVANCE: knock invoices off against a payment or receipt that is
 * already posted, without touching the voucher - functions/advanceSettlement.
 *
 *   body: { voucherId, invoices: [{ id, receiving }], employeeId }
 *
 * `receiving` is the share wanted FROM THIS VOUCHER on that invoice; 0 takes
 * it off. Invoices not named keep whatever this voucher settled on them. Only
 * the knock-offs change, with each invoice's received / paid by the
 * difference, and the voucher's list of the invoices it settles (which is
 * what reopening it shows). */
routes.post("/settleTransaction", async (req, res) => {
  const voucherId = req.body.voucherId;
  const requested = Array.isArray(req.body.invoices) ? req.body.invoices : [];
  const voucher = voucherId ? await Vouchers.findByPk(voucherId, {
    include: [{ model: Voucher_Heads, attributes: ['type', 'amount', 'accountType', 'ChildAccountId'] }],
  }) : null;
  if (!voucher || !['Job Reciept', 'Job Payment'].includes(voucher.type)) {
    return res.status(400).json({ status: 'error', result: 'Open a payment or receipt to settle invoices against it.' });
  }
  const returned = returnedRefusal(await returnOf(voucher.id));
  if (returned) return res.status(400).json({ status: 'error', result: returned });

  const t = await sequelize.transaction();
  try {
    const prior = await priorShares(Invoice_Transactions, voucher.id, t);
    const ids = [...new Set([...prior.keys(), ...requested.map((r) => String(r?.id ?? ''))])].filter(Boolean);
    const rows = ids.length ? await Invoice.findAll({
      where: { id: ids },
      attributes: ['id', 'invoice_No', 'payType', 'currency', 'total', 'roundOff', 'recieved', 'paid', 'party_Id', 'party_Name'],
      transaction: t,
    }) : [];

    /* Whose invoices this voucher may settle: those of the party it was made
     * for - its party line's account, which is what an invoice raised here
     * carries in party_Id; or that party's Clients id together with its name,
     * which is what an invoice migrated without a single account carries
     * (see partyInvoiceWhere in routes/invoice). */
    const accounts = new Set(voucher.Voucher_Heads
      .filter((h) => h.accountType === 'partyAccount').map((h) => String(h.ChildAccountId)));
    const links = accounts.size ? await Client_Associations.findAll({
      where: { ChildAccountId: [...accounts] }, attributes: ['ClientId'], transaction: t,
    }) : [];
    const clients = links.length ? await Clients.findAll({
      where: { id: [...new Set(links.map((l) => l.ClientId))] }, attributes: ['id', 'name'], transaction: t,
    }) : [];
    const ownParty = (inv) => accounts.has(String(inv.party_Id))
      || clients.some((c) => String(c.id) === String(inv.party_Id) && c.name === inv.party_Name);

    // What is settled on each: its knock-offs added up - every voucher's, this
    // one's included - not the received figure an edit used to overwrite.
    const knocks = ids.length ? await Invoice_Transactions.findAll({
      where: { InvoiceId: ids }, attributes: ['InvoiceId', 'amount'], transaction: t,
    }) : [];
    const knockedOff = new Map();
    knocks.forEach((k) => knockedOff.set(String(k.InvoiceId), (knockedOff.get(String(k.InvoiceId)) || 0) + Number(k.amount || 0)));
    const invoices = new Map(rows.map((r) => [String(r.id), {
      ...r.get({ plain: true }),
      ownParty: ownParty(r),
      ...(knockedOff.has(String(r.id)) ? { knockedOff: knockedOff.get(String(r.id)) } : {}),
    }]));
    const plan = planSettlement({
      voucher: { voucher_Id: voucher.voucher_Id, currency: voucher.currency, amount: partyAmount(voucher.Voucher_Heads) },
      prior, requested, invoices,
    });
    if (plan.error) {
      await t.rollback();
      return res.status(400).json({ status: 'error', result: plan.error });
    }

    for (const c of plan.changes) {
      await Invoice.update(
        // A string column - see makeTransaction; escaped, to the paisa.
        { [c.column]: literal(`ROUND(COALESCE(CAST("${c.column}" AS numeric), 0) + ${sequelize.escape(c.change)}, 2)`), status: '1' },
        { where: { id: c.id }, transaction: t }
      );
      await Invoice_Transactions.destroy({ where: { InvoiceId: c.id, VoucherId: voucher.id }, transaction: t });
      if (c.share > 0) {
        await Invoice_Transactions.create({ amount: c.share, gainLoss: 0, InvoiceId: c.id, VoucherId: voucher.id }, { transaction: t });
      }
    }

    // What reopening the voucher lists: every invoice it settles now.
    const settles = await Invoice_Transactions.findAll({
      where: { VoucherId: voucher.id }, attributes: ['InvoiceId'], transaction: t,
    });
    const list = [...new Set(settles.map((s) => String(s.InvoiceId)))];
    await Vouchers.update(
      { invoices: list.length ? `${list.join(',')},` : '' },
      { where: { id: voucher.id }, transaction: t }
    );

    await t.commit();
    await createHistory(req.body.employeeId, 'Transaction', 'Settle', voucher.voucher_No);
    res.json({ status: 'success', result: { voucherId: voucher.id, applied: plan.applied, left: plan.left } });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post("/createVoucher", async(req, res) => {
  try{
    // console.log("Create Voucher>>", req.body)
    let voucher_Heads = req.body.Voucher_Heads
    const balance = getVoucherBalance(voucher_Heads);
    if (!balance.balanced) {
      return res.json({
        status: 'error',
        result: `Voucher is unbalanced: total debit ${balance.totalDebit.toFixed(2)} does not equal total credit ${balance.totalCredit.toFixed(2)}`,
      });
    }
    const fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId);
    const numbering = await readNumbering();
    req.body.voucher_No = await nextVoucherNo(Vouchers, {
      vType: req.body.vType,
      CompanyId: req.body.CompanyId,
      suffix: fiscalYear.suffix,
      settings: numbering,
    });
    req.body.voucher_Id = voucherId(numbering, {
      vType: req.body.vType,
      company: await companyShort(req.body.CompanyId),
      seq: req.body.voucher_No,
      suffix: fiscalYear.suffix,
    });
    req.body.FiscalYearId = fiscalYear.id
    // A CPV / CRV has no cheque - see functions/cashCheque.
    if (isCashVoucher(req.body.vType)) Object.assign(req.body, noCheque())
    const result = await Vouchers.create(req.body)
    for(let x of voucher_Heads){
      x.VoucherId = result.id
      await Voucher_Heads.create(x)
    }
    createHistory(req.body.employeeId, 'Voucher', 'Create', result.voucher_No);
    res.json({status:'success', result: result});
  }catch(e){
    console.log(e)
    res.status(500).json({status:'error', result: e.message || e });
  }
})

routes.post("/updateVoucher", async (req, res) => {
  try {
    const { id: voucherId } = req.body;

    // Only the Voucher screen's own vouchers - one another record made is
    // changed there (functions/voucherSource).
    const stored = await Vouchers.findOne({ where: { id: voucherId } });
    if (!stored) return res.status(404).json({ status: 'error', result: 'That voucher no longer exists.' });
    const source = await voucherSource(stored, db);
    if (source) return res.status(409).json({ status: 'error', result: refusalFor(stored, source, 'Change'), source });

    const balance = getVoucherBalance(req.body.Voucher_Heads);
    if (!balance.balanced) {
      return res.json({
        status: 'error',
        result: `Voucher is unbalanced: total debit ${balance.totalDebit.toFixed(2)} does not equal total credit ${balance.totalCredit.toFixed(2)}`,
      });
    }

    // A CPV / CRV has no cheque - see functions/cashCheque. Re-saving one
    // clears the date an earlier save stored.
    if (isCashVoucher(req.body.vType)) Object.assign(req.body, noCheque());
    const result = await Vouchers.upsert(req.body);

    const incomingHeads = req.body.Voucher_Heads.map(head => ({
      ...head,
      VoucherId: voucherId,
    }));

    const incomingIds = [];

    for (let head of incomingHeads) {
      const upserted = await Voucher_Heads.upsert(head);
      if (head.id) {
        incomingIds.push(head.id);
      } else if (upserted[0]?.id) {
        incomingIds.push(upserted[0].id);
      }
    }

    await Voucher_Heads.destroy({
      where: {
        VoucherId: voucherId,
        ...(incomingIds.length > 0 && {
          id: { [Op.notIn]: incomingIds }
        }),
      },
    });
    const res1 = await Vouchers.findOne({
      where: {id: voucherId}
    })
    createHistory(req.body.employeeId, 'Voucher', 'Edit', res1.voucher_No);
    res.json({ status: 'success', result });
  } catch (e) {
    console.error("Error in updateVoucher:", e);
    res.status(500).json({status:'error', result: e.message || e });
  }
});


routes.get("/getExRateVouchers", async(req, res) => {
  try{
    const Charges = await Voucher_Heads.update(
      {
        accountType: "Charges Account",
      },
      {
        where: {
          ChildAccountId: { [Op.or]: ['55690', '57542'] }
        }
      }
    );
    const CV = await Voucher_Heads.update(
      {
        accountType: "partyAccount",
      },
      {
        where: {
          accountType: { [Op.or]: ['client', 'vendor', 'agent'] }
        }
      }
    );
    const BC = await Voucher_Heads.update(
      {
        accountType: "payAccount",
      },
      {
        where: {
          accountType: { [Op.or]: ['Bank'] }
        }
      }
    );
    res.json({status:'success'});
  }catch(e){
    console.log(e)
    res.status(500).json({status:'error', result: e.message || e });
  }
})

/**
 * Legacy job tables the invoice/bill header can point at, in the order we check
 * them. Each legacy job type is its own table with its own identity sequence,
 * so a climaxId is only unique WITHIN an operation - 'SEJobId = 4210' and
 * 'AEJobId = 4210' are two different jobs. Odyssey keeps them all in SE_Job and
 * tells them apart by `operation`, so the lookup key is the pair.
 */
const LEGACY_JOB_COLUMNS = [
  ['SEJobId', 'SE'],
  ['SIJobId', 'SI'],
  ['AEJobId', 'AE'],
  ['AIJobId', 'AI'],
  ['LGJobId', 'LG'],
];

/**
 * Foreign key names on Invoice_Transactions, resolved from the model rather
 * than assumed. routes/invoice/index.js already has to test both spellings
 * when it reads these rows, so writing them under a guessed name would produce
 * rows the read path silently cannot find.
 */
const TX_INVOICE_FK = ['invoiceId', 'InvoiceId'].find((k) => Invoice_Transactions.rawAttributes[k]) || 'InvoiceId';
const TX_VOUCHER_FK = ['voucherId', 'VoucherId'].find((k) => Invoice_Transactions.rawAttributes[k]) || 'VoucherId';

/** (operation, legacy id) -> SE_Job.id, built once per import request. */
async function buildJobIndex() {
  const jobs = await SE_Job.findAll({
    attributes: ['id', 'climaxId', 'operation'],
    where: { climaxId: { [Op.ne]: null } },
    raw: true,
  });
  const index = new Map();
  for (const j of jobs) index.set(`${j.operation}:${j.climaxId}`, j.id);
  return index;
}

/** Which Odyssey job an invoice belongs to, via the legacy invoice/bill header. */
function resolveJobId(I, jobIndex) {
  const header = I.GL_JobInvoice || I.GL_JobBill;
  if (!header) return null;
  for (const [column, operation] of LEGACY_JOB_COLUMNS) {
    const legacyId = header[column];
    if (legacyId == null) continue;
    const found = jobIndex.get(`${operation}:${legacyId}`);
    if (found) return found;
  }
  return null;
}

/**
 * The jobs a Direct Job E/R line can be attached to, for THIS install.
 *
 *   GET /voucher/getDirectJobNumbers?page=1&limit=10&search=
 *   GET /voucher/getDirectJobNumbers?search=CCJ-1/27&exact=1   (the job box)
 *
 * Replaces the screen's call to /seaJob/getJobNumbers, which reads SE_Job and
 * SE_Job only. Under aviation and customs that table is empty, so the picker
 * came back with nothing and there was no job an expense or revenue could be
 * attached to - the screen was reachable in all three modes and worked in one.
 *
 * THE COLUMNS COME BACK WITH THE ROWS. 'HBL' and 'Consignee' mean nothing on a
 * flight, so each mode names its own five headings and maps its jobs onto
 * them (see functions/directJobJobSource). The screen renders what it is given
 * and has no per-mode branch of its own - which is what stops the headings and
 * the rows drifting apart the next time a mode is added.
 *
 * The response keeps the shape the screen already reads - `data` and
 * `pagination.totalRecords` - so only the URL and the headings changed.
 */
routes.get("/getDirectJobNumbers", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = String(req.query.search || "").trim();
    const offset = (page - 1) * limit;
    // The job box's lookup - see jobQueryFor. Nothing typed is no job, not
    // every job.
    const exact = ['1', 'true'].includes(String(req.query.exact || '').toLowerCase());

    const mode = await readOperationMode();
    const src = directJobJobSource.sourceFor(mode);
    const model = JOB_MODELS[src.mode];

    if (exact && !search) {
      return res.json({
        status: "success", mode: src.mode, label: src.label, columns: src.columns, data: [],
        pagination: { totalRecords: 0, currentPage: 1, totalPages: 0 },
      });
    }

    const q = jobQueryFor(src.mode, search, exact);
    // Customs: which number is a line's File # - Configuration > Customs >
    // Job Screen (functions/customsJobForm).
    const rowOptions = src.mode === directJobJobSource.CUSTOMS
      ? { fileFromRef: Boolean((await readCustomsJobForm(db)).directJobFileFromRef) }
      : {};

    const { rows, count } = await model.findAndCountAll({
      attributes: q.attributes,
      where: q.where,
      include: q.include,
      // One row per job even when an include fans out, and a count that agrees
      // with it - the freight query has always needed this and the other two
      // join the same way.
      distinct: true,
      limit,
      offset,
      order: [["id", "DESC"]]
    });

    res.json({
      status: "success",
      mode: src.mode,
      label: src.label,
      columns: src.columns,
      // Flattened through the mode's own mapper, so the screen reads the same
      // five keys whichever table the rows came out of.
      data: rows.map((r) => directJobJobSource.rowFor(src.mode, r.get({ plain: true }), rowOptions)),
      pagination: {
        totalRecords: count,
        currentPage: page,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: "error", error: e.message });
  }
});

/* THE DIRECT JOB LIST - one page of entries, with only what the list shows.
 *
 * It used to be one findAndCountAll joining every line's job, voucher and
 * voucher heads. Two costs came with that (CargoLinkers, 2026-11-12: 13k
 * pages, ~30 s to open):
 *
 *   - THE COUNT counted joined rows, not entries: Sequelize counts
 *     Direct_Job.id across the includes unless told `distinct`, so an entry
 *     with 13 lines and a two-head voucher counted 26 times. CL's 10-08 copy:
 *     1,770 entries, pager told 49,630 - every page past 177 was blank. The
 *     search narrows Direct_Jobs through subqueries (functions/directJobSearch),
 *     so the count needs no join.
 *   - THE PAGE carried each line's whole Customs_Job row and its voucher with
 *     every head - 0.4-1 MB for ten entries - none of which the list reads.
 *     It reads the line's STORED Job_No and Amount, and the voucher's number,
 *     date and who made it (functions/directJobEntry entryDateOf).
 *
 * The lines come in a second query (separate) for just this page's entries,
 * and the account title rides along (accountTitle), so the screen no longer
 * loads the whole chart of accounts to show ten names. id breaks ties
 * in the order: migrated entries share an updatedAt, and without it an offset
 * can show one entry on two pages and another on none. */
routes.get("/getDirectJobList", async (req, res) => {
  try {
    let { page = 1, pageSize = 10, search = "" } = req.query;

    page = Math.max(1, Math.floor(Number(page)) || 1);
    pageSize = Math.min(100, Math.max(1, Math.floor(Number(pageSize)) || 10));
    search = typeof search === "string" ? search : "";

    const offset = (page - 1) * pageSize;
    const limit = pageSize;

    // Every value the list shows, matched as the list shows it - see
    // functions/directJobSearch. (It used to cover five columns, and ILIKE on
    // the Type enum without a cast made every search answer 500.)
    const where = directJobSearchWhere(search, sequelize);

    const [total, rows] = await Promise.all([
      Direct_Job.count({ where }),
      Direct_Job.findAll({
        where,
        include: [{
          model: Child_Account,
          as: "AccountNo",
          attributes: ["id", "title"],
          required: false,
        }, {
          model: Direct_Job_Association,
          as: "Associations",
          separate: true,
          attributes: ["id", "Direct_Job_Id", "Job_No", "Amount", "Voucher_Id"],
          order: [["id", "ASC"]],
          include: [{
            model: Vouchers,
            as: "Voucher",
            attributes: ["id", "voucher_Id", "tranDate", "createdBy"],
          }],
        }],
        limit,
        offset,
        order: [["updatedAt", "DESC"], ["id", "DESC"]],
      }),
    ]);

    res.json({
      status: "success",
      total,
      result: rows.map((r) => {
        const { AccountNo, ...entry } = r.get({ plain: true });
        return { ...entry, accountTitle: AccountNo?.title ?? null };
      }),
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ status: "error", error: e.message });
  }
});

routes.get("/getJobData", async (req, res) => {
  try {

    /* Keyed on the column THIS MODE owns, not on Job_Id.
     *
     * Job_Id is the freight column; under aviation the ids live in
     * AviationJobId. Asking for Job_Id there would match nothing - or, worse,
     * match a freight row that happened to share the number. */
    const mode = await readOperationMode();

    // A job being created has no id yet, and so no direct entries against it.
    const jobId = rowId(req.headers.id);
    if (!jobId) return res.json({ status: 'success', result: [] });

    const result = await Direct_Job_Association.findAll({
      where: directJobJobSource.ownerWhere(mode, jobId),
      include: [{
        model: Vouchers,
        as: 'Voucher',
        include: [{ model: Voucher_Heads }]
      },
      {
        model: Direct_Job,
        as: 'DirectJob'
      }
    ],
      order: [["updatedAt", "DESC"]]
    });

    res.json({
      status: "success",
      result: result
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ status: "error", error: e.message });
  }
});

routes.get("/getDirectJob", async ( req, res ) => {
  try{
    const mode = await readOperationMode();

    /* NOT AN ERROR. The screen opens a new entry at /accounts/directJob/new
     * and sends that 'new' as the id, so this is the ordinary create path -
     * there is simply no row to load yet. Answering with null lets the screen
     * fall through to its empty state instead of showing a 500. */
    const id = rowId(req.headers.id);
    if (!id) return res.json({ status: 'success', result: null });

    const result = await Direct_Job.findOne({
      where: {
        id
      },
      include: [
        {
          model: Direct_Job_Association,
          as: "Associations",
          include: [
            jobInclude(mode),
            {
              model: Vouchers,
              as: "Voucher",
              include: [{ model: Voucher_Heads }]
            }
          ]
        }
      ]
    })
    res.json({status: 'success', result: result});
  }catch(e){
    console.error("Error", e)
    res.status(500).json({ status: "error", result: e.message || e })
  }
});

routes.post("/deleteDirectJob", async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const mode = await readOperationMode();

    const deleteId = rowId(req.headers.id);
    if (!deleteId) {
      await t.rollback();
      return res.status(400).json({ status: "error", message: "A numeric id is required." });
    }

    const job = await Direct_Job.findOne({
      where: { id: deleteId },
      include: [
        {
          model: Direct_Job_Association,
          as: "Associations",
          include: [
            jobInclude(mode),
            {
              model: Vouchers,
              as: "Voucher",
              include: [{ model: Voucher_Heads }]
            }
          ]
        }
      ],
      transaction: t
    });

    if (!job) {
      await t.rollback();
      return res.status(404).json({ status: "error", message: "Job not found" });
    }

    console.log("FOUND JOB:", job.id);
    console.log("ASSOCIATIONS:", job.Associations.length);

    // 1️⃣ Delete all Direct_Job_Association rows first
    const associationIds = job.Associations.map(a => a.id);
    await Direct_Job_Association.destroy({
      where: { id: associationIds },
      transaction: t
    });

    // 2️⃣ Delete Voucher_Heads and Vouchers
    for (const a of job.Associations) {
      if (a.Voucher) {
        await Voucher_Heads.destroy({
          where: { VoucherId: a.Voucher.id },
          transaction: t
        });

        await Vouchers.destroy({
          where: { id: a.Voucher.id },
          transaction: t
        });
      }
    }

    // 3️⃣ Delete the Direct Job itself
    await Direct_Job.destroy({
      where: { id: job.id },
      transaction: t
    });

    await t.commit();

    return res.json({ status: "success" });

  } catch (e) {
    console.error("Error deleting direct job:", e);
    await t.rollback();
    createHistory(req.body.employeeId, 'Direct Job', 'Delete', result.name);
    return res.status(500).json({ status: "error", result: e.message || e });
  }
});

/**
 * ONE OF EACH CHARGE PER JOB, when the install has it on (Configuration >
 * Direct Job, asked 2026-11-17) - see functions/jobChargeRepeats. Throws a 400
 * naming each repeat and where the charge already is; does nothing when the
 * switch is off.
 *
 * Every entry against the line's job counts, on the same side only (a revenue
 * and an expense of one charge are both allowed). The entry being saved is
 * left out of "other entries", and what it already held may stay.
 *
 * directChargeRepeats answers; assertNoRepeatedDirectCharges refuses. The
 * screen asks the first as a charge is picked (/checkDirectJobCharges), so a
 * repeat is caught on the line rather than at Save.
 */
const directChargeRepeats = async (mode, direct_Job, lines, t) => {
  const none = { repeats: [], message: null };
  if (!(await readUniqueJobCharges(db))) return none;
  const type = direct_Job?.Type === 'revenue' ? 'revenue' : 'expense';
  const col = directJobJobSource.idColumnFor(mode);
  const entryId = rowId(direct_Job?.id);
  const sent = (lines || []).map((l) => ({ jobId: l?.Job_Id, charge: l?.Charge_Name, jobNo: l?.Job_No }));
  const jobIds = [...new Set(sent.map((l) => rowId(l.jobId)).filter(Boolean))];
  const charges = [...new Set(sent.map((l) => chargeKey(l.charge)).filter(Boolean))];
  if (!jobIds.length || !charges.length) return none;

  // This entry's own lines - only if it was saved on the same side.
  let before = [];
  if (entryId) {
    const saved = await Direct_Job.findByPk(entryId, { attributes: ['id', 'Type'], transaction: t });
    if (saved && saved.Type === type) {
      before = (await Direct_Job_Association.findAll({
        where: { Direct_Job_Id: entryId }, attributes: [col, 'Charge_Name'], raw: true, transaction: t,
      })).map((r) => ({ jobId: r[col], charge: r.Charge_Name }));
    }
  }
  const others = (await Direct_Job_Association.findAll({
    where: {
      [col]: jobIds,
      Charge_Name: charges,
      ...(entryId ? { Direct_Job_Id: { [Op.ne]: entryId } } : {}),
    },
    attributes: ['id', col, 'Charge_Name'],
    include: [{ model: Direct_Job, as: 'DirectJob', attributes: ['id', 'Entry_No'], where: { Type: type }, required: true }],
    transaction: t,
  })).map((r) => ({ jobId: r[col], charge: r.Charge_Name, entryNo: r.DirectJob?.Entry_No }));

  const repeats = directJobRepeats({ lines: sent, before, others });
  if (!repeats.length) return none;
  const masters = await db.Charges.findAll({
    where: { id: repeats.map((r) => parseInt(r.charge, 10)).filter(Number.isFinite) },
    attributes: ['id', 'name', 'short'], transaction: t,
  });
  const names = Object.fromEntries(masters.map((m) => [String(m.id), m.name || m.short]));
  return { repeats, message: directJobRepeatsMessage(repeats, type, names) };
};

const assertNoRepeatedDirectCharges = async (mode, direct_Job, lines, t) => {
  const { message } = await directChargeRepeats(mode, direct_Job, lines, t);
  if (!message) return;
  const err = new Error(message);
  err.status = 400;
  throw err;
};

/* WOULD THESE LINES REPEAT A CHARGE? - the Direct Job screen asks as a charge
 * is picked, with the whole entry, and gets the same answer a Save would.
 * Nothing when the install's switch is off. */
routes.post("/checkDirectJobCharges", async (req, res) => {
  try {
    const { direct_Job, direct_Job_Association } = req.body || {};
    const mode = await readOperationMode();
    const result = await directChargeRepeats(mode, direct_Job || {}, direct_Job_Association || []);
    res.json({ status: "success", result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: "error", message: e.message });
  }
});

routes.post("/saveDirectJob", async (req, res) => {
  try {
    const { direct_Job, direct_Job_Association } = req.body;
    // The install's mode decides which job table these lines point at, and
    // which ledger bucket they post to. Read once per request.
    const mode = await readOperationMode();

    let dJob, Voucher;
    // Before anything is written: an entry with no usable mode is refused.
    const vType = directJobVType(direct_Job);
    // Cash has no cheque, on the entry or its voucher - see functions/cashCheque.
    if (isCashVoucher(vType)) Object.assign(direct_Job, { Cheque_No: '', Cheque_Date: null });
    // The entry's own date is the ledger's - see functions/voucherDate. It
    // was kept in tranDate only, so the voucher and its lines took the moment
    // of saving, and every edit (which rewrites the lines) moved them again.
    const postedAt = ledgerDateOf(direct_Job.Entry_Date);
    // A charge already on the job, on this side - refused before anything is
    // written, when the install has the switch on.
    await assertNoRepeatedDirectCharges(mode, direct_Job, direct_Job_Association);

    await sequelize.transaction(async (t) => {
      // 1️⃣ Determine if this is an update or create
      const jobId = parseInt(direct_Job.id);
      const isUpdate = !isNaN(jobId);

      if (isUpdate) {
        // 🔹 UPDATE
        dJob = await Direct_Job.findOne({ where: { id: direct_Job.id }, transaction: t });
        if (!dJob) throw new Error("Direct Job not found");

        await dJob.update(direct_Job, { transaction: t });

        Voucher = await Vouchers.findOne({ where: { id: direct_Job.Voucher_Id }, transaction: t });
        if (!Voucher) throw new Error("Voucher not found");

        // A changed mode or side - or a CN/DN from before the type was read
        // properly - moves the voucher into the right series, numbered in its
        // own fiscal year (a migrated voucher has none: the selected one).
        const renumber = keepsVoucherType(Voucher.vType, vType) ? {} : await directJobVoucherNumber(
          vType,
          Voucher.CompanyId ?? direct_Job.companyId,
          Voucher.FiscalYearId
            ? await db.FiscalYears.findByPk(Voucher.FiscalYearId, { transaction: t })
            : await resolveSelectedFiscalYear(req.body.fiscalYearId, t),
          t,
        );

        await Voucher.update({
          ...renumber,
          type: direct_Job.Type == 'revenue' ? 'Job Recievable' : 'Job Payble',
          currency: direct_Job.Currency,
          exRate: direct_Job.Ex_Rate,
          chequeNo: direct_Job.Cheque_No,
          chequeDate: direct_Job.Cheque_Date,
          voucherNarration: direct_Job.Narration,
          drawn_At: direct_Job.Drawn_At,
          partyId: direct_Job.Paid_To,
          partyName: direct_Job.Paid_Name,
          tranDate: direct_Job.Entry_Date,
          createdBy: direct_Job.Add_By,
        }, { transaction: t });

        await Vouchers.update({ createdAt: postedAt }, { where: { id: Voucher.id }, transaction: t, silent: true });

        // Remove old associations & voucher heads
        await Direct_Job_Association.destroy({ where: { Direct_Job_Id: dJob.id }, transaction: t });
        await Voucher_Heads.destroy({ where: { VoucherId: Voucher.id }, transaction: t });

      } else {
        // 🔹 CREATE

        const fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId, t);

        // Generate Entry_No
        direct_Job.Entry_No = await directJobEntryNo(direct_Job, fiscalYear, t);

        dJob = await Direct_Job.create(direct_Job, { transaction: t });

        Voucher = await Vouchers.create({
          ...await directJobVoucherNumber(vType, direct_Job.companyId, fiscalYear, t),
          type: direct_Job.Type == 'revenue' ? 'Job Recievable' : 'Job Payble',
          currency: direct_Job.Currency,
          exRate: direct_Job.Ex_Rate,
          chequeNo: direct_Job.Cheque_No,
          chequeDate: direct_Job.Cheque_Date,
          voucherNarration: direct_Job.Narration,
          drawn_At: direct_Job.Drawn_At,
          costCenter: 'KHI',
          onAccount: direct_Job.Type == 'revenue' ? 'client' : 'vendor',
          partyId: direct_Job.Paid_To,
          partyName: direct_Job.Paid_Name,
          partyType: direct_Job.Type == 'revenue' ? 'client' : 'vendor',
          tranDate: direct_Job.Entry_Date,
          createdBy: direct_Job.Add_By,
          CompanyId: direct_Job.companyId,
          FiscalYearId: fiscalYear.id,
          createdAt: postedAt,
        }, { transaction: t });
      }

      // 🔹 Create associations & voucher heads
      let amount = 0, dAmount = 0;

      for (let DA of direct_Job_Association) {
        await Direct_Job_Association.create({
          ...DA,
          // The job id goes in the column its mode owns, and the other two are
          // cleared - see functions/directJobJobSource.ownerColumns. AFTER the
          // spread, so a stale Job_Id in the payload cannot survive an edit.
          ...directJobJobSource.ownerColumns(mode, DA.Job_Id),
          Voucher_Id: Voucher.id,
          Direct_Job_Id: dJob.id,
        }, { transaction: t });

        const onAccount = await directJobAccount(mode, DA.Job_Id, direct_Job.Type, t);

        amount += direct_Job.Currency == 'PKR' ? DA.Amount * DA.Ex_Rate : DA.Amount;
        dAmount += DA.Amount * DA.Ex_Rate;

        await Voucher_Heads.create({
          defaultAmount: DA.Amount * DA.Ex_Rate,
          amount: direct_Job.Currency == 'PKR' ? DA.Amount * DA.Ex_Rate : DA.Amount,
          type: direct_Job.Type == 'revenue' ? 'credit' : 'debit',
          narration: DA.Description,
          accountType: direct_Job.Type == 'revenue' ? 'Client' : 'Vendor',
          VoucherId: Voucher.id,
          ChildAccountId: onAccount.id,
          createdAt: postedAt,
        }, { transaction: t });
      }

      // Main voucher head
      await Voucher_Heads.create({
        defaultAmount: dAmount,
        amount: amount,
        type: direct_Job.Type != 'revenue' ? 'credit' : 'debit',
        narration: direct_Job.Narration,
        accountType: direct_Job.Type != 'revenue' ? 'Client' : 'Vendor',
        VoucherId: Voucher.id,
        ChildAccountId: direct_Job.Account_No,
        createdAt: postedAt,
      }, { transaction: t });

    });
    createHistory(req.body.employeeId, 'Direct Job', 'Create', dJob.Entry_No);
    res.json({ status: "success", result: { Entry_Number: dJob.Entry_No, Voucher_Number: Voucher.voucher_Id, id: dJob.id } });

  } catch (e) {
    console.error(e);
    // `message` is what the screen shows; it showed "Something went wrong".
    res.status(e.status || 500).json({ status: "error", error: e.message, message: e.message });
  }
});


routes.post("/createDirectJob", async (req, res) => {
  try {
    // See saveDirectJob - the install's mode decides the column and the bucket.
    const mode = await readOperationMode();
    let dJob
    let Voucher
    await sequelize.transaction(async (t) => {

      const { direct_Job, direct_Job_Association } = req.body;
      // See saveDirectJob - one of each charge per job, when that is on.
      await assertNoRepeatedDirectCharges(mode, { ...direct_Job, id: null }, direct_Job_Association, t);
      const vType = directJobVType(direct_Job);
      // See saveDirectJob - cash has no cheque.
      if (isCashVoucher(vType)) Object.assign(direct_Job, { Cheque_No: '', Cheque_Date: null });
      const fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId, t);
      // See saveDirectJob - the entry's date is the ledger's.
      const postedAt = ledgerDateOf(direct_Job.Entry_Date);

      // 1️⃣ Create Direct Job
      direct_Job.Entry_No = await directJobEntryNo(direct_Job, fiscalYear, t)
      dJob = await Direct_Job.create(direct_Job, { transaction: t });

      Voucher = await Vouchers.create({
        ...await directJobVoucherNumber(vType, direct_Job.companyId, fiscalYear, t),
        type: direct_Job.Type == 'revenue' ? 'Job Recievable' : 'Job Payble',
        currency: direct_Job.Currency,
        exRate: direct_Job.Ex_Rate,
        chequeNo: direct_Job.Cheque_No,
        chequeDate: direct_Job.Cheque_Date,
        voucherNarration: direct_Job.Narration,
        drawn_At: direct_Job.Drawn_At,
        costCenter: 'KHI',
        onAccount: direct_Job.Type == 'revenue' ? 'client' : 'vendor',
        partyId: direct_Job.Paid_To,
        partyName: direct_Job.Paid_Name,
        partyType: direct_Job.Type == 'revenue' ? 'client' : 'vendor',
        tranDate: direct_Job.Entry_Date,
        createdBy: direct_Job.Add_By,
        CompanyId: direct_Job.companyId,
        FiscalYearId: fiscalYear.id,
        createdAt: postedAt,
      }, { transaction: t });

      let amount = 0
      let dAmount = 0
      for(let DA of direct_Job_Association){
        await Direct_Job_Association.create({
          ...DA,
          // See saveDirectJob above - the mode owns the column.
          ...directJobJobSource.ownerColumns(mode, DA.Job_Id),
          Voucher_Id: Voucher.id,
          Direct_Job_Id: dJob.id,
        }, { transaction: t });

        const onAccount = await directJobAccount(mode, DA.Job_Id, direct_Job.Type, t);
        amount += direct_Job.Currency == 'PKR' ? DA.Amount * DA.Ex_Rate : DA.Amount
        dAmount += DA.Amount * DA.Ex_Rate
        await Voucher_Heads.create({
          defaultAmount: DA.Amount * DA.Ex_Rate,
          amount: direct_Job.Currency == 'PKR' ? DA.Amount * DA.Ex_Rate : DA.Amount,
          type: direct_Job.Type == 'revenue' ? 'credit' : 'debit',
          narration: DA.Description,
          accountType: direct_Job.Type == 'revenue' ? 'Client' : 'Vendor',
          VoucherId: Voucher.id,
          ChildAccountId: onAccount.id,
          createdAt: postedAt,
        }, { transaction: t })
      }
      await Voucher_Heads.create({
        defaultAmount: dAmount,
        amount: amount,
        type: direct_Job.Type != 'revenue' ? 'credit' : 'debit',
        narration: direct_Job.Narration,
        accountType: direct_Job.Type != 'revenue' ? 'Client' : 'Vendor',
        VoucherId: Voucher.id,
        ChildAccountId: direct_Job.Account_No,
        createdAt: postedAt,
      }, { transaction: t })
    });

    // ✔ Only send response AFTER transaction completes
    // `result` was never defined here: the entry committed, then this threw
    // and the caller was told it had failed.
    createHistory(req.body.employeeId, 'Direct Job', 'Create', dJob.Entry_No);
    res.json({ status: "success", result: { Entry_Number: dJob.Entry_No, Voucher_Number: Voucher.voucher_Id, id: dJob.id } });

  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ status: "error", error: e.message, message: e.message });
  }
});

routes.post("/checkVoucherHeads", async (req, res) => {
  try{
    // const data = Array.isArray(req.body.records) ? req.body.records : [];
    // const result = await Vouchers.findAll({
    //   where: {

    //   }
    // })
  }catch(e){
    console.error("Error", e)
    res.status(500).json({ status: "error", result: e.message || e })
  }
})

/*
 * REMOVED: /importVouchers, /importV, /importI, /deleteVoucherHeads and
 * /importVoucherHeads.
 *
 * They were five writers for the same rows. /importVouchers and /importV both
 * created vouchers and voucher heads from the same source with different field
 * mappings; /importI created yet another voucher per invoice; /importVoucherHeads
 * wrote the heads a third time; and /deleteVoucherHeads - which despite its name
 * deleted duplicate VOUCHERS, not heads - cleaned up after them by keeping
 * whichever copy had the lowest id.
 *
 * So a voucher could be written three times and an arbitrary copy survived,
 * which meant its heads, its invoices and its settlement all linked to whichever
 * copy happened to win. That is where the unreliable linking came from.
 *
 * Replaced by /importLedger and /importSettlements in ./ledger.js, which write
 * each row exactly once in dependency order.
 */
require('./ledger').register(routes);

module.exports = routes;
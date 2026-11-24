// Customs clearance jobs: one goods declaration, and the charges against it.
//
// The job table is customs' own. CHARGES ARE NOT: a customs charge is a
// Charge_Head, the same table the freight and aviation sides use, so it is
// invoiced, posted to the ledger and printed by exactly the same code. Nothing
// here writes SE_Job or Bl, so the freight job screens are unaffected.
const { Customs_Job, Customs_Duty, Customs_Container } = require("../../functions/Associations/customsAssociations");
const { Charge_Head, Invoice } = require("../../functions/Associations/incoiceAssociations");
const { Clients, Client_Associations } = require("../../functions/Associations/clientAssociation");
const { Commodity, Ports, Airports, Charges, Job_notes } = require("../../models");
const { resolveSelectedFiscalYear } = require("../../functions/Associations/fiscalYearAssociations");
const { companyShort, isCompanyId, realCompanyId, NO_COMPANY } = require('../../functions/companyCodes');
// Job and invoice numbers, laid out by Config > Document Numbers.
const {
  readNumbering, lastInYear, nextAfter, perCompany, formatNumber, codeFor,
} = require('../../functions/documentNumber');
const { lastInvoiceInYear, invoiceNumber } = require('../../functions/invoiceNumber');
const { createHistory } = require("../../functions/history");
// A client over its credit limit cannot be put on a job - functions/creditControl.
const { assertClientAllowed } = require('../../functions/creditControl/blocks');
const { creatorsOf } = require('../../functions/recordCreators');
const { carriedStamps } = require('../../functions/auditStamps');
const { customsPolSea, loadingPortIds } = require('../../functions/customsLoadingPorts');
const { findDuplicate, duplicateMessage } = require('../../functions/customsJobUnique');
const { readCustomsJobForm } = require('../../functions/customsJobForm');
const { resolvePeriod } = require('../../functions/reportPeriods');
const { escapeLike } = require('../../functions/directJobSearch');

// A JOB'S CHARGES ARE jobCharges' (the user's request, 2026-10-10). A save
// carries the job and its charge sheet together; someone who may edit the job
// but not its charges saves the job, and the charges stay as they were.
// Refused in enforce mode, logged in audit - functions/permissions allowsPart.
const { allowsPart } = require('../../functions/permissions/middleware');
const CHARGE_EDIT = ['jobCharges:edit', 'invoices:edit'];
const { chargeRightsNeeded, holdApprovals } = require('../../functions/chargeRights');
// Since 2026-10-20 a charge LINE's approval, a line already on an invoice, and
// approving the invoices raised here each have a right of their own - see
// functions/permissions/catalog.js jobCharges / jobInvoices.
const CHARGE_APPROVE = ['jobCharges:approve', 'invoices:approve'];
const INVOICE_EDIT = ['jobInvoices:edit', 'invoices:edit'];
const INVOICE_APPROVE = ['jobInvoices:approve', 'invoices:approve'];
const requireDesignation = require("../../functions/requireDesignation");
const { hasDesignation } = requireDesignation;

/* Who may open an invoiced declaration for editing - see /unlock. The same
 * three the rest of the system trusts with the books. */
const UNLOCKERS = ['CEO', 'CFO', 'admin'];
// Charge pricing and duty arithmetic, kept out of the route so both are
// testable without a database.
const {
  chargeValues, isRealCharge, CH_PAYABLE, num, newlyApprovedReceivables,
} = require("../../functions/customsCharge");
const {
  totalDuty, dutyBreakdown, reimbursableDuty, effectiveDutyRate,
  RATE_HEADS, AMOUNT_HEADS,
} = require("../../functions/customsDuty");
// The approval + ledger posting that /invoice/approve performs. Reused rather
// than reimplemented so customs and freight invoices reach the books through
// exactly the same code. No cycle: routes/invoice pulls in the customs
// ASSOCIATIONS, not this router.
/* Direct Job E / R money against this declaration. The summary below is the
   only place on the job screen that reads it - see the endpoint's comment. */
const { Direct_Job, Direct_Job_Association } = require("../../models");
const directJobJobSource = require("../../functions/directJobJobSource");
const { readOperationMode, readCustomsStatuses } = require("../settings");
const { resolveStatus, startOf, valuesWith, labelOf } = require("../../functions/customsStatuses");
const { summariseCharges, directLineDetail, directEntryRefs } = require("../../functions/customsChargeSummary");
/* An APPROVED invoice freezes its charges; an unapproved one does not. One
   rule, shared with aviation - see the file. */
const { isInvoiceLocked } = require("../../functions/invoiceLock");
const { sheetRepeats, sheetRepeatsMessage, readUniqueJobCharges } = require("../../functions/jobChargeRepeats");
const { mayBeClient } = require("../../functions/customsClientList");
const routes = require('express').Router();
// The home page's job counters - Configuration > Dashboard Widgets.
const { requireWidget } = require('../../functions/dashboardWidgets');
const { PK_OFFSET_MINUTES } = require('../../functions/pkDay');
// The Program Book - planned jobs, numbered only when they are moved here.
// Behind Configuration > Customs > Job planning; see the file.
routes.use('/plans', require('./plans'));
const Sequelize = require('sequelize');
// Only the dashboard below needs it - the rest of this file stores dates as
// the 'YYYY-MM-DD' strings the forms send.
const moment = require('moment');
const Op = Sequelize.Op;

// The vocabularies this module accepts. Whitelisted in one place because each
// of them is something the list filters on or the report groups by - a typo
// stored as-is would quietly become its own category, and a month's figures
// would split across "Import" and "import".
const DIRECTIONS = ['Import', 'Export'];
// 'By Road' rather than 'Land', at the customer's request - it is what a
// clearing agent's paperwork calls it. See VOCABULARY_ALIASES below: the old
// word still saves, so a job filed as 'Land' before the rename does not start
// failing validation the next time somebody opens it.
const TRANSPORT_MODES = ['Sea', 'Air', 'By Road'];
const GD_TYPES = ['Home Consumption', 'Into-Bond', 'Ex-Bond', 'Export', 'Re-Export', 'Transhipment'];
const CHANNELS = ['Green', 'Yellow', 'Red', 'Blue'];
// Where the file stands - the STATUSES are Configuration > Customs' now
// (functions/customsStatuses, read per request): their names, colours and
// rules. The built-in ones are stored as 'Incomplete' / 'Complete' / 'DrayOff'
// / 'Canceled' and shown as In Process / On Vessel / DrayOff / Canceled until
// somebody renames them - a rename is a label, never a rewrite of 24,000 jobs.
// Renamed from Open / Cleared before that - see VOCABULARY_ALIASES, which
// keeps the old words, and the words on screen, saving.

// Incoterms, in the LONG spelling the legacy data uses - "FREE ON BOARD",
// not "FOB". 3,032 migrated jobs carry the first of these and 671 the third,
// and a picker whose values do not match what was migrated shows an empty box
// on every one of them.
// The delivery terms a declaration can be filed on - Incoterms, which is what
// the GD calls them and what the customs value is built up from.
//
// { value, label } PAIRS, NOT PLAIN STRINGS, and the value is exactly the
// string this list has always held. The three-letter code is what a clearing
// clerk says and writes - nobody says "cost, insurance and freight" - so the
// dropdown shows it, but changing what gets STORED would orphan every job
// already filed: the screen's dropdown has no option matching the old value,
// renders empty, and writes that emptiness back on the next save. The label is
// presentation; the value is data, and only one of them is safe to change.
const INCO_TERMS = [
  { value: 'EX WORKS',                    label: 'EXW - Ex Works' },
  { value: 'FREE CARRIER',                label: 'FCA - Free Carrier' },
  { value: 'FREE ALONGSIDE SHIP',         label: 'FAS - Free Alongside Ship' },
  { value: 'FREE ON BOARD',               label: 'FOB - Free On Board' },
  { value: 'COST AND FREIGHT',            label: 'CFR - Cost and Freight' },
  { value: 'COST, INSURANCE AND FREIGHT', label: 'CIF - Cost, Insurance and Freight' },
  { value: 'CARRIAGE PAID TO',            label: 'CPT - Carriage Paid To' },
  { value: 'CARRIAGE AND INSURANCE PAID', label: 'CIP - Carriage and Insurance Paid To' },
  { value: 'DELIVERED AT TERMINAL',       label: 'DPU - Delivered at Place Unloaded (was DAT)' },
  { value: 'DELIVERED AT PLACE',          label: 'DAP - Delivered at Place' },
  { value: 'DELIVERED DUTY PAID',         label: 'DDP - Delivered Duty Paid' },
  { value: 'DELIVERED DUTY UNPAID',       label: 'DDU - Delivered Duty Unpaid' },
];
const DUTY_PAID_BY = ['Client', 'Agent'];

// The ports a clearance is filed FROM, and the terminals it clears through.
//
// SERVED, NOT SHIPPED. These were four JSON files imported straight into the
// screen - which put reference data inside the frontend bundle, where it was
// ignored by git (.gitignore has `jsonData/*`), invisible to CI, and could
// only be changed by rebuilding a per-install image. They belong on this side
// with DIRECTIONS and GD_TYPES above: one source, one edit, no rebuild.
//
// They are deliberately NOT the Ports/Airports masters. Those hold 2,432
// locations; a clearing agent files from three, and offering the master here
// is how the wrong one gets picked. The masters still back Port Of Discharge
// and Final Destination, which really can be anywhere.
const POL_SEA = [
  { id: 'MEK',     name: 'MCC Export Karachi' },
  { id: 'MPQ-EPZ', name: 'MCC Port Qasim EPZ, - Export' },
  { id: 'PQE',     name: 'Port Qasim, - Exports' },
];
// The id is what a job stores, so a name can be changed here without touching
// any job; the id cannot. ('MCC Import AFU, - Exports' until 2026-10-07.)
const POL_AIR = [
  { id: 'MIA', name: 'MCC Export AFU' },
];
// Terminals and shipment types now live in functions/customsVocabulary.js,
// because the MIGRATION has to produce values that fit them and could not see
// them here. See that file for what drifted.
const {
  TERMINAL_SEA, TERMINAL_AIR, CARGO_TYPES_SEA, CARGO_TYPES_AIR,
} = require('../../functions/customsVocabulary');

/**
 * Port names, made unique by adding the country only where they collide.
 *
 * The picker shows names alone now, and the location master repeats them: 44
 * of the 2,162 sea ports share a name with another. Simply dropping the
 * duplicates - which this did at first - removes real ports that consignments
 * actually go to, and it removes the WRONG one: MANZANILLO is both MXZLO in
 * Mexico and PAMIT in Panama, and keeping whichever sorted first silently
 * reassigned 16 jobs to the other side of the world.
 *
 * So nothing is dropped. A name that appears once is shown bare, which is what
 * was asked for; a name that appears more than once carries its country, which
 * is the smallest thing that makes the choice real.
 */
function disambiguateNames(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(row?.name ?? '').trim().toLowerCase();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return rows.map((row) => {
    const key = String(row?.name ?? '').trim().toLowerCase();
    if (!key || counts.get(key) === 1 || !row.where) return row;
    return { ...row, name: `${row.name} (${row.where})` };
  });
}


// What a customs job looks like when read back: the declaration plus the
// parties it names and the charges against it, each charge carrying the
// invoice it has been billed on so the screen doesn't have to resolve it.
const partyAttrs = ['id', 'name', 'code'];
// The parties the job LIST joins, shows and searches by name: the client and
// the others on the job screen (chaChb is its "Freight Forwarder").
const LIST_PARTIES = ['client', 'shipper', 'consignee', 'shippingLine', 'chaChb', 'transporter'];
const jobInclude = [
  { model: Clients, as: 'client',    attributes: partyAttrs, required: false },
  { model: Clients, as: 'shipper',   attributes: partyAttrs, required: false },
  { model: Clients, as: 'consignee', attributes: partyAttrs, required: false },
  { model: Commodity, attributes: ['id', 'name', 'hs'], required: false },
  {
    // The duty lines. A GD is assessed item by item, so this is where the
    // rates live - Customs_Job itself holds no duty figures at all.
    model: Customs_Duty,
    required: false,
    include: [{ model: Commodity, attributes: ['id', 'name', 'hs'], required: false }],
  },
  {
    // The containers on the declaration. A clearance file quotes container
    // numbers rather than managing them, but it quotes a LIST - 6,164 rows
    // across 5,744 legacy jobs - and held as one string nothing can search by
    // container number.
    model: Customs_Container,
    required: false,
  },
  {
    model: Charge_Head,
    required: false,
    // The invoice a charge has been billed on, if any. Its presence is what
    // locks the charge against further editing.
    include: [
      // payType / paid / recieved: whether the document has been settled,
      // which decides whether the charge sheet may unapprove it.
      { model: Invoice, attributes: ['id', 'invoice_No', 'type', 'approved', 'payType', 'paid', 'recieved'], required: false },
    ],
  },
];

const getJob = (id) =>
  Customs_Job.findOne({
    where: { id },
    include: jobInclude,
    // Charge_Head has no sortOrder column - it is a shared table and adding
    // one would be a migration on it - so charges come back in id order,
    // which is the order they were created in anyway.
    order: [
      [Customs_Duty, 'sortOrder', 'ASC'],
      [Customs_Container, 'sortOrder', 'ASC'],
      [Charge_Head, 'id', 'ASC'],
    ],
  });

// Ids arrive from the URL as strings, so "undefined" and "null" are truthy and
// sail past a plain `if (!id)` straight into Postgres, which rejects them with
// "invalid input syntax for type integer". Returns a number or null.
const asId = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
};

// A payload the caller can fix, as distinct from something that went wrong on
// the server. Marked rather than sniffed by message, so the handlers can
// answer 400 instead of 500 - "internal server error" for a mistyped channel
// sends someone reading logs looking for a fault that isn't there.
class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/* GD #, Client Invoice # and the S/R Page #, each kept to one live job of the
 * company where Configuration > Customs says so - functions/customsJobUnique.
 * Refused with the job that has it, so the clerk can go and look. */
async function assertUniqueNumbers({ values, companyId, previous = null, excludeId = null }) {
  const form = await readCustomsJobForm(require('../../models'));
  const dup = await findDuplicate(Customs_Job, { form, values, previous, companyId, excludeId });
  if (dup) throw new BadRequest(duplicateMessage(dup));
}

// A value that has to be one of a known set, or nothing.
//
// An unrecognised value is REJECTED rather than coerced to the default: a GD
// filed as an unlisted channel is a data-entry mistake worth seeing, whereas
// silently rewriting it to 'Green' would produce a file that says it cleared
// without examination when nobody knows that it did.
// Words this vocabulary used to use, mapped to what it calls them now.
//
// A RENAME is not the same thing as a typo. The rule above rejects an
// unrecognised value on purpose, but a value that was valid when the row was
// saved is not the caller's mistake - without this, renaming 'Land' would make
// every job already filed under it fail the moment somebody opened and saved
// it, with an error naming a word that is no longer offered anywhere.
//
// Keyed lowercase. Only ever add a retired spelling here, never a synonym
// somebody might mean by accident.
const VOCABULARY_ALIASES = {
  land: 'By Road',
  // Status, renamed. Every migrated job written before the rename carries one
  // of these, and so does every job the previous build saved.
  open: 'Incomplete',
  cleared: 'Complete',
  // And the words the screen shows, should anything send those instead.
  'in process': 'Incomplete',
  'on vessel': 'Complete',
  'dray off': 'DrayOff',
  cancel: 'Canceled',
  cancelled: 'Canceled',
};

const oneOf = (list, label) => (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const v = String(value).trim();
  const match = list.find((x) => x.toLowerCase() === v.toLowerCase());
  if (match) return match;

  const renamed = VOCABULARY_ALIASES[v.toLowerCase()];
  if (renamed && list.includes(renamed)) return renamed;

  throw new BadRequest(`${label} must be one of: ${list.join(', ')} (got "${v}").`);
};

/* A failure as TEXT the screen can show.
 *
 * `error.message || error` sent the error OBJECT whenever the message was
 * empty - and Sequelize's AggregateError (bulkCreate) has an empty message: it
 * serialised to {"name":"AggregateError","errors":[{}]}, and the job screen
 * could only say "Could not save this customs job". Postgres' own detail
 * ("Key (CustomsJobId)=(5) is not present in table ...") is added when there
 * is one, because it names the field that is wrong. */
const errorText = (error) => {
  if (!error) return 'Unknown error.';
  if (typeof error === 'string') return error;
  const nested = Array.isArray(error.errors) && error.errors.length
    ? error.errors.map((e) => errorText(e && (e.errors || e.message) ? e.errors || e : e)).join('; ')
    : '';
  const plain = String(error);
  const base = error.message || nested
    || (plain === '[object Object]' ? JSON.stringify(error) : plain);
  const detail = error.parent && error.parent.detail ? ` (${error.parent.detail})` : '';
  return `${base}${detail}`;
};

// One place that decides which failures are the caller's. Used by the two
// handlers that build a job from a payload.
const fail = (res, error) => {
  // Over its credit limit - functions/creditControl. The screen offers to ask.
  if (error?.creditBlock) {
    return res.status(409).json({ status: 'error', result: error.message, creditBlock: error.creditBlock });
  }
  if (error instanceof BadRequest) {
    return res.status(400).json({ status: 'error', result: error.message });
  }
  console.error(error);
  return res.status(500).json({ status: 'error', result: errorText(error) });
};

const asDirection   = oneOf(DIRECTIONS, 'Direction');
const asMode        = oneOf(TRANSPORT_MODES, 'Transport mode');
const asGdType      = oneOf(GD_TYPES, 'GD type');
const asChannel     = oneOf(CHANNELS, 'Channel');
/* THE JOB'S STATUS - one of the statuses Configuration > Customs lists (see
 * functions/customsStatuses), matched by stored value, by name, or by a
 * retired spelling (VOCABULARY_ALIASES). A retired status is still accepted:
 * the job may be at it already. Blank is the status new jobs start at. */
const asStatus = (value, list) => {
  const v = resolveStatus(list, value, VOCABULARY_ALIASES);
  if (v === undefined) {
    throw new BadRequest(`Status must be one of: ${list.map((s) => s.label).join(', ')} (got "${String(value).trim()}").`);
  }
  return v || startOf(list);
};
const asDutyPaidBy  = oneOf(DUTY_PAID_BY, 'Duty paid by');

// Numeric fields arrive as '' from an untouched input. Stored as null rather
// than 0, because "not assessed" and "assessed at nothing" are different
// answers and the duty breakdown drops zeros.
const asNumber = (v) => (v === '' || v === null || v === undefined ? null : num(v));

/**
 * The columns an edit is allowed to write, and what each one is cleaned to.
 *
 * A whitelist rather than a spread of req.body: this endpoint takes a payload
 * straight from a screen, and letting it name its own columns is how jobNo,
 * companyId or canceled get rewritten by a stale tab. Anything not listed here
 * is dropped, silently and deliberately.
 */
/* ONE CLIENT INVOICE #, whichever of the form's two boxes it was typed in.
 * Two columns because the file has always had both: clientRef from Climax's
 * ClientRefNo, cut at 20 characters there, and invoiceNo from CInvNumber,
 * whole. Written alike, so nothing reading either one can disagree; where an
 * old job's two differ, the whole number wins. */
const present = (v) => String(v ?? '').trim() !== '';
const clientInvoiceOf = (data) => (
  present(data.invoiceNo) ? data.invoiceNo : present(data.clientRef) ? data.clientRef : null
);

const jobValues = (data, statuses) => ({
  direction:     asDirection(data.direction) || 'Export',
  transportMode: asMode(data.transportMode) || 'Sea',

  gdNumber:      data.gdNumber || null,
  gdDate:        data.gdDate || null,
  gdType:        asGdType(data.gdType),
  channel:       asChannel(data.channel),
  collectorate:  data.collectorate || null,

  clientId:      data.clientId || null,
  shipperId:     data.shipperId || null,
  consigneeId:   data.consigneeId || null,
  CommodityId:   data.CommodityId || null,

  blNo:           data.blNo || null,
  blDate:         data.blDate || null,
  vesselOrFlight: data.vesselOrFlight || null,
  voyageNo:       data.voyageNo || null,
  igmNo:          data.igmNo || null,
  indexNo:        data.indexNo || null,
  pol:            data.pol || null,
  pod:            data.pod || null,
  // Where the goods are ultimately bound, beyond the port of discharge.
  pofd:           data.pofd || null,

  // What a clearing agent's file actually records - see models/Customs_Job.js.
  clientRef:        clientInvoiceOf(data),
  jobRef:           data.jobRef || null,
  customFileNo:     data.customFileNo || null,
  deliveryLocation: data.deliveryLocation || null,
  terminal:         data.terminal || null,
  cargoType:        data.cargoType || null,
  incoTerms:        data.incoTerms || null,
  netWeight:        asNumber(data.netWeight),
  carrierBookingNo: data.carrierBookingNo || null,
  cancelReason:     data.cancelReason || null,
  approvedOn:       data.approvedOn || null,
  projectRef:       data.projectRef || null,
  invoiceRemarks:   data.invoiceRemarks || null,
  grt:              asNumber(data.grt),
  nrt:              asNumber(data.nrt),
  costCenter:       data.costCenter || null,
  mblNo:            data.mblNo || null,
  mblDate:          data.mblDate || null,
  shippingBillNo:   data.shippingBillNo || null,
  shippingBillDate: data.shippingBillDate || null,
  gpDate:           data.gpDate || null,
  containerType:    data.containerType || null,
  deliveryTerms:    data.deliveryTerms || null,
  transporterId:    data.transporterId || null,
  localVendorId:    data.localVendorId || null,
  chaChbId:         data.chaChbId || null,
  shippingLineId:   data.shippingLineId || null,
  sailingDate:      data.sailingDate || null,
  // The program book's three - see models/Customs_Job.js.
  gateInTime:       data.gateInTime || null,
  cutOff:           data.cutOff || null,
  currentStatus:    data.currentStatus || null,
  jobDate:          data.jobDate || null,
  jobType:          data.jobType || null,
  regPageNo:        data.regPageNo || null,
  etaDate:        data.etaDate || null,
  arrivalDate:    data.arrivalDate || null,
  deliveryDate:   data.deliveryDate || null,

  packages:      asNumber(data.packages),
  pkgUnit:       data.pkgUnit || null,
  grossWeight:   asNumber(data.grossWeight),
  containers:    data.containers || null,

  invoiceNo:       clientInvoiceOf(data),
  invoiceDate:     data.invoiceDate || null,
  invoiceValue:    asNumber(data.invoiceValue),
  invoiceCurrency: data.invoiceCurrency || null,
  lcNo:            data.lcNo || null,
  formENo:         data.formENo || null,

  // The declaration's headline customs value. The duty itself is NOT here -
  // it is assessed per item on Customs_Duty, saved by saveDutyLines below.
  assessedValue:        asNumber(data.assessedValue),

  psid:         data.psid || null,
  dutyPaidDate: data.dutyPaidDate || null,
  dutyPaidBy:   asDutyPaidBy(data.dutyPaidBy),

  // In Process when none is sent. It was 'Open' - the word retired for it,
  // which no list or count recognises, so such a job was filed nowhere.
  status:  asStatus(data.status, statuses.job),
  // What was declared, in the filer's own words - distinct from the commodity
  // picker, and on a migrated install often the only record of the goods.
  goodsDescription: data.goodsDescription || null,
  remarks: data.remarks || null,
  exRate:  data.exRate ?? '1',
});

/**
 * Save a job's charges.
 *
 * INVOICED CHARGES ARE LEFT ALONE. Once a charge carries an InvoiceId it is
 * part of an accounting document: rewriting it would change what an issued
 * invoice says, and deleting it would leave that invoice's total referring to
 * lines that no longer exist. Only uninvoiced rows are replaced.
 *
 * `undefined` means "the screen did not send charges", which is not the same
 * as "this job has no charges" - only an actual array clears them.
 *
 * Replace-in-place rather than update-per-row, unlike aviation's consignments:
 * nothing hangs off a Charge_Head, so a charge losing its id costs nothing.
 * The consignment case was different only because charges hung off THOSE ids.
 */
/**
 * The columns a duty line is allowed to write.
 *
 * A whitelist for the same reason jobValues() is one, and built from the same
 * arrays the arithmetic uses - so adding a head means adding it to RATE_HEADS
 * or AMOUNT_HEADS in functions/customsDuty.js and it is saved, assessed and
 * reported together. A hand-kept second list here is how a head gets typed in
 * on the screen and silently dropped on save.
 */
const DUTY_VALUE_FIELDS = [
  'assessedValue', 'fobValue', 'cnfValue', 'freight', 'insuranceValue',
  'exchangeRate', 'landingInsPerc',
  'totalFob', 'totalCnf', 'totalFreight', 'totalInsurance',
];
const DUTY_NUMERIC_FIELDS = [
  ...DUTY_VALUE_FIELDS,
  'quantity',
  ...RATE_HEADS.map((h) => h.field),
  ...AMOUNT_HEADS.map((h) => h.field),
];
const DUTY_TEXT_FIELDS = [
  'itemNo', 'modelNo', 'sroNumber', 'originCode',
  'exciseRemarks', 'stampDutyRemarks', 'fineRemarks', 'loloRemarks',
];

const dutyValues = (line, i, jobId) => {
  const out = { sortOrder: i, CustomsJobId: jobId };
  for (const f of DUTY_NUMERIC_FIELDS) out[f] = asNumber(line[f]);
  for (const f of DUTY_TEXT_FIELDS) out[f] = line[f] || null;
  out.isFreight = line.isFreight === undefined ? null : Boolean(line.isFreight);
  out.isProvision = line.isProvision === undefined ? null : Boolean(line.isProvision);
  out.CommodityId = line.CommodityId || null;
  // Carried through so a migrated line keeps its legacy identity across an
  // edit; a line typed in Odyssey has none, which is correct.
  out.climaxId = line.climaxId ?? null;
  return out;
};

// A duty line is worth keeping if it names an item or carries any figure at
// all. Anything else is an "Add +" the user thought better of, and saving it
// would put a blank row on the declaration to be deleted by hand later.
const isRealDutyLine = (l) =>
  l && (
    String(l.itemNo || '').trim() ||
    l.CommodityId ||
    DUTY_NUMERIC_FIELDS.some((f) => asNumber(l[f]) !== null && asNumber(l[f]) !== 0)
  );

/**
 * Save a declaration's duty lines.
 *
 * Replace-in-place rather than update-per-row: nothing hangs off a
 * Customs_Duty row, so a line losing its id costs nothing. (The consignment
 * case in aviation was different only because charges hung off THOSE ids.)
 *
 * `undefined` means "the screen did not send duty lines", which is not the
 * same as "this GD has none" - only an actual array clears them.
 */
/**
 * A container row is real if it names a container - or, before the number is
 * known, its size or its truck: a job moved from the Program Book arrives with
 * "2 x 40HC" and no numbers yet, and those rows are the plan, waiting for the
 * box numbers. A row with none of the three is an Add Row nobody filled.
 * Everything else on the row is optional - in the legacy book seals,
 * temperature and load type are empty on all 6,164 rows and the weights on all
 * but 241.
 */
const isRealContainer = (c) => Boolean(c && ['containerNo', 'sizeType', 'truckNo']
  .some((f) => String(c[f] || '').trim()));

const containerValues = (c, i, jobId) => ({
  containerNo: String(c.containerNo ?? '').trim(),
  sizeType: c.sizeType ? String(c.sizeType).trim() : null,
  truckNo: c.truckNo ? String(c.truckNo).trim() : null,
  // Who hauls it - the Program Book's container section brings it.
  transporterId: /^\d+$/.test(String(c.transporterId ?? '').trim()) ? Number(c.transporterId) : null,
  grossWeight: asNumber(c.grossWeight),
  netWeight: asNumber(c.netWeight),
  packages: asNumber(c.packages),
  remarks: c.remarks ? String(c.remarks).trim() : null,
  sortOrder: i,
  CustomsJobId: jobId,
});

/** Same contract as saveDutyLines: only an actual array clears them. */
const saveContainers = async (list, jobId) => {
  if (!Array.isArray(list)) return;
  await Customs_Container.destroy({ where: { CustomsJobId: jobId } });
  const rows = list.filter(isRealContainer).map((c, i) => containerValues(c, i, jobId));
  if (rows.length) await Customs_Container.bulkCreate(rows);
};

const saveDutyLines = async (list, jobId) => {
  if (!Array.isArray(list)) return;
  await Customs_Duty.destroy({ where: { CustomsJobId: jobId } });
  const rows = list.filter(isRealDutyLine).map((l, i) => dutyValues(l, i, jobId));
  if (rows.length) await Customs_Duty.bulkCreate(rows);
};

/**
 * ONE OF EACH CHARGE PER SIDE, when the install has it on (Configuration >
 * Direct Job, "One of each charge per job" - asked 2026-11-17; see
 * functions/jobChargeRepeats). Called BEFORE anything is written, so a
 * refused save changes nothing - the job included.
 *
 * The sheet as it will stand is what is sent plus the lines saveCharges leaves
 * alone (on an issued invoice, or on any invoice when the user may not change
 * invoices) that were not sent. Repeats the job already had may stay.
 */
const assertNoRepeatedSheetCharges = async (list, jobId, { holdInvoiced = false } = {}) => {
  if (!Array.isArray(list)) return;
  if (!(await readUniqueJobCharges(require('../../models')))) return;
  const before = jobId ? await Charge_Head.findAll({
    where: { CustomsJobId: jobId },
    // isInvoiceLocked reads the line's InvoiceId and its invoice's approval.
    attributes: ['id', 'type', 'charge', 'InvoiceId'],
    include: [{ model: Invoice, attributes: ['id', 'approved'], required: false }],
  }) : [];
  const sentIds = new Set(list.map((c) => String(c?.id ?? '')).filter(Boolean));
  const kept = before.filter((c) => c.InvoiceId && !sentIds.has(String(c.id))
    && (holdInvoiced || isInvoiceLocked(c, c.Invoice)));
  const after = [...list.filter(isRealCharge), ...kept].map((c) => ({ type: c.type, charge: c.charge }));
  const repeats = sheetRepeats(after, before.map((c) => ({ type: c.type, charge: c.charge })));
  if (!repeats.length) return;
  const masters = await Charges.findAll({
    where: { id: repeats.map((r) => parseInt(r.charge, 10)).filter(Number.isFinite) },
    attributes: ['id', 'name', 'short'],
  });
  throw new BadRequest(sheetRepeatsMessage(repeats, Object.fromEntries(masters.map((m) => [String(m.id), m.name || m.short]))));
};

/**
 * Write the sheet back.
 *
 * THREE KINDS OF LINE, and the middle one is why this is not a delete-and-
 * recreate any more:
 *
 *   - not on an invoice     replaced wholesale, as before
 *   - on an UNAPPROVED one  UPDATED IN PLACE, keeping its id and its InvoiceId -
 *                           or DELETED, when the sheet no longer has it
 *   - on an APPROVED one    left untouched, and counted so /edit can say so
 *
 * Updated rather than replaced because the line has to stay on the same
 * document: it keeps its InvoiceId, so re-approving that invoice recomputes
 * the total from the corrected figures and posts those. Destroying and
 * recreating would give it a new id, orphan it from its invoice, and quietly
 * turn an amendment into a second charge.
 *
 * The lock is enforced HERE, not only in the UI: a stale browser tab, or
 * anything posting straight at the endpoint, must not be able to rewrite a
 * charge an issued invoice was computed from.
 */
const saveCharges = async (list, jobId, job, { holdInvoiced = false } = {}) => {
  if (!Array.isArray(list)) return { skipped: 0, held: 0 };

  // What is currently on this job's sheet and on a document, WITH the invoice,
  // so approved can be told from unapproved. The request cannot be trusted for
  // this - it is the thing being checked.
  const existing = await Charge_Head.findAll({
    where: { CustomsJobId: jobId, InvoiceId: { [Op.ne]: null } },
    include: [{ model: Invoice, attributes: ['id', 'approved'], required: false }],
  });
  const byId = new Map(existing.map((c) => [String(c.id), c]));
  // holdInvoiced: the user may not edit invoices (guardChargeRights), so a
  // line on an UNAPPROVED one is left as it is too - not amended, not removed.
  const lockedCount = existing.filter((c) => isInvoiceLocked(c, c.Invoice)).length;
  const frozenIds = new Set(
    existing.filter((c) => holdInvoiced || isInvoiceLocked(c, c.Invoice)).map((c) => String(c.id))
  );

  // The lines about to be written again, as they stand, so each keeps who
  // entered it and is only marked edited if it changed (functions/auditStamps
  // .carriedStamps). Without this, whoever saved last would be every line's
  // creator.
  const rewritten = new Map((await Charge_Head.findAll({
    where: { CustomsJobId: jobId, InvoiceId: null }, raw: true,
  })).map((r) => [String(r.id), r]));

  await Charge_Head.destroy({
    where: { CustomsJobId: jobId, InvoiceId: null },
  });

  /* REMOVED FROM AN UNAPPROVED INVOICE. The sheet offers "Remove it from this
     unapproved invoice", and the line used to survive the save: only lines on
     no invoice were cleared, so a removed one kept its InvoiceId and the next
     approval re-totalled it straight back onto the invoice and posted it, with
     every one of its figures. Matched by id, so a stale tab that still lists
     the line - with or without its InvoiceId - never takes it off. */
  const sentIds = new Set(list.map((c) => String(c?.id ?? '')).filter(Boolean));
  const removedIds = existing
    .filter((c) => !frozenIds.has(String(c.id)) && !sentIds.has(String(c.id)))
    .map((c) => c.id);
  if (removedIds.length) {
    await Charge_Head.destroy({ where: { id: removedIds } });
  }

  const fresh = [];
  const amended = [];
  for (const c of list) {
    if (!isRealCharge(c)) continue;
    if (!c.InvoiceId) { fresh.push(c); continue; }
    const id = String(c.id ?? '');
    // Unknown, or frozen: not this request's to touch.
    if (!byId.has(id) || frozenIds.has(id)) continue;
    amended.push({ row: byId.get(id), sent: c });
  }

  if (fresh.length) {
    const rows = fresh.map((c, i) => chargeValues(c, i, jobId, job));
    const auditStamps = await Promise.all(rows.map((v, i) => {
      const old = rewritten.get(String(fresh[i]?.id ?? ''));
      return old ? carriedStamps(require('../../models'), Charge_Head, old, v) : null;
    }));
    await Charge_Head.bulkCreate(rows, { auditStamps });
  }

  for (const { row, sent } of amended) {
    const values = chargeValues(sent, 0, jobId, job);
    /* THE LINK IS NOT THE SCREEN'S TO CHANGE. chargeValues builds a row as if
       it were new and so names none of these today - but it is the projection
       every charge write goes through, and the day one of them is added there
       an amendment would silently detach the line from its document. Cheap to
       be explicit about, and impossible to notice if it ever happened. */
    delete values.InvoiceId;
    delete values.invoice_id;
    delete values.invoiceType;
    await row.update(values);
  }

  // Only the ones an ISSUED invoice holds, so /edit can say it left them alone
  // rather than appear to have dropped them.
  return { skipped: lockedCount, held: frozenIds.size - lockedCount };
};

/**
 * What a save of the sheet may change, by the user's rights - see
 * functions/chargeRights. A line's APPROVAL is the charges' Approve right:
 * without it, approvals stay as stored. A line on an UNAPPROVED invoice is part
 * of that invoice: without the right to edit job invoices, such lines are
 * held (saveCharges holdInvoiced). Asked only when the save really changes one
 * - an unchanged sheet logs no refusal in audit mode.
 */
const guardChargeRights = async (req, charges, jobId) => {
  if (!Array.isArray(charges)) return { charges, holdInvoiced: false };
  const stored = jobId
    ? (await Charge_Head.findAll({
      where: { CustomsJobId: jobId },
      include: [{ model: Invoice, attributes: ['id', 'approved'], required: false }],
    })).map((r) => r.get({ plain: true }))
    : [];
  const need = chargeRightsNeeded(charges, stored);
  const out = need.approve && !(await allowsPart(req, CHARGE_APPROVE, 'charge approval'))
    ? holdApprovals(charges, stored)
    : charges;
  const holdInvoiced = need.invoiced && !(await allowsPart(req, INVOICE_EDIT, 'invoiced charges'));
  return { charges: out, holdInvoiced };
};
const HELD_NOTE = 'Charges on an unapproved invoice were left as they were - changing them is editing the invoice, which needs the right to edit job invoices.';
const withHeld = (warning, held) => [warning, held ? HELD_NOTE : null].filter(Boolean).join(' ') || undefined;

/**
 * Whether this job's charges are already on an invoice.
 *
 * A GD whose charges have been billed is FROZEN except for its remarks and its
 * status. The duty figures are what an issued invoice's reimbursement line was
 * computed from, so editing them afterwards would leave the file saying one
 * thing and the invoice another, with nothing to reconcile them.
 *
 * Enforced HERE, not only in the UI: a stale browser tab, or anything posting
 * straight at the endpoint, must not be able to move a billed GD out from
 * under its invoice.
 */
const isInvoiced = async (jobId) => {
  /* AN APPROVED INVOICE, not merely an invoice. Unapproving one destroys its
     voucher and takes it back out of the ledger, so there is no issued figure
     left for the declaration to contradict - and reopening the file is exactly
     what somebody unapproved it in order to do. Same rule the charge rows use;
     locking the tabs on a weaker one would leave the sheet editable inside a
     declaration that refused to be. */
  const billed = await Charge_Head.findAll({
    where: { CustomsJobId: jobId, InvoiceId: { [Op.ne]: null } },
    attributes: ['id', 'InvoiceId'],
    include: [{ model: Invoice, attributes: ['id', 'approved'], required: false }],
  });
  return billed.some((c) => isInvoiceLocked(c, c.Invoice));
};

// Everything the screen and the list want that is derived rather than stored.
// Computed on the way out so no two callers can arrive at a different total.
const withTotals = (job) => {
  const plain = job.toJSON ? job.toJSON() : job;
  return {
    ...plain,
    totalDuty: totalDuty(plain),
    dutyBreakdown: dutyBreakdown(plain),
    reimbursableDuty: reimbursableDuty(plain),
    effectiveDutyRate: effectiveDutyRate(plain),
  };
};

/**
 * List. Filtered by company, newest first - the customs job list screen.
 *
 * SERVER-SIDE PAGED, and it has to be. This was a bare findAll with the full
 * `jobInclude`, which on a migrated book meant 146,890 joined rows fetched,
 * hydrated into 15,364 model instances, run through the duty arithmetic and
 * serialised to the browser - so that antd could show twenty of them.
 *
 * The includes are cut to what the list actually renders. It shows nine
 * columns and only ONE of them comes from a join: the client's name. The
 * charge lines and their invoices - by far the most expensive part of
 * jobInclude - appear nowhere on this screen.
 *
 * Duty is fetched for the PAGE in a second query rather than joined, the same
 * shape routes/aviationJobs/awb.js uses: joining a hasMany multiplies the rows
 * and then the count has to be un-multiplied back out again.
 */
const LIST_PAGE_SIZE = 25;
const LIST_MAX_PAGE_SIZE = 200;

routes.get('/get', async (req, res) => {
  try {
    // STRICT: no company picked, no jobs - and the screen says why. It used to
    // drop the filter, which showed every company's jobs; see companyCodes.
    if (!isCompanyId(req.headers.companyid)) {
      return res.json({ status: 'success', result: [], count: 0, counts: {}, page: 1, limit: LIST_PAGE_SIZE, noCompany: true });
    }
    const where = { companyId: String(req.headers.companyid).trim() };
    // Free-text filters, matched as substrings so a partial GD or B/L number
    // finds the file. `gd` searches BOTH numbers, because the number someone
    // has in hand is as often the carrier's as the declaration's, and asking
    // them which box to type it in is a question the screen can answer itself.
    const search = String(req.headers.search || '').trim();
    if (search) {
      // Any case, and a % or _ typed is just that character.
      const like = { [Op.iLike]: `%${escapeLike(search)}%` };
      where[Op.or] = [
        { gdNumber: like },
        { blNo:     like },
        { jobNo:    like },
        { igmNo:    like },
        // The S/R page number - or whatever the install calls it. Held in
        // jobRef - see the field on the form - and the number a clerk works
        // from when they have the shipping register in front of them.
        { jobRef:   like },
        // THE CLIENT INVOICE # - both columns that hold it (invoiceNo whole,
        // clientRef as Climax cut it) - asked for 2026-11-14.
        { invoiceNo: like },
        { clientRef: like },
        // CONTAINER NUMBERS: the job's typed list, and its container rows -
        // EXISTS, so a job with several containers is still one row.
        { containers: like },
        Sequelize.literal(`EXISTS (SELECT 1 FROM "Customs_Containers" cc WHERE cc."CustomsJobId" = "Customs_Job"."id" AND cc."containerNo" ILIKE ${Customs_Job.sequelize.escape(`%${escapeLike(search)}%`)})`),
        // The CLIENT'S NAME, which is what people actually have when they ring
        // up - more often than any of the numbers above - and the job's other
        // parties' names, from the same Clients table, as the list can now
        // show them (the user, 2026-11-20). They live on the joined tables,
        // hence the client.name form and `subQuery: false` below: with a
        // limit, Sequelize otherwise wraps the main table in a sub-select that
        // cannot see the joins, and the column comes back "does not exist".
        ...LIST_PARTIES.map((as) => Sequelize.where(Sequelize.col(`${as}.name`), like)),
      ];
    }

    /* A TIME PERIOD, by job date - the same choices as Payments & Receipts'
     * invoice list (the user, 2026-11-14): fortnight, month, quarter, fiscal
     * year, custom; none is every date. jobDate is a 'YYYY-MM-DD' string, so
     * comparing the text compares the dates. The range it came to is sent
     * back, for the screen to show beside the choice. */
    let range = null;
    const period = String(req.query.period || '').trim();
    if (period && period !== 'all') {
      range = resolvePeriod(period, {
        from: req.query.from,
        to: req.query.to,
        fiscalYear: await selectedFiscalYearRange(req),
      });
      where.jobDate = { [Op.gte]: range.from, [Op.lte]: range.to };
    }
    if (req.headers.direction) where.direction = String(req.headers.direction);

    // BILLING STATE, asked of the charge lines rather than of the job.
    //
    // EXISTS rather than a join: a job has many charge lines, and joining them
    // to filter would multiply the rows and then the count would have to be
    // un-multiplied back out. A correlated EXISTS asks the question once per
    // job and returns a boolean, which is exactly the question.
    //
    // Charge_Heads."CustomsJobId" is indexed (charge_heads_customs_job, from
    // ifa-deploy/upgrade-customs-schema.sql), which is what keeps this cheap.
    const CHARGES_OF_THIS_JOB =
      '(SELECT 1 FROM "Charge_Heads" ch WHERE ch."CustomsJobId" = "Customs_Job"."id"';
    const BILLING = {
      charged:    `EXISTS ${CHARGES_OF_THIS_JOB})`,
      uncharged:  `NOT EXISTS ${CHARGES_OF_THIS_JOB})`,
      invoiced:   `EXISTS ${CHARGES_OF_THIS_JOB} AND ch."InvoiceId" IS NOT NULL)`,
      // "Not invoiced" means it HAS charges and none of them are on an invoice
      // - work that is billable and unbilled. A job with no charges at all is
      // not unbilled, it is untouched, and lumping the two together would hide
      // the number anybody actually wants.
      uninvoiced: `${`EXISTS ${CHARGES_OF_THIS_JOB})`} AND NOT ${`EXISTS ${CHARGES_OF_THIS_JOB} AND ch."InvoiceId" IS NOT NULL)`}`,
    };
    const billing = String(req.query.billing || '').trim();
    if (BILLING[billing]) {
      where[Op.and] = [...(where[Op.and] || []), Sequelize.literal(BILLING[billing])];
    }

    // Status moved to the server with the paging. Filtering a PAGE by status
    // would hide rows the pager still counts, so the tally and the table would
    // disagree and neither would be wrong from where it stood.
    const statuses = String(req.query.status || '')
      .split(',').map((x) => x.trim()).filter(Boolean);
    const statusWhere = statuses.length ? { ...where, status: { [Op.in]: statuses } } : where;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(
      LIST_MAX_PAGE_SIZE,
      Math.max(1, Number(req.query.limit) || LIST_PAGE_SIZE),
    );

    const { count, rows } = await Customs_Job.findAndCountAll({
      where: statusWhere,
      // The client, plus the other parties on the job screen and the commodity
      // - names only, for the list's optional columns (the user, 2026-11-20:
      // "why isn't shipper, consignee in the list of columns"). Every one is
      // belongsTo, so one row in is one row out and the count stays honest.
      include: [
        ...LIST_PARTIES.map((as) => ({
          model: Clients, as, attributes: as === 'client' ? partyAttrs : ['id', 'name'], required: false,
        })),
        { model: Commodity, attributes: ['id', 'name'], required: false },
      ],
      // BY JOB DATE, not createdAt.
      //
      // createdAt on a migrated job is the moment the MIGRATION ran - mapJob
      // never sets it, unlike mapVoucher which takes the legacy AddOn - so
      // "newest first" meant "inserted last" and only matched chronology by
      // accident. On this book it put December 2025 at the top, where 12% of
      // files have been charged and 10% invoiced, so the first page looked
      // like a migration that had lost the money.
      //
      // jobDate is 100% populated and is what anyone means by a job's date.
      // It is a 'YYYY-MM-DD' string, so a lexical sort IS the chronological
      // one. NULLS LAST because Postgres puts them first in DESC, and a job
      // with no date should not head the list.
      //
      // id breaks the tie: 457 distinct dates across 15,364 jobs means large
      // groups share one, and without a second key their order inside a page
      // is whatever the planner felt like - which makes paging unstable.
      order: [
        Sequelize.literal('"Customs_Job"."jobDate" DESC NULLS LAST'),
        Sequelize.literal('"Customs_Job"."id" DESC'),
      ],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
      // The search reaches into the joined client, so the query has to be one
      // flat statement. Safe here precisely because the include is belongsTo:
      // there is no row multiplication for the limit to cut through.
      subQuery: false,
    });

    // Per-status tallies for the filter tags, over everything the OTHER
    // filters match - deliberately ignoring the status filter itself, so each
    // tag keeps saying how many jobs it would show rather than collapsing to
    // zero the moment another tag is turned on.
    const grouped = await Customs_Job.findAll({
      where,
      attributes: ['status', [Sequelize.fn('COUNT', Sequelize.col('Customs_Job.id')), 'n']],
      // THE SAME JOINS AS THE PAGE QUERY. `where` reaches into the parties -
      // the search matches on their names - and a WHERE naming a table the
      // FROM clause does not have is a 42P01, not an empty result. Attributes
      // empty so the joins add nothing to select or to GROUP BY.
      include: LIST_PARTIES.map((as) => ({ model: Clients, as, attributes: [], required: false })),
      group: ['Customs_Job.status'],
      raw: true,
    });
    const counts = {};
    const start = startOf((await readCustomsStatuses()).job);
    for (const g of grouped) {
      const s = g.status || start;
      counts[s] = (counts[s] || 0) + (Number(g.n) || 0);
    }

    // Duty for THIS PAGE only. Empty on an install that records duty as
    // ordinary charge lines, which is why it is not worth a join.
    const ids = rows.map((r) => r.id);
    const duty = ids.length
      ? await Customs_Duty.findAll({
          where: { CustomsJobId: { [Op.in]: ids } },
          order: [['sortOrder', 'ASC']],
        })
      : [];
    const dutyByJob = new Map();
    for (const d of duty) {
      const k = String(d.CustomsJobId);
      if (!dutyByJob.has(k)) dutyByJob.set(k, []);
      dutyByJob.get(k).push(d);
    }

    // How many invoices and bills each job on THIS PAGE is on, counted through
    // its charge lines - an invoice names no job of its own, its lines do. One
    // grouped query for the page, and DISTINCT because an invoice carries many
    // of a job's lines. An invoice with no lines is not counted: it bills
    // nothing (the migration's line-less duplicates are exactly that).
    const docs = ids.length
      ? await Charge_Head.findAll({
          where: { CustomsJobId: { [Op.in]: ids } },
          attributes: [
            'CustomsJobId',
            [Sequelize.col('Invoice.type'), 'docType'],
            [Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('Invoice.id'))), 'n'],
          ],
          include: [{ model: Invoice, attributes: [], required: true }],
          group: ['Charge_Head.CustomsJobId', 'Invoice.type'],
          raw: true,
        })
      : [];
    const docsByJob = new Map();
    for (const d of docs) {
      const k = String(d.CustomsJobId);
      if (!docsByJob.has(k)) docsByJob.set(k, { invoiceCount: 0, billCount: 0 });
      // Job Bill / Agent Bill are bills; everything else raised is an invoice.
      const key = /bill$/i.test(String(d.docType || '')) ? 'billCount' : 'invoiceCount';
      docsByJob.get(k)[key] += Number(d.n) || 0;
    }

    // Who opened each job: its own stamp (functions/auditStamps), or for a
    // job saved before those, its first History entry (functions/recordCreators).
    const creators = await creatorsOf(require('../../models'), 'Customs Job', rows.filter((r) => !r.createdBy).map((r) => r.jobNo));
    res.json({
      status: 'success',
      result: rows.map((r) => withTotals({
        ...r.toJSON(),
        createdByName: r.createdBy || creators.get(r.jobNo) || null,
        Customs_Duties: (dutyByJob.get(String(r.id)) || []).map((d) => d.toJSON()),
        ...(docsByJob.get(String(r.id)) || { invoiceCount: 0, billCount: 0 }),
      })),
      count,
      counts,
      page,
      limit,
      // The dates the period came to, or null for every date.
      period: range,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/* The selected fiscal year's start and end, for the Fiscal Year period - or
 * null. Read straight, not through resolveSelectedFiscalYear, which refuses a
 * LOCKED year: that is right for creating a record in it and wrong for
 * looking at its jobs. */
async function selectedFiscalYearRange(req) {
  const id = req.headers['x-fiscal-year-id'];
  if (!id || !/^\d+$/.test(String(id))) return null;
  const fy = await require('../../models').FiscalYears.findByPk(id, { attributes: ['startDate', 'endDate'] });
  return fy ? { startDate: fy.startDate, endDate: fy.endDate } : null;
}

routes.get('/getById', async (req, res) => {
  try {
    const id = asId(req.headers.id);
    if (!id) {
      return res.status(400).json({ status: 'error', result: `Not a valid customs job id: ${req.headers.id}` });
    }
    const result = await getJob(id);
    if (!result) return res.status(404).json({ status: 'error', result: 'Customs job not found.' });
    const creators = result.createdBy ? new Map() : await creatorsOf(require('../../models'), 'Customs Job', [result.jobNo]);
    res.json({
      status: 'success',
      result: { ...withTotals(result), invoiced: await isInvoiced(id), createdByName: result.createdBy || creators.get(result.jobNo) || null },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * WHAT THIS DECLARATION EARNED, per charge head.
 *
 * Its own endpoint rather than more includes on /getById, because it needs two
 * things that screen has no use for: each invoice's SETTLEMENT figures, and
 * the DIRECT JOB lines booked against the file. Hanging either off the job
 * read would make every open-a-job slower for a tab most users never look at.
 *
 * The Direct Job half is the reason it exists. Money entered through Accounts >
 * Direct Job E / R posts straight to the ledger against this job and never
 * becomes a charge on the sheet, so the sheet's own totals - and every screen
 * built on them - simply did not know about it.
 */
routes.get('/chargeSummary', async (req, res) => {
  try {
    const id = asId(req.headers.id || req.query.id);
    if (!id) {
      return res.status(400).json({ status: 'error', result: `Not a valid customs job id: ${req.headers.id}` });
    }

    const [charges, directLines, masters] = await Promise.all([
      Charge_Head.findAll({
        where: { CustomsJobId: id },
        include: [{
          model: Invoice,
          // total/paid/recieved are what make a charge REALIZED - see
          // functions/customsChargeSummary.settledFractionOf.
          attributes: ['id', 'invoice_No', 'type', 'payType', 'approved', 'total', 'paid', 'recieved'],
          required: false,
        }],
      }),
      /* Keyed on the column THIS MODE owns. A customs install stores the job
         on CustomsJobId; asking for Job_Id would match nothing here, or match
         a freight job that happened to share the number. */
      Direct_Job_Association.findAll({
        where: directJobJobSource.ownerWhere(await readOperationMode(), id),
        include: [{ model: Direct_Job, as: 'DirectJob', attributes: ['id', 'Type', 'Entry_No'] }],
      }),
      Charges.findAll({ attributes: ['id', 'code', 'name', 'short'] }),
    ]);

    // Charge_Head.charge is a STRING column pointing at an integer master -
    // see functions/chargeIds for why that has to be reconciled on read.
    const names = {};
    for (const m of masters) names[String(m.id)] = m.name || m.short || String(m.code || m.id);

    res.json({
      status: 'success',
      result: {
        ...summariseCharges({ charges, directLines, names }),
        // So the screen can say WHERE the direct money came from rather than
        // showing a figure the charge sheet cannot account for.
        directEntries: [...new Set(directLines.map((l) => l.DirectJob?.Entry_No).filter(Boolean))],
        // The same entries with their ids, so each Entry # opens its Direct
        // E/R (asked 2026-11-17) - see directEntryRefs.
        directEntryRefs: directEntryRefs(directLines),
        // The lines themselves, so a ticked summary row can be copied onto
        // the sheet - see directLineDetail.
        directLines: directLines.map(directLineDetail),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

// The pick lists this screen needs. Its own endpoint rather than reusing
// /seaJob/getValues, which returns a dozen lists of vessels, carriers and
// equipment that a clearance file has no use for.
routes.get('/getValues', async (req, res) => {
  try {
    /* The customs loading desks - QFS, Badruddin, ICT... - are rows in Setup >
     * Ports, ticked (functions/customsLoadingPorts). They are the Port Of
     * Loading list, and were also being offered as Port Of Discharge and Final
     * Destination (the user's report, 2026-10-13). Left out of those. */
    const desks = await loadingPortIds(require('../../models'));
    const [clients, commodities, ports, airports, charges] = await Promise.all([
      Clients.findAll({
        where: { active: true },
        attributes: ['id', 'name', 'code', 'nongl', 'types'],
        order: [['name', 'ASC']],
      }),
      Commodity.findAll({ attributes: ['id', 'name', 'hs'], order: [['name', 'ASC']] }),
      Ports.findAll({ attributes: ['id', 'portId', 'portName', 'portCountry'], order: [['portId', 'ASC']] }),
      Airports.findAll({ attributes: ['airportCode', 'airportName', 'city'], order: [['airportCode', 'ASC']] }),
      Charges.findAll({
        where: { status: true },
        attributes: [
          'id', 'code', 'short', 'name', 'currency', 'calculationType',
          'defaultRecivableParty', 'defaultPaybleParty', 'taxApply', 'taxPerc',
        ],
        order: [['code', 'ASC']],
      }),
    ]);

    // Clients.types is a comma-joined string ('Shipper, Consignee'), so match
    // on the whole entry rather than a substring.
    const typesOf = (x) => String(x.types || '').split(',').map((t) => t.trim());
    const hasType = (type) => (x) => typesOf(x).includes(type);
    // Several fields accept more than one tag - a carrier is tagged 'Shipping
    // Line' or 'Air Line' depending on which side of the business entered it,
    // and the same box on the screen takes either.
    const hasAny = (...types) => (x) => typesOf(x).some((t) => types.includes(t));
    const partyOption = (x) => ({ id: x.id, name: `${x.name} (${x.code})` });
    // Non-GL parties are excluded throughout - they can't be billed, the same
    // rule /seaJob/getValues applies to its client list.
    const billable = clients.filter((x) => x.nongl != '1');

    res.json({
      status: 'success',
      result: {
        // `party` is the unfiltered list and is what the charge rows pick
        // from - a charge can be with any party, including one that is
        // neither the client nor a name on the transport document.
        party:     billable.map(partyOption),
        // The client the file is being cleared for. Not filtered to a client
        // tag: a clearing agent's customer may be tagged Shipper, Consignee,
        // both or neither, and hiding a real customer because of a missing
        // tag is worse than offering a longer list. Only a party tagged as
        // nothing but a Terminal is left out - see functions/customsClientList.
        client:    billable.filter((x) => mayBeClient(x.types)).map(partyOption),
        // FROM `clients`, NOT `billable`, as the shipping line below: the
        // shipper is a name on the file (the invoice print, the voucher
        // narration), never a party a charge falls to - no charge defaults to
        // it (PARTY_FIELD_BY_ROLE on the screen). A shipper kept as a Non-GL
        // party was missing from the box (the user, 2026-11-17); the freight
        // job's shipper list has always included them.
        shipper:   clients.filter(hasType('Shipper')).map(partyOption),
        consignee: billable.filter(hasType('Consignee')).map(partyOption),

        // THE ROLE-SPECIFIC LISTS.
        //
        // These four fields used to be handed `party` - every billable party
        // in the book - so the Transport box offered all 12,918 names and a
        // clerk had to know which of them was a haulier. The tags to filter on
        // already existed and simply were not used.
        //
        // Filtering here is safe because it was measured against the legacy
        // book rather than assumed: of the parties CargoLinkers actually used
        // in these roles - 16 hauliers, 21 carriers, 20 clearing agents - EVERY
        // one carries the matching tag, so nothing they pick today disappears.
        // (Terminal was checked the same way and fails it: 9 of the 10 used are
        // untagged. It is a curated list on the screen, not a party.)
        //
        // A party that is missing its tag is still reachable: the screen keeps
        // whatever is already saved on the job in the list - see the `party`
        // helper in CreateOrEdit.js - so a filter can never blank a field.
        localVendor:  billable.filter(hasType('Local Vendor')).map(partyOption),
        chaChb:       billable.filter(hasAny('CHA/CHB', 'Forwarder/Coloader')).map(partyOption),
        transporter:  billable.filter(hasAny('Transporter', 'Trucking')).map(partyOption),
        // Sea and air carriers in one list, for the same reason `port` holds
        // both: transportMode is a field on this form, not a different screen,
        // and swapping the list as the mode changes would blank a carrier the
        // user had already chosen.
        //
        // FROM `clients`, NOT `billable` - the one list here that is not
        // filtered by nongl. A carrier is almost always entered as a Non-GL
        // party, because the agent never bills it and it needs no ledger, and
        // the nongl filter was therefore hiding very nearly the whole list: the
        // field is a NAME ON THE FILE, not somebody being invoiced, so
        // "can this party be posted to?" is the wrong question to ask of it.
        // The charge sheet's party picker still uses `billable`, so a Non-GL
        // carrier reachable here still cannot be charged to.
        shippingLine: clients.filter(hasAny('Shipping Line', 'Air Line')).map(partyOption),
        commodity: commodities.map((x) => ({
          id: x.id,
          name: x.hs ? `${x.name} (${x.hs})` : x.name,
        })),
        // Seaports and airports in ONE list, because transportMode is a field
        // on the job rather than a different screen: an air clearance and a
        // sea clearance are filled in on the same form, and swapping the
        // location list out from under the user as they change the mode would
        // blank a port they had already picked. Both are stored as the CODE,
        // the same shape SE_Job puts in pol/pod.
        //
        // THE NAME ONLY - no "(PKKHI)" suffix. And that is exactly why the
        // list has to be de-duplicated: 2,162 sea ports carry only 2,118
        // distinct names, so dropping the code turns 44 of them into
        // indistinguishable repeats in the dropdown - three identical
        // "MACAU" rows, two "MANCHESTER". With the code shown they were
        // telling apart; without it they are a coin toss.
        //
        // First one wins, and the code is still what gets STORED, so nothing
        // about a saved job changes - only what a person is offered.
        port: disambiguateNames([
          ...ports.filter((x) => !desks.has(x.id)).map((x) => ({ id: x.portId, name: x.portName, kind: 'Sea', where: x.portCountry })),
          ...airports.map((x) => ({ id: x.airportCode, name: x.airportName, kind: 'Air', where: x.city })),
        ]).map(({ where, ...rest }) => rest),
        // The charge master, labelled the way the freight charge screens do:
        // "(code) short".
        charge: charges.map((x) => ({
          id: x.id,
          // The one-line label, for anywhere a charge has to fit on a single
          // row. Kept as it was so nothing that reads it has to change.
          name: `(${x.code}) ${x.short}`,
          // THE SAME TWO PARTS, SEPARATELY - which is what the charge picker
          // needs, and it cannot get them by taking the label above back apart:
          // a code or a short name containing a bracket would split in the
          // wrong place, and the screen would be guessing at something the
          // server already knows.
          code: x.code,
          short: x.short,
          // The full name from Setup > Charges. This is what lands in
          // Charge_Head.particular and what an invoice prints as the line
          // description - "(THC) Terminal" is a picker label, not something a
          // client should read on a bill.
          fullName: x.name,
          currency: x.currency,
          calculationType: x.calculationType,
          defaultRecivableParty: x.defaultRecivableParty,
          defaultPaybleParty: x.defaultPaybleParty,
          // Sales tax on the fee, per Setup > Charges - what a line picking this
          // charge starts with. taxApply is the master's 'Yes' / 'No'.
          taxApply: String(x.taxApply || '').trim().toLowerCase() === 'yes',
          taxPerc: Number(x.taxPerc) || 0,
        })),
        // The vocabularies, served rather than duplicated in the screen, so
        // adding a GD type is one edit here and not two that can drift.
        vocabulary: {
          directions: DIRECTIONS,
          transportModes: TRANSPORT_MODES,
          gdTypes: GD_TYPES,
          channels: CHANNELS,
          // The stored values, offered ones first - the names, colours and
          // rules are /settings/customsStatuses.
          statuses: (await readCustomsStatuses()).job.filter((s) => !s.hidden).map((s) => s.value),
          dutyPaidBy: DUTY_PAID_BY,
          incoTerms: INCO_TERMS,
          // Curated pick lists, by transport mode - see the constants above.
          // Setup > Ports, where ports are ticked as customs ports of loading;
          // the built-in three when none is (functions/customsLoadingPorts).
          polSea: await customsPolSea(require('../../models'), POL_SEA),
          polAir: POL_AIR,
          terminalSea: TERMINAL_SEA,
          terminalAir: TERMINAL_AIR,
          // Shipment type differs by mode - see the constants above.
          cargoTypesSea: CARGO_TYPES_SEA,
          cargoTypesAir: CARGO_TYPES_AIR,
        },
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/* Refuse a save that would approve a receivable before the job is at a status
 * whose rules allow it - On Vessel or DrayOff unless Configuration > Customs
 * says otherwise (see functions/customsCharge, functions/customsStatuses).
 * Checked against the status BEING SAVED, so setting one and approving in the
 * same save is fine. */
const assertReceivableApproval = async (charges, jobId, status, statuses) => {
  const billable = valuesWith(statuses.job, 'billable');
  if (billable.includes(status) || !Array.isArray(charges)) return;
  const before = jobId
    ? await Charge_Head.findAll({ where: { CustomsJobId: jobId, status: '1' }, attributes: ['id'] })
    : [];
  const fresh = newlyApprovedReceivables(charges, new Set(before.map((c) => String(c.id))));
  if (fresh.length) {
    throw new BadRequest(
      `Receivable charges can only be approved once the job is ${billable.map((v) => labelOf(statuses.job, v)).join(' or ')}. `
      + `Set the job's Status to ${billable.length === 1 ? 'it' : 'one of them'}, or leave the ${fresh.length} receivable charge(s) unapproved.`
    );
  }
};

routes.post('/create', async (req, res) => {
  try {
    const data = req.body.data || {};
    if (Array.isArray(data.charges) && !(await allowsPart(req, CHARGE_EDIT, 'charges'))) delete data.charges;
    if (Array.isArray(data.charges)) data.charges = (await guardChargeRights(req, data.charges, null)).charges;

    /* A REAL COMPANY, or nothing is saved. A job saved by a user with none
     * picked went in with a blank companyId and was hidden from everyone
     * working in a company - see functions/companyCodes. */
    const companyId = await realCompanyId(data.companyId);
    if (!companyId) throw new BadRequest(NO_COMPANY);
    data.companyId = companyId;
    await assertClientAllowed(req, { clientId: data.clientId });

    const fiscalYear = await resolveSelectedFiscalYear(data.fiscalYearId);
    const fySuffix = fiscalYear.suffix;
    const company = await companyShort(data.companyId);
    const numbering = await readNumbering();

    // Per-fiscal-year sequence, found by jobId - never by the code or company
    // prefix in jobNo, which Config > Document Numbers can change - so the
    // sequence carries on through any change there. Per company while jobs
    // carry the prefix, shared when they do not. See functions/documentNumber.
    const last = await lastInYear(Customs_Job, {
      seqCol: 'jobId',
      noCol: 'jobNo',
      suffix: fySuffix,
      company: { column: 'companyId', id: String(data.companyId) },
      scoped: perCompany(numbering, 'jobs'),
    });
    const nextJobId = nextAfter(last, 'jobId');

    const statuses = await readCustomsStatuses();
    const values = jobValues(data, statuses);
    await assertReceivableApproval(data.charges, null, values.status, statuses);
    await assertNoRepeatedSheetCharges(data.charges, null);
    await assertUniqueNumbers({ values, companyId: data.companyId });
    const result = await Customs_Job.create({
      ...values,
      jobId: nextJobId,
      jobNo: formatNumber(numbering, {
        klass: 'jobs', company, code: codeFor(numbering, 'jobs', 'CC'), seq: nextJobId, suffix: fySuffix,
      }),
      companyId: String(data.companyId),
      FiscalYearId: fiscalYear.id,
    });

    await saveDutyLines(data.dutyLines, result.id);
    await saveContainers(data.containerRows, result.id);
    await saveCharges(data.charges, result.id, values);
    createHistory(req.body.employeeId, 'Customs Job', 'Create', result.jobNo);
    res.json({ status: 'success', result: withTotals(await getJob(result.id)) });
  } catch (error) {
    fail(res, error);
  }
});

routes.post('/edit', async (req, res) => {
  try {
    const data = req.body.data || {};
    if (Array.isArray(data.charges) && !(await allowsPart(req, CHARGE_EDIT, 'charges'))) delete data.charges;
    const id = asId(data.id);
    if (!id) {
      return res.status(400).json({ status: 'error', result: `Not a valid customs job id: ${data.id}` });
    }
    // Nor saved by a user with no company picked. The edit never changes the
    // job's company (jobValues has none) - this is the same rule as create.
    if (!(await realCompanyId(data.companyId))) {
      return res.status(400).json({ status: 'error', result: NO_COMPANY });
    }

    // exRate comes along because the invoiced branch below still saves charges
    // and a charge falls back to the JOB's rate - the stored one, not whatever
    // a rejected edit happened to send.
    const existing = await Customs_Job.findOne({
      where: { id },
      attributes: [
        'id', 'jobNo', 'canceled', 'exRate', 'status', 'clientId', 'companyId',
        // What it holds now - a number it already has is never a duplicate
        // of itself (functions/customsJobUnique).
        'gdNumber', 'clientRef', 'invoiceNo', 'jobRef',
      ],
    });
    if (!existing) return res.status(404).json({ status: 'error', result: 'Customs job not found.' });
    const guard = await guardChargeRights(req, data.charges, id);
    data.charges = guard.charges;
    const { holdInvoiced } = guard;

    /* CHARGES ONLY - someone who may change a job's charges but not the job
     * itself (the user's request, 2026-10-10: job details and job charges
     * apart). The charge sheet is saved, as it stands on the stored job, and
     * nothing else the screen sent is read. In audit mode allowsPart logs and
     * lets the whole save through, as every other refusal does there. */
    if (!existing.canceled && !(await allowsPart(req, ['customs:edit'], 'job'))) {
      if (!Array.isArray(data.charges)) {
        return res.status(403).json({ status: 'error', result: 'You do not have permission to change this job.' });
      }
      const statuses = await readCustomsStatuses();
      await assertReceivableApproval(data.charges, id, existing.status, statuses);
      await assertNoRepeatedSheetCharges(data.charges, id, { holdInvoiced });
      const { skipped, held } = await saveCharges(data.charges, id, existing, { holdInvoiced });
      createHistory(req.user?.id || req.body.employeeId, 'Customs Job', 'Edit Charges', existing.jobNo);
      const note = withHeld(skipped ? `${skipped} charge(s) on an approved invoice were left alone.` : null, held);
      return res.json({
        status: 'success',
        result: { ...withTotals(await getJob(id)), invoiced: await isInvoiced(id) },
        ...(note ? { warning: note } : {}),
      });
    }

    /* A CANCELLED JOB: ITS STATUS, AND NOTHING ELSE. Everything else on the
     * screen stays disabled, and is not read here either. Any status but
     * Canceled reopens the job - one cancelled by mistake came back no other
     * way. Cancelling is refused on an invoiced job, so a cancelled one has
     * nothing billed against it to protect. */
    if (existing.canceled) {
      const statuses = await readCustomsStatuses();
      const status = asStatus(data.status, statuses.job);
      if (status !== 'Canceled') {
        await Customs_Job.update({ status, canceled: false }, { where: { id } });
        createHistory(req.user?.id || req.body.employeeId, 'Customs Job', 'Reopen', existing.jobNo);
      }
      return res.json({
        status: 'success',
        result: { ...withTotals(await getJob(id)), invoiced: await isInvoiced(id) },
        ...(status === 'Canceled'
          ? { warning: 'This job is cancelled, so nothing was changed. Choose another status to reopen it.' }
          : {}),
      });
    }

    const statuses = await readCustomsStatuses();
    const values = jobValues(data, statuses);
    await assertClientAllowed(req, { clientId: values.clientId, previousClientId: existing.clientId });
    await assertReceivableApproval(data.charges, id, values.status, statuses);
    await assertNoRepeatedSheetCharges(data.charges, id, { holdInvoiced });
    let warning;
    const invoiced = await isInvoiced(id);

    /* UNLOCKED: a CEO, CFO or admin saving an invoiced declaration after
     * pressing Unlock (/unlock). Checked HERE, on the save itself, not only
     * when the button was pressed - the screen's flag is a request, and a
     * stale tab or anything posting straight at this route must not get
     * through the freeze by setting it. Refused out loud rather than quietly
     * downgraded to the frozen save, which would look like it had worked. */
    const unlockedSave = invoiced && data.unlocked === true;
    if (unlockedSave && !hasDesignation(req, UNLOCKERS)) {
      return res.status(403).json({
        status: 'error',
        result: `Only ${UNLOCKERS.join(', ')} can change a job that has been invoiced.`,
      });
    }
    // The numbers no two jobs may share - only where the declaration itself is
    // saved; a frozen (invoiced) one keeps the numbers it has.
    if (!invoiced || unlockedSave) {
      await assertUniqueNumbers({ values, companyId: existing.companyId, previous: existing, excludeId: id });
    }

    if (unlockedSave) {
      /* The whole declaration, as on an uninvoiced job. Charges still go
       * through saveCharges, which leaves every line on an APPROVED invoice
       * alone: unlocking the job does not unlock an issued document - that is
       * still un-approving the invoice. */
      await Customs_Job.update(values, { where: { id } });
      await saveDutyLines(data.dutyLines, id);
      await saveContainers(data.containerRows, id);
      const { skipped, held } = await saveCharges(data.charges, id, values, { holdInvoiced });
      if (skipped) {
        warning = `${skipped} charge(s) on an approved invoice were left alone - un-approve the invoice to change them.`;
      }
      warning = withHeld(warning, held);
      // Its own entry, apart from the ordinary Edit, so the special change can
      // be found - and by the signed-in user, not a name the request carries.
      // Awaited, as the Edit below: the History row is the record of this
      // save, and one read straight after the reply must find it. Unawaited,
      // it lost the race on a slow CI runner (v1.2.58's tag build).
      await createHistory(req.user?.id || req.body.employeeId, 'Customs Job', 'Edit (unlocked)', existing.jobNo);
    } else if (invoiced) {
      /* THE DECLARATION IS FROZEN. THE CHARGES ARE NOT.
       *
       * Billing one charge must not close the file: a clearing agent bills as
       * costs arrive, so a job frequently has an invoice raised on the first
       * few charges while more are still being entered, approved and billed on
       * a second invoice. Refusing every charge change once ANY of them was
       * invoiced made the second invoice impossible - which is how this was
       * found.
       *
       * What stays frozen is the declaration and its duty: those are the
       * figures an issued invoice was computed from, and changing them
       * afterwards would leave the file saying one thing and the invoice
       * another.
       *
       * saveCharges is safe to call here WITHOUT a second guard, and that is
       * not an assumption - it deletes only rows with InvoiceId null and
       * creates only rows that carry none, so an invoiced line cannot be
       * edited, renumbered or removed by anything the screen sends. It reports
       * how many it left alone. */
      await Customs_Job.update(
        { remarks: values.remarks, status: values.status },
        { where: { id } }
      );
      const { skipped, held } = await saveCharges(data.charges, id, existing, { holdInvoiced });
      warning = withHeld(
        'This job has been invoiced, so the declaration and its duty were not changed'
        + (skipped ? `, and ${skipped} already-invoiced charge(s) were left alone` : '')
        + '. Charges were saved. Un-approve the invoice first if the declaration '
        + 'itself really needs changing.',
        held,
      );
    } else {
      // jobNo/jobId are assigned once at create; letting an edit rewrite them
      // would renumber a document people have already filed against. They are
      // not in jobValues() at all, so there is nothing to delete here.
      await Customs_Job.update(values, { where: { id } });
      await saveDutyLines(data.dutyLines, id);
      await saveContainers(data.containerRows, id);
      const { held } = await saveCharges(data.charges, id, values, { holdInvoiced });
      warning = withHeld(warning, held);
    }

    if (!unlockedSave) await createHistory(req.body.employeeId, 'Customs Job', 'Edit', existing.jobNo);
    res.json({
      status: 'success',
      result: { ...withTotals(await getJob(id)), invoiced: await isInvoiced(id) },
      // Said out loud rather than swallowed: an edit that was silently ignored
      // is exactly the kind of thing nobody notices until a total disagrees
      // with an invoice.
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    fail(res, error);
  }
});

/**
 * Unlock an invoiced declaration for one save - CEO, CFO and admin only.
 *
 * Once a charge reaches an approved invoice the declaration freezes (see
 * isInvoiced and /edit); the only way back was to un-approve the invoice,
 * which takes it out of the ledger. This lets the three who answer for the
 * books correct the file in place.
 *
 * It changes nothing on its own: the job is not marked unlocked for anyone
 * else, and the save that follows is checked again in /edit. What it does is
 * leave a record - its own History entry, "Unlock", by the signed-in user -
 * so a special change to an invoiced job can always be traced to who made it.
 */
routes.post('/unlock', requireDesignation(UNLOCKERS), async (req, res) => {
  try {
    const id = asId(req.body.id);
    if (!id) {
      return res.status(400).json({ status: 'error', result: `Not a valid customs job id: ${req.body.id}` });
    }
    const job = await Customs_Job.findOne({ where: { id }, attributes: ['id', 'jobNo', 'canceled'] });
    if (!job) return res.status(404).json({ status: 'error', result: 'Customs job not found.' });
    if (job.canceled) {
      return res.status(409).json({ status: 'error', result: 'A cancelled job cannot be unlocked.' });
    }
    if (!(await isInvoiced(id))) {
      return res.status(409).json({ status: 'error', result: 'This job is not locked - it has no approved invoice.' });
    }
    await createHistory(req.user?.id || req.body.employeeId, 'Customs Job', 'Unlock', job.jobNo);
    res.json({ status: 'success', result: { id: job.id, jobNo: job.jobNo } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

// Soft delete, matching how a sea job is cancelled rather than removed - the
// job number stays spent so the sequence has no holes in it.
routes.post('/delete', async (req, res) => {
  try {
    const id = asId(req.body.id);
    if (!id) {
      return res.status(400).json({ status: 'error', result: `Not a valid customs job id: ${req.body.id}` });
    }
    // Refused rather than cascaded. Cancelling a GD whose charges are on an
    // issued invoice would leave that invoice billing a file that says it
    // never happened.
    if (await isInvoiced(id)) {
      return res.status(409).json({
        status: 'error',
        result: 'This job has invoiced charges, so it cannot be cancelled. ' +
                'Un-approve and remove the invoice first.',
      });
    }
    const job = await Customs_Job.findOne({ where: { id }, attributes: ['jobNo'] });
    await Customs_Job.update({ canceled: true, status: 'Canceled' }, { where: { id } });
    createHistory(req.body.employeeId, 'Customs Job', 'Delete', job?.jobNo);
    res.json({ status: 'success', result: 'Customs job cancelled.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The duty register.
 *
 *   GET /customsJob/register?month=YYYY-MM&companyId=1
 *
 * Every GD filed in a month, its duty broken down by head, and what the agent
 * is owed back. This is the return a clearing agent reconciles against its own
 * bank: duty paid by the agent leaves the account on the day the PSID is paid
 * and comes back on an invoice, and the gap between those two figures is the
 * money currently out with clients.
 *
 * Filed date is gdDate, NOT createdAt - a GD entered into the system a week
 * late still belongs to the month it was filed in, and any other answer makes
 * the register disagree with the customs portal it is checked against.
 */
routes.get('/register', async (req, res) => {
  try {
    const month = String(req.query.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ status: 'error', result: 'month must be YYYY-MM.' });
    }

    const where = { gdDate: { [Op.like]: `${month}-%` }, canceled: false };
    if (req.query.companyId) where.companyId = String(req.query.companyId);
    if (req.query.direction) where.direction = String(req.query.direction);

    const jobs = await Customs_Job.findAll({
      where,
      include: [
        { model: Clients, as: 'client', attributes: partyAttrs, required: false },
        // NOT optional. Every duty figure this report prints is derived from
        // these lines - without the include they are simply absent, and the
        // register would total a month at zero and look like a quiet month
        // rather than a broken query.
        { model: Customs_Duty, required: false },
      ],
      order: [['gdDate', 'ASC'], [Customs_Duty, 'sortOrder', 'ASC']],
    });

    const rows = jobs.map((j) => {
      const plain = j.toJSON();
      return {
        id: plain.id,
        jobNo: plain.jobNo,
        gdNumber: plain.gdNumber,
        gdDate: plain.gdDate,
        gdType: plain.gdType,
        channel: plain.channel,
        direction: plain.direction,
        transportMode: plain.transportMode,
        client: plain.client?.name || '',
        blNo: plain.blNo,
        assessedValue: num(plain.assessedValue),
        duty: dutyBreakdown(plain),
        totalDuty: totalDuty(plain),
        reimbursable: reimbursableDuty(plain),
        dutyPaidBy: plain.dutyPaidBy,
        psid: plain.psid,
        status: plain.status,
      };
    });

    // Totals over the whole month, plus the two splits a register is read for:
    // which channel the files went into, and who paid the duty.
    const byChannel = {};
    const totals = { assessedValue: 0, totalDuty: 0, reimbursable: 0 };
    for (const r of rows) {
      totals.assessedValue += r.assessedValue;
      totals.totalDuty += r.totalDuty;
      totals.reimbursable += r.reimbursable;
      // An unassessed GD counts as 'Unassigned' rather than being dropped, so
      // the channel counts always add up to the number of rows above them.
      const key = r.channel || 'Unassigned';
      byChannel[key] = (byChannel[key] || 0) + 1;
    }

    res.json({ status: 'success', result: { month, rows, totals, byChannel } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The customs dashboard.
 *
 *   GET /customsJob/dashboard?companyId=1
 *
 * WHY THIS EXISTS. The home page had two branches - aviation, and everything
 * else - so a customs install got the FREIGHT dashboard: FCL and LCL counted
 * off SE_Job against two hardcoded company ids labelled "Sea Net Shipping" and
 * "Air Cargo Service". A clearing agent files declarations and owns neither of
 * those companies, so every counter on it read zero, for ever. It was not
 * showing bad numbers, it was showing nobody's numbers.
 *
 * WHAT A CLEARING AGENT ACTUALLY WATCHES, and why each is here:
 *
 *   FILED       declarations by period. The unit of work - one GD, one job.
 *   DIRECTION   import against export. The two are different businesses inside
 *               the same office and post to different ledger accounts.
 *   CHANNEL     Green / Yellow / Red. Which way the month's files went is the
 *               first thing asked about a customs book, because Red means
 *               examination and examination means delay.
 *   DUTY        this month's total, and the reimbursable part of it. That
 *               second figure is money the agent has PAID OUT on clients'
 *               behalf and is waiting to recover - the number a clearing
 *               agent's cash position actually turns on.
 *   INCOMPLETE  filed but not cleared. The working list, and the closest thing
 *               here to aviation's pending loads: a file nobody has finished.
 *
 * PERIODS ARE KEYED ON gdDate, NOT createdAt - the same rule the duty register
 * uses. A GD entered a week late still belongs to the month it was FILED in,
 * and any other answer makes this disagree with both the register and the
 * customs portal the office reconciles against.
 */
routes.get('/dashboard', requireWidget('jobCounters'), async (req, res) => {
  try {
    const companyId = req.query.companyId ? String(req.query.companyId) : null;
    const scope = companyId ? { companyId } : {};

    // On Pakistan's clock: the servers run in UTC, so before 5 am here their
    // "today" is still yesterday - and on a Monday or a 1st, so is the week or
    // the month. TODAY replaced the year on the dashboard (the user,
    // 2026-11-23).
    const now = moment().utcOffset(PK_OFFSET_MINUTES);
    const day = (m) => m.format('YYYY-MM-DD');
    const periods = {
      today: { from: day(now), to: day(now) },
      week:  { from: day(now.clone().startOf('isoWeek')), to: day(now.clone().endOf('isoWeek')) },
      month: { from: day(now.clone().startOf('month')),   to: day(now.clone().endOf('month')) },
    };
    // Bounded at BOTH ends: a GD dated next year is not part of this one, and
    // a mistyped date should not quietly inflate the current period.
    const inPeriod = (p) => ({ [Op.between]: [p.from, p.to] });

    // Cancelled files are excluded everywhere below. A cancelled declaration
    // was never filed, so counting it would overstate the month's work and
    // its duty.
    const live = { ...scope, canceled: false };

    const filedIn = (p) => Customs_Job.count({
      where: { ...live, gdDate: inPeriod(p) },
    });

    const [today, week, month] = await Promise.all([
      filedIn(periods.today), filedIn(periods.week), filedIn(periods.month),
    ]);

    // This month's files, with their duty lines - the same include the
    // register uses, and for the same reason: every duty figure below is
    // DERIVED from those lines, so without them the month totals zero and
    // reads as a quiet month rather than a broken query.
    const monthJobs = await Customs_Job.findAll({
      where: { ...live, gdDate: inPeriod(periods.month) },
      include: [{ model: Customs_Duty, required: false }],
    });

    const byDirection = { Import: 0, Export: 0 };
    const byChannel = {};
    // NOT named totalDuty: that is the imported function this loop calls, and
    // shadowing it here would make the second iteration a TypeError.
    let dutyTotal = 0;
    let reimbursableTotal = 0;
    let assessedTotal = 0;

    for (const job of monthJobs) {
      const plain = job.toJSON();
      if (byDirection[plain.direction] !== undefined) byDirection[plain.direction] += 1;
      // An unassessed GD counts as 'Unassigned' rather than being dropped, so
      // the channel counts always add up to the month's filings.
      const channel = plain.channel || 'Unassigned';
      byChannel[channel] = (byChannel[channel] || 0) + 1;

      dutyTotal += totalDuty(plain);
      reimbursableTotal += reimbursableDuty(plain);
      assessedTotal += num(plain.assessedValue);
    }

    // Filed and not finished, all-time rather than this month: a file left
    // open in March is more worth seeing in April, not less.
    const incomplete = await Customs_Job.count({
      // Finished is what Configuration > Customs says is - On Vessel, DrayOff
      // and Canceled to begin with. A cancelled file is never open either.
      where: { ...live, status: { [Op.notIn]: [...new Set([...valuesWith((await readCustomsStatuses()).job, 'finished'), 'Canceled'])] } },
    });

    res.json({
      status: 'success',
      result: {
        periods,
        filed: { today, week, month },
        month: {
          byDirection,
          byChannel,
          // Rounded here rather than in the browser: these are sums of
          // per-line arithmetic and carry float noise a screen would print.
          assessedValue: Math.round(assessedTotal * 100) / 100,
          totalDuty: Math.round(dutyTotal * 100) / 100,
          reimbursable: Math.round(reimbursableTotal * 100) / 100,
        },
        incomplete,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Raise invoices from selected charges.
 *
 * Body: { chargeIds: [], companyId, fiscalYearId, employeeId, approve,
 *         approveChargeIds: [] }
 *
 * `approveChargeIds` - the ticked CHARGES to approve as they are invoiced (the
 * user, 2026-11-11: create, save, approve, save, invoice was too many steps).
 * The sheet sends the ones the Approve tag would let this user approve; here
 * they are held to the same two rules a save is - the right to approve job
 * charges, and a receivable only once the job is at a billable status - then
 * approved, before anything is raised. A charge left unapproved and not in
 * this list is still refused, as before.
 *
 * `approve: true` raises them APPROVED - "Invoice & approve" on the charge
 * sheet (the user's request, 2026-10-15): each is posted to the ledger as it is
 * raised, through the same approveInvoice /invoice/approve uses. Without it
 * they are raised unapproved, as below. Needs the approve right - see the
 * route's rule.
 *
 * The selection is GROUPED, not assumed homogeneous. One invoice can only
 * carry one party and one direction - a receivable owed by A and a payable
 * owed to B are two different documents - so the selected charges are
 * bucketed by (type, party) and one invoice is raised per bucket. Selecting a
 * whole job therefore does the sensible thing in one click instead of
 * erroring. (Not by currency: every customs invoice is in PKR - see below.)
 *
 * Numbering, type and party resolution deliberately mirror
 * /invoice/makeInvoiceNew and /aviationJob/makeInvoice:
 *   - receivable -> 'Job Invoice', JI series;  payable -> 'Job Bill', JB
 *   - the number is company-init-N/fiscalYearSuffix, N from the last of that
 *     type in this fiscal year
 *   - party_Id is the LEDGER account (Client_Associations.ChildAccountId), not
 *     the client id. Get this wrong and the invoice never reaches the ledger.
 */
routes.post('/makeInvoice', async (req, res) => {
  try {
    const { chargeIds, companyId, fiscalYearId, employeeId } = req.body;
    const approveNow = req.body?.approve === true;
    if (!Array.isArray(chargeIds) || !chargeIds.length) {
      return res.status(400).json({ status: 'error', result: 'No charges selected.' });
    }
    /* RAISING IS NOT APPROVING (the user's request, 2026-10-20). The route
       rule lets anyone who may raise an invoice in; "Invoice & approve" posts
       it to the ledger as well, which is the Approve right on the job's
       invoices. Refused before anything is raised, so it never half-happens. */
    if (approveNow && !(await allowsPart(req, INVOICE_APPROVE, 'approve'))) {
      return res.status(403).json({
        status: 'error',
        result: 'You can raise invoices but not approve them. Use Invoice instead - someone who can approve invoices will approve it.',
      });
    }

    const charges = await Charge_Head.findAll({
      where: {
        id: chargeIds,
        CustomsJobId: { [Op.ne]: null },
      },
    });
    if (!charges.length) {
      return res.status(400).json({ status: 'error', result: 'None of those charges could be found.' });
    }

    // Refuse rather than silently re-bill. A charge already on an invoice is
    // part of an issued document.
    const alreadyBilled = charges.filter((c) => c.InvoiceId);
    if (alreadyBilled.length) {
      return res.status(409).json({
        status: 'error',
        result: `${alreadyBilled.length} of the selected charges are already invoiced.`,
      });
    }
    // APPROVED AS THEY ARE INVOICED - see approveChargeIds above. Only charges
    // that were asked for, are among those being invoiced, and still need it.
    const askedToApprove = new Set(
      (Array.isArray(req.body?.approveChargeIds) ? req.body.approveChargeIds : []).map(String),
    );
    const toApprove = charges.filter((c) => String(c.status) !== '1' && askedToApprove.has(String(c.id)));
    if (toApprove.length) {
      if (!(await allowsPart(req, CHARGE_APPROVE, 'charge approval'))) {
        return res.status(403).json({
          status: 'error',
          result: `${toApprove.length} of the selected charges are not approved yet, and approving charges needs `
            + 'the right to approve job charges. Ask someone who may approve them, or untick them.',
        });
      }
      // The rule a save is held to (assertReceivableApproval): a receivable
      // only once its job is at a billable status - On Vessel or DrayOff
      // unless Configuration > Customs says otherwise.
      const receivables = toApprove.filter((c) => c.type !== CH_PAYABLE);
      if (receivables.length) {
        const statuses = await readCustomsStatuses();
        const billable = valuesWith(statuses.job, 'billable');
        const jobs = await Customs_Job.findAll({
          where: { id: [...new Set(receivables.map((c) => c.CustomsJobId))] },
          attributes: ['id', 'status'],
        });
        const statusOf = new Map(jobs.map((j) => [String(j.id), j.status]));
        const early = receivables.filter((c) => !billable.includes(statusOf.get(String(c.CustomsJobId))));
        if (early.length) {
          return res.status(400).json({
            status: 'error',
            result: `Receivable charges can only be approved once the job is `
              + `${billable.map((v) => labelOf(statuses.job, v)).join(' or ')}. Set the job's Status, `
              + `or untick the ${early.length} receivable charge(s) that are not approved yet.`,
          });
        }
      }
    }
    const approving = new Set(toApprove.map((c) => c.id));
    const unapproved = charges.filter((c) => String(c.status) !== '1' && !approving.has(c.id));
    if (unapproved.length) {
      return res.status(400).json({
        status: 'error',
        result: `${unapproved.length} of the selected charges are not approved yet.`,
      });
    }
    const noParty = charges.filter((c) => !c.partyId);
    if (noParty.length) {
      return res.status(400).json({
        status: 'error',
        result: `${noParty.length} of the selected charges have no party to bill.`,
      });
    }

    const fiscalYear = await resolveSelectedFiscalYear(fiscalYearId);
    const suffix = fiscalYear.suffix;
    const company = await companyShort(companyId);
    const numbering = await readNumbering();

    // Every check has passed: approve them, stamped as the sheet's Approve tag
    // stamps a line (who, and the day), then raise as below.
    if (toApprove.length) {
      await Charge_Head.update(
        {
          status: '1',
          approved_by: String(employeeId ?? req.user?.id ?? '') || null,
          approval_date: new Date().toISOString().slice(0, 10),
        },
        { where: { id: toApprove.map((c) => c.id) } },
      );
      createHistory(employeeId, 'Charges', 'Approve', `${toApprove.length} charge(s), as invoiced`);
    }

    /* One invoice per DIRECTION and PARTY - not per currency. A customs
     * invoice is always issued in PKR from each line's local_amount (below),
     * so the lines' own currencies have no say in it. Keying on currency too
     * split one client's charges across two invoices whenever they differed -
     * and they did as a matter of course: a line imported from a charge group
     * whose currency box was left empty carries no currency, a line picked by
     * hand carries the charge master's "PKR". */
    const buckets = new Map();
    for (const c of charges) {
      const key = `${c.type}|${String(c.partyId).trim()}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(c);
    }

    const created = [];
    for (const group of buckets.values()) {
      const first = group[0];
      const receivable = first.type !== CH_PAYABLE;
      const type = receivable ? 'Job Invoice' : 'Job Bill';

      // The same "last of this type this year" lookup makeInvoiceNew uses -
      // by type and invoice_Id, so it carries on through any change in
      // Config > Document Numbers. See functions/invoiceNumber.
      const last = await lastInvoiceInYear(Invoice, { type, companyId, suffix, settings: numbering });
      const nextId = last?.invoice_Id ? Number(last.invoice_Id) + 1 : 1;

      // The ledger account behind the party. Without it the invoice exists but
      // posts nowhere, which is worse than failing.
      const account = await Client_Associations.findOne({ where: { ClientId: first.partyId } });
      if (!account?.ChildAccountId) {
        return res.status(400).json({
          status: 'error',
          result: `${first.name || 'A party'} has no ledger account, so it cannot be invoiced. ` +
                  `Attach one in Setup > Parties.`,
        });
      }

      const total = group.reduce((t, c) => t + num(c.local_amount), 0);
      const invoice = await Invoice.create({
        invoice_No: invoiceNumber(numbering, { type, company, seq: nextId, suffix }),
        invoice_Id: nextId,
        type,
        status: '1',
        // The operation code that marks an invoice as customs clearance work.
        // The freight codes are SE/SI/AE/AI and aviation is AV; CC is what the
        // report filters offer for this module.
        operation: 'CC',
        payType: first.type,
        party_Id: account.ChildAccountId,
        party_Name: first.name,
        // Job Invoice/Bill are held in local currency, as on the freight side;
        // local_amount is already converted at the charge's own ex-rate.
        currency: 'PKR',
        ex_rate: '1',
        total: String(total),
        partyType: first.partyType,
        companyId: String(companyId),
        FiscalYearId: fiscalYear.id,
        SEJobId: null,
      });

      await Charge_Head.update(
        { InvoiceId: invoice.id, invoice_id: invoice.invoice_No, invoiceType: type, status: '1' },
        { where: { id: group.map((c) => c.id) } }
      );

      createHistory(employeeId, 'Invoice', 'Create', invoice.invoice_No);

      // Asked for approved: posted now, as aviation raises its invoices. A
      // posting failure keeps the invoice, unapproved, and says why - it is
      // approvable by hand once the cause (usually an account) is fixed.
      if (approveNow) {
        let postError = null;
        try {
          await require('../invoice').approveInvoice({ id: invoice.id, fiscalYearId, employeeId });
        } catch (e) {
          postError = e.message || String(e);
          console.error(`[customs] ${invoice.invoice_No} raised but not posted:`, e);
        }
        created.push({
          id: invoice.id,
          invoice_No: invoice.invoice_No,
          type,
          total,
          lines: group.length,
          approved: !postError,
          ...(postError ? { postError } : {}),
        });
        continue;
      }

      // RAISED UNAPPROVED - invoices AND bills. Nothing a customs job raises
      // reaches the ledger until someone approves it: the director signs a
      // client's invoice and sends it, and checks a vendor's bill, before
      // either counts. Approved by hand from Accounts > Invoice/Bills or the
      // charge sheet's Approve Invoices, which post it through the same
      // approveInvoice /invoice/approve uses.
      //
      // Until 1.2.33 they were raised approved, so they hit the ledger the
      // moment they were made.
      created.push({
        id: invoice.id,
        invoice_No: invoice.invoice_No,
        type,
        total,
        lines: group.length,
        approved: false,
        awaitingApproval: true,
      });
    }

    // approvedCharges: how many charges were approved on the way, for the
    // sheet to say so.
    res.json({ status: 'success', result: created, approvedCharges: toApprove.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Tracing notes on a declaration.
 *
 * REUSES Job_notes rather than adding a customs table. That model is already
 * keyed by a (recordId, type) pair rather than a foreign key - which is what
 * lets the sea and air screens share it - so customs is one more `type`, not a
 * new shape. NOTE_TYPE is its own value so a customs note can never collide
 * with a sea job that happens to share an id.
 *
 * Distinct from Customs_Job.remarks: remarks is ONE note on the file that gets
 * overwritten, these are a dated running log by whoever added them.
 */
const NOTE_TYPE = 'CC';

routes.post('/notes', async (req, res) => {
  try {
    const id = asId(req.body?.id);
    if (!id) {
      return res.status(400).json({ status: 'error', result: 'A valid customs job id is required.' });
    }
    const result = await Job_notes.findAll({
      where: { type: NOTE_TYPE, recordId: String(id) },
      order: [['createdAt', 'DESC']],
    });
    res.json({ status: 'success', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/addNote', async (req, res) => {
  try {
    const id = asId(req.body?.id);
    const title = String(req.body?.title || '').trim();
    const note = String(req.body?.note || '').trim();
    // Both required by the model (notEmpty), so they are checked here to
    // answer 400 rather than let a validation error surface as a 500.
    if (!id) {
      return res.status(400).json({ status: 'error', result: 'A valid customs job id is required.' });
    }
    if (!title || !note) {
      return res.status(400).json({ status: 'error', result: 'A note needs a title and a body.' });
    }
    const result = await Job_notes.create({
      recordId: String(id),
      type: NOTE_TYPE,
      title,
      note,
      createdBy: String(req.body?.createdBy || 'Unknown'),
      opened: '0',
    });
    createHistory(req.body?.employeeId, 'Customs Job', 'Add Note', title);
    res.json({ status: 'success', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

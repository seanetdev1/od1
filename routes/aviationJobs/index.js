// Aviation jobs: a flight, the consignments on it, and their charges.
//
// The job and consignment tables are aviation's own. CHARGES ARE NOT: an
// aviation charge is a Charge_Head, the same table the freight side uses, so
// it is invoiced, posted to the ledger and printed by exactly the same code.
// Nothing here writes SE_Job or Bl, so the freight job screens are unaffected.
const { Aviation_Job, Aviation_Consignment, Aviation_Carrier, Aviation_Aircraft, Aviation_Awb, Aviation_Pfm } = require("../../functions/Associations/aviationAssociations");
const { Charge_Head, Invoice, Invoice_Transactions, Vouchers } = require("../../functions/Associations/incoiceAssociations");
const { Clients, Client_Associations } = require("../../functions/Associations/clientAssociation");
const { Commodity, Airports, Charges } = require("../../models");
const db = require("../../models");
// Setup > Carriers gives a carrier the party its charges are billed to. The
// chart-of-accounts side is shared with Setup > Parties so the two cannot hand
// out the same ledger code - see the file.
const { Child_Account } = require("../../functions/Associations/accountAssociations");
const { ensureCarrierParty } = require("../../functions/carrierParty");
const { resolveSelectedFiscalYear } = require("../../functions/Associations/fiscalYearAssociations");
const { companyShort, isCompanyId, realCompanyId, NO_COMPANY } = require('../../functions/companyCodes');
// Job and invoice numbers, laid out by Config > Document Numbers.
const {
  readNumbering, lastInYear, nextAfter, perCompany, formatNumber,
} = require('../../functions/documentNumber');
const { lastInvoiceInYear, invoiceNumber } = require('../../functions/invoiceNumber');
const { createHistory } = require("../../functions/history");
const { buildReport } = require("../../functions/aviationReport");
// The per-flight summary - one row per flight, offloads split by tag. Sits
// beside the sector report rather than replacing it; see the module.
const { buildFlightSummary } = require("../../functions/aviationFlightSummary");
// The sales report - one row per AWB, buying against selling. Pure arithmetic;
// the route selects the AWBs and flattens them. See the module.
const { buildSalesReport } = require("../../functions/aviationSalesReport");
// Cargo that was offloaded and never put on a later flight. Pure arithmetic,
// kept out of the route so it can be tested without a database.
const {
  pendingLoads, bookedFromOffload, carryInByLeg, carryInOf, flownWeightOf, prevLegByLeg,
} = require("../../functions/aviationPendingLoads");
const moment = require("moment");
// Charge pricing, kept out of the route so it is testable without a database.
const { chargeValues, isRealCharge, isInvoiceLocked, chargeOption, CH_PAYABLE, num } = require("../../functions/aviationCharge");
const { carriedStamps } = require("../../functions/auditStamps");

// A JOB'S CHARGES ARE jobCharges' (the user's request, 2026-10-10). A save
// carries the job and its charge sheet together; someone who may edit the job
// but not its charges saves the job, and the charges stay as they were.
// Refused in enforce mode, logged in audit - functions/permissions allowsPart.
const { allowsPart } = require('../../functions/permissions/middleware');
const CHARGE_EDIT = ['jobCharges:edit', 'invoices:edit'];
// Since 2026-10-20 a charge LINE's approval and a line already on an invoice
// each have a right of their own - see functions/chargeRights.
const CHARGE_APPROVE = ['jobCharges:approve', 'invoices:approve'];
const INVOICE_EDIT = ['jobInvoices:edit', 'invoices:edit'];
const { chargeRightsNeeded, holdApprovals } = require('../../functions/chargeRights');
// Rates may still be corrected until the flight's fortnight closes; after that
// the period has been reconciled and they are fixed. See the module.
const { ratesOpen, fortnightEnd } = require("../../functions/aviationFortnight");
// One spelling per AWB number, decided here rather than trusted from the
// screen - the outstanding-loads list and /relatedCharges both match legs by
// this exact string. See the module.
const { normalizeAwb, formatNumber: formatAwb } = require("../../functions/awb");
// GAM / IFA / Other - the tag that decides which column of the monthly report
// a consignment's weight lands in, and the one place that still knows 'ER' was
// its old spelling. See the module.
const carrierCategory = require("../../functions/carrierCategory");
// Draft / Confirmed / Cancelled, and the one rule that says which plans a
// flight may be built from. Read here so a stale tab cannot attach a plan
// that was cancelled while it was open - see pfmAttachmentError.
const pfmStatus = require("../../functions/aviationPfmStatus");
// The approval + ledger posting that /invoice/approve performs. Reused rather
// than reimplemented so aviation and freight invoices reach the books through
// exactly the same code. No cycle: routes/invoice pulls in the aviation
// ASSOCIATIONS, not this router.
const { approveInvoice } = require("../invoice");
const routes = require('express').Router();
// The home page's job counters - Configuration > Dashboard Widgets.
const { requireWidget } = require('../../functions/dashboardWidgets');
const Sequelize = require('sequelize');
const Op = Sequelize.Op;

/* --------------------- what currency an aviation charge is ---------------------
 * An airline's charges are priced in DOLLARS: the space is bought and sold in
 * them, and the AWB's ex-rate exists precisely to convert that into the books'
 * currency. So a charge that names no currency is a USD charge that nobody
 * bothered to label, not a local one - and only a charge deliberately set to
 * PKR produces a rupee document.
 *
 * That is the opposite of the freight side's assumption, which is why this is
 * stated here rather than left to a `|| 'PKR'` somewhere.
 */
const LOCAL_CURRENCY = 'PKR';
const AVIATION_DEFAULT_CURRENCY = 'USD';
const invoiceCurrency = (charge) =>
  String(charge?.currency || '').trim().toUpperCase() || AVIATION_DEFAULT_CURRENCY;

// AWB stock - the register of air waybill numbers, and who they were given
// out to. Its own file because it is a Setup list in its own right; mounted
// here rather than at the top level so everything the aviation module offers
// sits under one path.
routes.use('/awb', require('./awb'));

// The PFM - the pre-flight manifest a flight is built from. Its own file
// because it is a document in its own right with its own screens, numbering
// and lifecycle; mounted here rather than at the top level so everything the
// aviation module offers sits under one path.
routes.use('/pfm', require('./pfm'));

// What a flight looks like when read back: the header plus its lines, each
// line carrying the names of the client and commodity it points at so the
// screen doesn't have to resolve them itself.
const partyAttrs = ['id', 'name', 'code'];
const jobInclude = [
  { model: Aviation_Aircraft, attributes: ['id', 'name', 'maxPayload'], required: false },
  // THE PLAN THIS FLIGHT WAS BUILT FROM. Carried on every read of a flight
  // because the screen needs it before it can draw the header: the flight
  // number is not typed any more, it is the PFM's, and the View PFM button in
  // the toolbar is built from this. Null on every flight entered before the
  // PFM module existed, which is not a fault - see the association file.
  {
    model: Aviation_Pfm,
    attributes: ['id', 'pfmNo', 'flightNo', 'flightDate', 'origin', 'status'],
    required: false,
  },
  // The operating airline - whose flight this is. Aliased, and NOT the same
  // thing as the carrier on each consignment below: that one says whose cargo
  // an AWB is, and a flight routinely carries other carriers' loads.
  {
    model: Aviation_Carrier,
    as: 'operatingCarrier',
    attributes: ['id', 'name', 'prefix', 'category'],
    required: false,
  },
  {
    model: Aviation_Consignment,
    required: false,
    include: [
      { model: Clients, as: 'shipper',     attributes: partyAttrs, required: false },
      { model: Clients, as: 'consignee',   attributes: partyAttrs, required: false },
      { model: Clients, as: 'masterAgent', attributes: partyAttrs, required: false },
      { model: Commodity, attributes: ['id', 'name', 'hs'], required: false },
      { model: Aviation_Carrier, attributes: ['id', 'name', 'prefix', 'category'], required: false },
      // The registered number, when this AWB was picked from stock. Carries
      // the master agent it was assigned to, which is what lets the grid fill
      // that in from the number alone.
      {
        model: Aviation_Awb,
        attributes: ['id', 'awbNumber', 'prefix', 'serial', 'checkDigit', 'masterAgentId'],
        required: false,
      },
      {
        model: Charge_Head,
        required: false,
        // The invoice a charge has been billed on, if any. Its presence is
        // what locks the charge against further editing.
        include: [
          { model: Invoice, attributes: ['id', 'invoice_No', 'type', 'approved'], required: false },
        ],
      },
    ],
  },
];

/**
 * Every leg of every AWB carried on these flights, whatever period it flew in.
 *
 * WHAT IT IS FOR. A leg's carry-in is decided by the leg before it on the same
 * AWB - see carryInByLeg. A report bounded by a month cannot see a predecessor
 * that flew the month before, so without this the continuation leg looks like a
 * first leg and reports the whole air waybill instead of its share.
 *
 * NO DATE BOUND ON PURPOSE. The predecessor is wherever it is, and an AWB has
 * few enough legs that fetching them all is cheaper than reasoning about how
 * far back to look. The in-period legs come back too; carryInByLeg drops the
 * duplicates.
 *
 * The flight's date and status ride along because that is what orders a leg
 * and what says whether its flight went at all - the arithmetic groups legs
 * across flights and cannot read either off the consignment row.
 *
 * @param {Array} flights Sequelize flights, each with Aviation_Consignments.
 */
const siblingLegs = async (flights) => {
  const awbs = [...new Set(
    (flights || []).flatMap((f) => (f.Aviation_Consignments || [])
      .map((c) => String(c.awb || '').trim()))
  )].filter(Boolean);
  if (!awbs.length) return [];

  const rows = await Aviation_Consignment.findAll({
    where: { awb: awbs },
    attributes: ['id', 'awb', 'grossWeight', 'offload', 'carriedForward'],
    include: [{
      model: Aviation_Job,
      attributes: ['flightDate', 'status', 'canceled'],
      required: true,
    }],
  });

  return rows.map((c) => ({
    id: c.id,
    awb: c.awb,
    grossWeight: c.grossWeight,
    offload: c.offload,
    carriedForward: c.carriedForward,
    flightDate: c.Aviation_Job ? c.Aviation_Job.flightDate : null,
    status:     c.Aviation_Job ? c.Aviation_Job.status : null,
    canceled:   c.Aviation_Job ? c.Aviation_Job.canceled : false,
  }));
};

/**
 * One flight, with every consignment told about the leg before it.
 *
 * WHY THE SCREEN NEEDS THAT. A leg's carry-in - what the flight was asked to
 * take, and so what the manifest and uplift figures are built from - is decided
 * by the leg before it on the same AWB (see carryInByLeg). The flight screen
 * holds ONE flight, so it cannot work that out for itself, and totalling what
 * it can see would disagree with every report the moment an AWB spans two
 * aircraft.
 *
 * So the predecessor rides along on each line as `prevLeg`, and the grid runs
 * the same rule the server does. An operator editing Gross WT then sees the
 * manifest move exactly as the reports will move - rather than finding out
 * after saving.
 *
 * `null` where there is no earlier leg, which is the ordinary case: this leg
 * IS the shipment and its gross is the answer.
 */
const withPrevLegs = async (job) => {
  if (!job) return job;
  const plain = job.get({ plain: true });
  const lines = plain.Aviation_Consignments || [];
  if (!lines.length) return plain;

  const prevOf = prevLegByLeg(await siblingLegs([job]));

  plain.Aviation_Consignments = lines.map((c) => {
    const prev = prevOf.get(c.id) || null;
    return {
      ...c,
      // Only what the rule reads, plus enough to name the flight it came from
      // if the grid ever wants to show it. Not the whole row: this is context
      // for an arithmetic rule, not a second consignment to edit.
      prevLeg: prev && {
        id: prev.id,
        grossWeight: prev.grossWeight,
        offload: prev.offload,
        flightDate: prev.flightDate,
      },
    };
  });
  return plain;
};

const getJob = async (id) => withPrevLegs(await Aviation_Job.findOne({
  where: { id },
  include: jobInclude,
  // Charge_Head has no sortOrder column - it is a shared table and adding
  // one would be a migration on it - so charges come back in id order,
  // which is the order they were created in anyway.
  order: [
    [Aviation_Consignment, 'sortOrder', 'ASC'],
    [Aviation_Consignment, Charge_Head, 'id', 'ASC'],
  ],
}));

// Ids arrive from the URL as strings, so "undefined" and "null" are truthy and
// sail past a plain `if (!id)` straight into Postgres, which rejects them with
// "invalid input syntax for type integer". Returns a number or null.
const asId = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
};

// A line is worth keeping if it names a party or an AWB. Anything else is an
// "Add +" the user thought better of, and saving it would put a blank row on
// the flight that has to be deleted by hand later.
const isRealLine = (x) =>
  x && (x.shipperId || x.consigneeId || x.masterAgentId || x.AviationAwbId ||
        String(x.awb || '').trim());

/* ------------------- a voided AWB must not reach a flight --------------------
 * A voided number is a torn or misprinted air waybill: the airline will not
 * accept a shipment on it, so putting one on a consignment produces a manifest
 * that cannot fly and, if it is invoiced, a document against a serial that
 * officially no longer exists. Setup > AWB Stock takes it out of the grid's
 * dropdown the moment it is voided, but a flight screen left open since before
 * that still has it in its options and will post it straight back.
 *
 * So the SAVE refuses it, before the job or any line is written. Refused
 * rather than quietly dropped: silently clearing the AWB off a line would give
 * back a saved flight with a consignment that names nobody, which is a worse
 * thing to hand someone than a message saying which number is spoiled.
 *
 * Only numbers picked from stock are checked - AviationAwbId. A DIRECT AWB is
 * typed, belongs to another airline, and is not ours to have voided.
 *
 * Existing lines cannot be caught out by this: /awb/void refuses any number a
 * consignment already points at, so nothing already on a flight can be voided
 * underneath it. Every hit here is a NEW attachment.
 */
const voidedStockOn = async (list) => {
  const ids = [...new Set(
    (Array.isArray(list) ? list : [])
      .filter(isRealLine)
      .map((x) => asId(x.AviationAwbId))
      .filter(Boolean)
  )];
  if (!ids.length) return [];

  const rows = await Aviation_Awb.findAll({
    where: { id: { [Op.in]: ids }, voidedAt: { [Op.ne]: null } },
    attributes: ['awbNumber', 'voidReason'],
  });
  return rows.map((r) => `${formatAwb(r.awbNumber)}${r.voidReason ? ` (${r.voidReason})` : ''}`);
};

/* ----------------- the plan a flight may be built from -----------------
 * A PFM backs ONE flight, and only a plan that is still fit to fly may be
 * attached to a new one.
 *
 * The screen's selector already offers nothing else (see /pfm/selectable), so
 * every hit here is a tab that was open while somebody else flew the plan or
 * cancelled it - which is exactly the case a dropdown cannot cover. Refused
 * rather than quietly dropped: silently clearing the link would hand back a
 * saved flight whose flight number came from nowhere, which is a worse thing
 * to give someone than a message naming the flight that took the plan.
 *
 * ONLY A NEW ATTACHMENT IS CHECKED. `currentPfmId` is what this flight is
 * already built from; re-saving it must keep working for ever, whatever has
 * since become of the plan's date. A plan's date passes the moment the flight
 * it planned has flown, so re-checking it would make every flight unsaveable
 * the day after it went.
 *
 * Returns a message, or null when the attachment is fine.
 */
const pfmAttachmentError = async (pfmId, jobId, currentPfmId) => {
  const id = asId(pfmId);
  if (!id) return null;
  if (currentPfmId && Number(currentPfmId) === id) return null;

  const pfm = await Aviation_Pfm.findOne({
    where: { id },
    attributes: ['id', 'pfmNo', 'flightNo', 'flightDate', 'status'],
  });
  if (!pfm) return `That PFM no longer exists. Reload the flight and pick one from the list.`;

  // Whoever else is already flying it. Excludes this flight, so an edit that
  // re-posts its own link is not refused as a clash with itself.
  const taken = await Aviation_Job.findOne({
    where: jobId ? { AviationPfmId: id, id: { [Op.ne]: jobId } } : { AviationPfmId: id },
    attributes: ['id', 'jobNo'],
  });

  return pfmStatus.selectableReason(
    pfm,
    moment().format('YYYY-MM-DD'),
    taken ? (taken.jobNo || `flight #${taken.id}`) : null,
  );
};

/* What the leg CARRIED, as it should be stored: the two booked columns and the
 * chargeable weight that follows from them.
 *
 * Ordinarily just what was typed. On a leg whose whole load was offloaded, the
 * offload figures - see bookedFromOffload for why a blank booking beside a
 * recorded offload is not a blank row but a wrong one.
 *
 * `?? null` ON THE CHARGEABLE WEIGHT, NEVER `|| null`.
 *
 * Nought is a REAL chargeable weight - it is what an AWB that flew none of its
 * cargo weighs - and `0 || null` is null. So the grid computed the 0, sent the
 * 0, and this stored a blank. The row then came back from the server with a
 * hole in a column the screen requires, and the flight the whole
 * fully-offloaded rule exists for could be saved exactly once and never
 * re-saved: every attempt after that was refused for a Chargeable WT the
 * server had just thrown away.
 *
 * And when the booking is filled in here rather than by the grid - a stale tab,
 * the endpoint, a continuation prefill - the chargeable weight has to be
 * settled here too, for the same reason. Nothing flew, so it is 0. Leaving it
 * null would hand back a row the screen refuses to save, which is the same
 * dead end by a different route.
 *
 * A chargeable weight the caller DID send always wins: it is conventionally
 * the greater of actual and volumetric, so it is not always derivable.
 *
 * Returns an object to spread, so lineValues stays a flat literal and the
 * fields keep their place in it.
 */
const booked = (x) => {
  const filled = bookedFromOffload(x);
  if (filled) {
    return { ...filled, chargeableWeight: x.chargeableWeight ?? 0 };
  }
  return {
    pieces: x.pieces || null,
    grossWeight: x.grossWeight || null,
    chargeableWeight: x.chargeableWeight ?? null,
  };
};

const lineValues = (x, i, jobId) => ({
  // Separators stripped on the way in, so 9812 1234, 9812-1234 and 98121234
  // are stored as one number and the legs of a split shipment can find each
  // other. Applies to a DIRECT AWB too - that one is typed rather than picked,
  // so it is the likeliest to arrive punctuated.
  awb:              normalizeAwb(x.awb),
  // The registered number this AWB came out of stock as, when it was picked
  // from Setup > AWB Stock rather than typed. Nullable, and stays null for a
  // typed one: the register is not retrospective, and a flight entered before
  // the stock existed is not wrong.
  AviationAwbId:    x.AviationAwbId || null,
  sortOrder:        i,
  shipperId:        x.shipperId || null,
  consigneeId:      x.consigneeId || null,
  masterAgentId:    x.masterAgentId || null,
  CommodityId:      x.CommodityId || null,
  AviationCarrierId: x.AviationCarrierId || null,
  // Pieces, Gross WT and the chargeable weight that follows from them - see
  // `booked`. On an ordinary line these are simply what was typed; on a leg
  // that flew none of its cargo they are filled in from what it left behind.
  //
  // Applied HERE as well as in the grid, and this is the copy that decides:
  // the grid fills a row in front of the operator, but a consignment can also
  // arrive from the prefill of a continuation leg, from a stale tab that
  // predates the rule, or straight from the endpoint, and a leg that records
  // an offload against no booking is wrong however it got here.
  ...booked(x),
  // `volume` and `volumetricWeight` are deliberately ABSENT: both columns are
  // legacy (see the model) and neither is collected any more - the consignment
  // grid dropped the Vol. WT column in 1.2.2, as it had dropped Volume before
  // it. Left out of this object rather than written as null, so re-saving an
  // old flight does not wipe the figures it was entered with; Sequelize only
  // SETs the keys it is given.
  // What did not fly, in kilos and in packages. Recorded against the AWB it
  // happened to, rather than as two typed figures on the flight - see the
  // model.
  offload:          x.offload ?? null,
  offloadPieces:    x.offloadPieces ?? null,
  // What this leg was asked to carry, when it is a continuation of an earlier
  // one. Null on a first leg, where grossWeight is the answer.
  carriedForward:   x.carriedForward ?? null,
  // Nothing on this AWB is waiting for a later aircraft, whatever it was
  // offloaded by - see the model. Ticked on the leg that left the cargo.
  awbClosed:        Boolean(x.awbClosed),
  // Checked, and its Air Freight charge raised on both sides - see the model.
  // A DIRECT consignment carries no charges of ours, so it is never approved
  // however the payload arrives; saveCharges clears anything left on one.
  awbApproved:      Boolean(x.awbApproved) && !x.direct,
  // Someone else's load on someone else's AWB - in the manifest, never on an
  // invoice. See the model.
  direct:           Boolean(x.direct),
  // One conversion per side - see the model. The legacy single `exRate` is
  // kept in step with whichever side was last set so that anything still
  // reading it (an old report, a row that predates the split) does not read a
  // stale figure; the pricing itself no longer looks at it unless BOTH of the
  // two above are absent.
  buyingExRate:     x.buyingExRate ?? x.exRate ?? 1,
  sellingExRate:    x.sellingExRate ?? x.exRate ?? 1,
  exRate:           x.exRate ?? x.sellingExRate ?? 1,
  buyingRate:       x.buyingRate ?? null,
  sellingRate:      x.sellingRate ?? null,
  // Which report column this AWB counts toward, when it should not be the
  // one its carrier implies. NULL is "inherit", which is what every AWB does
  // unless somebody deliberately said otherwise - so forOverride, not
  // forWrite: the latter turns a blank into 'Other' and would retag the whole
  // grid on the first save. See functions/carrierCategory.
  reportingTag:     carrierCategory.forOverride(x.reportingTag),
  origin:           x.origin || null,
  destination:      x.destination || null,
  natureOfGoods:    x.natureOfGoods || null,
  remarks:          x.remarks || null,
  AviationJobId:    jobId,
});

/**
 * Save a flight's consignment lines AND the charges hanging off them.
 *
 * UPDATE IN PLACE, never destroy-and-recreate. A consignment owns its charges
 * (Charge_Heads.AviationConsignmentId, ON DELETE CASCADE), so recreating lines
 * on every save would hand each one a new id and take its charges - and any
 * invoice they sit on - down with the old row.
 *
 * Lines the user actually removed ARE deleted, and their charges go with them
 * by cascade, which is correct: a charge against a removed AWB has nothing
 * left to be a charge against.
 */
/**
 * Which consignments on this flight are frozen by an issued invoice.
 *
 * An AWB whose charges sit on an APPROVED invoice is locked. Its weight and
 * rates are what those charges were computed from, so editing it afterwards
 * would leave the consignment saying one thing and an issued document another
 * - with nothing to reconcile them.
 *
 * AN UNAPPROVED INVOICE DOES NOT LOCK ANYTHING. Unapproving destroys the
 * voucher and takes the invoice back out of the ledger, so there is no issued
 * figure left to contradict - and reopening the AWB is exactly what somebody
 * unapproved it in order to do. See isInvoiceLocked.
 */
const invoicedConsignmentIds = async (jobId) => {
  const rows = await Charge_Head.findAll({
    where: { InvoiceId: { [Op.ne]: null }, AviationConsignmentId: { [Op.ne]: null } },
    attributes: ['AviationConsignmentId', 'InvoiceId'],
    include: [
      {
        model: Aviation_Consignment,
        attributes: [],
        where: { AviationJobId: jobId },
        required: true,
      },
      // Whether the document has actually been issued. `required: false` so a
      // charge pointing at an invoice that no longer exists still comes back -
      // isInvoiceLocked treats that as frozen rather than silently unlocking.
      { model: Invoice, attributes: ['id', 'approved'], required: false },
    ],
  });
  return new Set(
    rows.filter((r) => isInvoiceLocked(r, r.Invoice)).map((r) => r.AviationConsignmentId)
  );
};

/* ------------------- rates after the fortnight has closed -------------------
 * The four rate fields drop OUT of the update once the flight's fortnight has
 * closed, rather than the whole save being refused.
 *
 * Two reasons for dropping rather than refusing. A closed fortnight freezes
 * the RATES, not the flight - correcting a piece count or a consignee weeks
 * later is ordinary work and must keep working. And Sequelize only SETs the
 * keys it is given, so leaving them out means the stored figures stay exactly
 * as they were reconciled: a stale browser tab posting the old values back
 * cannot restate a settled period.
 *
 * The grid greys these cells out and says which rule shut them, so this is the
 * backstop rather than the first the user hears of it.
 * -------------------------------------------------------------------------- */
const RATE_FIELDS = ['buyingRate', 'sellingRate', 'buyingExRate', 'sellingExRate', 'exRate'];

const withoutRates = (values) => {
  const out = { ...values };
  for (const f of RATE_FIELDS) delete out[f];
  return out;
};

const saveConsignments = async (list, jobId, flightDate, { holdInvoiced = false } = {}) => {
  if (!Array.isArray(list)) return { locked: [] };

  // The flight's date AS IT IS BEING SAVED, which is what the grid computed
  // the greyed-out cells from - so the screen and the server agree about
  // whether the window is shut. Correcting a mistyped flight date therefore
  // moves its fortnight with it, which is right: the period a flight belongs
  // to is the period it flew in, not the period it was first typed as.
  const rateWindowOpen = ratesOpen(flightDate);

  const incoming = list.filter(isRealLine);
  const existing = await Aviation_Consignment.findAll({
    where: { AviationJobId: jobId },
    attributes: ['id'],
  });
  const keptIds = incoming.map((x) => x.id).filter(Boolean);
  const removed = existing.map((x) => x.id).filter((id) => !keptIds.includes(id));

  // Enforced HERE, not only in the UI: a stale browser tab, or anything
  // posting straight at the endpoint, must not be able to move an invoiced
  // AWB out from under its invoice.
  const locked = await invoicedConsignmentIds(jobId);
  const blocked = [];

  for (let i = 0; i < incoming.length; i++) {
    const line = incoming[i];
    let consignmentId = line.id;

    if (consignmentId && locked.has(consignmentId)) {
      // Frozen EXCEPT its remarks. Remarks are notes about the consignment,
      // not figures the charges were computed from, so changing one cannot put
      // the AWB and its invoice at odds - and the note explaining why an AWB
      // was invoiced the way it was is usually wanted after the fact, when
      // everything else is already locked.
      await Aviation_Consignment.update(
        { remarks: line.remarks || null },
        { where: { id: consignmentId } }
      );
      // saveCharges is still skipped: those charges are invoiced, and it
      // would refuse them anyway.
      blocked.push(consignmentId);
      continue;
    }

    const values = rateWindowOpen
      ? lineValues(line, i, jobId)
      // A NEW consignment added after the close keeps its rates: there is no
      // reconciled figure for it to restate, and a row that could never be
      // priced would be worse than one priced late.
      : (consignmentId ? withoutRates(lineValues(line, i, jobId)) : lineValues(line, i, jobId));
    if (consignmentId) {
      await Aviation_Consignment.update(values, { where: { id: consignmentId } });
    } else {
      const created = await Aviation_Consignment.create(values);
      consignmentId = created.id;
    }
    // A DIRECT consignment cannot carry our charges - it is someone else's
    // load on someone else's AWB. Passing an empty list rather than skipping
    // is deliberate: it clears any uninvoiced charge that was on the line
    // before it was marked direct, so nothing is left billable but hidden from
    // the Charges tab. saveCharges never touches an invoiced row, so an AWB
    // that has already been billed keeps its invoice and stays locked.
    //
    // Enforced HERE and not only in the UI: a stale tab still has the charge
    // rows in its payload and would post them straight back.
    //
    // `line` carries the AWB's buying/selling/ex rates, which is what the
    // charge amounts are computed from.
    await saveCharges(line.direct ? [] : line.charges, consignmentId, line, { holdInvoiced });
  }

  // A removed AWB that has been invoiced is kept, for the same reason: the
  // invoice would be left referring to a consignment that no longer exists.
  const removable = removed.filter((id) => !locked.has(id));
  blocked.push(...removed.filter((id) => locked.has(id)));
  if (removable.length) await Aviation_Consignment.destroy({ where: { id: removable } });

  return { locked: [...new Set(blocked)] };
};

/**
 * Save one consignment's charges.
 *
 * THREE KINDS OF ROW, handled three ways:
 *
 *   not invoiced          replaced wholesale - destroyed and recreated from
 *                         what the screen sent.
 *   on an UNAPPROVED      UPDATED IN PLACE. Unapproving an invoice destroys
 *   invoice               its voucher and takes it out of the ledger so its
 *                         figures can be corrected; refusing the correction
 *                         would make unapproving pointless. It must be an
 *                         UPDATE and not a destroy-and-recreate, because a new
 *                         row would get a new id and the invoice would lose
 *                         the line. InvoiceId is not in chargeValues, so the
 *                         charge stays on its own invoice throughout and is
 *                         re-approved onto the same document - approveInvoice
 *                         recomputes the total from the charges, so what gets
 *                         posted is the corrected figure.
 *   on an APPROVED        left completely alone. That is an issued document.
 *   invoice
 *
 * `undefined` means "the screen did not send charges for this line", which is
 * not the same as "this line has no charges" - only an actual array clears
 * them.
 */
const saveCharges = async (list, consignmentId, line, { holdInvoiced = false } = {}) => {
  if (!Array.isArray(list)) return;

  // Which of this consignment's billed charges are frozen, and which are on an
  // invoice that has been taken back out of the books.
  const billed = await Charge_Head.findAll({
    where: { AviationConsignmentId: consignmentId, InvoiceId: { [Op.ne]: null } },
    attributes: ['id', 'InvoiceId'],
    include: [{ model: Invoice, attributes: ['id', 'approved'], required: false }],
  });
  const frozen = new Set();
  const reopened = new Set();
  for (const c of billed) {
    (isInvoiceLocked(c, c.Invoice) ? frozen : reopened).add(c.id);
  }

  // The lines about to be written again, as they stand, so each keeps who
  // entered it and is only marked edited if it changed (functions/auditStamps
  // .carriedStamps). Without this, whoever saved last would be every line's
  // creator.
  const rewritten = new Map((await Charge_Head.findAll({
    where: { AviationConsignmentId: consignmentId, InvoiceId: null }, raw: true,
  })).map((r) => [String(r.id), r]));

  await Charge_Head.destroy({
    where: { AviationConsignmentId: consignmentId, InvoiceId: null },
  });

  const fresh = [];
  const auditStamps = [];
  let i = 0;
  for (const c of list) {
    if (!isRealCharge(c)) continue;
    const id = c.id;
    // An issued document. Not rewritten, not deleted, not renumbered.
    if (id && frozen.has(id)) { i += 1; continue; }

    // On an unapproved invoice, and the user may not edit invoices: left as it is.
    if (id && holdInvoiced && reopened.has(id)) { i += 1; continue; }
    const values = chargeValues(c, i, consignmentId, line);
    i += 1;
    if (id && reopened.has(id)) await Charge_Head.update(values, { where: { id } });
    else {
      const old = rewritten.get(String(id ?? ''));
      fresh.push(values);
      auditStamps.push(old ? await carriedStamps(require('../../models'), Charge_Head, old, values) : null);
    }
  }
  if (fresh.length) await Charge_Head.bulkCreate(fresh, { auditStamps });
};

/**
 * What a save of the AWBs' charge sheets may change, by the user's rights -
 * see functions/chargeRights. Approvals stay as stored without the charges'
 * Approve right; lines on an unapproved invoice are held (holdInvoiced) without
 * the right to edit job invoices. Changes the consignments' charges in place.
 * Asked only when the save really changes one.
 */
const guardAviationCharges = async (req, consignments) => {
  const sheets = (consignments || []).filter((c) => c && Array.isArray(c.charges));
  if (!sheets.length) return { holdInvoiced: false };
  const ids = sheets.map((c) => asId(c.id)).filter(Boolean);
  const stored = ids.length
    ? (await Charge_Head.findAll({
      where: { AviationConsignmentId: ids },
      include: [{ model: Invoice, attributes: ['id', 'approved'], required: false }],
    })).map((r) => r.get({ plain: true }))
    : [];
  const storedFor = (c) => stored.filter((r) => String(r.AviationConsignmentId) === String(asId(c.id)));
  let approve = false;
  let invoiced = false;
  for (const c of sheets) {
    // removed: [] - an invoiced line is never removed here (saveCharges only
    // clears lines on no invoice), so leaving one off asks for nothing.
    const need = chargeRightsNeeded(c.charges, storedFor(c), { removed: [] });
    approve = approve || need.approve;
    invoiced = invoiced || need.invoiced;
  }
  if (approve && !(await allowsPart(req, CHARGE_APPROVE, 'charge approval'))) {
    for (const c of sheets) c.charges = holdApprovals(c.charges, storedFor(c));
  }
  const holdInvoiced = invoiced && !(await allowsPart(req, INVOICE_EDIT, 'invoiced charges'));
  return { holdInvoiced };
};

// List. Filtered by company, newest first - the flight list screen.
routes.get('/get', async (req, res) => {
  try {
    // STRICT: no company picked, no flights - and the screen says why. It used
    // to drop the filter and show every company's; see functions/companyCodes.
    if (!isCompanyId(req.headers.companyid)) {
      return res.json({ status: 'success', result: [], noCompany: true });
    }
    const where = { companyId: String(req.headers.companyid).trim() };
    if (req.headers.flight)    where.flightNo = { [Op.substring]: req.headers.flight };

    const result = await Aviation_Job.findAll({
      where,
      include: jobInclude,
      order: [['createdAt', 'DESC']],
    });
    res.json({ status: 'success', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.get('/getById', async (req, res) => {
  try {
    const id = asId(req.headers.id);
    if (!id) {
      return res.status(400).json({ status: 'error', result: `Not a valid flight id: ${req.headers.id}` });
    }
    const result = await getJob(id);
    if (!result) return res.status(404).json({ status: 'error', result: 'Flight not found.' });
    res.json({ status: 'success', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

// The pick lists this screen needs: who a consignment can be for, and what it
// can contain. Its own endpoint rather than reusing /seaJob/getValues, which
// returns a dozen lists of vendors and vessels that a flight has no use for.
routes.get('/getValues', async (req, res) => {
  try {
    const [clients, commodities, airports, aircraft, carriers, charges] = await Promise.all([
      Clients.findAll({
        where: { active: true },
        attributes: ['id', 'name', 'code', 'nongl', 'types'],
        order: [['name', 'ASC']],
      }),
      Commodity.findAll({ attributes: ['id', 'name', 'hs'], order: [['name', 'ASC']] }),
      Airports.findAll({
        attributes: ['airportCode', 'airportName', 'city'],
        order: [['airportCode', 'ASC']],
      }),
      Aviation_Aircraft.findAll({
        where: { active: true },
        attributes: ['id', 'name', 'description', 'maxPayload'],
        order: [['name', 'ASC']],
      }),
      Aviation_Carrier.findAll({
        where: { active: true },
        // partyId is here because the Charges tab defaults a payable to the
        // airline - it sold the space. Without it the carrier's party cannot
        // be resolved on the screen and every payable would need its party
        // typed in by hand.
        attributes: ['id', 'name', 'prefix', 'category', 'partyId'],
        order: [['name', 'ASC']],
      }),
      Charges.findAll({
        where: { status: true },
        // calculationType seeds a charge line's basis (Per Unit / Per
        // Shipment); the two default party types say WHICH party on the AWB a
        // charge falls to - both used the same way the freight charges screen
        // uses them.
        //
        // taxApply/taxPerc/fixAmount are what the charge was REGISTERED with
        // and are pushed onto the row when it is picked: the tax toggle and
        // its percentage, and the standing amount this charge is raised at.
        // They are defaults on the row, not rules - a charge can still be
        // adjusted or exempted for the one shipment that needs it.
        attributes: [
          'id', 'code', 'short', 'name', 'currency', 'calculationType',
          'defaultRecivableParty', 'defaultPaybleParty',
          'taxApply', 'taxPerc', 'fixAmount',
        ],
        order: [['code', 'ASC']],
      }),
    ]);

    // Clients.types is a comma-joined string ('Shipper, Consignee'), so match
    // on the whole entry rather than a substring - 'Agent' must not match
    // 'Master Agent', and vice versa.
    const hasType = (type) => (x) =>
      String(x.types || '').split(',').map((t) => t.trim()).includes(type);
    const partyOption = (x) => ({ id: x.id, name: `${x.name} (${x.code})` });
    const billable = clients.filter((x) => x.nongl != '1');

    res.json({
      status: 'success',
      result: {
        // Per-role lists, filtered on Clients.types the way /seaJob/getValues
        // does. In aviation mode Setup > Parties offers only these three
        // types, so a party tagged Shipper is a shipper and nothing else.
        //
        // `party` is kept as the unfiltered list and is what the charge rows
        // pick from - a charge can be with any party, including one that is
        // neither shipper nor consignee on this AWB.
        //
        // Non-GL parties are excluded throughout - they can't be billed, the
        // same rule /seaJob/getValues applies to its client list.
        party:       billable.map(partyOption),
        shipper:     billable.filter(hasType('Shipper')).map(partyOption),
        consignee:   billable.filter(hasType('Consignee')).map(partyOption),
        masterAgent: billable.filter(hasType('Master Agent')).map(partyOption),
        commodity: commodities.map((x) => ({
          id: x.id,
          name: x.hs ? `${x.name} (${x.hs})` : x.name,
        })),
        // Origin/destination are stored as the airport CODE, not an id - the
        // same shape the freight air jobs put in pol/pod (see
        // formatAirportOption in apis/pickLists.js). Keeping that means an
        // aviation flight and an air freight job describe a route identically,
        // and no foreign key is needed.
        airport: airports.map((x) => ({
          id: x.airportCode,
          name: `${x.airportName} (${x.airportCode})`,
          city: x.city,
        })),
        // Registered aircraft. The report splits each sector by aircraft, so
        // this must be a picked record rather than typed text.
        aircraft: aircraft.map((x) => ({
          id: x.id,
          name: x.name,
          description: x.description,
          maxPayload: x.maxPayload,
        })),
        // Registered carriers. Each carries its AWB prefix and its ER/IFA/
        // Other tag, so picking one on a consignment fills the prefix in and
        // decides which uplift bucket that AWB counts toward.
        // Labelled "prefix - name" so the dropdown can be searched by either.
        // The prefix IS the carrier's code; there is no separate one.
        // partyId is what a payable charge defaults its party to - the airline
        // sold the space, so it is who the money is owed to.
        carrier: carriers.map((x) => ({
          id: x.id,
          name: x.prefix ? `${x.prefix} - ${x.name}` : x.name,
          prefix: x.prefix,
          // Normalised, like the Setup list: this is what the consignment grid
          // shows as the tag an AWB would inherit, and a carrier registered
          // before 1.2.3 would otherwise offer 'ER' - a tag the grid's own
          // dropdown no longer contains.
          category: carrierCategory.read(x.category),
          partyId: x.partyId ?? null,
        })),
        // The charge master. Shaped by chargeOption, which is a TESTED
        // CONTRACT rather than an inline map: a field added to the query above
        // and forgotten here is selected, thrown away, and arrives in the
        // browser as undefined - which the screen reads and silently ignores.
        // See functions/aviationCharge.
        charge: charges.map(chargeOption),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/create', async (req, res) => {
  try {
    const data = req.body.data || {};
    if (Array.isArray(data.consignments) && data.consignments.some((c) => Array.isArray(c?.charges))
      && !(await allowsPart(req, CHARGE_EDIT, 'charges'))) {
      data.consignments.forEach((c) => { if (c) delete c.charges; });
    }
    const { holdInvoiced: holdOnCreate } = await guardAviationCharges(req, data.consignments);
    delete data.id;

    // A real company, or nothing is saved - see functions/companyCodes.
    const companyId = await realCompanyId(data.companyId);
    if (!companyId) return res.status(400).json({ status: 'error', result: NO_COMPANY });
    data.companyId = companyId;

    // Checked BEFORE the job is created, so a refusal does not leave a flight
    // number spent on a flight that was never saved - see voidedStockOn.
    const voided = await voidedStockOn(data.consignments);
    if (voided.length) {
      return res.status(409).json({
        status: 'error',
        result: `${voided.length} AWB(s) on this flight have been voided and cannot be used: ` +
          `${voided.slice(0, 5).join(', ')}${voided.length > 5 ? '…' : ''}. ` +
          `Reload the flight to pick from current stock.`,
      });
    }

    // The plan this flight is being built from - checked before the job
    // number is spent, for the same reason the voided-AWB check is.
    const pfmProblem = await pfmAttachmentError(data.AviationPfmId, null, null);
    if (pfmProblem) {
      return res.status(409).json({ status: 'error', result: pfmProblem });
    }

    const fiscalYear = await resolveSelectedFiscalYear(data.fiscalYearId);
    const fySuffix = fiscalYear.suffix;
    const jobCompany = await companyShort(data.companyId);
    const numbering = await readNumbering();

    // Per-fiscal-year sequence, matching how sea.js numbers a job so the two
    // never look like different products: found by jobId, never by the prefix
    // in jobNo, so Config > Document Numbers can change the layout without
    // restarting it. lastInYear skips a row with no jobId - Postgres sorts
    // NULLs first on DESC, and one such row once made every new flight
    // 'XXX-AVJ-NaN/99' and fail. AVJ is a fixed code; the prefix and order
    // follow the jobs setting.
    const last = await lastInYear(Aviation_Job, {
      seqCol: 'jobId',
      noCol: 'jobNo',
      suffix: fySuffix,
      company: { column: 'companyId', id: String(data.companyId) },
      scoped: perCompany(numbering, 'jobs'),
    });
    const nextJobId = nextAfter(last, 'jobId');

    const result = await Aviation_Job.create({
      ...data,
      jobId: nextJobId,
      jobNo: formatNumber(numbering, { klass: 'jobs', company: jobCompany, code: 'AVJ', seq: nextJobId, suffix: fySuffix }),
      FiscalYearId: fiscalYear.id,
    });

    // The flight's own date decides the rate window - see saveConsignments.
    await saveConsignments(data.consignments, result.id, result.flightDate, { holdInvoiced: holdOnCreate });
    createHistory(req.body.employeeId, 'Aviation Job', 'Create', result.jobNo);
    res.json({ status: 'success', result: await getJob(result.id) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/edit', async (req, res) => {
  try {
    const data = req.body.data || {};
    if (Array.isArray(data.consignments) && data.consignments.some((c) => Array.isArray(c?.charges))
      && !(await allowsPart(req, CHARGE_EDIT, 'charges'))) {
      data.consignments.forEach((c) => { if (c) delete c.charges; });
    }
    const id = asId(data.id);
    if (!id) {
      return res.status(400).json({ status: 'error', result: `Not a valid flight id: ${data.id}` });
    }
    // Nor saved by a user with no company picked; and an edit never moves a
    // flight to another company - the payload carries whatever the header holds.
    if (!(await realCompanyId(data.companyId))) {
      return res.status(400).json({ status: 'error', result: NO_COMPANY });
    }
    delete data.companyId;
    const { holdInvoiced } = await guardAviationCharges(req, data.consignments);

    /* CHARGES ONLY - someone who may change a job's charges but not the
     * flight itself (the user's request, 2026-10-10: job details and job
     * charges apart). Each consignment's charge lines are saved against the
     * consignment AS STORED - its rates, its direct flag - and nothing else
     * the screen sent is read. In audit mode allowsPart logs and lets the
     * whole save through. */
    if (!(await allowsPart(req, ['aviation:edit'], 'job'))) {
      const sent = (data.consignments || []).filter((c) => asId(c?.id) && Array.isArray(c.charges));
      if (!sent.length) {
        return res.status(403).json({ status: 'error', result: 'You do not have permission to change this flight.' });
      }
      const stored = await Aviation_Consignment.findAll({
        where: { id: sent.map((c) => asId(c.id)), AviationJobId: id },
      });
      const byId = new Map(stored.map((c) => [String(c.id), c.toJSON()]));
      for (const c of sent) {
        const line = byId.get(String(asId(c.id)));
        if (line && !line.direct) await saveCharges(c.charges, line.id, line, { holdInvoiced });
      }
      const job = await Aviation_Job.findOne({ where: { id }, attributes: ['jobNo'] });
      createHistory(req.user?.id || req.body.employeeId, 'Aviation Job', 'Edit Charges', job?.jobNo);
      return res.json({ status: 'success', result: await getJob(id) });
    }

    const voided = await voidedStockOn(data.consignments);
    if (voided.length) {
      return res.status(409).json({
        status: 'error',
        result: `${voided.length} AWB(s) on this flight have been voided and cannot be used: ` +
          `${voided.slice(0, 5).join(', ')}${voided.length > 5 ? '…' : ''}. ` +
          `Reload the flight to pick from current stock.`,
      });
    }

    /* The plan, as the flight is ALREADY built from it. Read from the
     * database rather than trusted from the payload: the payload is what the
     * browser thinks the link should become, and the whole question here is
     * whether it is allowed to change it. */
    const before = await Aviation_Job.findOne({ where: { id }, attributes: ['AviationPfmId'] });
    const pfmProblem = await pfmAttachmentError(data.AviationPfmId, id, before?.AviationPfmId);
    if (pfmProblem) {
      return res.status(409).json({ status: 'error', result: pfmProblem });
    }

    // jobNo/jobId are assigned once at create; letting an edit rewrite them
    // would renumber a document people have already filed against. id is
    // dropped from the payload too - it belongs in the WHERE, not the SET.
    delete data.jobNo;
    delete data.jobId;
    delete data.id;

    await Aviation_Job.update(data, { where: { id } });
    const { locked } = await saveConsignments(data.consignments, id, data.flightDate, { holdInvoiced });
    createHistory(req.body.employeeId, 'Aviation Job', 'Edit', data.jobNo);
    res.json({
      status: 'success',
      result: await getJob(id),
      // Said out loud rather than swallowed: an edit that was silently
      // ignored is exactly the kind of thing nobody notices until a total
      // disagrees with an invoice.
      ...(locked.length ? { warning:
        `${locked.length} AWB(s) are invoiced, so only their remarks were saved. ` +
        `Un-approve the invoice first if the figures really need changing.` } : {}),
    });
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
      return res.status(400).json({ status: 'error', result: `Not a valid flight id: ${req.body.id}` });
    }
    const job = await Aviation_Job.findOne({ where: { id }, attributes: ['jobNo'] });
    await Aviation_Job.update({ canceled: true }, { where: { id } });
    createHistory(req.body.employeeId, 'Aviation Job', 'Delete', job?.jobNo);
    res.json({ status: 'success', result: 'Flight cancelled.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The aviation dashboard.
 *
 *   GET /aviationJob/dashboard?companyId=1
 *
 * Two halves. The counters are the airline's version of what the freight
 * dashboard shows in FCL/LCL - flights and uplift rather than containers.
 *
 * The second half is the part worth having: PENDING LOADS - AWBs whose cargo
 * was offloaded and never put on a later flight. Nothing else in the system
 * surfaces those. The flight looks complete, the AWB looks shipped, and the
 * cargo is still sitting at the airport. See functions/aviationPendingLoads
 * for the rule.
 */
routes.get('/dashboard', requireWidget('jobCounters'), async (req, res) => {
  try {
    const companyId = req.query.companyId ? String(req.query.companyId) : null;
    const scope = companyId ? { companyId } : {};

    /* ------------------------- CALENDAR periods -------------------------
     * The period you are IN, not the last N days. "Flights this quarter"
     * means the quarter now running, so on 2 October it reads 2 days of
     * October - not the tail of the previous quarter dragged along.
     *
     * Deliberately unlike /home/getDashboard, which rolls its windows
     * backwards from today. These are the periods an airline closes its books
     * and reports on, so the dashboard should agree with the month-end figures
     * rather than being a smoothed approximation of them.
     *
     * THE FORTNIGHT SPLITS ON THE 16th - 1st to 15th, then 16th to month end.
     * There is no universal fortnight boundary, and this is the one that keeps
     * the three tiles nested: a fortnight sits inside its month, which sits
     * inside its quarter. Anything anchored elsewhere (ISO week pairs, a
     * rolling 14 days) would straddle month ends and stop the three figures
     * being comparable.
     * ------------------------------------------------------------------ */
    const now = moment();
    const day = (m) => m.format('YYYY-MM-DD');
    const firstHalf = now.date() <= 15;

    // Both ends, not just the start. A calendar period is BOUNDED - without
    // the upper end a flight dated next year would be counted in "this
    // quarter", because every future date is >= the quarter's first day.
    const periods = {
      fortnight: {
        from: firstHalf ? day(now.clone().startOf('month'))
                        : day(now.clone().startOf('month').date(16)),
        to:   firstHalf ? day(now.clone().startOf('month').date(15))
                        : day(now.clone().endOf('month')),
      },
      month: {
        from: day(now.clone().startOf('month')),
        to:   day(now.clone().endOf('month')),
      },
      quarter: {
        from: day(now.clone().startOf('quarter')),
        to:   day(now.clone().endOf('quarter')),
      },
    };

    // Counted on flightDate, not createdAt: a flight entered late is still a
    // flight that flew when it flew, and an airline reads this as operations
    // rather than data entry.
    //
    // flightDate is a 'YYYY-MM-DD' STRING, so BETWEEN compares it as text -
    // which is chronological in that format, and inclusive at both ends.
    const inPeriod = (p) => ({ [Op.between]: [p.from, p.to] });

    const flightsIn = (p) => Aviation_Job.count({
      where: { ...scope, flightDate: inPeriod(p), canceled: false },
    });

    const [fortnight, month, quarter] = await Promise.all([
      flightsIn(periods.fortnight),
      flightsIn(periods.month),
      flightsIn(periods.quarter),
    ]);

    // The fortnight's consignments, for uplift and the AWB count. Cancelled
    // flights are excluded here rather than filtered afterwards - they
    // carried nothing.
    const fortnightLines = await Aviation_Consignment.findAll({
      attributes: ['id', 'awb', 'grossWeight', 'offload', 'carriedForward'],
      include: [{
        model: Aviation_Job,
        attributes: [],
        required: true,
        where: { ...scope, flightDate: inPeriod(periods.fortnight), canceled: false },
      }],
      raw: true,
    });

    // What FLEW: what each leg was asked to carry, less what it left behind.
    // Not grossWeight - that is the AWB's documented total, repeated on every
    // leg, so summing it counts a split shipment once per flight.
    //
    // Carry-in is resolved across each AWB's legs rather than read off the row,
    // and the legs OUTSIDE the fortnight are fetched for it: a leg whose
    // predecessor flew a fortnight ago would otherwise look like a first leg
    // and credit the period with the whole air waybill.
    const resolvedFortnight = carryInByLeg(
      await siblingLegs([{ Aviation_Consignments: fortnightLines }])
    );
    const uplift = fortnightLines.reduce(
      (t, l) => t + flownWeightOf(resolvedFortnight, l), 0
    );
    // DISTINCT air waybills, not consignment rows: a shipment split across
    // two aircraft is one AWB on two flights, and counting it twice would
    // overstate the fortnight's business.
    const awbCount = new Set(
      fortnightLines.map((l) => String(l.awb || '').trim()).filter(Boolean)
    ).size;

    /* ---------------------- pending loads ----------------------------
     * Every leg of every AWB that has EVER been offloaded, plus every other
     * leg of those same AWBs - the later ones are what settle the earlier
     * ones, so they have to come along or a settled offload still reads as
     * outstanding.
     *
     * Deliberately not date-windowed: cargo left behind eight months ago and
     * never shipped is more of a problem than cargo left behind last week,
     * not less, and a rolling window would quietly drop exactly the rows
     * worth chasing.
     * -------------------------------------------------------------- */
    const offloadedAwbs = await Aviation_Consignment.findAll({
      attributes: ['awb'],
      where: { offload: { [Op.gt]: 0 }, awb: { [Op.ne]: null } },
      include: [{
        model: Aviation_Job, attributes: [], required: true, where: { ...scope, canceled: false },
      }],
      group: ['Aviation_Consignment.awb'],
      raw: true,
    });
    const awbList = offloadedAwbs.map((x) => x.awb).filter((x) => String(x || '').trim());

    let pending = { rows: [], totalPending: 0, count: 0 };
    if (awbList.length) {
      const legs = await Aviation_Consignment.findAll({
        attributes: ['id', 'awb', 'grossWeight', 'offload', 'destination', 'awbClosed'],
        where: { awb: { [Op.in]: awbList } },
        include: [
          {
            model: Aviation_Job,
            attributes: ['id', 'jobNo', 'flightNo', 'flightDate', 'status', 'canceled'],
            required: true,
            where: scope,
          },
          { model: Aviation_Carrier, attributes: ['name'], required: false },
          { model: Clients, as: 'masterAgent', attributes: ['name'], required: false },
          { model: Clients, as: 'shipper', attributes: ['name'], required: false },
          // For naming the cargo on the row. What decides whether it is still
          // OUTSTANDING is the AWB's own closed flag, not its commodity - see
          // isAwbClosed in functions/aviationPendingLoads.
          { model: Commodity, attributes: ['name'], required: false },
        ],
      });

      pending = pendingLoads(legs.map((l) => ({
        id: l.id,
        awb: l.awb,
        grossWeight: l.grossWeight,
        offload: l.offload,
        destination: l.destination,
        awbClosed: l.awbClosed,
        AviationJobId: l.Aviation_Job?.id ?? null,
        jobNo: l.Aviation_Job?.jobNo || '',
        flightNo: l.Aviation_Job?.flightNo || '',
        flightDate: l.Aviation_Job?.flightDate || '',
        status: l.Aviation_Job?.status,
        canceled: l.Aviation_Job?.canceled,
        carrier: l.Aviation_Carrier?.name || '',
        masterAgent: l.masterAgent?.name || '',
        shipper: l.shipper?.name || '',
        commodity: l.Commodity?.name || '',
      })));
    }

    res.json({
      status: 'success',
      result: {
        flights: { fortnight, month, quarter },
        // The dates each tile actually covers, so the screen can say so
        // rather than leaving "this fortnight" to be guessed at.
        periods,
        uplift,
        awbCount,
        pending: {
          // Capped for the dashboard; the count and total are of the WHOLE
          // set, so a truncated list still reports the real size of the
          // problem rather than the size of the table.
          rows: pending.rows.slice(0, 25),
          shown: Math.min(pending.rows.length, 25),
          count: pending.count,
          totalPending: pending.totalPending,
        },
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The monthly sector report.
 *
 *   GET /aviationJob/report?month=YYYY-MM&companyId=1&mergeAircraft=true
 *
 * `mergeAircraft` is a presentation choice made on the SERVER, because it
 * changes the totals each block reports - see functions/aviationReport. The
 * screen and the exported workbook both read what comes back, so the two
 * cannot end up grouping a month differently.
 *
 * Everything the report needs is derived here rather than stored: uplift is
 * summed off each flight's consignments by the CARRIER's ER/IFA/Other tag, and
 * manifest is the sum of their gross weights. The arithmetic itself lives in
 * functions/aviationReport so it can be tested without a database.
 */
routes.get('/report', async (req, res) => {
  try {
    const month = String(req.query.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ status: 'error', result: 'month must be YYYY-MM.' });
    }

    const where = { flightDate: { [Op.like]: `${month}-%` } };
    if (req.query.companyId) where.companyId = String(req.query.companyId);

    const flights = await Aviation_Job.findAll({
      where,
      include: [
        { model: Aviation_Aircraft, attributes: ['name'], required: false },
        {
          model: Aviation_Consignment,
          required: false,
          // reportingTag is FETCHED, not just the carrier's category: it is
          // the AWB's own answer and wins over the carrier's, so a query that
          // cannot see it would silently report every override under the
          // column it was overriding. See carrierCategory.tagFor.
          // id and awb are FETCHED so each leg can be matched to the other
          // legs of its air waybill - that is what decides its carry-in. See
          // siblingLegs and carryInByLeg.
          attributes: ['id', 'awb', 'grossWeight', 'offload', 'carriedForward', 'reportingTag'],
          include: [{ model: Aviation_Carrier, attributes: ['category'], required: false }],
        },
      ],
      order: [['flightDate', 'ASC']],
    });

    // Region comes from the DESTINATION airport's country. Falling back to the
    // airport code rather than lumping everything into "unmapped" means a
    // destination whose country has not been filled in still gets its own row
    // instead of silently merging with unrelated sectors.
    const codes = [...new Set(flights.map((f) => f.destination).filter(Boolean))];
    const airports = codes.length
      ? await Airports.findAll({
          where: { airportCode: codes },
          attributes: ['airportCode', 'country'],
        })
      : [];
    const countryByCode = Object.fromEntries(
      airports.map((a) => [a.airportCode, (a.country || '').trim()])
    );

    // What each leg was asked to carry, decided from its AWB's whole history
    // rather than the snapshot on the row - including legs that flew outside
    // this month, which is why siblingLegs is not date-bounded.
    const resolved = carryInByLeg(await siblingLegs(flights));

    const rows = flights.map((f) => {
      // MANIFEST AND UPLIFT ARE DIFFERENT NUMBERS, and this is where they
      // part company:
      //
      //   manifest  what this flight was asked to take   = sum of carry-in
      //   uplift    what actually left with it           = sum of carry-in - offload
      //
      // NEITHER is a sum of grossWeight. Gross is the AWB's documented total
      // and is repeated on every leg of a split shipment, so summing it counts
      // the whole air waybill again on the flight that carried the last 300 kg
      // of it. Nor is it the carriedForward stored on the row, which is a
      // snapshot nobody recomputes and nobody can see. Carry-in is resolved
      // from the AWB's own legs - see functions/aviationPendingLoads.
      const uplift = { GAM: 0, IFA: 0, Other: 0, untagged: 0 };
      let manifest = 0;
      for (const c of f.Aviation_Consignments || []) {
        const asked = carryInOf(resolved, c);
        manifest += asked;
        // THE AWB'S OWN TAG FIRST, then its carrier's - see
        // carrierCategory.tagFor, which is the single place that rule lives so
        // this report, the flight screen's own totals and anything added later
        // cannot come to different answers about one consignment.
        //
        // Also normalises: a carrier registered before 1.2.3 still holds 'ER',
        // which matches no bucket, so its cargo would land in `untagged` and
        // the month's GAM column would silently lose it.
        const tag = carrierCategory.tagFor(c.reportingTag, c.Aviation_Carrier?.category);
        // `untagged` is a consignment nobody has tagged AND that has no
        // carrier to inherit from - a real gap someone has to fill in, and the
        // reason it is not simply counted as Other.
        const flew = flownWeightOf(resolved, c);
        if (tag && uplift[tag] !== undefined) uplift[tag] += flew;
        else uplift.untagged += flew;
      }
      return {
        id: f.id,
        jobNo: f.jobNo,
        flightNo: f.flightNo,
        flightDate: f.flightDate,
        status: f.status,
        canceled: f.canceled,
        pfm: f.pfm,
        pla: f.pla,
        // No offload figures. They used to be two typed fields on the flight
        // and are now recorded per AWB, where an offload actually happens -
        // so the report no longer carries a column that had no owner. The
        // per-AWB figure lives on the flight's consignment grid.
        remarks: f.remarks,
        sector: [f.origin, f.destination].filter(Boolean).join(' - '),
        aircraft: f.Aviation_Aircraft?.name || '',
        region: countryByCode[f.destination] || f.destination || '',
        manifest,
        uplift,
      };
    });

    // Only the literal string 'true' merges: a query string carries no
    // booleans, and `Boolean(req.query.mergeAircraft)` would read 'false' as
    // true - the flag would be stuck on from the first caller who sent it.
    const mergeAircraft = String(req.query.mergeAircraft || '') === 'true';

    res.json({ status: 'success', result: { month, ...buildReport(rows, { mergeAircraft }) } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

// --- aircraft master ------------------------------------------------------

routes.get('/aircraft', async (req, res) => {
  try {
    const result = await Aviation_Aircraft.findAll({ order: [['name', 'ASC']] });
    res.json({ status: 'success', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/aircraft/save', async (req, res) => {
  try {
    const { id, name, description, maxPayload, active } = req.body || {};
    if (!String(name || '').trim()) {
      return res.status(400).json({ status: 'error', result: 'Aircraft name is required.' });
    }
    const values = {
      name: String(name).trim(),
      description: String(description ?? '').trim() || null,
      maxPayload: maxPayload === '' || maxPayload === undefined ? null : num(maxPayload),
      active: active === undefined ? true : Boolean(active),
    };

    // Checked before writing so a clash reads as a sentence rather than a
    // Postgres unique-violation stack. The column is unique too.
    const existingId = asId(id);
    const clash = await Aviation_Aircraft.findOne({
      where: existingId ? { name: values.name, id: { [Op.ne]: existingId } } : { name: values.name },
      attributes: ['id'],
    });
    if (clash) {
      return res.status(409).json({
        status: 'error',
        result: `An aircraft called ${values.name} is already registered. ` +
                `The report groups by this name, so it cannot be used twice.`,
      });
    }

    if (existingId) {
      await Aviation_Aircraft.update(values, { where: { id: existingId } });
      return res.json({ status: 'success', result: await Aviation_Aircraft.findByPk(existingId) });
    }
    res.json({ status: 'success', result: await Aviation_Aircraft.create(values) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/aircraft/delete', async (req, res) => {
  try {
    const id = asId(req.body?.id);
    if (!id) return res.status(400).json({ status: 'error', result: 'id is required.' });

    // Deactivate rather than delete once flights reference it - removing the
    // aircraft would strip the grouping off historical flights and change what
    // past months report.
    const inUse = await Aviation_Job.count({ where: { AviationAircraftId: id } });
    if (inUse) {
      await Aviation_Aircraft.update({ active: false }, { where: { id } });
      return res.json({
        status: 'success',
        result: `Flown on ${inUse} flight(s), so it was deactivated rather than deleted.`,
      });
    }
    await Aviation_Aircraft.destroy({ where: { id } });
    res.json({ status: 'success', result: 'Aircraft deleted.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

// --- carrier master -------------------------------------------------------
// Registered once, picked per consignment. Kept in this router rather than a
// setup one because nothing outside aviation uses it.

// Each carrier comes back with the PARTY behind it and whether that party has
// a ledger account, because those two facts decide whether a charge against
// this carrier can be invoiced at all. A carrier with a party but no ledger
// would fail at /makeInvoice with "has no ledger account" - far better said on
// the setup screen than discovered when someone tries to bill.
routes.get('/carriers', async (req, res) => {
  try {
    const rows = await Aviation_Carrier.findAll({
      order: [['name', 'ASC']],
      include: [{
        model: Clients,
        as: 'party',
        required: false,
        attributes: ['id', 'name', 'code'],
        include: [{
          model: Client_Associations,
          required: false,
          attributes: ['id', 'ChildAccountId'],
        }],
      }],
    });

    const result = rows.map((row) => {
      const carrier = row.toJSON();
      const ledgerId = carrier.party?.Client_Associations?.find((a) => a.ChildAccountId)?.ChildAccountId
        || null;
      return {
        ...carrier,
        // NORMALISED ON THE WAY OUT, so a carrier registered before 1.2.3 does
        // not arrive at the Setup screen holding 'ER' - a value its dropdown
        // no longer offers, which renders as an empty box and saves as a
        // change the user never made.
        category: carrierCategory.read(carrier.category),
        // Flattened so the screen does not have to walk an association it does
        // not otherwise care about.
        party: carrier.party ? { id: carrier.party.id, name: carrier.party.name, code: carrier.party.code } : null,
        hasLedger: Boolean(ledgerId),
        ledgerAccountId: ledgerId,
      };
    });

    res.json({ status: 'success', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The per-flight summary.
 *
 *   GET /aviationJob/flightSummary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *       &companyId=&operatingCarrierId=&flightNo=&masterAgentId=
 *       &origin=&destination=&aircraftId=
 *
 * One row per flight, with uplift AND offload split three ways. The sector
 * report answers "how did this route do this month"; this answers "what
 * happened on each flight, and what did not fly".
 *
 * THE PERIOD IS A PLAIN FROM/TO. The fortnight, month, quarter and year
 * presets are computed by the screen and arrive here as dates - so there is
 * one date rule on the server, and a preset can never disagree with the free
 * range beside it. Bounded at BOTH ends: a flight dated next year is not part
 * of this quarter, however it was typed.
 *
 * flightDate is a 'YYYY-MM-DD' STRING, which compares correctly with BETWEEN
 * as text - the same property byFlightOrder relies on.
 *
 * THE MASTER AGENT FILTER SELECTS FLIGHTS, IT DOES NOT NARROW THE FIGURES.
 * A flight appears if it carries at least one AWB for that agent, and its
 * numbers stay whole-flight. PFM is a plan for the aircraft and cannot be
 * apportioned to one agent, so a column of part-flight figures beside a
 * whole-flight PFM would be a row that does not add up.
 */
routes.get('/flightSummary', async (req, res) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isDate(from) || !isDate(to)) {
      return res.status(400).json({
        status: 'error',
        result: 'from and to must both be dates, as YYYY-MM-DD.',
      });
    }
    if (from > to) {
      return res.status(400).json({
        status: 'error',
        result: `The range starts after it ends: ${from} to ${to}.`,
      });
    }

    const where = { flightDate: { [Op.between]: [from, to] } };
    if (req.query.companyId) where.companyId = String(req.query.companyId);

    const operatingCarrierId = asId(req.query.operatingCarrierId);
    if (operatingCarrierId) where.operatingCarrierId = operatingCarrierId;

    const aircraftId = asId(req.query.aircraftId);
    if (aircraftId) where.AviationAircraftId = aircraftId;

    // Airport codes are stored as typed, so these match exactly rather than
    // by prefix - 'JED' must not also select 'JEDX'.
    if (req.query.origin) where.origin = String(req.query.origin).trim();
    if (req.query.destination) where.destination = String(req.query.destination).trim();

    // Flight numbers are typed per flight and get spelled 'PK-301' and
    // 'PK301', so this is a contains-match rather than an equality one.
    const flightNo = String(req.query.flightNo || '').trim();
    if (flightNo) where.flightNo = { [Op.iLike]: `%${flightNo}%` };

    /* THE AGENT FILTER IS A FLIGHT SELECTOR - see the header. Resolved to a
     * list of flight ids first rather than joined, because a join to the
     * consignments would fan the flight rows out and every figure below would
     * then have to be de-duplicated back out of it. */
    const masterAgentId = asId(req.query.masterAgentId);
    if (masterAgentId) {
      const carrying = await Aviation_Consignment.findAll({
        where: { masterAgentId },
        attributes: ['AviationJobId'],
        group: ['AviationJobId'],
        raw: true,
      });
      const ids = carrying.map((x) => x.AviationJobId).filter(Boolean);
      // No flights at all, rather than the filter silently doing nothing.
      if (!ids.length) {
        return res.json({
          status: 'success',
          result: { rows: [], totals: null, labels: { gam: 'GAM', ifa: 'IFA', other: 'Other' }, from, to },
        });
      }
      where.id = { [Op.in]: ids };
    }

    const flights = await Aviation_Job.findAll({
      where,
      include: [
        { model: Aviation_Aircraft, attributes: ['id', 'name'], required: false },
        {
          model: Aviation_Carrier,
          as: 'operatingCarrier',
          attributes: ['id', 'name', 'category'],
          required: false,
        },
        {
          model: Aviation_Consignment,
          required: false,
          // reportingTag is fetched, not just the carrier's category: it is
          // the AWB's own answer and wins over its carrier's.
          // id and awb are FETCHED so each leg can be matched to the other legs
          // of its air waybill - that is what decides its carry-in.
          attributes: ['id', 'awb', 'grossWeight', 'carriedForward', 'offload', 'reportingTag'],
          include: [{ model: Aviation_Carrier, attributes: ['category'], required: false }],
        },
      ],
      order: [['flightDate', 'ASC']],
    });

    // Flattened to what the builder needs, so the arithmetic stays free of
    // Sequelize instances and is testable without a database.
    const plain = flights.map((f) => ({
      id: f.id,
      jobNo: f.jobNo,
      flightNo: f.flightNo,
      flightDate: f.flightDate,
      status: f.status,
      canceled: f.canceled,
      pfm: f.pfm,
      pla: f.pla,
      origin: f.origin,
      destination: f.destination,
      aircraft: f.Aviation_Aircraft ? f.Aviation_Aircraft.name : '',
      operatingCarrier: f.operatingCarrier
        ? { name: f.operatingCarrier.name, category: f.operatingCarrier.category }
        : null,
      consignments: (f.Aviation_Consignments || []).map((c) => ({
        id: c.id,
        awb: c.awb,
        grossWeight: c.grossWeight,
        carriedForward: c.carriedForward,
        offload: c.offload,
        reportingTag: c.reportingTag,
        carrierCategory: c.Aviation_Carrier ? c.Aviation_Carrier.category : null,
      })),
    }));

    res.json({
      status: 'success',
      // The AWBs' other legs go in too: one whose predecessor flew before
      // `from` is not in `plain`, and without it would report the whole air
      // waybill rather than its share of it.
      result: { ...buildFlightSummary(plain, await siblingLegs(flights)), from, to },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

const { CARRIER_CATEGORIES } = carrierCategory;

// Only these designations may give anything a ledger account. The SAME rule
// routes/clients applies to party creation - without it, the carrier page
// would be a way around it, and a chart of accounts anyone can add to is not
// a chart of accounts.
const LEDGER_DESIGNATIONS = ['ceo', 'cfo', 'admin'];
const canCreateLedger = (req) =>
  LEDGER_DESIGNATIONS.includes((req.user?.designation || '').toLowerCase());

routes.post('/carriers/save', async (req, res) => {
  try {
    const { id, name, prefix, category, active } = req.body || {};
    if (!String(name || '').trim()) {
      return res.status(400).json({ status: 'error', result: 'Carrier name is required.' });
    }
    // The category decides which column of the monthly report a consignment
    // lands in, so it is whitelisted rather than stored as typed. forWrite
    // also translates the pre-1.2.3 'ER' into 'GAM' rather than refusing it:
    // a browser tab left open across the upgrade is still offering the old
    // spelling, and rejecting a value the application itself handed out is a
    // bad way to tell someone to reload.
    const storedCategory = category ? carrierCategory.forWrite(category) : undefined;
    if (category && !storedCategory) {
      return res.status(400).json({
        status: 'error',
        result: `Category must be one of: ${CARRIER_CATEGORIES.join(', ')}.`,
      });
    }
    const values = {
      name: String(name).trim(),
      // Digits only - an AWB prefix is an IATA number, and a stray space or
      // dash here would show up on every AWB the carrier is picked for.
      prefix: String(prefix ?? '').replace(/\D/g, '') || null,
      category: storedCategory || carrierCategory.DEFAULT_CATEGORY,
      active: active === undefined ? true : Boolean(active),
    };

    // Check before writing so a clash reads as a sentence rather than as a
    // Postgres unique-violation stack. The column is unique too - this is the
    // message, that is the guarantee.
    const existingId = asId(id);
    if (values.prefix) {
      const clash = await Aviation_Carrier.findOne({
        where: existingId
          ? { prefix: values.prefix, id: { [Op.ne]: existingId } }
          : { prefix: values.prefix },
        attributes: ['id', 'name'],
      });
      if (clash) {
        return res.status(409).json({
          status: 'error',
          result: `Prefix ${values.prefix} is already used by ${clash.name}. ` +
                  `A prefix identifies one carrier, so it cannot be shared.`,
        });
      }
    }

    /* THE PARTY BEHIND THE CARRIER.
     *
     * Payables on an aviation AWB are, almost always, paid to the airline -
     * so the carrier needs to be billable, and a charge is only billable
     * against a PARTY with a ledger account. Registering the carrier and
     * registering that party are therefore one act, done here rather than
     * left as a second trip to Setup > Parties that is easy to forget and
     * only announces itself as a failed invoice weeks later.
     *
     * Three ways in, in order of preference:
     *   partyId supplied      link to that existing party
     *   name already a party  link to it (see functions/carrierParty.js -
     *                         creating a second "PIA" would split its ledger
     *                         history across two accounts)
     *   neither               create one
     *
     * parentAccountId is the chart-of-accounts parent the ledger account is
     * created under. Without it the party is created non-GL, exactly as
     * Setup > Parties does for a name-only party.
     */
    const wantsParty = Boolean(req.body?.createParty || req.body?.partyId);
    // A ledger is a privileged act. Strip the parent rather than refusing the
    // whole save: the carrier itself is ordinary setup data, and the party can
    // be given its account later by someone who may.
    const ledgerAllowed = canCreateLedger(req);
    const parentAccountId = ledgerAllowed ? (asId(req.body?.parentAccountId) || null) : null;
    let partyNote = null;

    if (wantsParty && !ledgerAllowed && req.body?.parentAccountId) {
      // Worded for BOTH outcomes - the party may have been created or linked,
      // and either way what did not happen is the ledger account.
      partyNote = 'No ledger account was created — only CEO/CFO/admin may create one. ' +
                  'Until it has one, nothing can be invoiced to this carrier.';
    }

    const result = await db.sequelize.transaction(async (t) => {
      let carrier;
      if (existingId) {
        await Aviation_Carrier.update(values, { where: { id: existingId }, transaction: t });
        carrier = await Aviation_Carrier.findByPk(existingId, { transaction: t });
      } else {
        carrier = await Aviation_Carrier.create(values, { transaction: t });
      }

      if (!wantsParty) return { carrier, party: null };

      // THE CARRIER'S OWN PARTY WINS unless the request names a different one.
      //
      // Without this, re-saving a carrier would fall through to the
      // match-by-name path, and a carrier that had been deliberately linked to
      // a party under another name - "PIA" the carrier billed as "Pakistan
      // International Airlines" - would be silently relinked, or given a
      // brand-new party, on the next unrelated edit to its prefix.
      const party = await ensureCarrierParty({
        models: { Clients, Client_Associations, Child_Account },
        name: values.name,
        // What the books should call this carrier, when its short name is not
        // it - "PIA" the carrier, "Pakistan International Airlines" the party.
        partyName: req.body?.partyName,
        partyId: asId(req.body?.partyId) || carrier.partyId || null,
        parentAccountId,
        createdBy: req.user?.username || null,
        transaction: t,
      });

      // Re-saving a carrier that already points at this party is a no-op on
      // the carrier row, but harmless to write.
      await Aviation_Carrier.update(
        { partyId: party.partyId },
        { where: { id: carrier.id }, transaction: t }
      );
      carrier = await Aviation_Carrier.findByPk(carrier.id, { transaction: t });
      return { carrier, party };
    });

    res.json({
      status: 'success',
      result: result.carrier,
      ...(result.party ? {
        party: {
          id: result.party.partyId,
          name: result.party.party?.name,
          // The party CODE, because /getValues labels every party option
          // "name (code)" and the flight screen registers carriers without
          // reloading. Building the label without it would name the same
          // party two ways depending on when it was created.
          code: result.party.party?.code,
          action: result.party.action,
          ledgerCreated: result.party.ledgerCreated,
        },
      } : {}),
      ...(partyNote ? { note: partyNote } : {}),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/carriers/delete', async (req, res) => {
  try {
    const id = asId(req.body?.id);
    if (!id) return res.status(400).json({ status: 'error', result: 'id is required.' });

    // Deactivate rather than delete when consignments already reference it -
    // removing the carrier would strip the ER/IFA/Other tag off historical
    // AWBs and silently change what past months report.
    const inUse = await Aviation_Consignment.count({ where: { AviationCarrierId: id } });
    if (inUse) {
      await Aviation_Carrier.update({ active: false }, { where: { id } });
      return res.json({
        status: 'success',
        result: `In use by ${inUse} consignment(s), so it was deactivated rather than deleted.`,
      });
    }
    await Aviation_Carrier.destroy({ where: { id } });
    res.json({ status: 'success', result: 'Carrier deleted.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Charges for the SAME AWB on OTHER flights.
 *
 * A shipment too big for one aircraft goes out in parts: 400 kg of an 800 kg
 * AWB on this flight, the rest on the next. Both consignments carry the same
 * AWB number - that is what ties the legs together - and the customer expects
 * ONE invoice covering the lot.
 *
 * /makeInvoice already handles that: it groups whatever charge ids it is given
 * by party, direction and currency, and never asks which flight they came
 * from. The only thing missing was seeing the other legs, which is what this
 * returns - keyed by AWB, so the screen can hang them under the right panel.
 */
routes.get('/relatedCharges', async (req, res) => {
  try {
    const jobId = asId(req.headers.jobid);
    if (!jobId) return res.json({ status: 'success', result: {} });

    const mine = await Aviation_Consignment.findAll({
      where: { AviationJobId: jobId, awb: { [Op.ne]: null } },
      attributes: ['awb'],
    });
    // Blank AWBs would match each other and pull in unrelated consignments.
    const awbs = [...new Set(mine.map((x) => (x.awb || '').trim()).filter(Boolean))];
    if (!awbs.length) return res.json({ status: 'success', result: {} });

    const siblings = await Aviation_Consignment.findAll({
      where: { awb: awbs, AviationJobId: { [Op.ne]: jobId } },
      include: [
        { model: Aviation_Job, attributes: ['id', 'jobNo', 'flightNo', 'flightDate'] },
        {
          model: Charge_Head,
          required: false,
          include: [{ model: Invoice, attributes: ['id', 'invoice_No'], required: false }],
        },
      ],
      order: [[Charge_Head, 'id', 'ASC']],
    });

    // { awb: [ { jobId, jobNo, flightNo, flightDate, chargeableWeight, charges } ] }
    const byAwb = {};
    for (const s of siblings) {
      const key = (s.awb || '').trim();
      if (!key) continue;
      (byAwb[key] = byAwb[key] || []).push({
        consignmentId: s.id,
        jobId: s.Aviation_Job?.id,
        jobNo: s.Aviation_Job?.jobNo,
        flightNo: s.Aviation_Job?.flightNo,
        flightDate: s.Aviation_Job?.flightDate,
        chargeableWeight: s.chargeableWeight,
        charges: s.Charge_Heads || [],
      });
    }
    res.json({ status: 'success', result: byAwb });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Raise invoices from selected charges.
 *
 * Body: { chargeIds: [], companyId, fiscalYearId, employeeId }
 *
 * The selection is GROUPED, not assumed homogeneous. One invoice can only
 * carry one party, one direction and one currency - a receivable owed by A and
 * a payable owed to B are two different documents - so the selected charges
 * are bucketed by (type, party, currency) and one invoice is raised per
 * bucket. Selecting a whole flight therefore does the sensible thing in one
 * click instead of erroring.
 *
 * Numbering, type and party resolution deliberately mirror
 * /invoice/makeInvoiceNew:
 *   - receivable -> 'Job Invoice', JI series;  payable -> 'Job Bill', JB
 *   - the number is company-init-N/fiscalYearSuffix, N from the last of that
 *     type in this fiscal year
 *   - party_Id is the LEDGER account (Client_Associations.ChildAccountId), not
 *     the client id. Get this wrong and the invoice never reaches the ledger.
 */
routes.post('/makeInvoice', async (req, res) => {
  try {
    const { chargeIds, companyId, fiscalYearId, employeeId } = req.body;
    if (!Array.isArray(chargeIds) || !chargeIds.length) {
      return res.status(400).json({ status: 'error', result: 'No charges selected.' });
    }

    const charges = await Charge_Head.findAll({
      where: {
        id: chargeIds,
        AviationConsignmentId: { [Op.ne]: null },
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
    const unapproved = charges.filter((c) => String(c.status) !== '1');
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

    /* ------------------- what goes on one document -------------------
     * Side, party, currency AND EX-RATE. The first three were always here;
     * the ex-rate is in the key because an invoice header carries ONE
     * `ex_rate`, and every figure the screen shows below the charge table is
     * derived from it - "Total (Local)" is literally total x ex_rate. Two
     * charges converted at different rates on one document make that header
     * rate a fiction, and the totals stop agreeing with the lines above them.
     *
     * In practice it almost never splits anything: the ex-rate comes from the
     * AWB's buying or selling rate, and the AWBs going to one master agent on
     * one flight share it. When it does split, the two really were two
     * different conversions.
     * ------------------------------------------------------------------ */
    const buckets = new Map();
    for (const c of charges) {
      const key = `${c.type}|${c.partyId}|${invoiceCurrency(c)}|${num(c.ex_rate) || 1}`;
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
      const numbering = await readNumbering();
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

      /* --------------- the currency the document is raised in ---------------
       * An airline sells space in DOLLARS. Its invoices and bills are USD
       * documents that happen to be reported in local currency, not local
       * documents - so the charge's own currency decides, and only a charge
       * deliberately set to PKR produces a PKR document.
       *
       * This was hardcoded to PKR with an ex-rate of 1. The effect was not
       * just a wrong label: the header total was then held as the LOCAL
       * figure, so users flipped the currency selector to USD by hand, which
       * relabels the total without reconverting it (ex_rate being 1, there is
       * nothing to convert by) - and the invoice ended up claiming a
       * rupee-sized total in dollars.
       *
       * `total` is held IN THE INVOICE'S CURRENCY, which is the convention
       * approveInvoice recomputes by: net_amount for a foreign-currency
       * document, local_amount for a local one. Keeping the two in step is
       * what makes total x ex_rate equal the sum of the lines' local amounts,
       * which is what the screen shows underneath them.
       * ------------------------------------------------------------------ */
      const currency = invoiceCurrency(first);
      const exRate = currency === LOCAL_CURRENCY ? 1 : (num(first.ex_rate) || 1);
      const total = group.reduce(
        (t, c) => t + num(currency === LOCAL_CURRENCY ? c.local_amount : c.net_amount),
        0,
      );

      const invoice = await Invoice.create({
        invoice_No: invoiceNumber(numbering, { type, company, seq: nextId, suffix }),
        invoice_Id: nextId,
        type,
        status: '1',
        operation: 'AV',
        payType: first.type,
        party_Id: account.ChildAccountId,
        party_Name: first.name,
        currency,
        ex_rate: String(exRate),
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

      // Raise it approved, with its voucher and voucher heads, so it reaches
      // the ledger immediately - an aviation invoice is only ever created from
      // charges that are already approved, so there is nothing left to review.
      //
      // Calls the SAME function /invoice/approve uses rather than repeating
      // the posting logic, so the two can never disagree about how an invoice
      // hits the books.
      //
      // A posting failure does NOT discard the invoice. By this point it
      // exists and its charges point at it; throwing would leave that state
      // behind with only a stack trace to explain it. The invoice is kept
      // unapproved instead - visible in Accounts > Invoice/Bills and
      // approvable by hand once the cause (usually a missing ledger account)
      // is fixed - and the reason is reported back.
      let postError = null;
      try {
        await approveInvoice({ id: invoice.id, fiscalYearId, employeeId });
      } catch (e) {
        postError = e.message || String(e);
        console.error(`[aviation] ${invoice.invoice_No} raised but not posted:`, e);
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
    }

    res.json({ status: 'success', result: created });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/* ==========================================================================
 * THE SALES REPORT
 *
 *   GET /aviationJob/salesReport?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * One row per APPROVED AWB - what it was bought at, what it was sold at, and
 * what has been remitted against it. The arithmetic is in
 * functions/aviationSalesReport; this selects the AWBs, resolves the two
 * breakout charge-code lists, and works out what each bill has been settled
 * for. See that module for what every column means.
 * ====================================================================== */

/**
 * The charges the two breakout columns name, as the ids the rows carry.
 *
 * HELD IN AppSetting rather than as a column on Charges: Charges is a SHARED
 * master, synced with CREATE TABLE IF NOT EXISTS (see models/index.js), so a
 * new column there is a hand migration on every install. A settings row needs
 * none, and the lists are a reporting preference rather than a property of the
 * charge.
 *
 * CONFIGURED AS CHARGE CODES, MATCHED AS IDS. The two settings hold the CODE
 * staff recognise - the number the charge screen labels it with, `(2) AF` - so
 * setting them up does not mean looking up primary keys. But Charge_Head.charge
 * stores the Charges ID (see functions/aviationCharge, which says so on the
 * line that writes it), and on a migrated install the two are not the same
 * number: the customs import had to add `climaxId` precisely because it had
 * been putting a legacy id in `code`. Matching the configured value straight
 * against the stored one would therefore break out the WRONG charge on exactly
 * the installs that have most history. So codes are translated here, once.
 *
 * ABSENT IS FINE, and is the default state. The breakouts are informational -
 * with neither list set, both columns read zero and Payable is unchanged. See
 * the module: nothing is ever subtracted to make them.
 *
 * A CODE THAT MATCHES NO CHARGE IS DROPPED, not passed through. Passing it on
 * would leave a value that matches no row, so the column would silently read
 * zero; dropping it means an unconfigured column and a configured-but-wrong one
 * behave the same way, which is the honest outcome for a setting nothing can
 * validate at the time it is typed.
 */
const salesReportCodes = async () => {
  const rows = await db.AppSetting.findAll({
    where: { key: { [Op.in]: ['salesReportGtcCodes', 'salesReportErCodes'] } },
    attributes: ['key', 'value'],
    raw: true,
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const split = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  const gtc = split(byKey.salesReportGtcCodes);
  const er = split(byKey.salesReportErCodes);
  if (!gtc.length && !er.length) return { gtcCodes: '', erCodes: '' };

  const masters = await Charges.findAll({
    where: { code: { [Op.in]: [...new Set([...gtc, ...er])] } },
    attributes: ['id', 'code'],
    raw: true,
  });
  const idByCode = new Map(masters.map((m) => [String(m.code), String(m.id)]));
  const toIds = (codes) => codes.map((c) => idByCode.get(c)).filter(Boolean).join(',');

  return { gtcCodes: toIds(gtc), erCodes: toIds(er) };
};

/**
 * What each bill on these AWBs has been settled for.
 *
 * `total` is the bill's WHOLE payable across every AWB on it - including AWBs
 * outside the filtered period - because that is the denominator the share must
 * be taken against. Computing it from the AWBs on the report instead would
 * hand a filtered-out AWB's share to the ones that remain, and the same bill
 * would settle for different figures depending on the date range asked for.
 */
const billSettlements = async (invoiceIds) => {
  if (!invoiceIds.length) return {};

  const charges = await Charge_Head.findAll({
    where: { InvoiceId: { [Op.in]: invoiceIds }, type: 'Payble' },
    attributes: ['InvoiceId', 'local_amount'],
    raw: true,
  });
  const totals = new Map();
  for (const c of charges) {
    totals.set(c.InvoiceId, (totals.get(c.InvoiceId) || 0) + num(c.local_amount));
  }

  const settlements = await Invoice_Transactions.findAll({
    where: { InvoiceId: { [Op.in]: invoiceIds } },
    attributes: ['InvoiceId', 'amount', 'gainLoss'],
    include: [{
      model: Vouchers,
      required: false,
      // settleExRate is the rate the payment actually went out at; exRate is
      // the voucher's own booking rate and is the fallback for a voucher
      // raised before the two were separated.
      attributes: ['id', 'settleExRate', 'exRate', 'voucher_Id'],
    }],
  });

  const bills = {};
  for (const id of invoiceIds) bills[id] = { total: totals.get(id) || 0, transactions: [] };
  for (const t of settlements) {
    const bill = bills[t.InvoiceId];
    if (!bill) continue;
    const voucher = t.Voucher || t.Vouchers;
    bill.transactions.push({
      amount: t.amount,
      gainLoss: t.gainLoss,
      settleExRate: num(voucher && voucher.settleExRate) || num(voucher && voucher.exRate) || null,
    });
  }
  return bills;
};

routes.get('/salesReport', async (req, res) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isDate(from) || !isDate(to)) {
      return res.status(400).json({
        status: 'error',
        result: 'from and to must both be dates, as YYYY-MM-DD.',
      });
    }
    if (from > to) {
      return res.status(400).json({
        status: 'error',
        result: `The range starts after it ends: ${from} to ${to}.`,
      });
    }

    // Ranged on the FLIGHT date, the same as every other aviation report: for
    // an airline "July" means the flights that operated in July, whenever the
    // AWB was typed.
    const flightWhere = { flightDate: { [Op.between]: [from, to] } };
    if (req.query.companyId) flightWhere.companyId = String(req.query.companyId);

    const operatingCarrierId = asId(req.query.operatingCarrierId);
    if (operatingCarrierId) flightWhere.operatingCarrierId = operatingCarrierId;

    const flightNo = String(req.query.flightNo || '').trim();
    if (flightNo) flightWhere.flightNo = { [Op.iLike]: `%${flightNo}%` };

    /* ONLY APPROVED, NEVER DIRECT - see the module. Approval is what raises
     * the air-freight charge on both sides, so an unapproved AWB would report
     * a selling rate with no cost behind it. */
    const where = { awbApproved: true, direct: false };

    const masterAgentId = asId(req.query.masterAgentId);
    if (masterAgentId) where.masterAgentId = masterAgentId;

    /* THE SEARCH TERM IS NORMALISED THE WAY THE STORED VALUE IS.
     *
     * An air waybill number is written with a hyphen after the airline prefix
     * - 230-68287494 - and stored with the punctuation stripped, because
     * normalizeAwb runs on the way in (see functions/awb, and the same rule in
     * /relatedCharges). Matching the typed string raw would therefore find
     * nothing for exactly the spelling everybody uses, while still working for
     * a partial typed without the hyphen - which is the worst kind of broken,
     * because it looks like the AWB is not there. */
    const awbSearch = normalizeAwb(req.query.awb);
    if (awbSearch) where.awb = { [Op.iLike]: `%${awbSearch}%` };

    /* The sector filters read the AWB's OWN origin and destination, falling
     * back to the flight's. Matched on either, because a consignment that
     * never had its own sector typed still flew the flight's one, and the
     * operator filtering on ISB means both. */
    const sector = [];
    const sectorOn = (field, value) => {
      if (!value) return;
      const v = String(value).trim();
      sector.push({
        [Op.or]: [
          { [field]: v },
          {
            [field]: { [Op.is]: null },
            [`$Aviation_Job.${field}$`]: v,
          },
        ],
      });
    };
    sectorOn('origin', req.query.origin);
    sectorOn('destination', req.query.destination);
    if (sector.length) where[Op.and] = sector;

    const lines = await Aviation_Consignment.findAll({
      where,
      include: [
        {
          model: Aviation_Job,
          required: true,
          where: flightWhere,
          attributes: ['id', 'jobNo', 'flightNo', 'flightDate', 'origin', 'destination'],
          include: [{
            model: Aviation_Carrier,
            as: 'operatingCarrier',
            attributes: ['id', 'name'],
            required: false,
          }],
        },
        { model: Clients, as: 'masterAgent', attributes: ['id', 'name'], required: false },
        {
          model: Charge_Head,
          required: false,
          attributes: ['id', 'charge', 'type', 'currency', 'ex_rate', 'local_amount', 'InvoiceId'],
        },
      ],
    });

    // Flattened to what the builder needs, so the arithmetic stays free of
    // Sequelize instances and is testable without a database.
    const plain = lines.map((c) => {
      const job = c.Aviation_Job || {};
      return {
        id: c.id,
        jobNo: job.jobNo || '',
        flightNo: job.flightNo || '',
        airline: job.operatingCarrier ? job.operatingCarrier.name : '',
        date: job.flightDate || '',
        awb: c.awb || '',
        origin: c.origin || job.origin || '',
        destination: c.destination || job.destination || '',
        grossWeight: c.grossWeight,
        chargeableWeight: c.chargeableWeight,
        buyingRate: c.buyingRate,
        sellingRate: c.sellingRate,
        // The legacy single ex-rate is the fallback for an AWB entered before
        // the two sides were split - the same order the save path uses.
        buyingExRate: c.buyingExRate == null ? c.exRate : c.buyingExRate,
        agent: c.masterAgent ? c.masterAgent.name : '',
        charges: (c.Charge_Heads || []).map((ch) => ({
          code: ch.charge,
          type: ch.type,
          currency: ch.currency,
          exRate: ch.ex_rate,
          localAmount: ch.local_amount,
          invoiceId: ch.InvoiceId,
        })),
      };
    });

    const invoiceIds = [...new Set(
      plain
        .flatMap((c) => c.charges.map((ch) => ch.invoiceId))
        .filter((x) => x !== null && x !== undefined),
    )];

    const [bills, codes] = await Promise.all([
      billSettlements(invoiceIds),
      salesReportCodes(),
    ]);

    res.json({
      status: 'success',
      result: { ...buildSalesReport(plain, { bills, ...codes }), from, to },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

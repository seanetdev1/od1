// The PFM - the pre-flight manifest, and the register of them.
//
// Mounted under /aviationJob/pfm by ./index.js, because it is part of the
// aviation module and reads tables only that module owns. A freight or customs
// install cannot reach it.
//
// WHAT THIS ROUTER IS FOR. A PFM is the PLAN a flight is built from: the load
// agreed with the master agents before the aircraft goes. The flight screen no
// longer accepts a typed flight number - it picks a PFM, and everything on the
// plan except the weights is copied onto the flight. So this router owns two
// things the flight screen depends on:
//
//   /selectable   which plans may be built into a flight, and why the rest
//                 may not. Three rules, stated once - see the module
//                 functions/aviationPfmStatus.
//   /getById      the whole plan, which is what the import copies from.
//
// A PFM THAT HAS BEEN FLOWN IS FROZEN. Once a job points at a plan, that plan
// is what the flight was built from and what the office agreed on the day;
// editing it afterwards would leave the flight quoting a number, a date or an
// airline the plan no longer says. Every write below refuses a used PFM and
// names the flight that took it, rather than half-applying the change.
const routes = require('express').Router();
const Sequelize = require('sequelize');
const Op = Sequelize.Op;
const {
  Aviation_Pfm, Aviation_Pfm_Line, Aviation_Job, Aviation_Carrier, Aviation_Aircraft, Aviation_Awb,
} = require('../../functions/Associations/aviationAssociations');
const { Clients } = require('../../functions/Associations/clientAssociation');
const { Commodity } = require('../../models');
const { createHistory } = require('../../functions/history');
const { companyShort } = require('../../functions/companyCodes');
const { resolveSelectedFiscalYear } = require('../../functions/Associations/fiscalYearAssociations');
const {
  readNumbering, lastInYear, nextAfter, perCompany, formatNumber,
} = require('../../functions/documentNumber');
// One spelling per AWB number, decided here rather than trusted from the
// screen - a planned leg and the consignment imported from it must store the
// same digits, or nothing downstream can match them.
const { normalizeAwb } = require('../../functions/awb');
// Draft / Confirmed / Cancelled, and the one rule that says which plans a
// flight may be built from.
const pfmStatus = require('../../functions/aviationPfmStatus');
const moment = require('moment');

// Ids arrive from URLs and JSON bodies as strings, so "undefined" and "null"
// are truthy and sail past a plain `if (!id)` into Postgres, which rejects
// them with "invalid input syntax for type integer". Same helper, and the same
// reason for it, as ./index.js and ./awb.js.
const asId = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return /^[0-9]+$/.test(s) ? Number(s) : null;
};

// TODAY, as the date rule sees it. A 'YYYY-MM-DD' string, because that is how
// flightDate is stored and text comparison on that format is date comparison.
// Read once per request so one response cannot straddle midnight.
const today = () => moment().format('YYYY-MM-DD');

const partyAttrs = ['id', 'name', 'code'];

/* What a PFM looks like when it is read back: the header, its lines, and the
 * flight built from it if there is one.
 *
 * Aviation_Job is included on every read, not just the list, because it is
 * what freezes the plan - the form has to know before it draws a single
 * editable box, and asking for it separately would mean a screen that renders
 * editable and then greys itself out. */
const pfmInclude = [
  {
    model: Aviation_Carrier,
    as: 'operatingCarrier',
    attributes: ['id', 'name', 'prefix', 'category'],
    required: false,
  },
  { model: Aviation_Aircraft, attributes: ['id', 'name', 'maxPayload'], required: false },
  // The flight this plan became, if it has been flown. Its presence is the
  // whole of the "unused" rule - see the association file.
  { model: Aviation_Job, attributes: ['id', 'jobNo', 'flightNo', 'flightDate'], required: false },
  {
    model: Aviation_Pfm_Line,
    required: false,
    include: [
      { model: Aviation_Carrier, attributes: ['id', 'name', 'prefix', 'category'], required: false },
      // Who carries it onward. Aliased, and NOT the same question as the
      // carrier above - see the model.
      { model: Aviation_Carrier, as: 'slCarrier', attributes: ['id', 'name', 'prefix'], required: false },
      { model: Clients, as: 'masterAgent', attributes: partyAttrs, required: false },
      { model: Commodity, attributes: ['id', 'name', 'hs'], required: false },
      {
        model: Aviation_Awb,
        attributes: ['id', 'awbNumber', 'prefix', 'serial', 'checkDigit', 'masterAgentId'],
        required: false,
      },
    ],
  },
];

const getPfm = async (id) => Aviation_Pfm.findOne({
  where: { id },
  include: pfmInclude,
  order: [[Aviation_Pfm_Line, 'sortOrder', 'ASC']],
});

/**
 * A planned line worth keeping.
 *
 * MIRRORS isRealLine in ./index.js and the frontend's aviationValidation:
 * anything else is an "Add Line +" the user thought better of, and storing it
 * would put a blank row on the plan that has to be deleted by hand later - and
 * would then be imported onto the flight as a blank consignment.
 */
const isRealLine = (x) =>
  Boolean(x && (x.AviationCarrierId || x.masterAgentId || x.AviationAwbId ||
    String(x.awb || '').trim() || String(x.destination || '').trim()));

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const asInt = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const lineValues = (x, i, pfmId) => ({
  sortOrder:         i,
  // Separators stripped on the way in, exactly as a consignment's are, so a
  // planned AWB and the consignment imported from it are the same string.
  awb:               normalizeAwb(x.awb),
  AviationAwbId:     asId(x.AviationAwbId),
  AviationCarrierId: asId(x.AviationCarrierId),
  masterAgentId:     asId(x.masterAgentId),
  CommodityId:       asId(x.CommodityId),
  destination:       x.destination || null,
  // The onward carriage. slCarrierId is a registered carrier; slFlightNo is
  // another airline's flight number and is free text - see the model.
  slCarrierId:       asId(x.slCarrierId),
  slFlightNo:        String(x.slFlightNo || '').trim() || null,
  // PLANNED figures. Expectations, not measurements: the import deliberately
  // leaves all three behind and carries only their chargeable TOTAL, onto the
  // flight's PFM field. See functions/aviationPfmImport on the frontend.
  pieces:            asInt(x.pieces),
  grossWeight:       num(x.grossWeight),
  chargeableWeight:  num(x.chargeableWeight),
  loadPlan:          x.loadPlan || null,
  AviationPfmId:     pfmId,
});

/**
 * Save a plan's lines.
 *
 * DESTROY AND RECREATE, unlike saveConsignments in ./index.js - and the
 * difference is the point. A consignment owns charges that may sit on an
 * issued invoice, so it must keep its id for ever. A planned line owns
 * nothing: no charges, no invoice, no offload, and the flight built from it
 * holds a COPY rather than a reference. So there is nothing for an id to
 * protect here, and rewriting the set is both simpler and immune to the
 * update-in-place bugs that come with matching rows up.
 */
const saveLines = async (list, pfmId) => {
  if (!Array.isArray(list)) return;
  const keep = list.filter(isRealLine);
  await Aviation_Pfm_Line.destroy({ where: { AviationPfmId: pfmId } });
  if (!keep.length) return;
  await Aviation_Pfm_Line.bulkCreate(keep.map((x, i) => lineValues(x, i, pfmId)));
};

/**
 * The flight built from this plan, if any - as a job number to put in a
 * message, or null.
 *
 * Asked by id rather than read off an include, because every write path needs
 * the answer BEFORE it touches anything, and the write paths do not otherwise
 * load the plan.
 */
const flownAs = async (pfmId) => {
  const job = await Aviation_Job.findOne({
    where: { AviationPfmId: pfmId },
    attributes: ['id', 'jobNo'],
  });
  return job ? (job.jobNo || `flight #${job.id}`) : null;
};

/* ---------------------------------------------------------------------------
 * THE LIST.
 *
 *   GET /aviationJob/pfm/get?companyId=&flight=&status=
 *
 * Newest first, like the flight list beside it. `flight` is a contains-match
 * on the flight number for the same reason /flightSummary's is: numbers get
 * spelled 'PK-301' and 'PK301'. It matches the PFM number too, because that is
 * the other thing anyone has in front of them when they come looking.
 * ------------------------------------------------------------------------ */
routes.get('/get', async (req, res) => {
  try {
    const where = {};
    const companyId = req.query.companyId ?? req.headers.companyid;
    if (companyId) where.companyId = String(companyId);

    const flight = String(req.query.flight || req.headers.flight || '').trim();
    if (flight) {
      where[Op.or] = [
        { flightNo: { [Op.iLike]: `%${flight}%` } },
        { pfmNo: { [Op.iLike]: `%${flight}%` } },
      ];
    }

    const status = String(req.query.status || '').trim();
    if (status && pfmStatus.PFM_STATUSES.includes(status)) where.status = status;

    const result = await Aviation_Pfm.findAll({
      where,
      include: pfmInclude,
      order: [['createdAt', 'DESC'], [Aviation_Pfm_Line, 'sortOrder', 'ASC']],
    });
    res.json({ status: 'success', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

routes.get('/getById', async (req, res) => {
  try {
    const raw = req.query.id ?? req.headers.id;
    const id = asId(raw);
    if (!id) {
      return res.status(400).json({ status: 'error', result: `Not a valid PFM id: ${raw}` });
    }
    const result = await getPfm(id);
    if (!result) return res.status(404).json({ status: 'error', result: 'PFM not found.' });
    res.json({ status: 'success', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

/* ---------------------------------------------------------------------------
 * WHAT THE FLIGHT SCREEN MAY PICK FROM.
 *
 *   GET /aviationJob/pfm/selectable?companyId=&currentId=
 *
 * Confirmed, not yet flown, and dated today or later. The three rules live in
 * functions/aviationPfmStatus so this endpoint, the PFM screen and the server's
 * own refusal cannot come to different answers.
 *
 * `currentId` IS ALWAYS INCLUDED, whatever it fails. It is the plan the flight
 * being edited is already built from, and it fails the "unused" rule BY
 * DEFINITION - that flight is what used it. Leaving it out would open every
 * saved flight with an empty flight-number box and save a null over a real
 * link the moment anything else on the screen was touched.
 *
 * LIGHTWEIGHT ROWS, not whole plans. The dropdown shows the flight number, the
 * PFM number and the date; the lines are fetched by /getById when one is
 * actually picked, because that is a deliberate act and the import is what
 * needs them.
 * ------------------------------------------------------------------------ */
const selectableAttrs = [
  'id', 'pfmNo', 'flightNo', 'flightDate', 'origin', 'status',
  'operatingCarrierId', 'AviationAircraftId',
];

routes.get('/selectable', async (req, res) => {
  try {
    const where = { status: pfmStatus.CONFIRMED, flightDate: { [Op.gte]: today() } };
    if (req.query.companyId) where.companyId = String(req.query.companyId);

    const rows = await Aviation_Pfm.findAll({
      where,
      attributes: selectableAttrs,
      include: [
        { model: Aviation_Job, attributes: ['id', 'jobNo'], required: false },
        { model: Aviation_Carrier, as: 'operatingCarrier', attributes: ['id', 'name'], required: false },
        { model: Aviation_Aircraft, attributes: ['id', 'name'], required: false },
      ],
      order: [['flightDate', 'ASC'], ['flightNo', 'ASC']],
    });

    // Unused: no flight points at it. Filtered here rather than as a NOT
    // EXISTS so the include above is the single source of the answer - the
    // same include the PFM screen greys itself out on.
    const free = rows.filter((r) => !r.Aviation_Job);

    /* The plan this flight is ALREADY built from, fetched separately and put at
     * the head of the list. It is excluded by every rule above - it is used, by
     * this very flight, and its date has very likely passed - which is exactly
     * why it cannot be left to the query. */
    const currentId = asId(req.query.currentId);
    let current = null;
    if (currentId && !free.some((r) => r.id === currentId)) {
      current = await Aviation_Pfm.findOne({
        where: { id: currentId },
        attributes: selectableAttrs,
        include: [
          { model: Aviation_Carrier, as: 'operatingCarrier', attributes: ['id', 'name'], required: false },
          { model: Aviation_Aircraft, attributes: ['id', 'name'], required: false },
        ],
      });
    }

    const shape = (r, isCurrent) => ({
      id: r.id,
      pfmNo: r.pfmNo,
      flightNo: r.flightNo,
      flightDate: r.flightDate,
      origin: r.origin,
      airline: r.operatingCarrier ? r.operatingCarrier.name : '',
      aircraft: r.Aviation_Aircraft ? r.Aviation_Aircraft.name : '',
      // Marks the row that is only in the list because this flight is on it.
      // The screen labels it rather than letting it look like fresh stock.
      current: Boolean(isCurrent),
    });

    res.json({
      status: 'success',
      result: [
        ...(current ? [shape(current, true)] : []),
        ...free.map((r) => shape(r, r.id === currentId)),
      ],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

routes.post('/create', async (req, res) => {
  try {
    const data = req.body.data || {};
    delete data.id;

    const fiscalYear = await resolveSelectedFiscalYear(data.fiscalYearId);
    const fySuffix = fiscalYear.suffix;
    const pfmCompany = await companyShort(data.companyId);
    const numbering = await readNumbering();

    /* Per-fiscal-year sequence, matching how a flight is numbered so the two
     * read as documents of one system - found by pfmId, never by the prefix in
     * pfmNo, so Config > Document Numbers can change the layout without
     * restarting it. lastInYear skips a row with no pfmId (see ./index.js for
     * why that matters). PFM is a fixed code; prefix and order follow jobs. */
    const last = await lastInYear(Aviation_Pfm, {
      seqCol: 'pfmId',
      noCol: 'pfmNo',
      suffix: fySuffix,
      company: { column: 'companyId', id: String(data.companyId) },
      scoped: perCompany(numbering, 'jobs'),
    });
    const nextId = nextAfter(last, 'pfmId');

    const { lines, ...header } = data;
    const result = await Aviation_Pfm.create({
      ...header,
      pfmId: nextId,
      pfmNo: formatNumber(numbering, { klass: 'jobs', company: pfmCompany, code: 'PFM', seq: nextId, suffix: fySuffix }),
      FiscalYearId: fiscalYear.id,
    });

    await saveLines(lines, result.id);
    createHistory(req.body.employeeId, 'Aviation PFM', 'Create', result.pfmNo);
    res.json({ status: 'success', result: await getPfm(result.id) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

routes.post('/edit', async (req, res) => {
  try {
    const data = req.body.data || {};
    const id = asId(data.id);
    if (!id) {
      return res.status(400).json({ status: 'error', result: `Not a valid PFM id: ${data.id}` });
    }

    /* A FLOWN PLAN IS FROZEN - see the header. Refused rather than partly
     * applied: the flight quotes this plan's number, date and airline, and
     * letting an edit through would leave the two documents disagreeing with
     * nothing to reconcile them. The screen greys itself out and says the same
     * thing, so this is the backstop for a stale tab, not the first anyone
     * hears of it. */
    const flown = await flownAs(id);
    if (flown) {
      return res.status(409).json({
        status: 'error',
        result: `This PFM has already been flown as ${flown}, so it can no longer be changed. ` +
                'Correct the flight instead.',
      });
    }

    // pfmNo/pfmId are assigned once at create; letting an edit rewrite them
    // would renumber a document the agents on it have already been given. id
    // belongs in the WHERE, not the SET.
    const pfmNo = data.pfmNo;
    delete data.pfmNo;
    delete data.pfmId;
    delete data.id;

    const { lines, ...header } = data;
    await Aviation_Pfm.update(header, { where: { id } });
    await saveLines(lines, id);
    createHistory(req.body.employeeId, 'Aviation PFM', 'Edit', pfmNo);
    res.json({ status: 'success', result: await getPfm(id) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

/* CANCEL, not delete.
 *
 * The number has been quoted to every master agent with cargo on the plan, so
 * the row stays and its status says what happened to it - the same reasoning
 * that makes /aviationJob/delete a soft cancel. A cancelled PFM is never
 * offered to a flight; see selectableReason.
 *
 * Refused for a plan that has been flown: cancelling it would say the flight
 * was built from something that was called off. */
routes.post('/delete', async (req, res) => {
  try {
    const id = asId(req.body.id);
    if (!id) {
      return res.status(400).json({ status: 'error', result: `Not a valid PFM id: ${req.body.id}` });
    }
    const flown = await flownAs(id);
    if (flown) {
      return res.status(409).json({
        status: 'error',
        result: `This PFM has been flown as ${flown} and cannot be cancelled. Cancel the flight instead.`,
      });
    }
    const pfm = await Aviation_Pfm.findOne({ where: { id }, attributes: ['pfmNo'] });
    if (!pfm) return res.status(404).json({ status: 'error', result: 'PFM not found.' });

    await Aviation_Pfm.update({ status: pfmStatus.CANCELLED }, { where: { id } });
    createHistory(req.body.employeeId, 'Aviation PFM', 'Delete', pfm.pfmNo);
    res.json({ status: 'success', result: 'PFM cancelled.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

module.exports = routes;

/**
 * Plan a B/L and air-waybill import - the B/L records only.
 *
 * SCOPE: B/L rows and nothing else. Containers, item details, stamps,
 * dimensions and B/L charges all hang off a B/L and all get their own stages,
 * exactly as the jobs stage imports jobs and not their B/Ls. The old
 * /seaJob/Upload*Jobs receivers still create the whole tree from a nested job
 * payload and are untouched.
 *
 * All four legacy B/L tables land in one Odyssey table, Bl, separated by
 * `operation`: SE, SI, AE, AI. Sea B/Ls keep their printable detail in a
 * separate table (SExp_BL_Detail.SEBLId, SImp_BL_Detail.SIBLId); air waybills
 * carry the same fields inline. Both are joined here.
 *
 * WHAT THE OLD IMPORT GOT WRONG
 *
 *   IssuePlace / IssueDate   Written with a capital I, while the model declares
 *                            issuePlace and issueDate. Sequelize silently drops
 *                            unknown attributes, so the place and date of issue
 *                            have never been migrated on any B/L or waybill -
 *                            on all four operations - and both print on the
 *                            document. This is real data loss that no error
 *                            was ever raised for.
 *
 *   wtVatCOLL                Same shape of typo for wtValCOLL. Harmless in
 *                            practice: the old import set it to "" anyway.
 *
 *   bl.SExp_BL_Detail.X      Read with no guard. A sea B/L with no detail row
 *                            threw a TypeError inside the job's transaction,
 *                            taking the job and everything else in its batch
 *                            with it.
 *
 *   no idempotency of        The B/L was created as a side effect of importing
 *   its own                  its job, so re-running to fix a B/L meant
 *                            re-running the job import, and a B/L could never
 *                            be repaired on its own.
 *
 *   the air waybill boxes   Routing (To1..3 / ByFirstCarrier, By2, By3), the
 *                           charge and weight/valuation indicators, the
 *                           declared values and the airport names were never
 *                           mapped at all. /seaJob/fixAEBL was written by hand
 *                           afterwards to backfill them, but only for air
 *                           EXPORT - air import never got them - and it wrote
 *                           `Currency` with a capital C, which the model does
 *                           not declare, so Sequelize dropped currency on
 *                           every row that pass "repaired". All of it is
 *                           mapped here, for both air operations.
 *
 * WHAT IS HARDCODED, AND WHY
 *
 *   blReleaseStatus 'Original', blhandoverType 'By Hand', releaseInstruction
 *   and remarks: the legacy B/L tables carry no equivalent column. The old
 *   import's own comments said "find reference from climax then add" - there
 *   is nothing to find. They are defaults, and the plan says how many rows
 *   took them rather than implying they were migrated.
 *
 * No database access here - pure, so it can be unit-tested.
 */

const { legacyTimestamp } = require('./legacyTime');
const OPERATIONS = ['SE', 'SI', 'AE', 'AI'];
const AIR = new Set(['AE', 'AI']);

/** Which legacy column holds the job id, per operation. */
const JOB_KEY = { SE: 'SEJobId', SI: 'SIJobId', AE: 'AEJobId', AI: 'AIJobId' };

const DEFAULT_RELEASE_STATUS = 'Original';
const DEFAULT_HANDOVER_TYPE = 'By Hand';

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

function toLegacyId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/**
 * The legacy address blocks, in the shape the B/L screen expects.
 *
 * THIS IS AN HTML CONTRACT, NOT PLAIN TEXT. The B/L content columns hold
 * `<p>` elements, and the editor reads them with cleanNullParagraphs()
 * (Components/Layouts/JobsLayout/BlComp/states.js), which:
 *
 *   - calls .replace() on the value, so it must never be null;
 *   - queries `<p>` elements, so newline-separated plain text arrives as one
 *     unstructured blob and a four-line address renders on a single line;
 *   - strips paragraphs reading "null", "tel" or "tel null", which is why the
 *     padding below is not junk - it is the placeholder set the editor is
 *     built to remove.
 *
 * So this reproduces the existing contract exactly rather than inventing a
 * tidier one: pad to ten lines, add the TEL placeholders when the source has
 * no TEL line, and wrap every line in a paragraph.
 */
const ADDRESS_LINES = 10;

/**
 * Legacy content is plain text going into an HTML column.
 *
 * 5,746 values in the real export contain & < or >, almost all of them an
 * ampersand in a goods description ("100% COTTON & 60% COTTON"). Unescaped, a
 * `<` opens a tag that swallows the text after it, and a bare `&` is invalid
 * markup that can misrender. Every consumer reads these back through
 * textContent or an HTML parser, so escaping here round-trips exactly.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')      // must be first
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Split legacy text into the lines it was written as. */
function toLines(value) {
  const raw = (value === undefined || value === null) ? '' : String(value);
  return raw.split(/\r?\n|\t/).map((p) => p.trim()).filter((p) => p.length > 0);
}

const wrap = (parts) => parts.map((p) => `<p>${escapeHtml(p)}</p>`).join('');

function formatAddress(value) {
  // Never null: cleanNullParagraphs() calls .replace() on whatever it is given
  // and a null here white-screens the B/L detail page.
  const parts = toLines(value);

  if (!parts.some((p) => /^TEL/i.test(p))) parts.push('TEL null', 'TEL null');
  while (parts.length < ADDRESS_LINES) parts.push('null');

  return wrap(parts);
}

/**
 * The same paragraph contract, without the address padding.
 *
 * For content that is rendered through the editor and both print paths but is
 * not an address block - the package count, which is free text like
 * "511 PKGS" or "300 BALES" and is multi-line on 235 rows. Written raw it has
 * no <p> at all, so cleanNullParagraphs() and pTagsToString() both find
 * nothing and it prints blank. The old import wrote it raw.
 */
function formatLines(value) {
  return wrap(toLines(value));
}

/**
 * Map one legacy B/L onto Bl columns.
 *
 * @param {object} row        the legacy B/L
 * @param {string} operation  SE | SI | AE | AI
 * @param {object} ctx
 * @param {object} ctx.detail     the sea detail row, or the row itself for air
 * @param {*}      ctx.jobId      the Odyssey SE_Job id this B/L belongs to
 * @param {object} ctx.jobFields  { AgentM3, ColoadM3, AgentInstruction, SailingDate }
 */
function mapBl(row, operation, ctx = {}) {
  const isAir = AIR.has(operation);
  // Air waybills carry their detail inline; sea B/Ls keep it in a side table.
  // Defaulting to {} is what stops one missing detail row throwing.
  const d = (isAir ? row : ctx.detail) || {};
  const job = ctx.jobFields || {};

  return {
    operation,
    // Air calls them waybill numbers, but they are the same two columns.
    hbl: cleanText(isAir ? row.HAWBNo : row.HBLNo),
    hblDate: isAir ? row.HAWBDate : row.HBLDate,
    hblIssue: '',
    mbl: cleanText(isAir ? row.MAWBNo : row.MBLNo),
    mblDate: isAir ? row.MAWBDate : row.MBLDate,

    status: Number(row.StatusId) === 1 ? 'Draft' : 'Final',
    // No legacy equivalent - see the header.
    blReleaseStatus: DEFAULT_RELEASE_STATUS,
    blhandoverType: DEFAULT_HANDOVER_TYPE,
    releaseInstruction: '',
    remarks: '',

    sailingDate: row.SailingDate ?? null,
    // A job field, not a B/L field.
    shipDate: job.SailingDate ?? null,

    shipperContent: formatAddress(d.Shipper),
    consigneeContent: formatAddress(d.Consignee),
    notifyOneContent: formatAddress(d.NotifyParty1),
    notifyTwoContent: formatAddress(d.NotifyParty2),
    deliveryContent: formatAddress(d.DeliveryAgent),
    marksContent: formatAddress(d.MarksAndNumber),
    marksContentTwo: '',
    // Rendered through the editor and both print paths, so it needs the
    // paragraph contract too - not padded, it is not an address.
    noOfPckgs: formatLines(d.NoOfPkgs),
    descOfGoodsContent: formatAddress(d.GoodsDescription),
    descOfGoodsContentTwo: '',
    // Air export names this column GrossWeight1.
    grossWeightContent: formatAddress(isAir ? (d.GrossWeight1 ?? d.GrossWeight) : d.GrossWeight),
    measurementContent: isAir ? '' : formatAddress(d.Measurement),

    AgentStamp: isAir ? '' : (cleanText(d.AgentStamp) ?? ''),
    hs: isAir ? '' : (cleanText(d.HSCode) ?? ''),
    onBoardDate: '',

    // THE fix: the old import wrote IssuePlace/IssueDate with a capital I,
    // which the model does not declare, so Sequelize dropped both silently.
    issuePlace: cleanText(d.PlaceOfIssue),
    issueDate: d.PlaceOfIssueDate ?? null,

    // Air waybills carry their own routing on the row; sea B/Ls keep it in the
    // detail table. Both fill the same three columns.
    poDeliveryTwo: isAir
      ? (cleanText(d.AirportOfFinalDest) ?? '')
      : (cleanText(d.PortOfDelivery) ?? ''),
    podTwo: isAir
      ? (cleanText(d.AirportOfDischarge) ?? '')
      : (cleanText(d.PortOfDischarge) ?? ''),
    polTwo: isAir
      ? (cleanText(d.AirportOfLoading) ?? '')
      : (cleanText(d.PortOfLoading) ?? ''),

    // Job fields. Sea export is the only table with real M3 columns; the
    // others only have an agent instruction, which is what the old import
    // used there too.
    agentM3: operation === 'SE'
      ? (job.AgentM3 ?? null)
      : (job.AgentInstruction ?? null),
    coloadM3: operation === 'SE' ? (job.ColoadM3 ?? null) : null,

    noBls: d.NoOfOriginalBL ?? null,
    formE: cleanText(row.FormENumber),
    formEDate: row.FormEDate ?? null,

    date1: '',
    date2: '',

    // THE AIR WAYBILL BLOCK.
    //
    // These are the boxes an AWB prints: routing (To/By), the charge and
    // weight/valuation indicators, and the declared values. They exist on both
    // AExp_BL and AImp_AirImportJob_BL, and none of them was ever migrated -
    // /seaJob/fixAEBL was written by hand afterwards to backfill air EXPORT
    // only, and even that dropped currency by spelling it `Currency` when the
    // model declares `currency`.
    //
    // They are not amounts despite the names: Charges is "PP"/"CC" (prepaid or
    // collect), WTPP/WTCC and OtherPP/OtherCC are "P"/"C" indicators, and
    // DeclareValueForCarriage is usually "NVD" - no value declared.
    declareCarriage: isAir ? (cleanText(d.DeclareValueForCarriage) ?? '') : '',
    declareCustoms: isAir ? (cleanText(d.DeclareValueForCustom) ?? '') : '',
    // 0 on every row of the current export, so this migrates the value
    // faithfully while carrying no information.
    insurance: isAir && d.AmountOfInsurance !== null && d.AmountOfInsurance !== undefined
      ? String(d.AmountOfInsurance)
      : '',
    handlingInfo: isAir ? (cleanText(d.HandlingInfo) ?? '') : '',
    toOne: isAir ? (cleanText(d.To1) ?? '') : '',
    toTwo: isAir ? (cleanText(d.To2) ?? '') : '',
    toThree: isAir ? (cleanText(d.To3) ?? '') : '',
    // By1 is the first carrier and has its own column, so the numbering of
    // the other two is offset by one.
    byFirstCarrier: isAir ? (cleanText(d.ByFirstCarrier) ?? '') : '',
    byOne: isAir ? (cleanText(d.By2) ?? '') : '',
    byTwo: isAir ? (cleanText(d.By3) ?? '') : '',
    // Lowercase: fixAEBL wrote `Currency`, which the model does not declare,
    // so Sequelize dropped it on every row that pass "repaired".
    currency: isAir ? (cleanText(d.Currency) ?? '') : '',
    charges: isAir ? (cleanText(d.Charges) ?? '') : '',
    wtValPPC: isAir ? (cleanText(d.WTPP) ?? '') : '',
    // Spelled wtVatCOLL by the old import, so it was dropped too.
    wtValCOLL: isAir ? (cleanText(d.WTCC) ?? '') : '',
    othersPPC: isAir ? (cleanText(d.OtherPP) ?? '') : '',
    othersCOLL: isAir ? (cleanText(d.OtherCC) ?? '') : '',
    ppWeightCharges: '0',
    ccWeightCharges: '0',
    ppvaluationCharges: '0',
    ccvaluationCharges: '0',
    ppTax: '0',
    ccTax: '0',
    ppOtherDueChargeAgent: '0',
    ccOtherDueChargeAgent: '0',
    ppOtherDueChargeCarrier: '0',
    ccOtherDueChargeCarrier: '0',
    ppTotal: '0',
    ccTotal: '0',
    applyToCWT: '0',

    // Climax entry times are Pakistan wall clock - see functions/legacyTime.
    createdAt: legacyTimestamp(row.AddOn),
    updatedAt: legacyTimestamp(row.EditOn ? row.EditOn : row.AddOn),

    SEJobId: ctx.jobId ?? null,
    climaxId: toLegacyId(row.Id),
  };
}

/**
 * @param {Array}  legacyRows
 * @param {string} operation                SE | SI | AE | AI
 * @param {object} ctx
 * @param {Iterable} ctx.existingClimaxIds    B/Ls already imported for this operation
 * @param {Map}      ctx.jobIdByLegacyId      legacy job id -> Odyssey SE_Job id
 * @param {Map}      ctx.detailByBlId         legacy B/L id -> detail row (sea only)
 * @param {Map}      ctx.jobFieldsByLegacyId  legacy job id -> the job columns a B/L needs
 */
function planBls(legacyRows, operation, ctx = {}) {
  if (!OPERATIONS.includes(operation)) {
    throw new Error(
      `Unknown B/L operation "${operation}". Expected one of: ${OPERATIONS.join(', ')}.`,
    );
  }

  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const imported = new Set([...(ctx.existingClimaxIds || [])].map(String));
  const jobs = ctx.jobIdByLegacyId instanceof Map
    ? ctx.jobIdByLegacyId : new Map(Object.entries(ctx.jobIdByLegacyId || {}));
  const details = ctx.detailByBlId instanceof Map
    ? ctx.detailByBlId : new Map(Object.entries(ctx.detailByBlId || {}));
  const jobFields = ctx.jobFieldsByLegacyId instanceof Map
    ? ctx.jobFieldsByLegacyId : new Map(Object.entries(ctx.jobFieldsByLegacyId || {}));

  const jobKey = JOB_KEY[operation];
  const isAir = AIR.has(operation);

  const problems = {
    missingId: 0,
    duplicateClimaxIds: [],
    // A B/L with no job is unreachable: every B/L screen opens from its job.
    orphaned: [],
    missingHbl: [],
    // Sea only: no detail row means no printable content at all.
    missingDetail: [],
    duplicateJobBls: [],
  };

  const seenIds = new Set();
  const seenJobs = new Set();
  const toCreate = [];
  let skipped = 0;
  let withIssuePlace = 0;

  for (const row of rows) {
    if (!row || toLegacyId(row.Id) === null) { problems.missingId += 1; continue; }

    const id = toLegacyId(row.Id);
    const key = String(id);

    if (seenIds.has(key)) { problems.duplicateClimaxIds.push(id); continue; }
    seenIds.add(key);

    if (imported.has(key)) { skipped += 1; continue; }

    const legacyJobId = toLegacyId(row[jobKey]);
    const jobId = legacyJobId === null ? undefined : jobs.get(String(legacyJobId));
    if (jobId === undefined || jobId === null) {
      // Almost always means the Jobs stage has not run, or that job was
      // skipped. Reported rather than imported detached.
      problems.orphaned.push(id);
      continue;
    }

    const detail = isAir ? row : details.get(String(id));
    if (!isAir && !detail) problems.missingDetail.push(id);

    const mapped = mapBl(row, operation, {
      detail,
      jobId,
      jobFields: jobFields.get(String(legacyJobId)),
    });

    // hbl is how a B/L is found and what prints on it.
    if (!mapped.hbl) problems.missingHbl.push(id);
    if (mapped.issuePlace) withIssuePlace += 1;

    // The legacy tables mark SEJobId/AEJobId unique, so more than one B/L per
    // job is not expected - if it happens the job screen shows one of them.
    if (seenJobs.has(String(jobId))) problems.duplicateJobBls.push(id);
    else seenJobs.add(String(jobId));

    toCreate.push(mapped);
  }

  return {
    toCreate,
    problems,
    stats: {
      operation,
      source: rows.length,
      toCreate: toCreate.length,
      alreadyImported: skipped,
      orphaned: problems.orphaned.length,
      missingHbl: problems.missingHbl.length,
      missingDetail: problems.missingDetail.length,
      duplicateJobBls: problems.duplicateJobBls.length,
      // How many rows now carry a place of issue that the old import dropped.
      withIssuePlace,
    },
    // A B/L with no number or no detail is reported, not fatal - it is still a
    // B/L the job needs. An orphan is skipped, because there is nothing to
    // attach it to.
    canApply: true,
  };
}

module.exports = {
  planBls, mapBl, formatAddress, formatLines, escapeHtml, cleanText, toLegacyId,
  OPERATIONS, AIR, JOB_KEY, DEFAULT_RELEASE_STATUS, DEFAULT_HANDOVER_TYPE,
};

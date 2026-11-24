/**
 * Plan a job import - the job records only.
 *
 * SCOPE: this stage imports job rows and nothing else. The old importJobs sent
 * a deeply nested payload and the receiver walked it to create the job plus its
 * B/Ls, containers, stamps and charge lines in one pass, which is why a failure
 * anywhere in that tree was indistinguishable from a failure anywhere else.
 * B/Ls, equipment and charge lines get their own stages. Nothing here writes
 * them, and /seaJob/UploadSEJobs and friends are untouched and still do.
 *
 * All four legacy job tables land in one Odyssey table, SE_Job, separated by
 * `operation`: SE, SI, AE, AI.
 *
 * WHAT THE OLD RECEIVER GOT WRONG
 *
 *   vesselId: vessel.id   No optional chaining, on a value that comes from a
 *                         lookup that can miss. A sea job whose VesselId does
 *                         not resolve throws a TypeError, and because the loop
 *                         wraps the whole request, it takes the other jobs in
 *                         the batch down with it. Batches were 10, so one bad
 *                         vessel silently cost ten jobs.
 *
 *   job.JobNumber.split() Same shape of bug: a job with no JobNumber throws
 *                         rather than being reported as unimportable.
 *
 *   SE_Job.create per job  One INSERT per job inside one transaction per job.
 *                         Correct, but it means the stage's cost is a round
 *                         trip per row.
 *
 *   null foreign keys      A job whose client, commodity or company did not
 *                         resolve is still inserted, and a row count cannot
 *                         see the difference. That is what `unresolved` below
 *                         is for.
 *
 * WHAT IS NOT A BUG: a null salesRepresentatorId is normal - TAP_Employee
 * holds roles ("BOSS", "MANAGEMENT") as well as people, so not every job's
 * sales rep is a person in Odyssey. It is counted, not flagged.
 *
 * No database access here - pure, so it can be unit-tested.
 */

const { legacyTimestamp } = require('./legacyTime');
const OPERATIONS = ['SE', 'SI', 'AE', 'AI'];
const AIR = new Set(['AE', 'AI']);

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
 * The trailing number of a job number: "SEA-123/45" -> "123".
 *
 * The old receiver did this inline and unguarded, so a job with no number
 * threw instead of being reported.
 */
function jobIdFrom(jobNumber) {
  const s = cleanText(jobNumber);
  if (!s) return null;
  const head = s.split('/')[0];
  const tail = head.split('-').pop();
  return cleanText(tail);
}

const lookup = (map, key) => {
  if (!map || key === null || key === undefined || key === '') return null;
  const hit = map.get(String(key));
  return hit === undefined ? null : hit;
};

/**
 * Map one legacy job row onto SE_Job columns.
 *
 * @param {object} row        the legacy job
 * @param {string} operation  SE | SI | AE | AI
 * @param {object} r          resolvers, all Maps of legacy id -> Odyssey id
 */
function mapJob(row, operation, r = {}) {
  const isAir = AIR.has(operation);

  const vesselId = isAir ? null : lookup(r.vessels, row.VesselId);
  // Voyages are keyed by the Odyssey vessel id plus the voyage number, because
  // the legacy voyage number is only unique within a vessel.
  const voyageId = vesselId && cleanText(row.VoyageNo)
    ? lookup(r.voyages, `${vesselId}|${cleanText(row.VoyageNo)}`)
    : null;

  // Resolved on the client, where the legacy lookup tables already are. They
  // total 8.9 MB, so attaching them to all 29 batches meant re-sending 259 MB
  // of identical data - enough to time a batch out, and a timed-out batch is
  // indistinguishable from a job type that never imported.
  // See Odyssey-Front-end/functions/migration/jobShape.js.
  const res = row._resolved || {};

  return {
    jobNo: cleanText(row.JobNumber),
    jobId: jobIdFrom(row.JobNumber),
    customerRef: row.CustomerRefNo,
    fileNo: row.FileNumber,
    shipStatus: row.ShipmentStatusId == 1 ? 'Shipped' : 'Booked',
    teu: row.TEUS,
    bkg: row.BookingWeight,
    pcs: row.NoOfPackages,
    vol: row.Volume,
    volWeight: row.Weight,

    // Sea jobs carry codes directly; air jobs carry ids into the airport and
    // location tables.
    pol: isAir
      ? (res.polAirport || row.PortOfLoadingCode || '')
      : row.PortOfLoadingCode,
    pod: isAir
      ? (res.podAirport || row.PortOfDischargeCode || '')
      : row.PortOfDischargeCode,
    fd: isAir ? res.fdName : row.PortOfFinalDestCode,
    freightPaybleAt: isAir ? res.freightPayableAtName : row.FreightPayableAtCode,

    dg: row.DGNonDGId == 1 ? 'DG' : 'non-DG',
    subType: row.SubTypeId == 3 ? 'FCL' : 'LCL',
    billVol: '',
    shpVol: row.Volume,
    weight: row.ActualWeight ?? row.Weight,
    weightUnit: row.WTUnitId,
    costCenter: res.costCentre ?? null,
    jobType: row.JobTypeId == 1 ? 'Direct' : row.JobTypeId == 2 ? 'Coloaded' : 'Cross Trade',
    jobKind: row.JobKindId == 1 ? 'Current' : 'Opening',
    container: '',
    // Verified against the legacy software on four jobs across sea and air
    // export: FreightTypeId 1 is Prepaid, 2 is Collect. The legacy schema has
    // no lookup table for this - the ids are only meaningful through the app -
    // so the mapping is recorded here rather than resolved at runtime.
    //
    // It has to be the LABEL, not the id: Booking Info's select offers
    // 'Prepaid'/'Collect', and BookingInfo.js also keys the Freight Payable At
    // auto-fill off `freightType == "Prepaid"`.
    freightType: row.FreightTypeId == 1 ? 'Prepaid'
      : row.FreightTypeId == 2 ? 'Collect'
      : null,
    // Was a literal `1`, which is not one of the three options the Booking
    // Info select offers ('Free Hand', 'Nominated', 'B2B'), so the field
    // rendered as a bare number on every migrated job.
    //
    // 'Free Hand' is not a fallback picked for want of anything better: the
    // operations department confirmed that the jobs carrying legacy id 1 are
    // Free Hand. Worth recording, because the legacy database cannot show it -
    // no base table in CSUL_CLINK_PAK has a nomination column and
    // NominationName is blank on every row of the report views that expose
    // one. This line is the only record of that decision.
    nomination: 'Free Hand',
    // Ticked means "this job HAS a transporter / clearing agent" - the same
    // lookups that set transporterId and customAgentId below. The Booking Info
    // checkbox enables its dropdown, and CreateOrEdit.js keeps the id on save
    // ONLY while the box is ticked.
    //
    // These were inverted (ticked when there was NO party), on the theory that
    // they marked desks with work outstanding - which nothing in the app reads
    // them as. The result was worse than cosmetic: every job with a real
    // transporter or agent showed its box unticked, so the next save of that
    // job silently nulled the id.
    transportCheck: lookup(r.clients, row.TransporterId) ? 'Transport' : '',
    customCheck: lookup(r.clients, row.CustomClearanceId) ? 'Custom Clearance' : '',
    etd: row.PlannedETD,
    eta: row.PlannedETA,
    aesDate: row.AESDateTime,
    eRcDate: row.ERecDateTime,
    eRlDate: row.ERLSDateTime,
    jobDate: row.JobDate,
    shipDate: row.SailingDate,
    doorMove: row.DoorMoveOnDate,
    cutOffDate: row.CutOffDateTime,
    siCutOoffDate: row.SICUTOFFDateTime,
    vgmCutOffDate: row.VGMCUTOFFDateTime,
    terminal: res.terminal ?? null,
    delivery: row.DeliveryTypeId,
    companyId: lookup(r.companies, row.SubCompanyId),
    pkgUnit: row.WTUnitId,
    incoTerms: res.incoTerms ?? null,
    exRate: row.ExRateBuying,
    approved: row.ApprovedStatusId == 2 ? 'true' : 'false',
    canceled: false,
    operation,

    // Air-specific; empty on sea jobs rather than absent, so every row in a
    // bulkCreate has the same shape.
    cwtLine: isAir ? (row.ChargeableWeightLine ?? '') : '',
    cwtClient: isAir ? (row.ChargeableWeightClient ?? '0') : '0',
    flightNo: isAir ? row.FlightNo : null,
    arrivalDate: isAir ? (row.ArrivalDate ?? '') : '',
    arrivalTime: isAir ? (row.ArrivalTime ?? '') : '',
    departureDate: isAir ? (row.DepartureDate ?? '') : '',
    departureTime: isAir ? (row.DepartureTime ?? '') : '',

    // Climax entry times are Pakistan wall clock - see functions/legacyTime.
    createdAt: legacyTimestamp(row.AddOn),
    updatedAt: legacyTimestamp(row.EditOn ? row.EditOn : row.AddOn),

    ClientId: lookup(r.clients, row.ClientId),
    overseasAgentId: lookup(r.clients, row.OverseasAgentId),
    shippingLineId: lookup(r.clients, row.ShippingLineId),
    localVendorId: lookup(r.clients, row.LocalAgentId),
    customAgentId: lookup(r.clients, row.CustomClearanceId),
    transporterId: lookup(r.clients, row.TransporterId),
    consigneeId: lookup(r.clients, row.ConsigneeId),
    forwarderId: lookup(r.clients, row.ForwarderId),
    shipperId: lookup(r.clients, row.ShipperId),
    commodityId: lookup(r.commodities, row.CommodityId),
    salesRepresentatorId: lookup(r.employees, row.SalesRepId),
    createdById: r.createdById ?? null,

    // Sea only. `vessel.id` here without the guard is what took ten jobs down
    // with it whenever a vessel did not resolve.
    vesselId,
    VoyageId: voyageId,
    airLineId: isAir ? lookup(r.clients, row.AirLineId) : null,

    climaxId: toLegacyId(row.Id),
  };
}

/**
 * @param {Array}  legacyRows
 * @param {string} operation           SE | SI | AE | AI
 * @param {object} ctx
 * @param {Iterable} ctx.existingClimaxIds  jobs already imported
 * @param {object}   ctx.resolvers          the Maps mapJob needs
 */
function planJobs(legacyRows, operation, ctx = {}) {
  if (!OPERATIONS.includes(operation)) {
    throw new Error(
      `Unknown job operation "${operation}". Expected one of: ${OPERATIONS.join(', ')}.`,
    );
  }

  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const imported = new Set([...(ctx.existingClimaxIds || [])].map(String));
  const resolvers = ctx.resolvers || {};

  const problems = {
    missingId: 0,
    missingJobNo: [],
    duplicateClimaxIds: [],
  };

  // A null foreign key is invisible to a row count: the job exists, opens, and
  // shows a blank where its client should be. Counted per relationship so the
  // report can say which lookup table is short rather than just "some links
  // failed".
  const unresolved = {
    client: 0, company: 0, commodity: 0, vessel: 0, voyage: 0, salesRep: 0,
    overseasAgent: 0, shippingLine: 0, consignee: 0, shipper: 0, airLine: 0,
  };

  const seenIds = new Set();
  const toCreate = [];
  let skipped = 0;

  for (const row of rows) {
    if (!row || toLegacyId(row.Id) === null) { problems.missingId += 1; continue; }

    const id = toLegacyId(row.Id);
    const key = String(id);

    if (seenIds.has(key)) { problems.duplicateClimaxIds.push(id); continue; }
    seenIds.add(key);

    if (imported.has(key)) { skipped += 1; continue; }

    const mapped = mapJob(row, operation, resolvers);

    // jobNo is how every screen and every search finds a job. A job without
    // one is not usable, so it is reported rather than imported blank.
    if (!mapped.jobNo) { problems.missingJobNo.push(id); continue; }

    if (row.ClientId && !mapped.ClientId) unresolved.client += 1;
    if (row.SubCompanyId && !mapped.companyId) unresolved.company += 1;
    if (row.CommodityId && !mapped.commodityId) unresolved.commodity += 1;
    if (row.SalesRepId && !mapped.salesRepresentatorId) unresolved.salesRep += 1;
    if (row.OverseasAgentId && !mapped.overseasAgentId) unresolved.overseasAgent += 1;
    if (row.ShippingLineId && !mapped.shippingLineId) unresolved.shippingLine += 1;
    if (row.ConsigneeId && !mapped.consigneeId) unresolved.consignee += 1;
    if (row.ShipperId && !mapped.shipperId) unresolved.shipper += 1;
    if (!AIR.has(operation)) {
      if (row.VesselId && !mapped.vesselId) unresolved.vessel += 1;
      if (row.VoyageNo && !mapped.VoyageId) unresolved.voyage += 1;
    } else if (row.AirLineId && !mapped.airLineId) {
      unresolved.airLine += 1;
    }

    toCreate.push(mapped);
  }

  return {
    toCreate,
    problems,
    unresolved,
    stats: {
      operation,
      source: rows.length,
      toCreate: toCreate.length,
      alreadyImported: skipped,
      missingJobNo: problems.missingJobNo.length,
      // The one that matters most: a job with no company is invisible on every
      // screen, because every job list is scoped by company.
      withoutCompany: unresolved.company,
      withoutClient: unresolved.client,
    },
    // An unresolved link is reported, not fatal. Refusing every job because a
    // few hundred have no sales rep would be the worse failure - but a job
    // with no company is close to useless, which is why it is called out.
    canApply: true,
  };
}

module.exports = {
  planJobs, mapJob, jobIdFrom, cleanText, toLegacyId, OPERATIONS, AIR,
};

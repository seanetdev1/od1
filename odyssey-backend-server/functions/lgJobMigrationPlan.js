/**
 * Legacy LOG jobs -> Customs_Job + Customs_Duty.
 *
 * WHAT CHANGED, AND WHY IT HAD TO
 *
 * The old importLGJobs mapped a clearing job into SE_Job and forced its
 * `operation` to SE/SI/AE/AI - a declaration wearing a freight job's clothes.
 * That was survivable while customs mode was a relabelling of the freight
 * screens. It is not any more: customs mode replaces those sections with
 * Customs Job, so a LOG job imported into SE_Job now lands in screens the
 * installation does not have. It would be invisible.
 *
 * It also dropped every field that makes a clearance file a clearance file -
 * the GD number, the IGM, the assessed value, the Form-E, and all of the duty -
 * because SE_Job has nowhere to put them.
 *
 * WHAT IS MAPPED
 *
 *   Log_Job              -> Customs_Job     (one declaration)
 *   Log_DutyCalculation  -> Customs_Duty[]  (one row per item, RATES not amounts)
 *
 * Pure functions, no database: the mapping is the part worth checking, and
 * standing up Sequelize to do it would mean it never got checked. The route
 * supplies the resolvers and does the writing.
 */

// The terminal vocabulary the GD screen offers. Required here so a migrated
// job carries a spelling the picker actually has - the legacy database writes
// FAST TRACK, BAYWEST and SUPREME OFF DOCK where the list says Fast Track, Bay
// West and Supreme Off Dock, which is 2,158 jobs' worth of difference.
const { canonicalTerminal } = require('./customsVocabulary');

const cleanText = (value) => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
};

const toLegacyId = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * A legacy date -> the 'YYYY-MM-DD' string every date field in Odyssey holds.
 *
 * SQL Server hands these back as Date objects through Sequelize, and the rest
 * of the app stores dates as plain strings. Returning the Date would put an
 * ISO timestamp with a timezone into a column every screen renders with
 * moment(v, 'YYYY-MM-DD', true) - which is strict, fails, and shows blank.
 */
const toDateString = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return cleanText(value);
  return d.toISOString().slice(0, 10);
};

/**
 * Look a legacy id up in a resolver map, tolerating string/number drift.
 *
 * A string result is trimmed: several of these lookups come from fixed-width
 * CHAR columns, so Gen_DeliveryType hands back "DR / CY        " and that
 * padding would be stored and then rendered on the form. Numbers - the party
 * and commodity lookups resolve to Odyssey ids - are returned untouched.
 */
const lookup = (map, key) => {
  if (!map || key === null || key === undefined || key === '') return null;
  const value = map.get(String(key)) ?? map.get(Number(key)) ?? null;
  return typeof value === 'string' ? cleanText(value) : value;
};

// --- the legacy vocabularies ------------------------------------------------
//
// Climax stores these as integer ids with no lookup table shipped alongside, so
// the mapping is stated here rather than joined. Anything unrecognised falls
// back to the safe default and is COUNTED, so an id nobody anticipated shows up
// in the report instead of silently becoming an import.

/** Log_Job.ImportExportId -> Customs_Job.direction. */
const DIRECTION_BY_ID = { 1: 'Import', 2: 'Export' };

/**
 * Log_Job.ModeId -> Customs_Job.transportMode.
 *
 * 'By Road' rather than 'Land' - the customer's word, and it has to match
 * TRANSPORT_MODES in routes/customsJobs or a migrated job fails validation the
 * first time somebody opens and saves it.
 *
 * No row in CargoLinkers' book uses mode 3, so this rename moves no data. Mode
 * 4 does appear, on 138 jobs, and is NOT mapped here - see unknownCodes.mode,
 * which reports it rather than guessing that it means road.
 */
const MODE_BY_ID = { 1: 'Sea', 2: 'Air', 3: 'By Road' };

/**
 * NO CARGO-TYPE RENAME. Deliberately.
 *
 * "General Cargo" is what the customer now calls "Part", and the migration
 * briefly translated it - but the decision is to leave HISTORY saying what it
 * said. Legacy files keep General Cargo; Part is the word for new jobs. So
 * both values are offered by the screen (see CARGO_TYPES_SEA in
 * functions/customsVocabulary.js) and the migration changes neither.
 *
 * Worth knowing where the value actually is: CargoTypeId - the screen's
 * Shipment Type - never says General Cargo on this customer. It holds FCL,
 * LCL and Empty. All 7,624 General Cargo rows are on ContianerTypeId, which
 * maps to `containerType`, and that field has no place on the current form.
 */

/**
 * Currency codes the legacy master spells wrongly.
 *
 * GL_Currencies has 'GPB' - a transposition of GBP, and not a currency code at
 * all - on the 128 jobs that use it. Corrected here rather than carried,
 * because the GD screen offers the ISO codes: an uncorrected 'GPB' would sit
 * outside that list on every one of those jobs, forever.
 *
 * Only outright misspellings belong here. A code this map does not know is
 * passed through untouched.
 */
const CURRENCY_RENAMES = { GPB: 'GBP' };

const renameCurrency = (value) => {
  const v = cleanText(value);
  if (!v) return null;
  return CURRENCY_RENAMES[v.toUpperCase()] || v;
};

/**
 * What service this file was for: Clearing, Transport, or both.
 *
 * NOT from Log_Job.JobTypeId. That column is the legacy booking taxonomy -
 * Gen_JobType reads Direct / Coloaded / Cross Trade / Liner Agency / ALL - and
 * it is 'Direct' on 15,362 of 15,364 rows. It describes where a freight
 * booking came from and says nothing about whether the agent also moved the
 * goods, so mapping it onto the new three would be a relabelling that means
 * nothing.
 *
 * Inferred from the file instead: a declaration naming a haulier had a
 * transport leg. 6,298 of CargoLinkers' jobs name one.
 *
 * ASSUMPTION, FLAGGED: this decides whether the Transporter field is offered
 * on a migrated job. Confirm it against how the business actually classifies
 * these before the figures are trusted.
 */
const jobTypeOf = (row) => (toLegacyId(row.TransporterId) ? 'Clearing + Transport' : 'Clearing');

/**
 * Log_Job.OperationTypeId, used as a fallback for direction and mode.
 *
 * The old importLGJobs read this field and turned it into SE/AE/AI/SI, which
 * tells us what the four values mean: 1 air import, 2 air export, 4 sea export,
 * anything else sea import. Used only where ImportExportId or ModeId is absent,
 * because those two say it directly.
 */
const OPERATION_TYPE = {
  1: { direction: 'Import', transportMode: 'Air' },
  2: { direction: 'Export', transportMode: 'Air' },
  4: { direction: 'Export', transportMode: 'Sea' },
};
const OPERATION_TYPE_DEFAULT = { direction: 'Import', transportMode: 'Sea' };

/**
 * Documents that only exist on an EXPORT declaration.
 *
 * A Shipping Bill is the export counterpart of a Goods Declaration, and a
 * Form-E is the State Bank export form. Neither has any business on an import
 * file, and the data agrees: across CargoLinkers' jobs whose direction IS
 * known, ShippBillNo is present on 1,652 exports against 2 imports, and
 * FormENumber on 6,281 against 9. Both are 99.9% predictive.
 *
 * Used only where ImportExportId and OperationTypeId are both absent - 2,149
 * jobs, which under the old blanket default all became imports on a customer
 * that is 97% export. Now that direction chooses the ledger account
 * (CUSTOMS_IMPORT vs CUSTOMS_EXPORT), that was 14% of the book posting to the
 * wrong side.
 */
const EXPORT_DOCUMENT_FIELDS = ['ShippBillNo', 'FormENumber'];

/**
 * The cost centre a migrated declaration belongs to.
 *
 * The legacy system stores a cost centre as a LABEL against an id - "HEAD
 * OFFICE", code HO. Odyssey's field is the short code its vouchers and reports
 * carry, which for a Karachi office is KHI. Copying HO across would put a
 * label where a location code belongs, and it is not what anyone there calls
 * that cost centre.
 *
 * So: where the legacy database has exactly ONE cost centre - which is the
 * case for a company running from a single office - that cost centre IS the
 * installation, and the installation's own configured code is the accurate
 * value. Where the legacy system has several, they are real distinctions and
 * the legacy codes are kept as they are.
 *
 * Self-calibrating rather than a rule about CargoLinkers: the next install may
 * genuinely run three.
 */
function resolveCostCenter(row, r = {}) {
  const legacy = lookup(r.costCenters, row.CostCenterId);
  if (!legacy) return null;

  const onlyOne = r.costCenters && typeof r.costCenters.size === 'number'
    && r.costCenters.size === 1;
  if (onlyOne && r.installCostCenter) return r.installCostCenter;

  return legacy;
}

const hasExportDocument = (row) => EXPORT_DOCUMENT_FIELDS.some((f) => cleanText(row[f]));

/**
 * Which way does this declaration go, in order of how much the source knows.
 *
 *   1. ImportExportId    says it outright
 *   2. OperationTypeId   says it outright, in different words
 *   3. an export document is present - see EXPORT_DOCUMENT_FIELDS
 *   4. `unknownDefault`  the dominant direction among the jobs in this run
 *                        that DID resolve, so an install whose traffic runs the
 *                        other way is not stamped with this one's answer
 *
 * Returns the tier as well as the value, so the report can say how many jobs
 * were guessed at rather than read.
 */
function resolveDirection(row, unknownDefault = null) {
  const stated = DIRECTION_BY_ID[toLegacyId(row.ImportExportId)];
  if (stated) return { direction: stated, from: 'stated' };

  const byOperation = OPERATION_TYPE[toLegacyId(row.OperationTypeId)];
  if (byOperation) return { direction: byOperation.direction, from: 'operationType' };

  if (hasExportDocument(row)) return { direction: 'Export', from: 'exportDocument' };

  // Nothing on the file says. Take the run's own majority where one was
  // worked out, and only then the historical default.
  return {
    direction: unknownDefault || OPERATION_TYPE_DEFAULT.direction,
    from: unknownDefault ? 'runMajority' : 'default',
  };
}

/**
 * The dominant direction among rows that state one, for use as the fallback.
 *
 * Derived rather than hardcoded: CargoLinkers is 97% export, but that is a
 * fact about this customer, not about clearing agents. A blanket constant
 * would be right here and wrong for the next install.
 *
 * Returns null unless there is a clear majority to lean on, so a genuinely
 * mixed book falls through to the historical default rather than being tipped
 * by a handful of rows.
 */
function dominantDirection(rows = []) {
  let imports = 0;
  let exports = 0;
  for (const row of rows) {
    if (!row) continue;
    const stated = DIRECTION_BY_ID[toLegacyId(row.ImportExportId)]
      || (OPERATION_TYPE[toLegacyId(row.OperationTypeId)] || {}).direction;
    if (stated === 'Import') imports += 1;
    else if (stated === 'Export') exports += 1;
  }
  const known = imports + exports;
  if (!known) return null;
  const share = Math.max(imports, exports) / known;
  if (share < 0.8) return null;
  return exports > imports ? 'Export' : 'Import';
}

/**
 * Log_Job.SecurityPaidById -> Customs_Job.dutyPaidBy.
 *
 * Deliberately conservative: only an id that positively means the agent paid
 * maps to 'Agent'. Everything else, including an unset field, maps to null
 * rather than guessing - because 'Agent' is what makes duty reimbursable, and
 * inventing it would put a client's own money on their invoice.
 */
const DUTY_PAID_BY_ID = { 1: 'Client', 2: 'Agent' };

/**
 * Log_Job.JobStageId / isClosed -> Customs_Job.status.
 *
 * Only two states are inferable with confidence: a closed job is Complete, a
 * cancelled one is Canceled. Everything else is Incomplete, which is the
 * honest answer for a file whose stage we cannot read.
 *
 * These words have to match STATUSES in routes/customsJobs, which validates
 * against a closed list - a migrated job carrying a status the route does not
 * accept fails the first time somebody opens and saves it.
 */
const statusOf = (row) => {
  if (cleanText(row.JobCancelReason)) return 'Canceled';
  if (row.isClosed === true || row.isClosed === 1) return 'Complete';
  return 'Incomplete';
};

/**
 * The job number's numeric part, for Customs_Job.jobId.
 *
 * The old importLGJobs did `j.JobNumber.split("-")[1].split("/")[0]` with no
 * guard, so a job whose number did not have that exact shape threw a TypeError
 * and took its whole batch down - ten jobs at a time. This returns null
 * instead, and the row is still imported: the sequence number is a convenience,
 * the job number itself is what matters.
 */
const jobIdFrom = (jobNumber) => {
  const s = cleanText(jobNumber);
  if (!s) return null;
  const m = s.match(/-(\d+)\s*\//);
  return m ? Number(m[1]) : null;
};

/**
 * Map one Log_Job row into a Customs_Job.
 *
 * @param row   the legacy job
 * @param r     resolvers (clients, commodities, companies, packing, currency)
 * @param opts  { unknownDefault } the direction to assume when the file says
 *              nothing at all - see dominantDirection(). Omitted in a direct
 *              call, which keeps the historical behaviour.
 */
function mapJob(row, r = {}, opts = {}) {
  const fallback = OPERATION_TYPE[toLegacyId(row.OperationTypeId)] || OPERATION_TYPE_DEFAULT;
  const resolved = resolveDirection(row, opts.unknownDefault);

  return {
    jobNo: cleanText(row.JobNumber),
    jobId: jobIdFrom(row.JobNumber),

    direction: resolved.direction,
    transportMode: MODE_BY_ID[toLegacyId(row.ModeId)] || fallback.transportMode,

    // THE DECLARATION. MachineNo is the WeBOC machine number, which IS the GD
    // number - it is what a clearing agent's customer quotes back.
    gdNumber: cleanText(row.MachineNo),
    gdDate: toDateString(row.IGMDate) || toDateString(row.JobDate),
    // gdType and channel are NOT mapped. Climax records neither, and inventing
    // 'Home Consumption' for every migrated file would be a fact nobody
    // entered, sitting in the column an audit reads first.
    gdType: null,
    channel: null,
    collectorate: null,

    // THE CONSIGNMENT.
    blNo: cleanText(row.HBLNo) || cleanText(row.MBLNo),
    blDate: toDateString(row.HBLDate) || toDateString(row.MBLDate),
    vesselOrFlight: cleanText(row.VoyageOrFlightNo),
    voyageNo: cleanText(row.VoyageOrFlightNo),
    igmNo: cleanText(row.IGMorEGM),
    indexNo: cleanText(row.IndexNo),
    // Codes, not names: Customs_Job stores pol/pod exactly as SE_Job does, so
    // the legacy UN/LOCODE goes straight across and the 108,182-row location
    // table never has to move.
    pol: cleanText(row.POLCode),
    pod: cleanText(row.PODCode),
    // Where the goods are ultimately bound, which is not always the port they
    // are discharged at - an inland destination beyond the POD. Recorded on
    // 7,414 of CargoLinkers' 15,364 jobs and previously had no column to land
    // in, so it was dropped.
    pofd: cleanText(row.POFDCode),

    // WHAT THE LEGACY FILE RECORDS AND THE MODEL DID NOT HOLD.
    //
    // Nine columns that Log_Job populates and Customs_Job had no field for.
    // The module was designed before anyone had read a clearing agent's
    // database; these are what one actually keeps. See models/Customs_Job.js.
    //
    // ClientRefNo first because it is the most-used of them: 75% of jobs, and
    // it is the number the customer quotes when they ring up.
    clientRef: cleanText(row.ClientRefNo),
    jobRef: cleanText(row.JobRefNo),
    customFileNo: cleanText(row.CustomFileNo),
    // Free text, not a location id: DeliveryLocationId is populated on 3 rows
    // out of 15,364, so the address IS the record.
    deliveryLocation: cleanText(row.DeliveryLocationAddress),
    // Resolved to the VALUE, so a migrated job does not carry a legacy id
    // nobody can read. An id the lookup does not know falls to null rather
    // than being stored raw.
    terminal: canonicalTerminal(lookup(r.terminals, row.TerminalId)),
    cargoType: lookup(r.cargoTypes, row.CargoTypeId),
    incoTerms: lookup(r.incoTerms, row.IncoTermsId),
    netWeight: toNumber(row.NetWeight),
    carrierBookingNo: cleanText(row.CarrierBookingNo),

    // WHY a file was cancelled. The free text is more specific than the coded
    // reason ("Duplicate job TP-643/25" against "Job created in error"), so it
    // wins; the decoded id is the fallback. This used to be read only to set
    // the `canceled` boolean and then thrown away.
    cancelReason: cleanText(row.JobCancelReason)
      || lookup(r.cancelReasons, row.JobCancelReasonId),
    approvedOn: toDateString(row.ApprovedStatusOn),
    projectRef: cleanText(row.ProjectRefNo),
    invoiceRemarks: cleanText(row.InvoiceRemarks),
    grt: toNumber(row.GRT),
    nrt: toNumber(row.NRT),
    costCenter: resolveCostCenter(row, r),

    // The legacy form's own fields, verified against four real jobs and the
    // whole table - see models/Customs_Job.js for the coverage of each.
    mblNo: cleanText(row.MBLNo),
    mblDate: toDateString(row.MBLDate),
    // Already read to infer direction; now kept as the document number it is.
    shippingBillNo: cleanText(row.ShippBillNo),
    shippingBillDate: toDateString(row.ShippBillDate),
    gpDate: toDateString(row.GPDate),
    containerType: lookup(r.containerTypes, row.ContianerTypeId),
    deliveryTerms: lookup(r.deliveryTypes, row.DeliveryDetailId),
    transporterId: lookup(r.clients, row.TransporterId),
    etaDate: toDateString(row.SailingDate),
    arrivalDate: toDateString(row.ArrivalDate),
    deliveryDate: toDateString(row.DeliveryDate) || toDateString(row.GPDate),

    // The date the file was opened. Populated on ALL 15,364 jobs, already in
    // the payload, and read only as a fallback for gdDate - so the form's own
    // "Job Date" picker was blank on every migrated declaration.
    jobDate: toDateString(row.JobDate),
    // Clearing / Transport / Clearing + Transport - see jobTypeOf.
    jobType: jobTypeOf(row),
    // The carrier. Only 271 jobs name one, but they all resolve, and the field
    // otherwise sits empty on a form that asks for it.
    shippingLineId: lookup(r.clients, row.ShippingLineId),

    packages: toNumber(row.NoOfPackages),
    pkgUnit: lookup(r.packing, row.PackagesCode),
    grossWeight: toNumber(row.GrossWeight),
    containers: cleanText(row.ContainerString),

    // COMMERCIAL DOCUMENTS.
    invoiceNo: cleanText(row.CInvNumber),
    invoiceDate: null,
    invoiceValue: toNumber(row.CommInvValue),
    invoiceCurrency: renameCurrency(lookup(r.currency, row.CurrencyId)),
    lcNo: cleanText(row.LCNumber),
    // Form-E is the export instrument; on an import file the same column
    // carries the contract reference. Either way it is quoted, never computed.
    formENo: cleanText(row.FormENumber),

    // The file's headline customs value. The per-item assessed values arrive
    // on the duty lines and are allowed to disagree with this.
    assessedValue: toNumber(row.AssessedValue),

    // DUTY PAYMENT. CashNumber/CashDate are the instrument the duty was paid
    // against - the legacy equivalent of a PSID.
    psid: cleanText(row.CashNumber),
    dutyPaidDate: toDateString(row.CashDate),
    dutyPaidBy: DUTY_PAID_BY_ID[toLegacyId(row.SecurityPaidById)] || null,

    // PARTIES. CustomerId is who the file is being cleared for.
    clientId: lookup(r.clients, row.CustomerId),
    shipperId: lookup(r.clients, row.ShipperId),
    consigneeId: lookup(r.clients, row.ConsigneeId),
    CommodityId: lookup(r.commodities, row.CommodityId),

    status: statusOf(row),
    // The goods get their own column now. Folding them into `remarks` as a
    // fallback meant that on any job carrying BOTH, the description lost and
    // was dropped - 511 of CargoLinkers' jobs. And where it did survive, the
    // goods ended up in a notes field nothing searches by.
    //
    // This is the only record of what was declared on that install: no
    // clearing job there names a commodity, because every table referencing
    // Gen_Commodity is empty.
    goodsDescription: cleanText(row.GoodsDescription),
    remarks: cleanText(row.Remarks),

    companyId: lookup(r.companies, row.SubCompanyId),
    exRate: '1',
    approved: toLegacyId(row.ApprovedStatusId) === 2 ? '1' : '0',
    canceled: Boolean(cleanText(row.JobCancelReason)),

    climaxId: toLegacyId(row.Id),
  };
}

/**
 * The rate and amount columns, legacy name -> ours.
 *
 * Stated once here and used by mapDuty below. The arithmetic that turns these
 * into money is in functions/customsDuty.js and reads OUR names, so a mapping
 * mistake here is a wrong figure everywhere - which is why the two lists are
 * checked against RATE_HEADS/AMOUNT_HEADS in the tests.
 */
const DUTY_RATE_MAP = {
  CDPerc: 'customDutyPerc',
  AdditionalCDPerc: 'additionalCustomDutyPerc',
  RDPerc: 'regulatoryDutyPerc',
  ExcisePerc: 'excisePerc',
  FEDPerc: 'federalExcisePerc',
  SalesTaxPerc: 'salesTaxPerc',
  AdditionalSTaxPerc: 'additionalSalesTaxPerc',
  SITaxPerc: 'salesTaxOnServicesPerc',
  IncomeTaxPerc: 'incomeTaxPerc',
  WHSurchargePerc: 'whSurchargePerc',
};

const DUTY_AMOUNT_MAP = {
  DO: 'deliveryOrder',
  DOLOLOCharges: 'doLoloCharges',
  DOInsurance: 'doInsurance',
  DOEndorsmentCharges: 'doEndorsementCharges',
  DOTHC: 'doThc',
  DOBankCharges: 'doBankCharges',
  DOBLSpliting: 'doBlSplitting',
  DOAgencyCharges: 'doAgencyCharges',
  DOLCLCharges: 'doLclCharges',
  ETO: 'eto',
  OtherSecurity: 'otherSecurity',
  OtherWharfage: 'otherWharfage',
  StampDuty: 'stampDuty',
  Fine: 'fine',
  FineSection82: 'fineSection82',
  FineInvoiceNotFound: 'fineInvoiceNotFound',
  Detention: 'detention',
  Demurrage: 'demurrage',
};

const DUTY_VALUE_MAP = {
  ASSValue: 'assessedValue',
  FOBValue: 'fobValue',
  CNFValue: 'cnfValue',
  Freight: 'freight',
  InsuranceValue: 'insuranceValue',
  ExchangeRate: 'exchangeRate',
  LandingInsPerc: 'landingInsPerc',
  TotalFOB: 'totalFob',
  TotalCNF: 'totalCnf',
  TotalFreight: 'totalFreight',
  TotalInsurance: 'totalInsurance',
};

/** Map one Log_DutyCalculation row into a Customs_Duty line. */
function mapDuty(row, i, r = {}) {
  const out = {
    sortOrder: i,
    itemNo: cleanText(row.ItemNo),
    modelNo: cleanText(row.ModelNo),
    quantity: toNumber(row.Quantity),
    sroNumber: cleanText(row.SRONumber),
    originCode: cleanText(row.PortOfOriginCode),
    CommodityId: lookup(r.commodities, row.CommodityId),
    isFreight: row.IsFreight === null || row.IsFreight === undefined ? null : Boolean(row.IsFreight),
    isProvision: row.IsProvision === null || row.IsProvision === undefined ? null : Boolean(row.IsProvision),
    exciseRemarks: cleanText(row.ExciseRemarks),
    stampDutyRemarks: cleanText(row.StampDutyRemarks),
    fineRemarks: cleanText(row.FineRemarks),
    loloRemarks: cleanText(row.LOLORemarks),
    climaxId: toLegacyId(row.Id),
  };
  for (const [from, to] of Object.entries(DUTY_VALUE_MAP)) out[to] = toNumber(row[from]);
  for (const [from, to] of Object.entries(DUTY_RATE_MAP)) out[to] = toNumber(row[from]);
  for (const [from, to] of Object.entries(DUTY_AMOUNT_MAP)) out[to] = toNumber(row[from]);
  return out;
}

/**
 * Plan an import: what would be created, and everything that would not resolve.
 *
 * Writes nothing. `ctx.existingClimaxIds` is what is already imported, so a
 * re-run is a no-op rather than a second copy.
 */
function planLgJobs(legacyRows, dutyRows, ctx = {}) {
  // Container rows for this batch, keyed on the legacy job id - same shape as
  // the duty rows above.
  const containerRows = Array.isArray(ctx.containers) ? ctx.containers : [];
  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const imported = new Set([...(ctx.existingClimaxIds || [])].map(String));
  const r = ctx.resolvers || {};

  // Duty lines, grouped by the job they belong to. Grouped once rather than
  // filtered per job: a real database has one duty row per item across tens of
  // thousands of jobs, and filtering inside the loop is quadratic.
  const dutyByJob = new Map();
  for (const d of Array.isArray(dutyRows) ? dutyRows : []) {
    const jobId = toLegacyId(d?.LogJobId);
    if (jobId === null) continue;
    const key = String(jobId);
    if (!dutyByJob.has(key)) dutyByJob.set(key, []);
    dutyByJob.get(key).push(d);
  }

  const problems = { missingId: 0, missingJobNo: [], duplicateClimaxIds: [] };

  // A null foreign key is invisible to a row count: the job exists, opens, and
  // shows a blank where its client should be. Counted per relationship so the
  // report can say which lookup is short rather than "some links failed".
  const unresolved = { client: 0, company: 0, commodity: 0, shipper: 0, consignee: 0 };

  // Legacy ids the vocabularies above did not recognise. An id nobody
  // anticipated must show up here rather than quietly becoming the default.
  const unknownCodes = { direction: new Set(), mode: new Set(), dutyPaidBy: new Set() };

  // Where each job's direction came from. A job whose file states it outright
  // is a fact; one resolved from an export document is a strong inference; one
  // taking the run's majority is a guess, and the operator should be told how
  // many of those there are before the ledger posts them.
  const directionSource = { stated: 0, operationType: 0, exportDocument: 0, runMajority: 0, default: 0 };

  // Worked out once for the whole batch, from the jobs that DO state a
  // direction, and used only for the ones that say nothing at all.
  const unknownDefault = dominantDirection(rows);

  const seenIds = new Set();
  const toCreate = [];
  let skipped = 0;
  let dutyLineCount = 0;
  let containerCount = 0;
  let withoutDuty = 0;

  for (const row of rows) {
    if (!row || toLegacyId(row.Id) === null) { problems.missingId += 1; continue; }

    const id = toLegacyId(row.Id);
    const key = String(id);

    if (seenIds.has(key)) { problems.duplicateClimaxIds.push(id); continue; }
    seenIds.add(key);

    if (imported.has(key)) { skipped += 1; continue; }

    const mapped = mapJob(row, r, { unknownDefault });
    directionSource[resolveDirection(row, unknownDefault).from] += 1;

    // jobNo is how every screen and every search finds a job. A job without one
    // is not usable, so it is reported rather than imported blank.
    if (!mapped.jobNo) { problems.missingJobNo.push(id); continue; }

    if (row.CustomerId && !mapped.clientId) unresolved.client += 1;
    if (row.SubCompanyId && !mapped.companyId) unresolved.company += 1;
    if (row.CommodityId && !mapped.CommodityId) unresolved.commodity += 1;
    if (row.ShipperId && !mapped.shipperId) unresolved.shipper += 1;
    if (row.ConsigneeId && !mapped.consigneeId) unresolved.consignee += 1;

    const dir = toLegacyId(row.ImportExportId);
    if (dir !== null && !DIRECTION_BY_ID[dir]) unknownCodes.direction.add(dir);
    const mode = toLegacyId(row.ModeId);
    if (mode !== null && !MODE_BY_ID[mode]) unknownCodes.mode.add(mode);
    const paid = toLegacyId(row.SecurityPaidById);
    if (paid !== null && !DUTY_PAID_BY_ID[paid]) unknownCodes.dutyPaidBy.add(paid);

    const duty = (dutyByJob.get(key) || []).map((d, i) => mapDuty(d, i, r));
    if (!duty.length) withoutDuty += 1;
    dutyLineCount += duty.length;

    // The containers on this declaration, same shape as the duty lines: the
    // batch carries only its own, keyed on the legacy job id.
    const containers = containerRows
      .filter((c) => c && String(c.LogJobId) === String(id))
      .map((c, i) => mapContainer(c, i))
      .filter((c) => c.containerNo);
    containerCount += containers.length;

    toCreate.push({ job: mapped, duty, containers });
  }

  return {
    toCreate,
    problems,
    unresolved,
    unknownCodes: {
      direction: [...unknownCodes.direction],
      mode: [...unknownCodes.mode],
      dutyPaidBy: [...unknownCodes.dutyPaidBy],
    },
    // How the direction on each job was arrived at, and what the run leaned on
    // for the ones that said nothing. Reported because direction now chooses
    // the ledger account a customs invoice posts to.
    directionSource,
    unknownDirectionDefault: unknownDefault,
    stats: {
      source: rows.length,
      toCreate: toCreate.length,
      alreadyImported: skipped,
      missingJobNo: problems.missingJobNo.length,
      dutyLines: dutyLineCount,
      containers: containerCount,
      // Not an error: a file whose GD has not been assessed yet genuinely has
      // no duty. Reported so "the duty did not come across" and "there was
      // none" can be told apart.
      withoutDuty,
      // A job with no company is invisible on every screen, because every job
      // list is scoped by company.
      withoutCompany: unresolved.company,
      withoutClient: unresolved.client,
    },
    // An unresolved link is reported, not fatal. Refusing every job because a
    // few hundred have no commodity would be the worse failure.
    canApply: true,
  };
}

/**
 * Map one Log_Job_Container row into a Customs_Container.
 *
 * The legacy table has 26 columns and exactly TWO are populated across all
 * 6,164 rows: ContainerNo and EquipCode. Weights appear on 241, CBM on 3,
 * packages on 5; seal numbers, temperature, load type and the DG flag on none.
 * So only what is there is carried, and a zero weight is stored as null rather
 * than as a measurement nobody took.
 */
function mapContainer(row, index = 0) {
  return {
    containerNo: cleanText(row.ContainerNo),
    sizeType: cleanText(row.EquipCode),
    grossWeight: toNumber(row.GrossWt) || null,
    netWeight: toNumber(row.NetWt) || null,
    packages: toNumber(row.NoOfPackages) || null,
    remarks: cleanText(row.Remarks),
    // Legacy Sno is set on 7 rows of 6,164, so position in the batch is the
    // only ordering available.
    sortOrder: toLegacyId(row.Sno) ?? index,
    climaxId: toLegacyId(row.Id),
  };
}

module.exports = {
  planLgJobs, mapJob, mapDuty, mapContainer, jobIdFrom, statusOf,
  resolveDirection, dominantDirection, hasExportDocument, resolveCostCenter,
  renameCurrency, jobTypeOf,
  cleanText, toLegacyId, toNumber, toDateString,
  DIRECTION_BY_ID, MODE_BY_ID, DUTY_PAID_BY_ID, OPERATION_TYPE, EXPORT_DOCUMENT_FIELDS,
  CURRENCY_RENAMES,
  DUTY_RATE_MAP, DUTY_AMOUNT_MAP, DUTY_VALUE_MAP,
};

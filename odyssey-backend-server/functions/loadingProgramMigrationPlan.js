/**
 * Plan a loading-program import.
 *
 * NEVER MIGRATED. Nothing in any receiver creates a Loading_Program, so every
 * migrated sea export job has an empty one. This is not a rewrite of a broken
 * stage - it is data that has simply never come across.
 *
 * Sea export only: SExp_LoadingProgram is the only such table in the legacy
 * schema. One row per job (hasOne in Odyssey), so idempotency is job-scoped -
 * a job that already has a loading program is skipped. Loading_Program has no
 * climaxId column and does not need one for that.
 *
 * DECODING RATHER THAN GUESSING
 *
 * Eight columns are ids rather than values, and checking them against the real
 * export splits them three ways:
 *
 *   DECODED, cleanly
 *     LocalCustomId  -> Gen_LocalCustom.LocalCustomName   255/255 resolve
 *     WharfId        -> Gen_Wharf.WharfName               255/255 resolve
 *
 *   DECODED through Gen_CommonLOV, which is a shared misc table holding
 *   { Yes, No, 99, 999, ... }
 *     AllocAvailableId, ContAvalableId   values are 0 or 1, and 1 -> "Yes"
 *                                        is coherent for an availability flag.
 *                                        0 means unset and stays null.
 *
 *   NOT DECODED, deliberately
 *     LoadingFlagId  Its value is 7, which Gen_CommonLOV maps to "999999" -
 *                    not a flag name. That table is plainly not its lookup, so
 *                    decoding it would put "999999" on screen as a label for
 *                    224 of the 255 programs. Left null and counted.
 *     StatusId       0 on every row - never set in the source.
 *     ContainerWTId  0 on every row - never set in the source.
 *     ContainerPickUpLocationId
 *                    null on every row. The mapping is kept, since it is the
 *                    correct lookup if the column is ever populated, but it
 *                    produces nothing today.
 *
 * Anything that does not resolve is left null and counted, never written as a
 * raw id into a field that displays as a label.
 *
 * WHAT IS DELIBERATELY NOT MAPPED
 *
 *   loadingTerms   The legacy column that looks like a match, IsLoadingTerms,
 *                  is a flag - it says whether loading terms apply, not what
 *                  they are. Odyssey's loadingTerms is a long-text field that
 *                  prints. Writing "true" into it would be worse than leaving
 *                  it empty, so it is left null and reported. The same
 *                  distinction applies to IsSpecialInstrucion (a flag) versus
 *                  SpecialInstruction (the text), and it is the text that is
 *                  mapped.
 *
 * No database access here - pure, so it can be unit-tested.
 */

const OPERATIONS = ['SE'];

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

/** Look a value up, returning null rather than the raw id when it misses. */
function decode(map, id) {
  if (!map || id === null || id === undefined || id === '') return null;
  const hit = map.get(String(id));
  return hit === undefined ? null : cleanText(hit);
}

/**
 * Map one legacy loading program onto Loading_Program columns.
 *
 * @param {object} row
 * @param {object} ctx
 * @param {Map} ctx.localCustoms   Id -> LocalCustomName
 * @param {Map} ctx.wharfs         Id -> WharfName
 * @param {Map} ctx.lov            Id -> LOVText
 * @param {Map} ctx.locations      Id -> LocationName
 * @param {*}   ctx.jobId          the Odyssey SE_Job id
 */
function mapLoadingProgram(row, ctx = {}) {
  const { localCustoms, wharfs, lov, locations } = ctx;

  return {
    // Decoded lookups - null when the lookup does not explain the id, never
    // the raw id, because these display as labels.
    localCustom: decode(localCustoms, row.LocalCustomId),
    wharf: decode(wharfs, row.WharfId),
    allocAvailable: decode(lov, row.AllocAvailableId),
    contAvailable: decode(lov, row.ContAvalableId),
    // Not decoded - see the header. Gen_CommonLOV is not their lookup, and
    // guessing would put "999999" on screen where a flag name belongs.
    loadingFlag: null,
    status: null,
    containerWt: null,
    containerPickup: decode(locations, row.ContainerPickUpLocationId),

    // Codes and free text, carried straight across.
    loadingTerminal: cleanText(row.OriginTerminalCode),
    dischargeTerminal: cleanText(row.DestinationTerminalCode),
    portOfReciept: cleanText(row.PortOfReceiptCode),
    viaPort: cleanText(row.ViaPortCode) || cleanText(row.ViaPortNameAlias),
    berth: cleanText(row.Berth),
    egm: cleanText(row.EGMNo),
    book: cleanText(row.BookNo),
    gatePass: cleanText(row.GatePassNo),
    letter: cleanText(row.LetterNo),
    cro: cleanText(row.CRONumber),
    containerInfo: cleanText(row.ContainerInformation),
    containerTemp: cleanText(row.ContainerTemprature),
    vent: cleanText(row.Vent),
    containerSplit: cleanText(row.ContainerSplit),
    blRequired: cleanText(row.BLRequired),

    // Dates and times, left in the shape the column stores them.
    loadingDate: row.LoadingDate ?? null,
    loadingTime: row.LoadingTime ?? null,
    arrivalDate: row.ArrivalDate ?? null,
    croIssueDate: row.CROIssueDate ?? null,
    expiryDate: row.ExpiryDate ?? null,
    validityDate: row.ValidityDate ?? null,
    gatePassDate: row.GatePassDate ?? null,
    sobDate: row.SOBDate ?? null,
    etd: row.ETD ?? null,

    // The long-text field that prints. SpecialInstruction is the text;
    // IsSpecialInstrucion is only a flag.
    instruction: row.SpecialInstruction ?? null,
    // Deliberately not mapped - see the header.
    loadingTerms: null,

    SEJobId: ctx.jobId ?? null,
  };
}

/**
 * @param {Array}  legacyRows
 * @param {string} operation           SE (the only one that has these)
 * @param {object} ctx
 * @param {Map} ctx.jobIdByLegacyId    legacy job id -> Odyssey SE_Job id
 * @param {Iterable} ctx.jobsDone      Odyssey job ids that already have one
 */
function planLoadingPrograms(legacyRows, operation, ctx = {}) {
  if (!OPERATIONS.includes(operation)) {
    throw new Error(
      `Loading programs exist only for sea export. Got "${operation}", expected: `
      + `${OPERATIONS.join(', ')}.`,
    );
  }

  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const jobs = ctx.jobIdByLegacyId instanceof Map
    ? ctx.jobIdByLegacyId : new Map(Object.entries(ctx.jobIdByLegacyId || {}));
  const done = new Set([...(ctx.jobsDone || [])].map(String));

  const problems = {
    missingId: 0,
    missingJobRef: 0,
    orphaned: [],
    duplicateJobs: [],
  };

  // Counted per lookup, because "the local-custom table is short" is a
  // different problem from "the LOV ids mean nothing to us".
  const undecoded = {
    localCustom: 0, wharf: 0, allocAvailable: 0, contAvailable: 0, containerPickup: 0,
  };
  // Columns the source sets but no lookup explains. Counted separately so the
  // report distinguishes "the lookup came up short" from "we chose not to
  // guess" - see the header.
  const notDecodable = { loadingFlag: 0, status: 0, containerWt: 0 };

  const seenIds = new Set();
  const seenJobs = new Set();
  const toCreate = [];
  let skippedJobs = 0;

  for (const row of rows) {
    if (!row) { problems.missingJobRef += 1; continue; }
    if (toLegacyId(row.Id) === null) { problems.missingId += 1; continue; }

    const key = String(toLegacyId(row.Id));
    if (seenIds.has(key)) continue;
    seenIds.add(key);

    const legacyJobId = toLegacyId(row.SEJobId);
    if (legacyJobId === null) { problems.missingJobRef += 1; continue; }

    const jobId = jobs.get(String(legacyJobId));
    if (jobId === undefined || jobId === null) {
      problems.orphaned.push(legacyJobId);
      continue;
    }

    if (done.has(String(jobId))) { skippedJobs += 1; continue; }

    // hasOne: a second program for the same job would be unreachable, since
    // the job screen only ever loads one.
    if (seenJobs.has(String(jobId))) { problems.duplicateJobs.push(legacyJobId); continue; }
    seenJobs.add(String(jobId));

    const mapped = mapLoadingProgram(row, { ...ctx, jobId });

    if (row.LocalCustomId && !mapped.localCustom) undecoded.localCustom += 1;
    if (row.WharfId && !mapped.wharf) undecoded.wharf += 1;
    if (row.AllocAvailableId && !mapped.allocAvailable) undecoded.allocAvailable += 1;
    if (row.ContAvalableId && !mapped.contAvailable) undecoded.contAvailable += 1;
    if (toLegacyId(row.LoadingFlagId)) notDecodable.loadingFlag += 1;
    if (toLegacyId(row.StatusId)) notDecodable.status += 1;
    if (toLegacyId(row.ContainerWTId)) notDecodable.containerWt += 1;
    if (row.ContainerPickUpLocationId && !mapped.containerPickup) undecoded.containerPickup += 1;

    toCreate.push(mapped);
  }

  return {
    toCreate,
    problems,
    undecoded,
    notDecodable,
    stats: {
      operation,
      source: rows.length,
      toCreate: toCreate.length,
      skippedJobs,
      orphaned: problems.orphaned.length,
      duplicateJobs: problems.duplicateJobs.length,
      undecodedTotal: Object.values(undecoded).reduce((a, b) => a + b, 0),
      notDecodableTotal: Object.values(notDecodable).reduce((a, b) => a + b, 0),
    },
    // An undecoded lookup leaves one field blank on an otherwise complete
    // loading program - reported, not fatal.
    canApply: true,
  };
}

module.exports = {
  planLoadingPrograms, mapLoadingProgram, decode, cleanText, toLegacyId, OPERATIONS,
};

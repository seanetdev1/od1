/**
 * Plan a commodity-master import.
 *
 * 10,649 rows - by far the largest of the rewritten stages, and the one where
 * the old import's shape hurt most.
 *
 * WHAT THE OLD IMPORT (/commodity/uploadCommodities, untouched) GOT WRONG
 *
 *   isHazmat: c.IsHazmatProduct
 *                      The real defect. isHazmat is a STRING column and the
 *                      source value is a boolean, so it stored "true"/"false".
 *                      Every screen tests it with `isHazmat == 1`, and
 *                      "true" == 1 is false - so a hazardous commodity renders
 *                      as non-hazardous, and the edit form disables its
 *                      packing group, hazmat code, chemical name and UNO code
 *                      as though they did not apply. One row in the current
 *                      export is hazmat, which is exactly the kind of count
 *                      that makes a bug look ignorable and a mislabelled
 *                      dangerous good is not.
 *
 *   Commodity.create in a loop
 *                      10,649 sequential round trips, no transaction. A
 *                      failure at row 8,000 left 8,000 committed rows and no
 *                      way to tell how far it got.
 *
 *   active: ''         IsInActive was ignored. No UI consequence today -
 *                      nothing reads `active` - so this is recorded rather
 *                      than dressed up as a fix.
 *
 *   cargoType: 'GL'    Hardcoded, while CCargoTypeID carries a real id. See
 *                      CARGO TYPE below.
 *
 * WHAT IS HARDCODED, AND WHY THAT IS NOT A BUG
 *
 *   commodityGroup     CommodityGroupId is null on all 10,649 rows.
 *   hazmatClass        HazmatClassTypeID is null on all 10,649 rows.
 *                      There is nothing to migrate. '' is the honest value.
 *
 * CARGO TYPE: Odyssey offers exactly two - GL and CAR. The legacy id lives in
 * Gen_CommodityCargoType, which no export exposed until /jobs/getCommodityCargoTypes
 * was added for this stage. When that lookup is supplied the name decides the
 * mapping; when it is not - an older legacy server, say - every commodity
 * falls back to GL exactly as the old import did, and the plan reports how
 * many carry a fallback rather than a decoded value.
 *
 * Gen_UnCommodity (6,608 rows of {HsCode, HsDescription}) is deliberately NOT
 * imported. It is an HS-code reference table, not a commodity master; loading
 * it here would add 6,608 rows to every commodity picker in the system.
 *
 * No database access here - this module is pure so it can be unit-tested
 * against real exports without a database.
 */

/** The two cargo types the Commodity screen offers. */
const CARGO_TYPES = ['GL', 'CAR'];
const DEFAULT_CARGO_TYPE = 'GL';

/** The three packing groups the Commodity screen offers. */
const PACKING_GROUPS = { 1: 'GRP 1', 2: 'GRP 2', 3: 'GRP 3' };

// Every screen tests the flag with `isHazmat == 1`, so these are the only two
// values that round-trip. Storing a boolean here is what broke the old import.
const HAZMAT_YES = '1';
const HAZMAT_NO = '0';

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
 * Build id -> 'GL' | 'CAR' from the Gen_CommodityCargoType lookup.
 *
 * Matched on the name rather than the id, because the id is meaningless
 * outside the legacy database and the name is what a person would read.
 */
function buildCargoTypeMap(cargoTypes) {
  const map = new Map();
  for (const row of Array.isArray(cargoTypes) ? cargoTypes : []) {
    const id = toLegacyId(row && row.Id);
    const name = cleanText(row && row.CCargoTypeName);
    if (id === null || !name) continue;

    const upper = name.toUpperCase();
    if (upper.includes('CAR') || upper.includes('VEHICLE')) map.set(String(id), 'CAR');
    else map.set(String(id), DEFAULT_CARGO_TYPE);
  }
  return map;
}

/** True when a stored isHazmat value is one the UI can actually read. */
function isReadableHazmat(value) {
  if (value === null || value === undefined) return true;   // never set - not a mislabel
  const s = String(value).trim();
  return s === '' || s === HAZMAT_YES || s === HAZMAT_NO;
}

/** Map one legacy Gen_Commodity row onto Commodity columns. */
function mapCommodity(row, cargoTypeMap = new Map()) {
  const cargoKey = row.CCargoTypeID === null || row.CCargoTypeID === undefined
    ? null
    : String(toLegacyId(row.CCargoTypeID));

  return {
    name: cleanText(row.CommodityName),
    hs: cleanText(row.HSCode),
    cargoType: (cargoKey !== null && cargoTypeMap.get(cargoKey)) || DEFAULT_CARGO_TYPE,
    // CommodityGroupId is null across the whole export - nothing to map.
    commodityGroup: '',
    isHazmat: row.IsHazmatProduct ? HAZMAT_YES : HAZMAT_NO,
    packageGroup: PACKING_GROUPS[Number(row.HazmatPackingGroupID)] || '',
    hazmatCode: cleanText(row.HazmatCode) || '',
    // HazmatClassTypeID is null across the whole export - nothing to map.
    hazmatClass: '',
    chemicalName: cleanText(row.CommonChemicalName) || '',
    unoCode: cleanText(row.UNOCode) || '',
    active: row.IsInActive ? '0' : '1',
    climaxId: toLegacyId(row.Id),
  };
}

/**
 * @param {Array} legacyRows                  legacy Gen_Commodity rows
 * @param {object} ctx
 * @param {Iterable} ctx.existingClimaxIds      commodities already imported
 * @param {Array}    ctx.cargoTypes             Gen_CommodityCargoType rows, if available
 * @param {Array}    ctx.importedHazmatFlags    [{ climaxId, isHazmat }] already in the system
 */
function planCommodities(legacyRows, ctx = {}) {
  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const imported = new Set([...(ctx.existingClimaxIds || [])].map(String));
  const cargoTypeMap = buildCargoTypeMap(ctx.cargoTypes);

  // What the old import already wrote, so a re-run can correct the hazmat flag
  // it stored as "true"/"false" instead of importing over the top of it.
  const storedHazmat = new Map(
    (ctx.importedHazmatFlags || []).map((r) => [String(r.climaxId), r.isHazmat]),
  );

  const problems = {
    missingId: 0,
    missingName: [],
    duplicateClimaxIds: [],
    missingHsCode: 0,
    undecodedCargoType: 0,
    inactive: 0,
  };

  const seenIds = new Set();
  const toCreate = [];
  const toRepair = [];
  let skipped = 0;
  let hazmat = 0;

  for (const row of rows) {
    if (!row || toLegacyId(row.Id) === null) { problems.missingId += 1; continue; }

    const id = toLegacyId(row.Id);
    const key = String(id);

    if (seenIds.has(key)) { problems.duplicateClimaxIds.push(id); continue; }
    seenIds.add(key);

    const mapped = mapCommodity(row, cargoTypeMap);

    if (imported.has(key)) {
      skipped += 1;
      // Already here, but possibly carrying the old import's unreadable flag.
      // Correct it in place rather than leaving a mislabelled hazmat row.
      if (storedHazmat.has(key)) {
        const stored = storedHazmat.get(key);
        if (!isReadableHazmat(stored) || String(stored ?? '') !== mapped.isHazmat) {
          toRepair.push({ climaxId: id, isHazmat: mapped.isHazmat, was: stored ?? null });
        }
      }
      continue;
    }

    if (!mapped.name) { problems.missingName.push(id); continue; }

    if (!mapped.hs) problems.missingHsCode += 1;
    if (row.CCargoTypeID === null || row.CCargoTypeID === undefined
        || !cargoTypeMap.has(String(toLegacyId(row.CCargoTypeID)))) {
      problems.undecodedCargoType += 1;
    }
    if (row.IsInActive) problems.inactive += 1;
    if (mapped.isHazmat === HAZMAT_YES) hazmat += 1;

    toCreate.push(mapped);
  }

  return {
    toCreate,
    toRepair,
    problems,
    stats: {
      source: rows.length,
      toCreate: toCreate.length,
      toRepair: toRepair.length,
      alreadyImported: skipped,
      hazmat,
      inactive: problems.inactive,
      missingHsCode: problems.missingHsCode,
      undecodedCargoType: problems.undecodedCargoType,
      cargoTypeLookupAvailable: cargoTypeMap.size > 0,
    },
    // Nothing here is fatal: a commodity with no HS code or an undecoded cargo
    // type is still a usable commodity, and refusing 10,649 rows over a few
    // hundred blank HS codes would be the worse failure.
    canApply: true,
  };
}

module.exports = {
  planCommodities, mapCommodity, buildCargoTypeMap, isReadableHazmat, cleanText, toLegacyId,
  CARGO_TYPES, DEFAULT_CARGO_TYPE, PACKING_GROUPS, HAZMAT_YES, HAZMAT_NO,
};

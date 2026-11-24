/**
 * Plan a vessel and voyage import.
 *
 * 2,063 vessels and 2,020 voyages - small, and the stage the Jobs stage leans
 * on hardest. A job resolves its voyage by Odyssey vessel id plus voyage
 * number, so anything that makes that pair not match is a job that silently
 * loses its voyage.
 *
 * WHAT THE OLD IMPORT (/vessel/uploadVoyages, untouched) GOT WRONG
 *
 *   no idempotency     Vessel.create and Voyage.create, unconditionally. There
 *                      was no climaxId check of any kind, so running the stage
 *                      twice duplicated all 2,063 vessels and all 2,020
 *                      voyages - and a duplicated vessel splits its voyages
 *                      across two vessel ids, so jobs then resolve against
 *                      whichever one comes back first.
 *
 *   untrimmed VoyageNo 11 voyage numbers carry padding. The Jobs stage looks
 *                      up `${vesselId}|${voyageNo.trim()}`, so a padded number
 *                      stored as-is can never be matched - the job imports with
 *                      a null voyage and nothing says why.
 *
 *   no transaction     One create per row. A failure part way left some
 *                      vessels with their voyages and some without.
 *
 *   pol / pod dropped  Gen_Voyage carries PortOfLoadingCode and
 *                      PortOfDischarge, and both were ignored. Only 27 and 23
 *                      rows have them, but they are the only route information
 *                      a voyage has.
 *
 * WHAT IS HARDCODED, AND WHY THAT IS NOT A BUG
 *
 *   vessel type        Gen_Vessel has no type column at all. "Both" is the
 *                      honest default, not a shortcut.
 *   vessel code        Vessel.code is INTEGER and /vessel/create issues codes
 *                      with max(code)+1, so it must stay numeric and above
 *                      anything assigned by hand. The legacy id satisfies
 *                      both - exactly as with Charges. VesselCode is numeric
 *                      too, but it equals the id on only 1,034 of 2,063 rows,
 *                      so using it would collide with hand-created codes.
 *   carrier            The field is commented out of the Vessel screen. The
 *                      legacy Owner column is the ship's owner, not the
 *                      carrier, so it is not migrated into it.
 *
 * VOYAGE TYPE: TypeId 3 -> Export and 2 -> Import is the old import's mapping
 * and is kept. There is no Gen_VoyageType table in the legacy schema to check
 * it against, and TypeId 1 (350 voyages) falls through to "Both" - counted, so
 * the guess is visible rather than silent.
 *
 * No database access here - pure, so it can be unit-tested.
 */

const VESSEL_TYPES = ['Import', 'Export', 'Both'];
const DEFAULT_VESSEL_TYPE = 'Both';

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

/** TypeId -> the three values the Voyage screen uses. */
function voyageType(typeId) {
  const n = Number(typeId);
  if (n === 3) return 'Export';
  if (n === 2) return 'Import';
  return DEFAULT_VESSEL_TYPE;
}

/** The key the Jobs stage resolves a voyage by. Must match on both sides. */
function voyageKey(vesselId, voyageNo) {
  return `${vesselId}|${cleanText(voyageNo) ?? ''}`;
}

function mapVessel(row) {
  return {
    // INTEGER column, issued by max(code)+1 for hand-created vessels.
    code: toLegacyId(row.Id),
    name: cleanText(row.VesselName),
    // Gen_Vessel has no type column; the Vessel screen requires one.
    type: DEFAULT_VESSEL_TYPE,
    carrier: null,
    pol: null,
    destinations: null,
    climaxId: toLegacyId(row.Id),
  };
}

/**
 * @param {object} row              legacy Gen_Voyage row
 * @param {*}      odysseyVesselId  the Odyssey Vessel.id this voyage belongs to
 */
function mapVoyage(row, odysseyVesselId) {
  return {
    // Trimmed, because this is half the key the Jobs stage matches on.
    voyage: cleanText(row.VoyageNo),
    pol: cleanText(row.PortOfLoadingCode),
    pod: cleanText(row.PortOfDischarge),
    importOriginSailDate: row.OriginSailingDate,
    importArrivalDate: row.ArrivalDate,
    exportSailDate: row.SailingDate,
    destinationEta: row.DestinationETA,
    cutOffDate: row.CutOfDate,
    cutOffTime: row.CutOfTime,
    type: voyageType(row.TypeId),
    VesselId: odysseyVesselId,
    // Voyage.climaxId is a STRING column, unlike every other model's.
    climaxId: row.Id === null || row.Id === undefined ? null : String(row.Id),
  };
}

/**
 * @param {Array} legacyVessels
 * @param {object} ctx
 * @param {Iterable} ctx.existingClimaxIds  vessels already imported
 */
function planVessels(legacyVessels, ctx = {}) {
  const rows = Array.isArray(legacyVessels) ? legacyVessels : [];
  const imported = new Set([...(ctx.existingClimaxIds || [])].map(String));

  const problems = { missingId: 0, missingName: [], duplicateClimaxIds: [], duplicateNames: [] };
  const seenIds = new Set();
  const seenNames = new Map();
  const toCreate = [];
  let skipped = 0;

  for (const row of rows) {
    if (!row || toLegacyId(row.Id) === null) { problems.missingId += 1; continue; }

    const id = toLegacyId(row.Id);
    const key = String(id);

    if (seenIds.has(key)) { problems.duplicateClimaxIds.push(id); continue; }
    seenIds.add(key);

    if (imported.has(key)) { skipped += 1; continue; }

    const mapped = mapVessel(row);
    // name and type are NOT NULL with notEmpty validators.
    if (!mapped.name) { problems.missingName.push(id); continue; }

    // Not fatal - two ships can share a name - but it is what makes a vessel
    // picker ambiguous, so it is surfaced.
    const nameKey = mapped.name.toUpperCase();
    if (seenNames.has(nameKey)) problems.duplicateNames.push(mapped.name);
    else seenNames.set(nameKey, id);

    toCreate.push(mapped);
  }

  return {
    toCreate,
    problems,
    stats: {
      source: rows.length,
      toCreate: toCreate.length,
      alreadyImported: skipped,
      duplicateNames: problems.duplicateNames.length,
    },
    canApply: true,
  };
}

/**
 * @param {Array} legacyVoyages
 * @param {object} ctx
 * @param {Iterable} ctx.existingClimaxIds     voyages already imported
 * @param {Map}      ctx.vesselIdByClimaxId    legacy vessel id -> Odyssey id
 * @param {Iterable} ctx.existingVoyageKeys    `${vesselId}|${voyageNo}` already present
 */
function planVoyages(legacyVoyages, ctx = {}) {
  const rows = Array.isArray(legacyVoyages) ? legacyVoyages : [];
  const imported = new Set([...(ctx.existingClimaxIds || [])].map(String));
  const vessels = ctx.vesselIdByClimaxId instanceof Map
    ? ctx.vesselIdByClimaxId
    : new Map(Object.entries(ctx.vesselIdByClimaxId || {}));
  const existingKeys = new Set([...(ctx.existingVoyageKeys || [])].map(String));

  const problems = {
    missingId: 0,
    missingVoyageNo: [],
    duplicateClimaxIds: [],
    // A voyage whose vessel is not in Odyssey cannot be attached to anything.
    orphaned: [],
    // Two voyages with the same vessel and number: the Jobs stage keeps
    // whichever it sees first, so which one a job gets is not deterministic.
    ambiguousKeys: [],
    paddedVoyageNo: 0,
    guessedType: 0,
  };

  const seenIds = new Set();
  const seenKeys = new Set();
  const toCreate = [];
  let skipped = 0;

  for (const row of rows) {
    if (!row || toLegacyId(row.Id) === null) { problems.missingId += 1; continue; }

    const id = toLegacyId(row.Id);
    const key = String(id);

    if (seenIds.has(key)) { problems.duplicateClimaxIds.push(id); continue; }
    seenIds.add(key);

    if (imported.has(key)) { skipped += 1; continue; }

    const vesselId = vessels.get(String(toLegacyId(row.VesselId)));
    if (vesselId === undefined || vesselId === null) {
      problems.orphaned.push(id);
      continue;
    }

    const mapped = mapVoyage(row, vesselId);
    // voyage is NOT NULL with a notEmpty validator, and it is half the key the
    // Jobs stage matches on - a blank one can never be resolved.
    if (!mapped.voyage) { problems.missingVoyageNo.push(id); continue; }

    if (row.VoyageNo !== mapped.voyage) problems.paddedVoyageNo += 1;
    if (Number(row.TypeId) !== 2 && Number(row.TypeId) !== 3) problems.guessedType += 1;

    const k = voyageKey(vesselId, mapped.voyage);
    if (seenKeys.has(k) || existingKeys.has(k)) {
      problems.ambiguousKeys.push({ climaxId: id, voyage: mapped.voyage });
    } else {
      seenKeys.add(k);
    }

    toCreate.push(mapped);
  }

  return {
    toCreate,
    problems,
    stats: {
      source: rows.length,
      toCreate: toCreate.length,
      alreadyImported: skipped,
      orphaned: problems.orphaned.length,
      paddedVoyageNo: problems.paddedVoyageNo,
      ambiguous: problems.ambiguousKeys.length,
      guessedType: problems.guessedType,
    },
    // An orphaned or ambiguous voyage is reported, not fatal. Refusing the
    // whole set because two voyages share a number would be worse than
    // importing them and saying which two.
    canApply: true,
  };
}

module.exports = {
  planVessels, planVoyages, mapVessel, mapVoyage, voyageType, voyageKey,
  cleanText, toLegacyId, VESSEL_TYPES, DEFAULT_VESSEL_TYPE,
};

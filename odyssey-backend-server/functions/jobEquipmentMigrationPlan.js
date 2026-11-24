/**
 * Plan the equipment that hangs off a job.
 *
 * NOT the same thing as the containers on a B/L. Those come from
 * SExp_BL_Equipment and land in Container_Info (see blChildMigrationPlan.js);
 * these come from SExp_SeaExportJob_Equipment and land in SE_Equipments. The
 * legacy names are nearly identical and the two are easy to confuse - a job
 * says "two 40HC", a B/L says "container MSKU1234567, seal 998".
 *
 * Air jobs have no equipment at all; only the two sea job tables have it.
 *
 * WHAT THE OLD IMPORT GOT WRONG
 *
 *   equip.Gen_EquipmentSizeType.PerUnitWeight
 *                        Two problems in one expression. It is unguarded, so
 *                        an equipment row whose size code is not in the
 *                        lookup threw a TypeError inside the job's
 *                        transaction and took the job and the rest of its
 *                        batch with it - the same shape as `vessel.id` in the
 *                        jobs receiver. And it reads the size type's DEFAULT
 *                        weight while the equipment row carries its own
 *                        PerUnitWeight, so a job whose containers were
 *                        weighed got the catalogue figure instead.
 *
 *   climaxId             Never set, so equipment could not be verified or
 *                        re-run - exactly as with containers and stamps.
 *
 *   created per job      One INSERT per equipment row inside the job import,
 *                        so equipment could only be fixed by re-importing its
 *                        job.
 *
 * No database access here - pure, so it can be unit-tested.
 */

/** Only sea jobs carry equipment. */
const OPERATIONS = ['SE', 'SI'];
const JOB_KEY = { SE: 'SEJobId', SI: 'SIJobId' };

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

/** A usable value, or null - never the string "undefined" or NaN. */
function orNull(value) {
  if (value === null || value === undefined || value === '') return null;
  return value;
}

/**
 * Map one legacy job-equipment row onto SE_Equipments columns.
 *
 * @param {object} row       the legacy equipment row
 * @param {object} ctx
 * @param {Map} ctx.sizeTypes  EquipCode -> { Teus, PerUnitWeight }
 * @param {*}   ctx.jobId      the Odyssey SE_Job id
 */
function mapEquipment(row, ctx = {}) {
  const sizeTypes = ctx.sizeTypes || new Map();
  // Guarded. The old import read this straight through and threw whenever a
  // size code was missing from the lookup.
  const sizeType = sizeTypes.get(String(cleanText(row.EquipCode))) || {};

  return {
    size: cleanText(row.EquipCode),
    qty: orNull(row.Quantity),
    dg: Number(row.dDGNonDGId) === 2 ? 'non-DG' : 'DG',
    // The row's own weight first: the old import always took the size type's
    // catalogue default, so a job whose containers were actually weighed got
    // the wrong figure.
    gross: orNull(row.PerUnitWeight) ?? orNull(sizeType.PerUnitWeight),
    // TEU only exists on the size type - the equipment row has no such column.
    teu: orNull(sizeType.Teus),
    climaxId: toLegacyId(row.Id),
    SEJobId: ctx.jobId ?? null,
  };
}

/**
 * @param {Array}  legacyRows
 * @param {string} operation             SE | SI
 * @param {object} ctx
 * @param {Map} ctx.jobIdByLegacyId      legacy job id -> Odyssey SE_Job id
 * @param {Iterable} ctx.jobsDone        Odyssey job ids that already have equipment
 * @param {Map} ctx.sizeTypes            EquipCode -> { Teus, PerUnitWeight }
 */
function planJobEquipment(legacyRows, operation, ctx = {}) {
  if (!OPERATIONS.includes(operation)) {
    throw new Error(
      `Job equipment exists only for sea operations. Got "${operation}", expected one of: `
      + `${OPERATIONS.join(', ')}.`,
    );
  }

  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const jobs = ctx.jobIdByLegacyId instanceof Map
    ? ctx.jobIdByLegacyId : new Map(Object.entries(ctx.jobIdByLegacyId || {}));
  const done = new Set([...(ctx.jobsDone || [])].map(String));
  const sizeTypes = ctx.sizeTypes instanceof Map
    ? ctx.sizeTypes : new Map(Object.entries(ctx.sizeTypes || {}));

  const jobKey = JOB_KEY[operation];

  const problems = {
    missingId: 0,
    missingJobRef: 0,
    orphaned: [],
    // A size code the lookup does not explain: the row still imports, but with
    // no TEU count and only whatever weight it carries itself.
    unknownSizeType: [],
    missingSize: 0,
  };

  const toCreate = [];
  const jobsTouched = new Set();
  let skippedJobs = 0;

  for (const row of rows) {
    if (!row) { problems.missingJobRef += 1; continue; }
    if (toLegacyId(row.Id) === null) { problems.missingId += 1; continue; }

    const legacyJobId = toLegacyId(row[jobKey]);
    if (legacyJobId === null) { problems.missingJobRef += 1; continue; }

    const jobId = jobs.get(String(legacyJobId));
    if (jobId === undefined || jobId === null) {
      problems.orphaned.push(legacyJobId);
      continue;
    }

    // Job-scoped skip, matching the B/L children stage: equipment is always
    // written as a complete set per job.
    if (done.has(String(jobId))) { skippedJobs += 1; continue; }

    const mapped = mapEquipment(row, { sizeTypes, jobId });

    if (!mapped.size) problems.missingSize += 1;
    else if (!sizeTypes.has(String(mapped.size))) problems.unknownSizeType.push(mapped.size);

    toCreate.push(mapped);
    jobsTouched.add(String(jobId));
  }

  return {
    toCreate,
    problems,
    stats: {
      operation,
      source: rows.length,
      toCreate: toCreate.length,
      jobs: jobsTouched.size,
      skippedJobs,
      orphaned: problems.orphaned.length,
      unknownSizeType: problems.unknownSizeType.length,
      missingSize: problems.missingSize,
    },
    // An unknown size code is reported, not fatal - the row is still a real
    // piece of equipment on a real job.
    canApply: true,
  };
}

module.exports = {
  planJobEquipment, mapEquipment, cleanText, toLegacyId, orNull, OPERATIONS, JOB_KEY,
};

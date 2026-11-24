const db = require('../models');

/**
 * Per-request lookup cache for the migration receivers.
 *
 * WHY
 * The job receivers resolved every foreign key with its own query. Per job that
 * was 9 x Clients.findOne + Commodity + Vessel + Voyage, plus a full
 * Child_Account.findAll (the entire chart of accounts, with an include) INSIDE
 * the per-job loop, plus 3-4 more findOne per charge line. A job with ten charge
 * lines cost roughly 65 queries and one complete COA read; ten thousand jobs
 * came to ~650,000 queries and ten thousand COA scans.
 *
 * All of those questions have the same small set of answers. Ask once per
 * process, resolve from memory afterwards.
 *
 * SAFETY
 * - Read-only. It never writes, so it cannot change what the migration produces.
 * - Lazy: a table is only loaded if something actually asks for it.
 * - Loaded once per process and reused across batches, which is what makes a
 *   10-job batch cost the same lookups as a 500-job one. Call reset() if rows
 *   are inserted that later batches must see (the migration inserts parents in
 *   an earlier stage, so in practice each stage resets once at its start).
 * - Returns the same shape as the findOne it replaces: the instance, or null.
 */

// model name -> { key: column to index by, attributes: what callers actually read }
//
// `attributes` is deliberately minimal and was derived from the call sites: the
// receivers read only `.id` off every lookup, plus `.name` on Charges. Loading
// whole rows for Invoice/Vouchers would pull tens of thousands of wide records
// into memory for two columns' worth of use.
const SPECS = {
  Clients:   { key: 'climaxId', attributes: ['id', 'climaxId'] },
  Commodity: { key: 'climaxId', attributes: ['id', 'climaxId'] },
  Vessel:    { key: 'climaxId', attributes: ['id', 'climaxId'] },
  Invoice:   { key: 'climaxId', attributes: ['id', 'climaxId'] },
  Vouchers:  { key: 'climaxId', attributes: ['id', 'climaxId'] },
  Employees: { key: 'climaxId', attributes: ['id', 'climaxId'] },
  Company:   { key: 'climaxId', attributes: ['id', 'climaxId'] },
  SE_Job:    { key: 'climaxId', attributes: ['id', 'climaxId'] },
  // Charges are resolved by legacy id. `code` used to hold that id because
  // Charges had no climaxId column; now it holds the real ChargesCode, so the
  // lookup keys on climaxId with `code` kept as a fallback for installs
  // imported before the column existed.
  Charges:   { key: 'climaxId', fallbackKey: 'code', attributes: ['id', 'code', 'name', 'climaxId'] },
};

const cache = new Map();      // `${model}:${key}` -> Map(value -> instance)
const loading = new Map();    // in-flight promises, so parallel calls load once

/** Normalise a legacy id: they arrive as numbers and as strings. */
function norm(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim();
}

async function loadIndex(modelName, key) {
  const cacheKey = `${modelName}:${key}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  if (loading.has(cacheKey)) return loading.get(cacheKey);

  const promise = (async () => {
    const model = db[modelName];
    if (!model) throw new Error(`migrationCache: unknown model "${modelName}"`);

    const attributes = (SPECS[modelName] && SPECS[modelName].attributes) || ['id', key];
    const rows = await model.findAll({ attributes });
    const map = new Map();
    for (const row of rows) {
      const k = norm(row[key]);
      // First write wins: a duplicate legacy id is a source-data problem, and
      // silently preferring the last row would make the result order-dependent.
      if (k !== null && !map.has(k)) map.set(k, row);
    }
    cache.set(cacheKey, map);
    loading.delete(cacheKey);
    console.log(`[migration] cached ${map.size} ${modelName} by ${key}`);
    return map;
  })();

  loading.set(cacheKey, promise);
  return promise;
}

/**
 * Replacement for `Model.findOne({ where: { climaxId: id } })`.
 * Returns the instance (id + key only) or null.
 */
async function findByLegacyId(modelName, id) {
  const spec = SPECS[modelName];
  const key = spec ? spec.key : 'climaxId';
  const k = norm(id);
  if (k === null) return null;

  const map = await loadIndex(modelName, key);
  const hit = map.get(k);
  if (hit) return hit;

  // Fall back to the column the legacy id used to live in.
  //
  // Charges are the case: `code` held the legacy row id until Charges gained a
  // climaxId, so an install imported before that has its charges reachable only
  // through `code`. Without this, re-importing jobs against such an install
  // would resolve no charges at all and every charge line would come through
  // unnamed - silently, because a missing charge is not an error.
  if (spec && spec.fallbackKey) {
    const fallback = await loadIndex(modelName, spec.fallbackKey);
    return fallback.get(k) || null;
  }
  return null;
}

/**
 * Voyage by (VesselId, voyage number). Not a legacy-id lookup, so it needs its
 * own composite index - but it was still one query per job.
 */
let voyagePromise = null;
async function findVoyage(vesselId, voyageNo) {
  if (!vesselId || voyageNo === null || voyageNo === undefined || voyageNo === '') return null;
  if (!voyagePromise) {
    voyagePromise = (async () => {
      const rows = await db.Voyage.findAll({ attributes: ['id', 'VesselId', 'voyage'] });
      const map = new Map();
      for (const v of rows) {
        const k = `${v.VesselId}|${String(v.voyage).trim()}`;
        if (!map.has(k)) map.set(k, v);
      }
      console.log(`[migration] cached ${map.size} voyages by vessel+number`);
      return map;
    })();
  }
  const map = await voyagePromise;
  return map.get(`${vesselId}|${String(voyageNo).trim()}`) || null;
}

/** Chart of accounts, keyed by title - was re-read on every single job. */
let accountMapPromise = null;
async function getAccountMap() {
  if (accountMapPromise) return accountMapPromise;
  accountMapPromise = (async () => {
    const accounts = await db.Child_Account.findAll({
      attributes: ['id', 'title', 'subCategory'],
    });
    const map = new Map();
    for (const a of accounts) map.set(`${a.title}`, { id: a.id, subCategory: a.subCategory });
    console.log(`[migration] cached ${map.size} accounts by title`);
    return map;
  })();
  return accountMapPromise;
}

/**
 * Drop everything. Each migration stage calls this when it starts, so it sees
 * rows the previous stage inserted.
 */
function reset() {
  cache.clear();
  loading.clear();
  accountMapPromise = null;
  voyagePromise = null;
}

/** What is currently held, for the stats line at the end of a stage. */
function stats() {
  const out = {};
  for (const [k, v] of cache.entries()) out[k] = v.size;
  return out;
}

module.exports = { findByLegacyId, findVoyage, getAccountMap, reset, stats };

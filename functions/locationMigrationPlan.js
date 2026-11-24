/**
 * Plan one batch of a location import - airports, sea ports or destinations.
 *
 * WHY THIS STAGE IS SHAPED DIFFERENTLY FROM THE OTHER REWRITTEN ONES
 *
 * The others send the whole export, get a plan back, then send it again to
 * apply. That costs nothing at 400 rows and little at 10,649. Here the legacy
 * export is ~47.7 MB and produces ~207,000 rows - 4,492 airports, 107,915 sea
 * ports and 94,582 destinations - so sending it twice to preview it is not
 * worth what the preview tells you.
 *
 * Instead the frontend shapes the export once (it has to: resolving an
 * airport's city needs all 108,182 locations in memory) and streams flat
 * batches here. Each batch is planned by this module and written in its own
 * transaction. `dryRun` plans a batch without writing it, so the same code
 * path answers "what would happen".
 *
 * THE HONEST LIMIT: a batch is atomic, the run is not. 207,000 rows cannot be
 * one transaction over ~200 HTTP requests, so an interrupted run leaves the
 * batches that already landed. That is safe here precisely because the stage
 * is idempotent - re-running skips what exists and finishes the rest - and the
 * route says so rather than implying all-or-nothing.
 *
 * NOT NULL / notEmpty: every column on these three models is NOT NULL with a
 * notEmpty validator, but bulkCreate does not run validators. So a blank slips
 * in silently and shows as an empty cell forever. This module drops such rows
 * into `rejected` instead, where they are counted and sampled.
 *
 * No database access here - pure, so it can be unit-tested.
 */

/** The three kinds, their key column, and the columns that must not be blank. */
const KINDS = {
  airports: {
    key: 'airportCode',
    required: ['airportCode', 'airportName', 'city', 'country'],
  },
  ports: {
    key: 'portId',
    required: ['portId', 'portName', 'portCountry'],
  },
  destinations: {
    key: 'name',
    required: ['name'],
  },
};

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

/**
 * @param {string} kind                  airports | ports | destinations
 * @param {Array}  rows                  flat, pre-shaped rows
 * @param {Iterable} existingKeys        keys already in the table
 */
function planLocationBatch(kind, rows, existingKeys = []) {
  const spec = KINDS[kind];
  if (!spec) {
    throw new Error(
      `Unknown location kind "${kind}". Expected one of: ${Object.keys(KINDS).join(', ')}.`,
    );
  }

  const list = Array.isArray(rows) ? rows : [];
  // Compared case-insensitively: a picker showing both "Paris" and "PARIS"
  // is a duplicate to everyone except the unique index.
  const existing = new Set([...existingKeys].map((k) => String(k).toUpperCase()));

  const seen = new Set();
  const toCreate = [];
  const rejected = [];
  let duplicatesInBatch = 0;
  let alreadyPresent = 0;

  for (const row of list) {
    if (!row || typeof row !== 'object') { rejected.push({ reason: 'not an object', row }); continue; }

    // Normalise every required column, so nothing reaches a NOT NULL column
    // blank just because bulkCreate would not have checked.
    const cleaned = {};
    let missing = null;
    for (const col of spec.required) {
      const value = cleanText(row[col]);
      if (!value) { missing = col; break; }
      cleaned[col] = value;
    }
    if (missing) {
      rejected.push({ reason: `${missing} is blank`, row });
      continue;
    }

    const id = String(cleaned[spec.key]).toUpperCase();
    if (seen.has(id)) { duplicatesInBatch += 1; continue; }
    seen.add(id);

    if (existing.has(id)) { alreadyPresent += 1; continue; }

    toCreate.push(cleaned);
  }

  return {
    kind,
    toCreate,
    rejected,
    stats: {
      received: list.length,
      toCreate: toCreate.length,
      duplicatesInBatch,
      alreadyPresent,
      rejected: rejected.length,
    },
    // A blank row is dropped and reported, not fatal: refusing a batch of
    // 1,000 ports because one has no country would stall the whole stage.
    canApply: true,
  };
}

/** The keys a batch would need looked up, so the caller can query once. */
function keysOf(kind, rows) {
  const spec = KINDS[kind];
  if (!spec) return [];
  return (Array.isArray(rows) ? rows : [])
    .map((r) => cleanText(r && r[spec.key]))
    .filter(Boolean);
}

module.exports = { planLocationBatch, keysOf, cleanText, KINDS };

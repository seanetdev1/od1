// Single-active-session enforcement, backed by the Sessions table.
//
// WHY THIS IS NOT AN IN-PROCESS CACHE ANYMORE
// -------------------------------------------
// It used to be a bare LRUCache. That is shared-nothing state, and the moment
// the app runs as more than one process (server.js forks one worker per CPU)
// it breaks in two specific ways:
//
//   - Logout cleared the session on whichever worker served the request. The
//     token stayed valid on the other N-1 workers for the rest of its 12h life.
//   - A second concurrent login could land on a worker with no record of the
//     first, so the "already logged in" check passed and the single-session
//     rule was silently defeated.
//
// The rule was written correctly; it just cannot hold in per-process memory.
// Postgres is the shared store, so every process now reads the same answer.
//
// THE READ CACHE
// --------------
// getSessionToken() runs on every authenticated request, so a database
// round-trip per call is not acceptable. Reads go through a short-TTL LRU:
//
//   - Writes (setSession/clearSession) update this process's cache
//     synchronously, so a single-process deploy - which is what actually ships
//     today - is exactly as consistent as the old in-memory version was.
//   - Across processes, staleness is bounded by SESSION_CACHE_TTL_MS (10s by
//     default). A logout takes effect on other workers within that window.
//
// Set SESSION_CACHE_TTL_MS=0 to disable the cache and hit the database on
// every read, if you ever need strictly immediate cross-worker invalidation.

const { LRUCache } = require('lru-cache');
const db = require('../models');

// Session lifetime matches the token's own expiry (routes/auth signs for 12h).
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const CACHE_TTL_MS =
  process.env.SESSION_CACHE_TTL_MS !== undefined
    ? Number(process.env.SESSION_CACHE_TTL_MS)
    : 10 * 1000;

// Caches the *absence* of a session as null too - otherwise every request from
// a logged-out client would miss the cache and hit the database.
const readCache = CACHE_TTL_MS > 0
  ? new LRUCache({ max: 10000, ttl: CACHE_TTL_MS })
  : null;

function key(userId) {
  return String(userId);
}

function cacheGet(k) {
  if (!readCache) return undefined;
  return readCache.get(k);
}

function cacheSet(k, value) {
  if (!readCache) return;
  readCache.set(k, value);
}

// Housekeeping: drop rows whose token has expired anyway. Throttled and
// fire-and-forget - this is tidying, never on the critical path of a request.
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
let lastPruneAt = 0;

function maybePrune() {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  db.Session.destroy({ where: { expiresAt: { [db.Sequelize.Op.lt]: new Date() } } })
    .catch((err) => console.error('[session] prune failed:', err.message));
}

module.exports = {
  /**
   * Record `token` as the one valid session for `userId`, replacing any
   * previous one. Upsert on the primary key IS the single-session rule.
   */
  async setSession(userId, token) {
    if (userId == null) return;
    const k = key(userId);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await db.Session.upsert({ userId: k, token, expiresAt });
    cacheSet(k, token);
    maybePrune();
  },

  /**
   * Drop the user's session. After this, their token is dead everywhere -
   * that is the whole point of moving this out of process memory.
   */
  async clearSession(userId) {
    if (userId == null) return;
    const k = key(userId);

    await db.Session.destroy({ where: { userId: k } });
    // Cache the negative result rather than deleting the entry, so a
    // concurrent read in this process can't repopulate it from a stale row.
    cacheSet(k, null);
  },

  /**
   * The token currently valid for this user, or undefined if there is none.
   * Callers treat undefined and null alike ("no session"); undefined is kept
   * as the return value for absence to match the previous LRU-backed API.
   */
  async getSessionToken(userId) {
    if (userId == null) return undefined;
    const k = key(userId);

    const cached = cacheGet(k);
    if (cached !== undefined) return cached === null ? undefined : cached;

    const row = await db.Session.findByPk(k);

    if (!row) {
      cacheSet(k, null);
      return undefined;
    }

    // A row that outlived its token is not a session.
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      cacheSet(k, null);
      db.Session.destroy({ where: { userId: k } }).catch(() => {});
      return undefined;
    }

    cacheSet(k, row.token);
    return row.token;
  },

  async isTokenValid(userId, token) {
    if (userId == null) return false;
    const t = await module.exports.getSessionToken(userId);
    return Boolean(t && t === token);
  },

  async isActive(userId) {
    if (userId == null) return false;
    const t = await module.exports.getSessionToken(userId);
    return t !== undefined;
  },

  /**
   * Test seam: drops this process's read cache so a test can observe the
   * database directly without waiting out the TTL.
   */
  _resetCache() {
    if (readCache) readCache.clear();
  },
};

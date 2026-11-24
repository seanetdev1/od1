// Failed-login throttle for /authRoutes/login and /authRoutes/systemLogin.
//
// Login had no limit at all: a script could try passwords against a username
// as fast as bcrypt would answer. Now, MAX_FAILURES wrong passwords for one
// username from one address inside WINDOW_MS locks that pair out for
// WINDOW_MS. A success clears it.
//
// Keyed on address + username rather than username alone, so someone cannot
// lock a colleague out just by typing their name wrong five times from another
// desk - they lock out only themselves.
//
// Per process. server.js forks one worker per core, so on an N-core box the
// effective limit is up to N x MAX_FAILURES before every worker has seen the
// pair. That still turns "unlimited" into a handful, which is the point; a
// shared store would buy precision nobody needs here.

const { LRUCache } = require('lru-cache');

const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES) || 5;
const WINDOW_MS = (Number(process.env.LOGIN_LOCK_MINUTES) || 15) * 60 * 1000;

const failures = new LRUCache({ max: 20000, ttl: WINDOW_MS });

const keyOf = (ip, username) => `${ip}|${String(username ?? '').trim().toLowerCase()}`;

/** null when the pair may try again, else the minutes left on the lock. */
function lockedFor(ip, username) {
  const entry = failures.get(keyOf(ip, username));
  if (!entry || entry.count < MAX_FAILURES) return null;
  const left = entry.firstAt + WINDOW_MS - Date.now();
  return left > 0 ? Math.ceil(left / 60000) : null;
}

function recordFailure(ip, username) {
  const k = keyOf(ip, username);
  const entry = failures.get(k);
  if (!entry) {
    failures.set(k, { count: 1, firstAt: Date.now() });
  } else {
    // Keep the original TTL, so the lock ends WINDOW_MS after the FIRST miss
    // rather than sliding forward with every new attempt.
    failures.set(k, { count: entry.count + 1, firstAt: entry.firstAt }, { noUpdateTTL: true });
  }
}

function recordSuccess(ip, username) {
  failures.delete(keyOf(ip, username));
}

module.exports = {
  MAX_FAILURES,
  WINDOW_MS,
  lockedFor,
  recordFailure,
  recordSuccess,
  _reset() { failures.clear(); },
};

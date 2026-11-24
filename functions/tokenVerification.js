const jwt = require('jsonwebtoken');
const { LRUCache } = require('lru-cache');

const { JWT_SECRET } = require('./secrets');

// Cache decoded tokens (CRITICAL for performance) - this saves the crypto, not
// the session lookup. The session is still checked on every single request via
// sessionManager, which has its own short read cache in front of the database.
const tokenCache = new LRUCache({
  max: 10000,
  ttl: 60 * 1000, // 1 minute
});

const sessionManager = require('./sessionManager');

function extractToken(req) {
  const header =
    req.headers.authorization ||
    req.headers['x-access-token'];

  if (!header || typeof header !== 'string') return null;

  // ✅ Standard: "Bearer <token>"
  if (header.startsWith('Bearer ')) {
    return header.slice(7);
  }

  // ✅ Your legacy format: "BearerSplit<token>"
  if (header.startsWith('BearerSplit')) {
    return header.slice('BearerSplit'.length);
  }

  // ✅ Raw token fallback
  return header;
}

// async because sessionManager is Postgres-backed (see the header comment
// there for why it can't be process memory). Express 4 ignores the returned
// promise, so nothing in here may reject - the outer try/catch guarantees it.
async function verify(req, res, next) {
  const token = extractToken(req);
  const isLogoutRoute = req.path === '/authRoutes/logout';

  if (!token) {
    return res.status(401).json({
      isLoggedIn: false,
      message: 'Token missing',
    });
  }

  try {
    // ✅ FAST PATH — no crypto
    const cachedUser = tokenCache.get(token);
    if (cachedUser) {
      // Ensure the cached token still matches the current session for this
      // user. This must reject when sToken is falsy too (not just when it
      // differs from `token`) - a falsy sToken means the session was cleared
      // (e.g. logout), and letting that through was a real bug: a token used
      // at least once in the last 60s stayed valid via this cache even after
      // logout, since the old check only fired on a *mismatched* session.
      const sToken = await sessionManager.getSessionToken(cachedUser.id);
      if (sToken !== token) {
        if (isLogoutRoute) {
          // Stale/cleared session but token decodes fine — still let logout through
          req.user = cachedUser;
          return next();
        }
        return res.status(401).json({
          isLoggedIn: false,
          message: sToken ? 'User logged in elsewhere' : 'Session expired',
        });
      }
      req.user = cachedUser;
      return next();
    }

    let decoded;
    try {
      // ✅ Crypto happens ONCE per minute per token
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (isLogoutRoute) {
        // Token expired/invalid signature — still try to decode (unsafe) so we
        // can identify the user and clear their server-side session anyway.
        const decodedUnsafe = jwt.decode(token);
        if (decodedUnsafe && decodedUnsafe.id) {
          req.user = { id: decodedUnsafe.id };
          return next();
        }
      }
      return res.status(401).json({
        isLoggedIn: false,
        message: 'Invalid or expired token',
      });
    }

    const user = {
      id: decoded.id,
      username: decoded.username,
      designation: decoded.designation,
      access: decoded.access,
      // A Seanet support session. Only a claim: functions/systemAccess.js
      // re-verifies the signed credential it carries before granting anything,
      // because whoever holds JWT_SECRET can write `system: true` here.
      system: decoded.system === true,
      supportCredential: decoded.sc || null,
    };

    // Enforce single active-session per user
    const existingSession = await sessionManager.getSessionToken(user.id);
    if (existingSession) {
      // If existing session token differs from presented token, block access
      if (existingSession !== token) {
        if (isLogoutRoute) {
          // Allow logout through even on a session mismatch
          req.user = user;
          return next();
        }
        return res.status(401).json({
          isLoggedIn: false,
          message: 'User logged in elsewhere',
        });
      }
      // else token matches stored session — continue
    } else {
      // No session recorded. Now that sessions live in the database rather
      // than per-process memory, this no longer means "another worker has it"
      // or "we restarted" - it means there genuinely is no session, i.e. the
      // user logged out or it expired. Restoring one here would hand a valid
      // token back its access after logout, so we reject instead.
      //
      // EXCEPT for logout itself. Without this the user is trapped: every
      // request 401s with "Session expired", and the one action that would
      // clear their cookies and return them to the login page 401s too, so the
      // stale token sits in the browser forever. The mismatch branch above
      // already made this exemption; this branch was missed when it replaced
      // the old session-restore behaviour.
      if (isLogoutRoute) {
        req.user = user;
        return next();
      }
      return res.status(401).json({
        isLoggedIn: false,
        message: 'Session expired',
      });
    }

    tokenCache.set(token, user);
    req.user = user;
    next();
  } catch (err) {
    // Only reachable if the session store itself failed (DB down, etc.).
    // Fail closed: a store we can't read can't tell us this token is still
    // valid, and quietly allowing it through is how single-session gets lost.
    console.error('[auth] session check failed:', err.message);
    return res.status(503).json({
      isLoggedIn: false,
      message: 'Authentication temporarily unavailable',
    });
  }
}

module.exports = verify;

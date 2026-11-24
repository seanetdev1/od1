// Moved here from tests/unit/ when sessionManager became Postgres-backed -
// verify() now awaits a database read, so this needs tests/setupTestDb.js.

const jwt = require('jsonwebtoken');
const verify = require('../../functions/tokenVerification');
const sessionManager = require('../../functions/sessionManager');

// Same secret source the middleware under test uses (functions/secrets.js);
// under NODE_ENV=test both resolve to the fixed test default.
const { JWT_SECRET } = require('../../functions/secrets');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockReq({ headers = {}, path = '/some/protected/route' } = {}) {
  return { headers, path };
}

// tokenCache (functions/tokenVerification.js) is a module-level singleton
// with a 60s TTL shared across this whole test file - give every test its
// own userId/token payload (via a unique `sub`) so cache entries from one
// test can never be mistaken for another's.
let counter = 0;
function uniqueUserId() {
  counter += 1;
  return `tv-test-user-${Date.now()}-${counter}`;
}

function signToken(payload, options) {
  return jwt.sign(payload, JWT_SECRET, options);
}

describe('functions/tokenVerification.js (verify middleware)', () => {
  const usedUserIds = [];

  afterEach(async () => {
    for (const id of usedUserIds.splice(0)) {
      await sessionManager.clearSession(id);
    }
  });

  it('rejects with 401 when no token is present at all', async () => {
    const res = mockRes();
    const next = jest.fn();
    await verify(mockReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a malformed/garbage token with 401 "Invalid or expired token"', async () => {
    const res = mockRes();
    const next = jest.fn();
    await verify(mockReq({ headers: { authorization: 'Bearer not-a-real-jwt' } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid or expired token' })
    );
  });

  it('rejects an expired token with 401', async () => {
    const userId = uniqueUserId();
    usedUserIds.push(userId);
    const token = signToken({ id: userId, username: 'x', designation: 'employee' }, { expiresIn: -10 });

    const res = mockRes();
    const next = jest.fn();
    await verify(mockReq({ headers: { authorization: `Bearer ${token}` } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts a token passed via the x-access-token header (no Authorization header)', async () => {
    const userId = uniqueUserId();
    usedUserIds.push(userId);
    const token = signToken({ id: userId, username: 'xatuser', designation: 'employee' });
    await sessionManager.setSession(userId, token);

    const res = mockRes();
    const next = jest.fn();
    const req = mockReq({ headers: { 'x-access-token': token } });
    await verify(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: userId, username: 'xatuser' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts the legacy "BearerSplit<token>" Authorization header format', async () => {
    const userId = uniqueUserId();
    usedUserIds.push(userId);
    const token = signToken({ id: userId, username: 'legacyuser', designation: 'employee' });
    await sessionManager.setSession(userId, token);

    const res = mockRes();
    const next = jest.fn();
    const req = mockReq({ headers: { authorization: `BearerSplit${token}` } });
    await verify(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: userId, username: 'legacyuser' });
  });

  // BEHAVIOUR CHANGE. This used to assert the opposite: a validly-signed token
  // with no session on record got a session silently created for it, on the
  // theory that "no record" meant the server had restarted.
  //
  // With sessions in the database that inference is no longer available - and
  // it was the exact hole that made single-session enforcement bypassable
  // under clustering (land the second login on a worker that hadn't seen the
  // first, and it restored a session instead of rejecting). "No session" now
  // means the user logged out or it expired, so we reject.
  it('rejects a validly-signed token that has no session on record, instead of restoring one', async () => {
    const userId = uniqueUserId();
    usedUserIds.push(userId);
    const token = signToken({ id: userId, username: 'freshuser', designation: 'employee' });

    expect(await sessionManager.isActive(userId)).toBe(false);

    const res = mockRes();
    const next = jest.fn();
    await verify(mockReq({ headers: { authorization: `Bearer ${token}` } }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Session expired' })
    );
    // and crucially, it did NOT create one as a side effect
    expect(await sessionManager.isActive(userId)).toBe(false);
  });

  describe('"logged in elsewhere" - a different, currently-active session for the same user', () => {
    it('rejects on the slow (jwt.verify) path when the token has never been cached before', async () => {
      const userId = uniqueUserId();
      usedUserIds.push(userId);
      const activeToken = signToken({ id: userId, username: 'u', designation: 'employee', access: 'A' });
      const otherToken = signToken({ id: userId, username: 'u', designation: 'employee', access: 'B' });
      expect(otherToken).not.toBe(activeToken);

      await sessionManager.setSession(userId, activeToken);

      const res = mockRes();
      const next = jest.fn();
      await verify(mockReq({ headers: { authorization: `Bearer ${otherToken}` } }), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User logged in elsewhere' })
      );
    });

    it('rejects on the fast (cached) path once a different session becomes active after the token was cached', async () => {
      const userId = uniqueUserId();
      usedUserIds.push(userId);
      const tokenB = signToken({ id: userId, username: 'u', designation: 'employee' });

      // Establish tokenB as this user's own session and cache it (slow path).
      await sessionManager.setSession(userId, tokenB);
      const next1 = jest.fn();
      await verify(mockReq({ headers: { authorization: `Bearer ${tokenB}` } }), mockRes(), next1);
      expect(next1).toHaveBeenCalledTimes(1);

      // Someone else logs in as this user elsewhere, replacing the session -
      // tokenB is still cached (fast path) but is no longer the active session.
      const tokenA = signToken({ id: userId, username: 'u', designation: 'employee', access: 'elsewhere' });
      await sessionManager.setSession(userId, tokenA);

      const res = mockRes();
      const next2 = jest.fn();
      await verify(mockReq({ headers: { authorization: `Bearer ${tokenB}` } }), res, next2);

      expect(next2).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'User logged in elsewhere' })
      );
    });

    // Regression test for the fix: this fast-path branch used to only fire
    // when sToken *differed* from the presented token - when there was
    // simply no session at all (e.g. right after logout), a token cached in
    // the last 60s was let through anyway. See tests/integration/auth.test.js
    // for the same bug demonstrated through the real HTTP logout flow.
    it('rejects on the fast (cached) path once the session is cleared entirely (e.g. logout)', async () => {
      const userId = uniqueUserId();
      usedUserIds.push(userId);
      const token = signToken({ id: userId, username: 'u', designation: 'employee' });

      await sessionManager.setSession(userId, token);
      const next1 = jest.fn();
      await verify(mockReq({ headers: { authorization: `Bearer ${token}` } }), mockRes(), next1);
      expect(next1).toHaveBeenCalledTimes(1);

      // Log out: session cleared, but the token is still warm in tokenCache.
      await sessionManager.clearSession(userId);

      const res = mockRes();
      const next2 = jest.fn();
      await verify(mockReq({ headers: { authorization: `Bearer ${token}` } }), res, next2);

      expect(next2).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Session expired' })
      );
    });

    // The cluster case the rewrite exists for: the logout happened somewhere
    // this process never saw, so only the shared store knows about it.
    it('rejects once the session is cleared elsewhere, with no local cache to tell it', async () => {
      const userId = uniqueUserId();
      usedUserIds.push(userId);
      const token = signToken({ id: userId, username: 'u', designation: 'employee' });

      await sessionManager.setSession(userId, token);
      await verify(mockReq({ headers: { authorization: `Bearer ${token}` } }), mockRes(), jest.fn());

      // Simulate "another worker handled the logout": clear the row, then drop
      // this process's read cache so the next check must consult the database.
      await sessionManager.clearSession(userId);
      sessionManager._resetCache();

      const res = mockRes();
      const next = jest.fn();
      await verify(mockReq({ headers: { authorization: `Bearer ${token}` } }), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('isLogoutRoute special-casing (req.path === "/authRoutes/logout")', () => {
    it('still lets logout through on the fast path even with a cleared session, without re-establishing one', async () => {
      const userId = uniqueUserId();
      usedUserIds.push(userId);
      const token = signToken({ id: userId, username: 'u', designation: 'employee' });

      await sessionManager.setSession(userId, token);
      await verify(mockReq({ headers: { authorization: `Bearer ${token}` } }), mockRes(), jest.fn());
      await sessionManager.clearSession(userId);

      const res = mockRes();
      const next = jest.fn();
      const req = mockReq({ headers: { authorization: `Bearer ${token}` }, path: '/authRoutes/logout' });
      await verify(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toMatchObject({ id: userId });
      expect(await sessionManager.isActive(userId)).toBe(false);
    });

    it('lets a well-formed but expired token through on the slow path via unsafe decode, to identify the user for cleanup', async () => {
      const userId = uniqueUserId();
      usedUserIds.push(userId);
      const token = signToken({ id: userId, username: 'u', designation: 'employee' }, { expiresIn: -10 });

      const res = mockRes();
      const next = jest.fn();
      const req = mockReq({ headers: { authorization: `Bearer ${token}` }, path: '/authRoutes/logout' });
      await verify(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({ id: userId });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('still rejects with 401 on the logout route when the token is not a JWT at all (nothing to decode)', async () => {
      const res = mockRes();
      const next = jest.fn();
      const req = mockReq({ headers: { authorization: 'Bearer complete-garbage' }, path: '/authRoutes/logout' });
      await verify(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});

describe('logout is always reachable', () => {
  const ids = [];
  afterEach(async () => {
    for (const id of ids.splice(0)) await sessionManager.clearSession(id);
  });

  // Regression: when the session-restore behaviour was replaced with a 401, the
  // "no session at all" branch did not exempt logout. Every request 401'd with
  // "Session expired" AND logout 401'd too, so the stale token could never be
  // cleared - the user was trapped on the login screen.
  it('lets logout through when the user has NO session at all', async () => {
    const userId = uniqueUserId();
    ids.push(userId);
    const token = signToken({ id: userId, username: 'u', designation: 'employee' });

    expect(await sessionManager.isActive(userId)).toBe(false);

    const res = mockRes();
    const next = jest.fn();
    const req = mockReq({ headers: { authorization: `Bearer ${token}` }, path: '/authRoutes/logout' });
    await verify(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user).toMatchObject({ id: userId });
  });
});

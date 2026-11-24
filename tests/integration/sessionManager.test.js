// Moved here from tests/unit/ when sessionManager stopped being an in-process
// LRUCache and became Postgres-backed (see functions/sessionManager.js for
// why). It needs a real database now, so it belongs in the integration
// project, which gets tests/setupTestDb.js.

const sessionManager = require('../../functions/sessionManager');

describe('sessionManager (single-active-session enforcement, DB-backed)', () => {
  const userId = `test-user-${Date.now()}`;

  afterEach(async () => {
    await sessionManager.clearSession(userId);
    await sessionManager.clearSession(123);
  });

  it('isActive is false and getSessionToken is undefined before any session is set', async () => {
    expect(await sessionManager.isActive(userId)).toBe(false);
    expect(await sessionManager.getSessionToken(userId)).toBeUndefined();
  });

  it('setSession makes isActive true and stores the token', async () => {
    await sessionManager.setSession(userId, 'token-a');
    expect(await sessionManager.isActive(userId)).toBe(true);
    expect(await sessionManager.getSessionToken(userId)).toBe('token-a');
  });

  it('isTokenValid is true only for the exact stored token', async () => {
    await sessionManager.setSession(userId, 'token-a');
    expect(await sessionManager.isTokenValid(userId, 'token-a')).toBe(true);
    expect(await sessionManager.isTokenValid(userId, 'token-b')).toBe(false);
  });

  it('clearSession removes the session', async () => {
    await sessionManager.setSession(userId, 'token-a');
    await sessionManager.clearSession(userId);
    expect(await sessionManager.isActive(userId)).toBe(false);
    expect(await sessionManager.isTokenValid(userId, 'token-a')).toBe(false);
  });

  it('setSession overwrites a previous session for the same user (single active session)', async () => {
    await sessionManager.setSession(userId, 'token-a');
    await sessionManager.setSession(userId, 'token-b');
    expect(await sessionManager.getSessionToken(userId)).toBe('token-b');
    expect(await sessionManager.isTokenValid(userId, 'token-a')).toBe(false);
    expect(await sessionManager.isTokenValid(userId, 'token-b')).toBe(true);
  });

  it('keys sessions by String(userId), so numeric and string forms of the same id collide', async () => {
    await sessionManager.setSession(123, 'token-x');
    expect(await sessionManager.isActive('123')).toBe(true);
    expect(await sessionManager.isTokenValid('123', 'token-x')).toBe(true);
  });

  // The point of the whole rewrite: the session has to be readable from a
  // process that never saw the write. Dropping the read cache is the closest
  // this suite can get to "a different cluster worker handles the next
  // request" without actually forking one.
  it('reads back from the database, not just this process\'s cache', async () => {
    await sessionManager.setSession(userId, 'token-shared');
    sessionManager._resetCache();
    expect(await sessionManager.getSessionToken(userId)).toBe('token-shared');
  });

  it('a cleared session stays cleared once the read cache is dropped (logout is global)', async () => {
    await sessionManager.setSession(userId, 'token-shared');
    await sessionManager.clearSession(userId);
    sessionManager._resetCache();
    expect(await sessionManager.getSessionToken(userId)).toBeUndefined();
    expect(await sessionManager.isActive(userId)).toBe(false);
  });

  describe('null/undefined userId handling', () => {
    it('setSession is a no-op for null/undefined userId', async () => {
      await expect(sessionManager.setSession(null, 'token')).resolves.toBeUndefined();
      await expect(sessionManager.setSession(undefined, 'token')).resolves.toBeUndefined();
      expect(await sessionManager.isActive(null)).toBe(false);
      expect(await sessionManager.isActive(undefined)).toBe(false);
    });

    it('isActive/isTokenValid/getSessionToken return falsy for null/undefined userId', async () => {
      expect(await sessionManager.isActive(null)).toBe(false);
      expect(await sessionManager.isTokenValid(null, 'anything')).toBe(false);
      expect(await sessionManager.getSessionToken(null)).toBeUndefined();
    });

    it('clearSession is a no-op for null/undefined userId (does not throw)', async () => {
      await expect(sessionManager.clearSession(null)).resolves.toBeUndefined();
      await expect(sessionManager.clearSession(undefined)).resolves.toBeUndefined();
    });
  });
});

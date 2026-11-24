const routes = require('express').Router();
const jwt = require('jsonwebtoken');
const Sequelize = require('sequelize');
const Op = Sequelize.Op;
const verify = require('../../functions/tokenVerification')
const { Employees } = require('../../models');
const { Access_Levels } = require("../../functions/Associations/employeeAssociations")

// The token's `access` is what the sidebar reads: the legacy access names,
// including the ones standing for anything granted through the permission
// grid (functions/permissions/grants.js legacyNamesFor). The server never
// reads it - every request is checked against the database.
const makeAccessList = (data, designation) =>
  legacyNamesFor((data || []).map((x) => x.access_name), designation).join(', ');

const { JWT_SECRET } = require('../../functions/secrets');

const sessionManager = require('../../functions/sessionManager');
const { createHistory, getClientIp } = require('../../functions/history');
const { isBcryptHash, hashPassword, verifyPassword } = require('../../functions/password');
const throttle = require('../../functions/loginThrottle');
const systemAccess = require('../../functions/systemAccess');
const { LICENSE_EXEMPT } = require('../../functions/license/config');
const { legacyNamesFor } = require('../../functions/permissions/grants');
const {
  MODULES, ACTIONS, ALIASES, CARRY_TO_CHARGES, SPLIT_INVOICES, SPLIT_UNAPPROVE, INVOICES_MARKERS, CATALOG_MARKER, CHARGES_MARKERS, PERM_PREFIX,
} = require('../../functions/permissions/catalog');
const { LEGACY_BASELINE, grantsFor } = require('../../functions/permissions/grants');
const { isConfigured: archiveConfigured } = require('../../functions/archive/books');

const SESSION_SECONDS = 12 * 60 * 60;
const MIN_PASSWORD_LENGTH = 8;

// '0' / 'false' is how a deactivated employee is stored. Login never looked at
// it, so a deactivated account went on signing in.
const isDeactivated = (active) => ['0', 'false'].includes(String(active ?? '').trim().toLowerCase());

const lockedResponse = (res, minutes) => res.status(429).json({
  message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
});

routes.post('/login', async (req, res) => {
  try {
    const { username, password, force } = req.body;
    const forceLogin = Boolean(force);
    const clientIp = getClientIp(req);

    if (!username || !password) {
      return res.status(400).json({
        message: 'Username and password required',
      });
    }

    const lockMinutes = throttle.lockedFor(clientIp, username);
    if (lockMinutes) return lockedResponse(res, lockMinutes);

    const user = await Employees.unscoped().findOne({
      where: { username },
      include: [
        { model: Access_Levels, attributes: ['access_name'], required: false }
      ],
    });

    if (!user) {
      throttle.recordFailure(clientIp, username);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const validPassword = await verifyPassword(password, user.password);
    if (!validPassword) {
      throttle.recordFailure(clientIp, username);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Support accounts sign in only with a signed credential (/systemLogin).
    // Refused here even with a correct password, so setting your own row's
    // designation to 'system' in the database locks you out instead of in.
    if (String(user.designation || '').toLowerCase() === systemAccess.SYSTEM_DESIGNATION) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (isDeactivated(user.active)) {
      return res.status(403).json({ message: 'This account has been deactivated.' });
    }

    throttle.recordSuccess(clientIp, username);

    // Opportunistic migration: existing rows still hold plaintext passwords.
    // The first time one of those verifies successfully, upgrade it to a
    // bcrypt hash so plaintext never has to be re-compared (or re-stored)
    // again for that account - no bulk migration step needed.
    if (!isBcryptHash(user.password)) {
      await user.update({ password: await hashPassword(password) });
    }

    // ✅ Minimal, efficient payload
    const payload = {
      id: user.id,
      username: user.name,
      designation: user.designation,
      access: makeAccessList(user.Access_Levels, user.designation),
      defaultCompanyId: user.defaultCompanyId,
      // On Seanet's own (exempt) install the admin is the vendor. Read by the
      // screens to show Config; the server decides for itself (systemAccess).
      system: LICENSE_EXEMPT && String(user.designation || '').toLowerCase() === 'admin',
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: SESSION_SECONDS,
    });

    if (await sessionManager.isActive(user.id)) {
      if (!forceLogin) {
        return res.status(409).json({ message: 'User already logged in' });
      }
      await sessionManager.clearSession(user.id);
    }

    // Record session then return token. Awaited: the client is about to start
    // making authenticated calls with this token, and the middleware that
    // checks them reads the same table - returning before the row is committed
    // would race the very next request into a "Session expired" 401.
    await sessionManager.setSession(user.id, token);
    await createHistory(user.id, 'login', `User ${user.username} logged in.`, `IP: ${clientIp}`);
    return res.status(200).json({
      message: 'Success',
      token: 'BearerSplit' + token,
      forceLogin: forceLogin,
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      message: 'Internal server error',
    });
  }
});


// No longer in index.js's PUBLIC_PATHS, so the global `verify` middleware
// already ran before this handler and would have responded 401 itself for
// a missing/invalid/expired token - reaching here means req.user is real.
routes.get("/verifyLogin", (req, res) => {
  res.json({
    isLoggedIn: true,
    username: req.user.username,
    system: systemAccess.isSystem(req),
  });
});

/**
 * Seanet support sign-in, with a credential from the licence server
 * (functions/systemAccess.js explains why it has to be signed elsewhere).
 *
 * The session belongs to a hidden Employees row per support person, so the
 * audit log shows who did what. That row's designation is 'system', which
 * password login refuses, and it has no password. The token itself says
 * designation 'admin' - every screen that already opens for an admin opens for
 * support too - plus the credential, which systemAccess re-verifies.
 */
routes.post('/systemLogin', async (req, res) => {
  const clientIp = getClientIp(req);
  try {
    const lockMinutes = throttle.lockedFor(clientIp, '__system__');
    if (lockMinutes) return lockedResponse(res, lockMinutes);

    const credential = String(req.body?.credential || '').trim();
    const check = systemAccess.verifySupportCredential(credential);
    if (!check.ok) {
      throttle.recordFailure(clientIp, '__system__');
      return res.status(401).json({ message: `Support credential rejected: ${check.reason}.` });
    }
    throttle.recordSuccess(clientIp, '__system__');

    const person = String(check.payload.name || 'Support').trim().slice(0, 60) || 'Support';
    const username = `__system__:${person.toLowerCase()}`;
    let user = await Employees.findOne({ where: { username } });
    if (!user) {
      user = await Employees.create({
        name: `Seanet Support (${person})`,
        username,
        password: null,
        designation: systemAccess.SYSTEM_DESIGNATION,
        // Not '1': every picker and list of staff filters on active '1', and a
        // support login is not staff.
        active: '0',
      });
    }

    // The session ends when the credential does, or after the usual 12 hours.
    const secondsLeft = Math.floor((Number(check.payload.exp) - Date.now()) / 1000);
    const expiresIn = Math.max(60, Math.min(SESSION_SECONDS, secondsLeft));

    const token = jwt.sign({
      id: user.id,
      username: user.name,
      designation: 'admin',
      access: 'admin',
      defaultCompanyId: null,
      system: true,
      sc: credential,
    }, JWT_SECRET, { expiresIn });

    // Always takes over: two Seanet people can share a name in a credential,
    // and a stale support session is never worth a "force login?" prompt.
    await sessionManager.clearSession(user.id);
    await sessionManager.setSession(user.id, token);
    await createHistory(user.id, 'login', `Seanet support (${person}) logged in.`, `IP: ${clientIp}`);

    return res.status(200).json({ message: 'Success', token: 'BearerSplit' + token });
  } catch (err) {
    console.error('System login error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// The permission grid's rows and columns (functions/permissions/catalog.js),
// so the employee screen draws exactly what the server enforces.
routes.get('/permissionCatalog', (req, res) => {
  res.json({
    status: 'success',
    actions: ACTIONS,
    // A module that needs something this install lacks is left out - the
    // Archive where no archive books are set up (catalog.js).
    modules: MODULES
      .filter((m) => m.requires !== 'archive' || archiveConfigured())
      .map(({ key, group, label, actions, modes, legacy }) => ({ key, group, label, actions, modes: modes || null, legacy: legacy || [] })),
    // What older grants still mean (catalog.js) - the grid reads a user's
    // names by the same rules the server enforces them by.
    aliases: ALIASES,
    carryToCharges: CARRY_TO_CHARGES,
    // Job invoices off the charges (2026-10-20) - what an older charges right
    // still covers, and which markers say rows are complete for the charges.
    splitInvoices: SPLIT_INVOICES,
    // Unapprove off Approve (2026-10-24) - an older invoice Approve still
    // stands for it; only the current marker says the rows are complete.
    splitUnapprove: SPLIT_UNAPPROVE,
    invoicesMarkers: INVOICES_MARKERS.map((m) => PERM_PREFIX + m),
    chargesMarkers: CHARGES_MARKERS.map((m) => PERM_PREFIX + m),
    marker: PERM_PREFIX + CATALOG_MARKER,
    baseline: LEGACY_BASELINE,
  });
});

// WHAT THE SIGNED-IN USER MAY DO - for screens that show or hide a part by it
// (a job's Charges tab, the Parties screen's create buttons). The server
// still decides every request; this only keeps the screen from offering what
// would be refused.
routes.get('/myPermissions', async (req, res) => {
  try {
    if (systemAccess.isSystem(req)) return res.json({ status: 'success', result: { all: true, perms: [] } });
    const g = await grantsFor(req.user.id);
    // granular: set through the grid - giving a party a ledger then follows
    // the customer / vendor rights rather than the designation alone.
    res.json({ status: 'success', result: { all: Boolean(g.all), granular: Boolean(g.granular), perms: [...g.perms].sort() } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

// Any signed-in user changing their own password. With users created by
// Seanet, this is how the person the account belongs to stops sharing its
// password with whoever set it up.
routes.post('/changePassword', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (req.user.system) {
      return res.status(400).json({ message: 'Support sessions have no password.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ message: 'The new password must differ from the current one.' });
    }

    const user = await Employees.unscoped().findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    const clientIp = getClientIp(req);
    const lockMinutes = throttle.lockedFor(clientIp, user.username);
    if (lockMinutes) return lockedResponse(res, lockMinutes);

    if (!(await verifyPassword(currentPassword, user.password))) {
      throttle.recordFailure(clientIp, user.username);
      return res.status(400).json({ message: 'The current password is wrong.' });
    }

    await user.update({ password: await hashPassword(newPassword) });
    await createHistory(user.id, 'Employee', 'Change Password', user.name);
    return res.json({ status: 'success' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Logout clears the stored session for the authenticated user
routes.post('/logout', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  await sessionManager.clearSession(req.user.id);
  await createHistory(req.user.id, 'logout', `User ${req.user.username} logged out.`);
  return res.json({ message: 'Logged out' });
});


module.exports = routes;

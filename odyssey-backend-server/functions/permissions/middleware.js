// Enforces the route table (./routeRules.js) on every signed-in request.
//
// MODE (Config > Access, AppSetting 'permissionsMode'):
//   'audit'   (the default) - nothing is refused; what WOULD have been is
//             logged to Permission_Denials. For rolling this out on an install
//             that has run for months without it: watch the log, add the grants
//             people turn out to need, then switch.
//   'enforce' - refused with 403.
// SYSTEM routes are enforced in both modes: the vendor lock is not something
// to audit, and the handlers refuse them anyway.
//
// A route with NO rule is refused in enforce mode (and logged in audit). The
// table is complete - tests/integration/permissionRules.test.js sees to that -
// so this only happens for a route added without one, which should fail
// closed rather than open.

const { LRUCache } = require('lru-cache');
const { ruleFor, OPEN, SYSTEM } = require('./routeRules');
const { grantsFor } = require('./grants');
const { isSystem, MANAGED_MESSAGE } = require('../systemAccess');
const sessionManager = require('../sessionManager');
const companyAccess = require('../companyAccess');
const { setScopeCompany } = require('../fiscalYearContext');

const MODE_KEY = 'permissionsMode';
const MODES = ['audit', 'enforce'];
const DEFAULT_MODE = 'audit';

let db;
const models = () => (db = db || require('../../models'));

let modeCache = { value: null, at: 0 };
const MODE_TTL_MS = 10 * 1000;
let modeOverride = null; // tests

async function getMode() {
  if (modeOverride) return modeOverride;
  if (modeCache.value && Date.now() - modeCache.at < MODE_TTL_MS) return modeCache.value;
  const row = await models().AppSetting.findOne({ where: { key: MODE_KEY } });
  const value = MODES.includes(row?.value) ? row.value : DEFAULT_MODE;
  modeCache = { value, at: Date.now() };
  return value;
}

async function setMode(value) {
  if (!MODES.includes(value)) throw new Error(`mode must be one of ${MODES.join(', ')}`);
  const { AppSetting } = models();
  const [row, created] = await AppSetting.findOrCreate({ where: { key: MODE_KEY }, defaults: { value } });
  if (!created) await row.update({ value });
  modeCache = { value, at: Date.now() };
  return value;
}

// One denial row per user + route, and at most one write a minute for it.
// `part` names the piece of a request an in-route check refused (allowsPart).
const recent = new LRUCache({ max: 20000, ttl: 60 * 1000 });
async function recordDenial(req, required, mode, part = '') {
  const path = part ? `${req.path}#${part}` : req.path;
  const key = `${req.user.id}|${req.method}|${path}`;
  if (recent.get(key)) return;
  recent.set(key, true);
  try {
    const { Permission_Denial, sequelize } = models();
    const values = {
      EmployeeId: req.user.id,
      method: req.method,
      path: path.slice(0, 255),
      required: Array.isArray(required) ? required.join(' | ') : String(required),
      mode,
      lastAt: new Date(),
    };
    const [row, created] = await Permission_Denial.findOrCreate({
      where: { EmployeeId: values.EmployeeId, method: values.method, path: values.path },
      defaults: values,
    });
    if (!created) {
      await row.update({
        count: sequelize.literal('"count" + 1'),
        required: values.required, mode, lastAt: values.lastAt,
      });
    }
  } catch (err) {
    console.error('[permissions] could not log a denial:', err.message);
  }
}

const describe = (alts) => alts.map((a) => a.replace(':', ' - ')).join(', or ');

async function enforcePermissions(req, res, next) {
  // Public paths (login, prints with their own tokens) never get a req.user.
  if (!req.user) return next();
  try {
    const system = isSystem(req);

    // Deactivating someone ends their session within the grants cache's 30
    // seconds - not when their 12-hour token runs out. Logout stays open so
    // the screen can clear itself.
    let grants = null;
    if (!system) {
      grants = await grantsFor(req.user.id);
      if (grants.deactivated && req.path !== '/authRoutes/logout') {
        await sessionManager.clearSession(req.user.id);
        return res.status(401).json({ isLoggedIn: false, message: 'Account deactivated' });
      }
      // A user restricted to some companies may not name any other. Enforced
      // in audit mode too - the restriction exists only because it was set.
      // Their "all" is every company they work in - see widenAll. And the
      // reports scope to them whatever is sent (companyAccess.reportCompanies).
      req.allowedCompanies = grants.companies;
      companyAccess.widenAll(req, grants.companies);
      const companyRefusal = companyAccess.refusal(req, grants.companies);
      if (companyRefusal) return res.status(403).json({ status: 'error', result: companyRefusal });
    }

    const rule = ruleFor(req.method, req.path);

    // The company this request's master lists (accounts, parties, charges...)
    // are scoped to, where Seanet has separated them per company
    // (functions/companySeparation.js). Never on a SYSTEM route: migration and
    // set-up match records across the whole install.
    setScopeCompany(rule === SYSTEM ? null : companyAccess.scopeCompany(req, grants ? grants.companies : null));

    if (rule === OPEN) return next();
    if (rule === SYSTEM) {
      if (system) return next();
      return res.status(403).json({ status: 'error', result: MANAGED_MESSAGE });
    }
    if (system || grants.all) return next();

    const alternatives = typeof rule === 'function' ? await rule(req) : rule;
    if (Array.isArray(alternatives) && alternatives.some((a) => grants.perms.has(a))) return next();

    const mode = await getMode();
    recordDenial(req, alternatives ?? 'no rule for this route', mode);
    if (mode !== 'enforce') return next();
    return res.status(403).json({
      status: 'error',
      result: Array.isArray(alternatives)
        ? `You do not have permission for this. It needs: ${describe(alternatives)}.`
        : 'You do not have permission for this.',
    });
  } catch (err) {
    // Fail closed: a check that could not run cannot say yes.
    console.error('[permissions] check failed:', err);
    return res.status(503).json({ status: 'error', result: 'Permission check unavailable. Try again.' });
  }
}

/**
 * For a request that carries more than one module's work - a customs job's
 * save carries its charge sheet, an aviation job's its consignments' charges.
 * The route table can only say who may make the request; this says whether
 * they may do THIS PART of it. Same rules as the table: Seanet and full
 * access always; refused in enforce mode, logged (and allowed) in audit.
 *
 * @param alternatives  'module:action' strings - any one will do
 * @param part          what the part is, for the denial log ('charges')
 */
async function allowsPart(req, alternatives, part) {
  if (!req.user || isSystem(req)) return true;
  const grants = await grantsFor(req.user.id);
  if (grants.all || alternatives.some((a) => grants.perms.has(a))) return true;
  const mode = await getMode();
  recordDenial(req, alternatives, mode, part);
  return mode !== 'enforce';
}

module.exports = {
  allowsPart,
  MODE_KEY,
  MODES,
  DEFAULT_MODE,
  getMode,
  setMode,
  enforcePermissions,
  _setModeForTest(m) { modeOverride = m; },
  _resetForTest() { recent.clear(); modeCache = { value: null, at: 0 }; },
};

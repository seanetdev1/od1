/* THE HOME PAGE'S WIDGETS - which designation sees which (Configuration >
 * Dashboard Widgets). The user's request, 2026-11-23: "a per user designation
 * dashboard, what designation can see which dashboard widgets".
 *
 * Before it, the page showed all five widgets to anyone with the 'admin'
 * ACCESS level and nothing to anyone else. That was decided on the screen; the
 * routes behind the widgets answered any signed-in user. On CL every user has
 * admin access, so its GD operators saw the accounts.
 *
 * Now (the user's choices, 2026-11-23):
 *  - Per designation only. A user sees the widgets their designation is
 *    ticked for; access levels play no part. A user with no designation, or
 *    one this list does not know, sees none.
 *  - Until an install saves the grid, CEO, CFO and admin see all five and
 *    nobody else sees any.
 *  - Set in Configuration, so only the System login can change it.
 *
 * My calls:
 *  - Seanet's own System login (token flag `system`) sees all five. An exempt
 *    install's admin counts as System for Configuration, but here it is the
 *    admin designation like any other, so unticking admin means it.
 *  - The routes the widgets read from refuse a designation not ticked for them
 *    (requireWidget), whatever the permissions mode - the grid is a setting
 *    someone made on purpose, not a right being audited.
 *  - The Audit Log widget reads the Audit Log report's route, which keeps its
 *    own right. The widget is offered only to a user who also passes that, so
 *    nobody is shown a panel that then refuses them.
 *
 * Stored as one JSON value in AppSettings: { widgetKey: [designations] }. A
 * widget added later reads as its default on an install that saved before it
 * existed.
 */
const { designationGrid, SettingsError, DESIGNATIONS } = require('./designationGrid');

const KEY = 'dashboardWidgets';

// In the order the page lays them out.
const WIDGETS = Object.freeze([
  { key: 'jobCounters', label: 'Job counters', hint: 'The counters at the top: jobs (FCL/LCL), goods declarations and duty on a customs install, or flights and uplift on an airline.' },
  { key: 'incomeExpense', label: 'Income & Expense chart', hint: 'Receipts against payments, month by month for the last 12 months.' },
  { key: 'cashFlow', label: 'Cash Flow chart', hint: 'Receipts less payments, month by month for the last 12 months.' },
  { key: 'pendingInvoices', label: 'Pending Invoices/Bills', hint: 'The most recent unpaid invoices and bills, with the total outstanding.' },
  { key: 'auditLog', label: 'Audit Log', hint: 'The latest changes made in the app. Also needs the Audit Log report right.' },
]);

// The grid itself - defaults, checks, storage - is shared (functions/designationGrid).
const grid = designationGrid({
  key: KEY, rows: WIDGETS, defaultDesignations: ['ceo', 'cfo', 'admin'], noun: 'widget', plural: 'widgets',
});
const WIDGET_KEYS = grid.ROW_KEYS;
const { DEFAULTS, withDefaults, validate, readGrid, writeGrid } = grid;
const widgetsFor = grid.rowsFor;

/* The Audit Log widget reads GET /history/getHistory, which keeps its own rule
 * (the Audit Log report's right). Passes as the route table would let the
 * request through: full access, one of the rule's rights, or audit mode. */
async function passesAuditLogRule(req, grants) {
  if (grants.all) return true;
  const { ruleFor, OPEN } = require('./permissions/routeRules');
  const rule = ruleFor('GET', '/history/getHistory');
  if (rule === OPEN) return true;
  const alternatives = typeof rule === 'function' ? await rule(req) : rule;
  if (Array.isArray(alternatives) && alternatives.some((a) => grants.perms.has(a))) return true;
  const { getMode } = require('./permissions/middleware');
  return (await getMode()) !== 'enforce';
}

/** This request's user's widgets: the System login all, everyone else by designation. */
async function widgetsForRequest(req) {
  if (!req?.user) return [];
  if (req.user.system === true) return [...WIDGET_KEYS];
  const { grantsFor } = require('./permissions/grants');
  const grants = await grantsFor(req.user.id);
  // The designation as the database has it now, not as the 12-hour token was
  // signed with: a changed designation counts within the grants cache's 30 s.
  const mine = widgetsFor(grants.designation, await readGrid());
  if (!mine.includes('auditLog') || await passesAuditLogRule(req, grants)) return mine;
  return mine.filter((k) => k !== 'auditLog');
}

const REFUSAL = 'Your designation is not set to see this on the dashboard (Configuration > Dashboard Widgets).';

/** Route guard: the user must see at least one of `keys`. */
const requireWidget = (...keys) => async (req, res, next) => {
  try {
    const mine = await widgetsForRequest(req);
    if (keys.some((k) => mine.includes(k))) return next();
    return res.status(403).json({ status: 'error', result: REFUSAL });
  } catch (err) {
    // Fail closed, as the permission check does.
    console.error('[dashboardWidgets] check failed:', err);
    return res.status(503).json({ status: 'error', result: 'Permission check unavailable. Try again.' });
  }
};

module.exports = {
  KEY, WIDGETS, WIDGET_KEYS, DEFAULTS, DESIGNATIONS, SettingsError, REFUSAL,
  withDefaults, validate, readGrid, writeGrid, widgetsFor, widgetsForRequest, requireWidget,
};

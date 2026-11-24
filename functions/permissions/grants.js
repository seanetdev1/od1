// WHAT A USER HAS BEEN GRANTED, as 'module:action' strings.
//
// Read from the database (Access_Levels + the employee's designation and
// active flag), not from the session token: the token is signed at login and
// lives 12 hours, so a revoked permission or a deactivated user would carry on
// until it expired. A short cache keeps this off the database for every
// request; editing an employee clears that employee's entry at once.

const { LRUCache } = require('lru-cache');
const {
  MODULES, PERM_PREFIX, permName, byKey, ALIASES, CARRY_TO_CHARGES, SPLIT_INVOICES, SPLIT_UNAPPROVE, CATALOG_MARKER,
  CHARGES_MARKERS, INVOICES_MARKERS, PARTY_MODULES,
} = require('./catalog');

const CACHE_TTL_MS = Number(process.env.PERMISSION_CACHE_TTL_MS ?? 30 * 1000);
const cache = CACHE_TTL_MS > 0 ? new LRUCache({ max: 5000, ttl: CACHE_TTL_MS }) : null;

// legacy name -> 'module:action' for every action on every module it maps to
const LEGACY = {};
for (const m of MODULES) {
  for (const name of m.legacy || []) {
    LEGACY[name] = LEGACY[name] || [];
    for (const a of m.actions) LEGACY[name].push(`${m.key}:${a}`);
  }
}

// What every user could do before permissions were enforced, beyond their
// access levels: create and edit parties (a deliberate decision - the Parties
// screen is open to all) - every kind of party, now that they are three. Kept
// for anyone still on legacy names only; a user saved through the permission
// grid gets exactly what is ticked there. Giving a party a LEDGER is a
// further gate (routes/clients canCreateLedger).
const LEGACY_BASELINE = PARTY_MODULES.flatMap((m) => [`${m}:view`, `${m}:edit`]);

// 'module:action', with a split module's grant standing for each of its parts.
const withAliases = (perm) => {
  const [module, action] = perm.split(':');
  return ALIASES[module] ? ALIASES[module].map((m) => `${m}:${action}`) : [perm];
};

const isDeactivated = (active) => ['0', 'false'].includes(String(active ?? '').trim().toLowerCase());

/**
 * Expand stored access names into grants.
 * @returns {{ all: boolean, perms: Set<string> }}
 */
function expand(names, designation) {
  const list = (names || []).map((n) => String(n || '').trim()).filter(Boolean);
  const all = list.includes('admin') || String(designation || '').toLowerCase() === 'admin';
  const perms = new Set();
  const granular = list.some((n) => n.startsWith(PERM_PREFIX));
  // Which carries the rows are already complete for - see catalog.js.
  const markers = new Set([...CHARGES_MARKERS, ...INVOICES_MARKERS, CATALOG_MARKER].map((m) => PERM_PREFIX + m));
  const chargesComplete = CHARGES_MARKERS.some((m) => list.includes(PERM_PREFIX + m));
  const invoicesComplete = INVOICES_MARKERS.some((m) => list.includes(PERM_PREFIX + m));
  const unapproveComplete = list.includes(PERM_PREFIX + CATALOG_MARKER);
  for (const n of list) {
    if (markers.has(n)) continue;
    if (n.startsWith(PERM_PREFIX)) withAliases(n.slice(PERM_PREFIX.length)).forEach((p) => perms.add(p));
    else (LEGACY[n] || []).forEach((p) => perms.add(p));
  }
  if (granular && !chargesComplete) {
    // Rows from before job charges had a module of their own: the job rights
    // covered them, so they still do until this user is saved again.
    const chargeActions = CARRY_TO_CHARGES.actions || byKey[CARRY_TO_CHARGES.to].actions;
    for (const p of [...perms]) {
      const [module, action] = p.split(':');
      if (CARRY_TO_CHARGES.from.includes(module) && chargeActions.includes(action)) {
        perms.add(`${CARRY_TO_CHARGES.to}:${action}`);
      }
    }
  }
  if (granular && !invoicesComplete) {
    // Rows from before the invoices came off the charges: the charges rights
    // covered them, so they still do until this user is saved again.
    for (const p of [...perms]) {
      const [module, action] = p.split(':');
      if (module !== SPLIT_INVOICES.from) continue;
      for (const to of SPLIT_INVOICES.actions[action] || []) perms.add(`${SPLIT_INVOICES.to}:${to}`);
    }
  }
  if (granular && !unapproveComplete) {
    // Rows from before Unapprove came off Approve (2026-10-24): an invoice
    // Approve took the approval back too, so it still does until this user is
    // saved again. After the carry above, so an older charges Approve - which
    // covered the invoices - reaches it as well.
    for (const p of [...perms]) {
      const [module, action] = p.split(':');
      if (action === SPLIT_UNAPPROVE.from && SPLIT_UNAPPROVE.modules.includes(module)) perms.add(`${module}:${SPLIT_UNAPPROVE.to}`);
    }
  }
  if (!granular) LEGACY_BASELINE.forEach((p) => perms.add(p));
  return { all, perms, granular };
}

/**
 * The legacy names the sidebar reads from the token's `access`, for whatever
 * the user can at least view - so a user granted through the new grid sees
 * the same menu as one granted the old way. Granular names are kept too.
 */
function legacyNamesFor(names, designation) {
  const { all, perms } = expand(names, designation);
  const out = new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean));
  if (all) out.add('admin');
  for (const m of MODULES) {
    if (m.actions.some((a) => perms.has(`${m.key}:${a}`))) (m.menu || m.legacy || []).forEach((n) => out.add(n));
  }
  return [...out];
}

/**
 * Rewrite a list of access names as 'perm:' names only (plus 'admin' when
 * present), with the catalog marker. What the permission grid saves.
 *
 * `fromGrid`: the names are the grid's boxes as ticked now - complete as they
 * stand, so nothing is carried over from the job rights (CATALOG_MARKER).
 */
function toGranularNames(names, designation, { fromGrid = false } = {}) {
  const list = [...(names || [])];
  if (fromGrid) list.push(PERM_PREFIX + CATALOG_MARKER);
  const { perms } = expand(list, designation);
  // Only boxes the grid has: a carry can name one a module no longer offers
  // (jobCharges:delete, now jobInvoices').
  const out = [...perms]
    .filter((p) => { const [m, a] = p.split(':'); return byKey[m]?.actions.includes(a); })
    .map((p) => `${PERM_PREFIX}${p}`).sort();
  out.push(PERM_PREFIX + CATALOG_MARKER);
  // Only the stored 'admin' name - an admin DESIGNATION is not a grant.
  return (names || []).includes('admin') ? ['admin', ...out] : out;
}

let db; // required lazily: models pull in half the app
async function load(userId) {
  db = db || require('../../models');
  const employee = await db.Employees.findByPk(userId, { attributes: ['id', 'designation', 'active'] });
  if (!employee) return { all: false, perms: new Set(), deactivated: true, companies: new Set() };
  const rows = await db.Access_Levels.findAll({ where: { EmployeeId: userId }, attributes: ['access_name'] });
  const g = expand(rows.map((r) => r.access_name), employee.designation);
  g.deactivated = isDeactivated(employee.active) && String(employee.designation || '').toLowerCase() !== 'system';
  // As stored now - the dashboard's widgets go by it (functions/dashboardWidgets).
  g.designation = employee.designation || null;
  // The companies they may work in (functions/companyAccess.js): null = all.
  const companies = await db.Employee_Company.findAll({ where: { EmployeeId: userId }, attributes: ['CompanyId'] });
  g.companies = companies.length ? new Set(companies.map((c) => String(c.CompanyId))) : null;
  return g;
}

/** Grants for a user id, cached. */
async function grantsFor(userId) {
  const key = String(userId);
  const hit = cache && cache.get(key);
  if (hit) return hit;
  const g = await load(userId);
  if (cache) cache.set(key, g);
  return g;
}

function invalidate(userId) {
  if (cache) cache.delete(String(userId));
}

module.exports = {
  LEGACY,
  LEGACY_BASELINE,
  expand,
  legacyNamesFor,
  toGranularNames,
  grantsFor,
  invalidate,
  permName,
  _resetCache() { if (cache) cache.clear(); },
};

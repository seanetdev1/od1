/**
 * The permission grid's model: a user's stored access names <-> ticked boxes.
 *
 * Mirrors functions/permissions/grants.js on the backend, which is what
 * actually decides - this only has to show the same thing it will enforce:
 *   'perm:<module>:<action>'  one box,
 *   a legacy name ('ExSea')   every action of the module(s) it maps to,
 *   'admin'                   everything.
 * A user still on legacy names only also has party view + edit, which every
 * user had before permissions existed - shown ticked, so saving keeps it
 * unless someone unticks it.
 *
 * The catalog is GET /authRoutes/permissionCatalog: { actions, modules } and
 * the rules for older grants (2026-10-10, when job charges got a module of
 * their own and Parties split into Non-GL, Customers and Vendors):
 *   aliases         a split module's grant is a grant of each part
 *   carryToCharges  rows saved before then: job rights also cover charges
 *   splitInvoices   rows saved before 2026-10-20, when job invoices came off
 *                   job charges: a charges right also covers its invoices share
 *   splitUnapprove  rows saved before 2026-10-24, when Unapprove came off
 *                   Approve: an invoice Approve also stands for Unapprove
 *   chargesMarkers  markers that say rows are complete for carryToCharges
 *   invoicesMarkers markers that say rows are complete for splitInvoices
 *   marker          written with every save - the rows are complete as they stand
 *   baseline        what a user on legacy names only has besides
 */

const PREFIX = 'perm:';
// Before the catalog said so itself.
const DEFAULT_BASELINE = ['parties:view', 'parties:edit'];

/** Modules that apply to an operation mode ('freight' | 'customs' | 'aviation'). */
export const modulesFor = (catalog, mode) =>
  (catalog?.modules || []).filter((m) => !m.modes || m.modes.includes(mode));

/** Stored names -> { admin, perms: Set('module:action') } */
export function expandNames(names = [], catalog) {
  const list = (names || []).map((n) => String(n || '').trim()).filter(Boolean);
  const perms = new Set();
  const legacy = {};
  for (const m of catalog?.modules || []) {
    for (const n of m.legacy || []) {
      legacy[n] = legacy[n] || [];
      m.actions.forEach((a) => legacy[n].push(`${m.key}:${a}`));
    }
  }
  const aliases = catalog?.aliases || {};
  const add = (p) => {
    const [module, action] = p.split(':');
    (aliases[module] ? aliases[module].map((m) => `${m}:${action}`) : [p]).forEach((x) => perms.add(x));
  };
  const marker = catalog?.marker;
  const granular = list.some((n) => n.startsWith(PREFIX));
  // Which carries the rows are complete for: the current marker covers both;
  // an older one (catalog:2) only the job rights -> charges one.
  const chargesMarkers = catalog?.chargesMarkers || (marker ? [marker] : []);
  // Complete for the invoices split: catalog:3 and after. Before the server
  // said so, only the current marker.
  const invoicesMarkers = catalog?.invoicesMarkers || (marker ? [marker] : []);
  const markers = new Set([marker, ...chargesMarkers, ...invoicesMarkers].filter(Boolean));
  const chargesComplete = chargesMarkers.some((m) => list.includes(m));
  const invoicesComplete = invoicesMarkers.some((m) => list.includes(m));
  // Complete for Unapprove off Approve (2026-10-24): the current marker only.
  const unapproveComplete = Boolean(marker) && list.includes(marker);
  for (const n of list) {
    if (markers.has(n)) continue;
    if (n.startsWith(PREFIX)) add(n.slice(PREFIX.length));
    else (legacy[n] || []).forEach((p) => perms.add(p));
  }
  const carry = catalog?.carryToCharges;
  if (granular && !chargesComplete && carry) {
    const chargeActions = carry.actions || (catalog.modules || []).find((m) => m.key === carry.to)?.actions || [];
    for (const p of [...perms]) {
      const [module, action] = p.split(':');
      if (carry.from.includes(module) && chargeActions.includes(action)) perms.add(`${carry.to}:${action}`);
    }
  }
  // Job invoices came off job charges (2026-10-20): an older charges right
  // still stands for its share of the invoices until the user is saved again.
  const split = catalog?.splitInvoices;
  if (granular && !invoicesComplete && split) {
    for (const p of [...perms]) {
      const [module, action] = p.split(':');
      if (module !== split.from) continue;
      (split.actions?.[action] || []).forEach((to) => perms.add(`${split.to}:${to}`));
    }
  }
  // Unapprove came off Approve (2026-10-24): an older invoice Approve still
  // takes the approval back too, until the user is saved again.
  const unapprove = catalog?.splitUnapprove;
  if (granular && !unapproveComplete && unapprove) {
    for (const p of [...perms]) {
      const [module, action] = p.split(':');
      if (action === unapprove.from && unapprove.modules.includes(module)) perms.add(`${module}:${unapprove.to}`);
    }
  }
  if (!granular) (catalog?.baseline || DEFAULT_BASELINE).forEach((p) => perms.add(p));
  return { admin: list.includes('admin'), perms };
}

/** { admin, perms } -> the names to save. Modules outside the mode are dropped.
 *  With the catalog's marker: the rows are complete as they stand. */
export function toNames({ admin, perms }, catalog, mode) {
  const allowed = new Set(modulesFor(catalog, mode).flatMap((m) => m.actions.map((a) => `${m.key}:${a}`)));
  const out = [...perms].filter((p) => allowed.has(p)).sort().map((p) => PREFIX + p);
  if (catalog?.marker) out.push(catalog.marker);
  return admin ? ['admin', ...out] : out;
}

/**
 * Tick or untick one box. Any action implies view (you cannot approve what
 * you cannot open), so ticking one ticks view, and unticking view clears the
 * row.
 */
export function toggle(perms, moduleKey, action, on) {
  const next = new Set(perms);
  const key = `${moduleKey}:${action}`;
  if (on) {
    next.add(key);
    next.add(`${moduleKey}:view`);
  } else if (action === 'view') {
    [...next].filter((p) => p.startsWith(`${moduleKey}:`)).forEach((p) => next.delete(p));
  } else {
    next.delete(key);
  }
  return next;
}

/** Tick every action of a module, or none. */
export function setRow(perms, module, on) {
  const next = new Set(perms);
  module.actions.forEach((a) => (on ? next.add(`${module.key}:${a}`) : next.delete(`${module.key}:${a}`)));
  return next;
}

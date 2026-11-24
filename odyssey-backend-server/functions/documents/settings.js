/**
 * DOCUMENTS' SETTINGS - Configuration > Documents (the user's requests,
 * 2026-11-13):
 *
 *   WHERE THEY ARE KEPT. A folder chosen in Configuration, not in a file on
 *   the server. Until one is chosen no document can be attached. It can be
 *   changed later: a document's row holds only where it is INSIDE the folder
 *   (2026/11/<uuid>.pdf), so after moving the files and choosing the new
 *   folder every document is found there and nothing points at the old one.
 *
 *   Odyssey runs in a container, which sees only the server folders its
 *   compose file mounts - ODYSSEY_DOCUMENTS_ROOTS lists them (the kits mount
 *   the server's /mnt, where extra drives go, at the same path, and a volume
 *   at /documents). The folder must be inside one of them.
 *
 *   THE TYPES a document is attached as - Invoice, Bill of Lading, ... - a
 *   list Configuration edits. A type ticked "Shown on the job's invoices" is
 *   how a scan attached to a JOB as an invoice appears on that job's invoices
 *   too. A type has a number that never changes, so renaming it renames it on
 *   every document; one in use is never removed - it is retired (unticked
 *   Offered) and stays on the documents that have it.
 */

const path = require('path');

const PATH_KEY = 'documentsPath';
const TYPES_KEY = 'documentTypes';

// Where a fresh install starts - Configuration changes it.
const DEFAULT_TYPES = [
  { id: 1, name: 'Invoice', onInvoices: true, offered: true },
  { id: 2, name: 'Bill of Lading', onInvoices: false, offered: true },
  { id: 3, name: 'Air Waybill', onInvoices: false, offered: true },
  { id: 4, name: 'Goods Declaration', onInvoices: false, offered: true },
  { id: 5, name: 'Packing List', onInvoices: false, offered: true },
  { id: 6, name: 'Receipt', onInvoices: false, offered: true },
  { id: 7, name: 'Other', onInvoices: false, offered: true },
];

let db;
const models = () => (db = db || require('../../models'));

// Read on every upload and every file served, by every worker - so held a few
// seconds, and dropped at once by a change made through this worker.
const TTL_MS = 10 * 1000;
const cache = new Map();
async function read(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const row = await models().AppSetting.findOne({ where: { key } });
  const value = row ? row.value : null;
  cache.set(key, { value, at: Date.now() });
  return value;
}
async function write(key, value, transaction) {
  const { AppSetting } = models();
  const [row, created] = await AppSetting.findOrCreate({ where: { key }, defaults: { value }, transaction });
  if (!created) await row.update({ value }, { transaction });
  cache.delete(key);
}
const forget = () => cache.clear();

/* ------------------------------------------------------------------ folder */

/** The folders a documents folder may be chosen inside. */
function allowedRoots() {
  const raw = process.env.ODYSSEY_DOCUMENTS_ROOTS;
  const list = raw ? raw.split(',') : ['/documents', '/mnt', '/media', '/srv'];
  return [...new Set(list.map((r) => r.trim()).filter(Boolean).map((r) => path.resolve(r)))];
}

/** Is `p` one of the roots, or inside one? */
function insideRoots(p) {
  return allowedRoots().some((root) => {
    const rel = path.relative(root, p);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

/** The folder documents are kept in, or null when none has been chosen. */
async function getPath() {
  const value = await read(PATH_KEY);
  return value ? String(value) : null;
}

const setPath = (value, transaction) => write(PATH_KEY, value, transaction);

/* ------------------------------------------------------------------- types */

/** A stored list as it should be: ids kept, names trimmed, flags booleans. */
function normalizeTypes(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  }
  const types = Array.isArray(parsed?.types) ? parsed.types : null;
  if (!types) return { types: DEFAULT_TYPES.map((t) => ({ ...t })), nextId: DEFAULT_TYPES.length + 1 };
  const list = types
    .filter((t) => Number.isInteger(Number(t?.id)) && String(t?.name || '').trim())
    .map((t) => ({ id: Number(t.id), name: String(t.name).trim(), onInvoices: Boolean(t.onInvoices), offered: t.offered !== false }));
  const highest = Math.max(0, ...list.map((t) => t.id));
  return { types: list, nextId: Math.max(Number(parsed.nextId) || 0, highest + 1) };
}

/** { types: [{ id, name, onInvoices, offered }], nextId } - in the order they are offered. */
async function getTypes() {
  return normalizeTypes(await read(TYPES_KEY));
}

class TypesError extends Error {}

/**
 * Check a list from the Configuration screen against the one stored, and give
 * the list to store. A type without an id is new and gets the next number;
 * one with an id keeps it, whatever its name becomes.
 *
 * @param incoming  [{ id?, name, onInvoices, offered }]
 * @param inUse     Map typeId -> how many documents have it
 */
function mergeTypes(stored, incoming, inUse = new Map()) {
  if (!Array.isArray(incoming)) throw new TypesError('No list of types was sent.');
  let nextId = stored.nextId;
  const known = new Map(stored.types.map((t) => [t.id, t]));
  const out = incoming.map((t) => {
    const name = String(t?.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new TypesError('Every type needs a name.');
    if (name.length > 60) throw new TypesError(`"${name.slice(0, 20)}..." is too long - 60 characters at most.`);
    const id = t?.id != null && known.has(Number(t.id)) ? Number(t.id) : nextId++;
    return { id, name, onInvoices: Boolean(t?.onInvoices), offered: t?.offered !== false };
  });
  const seen = new Set();
  for (const t of out) {
    const k = t.name.toLowerCase();
    if (seen.has(k)) throw new TypesError(`There are two types called "${t.name}".`);
    seen.add(k);
  }
  const kept = new Set(out.map((t) => t.id));
  for (const t of stored.types) {
    const n = inUse.get(t.id) || 0;
    if (!kept.has(t.id) && n > 0) {
      throw new TypesError(`"${t.name}" is on ${n} document${n === 1 ? '' : 's'}, so it cannot be removed - untick Offered to retire it instead.`);
    }
  }
  if (!out.some((t) => t.offered)) throw new TypesError('At least one type must be offered, or nothing could be attached.');
  return { types: out, nextId };
}

const saveTypes = (value, transaction) => write(TYPES_KEY, JSON.stringify(value), transaction);

module.exports = {
  PATH_KEY, TYPES_KEY, DEFAULT_TYPES, TypesError,
  allowedRoots, insideRoots, getPath, setPath, getTypes, normalizeTypes, mergeTypes, saveTypes, forget,
};

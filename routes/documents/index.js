/**
 * DOCUMENTS ATTACHED TO RECORDS - scans on jobs, vouchers, invoices, Direct
 * Jobs (the user's requests, 2026-11-13). One set of routes for every kind of
 * record: the request names the kind (`entity`, a model name in
 * functions/documents/kinds.js) and the record's id.
 *
 *   GET  /documents?entity=&recordId=    a record's documents, newest first,
 *                                        and what this user may do with them.
 *                                        An invoice's include its job's of a
 *                                        type "Shown on the job's invoices".
 *   POST /documents/upload?entity=&recordId=&typeId=&name=
 *                                        attach one file - the request body IS
 *                                        the file (any content type but JSON),
 *                                        streamed to disk, never held whole
 *   GET  /documents/:id/link             a short-lived URL that opens it;
 *                                        ?entity=&recordId= is the record it
 *                                        is being opened from (an invoice,
 *                                        for its job's invoice scan)
 *   GET  /documents/file?t=              the file, for that URL - no login
 *                                        header (a browser tab, an <img>), so
 *                                        public, and gated by the token
 *   POST /documents/:id/rename           give it a name of its own, or take
 *                                        it away (the file's name again)
 *   POST /documents/:id/delete           remove one (marked, file kept)
 *
 * A document is shown by the name it was given - "Invoice JI-123/27" - and
 * the file's own name (scan020.pdf) under it; it downloads as its name.
 *
 * Configuration > Documents (Seanet):
 *   GET  /documents/types                the types, and how many documents
 *                                        have each - any signed-in user reads
 *                                        them, for the dropdown
 *   POST /documents/types                save the list
 *   GET  /documents/settings             the folder, and how it stands
 *   GET  /documents/settings/browse?path=   the folders inside one, to pick from
 *   POST /documents/settings/path        choose the folder
 *
 * One file per upload, so the screen shows each one's progress and a refused
 * file does not take the others with it. The limit, the types of file and the
 * store are functions/documents/store.js; who may do what, ./access.js; the
 * folder and the document types, ./settings.js.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const routes = require('express').Router();
const db = require('../../models');
const store = require('../../functions/documents/store');
const settings = require('../../functions/documents/settings');
const { kindOf } = require('../../functions/documents/kinds');
const { findRecord, check, rightsFor } = require('../../functions/documents/access');
const { signDocumentToken, verifyDocumentToken } = require('../../functions/printToken');
const { createHistory } = require('../../functions/history');
const { requireSystem } = require('../../functions/systemAccess');

const { Document, Employees } = db;
const { DocumentError } = store;

const LIMITS = { maxBytes: store.MAX_BYTES, extensions: store.EXTENSIONS };
const NEWEST_FIRST = [['createdAt', 'DESC'], ['id', 'DESC']];

const shape = (d, typeById, from = null) => ({
  id: d.id,
  // The name it was given, else the file's.
  name: d.title || d.originalName,
  title: d.title || null,
  fileName: d.originalName,
  size: d.size,
  mimeType: d.mimeType,
  view: store.viewOf(d.originalName),
  typeId: d.typeId ?? null,
  type: typeById.get(d.typeId)?.name || null,
  uploadedBy: d.uploadedBy,
  uploadedAt: d.createdAt,
  // On another record, shown here: { entity, recordId, label }. Opened from
  // here; removed only there.
  from,
});

/* An upload refused before its body was read - too big, wrong type, no right
 * - is read to its end first, keeping nothing, and only then answered: Node
 * closes a connection whose request is still arriving when the answer goes,
 * and the screen would see only that it dropped, not why. The screen checks
 * the size and type before sending, so this is rarely more than a moment; a
 * sender going on far past the limit is cut off. */
function drain(req) {
  if (req.complete || req.readableEnded || req.destroyed) return Promise.resolve();
  return new Promise((done) => {
    let read = 0;
    req.on('data', (chunk) => {
      read += chunk.length;
      if (read > 2 * store.MAX_BYTES) { req.destroy(); done(); }
    });
    req.on('end', done);
    req.on('close', done);
    req.on('error', done);
    req.resume();
  });
}

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    await drain(req);
    if (err instanceof DocumentError) return res.status(err.status).json({ status: 'error', result: err.message });
    if (err instanceof settings.TypesError) return res.status(400).json({ status: 'error', result: err.message });
    console.error('[documents]', err);
    return res.status(500).json({ status: 'error', result: 'Something went wrong with the documents. Try again.' });
  }
};

const DOCUMENT_ID = /^\d{1,15}$/;
async function findDocument(id) {
  if (!DOCUMENT_ID.test(String(id))) throw new DocumentError(404, 'No such document.');
  const doc = await Document.findByPk(id);
  if (!doc) throw new DocumentError(404, 'That document has been removed.');
  return doc;
}

async function personOf(req) {
  const person = await Employees.findByPk(req.user.id, { attributes: ['name', 'username'], raw: true }).catch(() => null);
  return (person && (person.name || person.username)) || null;
}

const labelOf = ({ kind, record, recordId }) => `${kind.label} ${record[kind.number] || `#${recordId}`}`;
// "Job SE-101/26: GD scan.pdf" - what the audit log shows.
const describe = (target, name) => `${labelOf(target)}: ${name}`.slice(0, 255);

const typeIndex = async () => {
  const { types } = await settings.getTypes();
  return { types, byId: new Map(types.map((t) => [t.id, t])) };
};

/* THE JOB'S DOCUMENTS ON ITS INVOICES. An invoice shows, beside its own, the
 * documents on the job it was raised on whose type is ticked "Shown on the
 * job's invoices" - an invoice scanned onto the job (the user's request). */
async function parentShown(target, types) {
  if (!target.kind.parent) return null;
  const typeIds = types.filter((t) => t.onInvoices).map((t) => t.id);
  if (!typeIds.length) return null;
  const parent = await target.kind.parent(target.recordId);
  const kind = parent && kindOf(parent.entity);
  if (!kind) return null;
  const record = await db[kind.model].findByPk(parent.recordId, { attributes: kind.attributes, raw: true });
  if (!record) return null;
  return { ...parent, kind, record, typeIds };
}

/** Is `doc` shown on `target` because it is on the job `target` was raised on? */
async function shownVia(target, doc) {
  const { types } = await typeIndex();
  const parent = await parentShown(target, types);
  return Boolean(parent && parent.entity === doc.entity && parent.recordId === doc.recordId && parent.typeIds.includes(doc.typeId));
}

/* ---------------------------------------------------------------- records */

routes.get('/', handle(async (req, res) => {
  const target = await findRecord(req.query.entity, req.query.recordId);
  await check(req, target, 'view');
  const { types, byId } = await typeIndex();
  const own = await Document.findAll({ where: { entity: target.entity, recordId: target.recordId }, order: NEWEST_FIRST });
  const result = own.map((d) => shape(d, byId));

  const parent = await parentShown(target, types);
  if (parent) {
    const from = { entity: parent.entity, recordId: parent.recordId, label: labelOf(parent) };
    const shown = await Document.findAll({
      where: { entity: parent.entity, recordId: parent.recordId, typeId: parent.typeIds },
      order: NEWEST_FIRST,
    });
    result.push(...shown.map((d) => shape(d, byId, from)));
    result.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt) || b.id - a.id);
  }
  res.json({
    status: 'success',
    result,
    rights: await rightsFor(req, target),
    types: types.filter((t) => t.offered).map(({ id, name }) => ({ id, name })),
    limits: LIMITS,
    ready: Boolean(await settings.getPath()),
  });
}));

routes.post('/upload', handle(async (req, res) => {
  const target = await findRecord(req.query.entity, req.query.recordId);
  await check(req, target, 'add');
  // The name says the type of file: refuse a wrong one before reading a byte.
  const name = store.displayName(req.query.name);
  if (!name) throw new DocumentError(400, 'The file has no name.');
  store.typeOf(name);
  const { byId } = await typeIndex();
  const docType = byId.get(Number(req.query.typeId));
  if (!docType || !docType.offered) throw new DocumentError(400, 'Pick what the document is - its type - first.');
  const title = store.cleanTitle(req.query.title) || null;
  const dir = await settings.getPath();
  await store.ready(dir);

  const saved = await store.receive(req, { dir, name: req.query.name, declaredLength: req.headers['content-length'] });
  let row;
  try {
    const same = await Document.findOne({
      where: { entity: target.entity, recordId: target.recordId, sha256: saved.sha256 },
      attributes: ['originalName', 'title'],
    });
    if (same) throw new DocumentError(409, `This file is already attached here, as "${same.title || same.originalName}".`);
    row = await Document.create({
      entity: target.entity,
      recordId: target.recordId,
      originalName: saved.originalName,
      storedName: saved.storedName,
      mimeType: saved.mimeType,
      size: saved.size,
      sha256: saved.sha256,
      typeId: docType.id,
      title,
      uploadedById: req.user.id,
      uploadedBy: await personOf(req),
    });
  } catch (err) {
    await store.discard(saved.storedName, dir);
    throw err;
  }
  await createHistory(req.user.id, 'Documents', 'Attached', describe(target, `${row.title || row.originalName} (${docType.name})`));
  res.status(201).json({ status: 'success', result: shape(row, byId) });
}));

// Public (index.js PUBLIC_PATHS): the token is the permission. Answers in
// plain text - it is read in a browser tab, not by the screen.
routes.get('/file', handle(async (req, res) => {
  let id;
  try {
    id = verifyDocumentToken(req.query.t);
  } catch (_) {
    return res.status(403).type('text/plain').send('This link has expired. Open the document again from Odyssey.');
  }
  const doc = await Document.findByPk(id);
  if (!doc) return res.status(404).type('text/plain').send('This document has been removed.');
  const dir = await settings.getPath();
  if (!dir || !(await store.exists(doc.storedName, dir))) {
    console.error(`[documents] document ${doc.id}'s file ${doc.storedName} is missing from ${dir || '(no folder set)'}`);
    return res.status(404).type('text/plain').send("This document's file is missing from the server's documents folder.");
  }
  const { mime } = store.typeOf(doc.originalName);
  const shown = store.viewOf(doc.originalName) !== 'download' && !req.query.download;
  res.set({
    'Content-Type': mime,
    'Content-Disposition': disposition(shown ? 'inline' : 'attachment', store.downloadName(doc.title, doc.originalName)),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'private, max-age=600',
    // An <img> on the screens' own origin (another port) may show it.
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  // `root`: only the stored name is checked for dot-folders, not wherever the
  // install keeps its documents.
  res.sendFile(doc.storedName, { root: dir, cacheControl: false }, (err) => {
    if (err && !res.headersSent) res.status(404).type('text/plain').send("This document's file could not be read.");
  });
}));

routes.get('/:id/link', handle(async (req, res) => {
  const doc = await findDocument(req.params.id);
  // Opened from an invoice, a document on its job is the invoice's to show.
  let via = null;
  if (req.query.entity && !(req.query.entity === doc.entity && String(req.query.recordId) === doc.recordId)) {
    const from = await findRecord(req.query.entity, req.query.recordId);
    if (await shownVia(from, doc)) via = from;
  }
  await check(req, via || await findRecord(doc.entity, doc.recordId), 'view');
  res.json({
    status: 'success',
    result: { url: `/documents/file?t=${encodeURIComponent(signDocumentToken(doc.id))}`, view: store.viewOf(doc.originalName), name: doc.title || doc.originalName },
  });
}));

// Naming is part of attaching: the record's Create & edit right, on the
// record the document is on (not one it is only shown on).
routes.post('/:id/rename', handle(async (req, res) => {
  const doc = await findDocument(req.params.id);
  const target = await findRecord(doc.entity, doc.recordId);
  await check(req, target, 'add');
  const before = doc.title || doc.originalName;
  await doc.update({ title: store.cleanTitle(req.body?.title) || null });
  await createHistory(req.user.id, 'Documents', 'Renamed', describe(target, `${before} -> ${doc.title || doc.originalName}`));
  const { byId } = await typeIndex();
  res.json({ status: 'success', result: shape(doc, byId) });
}));

routes.post('/:id/delete', handle(async (req, res) => {
  const doc = await findDocument(req.params.id);
  const target = await findRecord(doc.entity, doc.recordId);
  await check(req, target, 'delete');
  await doc.update({ deletedById: req.user.id, deletedBy: await personOf(req) });
  await doc.destroy();
  await createHistory(req.user.id, 'Documents', 'Removed', describe(target, doc.title || doc.originalName));
  res.json({ status: 'success', result: doc.id });
}));

/* ------------------------------------------------------- Configuration */

async function typesInUse() {
  const rows = await Document.findAll({
    paranoid: false, // a removed document can be put back, with its type
    attributes: ['typeId', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'n']],
    group: ['typeId'],
    raw: true,
  });
  return new Map(rows.filter((r) => r.typeId != null).map((r) => [Number(r.typeId), Number(r.n)]));
}

routes.get('/types', handle(async (req, res) => {
  const { types } = await settings.getTypes();
  res.json({ status: 'success', result: types, inUse: Object.fromEntries(await typesInUse()) });
}));

routes.post('/types', requireSystem, handle(async (req, res) => {
  const inUse = await typesInUse();
  const merged = settings.mergeTypes(await settings.getTypes(), req.body?.types, inUse);
  await settings.saveTypes(merged);
  await createHistory(req.user.id, 'Configuration', 'Document types', merged.types.map((t) => t.name).join(', ').slice(0, 255));
  res.json({ status: 'success', result: merged.types, inUse: Object.fromEntries(inUse) });
}));

async function folderState(dir) {
  if (!dir) return null;
  let stat = null;
  try { stat = await fsp.stat(dir); } catch (_) { /* not there */ }
  const exists = Boolean(stat && stat.isDirectory());
  const marked = exists && fs.existsSync(path.join(dir, store.MARKER));
  return { exists, marked, ...(exists ? (await store.space(dir)) || {} : {}) };
}

routes.get('/settings', requireSystem, handle(async (req, res) => {
  const dir = await settings.getPath();
  res.json({
    status: 'success',
    result: {
      path: dir,
      roots: settings.allowedRoots(),
      documents: await Document.count({ paranoid: false }),
      folder: await folderState(dir),
    },
  });
}));

const outsideRoots = () => new DocumentError(400, `Odyssey can only reach folders inside ${settings.allowedRoots().join(', ')} `
  + '- the folders its server makes available to it.');

routes.get('/settings/browse', requireSystem, handle(async (req, res) => {
  const asked = String(req.query.path || '').trim();
  if (!asked) {
    const roots = [];
    for (const r of settings.allowedRoots()) if ((await folderState(r))?.exists) roots.push({ name: r, path: r });
    return res.json({ status: 'success', result: { path: null, parent: null, folders: roots } });
  }
  if (!path.isAbsolute(asked)) throw outsideRoots();
  const dir = path.resolve(asked);
  if (!settings.insideRoots(dir)) throw outsideRoots();
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    throw new DocumentError(404, `${dir} is not there.`);
  }
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 500)
    .map((name) => ({ name, path: path.join(dir, name) }));
  const parent = settings.allowedRoots().includes(dir) ? null : path.dirname(dir);
  res.json({ status: 'success', result: { path: dir, parent, folders, marked: fs.existsSync(path.join(dir, store.MARKER)) } });
}));

/* CHOOSING THE FOLDER. Every document on record is looked for in it first:
 * moving the documents is copying the folder's contents to the new one and
 * then choosing it here, and a folder they are not in yet would show every
 * one as missing. Said, with how many, and chosen only when told to anyway. */
routes.post('/settings/path', requireSystem, handle(async (req, res) => {
  const asked = String(req.body?.path || '').trim();
  if (!asked || !path.isAbsolute(asked)) {
    throw new DocumentError(400, 'Give the folder\'s full path - for example /mnt/data/odyssey-documents.');
  }
  const dir = path.resolve(asked);
  if (!settings.insideRoots(dir)) throw outsideRoots();
  const before = await settings.getPath();

  const rows = await Document.findAll({ paranoid: false, attributes: ['storedName'], raw: true });
  const missing = [];
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const found = await Promise.all(batch.map((r) => store.exists(r.storedName, dir)));
    batch.forEach((r, j) => { if (!found[j]) missing.push(r.storedName); });
  }
  if (missing.length && !req.body?.force) {
    return res.status(409).json({
      status: 'missing',
      result: `${missing.length} of the ${rows.length} documents on record are not in ${dir}. Copy everything from the `
        + 'old folder into it first - or choose it anyway, and they read as missing until they are there.',
      missing: missing.length,
      total: rows.length,
      examples: missing.slice(0, 5),
    });
  }
  await store.prepare(dir);
  await settings.setPath(dir);
  await createHistory(req.user.id, 'Configuration', 'Documents folder', `${before || '(none)'} -> ${dir}`.slice(0, 255));
  res.json({ status: 'success', result: { path: dir, missing: missing.length, total: rows.length, folder: await folderState(dir) } });
}));

/** Content-Disposition with the user's file name: a plain fallback, and the real one encoded. */
function disposition(type, name) {
  const plain = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

module.exports = routes;
module.exports.disposition = disposition;

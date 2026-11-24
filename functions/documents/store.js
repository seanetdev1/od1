/**
 * WHERE ATTACHED DOCUMENTS LIVE ON DISK - scans and files attached to a job,
 * a voucher, an invoice (the user's request, 2026-11-13).
 *
 * Bytes on disk, the details in Postgres (models/Document.js). Not in the
 * database: scans are large and many, and every deploy takes a pg_dump first -
 * a database holding them would make that dump, and every restore, as big as
 * all the scans ever made. Printing templates are in the database because
 * they are few and small; these are neither.
 *
 * THE FOLDER IS CHOSEN IN CONFIGURATION (./settings.js) and handed to each
 * call here as `dir`; until one is chosen nothing is stored. A document's row
 * holds only its place INSIDE the folder, so the folder can move:
 *
 *   <dir>/.odyssey-documents   the marker - see ready()
 *   <dir>/.incoming/           an upload while it arrives
 *   <dir>/2026/11/<uuid>.pdf   a document: a folder a month, so none holds
 *                              every file the install ever kept
 *
 * WHAT IS ACCEPTED is the TYPES table: documents and images, by extension,
 * and the file's first bytes must say it is what its name says (sniff) - an
 * HTML page renamed scan.jpg is refused, not stored to be served as an image.
 * SVG is not an image here: it can carry script.
 *
 * The name on disk is generated here; the user's file name is only ever
 * stored as text. Every path is checked to be inside the folder.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

// The user's limit, 2026-11-13.
const MAX_BYTES = 10 * 1024 * 1024;

// How it is shown: 'pdf' opens in the browser's own viewer, 'image' in
// Odyssey's (a modal), 'download' saves - Word, Excel, and TIFF, which no
// browser but Safari draws.
const startsWith = (bytes) => (head) => head.length >= bytes.length && bytes.every((b, i) => head[i] === b);
const ascii = (s) => [...Buffer.from(s, 'latin1')];
const ZIP = startsWith([0x50, 0x4b, 0x03, 0x04]);                         // .docx / .xlsx
const OLE = startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // .doc / .xls
const JPEG = startsWith([0xff, 0xd8, 0xff]);
const TIFF = (h) => startsWith(ascii('II*\0'))(h) || startsWith(ascii('MM\0*'))(h);

const TYPES = {
  // A PDF's header may sit after a little junk at the start - readers allow
  // it within the first 1024 bytes, so this does too.
  '.pdf': { mime: 'application/pdf', view: 'pdf', sniff: (h) => h.subarray(0, 1024).includes('%PDF-') },
  '.jpg': { mime: 'image/jpeg', view: 'image', sniff: JPEG },
  '.jpeg': { mime: 'image/jpeg', view: 'image', sniff: JPEG },
  '.png': { mime: 'image/png', view: 'image', sniff: startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  '.webp': { mime: 'image/webp', view: 'image', sniff: (h) => startsWith(ascii('RIFF'))(h) && h.subarray(8, 12).equals(Buffer.from('WEBP')) },
  '.tif': { mime: 'image/tiff', view: 'download', sniff: TIFF },
  '.tiff': { mime: 'image/tiff', view: 'download', sniff: TIFF },
  '.doc': { mime: 'application/msword', view: 'download', sniff: OLE },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', view: 'download', sniff: ZIP },
  '.xls': { mime: 'application/vnd.ms-excel', view: 'download', sniff: OLE },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', view: 'download', sniff: ZIP },
};
const EXTENSIONS = Object.keys(TYPES);
const HEAD_BYTES = 1024;

// Below this much free space an upload is refused, so a full disk is a
// message on the screen rather than Postgres failing on the same drive.
const minFreeBytes = () => Number(process.env.ODYSSEY_DOCUMENTS_MIN_FREE_MB ?? 1024) * 1024 * 1024;

const MARKER = '.odyssey-documents';

/** An error whose message is for the user, with the HTTP status to send it with. */
class DocumentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * The name to show and to download as: no folders, quotes, backslashes or
 * control characters (it ends up in a Content-Disposition header), at most
 * 200 characters - cut from the middle of the name, keeping its extension.
 */
function displayName(name) {
  let base = path.basename(String(name || '').replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f"\\]/g, '').trim();
  if (base.length > 200) {
    const ext = path.extname(base).slice(0, 10);
    base = base.slice(0, 200 - ext.length) + ext;
  }
  return base;
}

/** The type a file name says it is, or a DocumentError saying what is allowed. */
function typeOf(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  const type = TYPES[ext];
  if (!type) {
    throw new DocumentError(415, `${ext ? `"${ext}" files` : 'Files without an extension'} cannot be attached. `
      + `Attach PDF, images (JPG, PNG, WEBP, TIFF), Word or Excel files.`);
  }
  return { ext, ...type };
}

/* THE MARKER. A documents folder on a drive of its own is a mount: if the
 * drive is not mounted when the server starts, the folder is an empty one in
 * its place on the system drive - and uploads would quietly go there, while
 * every document already kept reads as missing. So the folder carries a
 * marker, written when Configuration chooses it (prepare); a folder without
 * one is not the folder that was chosen, and nothing is written to it. */
async function ready(dir) {
  if (!dir) {
    throw new DocumentError(503, 'Documents are not set up on this install yet: the folder they are kept in is '
      + 'chosen in Configuration > Documents. Nothing was saved.');
  }
  let stat = null;
  try { stat = await fsp.stat(dir); } catch (_) { /* not there */ }
  if (!stat || !stat.isDirectory()) {
    console.error(`[documents] the documents folder ${dir} is not there`);
    throw new DocumentError(503, 'The documents folder is not there - its drive may not be mounted. '
      + 'Nothing was saved. Ask your administrator to check the server.');
  }
  try {
    await fsp.access(path.join(dir, MARKER));
  } catch (_) {
    console.error(`[documents] ${dir} has no ${MARKER} - not the folder Configuration chose; not writing to it`);
    throw new DocumentError(503, 'The documents folder is not the one that was set up - its drive may not be mounted. '
      + 'Nothing was saved. Ask your administrator to check the server.');
  }
}

/**
 * Make `dir` the documents folder: create it if need be, prove it can be
 * written to, and mark it. What Configuration does on choosing it.
 */
async function prepare(dir) {
  // Two installs on one server (HO-ENT and Essani) both see its drives: a
  // folder one of them keeps its documents in is not the other's to choose.
  const owner = await ownerOf(dir);
  if (owner && process.env.INSTALL_ID && owner !== process.env.INSTALL_ID) {
    throw new DocumentError(400, `${dir} holds the documents of another install (${owner}). Choose a folder of this install's own.`);
  }
  try {
    await fsp.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.odyssey-write-test-${crypto.randomUUID()}`);
    await fsp.writeFile(probe, 'test');
    await fsp.rm(probe, { force: true });
  } catch (err) {
    throw new DocumentError(400, `Odyssey cannot write to ${dir} (${err.code || err.message}).`);
  }
  try {
    await fsp.writeFile(path.join(dir, MARKER),
      "Odyssey's attached documents. Keep this file: without it Odyssey will not save documents here.\n"
      + `${JSON.stringify({ install: process.env.INSTALL_ID || null, since: new Date().toISOString() })}\n`,
      { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw new DocumentError(400, `Odyssey cannot write to ${dir} (${err.code || err.message}).`);
  }
}

/** The install whose marker `dir` carries, or null. */
async function ownerOf(dir) {
  try {
    const text = await fsp.readFile(path.join(dir, MARKER), 'utf8');
    const json = text.split('\n').find((l) => l.trim().startsWith('{'));
    return (json && JSON.parse(json).install) || null;
  } catch (_) {
    return null;
  }
}

/** { free, total } bytes on the drive holding `dir`, or null when it cannot tell. */
async function space(dir) {
  try {
    const s = await fsp.statfs(dir);
    return { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
  } catch (_) {
    return null;
  }
}

/** Refuse when the drive is too full to take `incoming` more bytes. */
async function checkSpace(dir, incoming) {
  const room = await space(dir);
  if (!room) return; // cannot tell (an unusual filesystem) - the write itself will say
  const { free } = room;
  if (free - incoming < minFreeBytes()) {
    console.error(`[documents] ${dir} has ${mb(free)} free - refusing uploads`);
    throw new DocumentError(507, `The server's documents drive is nearly full (${mb(free)} free). `
      + 'Nothing was saved. Ask your administrator to free some space.');
  }
}

/**
 * Take an upload from a stream (the request itself - it is never held in
 * memory whole) into the store.
 *
 * @param stream          the file's bytes
 * @param dir             the documents folder (ready() first)
 * @param name            the user's file name - its extension says the type
 * @param declaredLength  Content-Length, when the client sent one
 * @returns {{ storedName, originalName, mimeType, view, size, sha256 }}
 */
async function receive(stream, { dir, name, declaredLength } = {}) {
  const originalName = displayName(name);
  if (!originalName) throw new DocumentError(400, 'The file has no name.');
  const type = typeOf(originalName);
  const declared = Number(declaredLength);
  if (declared > MAX_BYTES) {
    throw new DocumentError(413, `"${originalName}" is ${mb(declared)}; the limit is ${mb(MAX_BYTES)}.`);
  }
  await checkSpace(dir, Number.isFinite(declared) && declared > 0 ? declared : MAX_BYTES);

  const incoming = path.join(dir, '.incoming');
  await fsp.mkdir(incoming, { recursive: true });
  const temp = path.join(incoming, crypto.randomUUID());

  const hash = crypto.createHash('sha256');
  let size = 0;
  let over = false;
  let head = Buffer.alloc(0);
  const tooBig = () => new DocumentError(413, `"${originalName}" is over the ${mb(MAX_BYTES)} limit.`);
  const meter = new Transform({
    transform(chunk, _enc, done) {
      size += chunk.length;
      if (size > MAX_BYTES) {
        // Read on to the end, keeping nothing, so the browser hears why: an
        // error here would cut the connection, and the screen would only see
        // that it dropped. A sender going on far past the limit is cut off.
        over = true;
        return done(size > 2 * MAX_BYTES ? tooBig() : null);
      }
      if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk.subarray(0, HEAD_BYTES - head.length)]);
      hash.update(chunk);
      return done(null, chunk);
    },
  });

  try {
    await pipeline(stream, meter, fs.createWriteStream(temp, { flags: 'wx' }));
    if (over) throw tooBig();
    if (!size) throw new DocumentError(400, `"${originalName}" is empty.`);
    if (!type.sniff(head)) {
      throw new DocumentError(415, `"${originalName}" is not a real ${type.ext.slice(1).toUpperCase()} file `
        + '- its contents do not match its name. Save it again in that format, or rename it to what it is.');
    }
    const now = new Date();
    const folder = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    const storedName = `${folder}/${crypto.randomUUID()}${type.ext}`;
    await fsp.mkdir(path.join(dir, folder), { recursive: true });
    await fsp.rename(temp, resolve(storedName, dir));
    return { storedName, originalName, mimeType: type.mime, view: type.view, size, sha256: hash.digest('hex') };
  } catch (err) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    if (err instanceof DocumentError) throw err;
    if (err.code === 'ENOSPC') throw new DocumentError(507, "The server's documents drive is full. Nothing was saved.");
    throw err;
  }
}

// What storedName may look like - exactly what receive() makes.
const STORED = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

/** The absolute path of a stored document in `dir`, proven to be inside it. */
function resolve(storedName, dir) {
  const name = String(storedName || '');
  if (!STORED.test(name) || !dir) throw new DocumentError(404, 'Not a stored document.');
  const target = path.join(dir, name);
  const rel = path.relative(dir, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new DocumentError(404, 'Not a stored document.');
  return target;
}

/** Is the file there? (A document on record whose file is not is a restore without its documents.) */
async function exists(storedName, dir) {
  try {
    await fsp.access(resolve(storedName, dir));
    return true;
  } catch (_) {
    return false;
  }
}

/** For a file that never got its row - a failed save. Documents themselves are never removed. */
async function discard(storedName, dir) {
  await fsp.rm(resolve(storedName, dir), { force: true }).catch((err) => {
    console.error('[documents] could not remove', storedName, err.message);
  });
}

/** How a stored file is shown, from its name. */
const viewOf = (name) => TYPES[path.extname(String(name || '')).toLowerCase()]?.view || 'download';

/* A DOCUMENT'S OWN NAME (the user's request, 2026-11-13): a scanner calls its
 * files scan020.pdf, and a list of those says nothing - so a document can be
 * given a name, "Invoice JI-123/27", shown in place of the file's. */

/** A name given to a document: one space between words, no control characters, 200 at most. '' is none. */
function cleanTitle(title) {
  return String(title ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * What it downloads as: its name, made fit for a file name - the characters
 * Windows refuses (the / of JI-123/27 among them) become '-' - with the
 * file's own extension, which is what opens it.
 */
function downloadName(title, originalName) {
  if (!title) return originalName;
  const ext = path.extname(String(originalName || ''));
  const base = title.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (!base) return originalName;
  return ext && base.toLowerCase().endsWith(ext.toLowerCase()) ? base : `${base}${ext}`;
}

module.exports = {
  MAX_BYTES, TYPES, EXTENSIONS, MARKER, DocumentError,
  ready, prepare, space, receive, resolve, exists, discard, displayName, typeOf, viewOf, cleanTitle, downloadName,
};

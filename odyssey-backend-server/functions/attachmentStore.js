/**
 * Where task attachments live on disk.
 *
 * Bytes go to the filesystem, metadata to Postgres. The alternative - binary
 * columns - keeps one backup covering everything, but grows the database with
 * every file and pulls each blob through Postgres on every read.
 *
 * BACKUP CONSEQUENCE: pg_dump is no longer a complete backup of this install.
 * Whatever directory this writes to has to be backed up alongside the database,
 * or restoring gives you tasks whose attachments all 404.
 *
 * The upload path is the only place in Odyssey where client-supplied data
 * reaches the filesystem, so it is written defensively:
 *   - the stored filename is generated here, never taken from the client;
 *   - the resolved path is checked to be inside the root before any write or
 *     read, so a crafted id cannot walk out of it;
 *   - size is capped well below the 100mb express.json limit.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

// Default sits next to the app. In Docker this should be a mounted volume -
// a container's writable layer is discarded when the container is replaced,
// which happens on every upgrade.
const ROOT = path.resolve(
  process.env.ODYSSEY_UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads')
);

const TASKS_DIR = path.join(ROOT, 'tasks');

// 15 MB. express.json accepts 100mb, but base64 inflates by ~33% and the body
// is held in memory as a string before it ever reaches here - the comment on
// that limit in index.js ("avoid event loop death") is the reason to stay well
// under it.
const MAX_BYTES = 15 * 1024 * 1024;

// Extensions that execute if someone is tricked into opening them, or that a
// misconfigured server might run. Attachments are documents, not programs.
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.scr', '.bat', '.cmd', '.com', '.pif', '.msi', '.ps1',
  '.vbs', '.js', '.jse', '.jar', '.hta', '.cpl', '.msc', '.reg', '.sh',
]);

function ensureDir() {
  fs.mkdirSync(TASKS_DIR, { recursive: true });
}

/**
 * Strip anything that could change where a name points. Used only for the
 * DISPLAY name we store - the on-disk name is generated, never derived from
 * this - but a filename also ends up in a Content-Disposition header, so it
 * must not carry quotes or newlines either.
 */
function safeDisplayName(name) {
  const base = path.basename(String(name || 'attachment'));
  return base.replace(/[\r\n"\\]/g, '').replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'attachment';
}

/** Decode a data: URL or a bare base64 string into a Buffer. */
function decodePayload(payload) {
  if (typeof payload !== 'string' || !payload) {
    throw new Error('Attachment content is missing.');
  }
  const comma = payload.startsWith('data:') ? payload.indexOf(',') : -1;
  const b64 = comma >= 0 ? payload.slice(comma + 1) : payload;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('Attachment content is empty or not valid base64.');
  return buf;
}

/** Mime type from a data: URL prefix, when the client sent one. */
function mimeFromPayload(payload, fallback) {
  const m = typeof payload === 'string' && payload.startsWith('data:')
    ? payload.slice(5, payload.indexOf(';') > 0 ? payload.indexOf(';') : payload.indexOf(','))
    : null;
  return m || fallback || 'application/octet-stream';
}

/**
 * Write one attachment. Returns the metadata row to persist.
 * @param {{ name: string, content: string, mimeType?: string }} file
 */
async function save(file) {
  const originalName = safeDisplayName(file && file.name);
  const ext = path.extname(originalName).toLowerCase();

  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`Files of type "${ext}" cannot be attached.`);
  }

  const buf = decodePayload(file && file.content);
  if (buf.length > MAX_BYTES) {
    throw new Error(
      `Attachment is ${(buf.length / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB.`
    );
  }

  ensureDir();

  // Generated name. The client's filename never reaches the filesystem, so a
  // name like "../../.env" is inert - it is only ever stored as text.
  const storedName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  const target = path.join(TASKS_DIR, storedName);

  // Belt and braces: prove the resolved path is still inside the root.
  if (path.relative(TASKS_DIR, target).startsWith('..')) {
    throw new Error('Refusing to write outside the attachment directory.');
  }

  await fsp.writeFile(target, buf);

  return {
    originalName,
    storedName,
    mimeType: mimeFromPayload(file && file.content, file && file.mimeType),
    size: buf.length,
  };
}

/** Absolute path for a stored attachment, verified to be inside the root. */
function resolve(storedName) {
  const name = path.basename(String(storedName || ''));
  if (!name) throw new Error('No attachment name given.');
  const target = path.join(TASKS_DIR, name);
  if (path.relative(TASKS_DIR, target).startsWith('..')) {
    throw new Error('Invalid attachment path.');
  }
  return target;
}

async function read(storedName) {
  return fsp.readFile(resolve(storedName));
}

/** Best-effort delete. A missing file is not an error - the row is going anyway. */
async function remove(storedName) {
  try {
    await fsp.unlink(resolve(storedName));
    return true;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[attachments] could not delete', storedName, err.message);
    }
    return false;
  }
}

module.exports = { save, read, remove, resolve, ROOT, TASKS_DIR, MAX_BYTES, BLOCKED_EXTENSIONS };

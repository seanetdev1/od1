// THE ARCHIVE'S BOOKS - which old Climax databases this install can
// read, and how to reach them.
//
// CargoLinkers ran the old Climax (the "CTLS" product, not the CSUL one the
// migration reads) for years before the book Odyssey was migrated from, and
// kept each period in a database of its own. Those books were never migrated
// and never will be: the live book already opens with their balances brought
// forward, so importing them would count those balances twice. The Archive
// reads them where they sit instead - restored on a SQL Server next to the
// install, attached READ_ONLY, through a login that can only read.
//
// CONFIGURED IN THE INSTALL'S .env, not in the database and not on a screen.
// A book appears only after someone restores it on the server, so the line
// that names it belongs with that step; and the password must not sit in a
// table every admin screen can read. An install without these lines has no
// archive - the menu entry does not appear at all.
//
//   ARCHIVE_DB_HOST=host.docker.internal     (the SQL Server; required)
//   ARCHIVE_DB_PORT=1433                     (ignored with an instance name)
//   ARCHIVE_DB_INSTANCE=                     (optional named instance)
//   ARCHIVE_DB_USER=odyssey_archive          (required)
//   ARCHIVE_DB_PASS=...
//   ARCHIVE_DB_ENCRYPT=false                 (true for an encrypted link)
//   ARCHIVE_BOOKS=CTLS_CLINK_2016=2016 - Aug 2024;CTLS_CLINK=2012 - 2015
//
// ARCHIVE_BOOKS is `DATABASE=Label` pairs separated by ';', in the order the
// picker offers them. The database name is also the book's key in every URL,
// so it is checked against this list on every request - a key that is not
// here never reaches the server, whatever the request says.

const NAME = /^[A-Za-z0-9_]{1,128}$/;

function parseBooks(raw) {
  const seen = new Set();
  const out = [];
  String(raw || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const eq = entry.indexOf('=');
      const key = (eq === -1 ? entry : entry.slice(0, eq)).trim();
      const label = (eq === -1 ? '' : entry.slice(eq + 1)).trim();
      if (!NAME.test(key) || seen.has(key.toLowerCase())) return;
      seen.add(key.toLowerCase());
      out.push({ key, label: label || key });
    });
  return out;
}

function connection(env = process.env) {
  const port = Number(env.ARCHIVE_DB_PORT);
  return {
    host: String(env.ARCHIVE_DB_HOST || '').trim(),
    port: Number.isInteger(port) && port > 0 ? port : 1433,
    instance: String(env.ARCHIVE_DB_INSTANCE || '').trim(),
    user: String(env.ARCHIVE_DB_USER || '').trim(),
    password: env.ARCHIVE_DB_PASS || '',
    encrypt: String(env.ARCHIVE_DB_ENCRYPT || '').trim().toLowerCase() === 'true',
  };
}

function books(env = process.env) {
  const c = connection(env);
  if (!c.host || !c.user) return [];
  return parseBooks(env.ARCHIVE_BOOKS);
}

const isConfigured = (env = process.env) => books(env).length > 0;

function bookFor(key, env = process.env) {
  if (!NAME.test(String(key || ''))) return null;
  return books(env).find((b) => b.key.toLowerCase() === String(key).toLowerCase()) || null;
}

module.exports = { parseBooks, connection, books, isConfigured, bookFor };

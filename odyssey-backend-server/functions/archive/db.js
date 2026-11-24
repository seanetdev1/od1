// The connection to the archive's books - one small pool per book, opened the
// first time someone reads it.
//
// READ-ONLY IS HELD BY THE SERVER, not by this file: each book is attached
// READ_ONLY and the login has db_datareader and nothing more (see the CL
// runbook). What this file adds on top is that every statement here is fixed
// in the code, a SELECT, and given its values as parameters - nothing a user
// types is ever part of the SQL text.

const { connection, bookFor } = require('./books');

// The driver is loaded the first time something reads, not when the app
// starts. Partly cost - an install without archive books never loads it - and
// partly Jest: mssql pulls in @azure/identity, whose dependencies ship as ES
// modules Jest will not load, so requiring it at the top made every test that
// loads the app fail before it ran.
let driver;
const mssql = () => (driver = driver || require('mssql'));

const pools = new Map();

class ArchiveError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function poolFor(key) {
  if (pools.has(key)) return pools.get(key);
  const c = connection();
  const config = {
    server: c.host,
    user: c.user,
    password: c.password,
    database: key,
    options: {
      encrypt: c.encrypt,
      trustServerCertificate: true,
      readOnlyIntent: true,
      appName: 'Odyssey Archive',
      ...(c.instance ? { instanceName: c.instance } : {}),
    },
    // tedious refuses a port alongside an instance name: the instance's port
    // is looked up through the SQL Browser instead.
    ...(c.instance ? {} : { port: c.port }),
    pool: { max: 4, min: 0, idleTimeoutMillis: 60000 },
    connectionTimeout: 15000,
    requestTimeout: 90000,
  };
  const pool = new (mssql().ConnectionPool)(config);
  // A pool that failed to connect is forgotten, so the next request tries
  // again - the SQL Server may simply have been down for a moment.
  const ready = pool.connect().catch((err) => {
    pools.delete(key);
    throw err;
  });
  pools.set(key, ready);
  return ready;
}

/* Typed parameters. VarChar for text, not NVarChar: the Climax columns are
 * varchar, and an nvarchar value makes SQL Server convert the COLUMN to
 * compare, which turns an index seek into a scan of the table. */
const param = {
  str: (value) => ({ type: () => mssql().VarChar(4000), value: value == null ? null : String(value) }),
  int: (value) => ({ type: () => mssql().Int, value: value == null ? null : Number(value) }),
  num: (value) => ({ type: () => mssql().Decimal(19, 4), value: value == null ? null : Number(value) }),
  date: (value) => ({ type: () => mssql().Date, value: value == null ? null : value }),
};

const SELECT_ONLY = /^\s*(SELECT|WITH)\b/i;

/**
 * Rows from a book. `key` must be a configured book - an unknown one is a 404
 * before anything connects. `params` maps a name to param.str/int/num/date.
 */
async function query(key, text, params = {}) {
  const book = bookFor(key);
  if (!book) throw new ArchiveError('There is no such archive book on this install.', 404);
  if (!SELECT_ONLY.test(text)) throw new ArchiveError('The archive only reads.', 500);
  let pool;
  try {
    pool = await poolFor(book.key);
  } catch (err) {
    console.error(`[archive] could not connect to ${book.key}:`, err.message);
    throw new ArchiveError(
      'The archive database server could not be reached. Ask your administrator to check the SQL Server that holds the old books.',
      503,
    );
  }
  const request = pool.request();
  Object.entries(params).forEach(([name, p]) => request.input(name, p.type(), p.value));
  const result = await request.query(text);
  return result.recordset || [];
}

async function closeAll() {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map((p) => p.then((pool) => pool.close()).catch(() => {})));
}

module.exports = { query, param, closeAll, ArchiveError };

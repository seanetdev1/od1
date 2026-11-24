'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../config/config')[env];
const db = {};

let sequelize;
const sequelizeConfig = {
  ...config,
  logging: false,
};

// Prefer a connection URL from the environment when one is provided (e.g.
// DATABASE_URL in a Docker deploy); otherwise fall back to the explicit
// username/password/host fields from config/config.js (the from-source
// deploy), which reads them out of DB_USER/DB_PASS/DB_HOST/DB_PORT.
if (config.use_env_variable && process.env[config.use_env_variable]) {
  sequelize = new Sequelize(process.env[config.use_env_variable], sequelizeConfig);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, sequelizeConfig);
}

fs.readdirSync(__dirname).filter(file => {
    // Accept both .js (from-source) and .jsc (bytecode-sealed) model files, and
    // never re-require this index file itself (basename is index.js or index.jsc).
    return (file.indexOf('.') !== 0) && (file !== basename) &&
           (file.endsWith('.js') || file.endsWith('.jsc'));
  }).forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach(modelName => {
  if(db[modelName].associate) {
    db[modelName].associate(db)
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// IMPORTANT: assign module.exports before requiring the association files
// below, and before calling sync(). The association files each do
// require('../../models') themselves (a circular require back into this
// same file) - Node resolves that to whatever module.exports currently is
// at that moment, so it must already be the populated `db` object here,
// not the empty {} this module started with.
module.exports = db;

// Many foreign key columns (SEJobId, ClientId, shipperId, CompanyId, etc.)
// only get attached to a model's attributes as a side effect of these
// association files running (hasMany/belongsTo calls mutate the target
// model's rawAttributes). They must be loaded BEFORE sync() below runs,
// because sync({alter:true}) doesn't just add missing columns - it also
// DROPS columns that exist in the DB but aren't in the model's currently
// known attributes, to force the schema to match. Any process that only
// requires this file without these also being loaded would make sync()
// think those association-only columns shouldn't exist, and delete them.
require('../functions/Associations/jobAssociations/seaExport');
// Aviation jobs. Only touches the two Aviation_* tables - see the file.
require('../functions/Associations/aviationAssociations');
// Customs clearance jobs. Only touches Customs_Jobs - see the file.
require('../functions/Associations/customsAssociations');
require('../functions/Associations/clientAssociation');
require('../functions/Associations/voucherAssociations');
require('../functions/Associations/incoiceAssociations');
require('../functions/Associations/NotificationAssociation');
require('../functions/Associations/taskAssociation');
require('../functions/Associations/vesselAssociations');
require('../functions/Associations/fiscalYearAssociations');
// This one was missing while index.js loaded it - i.e. exactly the failure the
// comment above warns about. companyAssociations is what declares
// Company.hasMany(BankAccount), and that is the only thing that puts a
// CompanyId attribute on BankAccount. Without it loaded here, every boot's
// sync({alter:true}) saw a BankAccounts.CompanyId column that no model claimed
// and DROPPED it - then requests, which run after index.js has loaded the
// association, asked for that column and failed. Symptom: the company list in
// the header comes back empty, because /companies/getAllCompanies includes
// BankAccount and the whole query errors.
require('../functions/Associations/companyAssociations');
// Freight AWB stock: puts AirlineId / SEJobId on Awbl.
require('../functions/Associations/awblAssociations');
// Credit control: blocks, unblock requests and omitted invoices. Adds no columns.
require('../functions/Associations/creditAssociations');

// Who made each job, voucher, invoice and charge line, and who last changed
// it: createdBy / createdOn / editedBy / editedOn, stamped on every save.
require('../functions/auditStamps').registerAuditStamps(db,
  ['SE_Job', 'Customs_Job', 'Aviation_Job', 'Vouchers', 'Invoice', 'Charge_Head']);

// When each customs job's status changed (models/Customs_Job_Status) - the
// bell's Critical alert reads how long a job has been On Vessel.
require('../functions/customsStatusLog').registerCustomsStatusLog(db);

// Sync models with the database. THREE modes, set by ODYSSEY_DB_SYNC:
//
//   'create' (DEFAULT) - sequelize.sync() with no options: CREATE TABLE IF NOT
//        EXISTS for anything missing. It never issues ALTER, so it cannot
//        change or drop a column on a live database. A brand-new install comes
//        up with a full schema; an existing one is left alone.
//
//   'alter'  - sequelize.sync({alter:true}): the old behaviour. Reconciles
//        columns by issuing ALTER TABLE, which is how you apply an upgrade's
//        schema changes. Run it DELIBERATELY, once, with nothing serving
//        traffic - not on every boot at a customer site.
//
//   'off'    - do nothing. (ODYSSEY_SKIP_DB_SYNC=1 is kept as an alias.)
//
// Why the default changed: `alter` on every boot is a schema migration executed
// unattended against live customer data. It also stops at the FIRST model that
// fails and silently skips every model after it - that is how a Sessions table
// went missing and how BankAccounts.CompanyId was dropped on every restart.
// 'create' keeps fresh installs working with none of that exposure.
//
// Also never in a cluster worker: server.js runs the sync in the primary and
// only forks once it has finished, so a worker must not repeat it. Without that
// guard N workers fired concurrent DDL at one database on every boot.
//
// Exposed as db.syncPromise so callers (seedAdmin, scripts/) can await it
// rather than race it. It never rejects, and it resolves immediately when the
// sync is skipped, so awaiting is always safe.
const cluster = require('cluster');

const syncMode = (() => {
  if (process.env.ODYSSEY_SKIP_DB_SYNC === '1') return 'off';
  const m = (process.env.ODYSSEY_DB_SYNC || 'create').toLowerCase();
  return ['create', 'alter', 'off'].includes(m) ? m : 'create';
})();

const skipSync = syncMode === 'off' || cluster.isWorker;

// sequelize.sync() syncs models SEQUENTIALLY and stops at the first failure -
// every model after the failing one is silently never synced. Combined with
// the swallowing catch below, a single bit of schema drift means "some tables
// are missing/stale" while the server boots and reports nothing but one line.
//
// That is not hypothetical: on a database where Office_Vouchers.CompanyId has
// drifted from the model's declared type, sync aborts there, and every model
// defined after it - including Session, which auth depends on - never gets
// created. Login then fails with `relation "Sessions" does not exist`, a very
// long way from the actual cause.
//
// So: keep booting on a sync failure (refusing to start a whole ERP over one
// stale column is worse), but say so LOUDLY, and separately guarantee the
// tables the server cannot function at all without.
const CRITICAL_MODELS = ['Session'];

// Postgres doesn't populate err.original.table for a failed ALTER, so pull the
// table out of the statement itself - "see stack below" made the operator go
// read a stack trace to learn something we already had in hand.
function failingTable(err) {
  const sql = err?.sql || err?.original?.sql || '';
  const m = sql.match(/(?:ALTER|CREATE)\s+TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/i);
  return m ? m[1] : (err?.original?.table || 'unknown - see stack below');
}

async function ensureCriticalTables() {
  for (const name of CRITICAL_MODELS) {
    if (!db[name]) continue;
    try {
      // Plain sync() = CREATE TABLE IF NOT EXISTS for this one model. No
      // alter, so it cannot touch or damage any existing table.
      await db[name].sync();
    } catch (err) {
      console.error(
        `[schema] CRITICAL: could not create the "${name}" table - ${err.message}`
      );
    }
  }
}

// Outcome of the sync, for callers that need to report it honestly.
// syncPromise deliberately never rejects, so "it resolved" says nothing about
// whether the schema is actually correct - server.js was printing
// "schema in sync" directly underneath the failure banner because of exactly
// that. Read db.syncError instead: null = fine, an Error = partially migrated.
db.syncError = null;

db.syncMode = skipSync ? 'off' : syncMode;

db.syncPromise = skipSync
  ? Promise.resolve()
  : sequelize.sync(syncMode === 'alter' ? { alter: true } : undefined)
      .then(() => {
        console.log(
          syncMode === 'alter'
            ? 'Database schema reconciled (ODYSSEY_DB_SYNC=alter).'
            : 'Database & tables created (missing tables only; no ALTER).'
        );
      })
      .catch(async (err) => {
        db.syncError = err;
        console.error(
          '\n' +
          '========================================================================\n' +
          ' SCHEMA SYNC FAILED - THE DATABASE IS NOT FULLY MIGRATED\n' +
          '========================================================================\n' +
          ' sync() stops at the first model that fails, so every model after this\n' +
          ' one was skipped and its table may be missing or out of date.\n' +
          ` Failing table: ${failingTable(err)}\n` +
          ` Reason: ${err?.original?.message || err.message}\n` +
          ` Hint: ${err?.original?.hint || '(none)'}\n` +
          ' Fix the drift, then restart. Until then the server is running against\n' +
          ' a partially-migrated schema.\n' +
          '========================================================================\n'
        );
        console.error(err);
        // Auth is not optional - make sure its table exists even though the
        // bulk sync gave up before reaching it.
        await ensureCriticalTables();
      });

// ---------------------------------------------------------------------------
// Aviation module: reconcile its OWN two tables with alter, every boot.
//
// The default 'create' mode is CREATE TABLE IF NOT EXISTS, which never adds a
// column to a table that already exists. That is the right conservative
// default for the shared tables, where a column nobody expects being dropped
// would be a disaster - but it means every field change to a young module
// needs a hand-run migration script, and until it is run EVERY query against
// that table dies with "column does not exist" (Postgres 42703).
//
// Scoping alter to these two models is safe in a way a global alter is not:
// Aviation_Jobs and Aviation_Consignments are owned outright by
// functions/Associations/aviationAssociations + routes/aviationJobs. Nothing
// else reads or writes them, and no other table references them - so "make the
// table match the model" cannot surprise code elsewhere. It also picks up the
// foreign key columns that associations add, which are exactly the ones a
// fresh CREATE TABLE misses if it happens to run before the association file
// has loaded.
//
// NOTE: alter DROPS columns the model no longer declares. That is intended
// here (a renamed field should not leave its old column behind), but once this
// module holds live data, a rename becomes a data migration and this needs
// revisiting. Set ODYSSEY_AVIATION_SYNC=off to disable.
// Parent first: each child's foreign key needs something to reference.
// Charges are NOT here - an aviation charge is a Charge_Head, the same shared
// table the freight side uses, so it must never be alter-synced from here.
// Aviation_Awb sits between the carrier that issues a number and the
// consignment that uses one, so it must be reconciled after Aviation_Carrier
// and before Aviation_Consignment - the child's foreign key needs something to
// reference.
// Aviation_Pfm comes BEFORE Aviation_Job: the job carries AviationPfmId, so
// the plan's table has to exist for that foreign key to reference. Its lines
// come after Aviation_Awb for the same reason the consignments do - a planned
// line points at a registered number.
const AVIATION_MODELS = ['Aviation_Aircraft', 'Aviation_Carrier', 'Aviation_Pfm', 'Aviation_Job', 'Aviation_Awb', 'Aviation_Consignment', 'Aviation_Pfm_Line'];

db.aviationSyncError = null;
db.aviationSyncPromise = (skipSync || process.env.ODYSSEY_AVIATION_SYNC === 'off')
  ? Promise.resolve()
  : db.syncPromise
      .then(async () => {
        // Parent first: the child's foreign key needs something to reference.
        for (const name of AVIATION_MODELS) {
          if (db[name]) await db[name].sync({ alter: true });
        }
      })
      .then(() => console.log('Aviation tables reconciled.'))
      .catch((err) => {
        db.aviationSyncError = err;
        console.error(
          '\n[aviation] Could not reconcile the aviation tables:\n' +
          `  ${err?.original?.message || err.message}\n` +
          '  The Aviation Job screens will fail until this is resolved. Other\n' +
          '  modules are unaffected - only Aviation_* tables are touched here.\n'
        );
      });

// ---------------------------------------------------------------------------
// Customs module: reconcile its OWN tables with alter, every boot.
//
// Same reasoning as the aviation block above, and safe for the same reason:
// Customs_Jobs, Customs_Duties and Customs_Containers are owned outright by
// functions/Associations/customsAssociations + routes/customsJobs. Nothing
// else reads or writes them, and no other table references them, so "make the
// table match the model" cannot surprise code elsewhere. It also picks up the foreign key columns the association file
// adds (clientId, shipperId, consigneeId, CommodityId), which are exactly the
// ones a fresh CREATE TABLE misses if it happens to run first.
//
// NOTE: alter DROPS columns the model no longer declares. That is intended
// while the module is young, but once it holds live data a rename becomes a
// data migration and this needs revisiting. Set ODYSSEY_CUSTOMS_SYNC=off to
// disable.
//
// Charge_Heads is NOT here - a customs charge is a Charge_Head, the same
// shared table the freight side uses, so it must never be alter-synced from
// here. Its CustomsJobId column is added once by
// scripts/addCustomsChargeHeadLink.js.
//
// Parent first: the children's foreign keys need something to reference.
//
// EVERY customs model has to be listed here. A model that is defined but not
// in this list gets created once by the global 'create' sync above, from
// whatever shape it had on that boot, and is then never reconciled again -
// so every column added to it afterwards is missing from the table forever
// while the model happily selects it. Customs_Container was left off when it
// was added, which is exactly how Customs_Containers ended up with neither
// truckNo nor the CustomsJobId its own association declares.
//
// The alter is what carries the duty re-architecture onto a database that
// already has the module: Customs_Jobs loses the eight duty amount columns it
// used to hold, and Customs_Duties is created. That drop is intended - the
// figures moved to the child table - and is exactly the case the NOTE above
// warns will need a real data migration once this module holds live data. It
// does not yet.
// The charge groups are listed here for the same reason as the rest: a table
// outside this list is created once and never reconciled, so every column added
// to its model afterwards is missing from the database until a query dies in
// front of a user. Parent before children - the foreign keys need something to
// reference.
// Customs_Plan after Customs_Job: a plan points at the job it was moved to.
const CUSTOMS_MODELS = ['Customs_Job', 'Customs_Plan', 'Customs_Duty', 'Customs_Container',
  'Customs_Charge_Group', 'Customs_Charge_Group_Party', 'Customs_Charge_Group_Line'];

// A model that is defined but missing from the list that owns it is the exact
// failure above, and it is silent: the table is created once, never
// reconciled, and every column added to the model afterwards is absent from
// the database until some query dies with 42703 in front of a user. Catching
// it at boot costs one loop.
for (const [prefix, listName, listed] of [
  ['Aviation_', 'AVIATION_MODELS', AVIATION_MODELS],
  ['Customs_', 'CUSTOMS_MODELS', CUSTOMS_MODELS],
]) {
  const unlisted = Object.keys(db).filter(
    (n) => n.startsWith(prefix) && typeof db[n]?.sync === 'function' && !listed.includes(n),
  );
  if (unlisted.length) {
    console.warn(
      `\n[schema] ${unlisted.join(', ')} defined but not in ${listName} (models/index.js).\n` +
      '  Its table is created once and then never reconciled, so any column added\n' +
      '  to the model after that first boot will be missing from the database.\n'
    );
  }
}

db.customsSyncError = null;
db.customsSyncPromise = (skipSync || process.env.ODYSSEY_CUSTOMS_SYNC === 'off')
  ? Promise.resolve()
  // Chained after the aviation reconcile rather than run alongside it: both
  // issue DDL against one database, and two concurrent ALTERs on the same
  // connection pool is how a boot deadlocks itself.
  : db.aviationSyncPromise
      .then(async () => {
        for (const name of CUSTOMS_MODELS) {
          if (db[name]) await db[name].sync({ alter: true });
        }
      })
      .then(() => console.log('Customs tables reconciled.'))
      .catch((err) => {
        db.customsSyncError = err;
        console.error(
          '\n[customs] Could not reconcile the customs tables:\n' +
          `  ${err?.original?.message || err.message}\n` +
          '  The Customs Job screens will fail until this is resolved. Other\n' +
          '  modules are unaffected - only Customs_Jobs is touched here.\n'
        );
      });

// Everything the boot does to the schema, as ONE promise.
//
// A one-off script that awaits syncPromise alone and then closes the
// connection cuts the aviation reconcile off mid-flight, because that chains
// AFTER syncPromise resolves - which reads as a scary "could not reconcile"
// banner caused entirely by the script exiting. Scripts should await this.
// Never rejects: both halves already report their own failures.
db.ready = db.syncPromise
  .then(() => db.aviationSyncPromise)
  .then(() => db.customsSyncPromise)
  .catch(() => {});

/**
 * Read-only check: does every column a model declares actually exist?
 *
 * Now that boot no longer ALTERs (ODYSSEY_DB_SYNC defaults to 'create'), adding
 * a column to a model and restarting does NOT put it in the database. Sequelize
 * still names it in every SELECT, so the first symptom is a query failing with
 * `column X does not exist` - somewhere unrelated to the change, like login.
 *
 * That has now happened twice (BankAccounts.CompanyId, Employees.climaxId), so
 * the boot says it plainly instead of leaving it to be discovered at runtime.
 * Reports only; it never alters anything and never blocks startup.
 */
db.checkSchemaDrift = async function checkSchemaDrift() {
  try {
    const [rows] = await sequelize.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
    );
    const live = new Map();
    for (const r of rows) {
      const t = r.table_name || r.TABLE_NAME;
      const c = r.column_name || r.COLUMN_NAME;
      if (!live.has(t)) live.set(t, new Set());
      live.get(t).add(c);
    }

    const missing = [];
    for (const key of Object.keys(db)) {
      const model = db[key];
      if (!model || typeof model.getTableName !== 'function') continue;
      const table = model.getTableName();
      const cols = live.get(typeof table === 'string' ? table : table?.tableName);
      if (!cols) continue;   // table absent entirely - sync/its own error covers that
      for (const [attrName, attr] of Object.entries(model.rawAttributes || {})) {
        const col = attr.field || attrName;
        if (!cols.has(col)) missing.push(`${table}.${col}`);
      }
    }

    if (missing.length) {
      console.error(
        '\n' +
        '========================================================================\n' +
        ' SCHEMA DRIFT - columns the models declare are NOT in the database\n' +
        '========================================================================\n' +
        missing.map((m) => `   ${m}`).join('\n') + '\n\n' +
        ' Queries touching these tables will fail with "column does not exist",\n' +
        ' usually somewhere that looks unrelated to whatever added the column.\n\n' +
        ' Apply them (stop the app first):\n\n' +
        // BOTH SHELLS, because this banner is read on Windows as often as not.
        // The bash form was the only one printed, and `VAR=value cmd` is not
        // valid PowerShell - it fails with "The term 'ODYSSEY_DB_SYNC=alter' is
        // not recognized", which reads as a broken instruction rather than a
        // shell mismatch. Copying it verbatim into PowerShell silently does
        // nothing about the drift, so the original error just keeps happening.
        // db.ready, NOT syncPromise. syncPromise covers only the global sync;
        // the aviation and customs reconciles chain AFTER it, so exiting on
        // syncPromise kills them mid-ALTER - which looks like the migration
        // ran and then leaves those modules' columns still missing. That is
        // the trap db.ready exists for, and this banner was walking people
        // straight into it.
        '   bash / sh:\n' +
        '     ODYSSEY_DB_SYNC=alter node -e "require(\'./models\').ready.then(()=>process.exit(0))"\n\n' +
        '   PowerShell:\n' +
        '     $env:ODYSSEY_DB_SYNC="alter"; node -e "require(\'./models\').ready.then(()=>process.exit(0))"; Remove-Item Env:\\ODYSSEY_DB_SYNC\n\n' +
        '   Only the aviation/customs modules drifting? Those reconcile themselves\n' +
        '   on a normal boot - no env var, and no ALTER on any shared table:\n' +
        '     node -e "require(\'./models\').ready.then(()=>process.exit(0))"\n' +
        '========================================================================\n'
      );
    }
    return missing;
  } catch (err) {
    console.error('[schema] drift check failed:', err.message);
    return [];
  }
};

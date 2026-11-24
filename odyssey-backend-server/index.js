require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const db = require('./models');
const http = require('http');

const app = express();

/* -------------------- UNDICI GLOBAL DISPATCHER -------------------- */
const { Agent, setGlobalDispatcher } = require('undici');

setGlobalDispatcher(new Agent({
  connections: 200,        // VERY important for load
  pipelining: 1,
  headersTimeout: 900_000,
  bodyTimeout: 0,
}));

/* -------------------- MIDDLEWARES -------------------- */
app.use(morgan('tiny'));
app.use(cors());

// ⚠️ Reduced limits to avoid event loop death
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

/* -------------------- ROUTES -------------------- */
const miscProfitLossRoutes = require('./routes/misc/profitLoss');
const misctrialBalanceRoutes = require('./routes/misc/trialBalance');
const miscVatDetailRoutes = require('./routes/misc/vatDetail');
const miscAgentStatementRoutes = require('./routes/misc/agentStatement');
const homeOperationsRoutes = require('./routes/home/operations');
const homeDashboardRoutes = require('./routes/home/dashboard');
const notificationRoutes = require('./routes/notifications');
// The header's search - jobs, B/Ls, invoices, vouchers, parties (2026-11-23).
const searchRoutes = require('./routes/search');
const homeAccountRoutes = require('./routes/home/accounts');
const miscPartiesRoutes = require('./routes/misc/parties');
const commodityRoutes = require('./routes/commodity/');
// The rewritten airports/ports/destinations migration. /seaJob/UploadAirPorts
// is untouched - see routes/locations/locationMigration.js.
const locationMigrationRoutes = require('./routes/locations/locationMigration');
// The rewritten jobs-only migration. The /seaJob/Upload*Jobs receivers are
// untouched - see routes/jobMigration/index.js.
const jobMigrationRoutes = require('./routes/jobMigration/');
// The rewritten B/L + air-waybill migration. The /seaJob/Upload*Jobs receivers
// are untouched - see routes/blMigration/index.js.
const blMigrationRoutes = require('./routes/blMigration/');
// Containers, stamps, dimensions and AWB rate lines - the things that hang off
// a B/L. See routes/blChildMigration/index.js.
const blChildMigrationRoutes = require('./routes/blChildMigration/');
// Job equipment - distinct from the containers on a B/L.
// See routes/jobEquipmentMigration/index.js.
const jobEquipmentMigrationRoutes = require('./routes/jobEquipmentMigration/');
// Loading programs - never migrated by any previous path.
const loadingProgramMigrationRoutes = require('./routes/loadingProgramMigration/');
// Job charge lines. UploadChargesRecv/Payb in the job receivers are untouched.
const chargeHeadMigrationRoutes = require('./routes/chargeHeadMigration/');
// Job invoices, and the charge lines each one carries. The bulk invoice
// uploaders in routes/invoice are untouched - see routes/invoiceMigration/.
const invoiceMigrationRoutes = require('./routes/invoiceMigration/');
// Vouchers, voucher heads and invoice settlement. routes/voucher/ledger.js and
// importLedger in steps.js are untouched - see routes/ledgerMigration/.
const ledgerMigrationRoutes = require('./routes/ledgerMigration/');
const seaJobRoutes = require('./routes/jobRoutes/sea');
// Aviation jobs (a flight + its consignments). Separate module - see the file.
const aviationJobRoutes = require('./routes/aviationJobs');
// Customs clearance jobs (one goods declaration each). Separate module - see
// the file.
const customsJobRoutes = require('./routes/customsJobs');
// Default charge sets per kind of client - see the route's header.
const customsChargeGroupRoutes = require('./routes/customsChargeGroups');
// Legacy LOG jobs -> Customs_Job. The customs-clearance equivalent of the
// jobs migration stage; see routes/lgJobMigration/index.js.
const lgJobMigrationRoutes = require('./routes/lgJobMigration/');
const directJobMigrationRoutes = require('./routes/directJobMigration/');
const taxInvoiceMigrationRoutes = require('./routes/taxInvoiceMigration/');
const vendorTaxInvoiceMigrationRoutes = require('./routes/vendorTaxInvoiceMigration/');
const employeeRoutes = require('./routes/employees/');
const nonGlParties = require('./routes/nonGlParties');
const assignedTasks = require('./routes/assignTasks');
const companyRoutes = require('./routes/companies/');
const accountRoutes = require('./routes/accounts/');
const historyRoutes = require('./routes/history/');
const clientRoutes = require('./routes/clients/');
const chargesRoutes = require('./routes/charges');
const voucherRoutes = require('./routes/voucher');
const ollamaRoutes = require('./routes/ollama');
const invoiceRoutes = require('./routes/invoice');
const vesselRoutes = require('./routes/vessel');
const documentRoutes = require('./routes/documents');
const manifest = require('./routes/manifest');
const authRoutes = require('./routes/auth/');
const ports = require('./routes/ports');
const destinations = require('./routes/destinations');
const airports = require('./routes/airports');
const fiscalYearRoutes = require('./routes/fiscalYears');
const reconciliationRoutes = require('./routes/reconciliation');
const awblRoutes = require('./routes/awbl');
const licenseRoutes = require('./routes/license');
const settingsRoutes = require('./routes/settings');
const printingTemplateRoutes = require('./routes/printingTemplates');
const creditControlRoutes = require('./routes/creditControl');
const whatsappRoutes = require('./routes/whatsapp');
const migrationRoutes = require('./routes/migration');
// The Archive - read-only screens over the old Climax books an install
// keeps beside its own. See routes/archive and functions/archive/books.
const archiveRoutes = require('./routes/archive');
const verify = require('./functions/tokenVerification');
const { requireSystem } = require('./functions/systemAccess');
const { fiscalYearContextMiddleware } = require('./functions/fiscalYearContext');
const licenseClient = require('./functions/license/client');
const { enforceLicense } = require('./functions/license/middleware');
const { enforcePermissions } = require('./functions/permissions/middleware');

/* -------------------- ASSOCIATIONS (SIDE EFFECTS) -------------------- */
require('./functions/Associations/jobAssociations/seaExport');
require('./functions/Associations/clientAssociation');
require('./functions/Associations/voucherAssociations');
require('./functions/Associations/incoiceAssociations');
require('./functions/Associations/NotificationAssociation');
require('./functions/Associations/taskAssociation');
require('./functions/Associations/vesselAssociations');
require('./functions/Associations/fiscalYearAssociations');
require('./functions/Associations/companyAssociations');
require('./functions/Associations/awblAssociations');
// Per-company master data: narrows list queries of the tables Seanet has
// separated to the company a request works in. See the file.
require('./functions/companySeparation').installHooks();

/* -------------------- BASIC PUBLIC ROUTES -------------------- */
app.get('/', (req, res) => {
  res.json('Welcome To Odyssey Server');
});

// Which build is this install running? Without this, a bug report from a
// customer site can't be tied to a version - INSTALL_ID identifies the install,
// not the code on it.
// The RELEASE - functions/appVersion.
const { appVersion } = require('./functions/appVersion');
app.get('/health', async (req, res) => {
  let database = 'down';
  try {
    await db.sequelize.authenticate();
    database = 'up';
  } catch (_) { /* leave as down */ }

  res.json({
    status: database === 'up' ? 'ok' : 'degraded',
    version: appVersion(),
    installId: process.env.INSTALL_ID || null,
    database,
    // 'off' here on a running server is expected - see models/index.js.
    schemaSync: db.syncMode,
    schemaError: db.syncError ? String(db.syncError.message || db.syncError) : null,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/* -------------------- GLOBAL AUTH MIDDLEWARE -------------------- */
// Update this list to match your actual public auth endpoints
// (e.g. login, register, forgot-password, health checks).
// Everything else mounted below will require a valid session.
const PUBLIC_PATHS = [
  '/authRoutes/login',
  // Seanet support sign-in with a signed credential - see functions/systemAccess.js.
  '/authRoutes/systemLogin',
  '/authRoutes/register',
  '/companies/getAllCompanies',
  // Build/version identity. Public on purpose: it is the first thing you ask a
  // customer for when they report a bug ("which build are you on?"), and it
  // must be answerable before anyone can log in. Carries no data - just the
  // version, the install id you already issued them, and liveness.
  '/health',
  // Not actually public: gated by its own short-lived, single-invoice print
  // token (see functions/printToken.js) instead of a login session, since
  // it's loaded by a headless browser with no session cookie (functions/pdf.js).
  '/invoice/getPrintData',
  // Same arrangement for the ledger: gated by its own short-lived token, which
  // carries WHICH ledger it may read inside it (see signLedgerPrintToken), and
  // loaded by the same headless browser with no session cookie.
  //
  // Leaving it out did not fail as "unauthorised" anywhere a reader would look:
  // verify() rejected it, the bare print page turned that into its generic
  // "this link is invalid or has expired", and the PDF endpoint reported a
  // rejected token. The one thing it was not was a token problem.
  '/accounts/getLedgerPrintData',
  // An attached document opened in a browser tab or an <img>: its own
  // short-lived token, for that one document (functions/printToken.js).
  '/documents/file',
];

app.use((req, res, next) => {
  // console.log('Checking path:', req.path, 'public?', PUBLIC_PATHS.includes(req.path));
  if (PUBLIC_PATHS.includes(req.path)) {
    return next();
  }
  return verify(req, res, next);
});

// Makes "which fiscal year does this user currently have selected" readable
// from anywhere in the request's async chain (see functions/fiscalYearContext.js)
// without threading it through every route/Sequelize call by hand.
app.use(fiscalYearContextMiddleware);

// Licence kill-switch: once the cloud licence server marks this install
// suspended and the 15-day warning window elapses, every write below is
// rejected with 423 while reads and invoice printing keep working. Placed
// after auth so req.user exists and login/logout stay usable (allow-listed
// inside enforceLicense). See functions/license/.
app.use(enforceLicense);

// Access control: every signed-in request is checked against the route table
// in functions/permissions/routeRules.js - which module and action it needs,
// or that it is open, or Seanet-only. In audit mode (the default until Seanet
// switches an install to enforce) refusals are logged, not applied.
app.use(enforcePermissions);

/* -------------------- AUTHENTICATED ROUTES -------------------- */
app.get('/getUser', (req, res) => {
  res.json({ isLoggedIn: true, username: req.body.username });
});

/* -------------------- MOUNT ROUTERS -------------------- */
app.use('/home', homeAccountRoutes, homeOperationsRoutes, homeDashboardRoutes);
app.use('/misc', miscPartiesRoutes, miscProfitLossRoutes, misctrialBalanceRoutes, miscVatDetailRoutes, miscAgentStatementRoutes);
app.use('/notifications', notificationRoutes);
app.use('/search', searchRoutes);
app.use('/employeeRoutes', employeeRoutes);
app.use('/nonGlParties', nonGlParties);
app.use('/accounts', accountRoutes);
app.use('/clientRoutes', clientRoutes);
app.use('/commodity', commodityRoutes);
app.use('/locations', locationMigrationRoutes);
app.use('/jobMigration', jobMigrationRoutes);
app.use('/blMigration', blMigrationRoutes);
app.use('/blChildMigration', blChildMigrationRoutes);
app.use('/jobEquipmentMigration', jobEquipmentMigrationRoutes);
app.use('/loadingProgramMigration', loadingProgramMigrationRoutes);
app.use('/chargeHeadMigration', chargeHeadMigrationRoutes);
app.use('/invoiceMigration', invoiceMigrationRoutes);
app.use('/ledgerMigration', ledgerMigrationRoutes);
app.use('/companies', companyRoutes);
app.use('/authRoutes', authRoutes);
app.use('/history', historyRoutes);
app.use('/charges', chargesRoutes);
app.use('/invoice', invoiceRoutes);
app.use('/voucher', voucherRoutes);
// The database chat. It hands a language model a SQL tool over the whole
// database - Sessions tokens and every other table included - so it is off
// unless an install asks for it, and then Seanet-only.
if (process.env.OLLAMA_ENABLED === 'true') {
  app.use('/ollama', requireSystem, ollamaRoutes);
}
app.use('/vessel', vesselRoutes);
app.use('/documents', documentRoutes);
app.use('/seaJob', seaJobRoutes);
app.use('/aviationJob', aviationJobRoutes);
app.use('/customsJob', customsJobRoutes);
app.use('/customsChargeGroups', customsChargeGroupRoutes);
app.use('/lgJobMigration', lgJobMigrationRoutes);
app.use('/directJobMigration', directJobMigrationRoutes);
app.use('/taxInvoiceMigration', taxInvoiceMigrationRoutes);
app.use('/vendorTaxInvoiceMigration', vendorTaxInvoiceMigrationRoutes);
app.use('/tasks', assignedTasks);
app.use('/manifest', manifest);
app.use('/ports', ports);
app.use('/destinations', destinations);
app.use('/airports', airports);
app.use('/fiscalYears', fiscalYearRoutes);
app.use('/reconciliation', reconciliationRoutes);
app.use('/awbl', awblRoutes);
app.use('/license', licenseRoutes);
app.use('/settings', settingsRoutes);
app.use('/printingTemplates', printingTemplateRoutes);
app.use('/creditControl', creditControlRoutes);
app.use('/whatsapp', whatsappRoutes);
// Staged legacy migration: verification counts + linkage checks (admin only).
app.use('/migration', migrationRoutes);
app.use('/archive', archiveRoutes);

/* -------------------- ERROR HANDLER -------------------- */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    status: 'error',
    error: err.message || 'Internal Server Error',
  });
});

/* -------------------- CRASH GUARD -------------------- */
// Since Node 15 an unhandled promise rejection terminates the process. This
// codebase still has `array.forEach(async x => { await something })` loops:
// forEach discards the promise its callback returns, so nothing awaits it and
// nothing catches it, and the surrounding try/catch has already exited by the
// time it settles. One bad payload - a charge row missing its SEJobId, say -
// therefore took the entire server down for every user.
//
// Logging and staying up is the pre-Node-15 behaviour and the right trade here:
// a single malformed request must not be able to end the process. It is a net,
// not a fix - each logged rejection is a real bug and should be traced back to
// the route that produced it.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] a promise rejected with nobody listening:');
  console.error(reason instanceof Error ? reason.stack : reason);
});

/* -------------------- SERVER CREATION -------------------- */
const args = process.argv.slice(2);
const portArgIndex = args.findIndex(arg => arg === '-p' || arg === '--port');
const argPort = portArgIndex !== -1 ? Number(args[portArgIndex + 1]) : NaN;
const PORT = Number.isInteger(argPort) ? argPort : Number(process.env.PORT) || 8084;

async function start() {
  try {
    // Just prove the connection works. The schema sync is NOT here - it fires
    // as a side effect of requiring ./models at the top of this file, and
    // models/index.js decides whether to actually run it (skipped in cluster
    // workers and when ODYSSEY_SKIP_DB_SYNC=1, so exactly one process alters
    // the schema and no worker serves traffic against a half-altered one).
    await db.sequelize.authenticate();
    // Wait for that sync before serving: seedAdmin and the first requests both
    // assume the tables exist. Resolves immediately when the sync was skipped.
    await db.syncPromise;

    // Boot no longer ALTERs, so a column added to a model is not in the
    // database until someone applies it deliberately. Say so here rather than
    // letting it surface as 'column does not exist' on an unrelated query.
    await db.checkSchemaDrift();

    // First-load seeding: create a default admin account on a fresh install so
    // the system is ready to log into from the start. No-op once users exist.
    //
    // Skipped in cluster workers - server.js seeds once in the primary before
    // forking, the same way it runs the schema sync there. Without this every
    // worker raced the count-then-insert and a fresh install came up with one
    // admin account per core, each with a different password in the log.
    // seedAdminUser also takes an advisory lock, so this is belt and braces.
    try {
      if (require('cluster').isWorker) throw { __skip: true };
      const { seedAdminUser } = require('./functions/seedAdmin');
      const seed = await seedAdminUser();
      if (seed.created) {
        console.log(`[seed] created initial admin user '${seed.username}'`);
        if (seed.generatedPassword) {
          // Printed once, only on the boot that actually created the account.
          // ADMIN_SEED_PASSWORD was not set, so this is the only place the
          // operator can read it - it is stored as a bcrypt hash and is not
          // recoverable afterwards.
          console.log(
            '[seed] ============================================================\n' +
            `[seed]  Initial admin password: ${seed.generatedPassword}\n` +
            '[seed]  Shown once. Log in and change it now.\n' +
            '[seed] ============================================================'
          );
        }
      }
    } catch (err) {
      if (!err || !err.__skip) console.error('[seed] admin seeding failed:', err.message);
    }

    // Deadline escalation: nudge on the soft deadline, escalate on the hard
    // one. Safe to call from every worker - it takes a Postgres advisory lock,
    // so exactly one process does each sweep however many are running.
    try {
      require('./functions/taskEscalation').start();
    } catch (err) {
      console.error('[tasks] could not start deadline escalation:', err.message);
    }

    // Credit control's daily check and weekly report (Config > Credit
    // Control) - off until switched on there. Every worker ticks; each run is
    // claimed once, in the database - see functions/creditControl/scheduler.
    try {
      require('./functions/creditControl/scheduler').start();
    } catch (err) {
      console.error('[credit] could not start credit control:', err.message);
    }

    // The WhatsApp daily update (Config > WhatsApp) - off until switched on.
    try {
      require('./functions/whatsapp/runner').start();
    } catch (err) {
      console.error('[whatsapp] could not start the daily update:', err.message);
    }

    // Bring up the licence client (loads cached licence, does first heartbeat,
    // then polls). Never let a licensing hiccup stop the server from booting -
    // computeState() falls back to the bootstrap grace / cached licence.
    licenseClient.setAppVersion(require('./package.json').version);
    await licenseClient.start().catch(err =>
      console.error('[license] start failed:', err.message)
    );

    const server = http.createServer(app);

    // ✅ Critical socket tuning
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 70_000;
    server.maxConnections = 1000;

    server.listen(PORT, () => {
      console.log(`Worker ${process.pid} listening on ${PORT}`);
    });
  } catch (err) {
    console.error('Server startup failed:', err);
    process.exit(1);
  }
}

// Only auto-start the listener when this file is run directly (`node index.js`).
// Test files `require('../index')` to get the Express `app` for supertest,
// which starts its own ephemeral server per test - without this guard that
// require would ALSO try to bind the real dev port and call process.exit(1)
// on a failed authenticate(), fighting with an actual running dev server.
//
// NOTE: under bytecode (`node -r bytenode index.jsc`) require.main !== module,
// so this guard does NOT fire - the sealed build's launcher (build/dist/run.js)
// calls the exported start() explicitly instead.
if (require.main === module) {
  start();
}

module.exports = app;
module.exports.start = start;
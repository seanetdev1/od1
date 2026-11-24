// Shared per-test-file setup: verifies we're pointed at the isolated test
// database (never the real dev/prod one), waits for the schema sync that
// happens as a side effect of requiring ../models, and wipes any rows this
// test file seeded (marked with TEST_PREFIX) when it's done.
//
// Runs once per test file (Jest gives each test file its own module
// registry), which is why jest.config.js pins maxWorkers to 1 - all test
// files share the same odyssey-test database, so they must run sequentially
// to avoid racing each other's setup/teardown against shared tables.

if (process.env.NODE_ENV !== 'test') {
  throw new Error(
    'Refusing to run: NODE_ENV must be "test". Run tests via `npm test`, which sets this for you.'
  );
}

const config = require('../config/config').test;
if (!/test/i.test(config.database)) {
  throw new Error(
    `Refusing to run against database "${config.database}" - it doesn't look like a test database. ` +
    'Check the "test" block in config/config.js (override the name with DB_NAME_TEST).'
  );
}

// The name check above is not enough on its own. A working database called
// "odyssey-test" passes it, and if DB_NAME_TEST is left equal to DB_NAME the
// suite runs against the database the application is using - where the afterAll
// below truncates every Session row, logging out everyone who is signed in, and
// deletes Employees and Clients.
//
// That is not hypothetical: it is what a .env with
//     DB_NAME=odyssey-test
//     DB_NAME_TEST=odyssey-test
// produces, and the only symptom is users being signed out for no reason.
const appDatabase = process.env.DB_NAME;
if (appDatabase && appDatabase === config.database) {
  throw new Error(
    `Refusing to run: DB_NAME_TEST resolves to "${config.database}", which is the same ` +
    'database DB_NAME points the application at. The suite truncates Sessions and ' +
    'deletes rows, so this would sign out every logged-in user and destroy data.\n\n' +
    'Set DB_NAME_TEST in .env to a separate throwaway database, e.g.\n' +
    `    DB_NAME_TEST=${appDatabase}-suite`
  );
}

const db = require('../models');

// Who is "system" (Seanet) depends on whether the install is exempt from
// licensing - on an exempt install the admin is. Pinned here rather than taken
// from .env, so the suite gives the same answers on a machine without
// LICENSE_EXEMPT; most suites sign in as admin to reach set-up routes, which is
// the exempt behaviour. tests/integration/systemLockdown.test.js switches to a
// leased install for itself.
require('../functions/systemAccess')._setConfigForTest({ LICENSE_EXEMPT: true });
const { Op } = require('sequelize');

const TEST_PREFIX = '__test__';

/**
 * Bring the throwaway test schema up to date.
 *
 * Boot sync runs in 'create' mode - CREATE TABLE IF NOT EXISTS - so it never
 * adds a column to a table that already exists. The test database is long
 * lived (it is truncated between runs, not dropped), so a shared table created
 * before a column was added keeps the old shape forever, and every INSERT then
 * fails with 42703 in a suite that has nothing to do with the change.
 *
 * That is what scripts/addAviationChargeHeadLink.js fixes on a real
 * installation. Doing the same thing here means a fresh checkout gets a green
 * suite without a manual migration step - a test database that needs one is a
 * trap, because the failure surfaces as unrelated 500s.
 *
 * ONLY the test database is touched: the guards at the top of this file refuse
 * to run unless the configured database is a test one AND is not the database
 * the application itself points at. Additive only - nothing is dropped.
 */
async function reconcileTestSchema() {
  const qi = db.sequelize.getQueryInterface();
  // The vendor's tax invoice number on a bill - shipped for real installs as
  // invoice-vendor-tax-invoice.sql in each deploy folder.
  const invoiceCols = await qi.describeTable('Invoices');
  if (!invoiceCols.vendorTaxInvoiceNo) {
    await qi.addColumn('Invoices', 'vendorTaxInvoiceNo', { type: db.Sequelize.DataTypes.STRING, allowNull: true });
  }
  // Who made each record and who last changed it (functions/auditStamps) -
  // shipped for real installs as audit-columns.sql in each deploy folder. The
  // customs and aviation jobs get theirs from the boot reconcile.
  // The job's USD buying rate - job-buying-rate.sql on a real install.
  const jobCols = await qi.describeTable('SE_Jobs');
  if (!jobCols.exRateBuying) {
    await qi.addColumn('SE_Jobs', 'exRateBuying', { type: db.Sequelize.DataTypes.STRING, allowNull: true });
  }
  // The payment or receipt a cheque return reverses - upgrade-1.2.63.sql.
  const voucherCols = await qi.describeTable('Vouchers');
  if (!voucherCols.returnOfId) {
    await qi.addColumn('Vouchers', 'returnOfId', { type: db.Sequelize.DataTypes.INTEGER, allowNull: true });
  }
  for (const table of ['SE_Jobs', 'Vouchers', 'Invoices', 'Charge_Heads']) {
    const have = await qi.describeTable(table);
    for (const [column, type] of [['createdBy', 'STRING'], ['createdOn', 'DATE'], ['editedBy', 'STRING'], ['editedOn', 'DATE']]) {
      if (!have[column]) await qi.addColumn(table, column, { type: db.Sequelize.DataTypes[type], allowNull: true });
    }
  }
  const cols = await qi.describeTable('Charge_Heads');

  if (!cols.AviationConsignmentId) {
    await qi.addColumn('Charge_Heads', 'AviationConsignmentId', {
      type: db.Sequelize.DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'Aviation_Consignments', key: 'id' },
      onDelete: 'CASCADE',
    });
  }

  // An aviation charge hangs off a consignment, not an SE_Job.
  if (cols.SEJobId && !cols.SEJobId.allowNull) {
    await db.sequelize.query(
      'ALTER TABLE "Charge_Heads" ALTER COLUMN "SEJobId" DROP NOT NULL'
    );
  }

  /* Direct Job E/R in every operation mode.
   *
   * Job_Id was NOT NULL with a foreign key to SE_Jobs, which made the screen
   * freight-only: under aviation and customs the jobs are in Aviation_Jobs and
   * Customs_Jobs, and no id from either could legally go in the column. One
   * nullable column per kind, exactly one set - the shape Charge_Heads above
   * already uses. Shipped for real installs as
   * ifa-deploy/direct-job-all-modes.sql. */
  const dja = await qi.describeTable('Direct_Job_Association');

  if (!dja.AviationJobId) {
    await qi.addColumn('Direct_Job_Association', 'AviationJobId', {
      type: db.Sequelize.DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'Aviation_Jobs', key: 'id' },
    });
  }

  if (!dja.CustomsJobId) {
    await qi.addColumn('Direct_Job_Association', 'CustomsJobId', {
      type: db.Sequelize.DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'Customs_Jobs', key: 'id' },
    });
  }

  if (dja.Job_Id && !dja.Job_Id.allowNull) {
    await db.sequelize.query(
      'ALTER TABLE "Direct_Job_Association" ALTER COLUMN "Job_Id" DROP NOT NULL'
    );
  }
}

/* LONGER THAN testTimeout, and only here.
 *
 * Every integration FILE re-requires ../models and so pays for the schema sync
 * again - the main create, then the aviation reconcile, then the customs one,
 * then the columns above. maxWorkers is 1, so those syncs run one after
 * another for the whole suite; when one overruns, EVERY test in that file
 * fails on the hook rather than on anything it was checking, naming the
 * feature it was about rather than the setup that never finished. Raised here
 * rather than in jest.config.js: the sync is the one thing that legitimately
 * takes this long, and loosening the global timeout would let a genuinely hung
 * test sit for minutes instead.
 *
 * 150s, WAS 60s. Measured on the development machine against a warm local
 * Postgres: 34s before the PFM module, 40-42s after it. The two extra models
 * cost about 7s because each one adds a full alter cycle - a describeTable,
 * an index read, then whatever DDL follows - and 42s of a 60s budget is not a
 * budget. It went over on a handful of files, every time as a block of
 * timeouts with nothing to do with each other.
 *
 * THIS NUMBER IS NOT THE FIX, it is headroom. The cost grows with every model
 * added to AVIATION_MODELS or CUSTOMS_MODELS in models/index.js and is paid
 * once per integration FILE, so raising it again will eventually be the wrong
 * answer. What that would want instead is for the reconcile to skip the alter
 * when the schema already matches the models - db.checkSchemaDrift already
 * asks that question read-only - which is a change to how the app boots in
 * production and belongs in its own piece of work rather than in a test
 * helper. Raising this changes only when jest gives up; nothing here runs any
 * slower or faster for it. */
const SCHEMA_SYNC_TIMEOUT = 150000;

beforeAll(async () => {
  // db.ready, not db.syncPromise: the aviation reconcile chains AFTER the main
  // sync resolves, so awaiting the main one alone starts the tests while the
  // Aviation_* tables are still being built.
  await db.ready;
  await reconcileTestSchema();
}, SCHEMA_SYNC_TIMEOUT);

afterAll(async () => {
  const like = { [Op.like]: `${TEST_PREFIX}%` };
  await db.Clients.destroy({ where: { name: like } });
  // Sessions are keyed by userId with no FK, so they don't block the Employees
  // delete below - but leaving them behind would let one test file's session
  // rows leak into the next one's "is this user logged in" assertions.
  await db.Session.destroy({ where: {}, truncate: true });

  // History rows reference the employee that caused them, and routes write
  // them through createHistory WITHOUT awaiting it - so a test file cannot
  // reliably clear its own: the insert can land after that file's afterAll has
  // already run. Clearing them here, immediately before the employees they
  // point at, is the only place that is race-free.
  // Plus the hidden accounts a support login creates (routes/auth
  // /systemLogin), whose username is __system__:<name from the credential> -
  // test credentials put the prefix in the name.
  const employeeLike = { [Op.or]: [like, { [Op.like]: `__system__:${TEST_PREFIX}%` }] };
  const testEmployees = await db.Employees.findAll({
    where: { username: employeeLike }, attributes: ['id'],
  });
  if (testEmployees.length) {
    const ids = testEmployees.map((e) => e.id);
    await db.History.destroy({ where: { EmployeeId: ids } });
    // Granted to test users, and the refusals logged against them
    // (functions/permissions) - neither is a foreign key that would block the
    // delete below, but both would pile up in the test database.
    await db.Access_Levels.destroy({ where: { EmployeeId: ids } });
    await db.Permission_Denial.destroy({ where: { EmployeeId: ids } });
  }

  // A test file that leaves a row pointing at its employee makes this fail,
  // and Sequelize surfaces the foreign-key violation with an empty message -
  // which reads as "test suite failed to run" with no cause at all. Naming the
  // table and constraint turns that into something a person can act on.
  try {
    await db.Employees.destroy({ where: { username: employeeLike } });
  } catch (err) {
    const pg = err.original || err.parent || {};
    if (pg.table || pg.constraint) {
      throw new Error(
        `Teardown could not delete the test employee: "${pg.table}" still references it ` +
        `(constraint ${pg.constraint}). The test file that created those rows must ` +
        `delete them in its own afterAll.\n${pg.detail || ''}`
      );
    }
    throw err;
  }
  await db.sequelize.close();
});

module.exports = { db, TEST_PREFIX };

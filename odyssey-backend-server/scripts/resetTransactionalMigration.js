/**
 * Clear the transactional half of a migration so it can be re-run cleanly.
 *
 *   node scripts/resetTransactionalMigration.js            <- report only
 *   node scripts/resetTransactionalMigration.js --apply    <- actually clear
 *
 * WHY THIS EXISTS
 *
 * The first migration run produced data that cannot be repaired in place:
 *
 *   - every Charge_Head had InvoiceId null, because the backend lookup cache
 *     was populated while the Invoice table was still empty and never reset;
 *   - every Invoice had VoucherId and SEJobId null and paid/recieved 0,
 *     because /importI never set them;
 *   - SE and SI jobs were missing entirely, because every one of their batches
 *     failed on a foreign-key violation and the loop swallowed the error.
 *
 * All three are fixed in the import path. None of the fixes repair existing
 * rows, because every importer skips records whose climaxId is already present
 * - that guard is what makes a re-run safe, and it also makes a re-run a no-op
 * against bad data. So the bad rows have to go before the corrected import can
 * put good ones in their place.
 *
 * WHAT IT DOES NOT TOUCH
 *
 * Reference data - companies, employees, clients, commodities, vessels,
 * voyages, chart of accounts, charges, ports - imported correctly and is what
 * everything else resolves against. Re-importing it would be slow and would
 * renumber ids that the jobs and invoices are about to point at. It stays.
 *
 * This clears only what the jobs/vouchers/invoices stages create.
 *
 * SAFETY
 *
 * Refuses to run against a database that contains rows these tables did not
 * get from the migration (climaxId IS NULL), because those are records someone
 * entered in Odyssey and this script would destroy them. Override with
 * --force-non-migrated only if you are certain the database is migration-only.
 */

const path = require('path');
const { Client } = require('pg');
const { Utils: { pluralize } } = require('sequelize');

// Read the connection from the app's own config rather than re-deriving it from
// environment variables. The env keys are DB_USER/DB_PASS, not the DB_PASSWORD
// a fresh script would reach for, and config/config.js is the single place that
// mapping is already correct - including which database NODE_ENV selects.
const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force-non-migrated');

// Model names, NOT table names. Sequelize pluralizes when it creates a table,
// so the model Invoice lives in "Invoices" and SE_Job in "SE_Jobs" - while
// Vouchers and Voucher_Heads are already plural and are unchanged. Looking
// these up by model name found only the ones that happen to end in "s" and
// reported the rest as absent, which would have cleared the vouchers and left
// every table holding the bad data untouched.
//
// resolveTableName uses Sequelize's own pluralizer - the same function that
// named the tables in the first place - and then confirms the result against
// information_schema rather than trusting it.
//
// Child-first. Postgres will reject a delete that orphans a foreign key, so the
// order is not cosmetic.
const TABLES = [
  { name: 'Invoice_Transactions', hasClimaxId: false },
  { name: 'Voucher_Heads',        hasClimaxId: true  },
  { name: 'Charge_Head',          hasClimaxId: true  },
  { name: 'Invoice',              hasClimaxId: true  },
  { name: 'Vouchers',             hasClimaxId: true  },
  { name: 'Container_Info',       hasClimaxId: true  },
  { name: 'SE_Equipments',        hasClimaxId: true  },
  { name: 'Stamps',               hasClimaxId: true  },
  { name: 'Bl',                   hasClimaxId: true  },
  { name: 'SE_Job',               hasClimaxId: true  },
];

async function main() {
  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    user: cfg.username,
    password: cfg.password,
    database: cfg.database,
  });

  await client.connect();
  console.log(`\nDatabase: ${cfg.database} on ${cfg.host} (NODE_ENV=${env})`);
  console.log(APPLY ? 'Mode: APPLY (rows will be deleted)\n' : 'Mode: REPORT ONLY (nothing will change)\n');

  // Every table actually in the database, so a model name can be matched
  // against reality instead of against a guess.
  const actual = new Map(
    (await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )).rows.map((r) => [r.table_name.toLowerCase(), r.table_name])
  );

  /** Model name -> real table name, or null if nothing in the database matches. */
  const resolveTableName = (modelName) => {
    for (const candidate of [pluralize(modelName), modelName]) {
      const found = actual.get(String(candidate).toLowerCase());
      if (found) return found;
    }
    return null;
  };

  // Resolve everything before touching anything. A table this script cannot
  // find is a reason to stop, not to carry on with the rest - clearing a
  // partial set would leave dangling references and an unusable database.
  const unresolved = [];
  for (const t of TABLES) {
    t.table = resolveTableName(t.name);
    if (!t.table) unresolved.push(t.name);
  }
  if (unresolved.length) {
    console.error(
      `REFUSING TO RUN: no table in ${cfg.database} matches these model(s):\n` +
      unresolved.map((n) => `  ${n}  (tried "${pluralize(n)}" and "${n}")`).join('\n') +
      `\n\nThe database may not be fully migrated, or a model was renamed.\n` +
      `Nothing has been changed.\n`
    );
    await client.end();
    process.exit(1);
  }

  let totalRows = 0;
  let handEntered = 0;
  const present = TABLES;

  console.log('  TABLE                     ROWS      MIGRATED   HAND-ENTERED');
  console.log('  ' + '-'.repeat(62));

  for (const t of TABLES) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM public."${t.table}"`);
    const n = rows[0].n;
    totalRows += n;

    let migrated = null, manual = null;
    if (t.hasClimaxId) {
      const r = await client.query(
        `SELECT COUNT(*) FILTER (WHERE "climaxId" IS NOT NULL)::int AS m,
                COUNT(*) FILTER (WHERE "climaxId" IS NULL)::int     AS h
           FROM public."${t.table}"`
      );
      migrated = r.rows[0].m;
      manual = r.rows[0].h;
      handEntered += manual;
    }

    console.log(
      `  ${t.table.padEnd(24)} ${String(n).padStart(8)}   ${String(migrated ?? '-').padStart(8)}   ${String(manual ?? '-').padStart(8)}`
    );
  }

  console.log('  ' + '-'.repeat(62));
  console.log(`  ${'TOTAL'.padEnd(24)} ${String(totalRows).padStart(8)}\n`);

  if (handEntered > 0 && !FORCE) {
    console.error(
      `REFUSING TO RUN: ${handEntered} row(s) have no climaxId, which means they\n` +
      `were created in Odyssey rather than migrated. This script would delete them.\n\n` +
      `If this database really is migration-only and those rows are import artefacts,\n` +
      `re-run with --force-non-migrated. Otherwise investigate them first.\n`
    );
    await client.end();
    process.exit(1);
  }

  if (!APPLY) {
    console.log('Re-run with --apply to delete the rows above.\n');
    console.log('Then re-run the migration from Config > Migration in this order:');
    console.log('  1. Vouchers, Voucher Heads & Invoices');
    console.log('  2. Jobs (with B/Ls and charge lines)');
    console.log('\nJobs MUST come second - charge lines resolve their invoice by');
    console.log('looking it up, so the invoices have to exist first.\n');
    await client.end();
    return;
  }

  // One transaction: a partial clear would leave dangling references and put
  // the database in a state neither the old data nor a fresh import can use.
  await client.query('BEGIN');
  try {
    for (const t of present) {
      const r = await client.query(`DELETE FROM public."${t.table}"`);
      console.log(`  cleared ${String(r.rowCount).padStart(8)} from ${t.table}`);
    }
    await client.query('COMMIT');
    console.log('\nDone. All cleared in a single transaction.\n');
    console.log('Now re-run the migration from Config > Migration in this order:');
    console.log('  1. Vouchers, Voucher Heads & Invoices');
    console.log('  2. Jobs (with B/Ls and charge lines)\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nFAILED - rolled back, nothing was deleted:\n ', err.message, '\n');
    process.exitCode = 1;
  }

  await client.end();
}

main().catch((err) => {
  console.error('\nScript failed:', err.message, '\n');
  process.exit(1);
});

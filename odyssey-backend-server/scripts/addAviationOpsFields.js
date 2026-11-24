#!/usr/bin/env node
/**
 * Schema changes for the IFA operations round: commodity type, and an
 * optional airport city.
 *
 * WHAT AND WHY
 *
 *   Commodities.commodityType   Perishable or Dry. Decides what happens to an
 *                               offload: dry cargo waits for the next aircraft
 *                               and stays outstanding, perishable cargo is
 *                               returned to the master agent and is not owed
 *                               to anyone. Read by
 *                               functions/aviationPendingLoads (the dashboard's
 *                               outstanding-loads list) and by
 *                               routes/aviationJobs/awb (the carry-forward
 *                               dropdown). NULL means Dry, so every commodity
 *                               that already exists keeps behaving exactly as
 *                               it does today.
 *
 *   Airports.city               Made NULLABLE. An aviation install does not ask
 *                               for it - an airport is identified by its code
 *                               and its country - so the column has to accept
 *                               NULL or creating an airport from that screen
 *                               fails with 23502. Nothing is dropped: the
 *                               freight and customs screens still record it and
 *                               every existing row keeps its value.
 *
 * WHY NOT ODYSSEY_DB_SYNC=alter
 *
 * Both live on SHARED tables. Those are synced with plain sequelize.sync(),
 * which is CREATE TABLE IF NOT EXISTS and never issues an ALTER, so an
 * existing database never gets them. Turning on the global alter to add one
 * column would reconcile two hundred tables against their models on a live
 * database - and it reconciles them SEQUENTIALLY, stopping at the first
 * failure, so any pre-existing drift silently skips every model after it.
 *
 * (The aviation tables are different: models/index.js alter-syncs those five on
 * every boot, so Aviation_Consignment.offloadPieces and the Aviation_Job
 * charter columns arrive on their own with a restart. Nothing to do for them.)
 *
 * UNTIL THIS RUNS, the aviation dashboard and the AWB dropdown both fail with
 *   column Commodity.commodityType does not exist   (Postgres 42703)
 * because their queries join the commodity to read the type.
 *
 * Safe to run more than once: the column add is IF NOT EXISTS, and the NOT
 * NULL drop is checked first and skipped when it is already nullable.
 *
 * Pass --test to target the test database (DB_NAME_TEST) instead.
 *
 *   node scripts/addAviationOpsFields.js            # dry run - shows the SQL
 *   node scripts/addAviationOpsFields.js --apply
 */

require('dotenv').config();
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const USE_TEST_DB = process.argv.includes('--test');

// [table, column, DDL type] - each added only if its table exists.
const COLUMNS = [
  ['Commodities', 'commodityType', 'VARCHAR(255)'],
];

// [table, column] - columns that must accept NULL.
const DROP_NOT_NULL = [
  ['Airports', 'city'],
];

const tableExists = async (client, table) => {
  const { rows } = await client.query(
    'SELECT to_regclass($1) AS oid', [`public."${table}"`],
  );
  return Boolean(rows[0].oid);
};

(async () => {
  const database = USE_TEST_DB ? process.env.DB_NAME_TEST : process.env.DB_NAME;
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database,
  });

  try {
    await client.connect();
    console.log(`database: ${database}`);
    console.log('');

    const addPlanned = [];
    const nullPlanned = [];

    for (const [table, column, type] of COLUMNS) {
      if (!await tableExists(client, table)) {
        console.log(`${table}.${column}: table does not exist - skipping.`);
        continue;
      }
      const { rows } = await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = $1 AND column_name = $2`,
        [table, column],
      );
      if (rows.length) {
        console.log(`${table}.${column}: present`);
      } else {
        console.log(`${table}.${column}: MISSING`);
        addPlanned.push([table, column, type]);
      }
    }

    for (const [table, column] of DROP_NOT_NULL) {
      if (!await tableExists(client, table)) {
        console.log(`${table}.${column}: table does not exist - skipping.`);
        continue;
      }
      const { rows } = await client.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = $1 AND column_name = $2`,
        [table, column],
      );
      if (!rows.length) {
        // Already gone entirely - nothing to relax.
        console.log(`${table}.${column}: column does not exist - skipping.`);
      } else if (rows[0].is_nullable === 'YES') {
        console.log(`${table}.${column}: already nullable`);
      } else {
        console.log(`${table}.${column}: NOT NULL - needs relaxing`);
        nullPlanned.push([table, column]);
      }
    }

    if (!addPlanned.length && !nullPlanned.length) {
      console.log('');
      console.log('Nothing to do.');
      return;
    }

    if (!APPLY) {
      console.log('');
      console.log('Dry run - nothing changed. Re-run with --apply to make these changes:');
      for (const [table, column, type] of addPlanned) {
        console.log(`  ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type};`);
      }
      for (const [table, column] of nullPlanned) {
        console.log(`  ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP NOT NULL;`);
      }
      return;
    }

    console.log('');
    for (const [table, column, type] of addPlanned) {
      await client.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type}`,
      );
      console.log(`Added "${table}"."${column}".`);
    }
    for (const [table, column] of nullPlanned) {
      await client.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP NOT NULL`,
      );
      console.log(`"${table}"."${column}" now accepts NULL.`);
    }

    console.log('Done.');
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();

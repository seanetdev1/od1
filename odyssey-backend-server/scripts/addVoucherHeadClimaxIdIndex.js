#!/usr/bin/env node
/**
 * Add the missing index on Voucher_Heads.climaxId.
 *
 * WHY IT IS MISSING
 *
 * models/Voucher_Heads.js declared it in a THIRD argument to define():
 *
 *   sequelize.define("Voucher_Heads", { ...columns }, { hooks: {...} },
 *                    { indexes: [{ fields: ['climaxId'] }] })   <- ignored
 *
 * define() takes only two arguments after the name, so the fourth was silently
 * dropped and the index was never created on any install. Exactly the mistake
 * SE_Job had - see addJobClimaxIdIndex.js. The model has been corrected, but
 * ODYSSEY_DB_SYNC=create only issues CREATE TABLE IF NOT EXISTS and never
 * touches a table that already exists, so existing databases need this.
 *
 * WHY IT MATTERS: the ledger stage resolves each of 38,330 settlements to its
 * voucher through Voucher_Heads.climaxId (the legacy GL_Voucher_Detail id),
 * and checks the same column to skip heads it has already imported. Without
 * the index each of those is a sequential scan over 121,967 rows.
 *
 * The column already exists - only the index is missing - so this is
 * index-only and touches no data. Safe to run more than once. Uses CREATE
 * INDEX CONCURRENTLY, which does not lock the table against writes, so it
 * cannot run inside a transaction; that is deliberate.
 *
 * Pass --test to target the test database (DB_NAME_TEST) instead. The test
 * database is created by the same sync that never alters, so it drifts in
 * exactly the same way and needs the same change.
 *
 *   node scripts/addVoucherHeadClimaxIdIndex.js            # dry run
 *   node scripts/addVoucherHeadClimaxIdIndex.js --apply
 */

require('dotenv').config();
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const USE_TEST_DB = process.argv.includes('--test');
const TABLE = 'Voucher_Heads';
const COLUMN = 'climaxId';
const INDEX = 'voucher_heads_climax_id';

(async () => {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: USE_TEST_DB ? process.env.DB_NAME_TEST : process.env.DB_NAME,
  });

  try {
    await client.connect();
    console.log(`database: ${USE_TEST_DB ? process.env.DB_NAME_TEST : process.env.DB_NAME}`);

    const { rows: tableRows } = await client.query(
      'SELECT to_regclass($1) AS oid',
      [`public."${TABLE}"`],
    );
    if (!tableRows[0].oid) {
      console.error(`Table "${TABLE}" does not exist. Nothing to do.`);
      process.exit(1);
    }

    const { rows: colRows } = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2`,
      [TABLE, COLUMN],
    );
    if (!colRows.length) {
      // Unexpected: the column is declared in the model's attribute list, so a
      // table created by sync has it. Say so rather than adding it silently.
      console.error(`Column "${TABLE}"."${COLUMN}" is missing, which is not what this script expects.`);
      process.exit(1);
    }

    const { rows: idxRows } = await client.query(
      'SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2',
      [TABLE, INDEX],
    );
    if (idxRows.length) {
      console.log(`index "${INDEX}": present. Nothing to do.`);
      return;
    }

    console.log(`index "${INDEX}": MISSING`);

    if (!APPLY) {
      console.log('');
      console.log('Dry run - nothing changed. Re-run with --apply to make this change:');
      console.log(`  CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX} ON "${TABLE}" ("${COLUMN}");`);
      return;
    }

    // Not unique: a legacy id is only unique within its own source table, and
    // heads created inside Odyssey carry null.
    await client.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX} ON "${TABLE}" ("${COLUMN}")`,
    );
    console.log(`Created index ${INDEX}.`);
    console.log('Done.');
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();

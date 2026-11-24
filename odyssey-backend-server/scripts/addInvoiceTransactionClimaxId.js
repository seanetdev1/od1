#!/usr/bin/env node
/**
 * Add Invoice_Transactions.climaxId, plus its index.
 *
 * WHY IT IS NEEDED
 *
 * An Invoice_Transaction is one act of paying or receiving against an invoice,
 * imported from GL_InvAdjustments. Every other migrated table carries the
 * legacy row id in climaxId, which is what makes a stage re-runnable: rows
 * already imported are matched on it and skipped.
 *
 * This table has no such column, so the old importer approximated it by
 * checking whether a transaction already existed for the (Invoice, Voucher)
 * pair. That is nearly right, and wrong in the case that matters: when one
 * voucher settles the same invoice twice - a part payment followed by another
 * against the same invoice - the second is indistinguishable from a re-run of
 * the first, so it is silently dropped and the invoice reads as underpaid.
 *
 * With the legacy id present, a re-run skips exactly what it already wrote and
 * nothing else.
 *
 * ODYSSEY_DB_SYNC=create only issues CREATE TABLE IF NOT EXISTS and never
 * alters a table that already exists, so an existing database needs this.
 *
 * Safe to run more than once: both statements are IF NOT EXISTS. The index is
 * created CONCURRENTLY, which does not lock the table against writes - so it
 * cannot run inside a transaction, and that is deliberate.
 *
 * Pass --test to target the test database (DB_NAME_TEST) instead. The test
 * database is created by the same sync that never alters, so it drifts in
 * exactly the same way and needs the same change.
 *
 *   node scripts/addInvoiceTransactionClimaxId.js            # dry run
 *   node scripts/addInvoiceTransactionClimaxId.js --apply
 */

require('dotenv').config();
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const USE_TEST_DB = process.argv.includes('--test');
const TABLE = 'Invoice_Transactions';
const COLUMN = 'climaxId';
const INDEX = 'invoice_transactions_climax_id';

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
    const hasColumn = colRows.length > 0;

    const { rows: idxRows } = await client.query(
      'SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2',
      [TABLE, INDEX],
    );
    const hasIndex = idxRows.length > 0;

    console.log(`column "${COLUMN}": ${hasColumn ? 'present' : 'MISSING'}`);
    console.log(`index  "${INDEX}": ${hasIndex ? 'present' : 'MISSING'}`);

    if (hasColumn && hasIndex) {
      console.log('Nothing to do.');
      return;
    }

    if (!APPLY) {
      console.log('');
      console.log('Dry run - nothing changed. Re-run with --apply to make these changes:');
      if (!hasColumn) {
        console.log(`  ALTER TABLE "${TABLE}" ADD COLUMN IF NOT EXISTS "${COLUMN}" INTEGER;`);
      }
      if (!hasIndex) {
        console.log(`  CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX} ON "${TABLE}" ("${COLUMN}");`);
      }
      return;
    }

    if (!hasColumn) {
      // Nullable on purpose: transactions created inside Odyssey have no
      // legacy row behind them and must stay creatable.
      await client.query(
        `ALTER TABLE "${TABLE}" ADD COLUMN IF NOT EXISTS "${COLUMN}" INTEGER`,
      );
      console.log(`Added "${TABLE}"."${COLUMN}".`);
    }

    if (!hasIndex) {
      // Not unique: a legacy id is only unique within its own source table,
      // and rows created in Odyssey carry null.
      await client.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX} ON "${TABLE}" ("${COLUMN}")`,
      );
      console.log(`Created index ${INDEX}.`);
    }

    console.log('Done.');
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();

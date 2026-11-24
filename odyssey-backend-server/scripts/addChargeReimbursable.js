#!/usr/bin/env node
/**
 * Add Charges.reimbursable, and Customs_Jobs.goodsDescription.
 *
 * WHY THEY ARE NEEDED
 *
 *   Charges.reimbursable      Is this charge a PASS-THROUGH DISBURSEMENT rather
 *                             than revenue? A clearing agent pays duty, sales
 *                             tax, wharfage, port and terminal charges on the
 *                             client's behalf and recharges them at cost. Those
 *                             are a recoverable asset, not income, and on a
 *                             goods declaration they dwarf the agency fee.
 *                             Read at approval time by routes/invoice, which
 *                             sends those lines to the bucket's `disbursement`
 *                             account instead of income/expense.
 *
 *   Customs_Jobs.goodsDescription
 *                             What was declared, in the filer's own words.
 *                             Previously folded into `remarks` as a fallback,
 *                             which dropped it outright on any job carrying
 *                             both.
 *
 * WHY NOT ODYSSEY_DB_SYNC=alter
 *
 * Because it does not work on a database with any pre-existing drift, and
 * ours has some. sync() reconciles models SEQUENTIALLY and stops at the first
 * failure, so one bad table blocks every model after it. On this database that
 * is Task_Attachments: it holds a row whose TaskId has no matching Tasks row,
 * so `ALTER TABLE "Task_Attachments" ADD FOREIGN KEY ("TaskId")` fails with
 * 23503, sync aborts, and Charges - which syncs later - is never reached. The
 * banner reports the failure but the missing column is still missing.
 *
 * Adding the two columns directly cannot be derailed by unrelated drift, and
 * is what should run on a customer install anyway: a sealed production
 * database should not be ALTERing two hundred tables to add one boolean.
 *
 * ODYSSEY_DB_SYNC=create only issues CREATE TABLE IF NOT EXISTS and never
 * alters a table that already exists, so an existing database needs this.
 *
 * Both columns are NULLABLE / DEFAULT FALSE, so every existing row keeps
 * behaving exactly as it does today. Nothing is dropped and no row is rewritten.
 *
 * Safe to run more than once: both statements are IF NOT EXISTS.
 *
 * Pass --test to target the test database (DB_NAME_TEST) instead. It is created
 * by the same sync that never alters, so it drifts the same way.
 *
 *   node scripts/addChargeReimbursable.js            # dry run
 *   node scripts/addChargeReimbursable.js --apply
 */

require('dotenv').config();
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const USE_TEST_DB = process.argv.includes('--test');

// [table, column, DDL type] - each added only if its table exists.
const COLUMNS = [
  ['Charges', 'reimbursable', 'BOOLEAN NOT NULL DEFAULT FALSE'],
  ['Customs_Jobs', 'goodsDescription', 'TEXT'],
  // Port of final destination - beyond the port of discharge. On 7,414 of
  // CargoLinkers' 15,364 clearing jobs, and previously dropped for want of a
  // column. Stored as the UN/LOCODE, like pol and pod.
  ['Customs_Jobs', 'pofd', 'VARCHAR(255)'],
  // What a clearing agent's file actually records. The customs module was
  // designed before anyone had read a real one; these are Log_Job columns that
  // are populated on a substantial share of the book and had nowhere to land.
  // See models/Customs_Job.js for the coverage of each.
  ['Customs_Jobs', 'clientRef', 'VARCHAR(255)'],
  ['Customs_Jobs', 'jobRef', 'VARCHAR(255)'],
  ['Customs_Jobs', 'customFileNo', 'VARCHAR(255)'],
  ['Customs_Jobs', 'deliveryLocation', 'TEXT'],
  ['Customs_Jobs', 'terminal', 'VARCHAR(255)'],
  ['Customs_Jobs', 'cargoType', 'VARCHAR(255)'],
  ['Customs_Jobs', 'incoTerms', 'VARCHAR(255)'],
  ['Customs_Jobs', 'netWeight', 'DOUBLE PRECISION'],
  ['Customs_Jobs', 'carrierBookingNo', 'VARCHAR(255)'],
  ['Customs_Jobs', 'cancelReason', 'VARCHAR(255)'],
  ['Customs_Jobs', 'approvedOn', 'VARCHAR(255)'],
  ['Customs_Jobs', 'projectRef', 'VARCHAR(255)'],
  ['Customs_Jobs', 'invoiceRemarks', 'TEXT'],
  ['Customs_Jobs', 'grt', 'DOUBLE PRECISION'],
  ['Customs_Jobs', 'nrt', 'DOUBLE PRECISION'],
  ['Customs_Jobs', 'costCenter', 'VARCHAR(255)'],
  ['Customs_Jobs', 'mblNo', 'VARCHAR(255)'],
  ['Customs_Jobs', 'mblDate', 'VARCHAR(255)'],
  ['Customs_Jobs', 'shippingBillNo', 'VARCHAR(255)'],
  ['Customs_Jobs', 'shippingBillDate', 'VARCHAR(255)'],
  ['Customs_Jobs', 'gpDate', 'VARCHAR(255)'],
  ['Customs_Jobs', 'containerType', 'VARCHAR(255)'],
  ['Customs_Jobs', 'deliveryTerms', 'VARCHAR(255)'],
  ['Customs_Jobs', 'transporterId', 'INTEGER'],
  ['Customs_Jobs', 'localVendorId', 'INTEGER'],
  ['Customs_Jobs', 'chaChbId', 'INTEGER'],
  ['Customs_Jobs', 'shippingLineId', 'INTEGER'],
  ['Customs_Jobs', 'sailingDate', 'VARCHAR(255)'],
  ['Customs_Jobs', 'jobDate', 'VARCHAR(255)'],
  ['Customs_Jobs', 'jobType', 'VARCHAR(255)'],
  ['Customs_Jobs', 'regPageNo', 'VARCHAR(255)'],
  // Customs_Containers is NOT here. It is reconciled against its model on
  // every boot by the CUSTOMS_MODELS alter in models/index.js, which adds
  // whatever the model has grown since - columns, foreign key and all. Listing
  // one column here by hand is how the last round of this went: the missing
  // CustomsJobId was fixed, and truckNo was sitting right behind it.
];

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

    const planned = [];

    for (const [table, column, type] of COLUMNS) {
      const { rows: tableRows } = await client.query(
        'SELECT to_regclass($1) AS oid', [`public."${table}"`],
      );
      if (!tableRows[0].oid) {
        // Not an error. Customs_Jobs only exists once a 1.1.x build has booted,
        // and a fresh database gets the column from the model anyway.
        console.log(`${table}.${column}: table does not exist - skipping.`);
        continue;
      }

      const { rows: colRows } = await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = $1 AND column_name = $2`,
        [table, column],
      );

      if (colRows.length) {
        console.log(`${table}.${column}: present`);
      } else {
        console.log(`${table}.${column}: MISSING`);
        planned.push([table, column, type]);
      }
    }

    if (!planned.length) {
      console.log('');
      console.log('Nothing to do.');
      return;
    }

    if (!APPLY) {
      console.log('');
      console.log('Dry run - nothing changed. Re-run with --apply to make these changes:');
      for (const [table, column, type] of planned) {
        console.log(`  ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type};`);
      }
      return;
    }

    console.log('');
    for (const [table, column, type] of planned) {
      await client.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type}`,
      );
      console.log(`Added "${table}"."${column}".`);
    }

    console.log('Done.');
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();

#!/usr/bin/env node
/**
 * Add the missing index on SE_Jobs.climaxId.
 *
 * WHY IT IS MISSING
 *
 * models/SE_Job.js declared it in a THIRD argument to sequelize.define:
 *
 *   sequelize.define("SE_Job", { ...columns }, { indexes: [...] },
 *                    { indexes: [{ fields: ['climaxId'] }] })   <- ignored
 *
 * define() takes two arguments after the name, so the fourth was silently
 * dropped and the index was never created - on any install. The model has been
 * corrected, but ODYSSEY_DB_SYNC=create only issues CREATE TABLE IF NOT EXISTS
 * and never touches a table that already exists, so existing databases need
 * this.
 *
 * WHY IT MATTERS: every job import looks up already-imported jobs by climaxId
 * to stay idempotent, and the job migration's verify groups by it. Without the
 * index that is a sequential scan of the whole job table on every batch.
 *
 * Safe to run more than once. Uses CREATE INDEX CONCURRENTLY, which does not
 * lock the table against writes - so it cannot run inside a transaction, and
 * that is deliberate rather than an oversight.
 *
 *   node scripts/addJobClimaxIdIndex.js            # dry run, changes nothing
 *   node scripts/addJobClimaxIdIndex.js --apply
 */

require('dotenv').config();
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const TABLE = 'SE_Jobs';
const INDEX = 'se_jobs_climax_id';

(async () => {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  await client.connect();
  console.log(`\nDatabase: ${process.env.DB_NAME}\n`);

  const tableExists = (await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1`, [TABLE],
  )).rowCount > 0;

  if (!tableExists) {
    console.log(`  SKIP    "${TABLE}" does not exist - it will be created, with the index, on next boot.\n`);
    await client.end();
    return;
  }

  const indexExists = (await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename=$1 AND indexname=$2`,
    [TABLE, INDEX],
  )).rowCount > 0;

  if (indexExists) {
    console.log(`  exists  ${INDEX}\n`);
    await client.end();
    return;
  }

  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM public."${TABLE}"`);
  console.log(`  CREATE  ${INDEX} on "${TABLE}"("climaxId")  - ${rows[0].n} row(s) in the table`);

  if (!APPLY) {
    console.log('\nRe-run with --apply to make this change.\n');
    await client.end();
    return;
  }

  try {
    // CONCURRENTLY cannot run inside a transaction block, so there is no
    // BEGIN/COMMIT here. If it fails part way Postgres leaves an INVALID
    // index behind, which the DROP below clears on the next run.
    await client.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${INDEX}" ON public."${TABLE}" ("climaxId")`,
    );
    console.log(`  created ${INDEX}\n`);
  } catch (err) {
    console.error(`\nFAILED: ${err.message}`);
    console.error(
      `If this left an invalid index behind, clear it with:\n`
      + `  DROP INDEX CONCURRENTLY IF EXISTS public."${INDEX}";\n`,
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Repair the Transport / Custom Clearance checkboxes on migrated jobs.
 *
 *   node scripts/fixJobPartyChecks.js            <- diagnostics only, read-only
 *   node scripts/fixJobPartyChecks.js --apply    <- perform the fix
 *
 * THE FAILURE
 * The job importers wrote these two flags INVERTED - 'Transport' when the job
 * had no transporter, '' when it had one (same for 'Custom Clearance' and the
 * clearing agent). Booking Info ticks the box from the stored string, so:
 *
 *   - jobs with no transporter/agent show the box ticked over an empty dropdown
 *   - jobs WITH one show the box unticked, and CreateOrEdit.js keeps
 *     transporterId / customAgentId on save only while the box is ticked -
 *     so the next save of such a job silently nulls the party.
 *
 * WHAT THIS CHANGES
 * Each flag is re-derived from the id it describes:
 *   transportCheck = 'Transport'        iff transporterId IS NOT NULL
 *   customCheck    = 'Custom Clearance' iff customAgentId IS NOT NULL
 *
 * MIGRATED ROWS ONLY (climaxId IS NOT NULL). On a job keyed in Odyssey a user
 * may have ticked the box and not yet chosen the party; that is a legitimate
 * state and not this script's to overwrite.
 *
 * Idempotent: rows already agreeing with their ids are not selected.
 */

const path = require('path');
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];

const EXPECT_T = `CASE WHEN "transporterId" IS NOT NULL THEN 'Transport' ELSE '' END`;
const EXPECT_C = `CASE WHEN "customAgentId" IS NOT NULL THEN 'Custom Clearance' ELSE '' END`;
const WRONG = `"climaxId" IS NOT NULL AND (
    COALESCE("transportCheck", '') <> ${EXPECT_T}
 OR COALESCE("customCheck", '')    <> ${EXPECT_C})`;

async function main() {
  const client = new Client({
    host: cfg.host, port: cfg.port, user: cfg.username,
    password: cfg.password, database: cfg.database,
  });
  await client.connect();

  console.log('='.repeat(72));
  console.log(` database : ${cfg.database} @ ${cfg.host}:${cfg.port}  (NODE_ENV=${env})`);
  console.log(` mode     : ${APPLY ? 'APPLY - will modify data' : 'DIAGNOSTICS ONLY (read-only)'}`);
  console.log('='.repeat(72));

  const plan = await client.query(`
    SELECT ("transporterId" IS NOT NULL) AS has_transporter, "transportCheck" AS transport_now,
           ("customAgentId" IS NOT NULL) AS has_agent,       "customCheck"    AS custom_now,
           count(*)::int AS jobs
      FROM "SE_Jobs" WHERE ${WRONG}
     GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC`);

  if (!plan.rows.length) {
    console.log('\nNothing to fix - every migrated job\'s flags agree with its ids.');
    await client.end();
    return;
  }

  console.log('\nMigrated jobs whose flags disagree with their ids:\n');
  console.table(plan.rows);

  // The rows at risk of losing data on their next save.
  const atRisk = await client.query(`
    SELECT count(*)::int AS n FROM "SE_Jobs"
     WHERE "climaxId" IS NOT NULL
       AND (("transporterId" IS NOT NULL AND COALESCE("transportCheck", '') = '')
         OR ("customAgentId" IS NOT NULL AND COALESCE("customCheck", '') = ''))`);
  console.log(`\nJobs that would LOSE their transporter/agent on next save: ${atRisk.rows[0].n}`);

  if (!APPLY) {
    console.log('-'.repeat(72));
    console.log('Re-run with --apply to perform it:');
    console.log('    node scripts/fixJobPartyChecks.js --apply');
    await client.end();
    return;
  }

  console.log('\nApplying...');
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `UPDATE "SE_Jobs" SET "transportCheck" = ${EXPECT_T}, "customCheck" = ${EXPECT_C}
        WHERE ${WRONG}`
    );
    await client.query('COMMIT');
    console.log(`  done - ${res.rowCount} job(s) updated. Reload the job screen.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed and was rolled back:', err.message);
    process.exitCode = 1;
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

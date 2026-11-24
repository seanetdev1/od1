/**
 * Repair migrated jobs whose `freightType` holds the raw legacy FreightTypeId
 * instead of the label the Booking Info screen uses.
 *
 *   node scripts/fixJobFreightType.js            <- diagnostics only, read-only
 *   node scripts/fixJobFreightType.js --apply    <- perform the fix
 *
 * THE FAILURE
 * functions/jobMigrationPlan.js (and the four Upload*Jobs importers in
 * routes/jobRoutes/sea.js) wrote `freightType: row.FreightTypeId` - the legacy
 * id, 1 or 2. Booking Info's select offers 'Prepaid' and 'Collect', so an antd
 * Select handed '2' matches no option and renders the raw number.
 *
 * THE MAPPING
 *   1 -> Prepaid
 *   2 -> Collect
 *
 * There is no lookup table for this in CSUL_CLINK_PAK: no base table, no CASE
 * in any view, nothing in the legacy code. The mapping was established by
 * opening four migrated jobs in the legacy software and reading the value off
 * the screen - two sea export, two air export, agreeing on both:
 *
 *   SNS-SEJ-341/27  id 1  Prepaid      ACS-AE-629/27  id 1  Prepaid
 *   SNS-SEJ-348/27  id 2  Collect      SNS-AE-120/27  id 2  Collect
 *
 * That is why it is hardcoded in the importer rather than resolved: the ids
 * carry no meaning outside the application that defined them.
 *
 * A SECOND EFFECT, worth checking after this runs.
 * BookingInfo.js keys the Freight Payable At auto-fill off
 * `freightType == "Prepaid"`. While every job held a number that test never
 * passed, so opening any job filled Freight Payable At with 'Destination'.
 * After this fix a Prepaid job fills 'Karachi, Pakistan' instead. The form
 * only persists that on save, so nothing changes by itself - but a job saved
 * since the migration may be carrying the wrong value already.
 *
 * Idempotent: rows already holding a label are not selected.
 */

const path = require('path');
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];

// Must match the SelectComp options in BookingInfo.js.
const MAP = { 1: 'Prepaid', 2: 'Collect' };
const ALLOWED = Object.values(MAP);

const TABLES = ['SE_Jobs', 'SI_Jobs', 'AE_Jobs', 'AI_Jobs'];

async function tableExists(client, table) {
  const r = await client.query(`SELECT to_regclass($1) AS t`, [`public."${table}"`]);
  return r.rows[0].t !== null;
}

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

  const work = [];
  for (const table of TABLES) {
    if (!(await tableExists(client, table))) {
      console.log(`\n${table}: not present - skipped.`);
      continue;
    }
    const breakdown = await client.query(
      `SELECT "freightType", count(*)::int AS rows FROM "${table}" GROUP BY 1 ORDER BY 2 DESC`
    );
    console.log(`\n${table}:`);
    console.table(breakdown.rows.map((r) => ({
      freightType: r.freightType,
      rows: r.rows,
      becomes: Object.prototype.hasOwnProperty.call(MAP, r.freightType)
        ? MAP[r.freightType]
        : ALLOWED.includes(r.freightType) ? '(already a label)' : '(unrecognised - left alone)',
    })));

    const fixable = breakdown.rows.filter(
      (r) => Object.prototype.hasOwnProperty.call(MAP, r.freightType)
    );
    if (fixable.length) {
      work.push({ table, rows: fixable.reduce((n, r) => n + r.rows, 0) });
    }

    // An id this mapping does not cover must not be guessed at. Only 1 and 2
    // exist in the legacy data, so anything else means an assumption here is
    // wrong and is worth stopping over rather than silently skipping.
    const unknown = breakdown.rows.filter(
      (r) => r.freightType !== null
        && !Object.prototype.hasOwnProperty.call(MAP, r.freightType)
        && !ALLOWED.includes(r.freightType)
    );
    if (unknown.length) {
      console.log(`  WARNING: ${table} holds freightType values this mapping does not cover:`);
      console.log('  ' + unknown.map((u) => JSON.stringify(u.freightType)).join(', '));
      console.log('  Those rows are left untouched. Check them before relying on this column.');
    }
  }

  if (!work.length) {
    console.log('\nNothing to fix.');
    await client.end();
    return;
  }

  console.log('\nWould convert:');
  console.table(work);

  if (!APPLY) {
    console.log('-'.repeat(72));
    console.log('Re-run with --apply to perform it:');
    console.log('    node scripts/fixJobFreightType.js --apply');
    await client.end();
    return;
  }

  console.log('\nApplying...');
  try {
    await client.query('BEGIN');
    let total = 0;
    for (const { table } of work) {
      for (const [id, label] of Object.entries(MAP)) {
        const res = await client.query(
          `UPDATE "${table}" SET "freightType" = $1 WHERE "freightType" = $2`,
          [label, String(id)]
        );
        if (res.rowCount) console.log(`  ${table}: ${res.rowCount} -> ${label}`);
        total += res.rowCount;
      }
    }
    await client.query('COMMIT');
    console.log(`\n  done - ${total} job(s) updated. Reload the job screen.`);
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

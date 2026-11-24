/**
 * Repair migrated jobs whose `nomination` holds a raw number instead of one of
 * the three values the Booking Info screen offers.
 *
 *   node scripts/fixJobNomination.js            <- diagnostics only, read-only
 *   node scripts/fixJobNomination.js --apply    <- perform the fix
 *
 * THE FAILURE
 * functions/jobMigrationPlan.js wrote a literal `nomination: 1`. The select in
 * Components/Layouts/JobsLayout/Jobs/BookingInfo.js offers exactly
 * 'Free Hand', 'Nominated' and 'B2B', so an antd Select handed '1' matches no
 * option and falls back to displaying the raw stored value - the number the
 * user sees in the Nomination box.
 *
 * THE MAPPING
 *   1 -> Free Hand
 *
 * Confirmed by the operations department. It could not be established from the
 * data: nomination is an Odyssey concept with no legacy counterpart - no base
 * table in CSUL_CLINK_PAK carries it, and NominationName is blank on every row
 * of the legacy report views that expose one. 'Free Hand' also happens to be
 * what states.js seeds a new job with and what the older Upload*Jobs importers
 * wrote, but this is on operations' confirmation, not on that coincidence.
 *
 * Only `1` is converted. Any other unrecognised value is reported and left
 * alone rather than folded into the same default - there is no basis for
 * assuming a value nobody has confirmed means the same thing.
 *
 * Idempotent: rows already holding one of the three valid labels, or anything
 * outside the mapping, are not selected.
 */

const path = require('path');
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];

// Must match the SelectComp options in BookingInfo.js. Anything else renders
// as its raw value.
const ALLOWED = ['Free Hand', 'Nominated', 'B2B'];
// Legacy id -> label. Only what has actually been confirmed goes in here.
const MAP = { 1: 'Free Hand' };

// Every job table the Upload*Jobs importers and jobMigrationPlan write to.
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
      `SELECT nomination, count(*)::int AS rows FROM "${table}" GROUP BY 1 ORDER BY 2 DESC`
    );
    console.log(`\n${table}:`);
    console.table(breakdown.rows.map((r) => ({
      nomination: r.nomination,
      rows: r.rows,
      becomes: Object.prototype.hasOwnProperty.call(MAP, r.nomination)
        ? MAP[r.nomination]
        : ALLOWED.includes(r.nomination) ? '(already a label)' : '(unrecognised - left alone)',
    })));

    const fixable = breakdown.rows.filter(
      (r) => Object.prototype.hasOwnProperty.call(MAP, r.nomination)
    );
    if (fixable.length) {
      work.push({ table, rows: fixable.reduce((n, r) => n + r.rows, 0) });
    }

    const unknown = breakdown.rows.filter(
      (r) => r.nomination !== null
        && !Object.prototype.hasOwnProperty.call(MAP, r.nomination)
        && !ALLOWED.includes(r.nomination)
    );
    if (unknown.length) {
      console.log(`  WARNING: ${table} holds nomination values this mapping does not cover:`);
      console.log('  ' + unknown.map((u) => JSON.stringify(u.nomination)).join(', '));
      console.log('  Those rows are left untouched - confirm what they mean before assuming.');
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
    console.log('    node scripts/fixJobNomination.js --apply');
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
          `UPDATE "${table}" SET nomination = $1 WHERE nomination = $2`,
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

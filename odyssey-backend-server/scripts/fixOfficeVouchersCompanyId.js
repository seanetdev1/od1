/**
 * Diagnose (and optionally fix) the schema drift that makes
 * sequelize.sync({alter:true}) abort on every boot.
 *
 *   node scripts/fixOfficeVouchersCompanyId.js            <- diagnostics only, read-only
 *   node scripts/fixOfficeVouchersCompanyId.js --apply    <- perform the migration
 *
 * The failure it addresses:
 *   column "CompanyId" cannot be cast automatically to type integer
 *
 * sync() syncs models sequentially and stops at the FIRST failure, so every
 * model defined after Office_Vouchers is skipped - Session among them, which
 * is why login dies with `relation "Sessions" does not exist`.
 *
 * Connects to whatever database the app itself would use (config/config.js,
 * NODE_ENV-driven; defaults to development -> odyssey-prod).
 */

const path = require('path');
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];

const INT_TYPES = new Set(['integer', 'bigint', 'smallint']);

function line(char = '-') {
  console.log(char.repeat(72));
}

async function main() {
  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    user: cfg.username,
    password: cfg.password,
    database: cfg.database,
  });
  await client.connect();

  line('=');
  console.log(` database : ${cfg.database} @ ${cfg.host}:${cfg.port}  (NODE_ENV=${env})`);
  console.log(` mode     : ${APPLY ? 'APPLY - will modify the schema' : 'DIAGNOSTICS ONLY (read-only)'}`);
  line('=');

  // --- what the column is now -------------------------------------------
  const col = await client.query(
    `SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'Office_Vouchers' AND column_name = 'CompanyId'`
  );
  if (!col.rows.length) {
    console.log('\nNo Office_Vouchers."CompanyId" column found - nothing to do.');
    return finish(client, 0);
  }
  const current = col.rows[0].data_type;
  console.log(`\nOffice_Vouchers."CompanyId"  : ${current} (nullable: ${col.rows[0].is_nullable})`);

  if (INT_TYPES.has(current)) {
    console.log('\nAlready an integer type. This drift is fixed - if sync still fails,');
    console.log('it is failing on a different model; check the boot log banner.');
    return finish(client, 0);
  }

  // --- what we'd be casting to match -------------------------------------
  const comp = await client.query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_name = 'Companies' AND column_name = 'id'`
  );
  const companyIdType = comp.rows[0] ? comp.rows[0].data_type : '(Companies table not found)';
  console.log(`Companies."id"               : ${companyIdType}`);

  // --- can every value actually become an integer? ------------------------
  const stats = await client.query(`
    SELECT
      count(*)                                                          AS total,
      count(*) FILTER (WHERE "CompanyId" IS NULL)                       AS nulls,
      count(*) FILTER (WHERE "CompanyId"::text = '')                    AS empty_strings,
      count(*) FILTER (WHERE "CompanyId"::text ~ '^-?[0-9]+$')          AS clean_integers,
      count(*) FILTER (WHERE "CompanyId" IS NOT NULL
                         AND "CompanyId"::text <> ''
                         AND "CompanyId"::text !~ '^-?[0-9]+$')         AS not_castable
    FROM "Office_Vouchers"
  `);
  const s = stats.rows[0];
  console.log('\nrows           :', s.total);
  console.log('  NULL         :', s.nulls);
  console.log('  empty string :', s.empty_strings, '(treated as NULL by the migration)');
  console.log('  integer-like :', s.clean_integers);
  console.log('  NOT CASTABLE :', s.not_castable);

  // A boolean source is a special case: Postgres HAS an explicit boolean ->
  // integer cast (true=1, false=0), it just won't apply one implicitly - which
  // is exactly what "cannot be cast automatically" means. So boolean values are
  // always castable, even though they don't match the integer-like regex above
  // ('true'/'false' as text do not). Without this, the check below would refuse
  // a migration that is in fact perfectly safe.
  const sourceIsBoolean = current === 'boolean';
  if (Number(s.total) === 0) {
    console.log('\n  table is EMPTY - this migration cannot lose data.');
  } else if (sourceIsBoolean) {
    console.log('\n  source is boolean: true -> 1, false -> 0 on migration.');
    console.log('  NOTE: a boolean CompanyId was never a real company reference,');
    console.log('  so those 1/0 values will be meaningless. Check them afterwards.');
  }

  if (!sourceIsBoolean && Number(s.not_castable) > 0) {
    const bad = await client.query(`
      SELECT DISTINCT "CompanyId" AS v FROM "Office_Vouchers"
       WHERE "CompanyId" IS NOT NULL AND "CompanyId"::text <> ''
         AND "CompanyId"::text !~ '^-?[0-9]+$' LIMIT 20
    `);
    console.log('\n  offending values:', bad.rows.map((r) => JSON.stringify(r.v)).join(', '));
  }

  // --- verdict ------------------------------------------------------------
  line();
  const companyIsInt = INT_TYPES.has(companyIdType);
  const castable = sourceIsBoolean || Number(s.not_castable) === 0;

  if (!companyIsInt) {
    console.log('VERDICT: do NOT migrate the data.');
    console.log('');
    console.log(`Companies."id" is ${companyIdType}, not an integer, so declaring`);
    console.log('Office_Vouchers.CompanyId as INTEGER is simply wrong. The fix is in the');
    console.log('model, not the database - edit models/Office_Vouchers.js:9 to match:');
    console.log('');
    console.log(`    CompanyId: { type: DataTypes.${companyIdType === 'uuid' ? 'UUID' : 'STRING'} },`);
    console.log('');
    console.log('Then restart. No migration needed.');
    return finish(client, 0);
  }

  if (!castable) {
    console.log('VERDICT: cannot migrate safely.');
    console.log('');
    console.log('Some values are not integers (listed above). Decide what they should');
    console.log('become - blanked, mapped to a real company, or the rows deleted - then');
    console.log('re-run. This script will not guess.');
    return finish(client, 1);
  }

  console.log(
    Number(s.total) === 0
      ? 'VERDICT: safe to migrate. The table is empty, so nothing can be lost.'
      : 'VERDICT: safe to migrate. Every value converts cleanly.'
  );

  // The USING expression has to match the SOURCE type. Casting a boolean via
  // ::text produces 'true'/'false', which then fails ::integer - so a boolean
  // column needs the direct boolean->integer cast instead.
  const usingExpr = sourceIsBoolean
    ? '"CompanyId"::integer'
    : `NULLIF("CompanyId"::text, '')::integer`;

  if (!APPLY) {
    console.log('');
    console.log('It will run:');
    console.log(`    ALTER TABLE "Office_Vouchers"`);
    console.log(`      ALTER COLUMN "CompanyId" TYPE integer USING ${usingExpr};`);
    console.log('');
    console.log('Re-run with --apply to perform it:');
    console.log('    node scripts/fixOfficeVouchersCompanyId.js --apply');
    return finish(client, 0);
  }

  // --- apply --------------------------------------------------------------
  console.log('\nApplying...');
  try {
    await client.query('BEGIN');
    if (!sourceIsBoolean) {
      const nulled = await client.query(
        `UPDATE "Office_Vouchers" SET "CompanyId" = NULL WHERE "CompanyId"::text = ''`
      );
      if (nulled.rowCount) console.log(`  normalised ${nulled.rowCount} empty string(s) to NULL`);
    }
    await client.query(
      `ALTER TABLE "Office_Vouchers"
         ALTER COLUMN "CompanyId" TYPE integer
         USING ${usingExpr}`
    );
    await client.query('COMMIT');
    const after = await client.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'Office_Vouchers' AND column_name = 'CompanyId'`
    );
    console.log(`  done - column is now: ${after.rows[0].data_type}`);
    console.log('\nNow restart the backend. You want "Database & tables created!" and');
    console.log('NOT the "SCHEMA SYNC FAILED" banner. If the banner reappears, sync is');
    console.log('failing on a different model - the banner names it.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nMigration failed and was rolled back:', err.message);
    return finish(client, 1);
  }

  return finish(client, 0);
}

async function finish(client, code) {
  line('=');
  await client.end().catch(() => {});
  process.exit(code);
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});

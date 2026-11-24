/**
 * Repair migrated vouchers that settle a document but kept their LEGACY type
 * name, so Payments & Receipts shows nothing.
 *
 *   node scripts/retypeSettlingVouchers.js            <- diagnostics only, read-only
 *   node scripts/retypeSettlingVouchers.js --apply    <- perform the retype
 *
 * THE FAILURE
 * /voucher/getAllJobPayRecVouchers - the only query behind the Payments &
 * Receipts list - filters on
 *
 *     type IN ('Job Payment', 'Job Reciept')
 *
 * functions/ledgerMapping.js resolveVoucherType() is what assigns those two
 * names, and ONLY when its `settlesInvoice` argument is true. routes/voucher/
 * ledger.js called it with one argument, so settlesInvoice defaulted to false
 * for every record in the run and every PAYMENT/RECEIPT voucher fell through
 * to its legacy name ('BANK RECEIPT VOUCHER', 'CASH PAYMENT VOUCHER', ...).
 * Nothing in the database ever matched the filter and the screen came up empty.
 *
 * WHAT THIS CHANGES
 * `type` only, on vouchers that have at least one Invoice_Transactions row -
 * i.e. that demonstrably settled something. `vType` is already correct:
 * resolveVoucherType sets it to VT.TypeCode on BOTH branches, so the settled
 * and unsettled paths never disagreed about it.
 *
 * The PAYMENT/RECEIPT substring test mirrors resolveVoucherType's own
 * VOUCHER_TYPE_MAP lookup, so this lands on exactly the rows a correct
 * migration would have produced. DEBIT NOTE and CREDIT NOTE are deliberately
 * NOT retyped: they are adjustment documents that never appear in Payments &
 * Receipts whether they settle or not, which is why the map rewrites only
 * their type CODE. Anything else (JOURNAL VOUCHER, TRANSFER VOUCHER,
 * SETTLEMENT VOUCHER, OPENING BALANCE) falls through untouched.
 *
 * Idempotent: a row already reading 'Job Payment'/'Job Reciept' is not
 * selected, so a second run is a no-op.
 *
 * Connects to whatever database the app itself would use (config/config.js,
 * NODE_ENV-driven).
 */

const path = require('path');
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];

// Mirrors resolveVoucherType: the first key the legacy name contains wins, and
// a name matching neither keeps whatever it already has.
const RETYPE_SQL_CASE = `
  CASE
    WHEN upper(v."type") LIKE '%PAYMENT%' THEN 'Job Payment'
    WHEN upper(v."type") LIKE '%RECEIPT%' THEN 'Job Reciept'
  END`;

// "Settled something" is the whole test, exactly as resolveVoucherType frames
// it - not the legacy type name, which is why BPV and CPV both qualify.
const SELECTOR = `
  FROM "Vouchers" v
 WHERE EXISTS (
         SELECT 1 FROM "Invoice_Transactions" it WHERE it."VoucherId" = v.id
       )
   AND (upper(v."type") LIKE '%PAYMENT%' OR upper(v."type") LIKE '%RECEIPT%')`;

function line(char = '-') {
  console.log(char.repeat(72));
}

async function finish(client, code) {
  await client.end();
  process.exitCode = code;
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
  console.log(` mode     : ${APPLY ? 'APPLY - will modify data' : 'DIAGNOSTICS ONLY (read-only)'}`);
  line('=');

  // --- what the screen can see right now --------------------------------
  const visible = await client.query(
    `SELECT count(*)::int AS n FROM "Vouchers"
      WHERE "type" IN ('Job Payment', 'Job Reciept')`
  );
  console.log(`\nVouchers the Payments & Receipts list can currently show : ${visible.rows[0].n}`);

  // --- what would change -------------------------------------------------
  const plan = await client.query(`
    SELECT v."type" AS legacy_type, v."vType" AS vtype, v."CompanyId" AS company,
           ${RETYPE_SQL_CASE} AS becomes,
           count(*)::int AS rows
      ${SELECTOR}
     GROUP BY 1, 2, 3, 4
     ORDER BY 5 DESC`);

  if (!plan.rows.length) {
    console.log('\nNothing to retype - no settling voucher carries a legacy PAYMENT/RECEIPT name.');
    console.log('If the screen is still empty, it is empty for another reason:');
    console.log('check the companyId the frontend sends against Vouchers."CompanyId".');
    return finish(client, 0);
  }

  console.log('\nWould retype:\n');
  console.table(plan.rows);
  const total = plan.rows.reduce((n, r) => n + r.rows, 0);
  console.log(`total: ${total}`);

  // --- what is deliberately left alone -----------------------------------
  const untouched = await client.query(`
    SELECT v."type" AS legacy_type, v."vType" AS vtype, count(*)::int AS rows
      FROM "Vouchers" v
     WHERE EXISTS (
             SELECT 1 FROM "Invoice_Transactions" it WHERE it."VoucherId" = v.id
           )
       AND upper(v."type") NOT LIKE '%PAYMENT%'
       AND upper(v."type") NOT LIKE '%RECEIPT%'
     GROUP BY 1, 2
     ORDER BY 3 DESC`);

  if (untouched.rows.length) {
    console.log('\nSettle a document but are NOT payment/receipt vouchers - left as they are:\n');
    console.table(untouched.rows);
  }

  if (!APPLY) {
    line();
    console.log('Re-run with --apply to perform it:');
    console.log('    node scripts/retypeSettlingVouchers.js --apply');
    return finish(client, 0);
  }

  // --- apply --------------------------------------------------------------
  console.log('\nApplying...');
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `UPDATE "Vouchers" v SET "type" = ${RETYPE_SQL_CASE}
        WHERE v.id IN (SELECT v.id ${SELECTOR})`
    );
    await client.query('COMMIT');
    console.log(`  retyped ${res.rowCount} voucher(s)`);

    const after = await client.query(
      `SELECT "type", count(*)::int AS rows FROM "Vouchers"
        WHERE "type" IN ('Job Payment', 'Job Reciept')
        GROUP BY 1 ORDER BY 2 DESC`
    );
    console.log('\nPayments & Receipts can now show:\n');
    console.table(after.rows);
    console.log('\nReload the screen. The list is filtered by the company in the');
    console.log('header dropdown, so check it against the CompanyId column above.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nRetype failed and was rolled back:', err.message);
    return finish(client, 1);
  }

  return finish(client, 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

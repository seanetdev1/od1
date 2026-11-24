/**
 * Read-only. Hunts for the usual causes of a wrong account balance.
 *
 *   node scripts/checkVoucherBalance.js
 *   node scripts/checkVoucherBalance.js --company 1
 *   node scripts/checkVoucherBalance.js --account 482      <- also dumps that ledger
 *   node scripts/checkVoucherBalance.js --limit 100
 *
 * Every SQL statement is printed alongside its results so you can lift it into
 * psql or a GUI. Nothing here writes.
 *
 * WHY THESE CHECKS
 * Voucher_Heads.amount is a VARCHAR, and direction lives entirely in `type`
 * ('debit'/'credit'), so `amount` is meant to always be a positive magnitude.
 * models/Voucher_Heads.js normalises that on write - but only for rows written
 * THROUGH the model, and only since those hooks were added. Rows that predate
 * them, or arrived via raw SQL or the Climax import, can still hold a signed
 * or non-numeric value. Either one silently skews a balance without making any
 * voucher look wrong in the UI.
 */

const path = require('path');
const { Client } = require('pg');

const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const COMPANY = arg('company', null);
const ACCOUNT = arg('account', null);
const LIMIT = Number(arg('limit', 50));

// Voucher_Heads.amount is varchar: anything not strictly numeric must not be
// cast, or the whole query errors on one bad row.
const NUM = `CASE WHEN trim("amount") ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN trim("amount")::numeric END`;
const companyFilter = COMPANY ? `AND v."CompanyId" = ${Number(COMPANY)}` : '';

function show(title, sql) {
  console.log('\n' + '='.repeat(74));
  console.log(' ' + title);
  console.log('='.repeat(74));
  console.log(sql.trim().replace(/^/gm, '  '));
  console.log('-'.repeat(74));
}

(async () => {
  const c = new Client({
    host: cfg.host, port: cfg.port, user: cfg.username,
    password: cfg.password, database: cfg.database,
  });
  await c.connect();
  console.log(`database: ${cfg.database} @ ${cfg.host}:${cfg.port} (NODE_ENV=${env})`);
  if (COMPANY) console.log(`filtered to CompanyId=${COMPANY}`);

  /* ---------------------------------------------------------------- 1 --- */
  const q1 = `
SELECT v.id,
       v."voucher_Id",
       v."vType",
       v."tranDate",
       v."CompanyId",
       SUM(CASE WHEN lower(trim(h."type")) = 'debit'  THEN ${NUM} ELSE 0 END) AS debits,
       SUM(CASE WHEN lower(trim(h."type")) = 'credit' THEN ${NUM} ELSE 0 END) AS credits,
       SUM(CASE WHEN lower(trim(h."type")) = 'debit'  THEN ${NUM} ELSE 0 END)
     - SUM(CASE WHEN lower(trim(h."type")) = 'credit' THEN ${NUM} ELSE 0 END) AS difference
  FROM "Vouchers" v
  JOIN "Voucher_Heads" h ON h."VoucherId" = v.id
 WHERE 1=1 ${companyFilter}
 GROUP BY v.id, v."voucher_Id", v."vType", v."tranDate", v."CompanyId"
HAVING ABS( SUM(CASE WHEN lower(trim(h."type")) = 'debit'  THEN ${NUM} ELSE 0 END)
          - SUM(CASE WHEN lower(trim(h."type")) = 'credit' THEN ${NUM} ELSE 0 END) ) > 0.005
 ORDER BY ABS( SUM(CASE WHEN lower(trim(h."type")) = 'debit'  THEN ${NUM} ELSE 0 END)
             - SUM(CASE WHEN lower(trim(h."type")) = 'credit' THEN ${NUM} ELSE 0 END) ) DESC
 LIMIT ${LIMIT}`;
  show('1. UNBALANCED VOUCHERS (debits <> credits, tolerance 0.005)', q1);
  const r1 = await c.query(q1);
  if (!r1.rows.length) console.log('  none - every voucher balances.');
  else { console.table(r1.rows); console.log(`  showing ${r1.rows.length} (--limit to see more)`); }

  /* ---------------------------------------------------------------- 2 --- */
  const q2 = `
SELECT h.id, h."VoucherId", v."voucher_Id", h."ChildAccountId",
       h."amount", h."defaultAmount", h."type"
  FROM "Voucher_Heads" h
  LEFT JOIN "Vouchers" v ON v.id = h."VoucherId"
 WHERE trim(h."amount") !~ '^-?[0-9]+(\\.[0-9]+)?$'      -- not a number at all
    OR trim(h."amount") LIKE '-%'                        -- negative magnitude
 ORDER BY h.id
 LIMIT ${LIMIT}`;
  show('2. BAD AMOUNTS (non-numeric, or negative where a magnitude is expected)', q2);
  const r2 = await c.query(q2);
  if (!r2.rows.length) console.log('  none - every amount is a positive number.');
  else {
    console.table(r2.rows);
    console.log('  A negative amount double-counts: direction is already in `type`,');
    console.log('  so -500 on a credit line subtracts instead of adding.');
  }

  /* ---------------------------------------------------------------- 3 --- */
  const q3 = `
SELECT lower(trim("type")) AS type_value, count(*) AS rows
  FROM "Voucher_Heads"
 GROUP BY 1
 ORDER BY 2 DESC`;
  show('3. DISTINCT `type` VALUES (anything but debit/credit is skipped by check 1)', q3);
  console.table((await c.query(q3)).rows);

  /* ---------------------------------------------------------------- 4 --- */
  const q4 = `
SELECT h.id, h."VoucherId", h."ChildAccountId", h."amount", h."type"
  FROM "Voucher_Heads" h
  LEFT JOIN "Vouchers" v ON v.id = h."VoucherId"
 WHERE v.id IS NULL
 LIMIT ${LIMIT}`;
  show('4. ORPHANED HEADS (VoucherId points at no voucher)', q4);
  const r4 = await c.query(q4);
  if (!r4.rows.length) console.log('  none.');
  else console.table(r4.rows);

  /* ---------------------------------------------------------------- 5 --- */
  const q5 = `
SELECT count(*) FILTER (WHERE h."ChildAccountId" IS NULL) AS heads_without_account,
       count(*)                                            AS total_heads
  FROM "Voucher_Heads" h`;
  show('5. HEADS NOT POSTED TO ANY ACCOUNT', q5);
  console.table((await c.query(q5)).rows);

  /* ---------------------------------------------------------------- 6 --- */
  if (ACCOUNT) {
    const q6 = `
SELECT SUM(CASE WHEN lower(trim(h."type")) = 'debit'  THEN ${NUM} ELSE 0 END) AS total_debit,
       SUM(CASE WHEN lower(trim(h."type")) = 'credit' THEN ${NUM} ELSE 0 END) AS total_credit,
       SUM(CASE WHEN lower(trim(h."type")) = 'debit'  THEN ${NUM} ELSE 0 END)
     - SUM(CASE WHEN lower(trim(h."type")) = 'credit' THEN ${NUM} ELSE 0 END) AS balance_debit_minus_credit,
       count(*) AS entries
  FROM "Voucher_Heads" h
  JOIN "Vouchers" v ON v.id = h."VoucherId"
 WHERE h."ChildAccountId" = ${Number(ACCOUNT)} ${companyFilter}`;
    show(`6. RECOMPUTED BALANCE FOR ChildAccountId=${Number(ACCOUNT)}`, q6);
    console.table((await c.query(q6)).rows);
    console.log('  Compare this with what the app shows. A mismatch means the');
    console.log('  discrepancy is in how the balance is computed, not in the data.');

    const q7 = `
SELECT h.id, v."voucher_Id", v."tranDate", v."vType",
       h."type", h."amount", h."defaultAmount", v."exRate", h."narration"
  FROM "Voucher_Heads" h
  JOIN "Vouchers" v ON v.id = h."VoucherId"
 WHERE h."ChildAccountId" = ${Number(ACCOUNT)} ${companyFilter}
 ORDER BY v."tranDate" DESC, h.id DESC
 LIMIT ${LIMIT}`;
    show(`7. LEDGER ENTRIES FOR ChildAccountId=${Number(ACCOUNT)} (most recent ${LIMIT})`, q7);
    console.table((await c.query(q7)).rows);
  } else {
    console.log('\n(pass --account <ChildAccountId> to recompute one account\'s balance');
    console.log(' and list its entries)');
  }

  console.log('\nFind the account id with:');
  console.log('  SELECT id, title FROM "Child_Accounts" WHERE title ILIKE \'%name%\';');

  await c.end();
})().catch((err) => { console.error('\nFailed:', err.message); process.exit(1); });

/**
 * Bank accounts lost their company link - diagnose, then optionally re-link.
 *
 *   node scripts/bankAccountsOrphanCheck.js                  <- read-only report
 *   node scripts/bankAccountsOrphanCheck.js --link <id>=<companyId> [...]
 *
 * WHY THIS HAPPENED
 * BankAccounts."CompanyId" is not declared in models/BankAccount.js. It exists
 * only because functions/Associations/companyAssociations declares
 * Company.hasMany(BankAccount). That file was NOT loaded by models/index.js
 * before sequelize.sync({alter:true}) ran, so on every boot sync saw a column
 * no model claimed and dropped it - taking the company linkage with it. The
 * rows themselves were never deleted; only which company each belonged to.
 *
 * The missing require is fixed, so the column now persists. This script is
 * about putting the linkage back.
 *
 * Re-linking is manual on purpose: nothing in the database records which
 * company an orphaned account used to belong to, so any automatic guess would
 * be fabrication. If you have a backup from before the column was dropped,
 * that is the authoritative source - check there first.
 */

const path = require('path');
const { Client } = require('pg');

const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];

// --link 3=1 --link 4=1   (or  --link 3=1,4=1)
function parseLinks(argv) {
  const out = [];
  argv.forEach((a, i) => {
    if (a !== '--link') return;
    const spec = argv[i + 1];
    if (!spec) return;
    spec.split(',').forEach((pair) => {
      const [id, companyId] = pair.split('=').map((s) => s && s.trim());
      if (id && companyId) out.push({ id: Number(id), companyId: Number(companyId) });
    });
  });
  return out;
}

const LINKS = parseLinks(process.argv);

(async () => {
  const c = new Client({
    host: cfg.host, port: cfg.port, user: cfg.username,
    password: cfg.password, database: cfg.database,
  });
  await c.connect();

  console.log('='.repeat(72));
  console.log(` database : ${cfg.database} @ ${cfg.host}:${cfg.port}  (NODE_ENV=${env})`);
  console.log(` mode     : ${LINKS.length ? 'RE-LINK' : 'READ-ONLY REPORT'}`);
  console.log('='.repeat(72));

  const hasCol = await c.query(`
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'BankAccounts' AND column_name = 'CompanyId'`);
  console.log(`\nBankAccounts."CompanyId" column exists : ${hasCol.rows.length > 0}`);
  if (!hasCol.rows.length) {
    console.log('\nThe column is still missing - start the backend once so sync recreates');
    console.log('it (the companyAssociations fix must be in place), then re-run this.');
    await c.end();
    process.exit(1);
  }

  const totals = await c.query(`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE "CompanyId" IS NULL) AS orphaned
      FROM "BankAccounts"`);
  const { total, orphaned } = totals.rows[0];
  console.log(`bank account rows                     : ${total}`);
  console.log(`  orphaned (CompanyId IS NULL)        : ${orphaned}`);
  console.log(`  linked                              : ${Number(total) - Number(orphaned)}`);

  if (Number(total) === 0) {
    console.log('\nThere are no bank account rows at all. Nothing was orphaned - these');
    console.log('were either never created in this database, or removed separately.');
    console.log('Re-enter them in Config > Bank Accounts, or restore from a backup.');
    await c.end();
    process.exit(0);
  }

  const companies = await c.query(`SELECT id, title, short FROM "Companies" ORDER BY id`);
  console.log('\n--- companies ---');
  companies.rows.forEach((r) => console.log(`  id=${r.id}  ${r.title} (${r.short})`));

  const accounts = await c.query(`
    SELECT id, "CompanyId", label, "bankName", "accountTitle", "accountNo", branch
      FROM "BankAccounts" ORDER BY id`);
  console.log('\n--- bank accounts ---');
  accounts.rows.forEach((r) => {
    const owner = r.CompanyId === null ? 'ORPHANED' : `company ${r.CompanyId}`;
    console.log(`  id=${r.id}  [${owner}]  ${r.label || '(no label)'} | ${r.bankName || ''} | ${r.accountTitle || ''} | ${r.accountNo || ''} | ${r.branch || ''}`);
  });

  if (!LINKS.length) {
    if (Number(orphaned) > 0) {
      console.log('\n--- to re-link ---');
      console.log('Match each account to its company yourself, then run e.g.:');
      const example = accounts.rows.filter((r) => r.CompanyId === null).slice(0, 2)
        .map((r) => `${r.id}=${companies.rows[0] ? companies.rows[0].id : 1}`).join(',');
      console.log(`    node scripts/bankAccountsOrphanCheck.js --link ${example || '<accountId>=<companyId>'}`);
      console.log('\nIf you have a pre-drop backup, take the mapping from there rather');
      console.log('than guessing - the account title usually names the company.');
    }
    await c.end();
    process.exit(0);
  }

  // --- re-link ---
  console.log('\nRe-linking...');
  const validCompanies = new Set(companies.rows.map((r) => Number(r.id)));
  try {
    await c.query('BEGIN');
    for (const { id, companyId } of LINKS) {
      if (!validCompanies.has(companyId)) {
        throw new Error(`company id ${companyId} does not exist`);
      }
      const r = await c.query(
        `UPDATE "BankAccounts" SET "CompanyId" = $1 WHERE id = $2`, [companyId, id]
      );
      if (r.rowCount === 0) throw new Error(`no bank account with id ${id}`);
      console.log(`  account ${id} -> company ${companyId}`);
    }
    await c.query('COMMIT');
    console.log('\nDone. Reload Config > Bank Accounts to confirm.');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('\nRe-link failed and was rolled back:', err.message);
    await c.end();
    process.exit(1);
  }

  await c.end();
  process.exit(0);
})().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});

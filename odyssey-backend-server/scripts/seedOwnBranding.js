/**
 * ONE-TIME, OWNER-ONLY. Moves this installation's own branding out of the
 * frontend source and into the database, so prints look exactly as they did
 * before the de-hardcoding.
 *
 *   node scripts/seedOwnBranding.js              <- dry run, shows the plan
 *   node scripts/seedOwnBranding.js --apply      <- writes
 *
 * WHAT IT DOES
 *   1. Fills in Company.title/address/phone/email/web/ntn for our companies,
 *      only where the column is currently blank.
 *   2. Loads the PNGs from Odyssey-Front-end/public into Company.logo and
 *      Company.printLogo as base64 data URLs.
 *   3. Inserts the four bank accounts that used to be hardcoded in
 *      Components/Shared/invoicePrintDefaults.js into the BankAccounts table.
 *
 * DO NOT SHIP THIS TO A CLIENT and do not run it on a client install - the
 * values below are Seanet/ACS's own. A client enters their details in
 * Config > Companies and Config > Bank Accounts.
 *
 * Idempotent: re-running skips anything already set and any bank account whose
 * accountNo already exists.
 */

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const db = require('../models');
require('../functions/Associations/companyAssociations');
const { Company, BankAccount } = db;

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'Odyssey-Front-end', 'public');

// Matches what the frontend used to hardcode, keyed by the company id those
// ternaries tested against. Verify these ids against your Companies table
// before applying - the old code disagreed with itself about which id was which
// (one file called id 2 "CARGO LINKERS", another "AIR CARGO SERVICES").
const COMPANY_BRANDING = {
  1: {
    title: 'SEA NET SHIPPING & LOGISTICS',
    address: 'House# A230, PECHS, Block 2, Karachi',
    phone: '9221 34395444-55-66   Fax: 9221 34385001',
    email: 'info@seanetpk.com',
    web: 'www.seanetpk.com',
    ntn: '8271203-5',
    logoFile: 'seanet-logo-complete.png',
    printLogoFile: 'seanet-colored.png',
  },
  2: {
    title: 'CARGO LINKERS',
    address: 'F-50 BLOCK-6 SHAHRAH-E-FAISAL KARACHI',
    ntn: '5322935-2',
  },
  3: {
    title: 'AIR CARGO SERVICES',
    address: 'House# A230, PECHS, Block 2, Karachi',
    phone: '9221 34395444-55-66   Fax: 9221 34385001',
    email: 'info@acs.com.pk',
    web: 'www.acs.com.pk',
    ntn: '0287230-7',
    logoFile: 'aircargo-logo.png',
    printLogoFile: 'acs-colored.png',
  },
};

// The old `bankDetails` constant, parsed out into rows.
const BANK_ACCOUNTS = [
  { CompanyId: 3, label: 'Soneri - ACS',  bankName: 'Soneri Bank Ltd',    branch: 'Shahrah-e-Faisal Br 0031 Karachi', accountTitle: 'AIR CARGO SERVICES',          accountNo: '20001766466',          swift: 'SONEPKKAKAR', iban: 'PK02 SONE 0003 1200 0176 6466' },
  { CompanyId: 1, label: 'Soneri - SNS',  bankName: 'SONERI BANK LIMITED', branch: 'SHAHRAH-E-FAISAL BRANCH 0031, KARACHI', accountTitle: 'SEA NET SHIPPING & LOGISTICS', accountNo: '20001534198',      swift: 'SONEPKKAXXX', iban: 'PK91 SONE 0003 1200 0153 4198' },
  { CompanyId: 1, label: 'Bank Al Habib - SNS', bankName: 'BANK AL HABIB LIMITED', branch: 'TARIQ ROAD 1054, KARACHI', accountTitle: 'SEA NET SHIPPING & LOGISTICS', accountNo: '1054-0081-002182-01-5', swift: 'BAHLPKKAXXX', iban: 'PK08 BAHL 1054 0081 0028 1201' },
  { CompanyId: 3, label: 'Bank Al Habib - ACS', bankName: 'BANK AL HABIB LIMITED', branch: 'TARIQ ROAD 1054, KARACHI', accountTitle: 'AIR CARGO SERVICES',          accountNo: '1054-0081-004411-01-7', swift: 'BAHLPKKAXXX', iban: 'PK73 BAHL 1054 0081 0044 1101' },
];

function dataUrl(file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!fs.existsSync(full)) return null;
  return `data:image/png;base64,${fs.readFileSync(full).toString('base64')}`;
}

(async () => {
  await db.syncPromise;

  console.log('='.repeat(72));
  console.log(` mode: ${APPLY ? 'APPLY - will write' : 'DRY RUN - nothing will be written'}`);
  console.log(` public dir: ${PUBLIC_DIR}`);
  console.log('='.repeat(72));

  const companies = await Company.findAll({ order: [['id', 'ASC']] });
  console.log('\nCompanies in this database:');
  companies.forEach((c) => console.log(`  id=${c.id}  ${c.title || '(no title)'}`));

  console.log('\n--- company branding ---');
  for (const c of companies) {
    const want = COMPANY_BRANDING[c.id];
    if (!want) { console.log(`  id=${c.id}: no mapping, skipped`); continue; }

    const patch = {};
    // Only fill blanks - never overwrite something already configured.
    for (const f of ['title', 'address', 'phone', 'email', 'web', 'ntn']) {
      if (want[f] && !c[f]) patch[f] = want[f];
    }
    if (want.logoFile && !c.logo) {
      const d = dataUrl(want.logoFile);
      if (d) patch.logo = d; else console.log(`    (missing file ${want.logoFile})`);
    }
    if (want.printLogoFile && !c.printLogo) {
      const d = dataUrl(want.printLogoFile);
      if (d) patch.printLogo = d; else console.log(`    (missing file ${want.printLogoFile})`);
    }

    const keys = Object.keys(patch);
    if (!keys.length) { console.log(`  id=${c.id}: already complete, nothing to do`); continue; }
    console.log(`  id=${c.id}: set ${keys.map((k) => (k.endsWith('ogo') ? `${k} (${Math.round(patch[k].length / 1024)}kb)` : k)).join(', ')}`);
    if (APPLY) await c.update(patch);
  }

  console.log('\n--- bank accounts ---');
  const companyIds = new Set(companies.map((c) => Number(c.id)));
  for (const acc of BANK_ACCOUNTS) {
    if (!companyIds.has(acc.CompanyId)) {
      console.log(`  skip ${acc.label}: no company with id ${acc.CompanyId}`);
      continue;
    }
    const existing = await BankAccount.findOne({ where: { accountNo: acc.accountNo } });
    if (existing) { console.log(`  skip ${acc.label}: account ${acc.accountNo} already present`); continue; }
    console.log(`  add  ${acc.label} -> company ${acc.CompanyId} (${acc.accountNo})`);
    if (APPLY) await BankAccount.create(acc);
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write:');
    console.log('    node scripts/seedOwnBranding.js --apply');
  } else {
    console.log('\nDone. Reload the app and check an invoice print + a report header.');
  }

  await db.sequelize.close();
  process.exit(0);
})().catch((err) => { console.error('\nFailed:', err.message); process.exit(1); });

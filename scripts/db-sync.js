'use strict';

const path = require('path');

const backendRoot = path.resolve(__dirname, '..', 'odyssey-backend-server');
const db = require(path.join(backendRoot, 'models'));

async function main() {
  const shouldSeed = !process.argv.includes('--skip-seed');

  await db.ready;
  if (db.syncError) {
    console.error('[db-init] Schema sync reported an error.');
    process.exit(1);
  }

  const missing = await db.checkSchemaDrift();
  if (missing && missing.length > 0) {
    console.warn(
      `[db-init] Schema drift detected (${missing.length} missing column(s)). Run "odyssey.bat --migrate-alter" to reconcile.`
    );
  } else {
    console.log('[db-init] Schema check passed with no drift.');
  }

  if (shouldSeed) {
    try {
      const { seedChartOfAccounts } = require(path.join(backendRoot, 'functions', 'chartOfAccounts'));
      const report = await seedChartOfAccounts({ apply: false });
      if (report.existingCount === 0 && report.missing.length > 0) {
        console.log('[db-init] Fresh empty database detected — seeding required Chart of Accounts...');
        await seedChartOfAccounts({ apply: true });
        console.log('[db-init] Chart of Accounts seeded.');
      }
    } catch (err) {
      console.warn('[db-init] Skipping automatic Chart of Accounts check:', err.message || err);
    }
  }

  await db.sequelize.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[db-init] Failed:', err.message || err);
  process.exit(1);
});

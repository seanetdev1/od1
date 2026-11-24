/**
 * Seed the chart of accounts on a fresh install (from-source deploys).
 *
 *   node scripts/seedChartOfAccounts.js            <- report what is missing
 *   node scripts/seedChartOfAccounts.js --apply    <- create it
 *
 * The chart itself and all the logic live in functions/chartOfAccounts.js, not
 * here. build/seal-tree.js ships only index.js, package.json, routes, models,
 * functions and config, so nothing under scripts/ exists inside the Docker
 * image - a compose deployment uses the endpoint instead:
 *
 *   curl -X POST http://localhost:8088/accounts/chartOfAccounts/seed \
 *        -H "Authorization: Bearer <admin token>"
 *
 * Both go through the same function, so they cannot drift apart.
 */

const path = require('path');

const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];
const db = require('../models');
const { seedChartOfAccounts, flatten } = require('../functions/chartOfAccounts');

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`\nDatabase: ${cfg.database} on ${cfg.host} (NODE_ENV=${env})`);
  console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: REPORT ONLY (nothing will change)\n');

  // Report first, always, so --apply also prints what it is about to do.
  const report = await seedChartOfAccounts({ apply: false });
  const missing = new Set(report.missing);

  for (const node of flatten()) {
    console.log(`  ${missing.has(node.title) ? 'CREATE ' : 'exists '}${'  '.repeat(node.depth)}${node.title}`);
  }
  console.log(`\n${report.existingCount} account(s) already present, ${missing.size} to create.`);

  if (!missing.size) {
    console.log('\nNothing to do - the chart of accounts is already in place.\n');
  } else if (!APPLY) {
    console.log('\nRe-run with --apply to create them.\n');
  } else {
    const result = await seedChartOfAccounts({ apply: true });
    console.log(`\nDone. ${result.created} account(s) created.\n`);
  }

  await db.sequelize.close();
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message, '\n');
  process.exit(1);
});

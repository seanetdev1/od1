/**
 * Remove the employees created by the first, wrong run of the users migration.
 *
 *   node scripts/removeBadUserImport.js            <- report only
 *   node scripts/removeBadUserImport.js --apply    <- delete them
 *
 * WHAT WENT WRONG
 *
 * That run read CEAS_User.UserId as the login name. It is a BIGINT pointing
 * into Gen_Users, which is the actual account table (UserLogin, UserName,
 * Email, Active). So it created employees whose name AND username were both a
 * number - "75", "5", "14".
 *
 * WHAT THIS DELETES
 *
 * Only rows that match that signature exactly: created by the migration, with
 * a username consisting purely of digits, and no climaxId. A real person whose
 * login happens to be numeric would also have a name that is not the same
 * number, so the name === username check keeps them.
 *
 * It will not touch the seeded admin, anyone created by hand, or the 13 staff
 * records from TAP_Employee (those carry a climaxId).
 *
 * Anything it is unsure about is listed and left alone.
 */

const path = require('path');

const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];
const db = require('../models');

const APPLY = process.argv.includes('--apply');

/** The signature of a row from the bad import. */
function looksLikeBadImport(row) {
  const name = String(row.name ?? '');
  const username = String(row.username ?? '');
  return (
    row.createdBy === 'Migration' &&
    row.climaxId === null &&
    /^\d+$/.test(username) &&
    name === username
  );
}

async function main() {
  await db.syncPromise;
  const { Employees } = db;

  console.log(`\nDatabase: ${cfg.database} on ${cfg.host} (NODE_ENV=${env})`);
  console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: REPORT ONLY (nothing will change)\n');

  const rows = await Employees.findAll({
    attributes: ['id', 'name', 'username', 'climaxId', 'createdBy', 'designation'],
    raw: true,
  });

  const bad = rows.filter(looksLikeBadImport);

  // Numeric username but NOT matching the full signature - flagged, not touched.
  const unsure = rows.filter(
    (r) => !looksLikeBadImport(r) && /^\d+$/.test(String(r.username ?? ''))
  );

  console.log(`  ${rows.length} employee(s) in total`);
  console.log(`  ${bad.length} match the bad import (createdBy=Migration, numeric username, name === username, no climaxId)`);
  bad.slice(0, 20).forEach((r) => console.log(`     delete  name="${r.name}" username="${r.username}"`));
  if (bad.length > 20) console.log(`     ... and ${bad.length - 20} more`);

  if (unsure.length) {
    console.log(`\n  ${unsure.length} have a numeric username but do NOT match - left alone, check them:`);
    unsure.slice(0, 20).forEach((r) =>
      console.log(`     keep    name="${r.name}" username="${r.username}" climaxId=${r.climaxId}`));
  }

  if (!bad.length) {
    console.log('\nNothing to remove.\n');
    await db.sequelize.close();
    return;
  }

  if (!APPLY) {
    console.log('\nRe-run with --apply to delete them, then run the Employees & Users stage again.\n');
    await db.sequelize.close();
    return;
  }

  // Sessions reference employees by id with no foreign key, so clear any that
  // belong to these rows - otherwise a deleted user keeps a live session.
  const ids = bad.map((r) => r.id);
  await db.sequelize.transaction(async (t) => {
    if (db.Session) await db.Session.destroy({ where: { userId: ids }, transaction: t });
    await Employees.destroy({ where: { id: ids }, transaction: t });
  });

  console.log(`\nDeleted ${bad.length} employee(s).`);
  console.log('Now re-run Config > Migration > Employees & Users.\n');
  await db.sequelize.close();
}

main().catch((err) => {
  console.error('\nScript failed:', err.message, '\n');
  process.exit(1);
});

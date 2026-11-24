/**
 * Why can't I log in?
 *
 *   node scripts/diagnoseLogin.js
 *   node scripts/diagnoseLogin.js --user admin
 *   node scripts/diagnoseLogin.js --user admin --reset 'NewPass123'
 *   node scripts/diagnoseLogin.js --user admin --clear-session
 *
 * Read-only unless you pass --reset or --clear-session.
 *
 * Login can fail for four reasons that all look the same from the browser:
 *   400  username or password missing
 *   401  no such user, or the password does not verify
 *   409  a session already exists for that user (single-session enforcement)
 *   500  a query blew up - usually schema drift, e.g. a model column the
 *        database does not have
 * This tells you which.
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'models'));
const { Employees } = require('../functions/Associations/employeeAssociations');
const { isBcryptHash, hashPassword, verifyPassword } = require('../functions/password');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? (process.argv[i + 1] || true) : null;
};
const USER = arg('user');
const RESET = arg('reset');
const CLEAR = process.argv.includes('--clear-session');

(async () => {
  await db.syncPromise;

  const cfg = require('../config/config')[process.env.NODE_ENV || 'development'];
  console.log('='.repeat(70));
  console.log(` database: ${cfg.database} @ ${cfg.host}:${cfg.port}`);
  console.log('='.repeat(70));

  // 1. Schema drift - the 500 case, and the least obvious.
  const missing = await db.checkSchemaDrift();
  console.log(`\n1. Schema drift: ${missing.length ? missing.join(', ') : 'none'}`);
  if (missing.length) {
    console.log('   ^ this alone will make login return 500. Apply the columns first.');
  }

  // 2. Sessions table - auth cannot work without it.
  let sessionsOk = true;
  try {
    await db.Session.count();
  } catch (err) {
    sessionsOk = false;
    console.log(`\n2. Sessions table: MISSING (${err.message})`);
    console.log('   ^ every request will 503. Run the alter, then restart.');
  }
  if (sessionsOk) console.log('\n2. Sessions table: present');

  // 3. Who can actually log in.
  const all = await Employees.findAll({
    attributes: ['id', 'name', 'username', 'password', 'designation', 'active'],
    order: [['createdAt', 'ASC']],
  });
  console.log(`\n3. Employees: ${all.length}`);
  if (all.length === 0) {
    console.log('   No users at all. Restart the backend - seedAdmin creates an admin');
    console.log('   on an empty table and prints a generated password ONCE to the log.');
  }
  for (const e of all.slice(0, 25)) {
    console.log(
      `   username=${JSON.stringify(e.username)} designation=${JSON.stringify(e.designation)} ` +
      `active=${JSON.stringify(e.active)} password=${isBcryptHash(e.password) ? 'bcrypt' : 'PLAINTEXT'}`
    );
  }

  const target = USER
    ? all.find((e) => e.username === USER)
    : (all.find((e) => e.username === 'admin') || all[0]);

  if (!target) {
    console.log(`\nNo user matching --user ${USER}. Nothing else to check.`);
    return finish(0);
  }

  // 4. Single-session: the 409 nobody expects.
  const session = await db.Session.findOne({ where: { userId: String(target.id) } }).catch(() => null);
  console.log(`\n4. Active session for "${target.username}": ${session ? 'YES' : 'no'}`);
  if (session) {
    console.log('   ^ login returns 409 "User already logged in" unless the client sends');
    console.log('     force:true. Clear it with --clear-session, or log out properly.');
    console.log(`     (expires ${session.expiresAt})`);
  }

  // 5. Optional fixes.
  if (CLEAR && session) {
    await db.Session.destroy({ where: { userId: String(target.id) } });
    console.log(`\n   cleared the session for "${target.username}".`);
  }

  if (RESET && typeof RESET === 'string') {
    await target.update({ password: await hashPassword(RESET) });
    const ok = await verifyPassword(RESET, (await Employees.unscoped().findByPk(target.id)).password);
    console.log(`\n   password for "${target.username}" reset; verify check: ${ok ? 'OK' : 'FAILED'}`);
  }

  if (!RESET && !CLEAR) {
    console.log('\nTo fix:');
    console.log(`   node scripts/diagnoseLogin.js --user ${target.username} --clear-session`);
    console.log(`   node scripts/diagnoseLogin.js --user ${target.username} --reset 'SomePassword123'`);
  }

  return finish(0);
})().catch((err) => { console.error('\nFailed:', err.message); process.exit(1); });

async function finish(code) {
  await db.sequelize.close().catch(() => {});
  process.exit(code);
}

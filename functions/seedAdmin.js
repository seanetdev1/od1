// First-load seeding: make a brand-new install immediately usable by creating
// a default admin account, but ONLY when there are no employees at all yet.
//
// Gating on an empty table (rather than "is there a user called admin?") means:
//   - a fresh DB gets a ready-to-use admin, and
//   - an install that already has users is never touched, and
//   - deleting the default admin later does NOT resurrect it with a known
//     password on the next boot.
//
// Username defaults to "admin"; both it and the password can be set per-install
// via ADMIN_SEED_USERNAME / ADMIN_SEED_PASSWORD. The password is stored as a
// bcrypt hash. Change it after first login.
//
// There is deliberately no hardcoded default password. This used to fall back
// to "abc.123", which meant every install that didn't set the env var shipped
// with the same publicly-known admin credential. Instead we generate a random
// one per install and print it once, at boot, in the server log - the operator
// doing the install sees it, and nothing guessable is ever baked into a build
// that gets copied to many customers.

const crypto = require('crypto');
const db = require('../models');
const { hashPassword } = require('./password');

const SEED_USERNAME = process.env.ADMIN_SEED_USERNAME || 'admin';

// 24 url-safe chars (~143 bits). Only ever used if ADMIN_SEED_PASSWORD is unset
// AND the employees table is empty, i.e. genuinely first boot of a fresh DB.
function generatePassword() {
  return crypto.randomBytes(18).toString('base64url');
}

// Arbitrary constant, unique to this operation. Postgres advisory locks are
// keyed by number, and this one serialises first-boot seeding.
const SEED_LOCK_KEY = 4915037;

async function seedAdminUser() {
  // Ensure the schema exists before we query/insert (models/index.js runs
  // sequelize.sync and exposes the promise so we don't race it).
  await db.syncPromise;
  const { Employees, sequelize } = db;

  // Serialise across processes.
  //
  // `npm start` forks one worker per core and every worker called this at
  // once. All of them saw an empty Employees table, all of them inserted, and
  // a fresh install came up with SEVEN admin accounts and seven different
  // passwords in the boot log - six of which do not work, because login does
  // findOne(username) and gets whichever row Postgres returns first. The
  // operator has no way to tell which password is the real one.
  //
  // An advisory lock rather than a transaction: the count-then-insert has to
  // be atomic against other CONNECTIONS, and it is held only for the moment
  // this runs. It is released explicitly, and by Postgres anyway if the
  // connection drops.
  const [[{ locked }]] = await sequelize.query(
    `SELECT pg_try_advisory_lock(${SEED_LOCK_KEY}) AS locked`
  );

  if (!locked) {
    // Another process is seeding right now. It will create the account and
    // print the password; this one must not also create one.
    return { created: false, reason: 'seeding-elsewhere' };
  }

  try {
    const existingCount = await Employees.count();
    if (existingCount > 0) {
      return { created: false, reason: 'users-exist' };
    }

    const configured = process.env.ADMIN_SEED_PASSWORD;
    const generated = configured ? null : generatePassword();
    const seedPassword = configured || generated;

    await Employees.create({
      name: 'Administrator',
      username: SEED_USERNAME,
      password: await hashPassword(seedPassword),
      designation: 'admin', // lowercase - unlocks the Config tab + admin routes
      active: '1',          // '1' = active (matches createEmployee + the getEmployees filter)
    });

    // Returned (not logged here) so the caller decides where it surfaces; index.js
    // prints it to the boot log exactly once, on the run that created the account.
    return { created: true, username: SEED_USERNAME, generatedPassword: generated };
  } finally {
    await sequelize.query(`SELECT pg_advisory_unlock(${SEED_LOCK_KEY})`);
  }
}

module.exports = { seedAdminUser };

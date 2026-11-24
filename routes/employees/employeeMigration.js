/**
 * Employees / users migration - plan, apply, verify.
 *
 * /employeeRoutes/uploadEmployees is left untouched.
 *
 *   POST /employeeRoutes/migration/users/plan    what would happen
 *   POST /employeeRoutes/migration/users/apply   one transaction
 *   GET  /employeeRoutes/migration/users/verify  who can actually sign in
 *
 * The old import took TAP_Employee, which on the live database is 13 rows and
 * every one a sales rep - it is what a job points at for a salesman, not the
 * staff list. The logins are in CEAS_User. This takes both and unions them;
 * see functions/employeeMigrationPlan.js for how they relate.
 *
 * NO PASSWORDS ARE SET. Migrated users arrive unable to sign in until an
 * administrator gives them a password, which is the only safe answer when the
 * two systems hash differently - and CEAS_User carries nothing worth moving
 * anyway. The verify step reports how many are in that state so it is a
 * decision rather than a surprise.
 */

const routes = require('express').Router();
const db = require('../../models');
const { Employees } = require('../../functions/Associations/employeeAssociations');
const { requireSystem } = require('../../functions/systemAccess');
const { planEmployees } = require('../../functions/employeeMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

async function readContext() {
  const rows = await Employees.findAll({ attributes: ['climaxId', 'username'], raw: true });
  return {
    existingClimaxIds: rows.map((r) => r.climaxId).filter((x) => x !== null),
    existingUsernames: rows.map((r) => r.username).filter(Boolean),
  };
}

function readSource(body) {
  if (!body) return null;
  const users = Array.isArray(body.users) ? body.users : null;
  const employees = Array.isArray(body.employees) ? body.employees : null;
  if (!users && !employees) return null;
  return { users: users || [], employees: employees || [] };
}

function summarise(plan) {
  const p = plan.problems;
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      usersWithoutLogin: p.usersWithoutLogin,
      unnamedUsers: p.unnamedUsers.length,
      unnamedUsersSample: p.unnamedUsers.slice(0, 25),
      employeesWithoutLogin: p.employeesWithoutLogin.length,
      employeesWithoutLoginSample: p.employeesWithoutLogin.slice(0, 25),
      duplicateUsernames: p.duplicateUsernames,
      lockedUsers: p.lockedUsers.length,
    },
    guidance:
      plan.stats.toCreate === 0
        ? 'Nothing to do - everyone in the source is already here.'
        : `${plan.stats.withLogin} will be able to sign in once given a password; `
          + `${plan.stats.withoutLogin} are records only (they exist in the staff table `
          + 'but have no login, and jobs reference them as sales reps). '
          + 'No passwords are migrated - set them from Setup > Employees.',
  };
}

routes.post('/migration/users/plan', SYSTEM, async (req, res) => {
  try {
    const source = readSource(req.body);
    if (!source) {
      return res.status(400).json({
        status: 'error',
        result: 'Send { users: [...], employees: [...] } from the legacy /jobs/allUsers endpoint.',
      });
    }
    const plan = planEmployees(source, await readContext());
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[employee migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/migration/users/apply', SYSTEM, async (req, res) => {
  try {
    const source = readSource(req.body);
    if (!source) {
      return res.status(400).json({
        status: 'error',
        result: 'Send { users: [...], employees: [...] } from the legacy /jobs/allUsers endpoint.',
      });
    }

    const plan = planEmployees(source, await readContext());
    if (!plan.toCreate.length) {
      return res.json({ status: 'success', result: { ...summarise(plan), created: 0 } });
    }

    await db.sequelize.transaction(async (t) => {
      const CHUNK = 200;
      for (let i = 0; i < plan.toCreate.length; i += CHUNK) {
        await Employees.bulkCreate(plan.toCreate.slice(i, i + CHUNK), { transaction: t });
      }
    });

    res.json({
      status: 'success',
      result: {
        ...summarise(plan),
        created: plan.toCreate.length,
        employeesInTarget: await Employees.count(),
      },
    });
  } catch (error) {
    console.error('[employee migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Who is actually usable.
 *
 * A count of employees says nothing about who can sign in. Three states
 * matter and none of them is visible from a total: has a username and a
 * password (can work), has a username but no password (needs one setting),
 * and has no username (a record, referenced by jobs, not an account).
 */
routes.get('/migration/users/verify', SYSTEM, async (req, res) => {
  try {
    const rows = await Employees.findAll({
      attributes: ['id', 'name', 'username', 'password', 'climaxId', 'active', 'designation'],
      raw: true,
    });

    const withUsername = rows.filter((r) => r.username);
    const needPassword = withUsername.filter((r) => !r.password);
    const recordsOnly = rows.filter((r) => !r.username);

    // Two accounts for one person: the thing that makes a login ambiguous.
    const byUsername = new Map();
    for (const r of withUsername) {
      const k = String(r.username).toLowerCase();
      byUsername.set(k, (byUsername.get(k) || 0) + 1);
    }
    const duplicateUsernames = [...byUsername.entries()].filter(([, n]) => n > 1).map(([u]) => u);

    const salesRepsWithoutClimaxId = rows.filter(
      (r) => r.climaxId === null && r.username
    ).length;

    res.json({
      status: 'success',
      result: {
        employees: rows.length,
        canSignIn: withUsername.length - needPassword.length,
        needPasswordSet: needPassword.length,
        needPasswordSample: needPassword.slice(0, 25).map((r) => ({ name: r.name, username: r.username })),
        recordsOnly: recordsOnly.length,
        inactive: rows.filter((r) => String(r.active) === '0').length,
        withoutDesignation: rows.filter((r) => !r.designation).length,
        duplicateUsernames,
        loginOnlyWithoutStaffRecord: salesRepsWithoutClimaxId,
        healthy: duplicateUsernames.length === 0,
        note:
          'needPasswordSet is expected immediately after a migration - no passwords are '
          + 'carried over. withoutDesignation is also expected: designations are not inferred '
          + 'from legacy data, so set them before these users can reach anything gated.',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

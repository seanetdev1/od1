// Test-only helper for getting an authenticated request identity without
// going through the real /authRoutes/login flow (which enforces a single
// active session per user via sessionManager - annoying across many tests).
//
// loginAs() signs a token AND records it as the user's session, because
// tokenVerification.js no longer adopts an unrecorded token. It used to: a
// validly-signed token with no session on file had one created for it on
// first use. That was the hole that let a second concurrent login through
// under clustering, so it is gone - which means a helper that only signs
// would now produce a token every route rejects with 401 "Session expired".

const jwt = require('jsonwebtoken');
const { Employees } = require('../../models');
const sessionManager = require('../../functions/sessionManager');

// Same secret source the app uses (functions/secrets.js). Under NODE_ENV=test
// that resolves to a fixed test default, so tokens signed here verify in
// tokenVerification.js without any env setup.
const { JWT_SECRET } = require('../../functions/secrets');

const TEST_PREFIX = '__test__';
let seq = 0;

async function createEmployee({ designation = 'employee', name, username, password = 'password123' } = {}) {
  seq += 1;
  const uniq = `${TEST_PREFIX}${Date.now()}_${seq}`;
  return Employees.create({
    name: name || uniq,
    username: username || uniq,
    password,
    designation,
    active: 'true',
  });
}

function signTokenFor(employee) {
  return jwt.sign(
    {
      id: employee.id,
      username: employee.name,
      designation: employee.designation,
      access: '',
      defaultCompanyId: employee.defaultCompanyId || null,
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// Convenience: create + sign + register the session in one call.
// Returns { employee, token, authHeader }.
async function loginAs(designation) {
  const employee = await createEmployee({ designation });
  const token = signTokenFor(employee);
  await sessionManager.setSession(employee.id, token);
  return { employee, token, authHeader: `Bearer ${token}` };
}

module.exports = { TEST_PREFIX, createEmployee, signTokenFor, loginAs };

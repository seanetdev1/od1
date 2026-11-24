/**
 * Employees - the rewritten migration stage.
 *
 * SCOPE: TAP_Employee only, deliberately.
 *
 * The intent was to import everyone with a login. The legacy database does not
 * hold that list in a form worth migrating, and the evidence is on the record:
 *
 *   Gen_Users      1 row - "admin". One shared login, not a list of people.
 *   CEAS_User      14 rows whose UserId matches neither Gen_Users (0 of 14)
 *                  nor TAP_Employee (6 of 14), and every one has SalesRepId
 *                  null, so none of them links to a staff record either.
 *   TAP_Employee   13 rows: "Sales persone", "MANAGEMENT", "BOSS" - roles
 *                  rather than individuals, with no email addresses.
 *
 * So there is nothing here that maps onto per-person accounts. This imports the
 * 13 staff records, which is what jobs actually reference through
 * Employees.climaxId, and nothing more. They come in as RECORDS, not accounts:
 * no username, no password, no designation. IFA's real users get created by
 * hand, which is the honest answer when the source has no users in it.
 *
 * /jobs/findUserTable is still there if the login table turns up later; the
 * planner already handles the union.
 *
 * The existing importEmployees in steps.js is untouched.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

async function fetchEmployees() {
  try {
    // /jobs/getEmployees, not /jobs/allUsers: this is the endpoint that has
    // always existed, so this stage runs without restarting the legacy server.
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getEmployees`);
    const employees = data?.Employees;
    if (!Array.isArray(employees)) {
      throw new Error(
        `${LEGACY_API}/jobs/getEmployees responded but returned no Employees array. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return employees;
  } catch (err) {
    if (!err?.response) {
      throw new Error(
        `Could not reach the legacy server at ${LEGACY_API}. Check it is running and that `
        + 'NEXT_PUBLIC_CLIMAX_LEGACY_URL points at it.'
      );
    }
    throw err;
  }
}

export async function migrateEmployees(report = () => {}, { apply = true } = {}) {
  report('Employees: fetching staff records...');
  const employees = await fetchEmployees();

  report(`Employees: planning ${employees.length} staff record(s)...`);

  // users: [] on purpose - see the header. The planner's union branch is
  // intact for when a real account table is identified.
  const payload = { users: [], employees };

  const planRes = await axiosClient.post('/employeeRoutes/migration/users/plan', payload);
  const plan = planRes.data.result;

  if (plan.stats.toCreate === 0 && plan.stats.alreadyImported === 0) {
    throw new Error(
      `Nothing could be imported from ${employees.length} staff record(s). `
      + 'Every row was rejected - check the plan output for why.'
    );
  }

  if (!apply) {
    report(`Employees: ${plan.stats.toCreate} would be created (dry run).`);
    return { planned: plan, applied: null, verification: null };
  }

  const nothingToDo = plan.stats.toCreate === 0;
  if (nothingToDo) {
    report(`Employees: all ${plan.stats.alreadyImported} staff record(s) are already imported.`);
  } else {
    report(`Employees: importing ${plan.stats.toCreate}...`);
    const applyRes = await axiosClient.post('/employeeRoutes/migration/users/apply', payload);
    plan.applied = applyRes.data.result;
  }

  report('Employees: verifying...');
  const verifyRes = await axiosClient.get('/employeeRoutes/migration/users/verify');
  const v = verifyRes.data.result;

  report(
    `Employees: ${v.employees} in the system - ${v.recordsOnly} are records only `
    + `(no login), ${v.canSignIn} can sign in.`
  );

  // Said plainly rather than left to be discovered. These rows exist so jobs
  // can name their sales rep; they are not accounts and nobody signs in as one.
  report(
    'Employees: these are staff RECORDS, not user accounts - the legacy system has no '
    + 'per-person logins to migrate. Create the real users in Setup > Employees.'
  );

  return {
    planned: plan,
    applied: plan.applied || null,
    verification: v,
    // Tells the stage gate this was a deliberate no-op rather than a silent
    // failure - the two used to look identical.
    noop: nothingToDo,
    reason: nothingToDo
      ? `All ${plan.stats.alreadyImported} staff record(s) already imported.`
      : null,
  };
}

export const planEmployeesOnly = (report) => migrateEmployees(report, { apply: false });

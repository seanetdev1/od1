/**
 * Plan an employee/user import.
 *
 * WHY THE LAST ONE ONLY BROUGHT SALES REPS
 *
 * It imported TAP_Employee, which sounds like the staff master and is not. On
 * the live database that table holds 13 rows and every one of them is a sales
 * rep - it is what a job points at for a salesman, not the list of people who
 * use the system. Nothing was filtering: the import faithfully brought across
 * everything it was given, and everything it was given was sales reps.
 *
 * The accounts are in Gen_Users: UserLogin is the login, UserName the display
 * name, plus Email, CellPhone and Active. CEAS_User is not the account table -
 * its UserId is a BIGINT pointing into Gen_Users, and its job is to tie an
 * account to a sales rep, a company and a department. Reading that UserId as a
 * login name produces users called "75", which is exactly what the first
 * attempt at this stage imported.
 *
 * So the two are unioned, and neither is a subset of the other:
 *
 *   user + employee   a sales rep who logs in. One row, keeping the employee's
 *                     legacy id so job links still resolve.
 *   user only         someone who logs in but has no staff record. Named after
 *                     their login, because nothing else exists.
 *   employee only     a sales rep with no login. Still needed - jobs reference
 *                     them - but they cannot sign in.
 *
 * IDENTITY
 *
 * climaxId stays TAP_Employee.Id and nothing else. Jobs resolve their sales rep
 * through it, so putting a CEAS_User.Id in that column would silently attach
 * jobs to the wrong person. Login-only users therefore have climaxId null and
 * are identified by username.
 *
 * PASSWORDS
 *
 * None are migrated, and CEAS_User holds nothing worth moving. Users arrive
 * with no password and an administrator sets them. Any other answer means
 * either inventing a password or trusting a foreign hashing scheme.
 */

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

/** "First Middle Last", falling back to something identifiable. */
function employeeName(e) {
  const joined = [e.EmployeeName, e.Middle, e.LastName]
    .map((x) => cleanText(x))
    .filter(Boolean)
    .join(' ');
  return joined || null;
}

/**
 * Legacy flags -> `represent`, IN THE CODES THE APP READS.
 *
 * The Employees form saves its Sales / Doc / Account Representative boxes as
 * 'sr' / 'dr' / 'ar', comma-joined ("sr,dr"), and the job screens' rep
 * pickers find people by those codes (routes/employees
 * getRepresentativeEmployees, a substring match on 'sr' / 'dr' / 'ar'). This
 * wrote 'Sales' / 'Docs' / 'Accounts' - which contain none of them - so no
 * migrated employee appeared as a rep and every box had to be ticked by hand.
 *
 * Every flag counts: someone who is both a sales and a docs rep gets both,
 * where this used to keep only the first.
 */
function representOf(e) {
  if (!e) return null;
  const codes = [
    e.IsSalesMan && 'sr',
    e.IsDocsRep && 'dr',
    e.IsAccountRep && 'ar',
  ].filter(Boolean);
  return codes.length ? codes.join(',') : null;
}

/**
 * A username Odyssey can actually log in with.
 *
 * Legacy logins can carry a domain prefix or spaces; both are awkward in a
 * login box and neither adds anything. Lowercased so that two rows differing
 * only in case do not become two accounts for one person.
 */
function normaliseUsername(login) {
  const raw = cleanText(login);
  if (!raw) return null;
  const withoutDomain = raw.includes('\\') ? raw.split('\\').pop() : raw;
  return withoutDomain.replace(/\s+/g, '').toLowerCase() || null;
}

/**
 * @param {object} source
 * @param {Array} source.users      CEAS_User rows
 * @param {Array} source.employees  TAP_Employee rows
 * @param {object} ctx
 * @param {Iterable} ctx.existingClimaxIds
 * @param {Iterable} ctx.existingUsernames
 */
function planEmployees(source = {}, ctx = {}) {
  const users = Array.isArray(source.users) ? source.users : [];
  const employees = Array.isArray(source.employees) ? source.employees : [];

  const haveClimaxId = new Set([...(ctx.existingClimaxIds || [])].map(String));
  const haveUsername = new Set(
    [...(ctx.existingUsernames || [])].map((u) => String(u).toLowerCase())
  );

  const problems = {
    duplicateUsernames: [],
    usersWithoutLogin: 0,       // CEAS_User row with an unusable UserId
    unnamedUsers: [],           // login-only users, named after their login
    employeesWithoutLogin: [],  // in TAP_Employee, no CEAS_User row
    lockedUsers: [],
  };

  const employeeById = new Map(
    employees.filter((e) => e && e.Id !== null && e.Id !== undefined)
      .map((e) => [String(e.Id), e])
  );

  const toCreate = [];
  const claimedUsernames = new Set();
  const linkedEmployeeIds = new Set();
  let skipped = 0;

  // --- everyone with a login ------------------------------------------------
  for (const u of users) {
    // UserLogin, not UserId. UserId is a numeric key.
    const username = normaliseUsername(u && u.UserLogin);
    if (!username) { problems.usersWithoutLogin += 1; continue; }

    const employee = u.SalesRepId != null ? employeeById.get(String(u.SalesRepId)) : null;
    if (employee) linkedEmployeeIds.add(String(u.SalesRepId));

    // Two legacy logins normalising to the same username would become one
    // person. Report and keep the first rather than silently merging them.
    if (claimedUsernames.has(username)) {
      problems.duplicateUsernames.push({ username, login: u.UserLogin });
      continue;
    }
    claimedUsernames.add(username);

    if (haveUsername.has(username)) { skipped += 1; continue; }
    if (employee && haveClimaxId.has(String(employee.Id))) { skipped += 1; continue; }

    // The staff record first (it has father's name, CNIC and the rest), then
    // the account's own display name, and only then the login.
    const name = (employee ? employeeName(employee) : null) || cleanText(u.UserName);
    if (!name) problems.unnamedUsers.push({ username, login: u.UserLogin });
    if (u.IsLocked) problems.lockedUsers.push(username);

    toCreate.push({
      name: name || username,
      username,
      // climaxId is the EMPLOYEE id or nothing. Never CEAS_User.Id - jobs
      // resolve their sales rep through this column.
      climaxId: employee ? employee.Id : null,
      fatherName: employee ? cleanText(employee.FatherName) : null,
      // The account's own email/phone are usually the current ones.
      email: cleanText(u.Email) || cleanText(employee && employee.Email) || null,
      contact: cleanText(u.CellPhone) || cleanText(employee && employee.PhoneNo) || null,
      cnic: cleanText(employee && (employee.NIC || employee.OldNIC)) || null,
      code: employee && employee.EmployeeCode ? String(employee.EmployeeCode) : null,
      department: cleanText(u.DepartmentName),
      represent: representOf(employee),
      // A locked legacy account comes across inactive, not absent - the person
      // still appears on historical records.
      // Inactive if the account is switched off, blocked, locked by the
      // CEAS_User join, or the staff record is marked inactive.
      active: (u.Active === false || u.IsBlocked || u.IsLocked
        || (employee && employee.IsInactive)) ? '0' : '1',
      // No designation is inferred. Guessing who is an admin from legacy data
      // is how a migration hands someone privileges nobody granted them.
      designation: null,
      createdBy: 'Migration',
    });
  }

  // --- employees with no login ---------------------------------------------
  // Still imported: jobs reference them as the sales rep, and dropping them
  // would leave those jobs unattributed.
  for (const [id, e] of employeeById) {
    if (linkedEmployeeIds.has(id)) continue;
    if (haveClimaxId.has(id)) { skipped += 1; continue; }

    const name = employeeName(e);
    problems.employeesWithoutLogin.push({ climaxId: e.Id, name: name || `Employee ${e.Id}` });

    toCreate.push({
      name: name || `Employee ${e.Id}`,
      // No login. Odyssey requires a username to sign in, so leaving it null
      // is what makes this a record rather than an account.
      username: null,
      climaxId: e.Id,
      fatherName: cleanText(e.FatherName),
      email: cleanText(e.Email),
      contact: cleanText(e.PhoneNo),
      cnic: cleanText(e.NIC || e.OldNIC),
      code: e.EmployeeCode ? String(e.EmployeeCode) : null,
      department: null,
      represent: representOf(e),
      active: e.IsInactive ? '0' : '1',
      designation: null,
      createdBy: 'Migration',
    });
  }

  const withLogin = toCreate.filter((r) => r.username).length;

  return {
    toCreate,
    problems,
    stats: {
      sourceUsers: users.length,
      sourceEmployees: employees.length,
      toCreate: toCreate.length,
      withLogin,
      withoutLogin: toCreate.length - withLogin,
      alreadyImported: skipped,
    },
    canApply: true,
  };
}

module.exports = {
  planEmployees, employeeName, representOf, normaliseUsername, cleanText,
};

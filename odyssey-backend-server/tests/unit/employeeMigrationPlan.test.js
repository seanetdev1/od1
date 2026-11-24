const {
  planEmployees, employeeName, representOf, normaliseUsername,
} = require('../../functions/employeeMigrationPlan');

const emp = (Id, EmployeeName, extra = {}) => ({ Id, EmployeeName, ...extra });
// A Gen_Users row: UserLogin is the login, UserName the display name.
// CEAS_User.UserId is a BIGINT pointing in here and is NOT a login - reading
// it as one is what produced users called "75".
const user = (Id, UserLogin, extra = {}) => ({ Id, UserLogin, ...extra });

describe('normaliseUsername', () => {
  it('lowercases so one person does not become two accounts', () => {
    expect(normaliseUsername('BAsim')).toBe('basim');
  });

  it('drops a domain prefix', () => {
    expect(normaliseUsername('CLIMAX\\\\bilal')).toBe('bilal');
  });

  it('removes spaces, which cannot be typed reliably into a login box', () => {
    expect(normaliseUsername('  bilal azfar ')).toBe('bilalazfar');
  });

  it('returns null for nothing usable', () => {
    expect(normaliseUsername('')).toBeNull();
    expect(normaliseUsername(null)).toBeNull();
  });
});

describe('employeeName', () => {
  it('joins the parts it has', () => {
    expect(employeeName({ EmployeeName: 'Ali', Middle: 'M', LastName: 'Khan' })).toBe('Ali M Khan');
    expect(employeeName({ EmployeeName: 'Ali', LastName: 'Khan' })).toBe('Ali Khan');
  });

  it('returns null when there is no name at all, rather than a blank', () => {
    expect(employeeName({})).toBeNull();
  });
});

describe('representOf', () => {
  it('maps the legacy flags', () => {
    // The codes the Employees form saves and the rep pickers search for.
    expect(representOf({ IsSalesMan: true })).toBe('sr');
    expect(representOf({ IsDocsRep: true })).toBe('dr');
    expect(representOf({ IsAccountRep: true })).toBe('ar');
    // Every flag, not just the first.
    expect(representOf({ IsSalesMan: true, IsDocsRep: true })).toBe('sr,dr');
    expect(representOf({})).toBeNull();
    expect(representOf(null)).toBeNull();
  });
});

describe('planEmployees', () => {
  const ctx = (over = {}) => ({ existingClimaxIds: [], existingUsernames: [], ...over });

  it('never uses a numeric key as a name or a login', () => {
    // The first attempt read CEAS_User.UserId - a BIGINT - as the login, and
    // imported users whose name and username were both "75".
    const plan = planEmployees({
      users: [{ Id: 75, UserLogin: 'ahmed.raza', UserName: 'Ahmed Raza' }],
      employees: [],
    }, ctx());

    expect(plan.toCreate[0].username).toBe('ahmed.raza');
    expect(plan.toCreate[0].name).toBe('Ahmed Raza');
    expect(plan.toCreate[0].name).not.toMatch(/^\d+$/);
  });

  it('prefers the staff record name, then the account name, then the login', () => {
    const withStaff = planEmployees({
      users: [user(1, 'ali', { UserName: 'Account Display', SalesRepId: 7 })],
      employees: [emp(7, 'Ali', { LastName: 'Khan' })],
    }, ctx());
    expect(withStaff.toCreate[0].name).toBe('Ali Khan');

    const accountOnly = planEmployees({
      users: [user(1, 'ali', { UserName: 'Account Display' })], employees: [],
    }, ctx());
    expect(accountOnly.toCreate[0].name).toBe('Account Display');

    const loginOnly = planEmployees({ users: [user(1, 'ali')], employees: [] }, ctx());
    expect(loginOnly.toCreate[0].name).toBe('ali');
  });

  it('takes email and phone from the account before the staff record', () => {
    const plan = planEmployees({
      users: [user(1, 'ali', { Email: 'new@x.com', CellPhone: '0300', SalesRepId: 7 })],
      employees: [emp(7, 'Ali', { Email: 'old@x.com', PhoneNo: '021' })],
    }, ctx());
    expect(plan.toCreate[0].email).toBe('new@x.com');
    expect(plan.toCreate[0].contact).toBe('0300');
  });

  it('deactivates an account that is switched off or blocked, not only locked', () => {
    const off = planEmployees({ users: [user(1, 'a', { Active: false })], employees: [] }, ctx());
    expect(off.toCreate[0].active).toBe('0');
    const blocked = planEmployees({ users: [user(2, 'b', { IsBlocked: true })], employees: [] }, ctx());
    expect(blocked.toCreate[0].active).toBe('0');
  });

  it('imports users who are NOT sales reps - the whole point of this rewrite', () => {
    // TAP_Employee on the live database holds 13 rows, all sales reps. The
    // previous import brought exactly those and nothing else, because that is
    // all that table contains. The logins are in CEAS_User.
    const plan = planEmployees({
      users: [user(1, 'accounts.clerk'), user(2, 'ops.manager')],
      employees: [],
    }, ctx());

    expect(plan.stats.withLogin).toBe(2);
    expect(plan.toCreate.map((r) => r.username).sort()).toEqual(['accounts.clerk', 'ops.manager']);
  });

  it('joins a user to their employee record and keeps the EMPLOYEE legacy id', () => {
    // Jobs resolve their sales rep through climaxId, so it must be the
    // TAP_Employee id - never the CEAS_User id.
    const plan = planEmployees({
      users: [user(90, 'ali', { SalesRepId: 7 })],
      employees: [emp(7, 'Ali', { LastName: 'Khan', IsSalesMan: true, Email: 'ali@x.com' })],
    }, ctx());

    expect(plan.toCreate).toHaveLength(1);
    const row = plan.toCreate[0];
    expect(row.climaxId).toBe(7);
    expect(row.name).toBe('Ali Khan');
    expect(row.username).toBe('ali');
    expect(row.represent).toBe('sr');
    expect(row.email).toBe('ali@x.com');
  });

  it('names a login-only user after their login, and says it had to', () => {
    const plan = planEmployees({ users: [user(1, 'store.keeper')], employees: [] }, ctx());
    expect(plan.toCreate[0].name).toBe('store.keeper');
    expect(plan.toCreate[0].climaxId).toBeNull();
    expect(plan.problems.unnamedUsers).toEqual([{ username: 'store.keeper', login: 'store.keeper' }]);
  });

  it('keeps an employee who has no login, since jobs reference them', () => {
    const plan = planEmployees({
      users: [],
      employees: [emp(7, 'Ali', { IsSalesMan: true })],
    }, ctx());

    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].username).toBeNull();   // a record, not an account
    expect(plan.toCreate[0].climaxId).toBe(7);
    expect(plan.problems.employeesWithoutLogin).toEqual([{ climaxId: 7, name: 'Ali' }]);
  });

  it('does not import the same person twice when they are both', () => {
    const plan = planEmployees({
      users: [user(90, 'ali', { SalesRepId: 7 })],
      employees: [emp(7, 'Ali')],
    }, ctx());
    expect(plan.toCreate).toHaveLength(1);
  });

  it('never assigns a designation', () => {
    // Inferring who is an admin from legacy data is how a migration hands
    // someone privileges nobody granted them.
    const plan = planEmployees({ users: [user(1, 'someone')], employees: [] }, ctx());
    expect(plan.toCreate[0].designation).toBeNull();
  });

  it('brings a locked account across inactive rather than dropping it', () => {
    const plan = planEmployees({ users: [user(1, 'gone', { IsLocked: true })], employees: [] }, ctx());
    expect(plan.toCreate[0].active).toBe('0');
    expect(plan.problems.lockedUsers).toEqual(['gone']);
  });

  it('reports two logins that normalise to one username instead of merging them', () => {
    const plan = planEmployees({
      users: [user(1, 'Ali'), user(2, 'ALI')],
      employees: [],
    }, ctx());
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.problems.duplicateUsernames).toEqual([{ username: 'ali', login: 'ALI' }]);
  });

  it('skips anyone already imported, by username or by legacy id', () => {
    const plan = planEmployees({
      users: [user(1, 'ali', { SalesRepId: 7 }), user(2, 'new.person')],
      employees: [emp(7, 'Ali')],
    }, ctx({ existingUsernames: ['ali'] }));

    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.toCreate.map((r) => r.username)).toEqual(['new.person']);
  });

  it('counts a CEAS_User row with an unusable login rather than creating a blank', () => {
    const plan = planEmployees({ users: [user(1, '   ')], employees: [] }, ctx());
    expect(plan.problems.usersWithoutLogin).toBe(1);
    expect(plan.toCreate).toHaveLength(0);
  });

  it('summarises both sides', () => {
    const plan = planEmployees({
      users: [user(90, 'ali', { SalesRepId: 7 }), user(91, 'clerk')],
      employees: [emp(7, 'Ali'), emp(8, 'NoLogin')],
    }, ctx());

    expect(plan.stats).toEqual({
      sourceUsers: 2,
      sourceEmployees: 2,
      toCreate: 3,        // ali (joined), clerk (login only), NoLogin (record only)
      withLogin: 2,
      withoutLogin: 1,
      alreadyImported: 0,
    });
  });
});

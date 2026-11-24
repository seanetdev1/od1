/**
 * The sidebar a CUSTOMS installation gets.
 *
 * A customs install is a clearing agent: it files declarations, it does not run
 * freight jobs. Customs Job REPLACES the two freight sections, the same way
 * Aviation Job replaces them - it does not sit beside them relabelled.
 *
 * What it does NOT do is turn off sea operations wholesale. Setup keeps Ports
 * and Destinations, because the GD form's POL/POD pickers are fed from them,
 * and the aviation section must stay hidden. That is why customs has its own
 * gate rather than reusing hasSeaOperations().
 *
 * The gating happens LAST in setAccesLevels, after two branches that rebuild
 * the item list wholesale for admins - so these tests sweep the designations
 * rather than checking one, because "works for an employee, missing for an
 * admin" is exactly the shape the ordering is there to prevent.
 *
 * setAccesLevels keeps module-level state across calls, so each test resets
 * the registry to get a clean "first call after page load".
 */
const SEA_JOBS = '4';
const AIR_JOBS = '7';
const AVIATION = '10';
const CUSTOMS = '11';
const REPORTS = '5';
const SETUP = '2';

const findParent = (items, key) => items.find((x) => x && x.key === key);
const findChild = (parent, key) => parent?.children?.find((x) => x && x.key === key);

// Cookies.get is called for several names; the mode has to answer for
// 'operationMode' specifically while the token answers for 'token'.
const cookieJar = (mode, token = 'valid.jwt.token') => (name) =>
  (name === 'operationMode' ? mode : token);

let Cookies; let jwt_decode; let setAccesLevels;

const load = () => {
  jest.resetModules();
  jest.mock('js-cookie', () => ({ get: jest.fn() }));
  jest.mock('jwt-decode', () => jest.fn());
  jest.mock('functions/logout', () => jest.fn());
  jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: jest.fn((x) => x) }));
  Cookies = require('js-cookie');
  jwt_decode = require('jwt-decode');
  ({ setAccesLevels } = require('functions/setAccesLevels'));
};

const menu = ({ mode, designation = 'employee', access = 'admin' }) => {
  load();
  Cookies.get.mockImplementation(cookieJar(mode));
  jwt_decode.mockReturnValue({ designation, access });
  return setAccesLevels(jest.fn(), false);
};

const DESIGNATIONS = ['employee', 'manager', 'ceo', 'cfo', 'admin'];

describe('customs mode adds the Customs Job section', () => {
  test.each(DESIGNATIONS)('for designation "%s"', (designation) => {
    const items = menu({ mode: 'customs', designation });
    const customs = findParent(items, CUSTOMS);
    expect(customs).toBeTruthy();
    expect(findChild(customs, '11-1')).toBeTruthy();
  });

  test('it comes first - it is the section this install works in', () => {
    const items = menu({ mode: 'customs', designation: 'admin' });
    expect(items[0].key).toBe(CUSTOMS);
  });
});

describe('customs mode drops the freight jobs sections', () => {
  // Customs Job REPLACES them - a clearing agent files declarations, it does
  // not run freight jobs. They used to be relabelled 'Sea Clearance' / 'Air
  // Clearance' and kept; that was reversed deliberately.
  //
  // The drop happens last in setAccesLevels, after two branches that rebuild
  // the item list wholesale for admins, so this sweeps the designations.
  test.each(DESIGNATIONS)('for designation "%s"', (designation) => {
    const items = menu({ mode: 'customs', designation });
    expect(findParent(items, SEA_JOBS)).toBeFalsy();
    expect(findParent(items, AIR_JOBS)).toBeFalsy();
  });

  test('and never shows the aviation section', () => {
    // Aviation is gated on hasSeaOperations() being false, which customs mode
    // does NOT set - the port masters are still needed for the GD form's
    // POL/POD pickers. So dropping the two job sections must not drag the
    // aviation one in behind it.
    expect(findParent(menu({ mode: 'customs', designation: 'admin' }), AVIATION)).toBeFalsy();
  });

  test('but Setup keeps the port masters', () => {
    // The reason customs does not simply reuse hasSeaOperations(): that flag
    // also strips Ports and Destinations out of Setup, and the customs job
    // form's POL/POD pickers are fed from exactly those.
    const setup = findParent(menu({ mode: 'customs', designation: 'admin' }), SETUP);
    expect(findChild(setup, '2-10')).toBeTruthy();   // Ports
    expect(findChild(setup, '2-11')).toBeTruthy();   // Destinations
  });
});

describe('the section is absent everywhere else', () => {
  test.each(['freight', 'aviation'])('in %s mode', (mode) => {
    expect(findParent(menu({ mode, designation: 'admin' }), CUSTOMS)).toBeFalsy();
  });

  test('and in an unrecognised mode, which falls back to freight', () => {
    expect(findParent(menu({ mode: 'not-a-mode', designation: 'admin' }), CUSTOMS)).toBeFalsy();
  });
});

describe('access gating', () => {
  test('a user with no job access gets no section rather than an empty one', () => {
    // An empty parent is worse than none: it is a menu entry that opens onto
    // nothing, and there is no way to tell it from a loading failure.
    const items = menu({ mode: 'customs', designation: 'employee', access: 'Commodity' });
    expect(findParent(items, CUSTOMS)).toBeFalsy();
  });

  test.each(['ImSea', 'ImAir', 'ExSea', 'ExAir'])('%s is enough to see it', (access) => {
    // Clearance staff hold whichever import/export levels their desk needs;
    // requiring one specific level would hide the module from half of them.
    const items = menu({ mode: 'customs', designation: 'employee', access });
    const customs = findParent(items, CUSTOMS);
    expect(customs).toBeTruthy();
    expect(findChild(customs, '11-1')).toBeTruthy();
  });
});

describe('the customs register report', () => {
  test('is offered in customs mode', () => {
    const reports = findParent(menu({ mode: 'customs', designation: 'admin' }), REPORTS);
    expect(findChild(reports, '5-22')).toBeTruthy();
  });

  test.each(['freight', 'aviation'])('is not offered in %s mode', (mode) => {
    // No other mode files declarations, so the report could only ever be empty.
    const reports = findParent(menu({ mode, designation: 'admin' }), REPORTS);
    expect(findChild(reports, '5-22')).toBeFalsy();
  });
});

describe('the VAT Detail report', () => {
  test('is offered in customs mode', () => {
    const reports = findParent(menu({ mode: 'customs', designation: 'admin' }), REPORTS);
    expect(findChild(reports, '5-25')).toBeTruthy();
  });

  test.each(['freight', 'aviation'])('is not offered in %s mode', (mode) => {
    // Sale Tax Invoices are raised on customs invoices; elsewhere it would be empty.
    const reports = findParent(menu({ mode, designation: 'admin' }), REPORTS);
    expect(findChild(reports, '5-25')).toBeFalsy();
  });
});

describe('the Program Book', () => {
  // Offered only where Configuration > Customs has job planning on - MainLayout
  // keeps that in the customsPlanning cookie.
  const withPlanning = ({ mode, planning, designation = 'admin', access = 'admin' }) => {
    load();
    Cookies.get.mockImplementation((name) => {
      if (name === 'operationMode') return mode;
      if (name === 'customsPlanning') return planning;
      return 'valid.jwt.token';
    });
    jwt_decode.mockReturnValue({ designation, access });
    return setAccesLevels(jest.fn(), false);
  };

  test.each(DESIGNATIONS)('is under Customs Job, after the list, when planning is on - for "%s"', (designation) => {
    const customs = findParent(withPlanning({ mode: 'customs', planning: 'true', designation }), CUSTOMS);
    expect(customs.children.filter(Boolean).map((x) => x.key)).toEqual(['11-1', '11-3']);
  });

  test.each([undefined, 'false'])('is not offered while planning is off (%s)', (planning) => {
    const customs = findParent(withPlanning({ mode: 'customs', planning }), CUSTOMS);
    expect(findChild(customs, '11-3')).toBeFalsy();
  });

  test('a left-over cookie does not bring it to another mode', () => {
    expect(findParent(withPlanning({ mode: 'freight', planning: 'true' }), CUSTOMS)).toBeFalsy();
  });

  test('needs the job list\'s access, as its plans become jobs', () => {
    const items = withPlanning({ mode: 'customs', planning: 'true', designation: 'employee', access: 'ExSea' });
    expect(findChild(findParent(items, CUSTOMS), '11-3')).toBeTruthy();
    const none = withPlanning({ mode: 'customs', planning: 'true', designation: 'employee', access: 'Commodity' });
    expect(findParent(none, CUSTOMS)).toBeFalsy();
  });
});

describe('the International Report', () => {
  test.each(['freight', 'aviation', 'customs'])('is offered in %s mode, after Agent Inv. Balance', (mode) => {
    const reports = findParent(menu({ mode, designation: 'admin' }), REPORTS);
    const keys = reports.children.filter(Boolean).map((x) => x.key);
    expect(keys.indexOf('5-26')).toBe(keys.indexOf('5-6') + 1);
  });

  test('needs Agent Invoice Balancing\'s access - the report it was put together from', () => {
    const reports = (access) => findParent(menu({ mode: 'freight', designation: 'employee', access }), REPORTS);
    expect(findChild(reports('AgentInvBalance'), '5-26')).toBeTruthy();
    expect(findChild(reports('Ledger'), '5-26')).toBeFalsy();
  });
});

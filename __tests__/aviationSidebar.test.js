/**
 * The sidebar an AVIATION installation gets.
 *
 * An aviation install is an airline: it runs aircraft, not ships. The sea half
 * of the menu is therefore not relabelled, it is not built at all, and Air
 * Jobs is replaced outright by Aviation Job rather than sitting beside it.
 *
 * The gating happens LAST in setAccesLevels, after two branches that rebuild
 * the item list wholesale for admins - so these tests sweep the designations
 * rather than checking one, because "works for an employee, leaks Sea Jobs for
 * an admin" is exactly the shape the ordering is there to prevent.
 *
 * setAccesLevels keeps module-level state across calls, so each test resets
 * the registry to get a clean "first call after page load".
 */
const SEA_JOBS = '4';
const AIR_JOBS = '7';
const AVIATION = '10';
const SETUP = '2';
const REPORTS = '5';

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

// Builds the menu for a given mode + user. `access` is the access-level
// string; 'admin' in it is NOT the same thing as the admin designation.
const menu = ({ mode, designation = 'employee', access = 'admin' }) => {
  load();
  Cookies.get.mockImplementation(cookieJar(mode));
  jwt_decode.mockReturnValue({ designation, access });
  return setAccesLevels(jest.fn(), false);
};

const DESIGNATIONS = ['employee', 'manager', 'ceo', 'cfo', 'admin'];

describe('aviation mode drops the freight jobs sections', () => {
  test.each(DESIGNATIONS)('for designation "%s"', (designation) => {
    const items = menu({ mode: 'aviation', designation });
    expect(findParent(items, SEA_JOBS)).toBeFalsy();
    // Air Jobs goes too: Aviation Job replaces it rather than joining it.
    expect(findParent(items, AIR_JOBS)).toBeFalsy();
    expect(findParent(items, AVIATION)).toBeTruthy();
  });

  test('Aviation Job comes first - it is the section the install works in', () => {
    const items = menu({ mode: 'aviation' });
    expect(items[0].key).toBe(AVIATION);
  });

  test('and carries the job list', () => {
    const items = menu({ mode: 'aviation' });
    expect(findChild(findParent(items, AVIATION), '10-1'))
      .toMatchObject({ label: 'Aviation Job List' });
  });

  test('and the PFM register, under the job list', () => {
    // A flight is BUILT from a PFM, so the two belong in one section. Under
    // the job list rather than above it although a plan comes first in time:
    // the flight list is what this section is opened for every day.
    const section = findParent(menu({ mode: 'aviation' }), AVIATION);
    expect(findChild(section, '10-3')).toMatchObject({ label: 'PFM' });
    const keys = section.children.filter(Boolean).map((x) => x.key);
    expect(keys.indexOf('10-3')).toBeGreaterThan(keys.indexOf('10-1'));
  });

  test.each(DESIGNATIONS)('the PFM register is there for designation "%s"', (designation) => {
    // Gated on the same access levels as the flight list - the operations
    // staff who build plans are the ones who fly them. This sweeps the
    // designations for the same reason the section test above does: the two
    // admin branches rebuild the item list wholesale.
    const section = findParent(menu({ mode: 'aviation', designation }), AVIATION);
    expect(findChild(section, '10-3')).toBeTruthy();
  });
});

describe('other modes are untouched', () => {
  test.each(['freight', undefined])('mode %s keeps Sea and Air Jobs', (mode) => {
    const items = menu({ mode });
    expect(findParent(items, SEA_JOBS)).toBeTruthy();
    expect(findParent(items, AIR_JOBS)).toBeTruthy();
    // No Aviation Job section leaking into a freight install.
    expect(findParent(items, AVIATION)).toBeFalsy();
  });

  test('customs drops them too, but still gets no Aviation section', () => {
    // Customs was in the list above when its mode was a relabelling of the
    // freight sections. It has its own module now and replaces them - see
    // __tests__/customsSidebar.test.js, which owns that behaviour. What
    // matters HERE is only that dropping them does not pull aviation in:
    // the aviation gate is hasSeaOperations(), which customs leaves true.
    const items = menu({ mode: 'customs' });
    expect(findParent(items, AVIATION)).toBeFalsy();
  });

  test('a junk mode cookie behaves as freight, not aviation', () => {
    // Defaulting the other way would hide the sea half of a working freight
    // installation on a bad cookie.
    const items = menu({ mode: 'not-a-mode' });
    expect(findParent(items, SEA_JOBS)).toBeTruthy();
    expect(findParent(items, AVIATION)).toBeFalsy();
  });
});

describe('Setup section in aviation mode', () => {
  const setup = (mode) => findParent(menu({ mode }), SETUP);

  test('drops the sea masters', () => {
    const s = setup('aviation');
    expect(findChild(s, '2-4')).toBeFalsy();   // Voyage
    expect(findChild(s, '2-10')).toBeFalsy();  // Ports
    expect(findChild(s, '2-11')).toBeFalsy();  // Destinations
  });

  test('keeps Airports', () => {
    expect(findChild(setup('aviation'), '2-12')).toMatchObject({ label: 'Airports' });
  });

  test('adds Carriers and Aircraft', () => {
    // Both exist so the load figures can be derived rather than typed: a
    // carrier carries the ER/IFA/Other tag and the AWB prefix.
    expect(findChild(setup('aviation'), '2-14')).toMatchObject({ label: 'Carriers' });
    expect(findChild(setup('aviation'), '2-15')).toMatchObject({ label: 'Aircraft' });
  });

  test('adds AWB Stock', () => {
    // The register of air waybill numbers. An AWB is an airline document, so
    // it belongs to this mode only - see the freight case below.
    expect(findChild(setup('aviation'), '2-16')).toMatchObject({ label: 'AWB Stock' });
  });

  test('freight keeps the sea masters and gets neither aviation master', () => {
    const s = setup('freight');
    expect(findChild(s, '2-4')).toMatchObject({ label: 'Voyage' });
    expect(findChild(s, '2-10')).toMatchObject({ label: 'Ports' });
    expect(findChild(s, '2-11')).toMatchObject({ label: 'Destinations' });
    expect(findChild(s, '2-14')).toBeFalsy();
    expect(findChild(s, '2-15')).toBeFalsy();
    expect(findChild(s, '2-16')).toBeFalsy();
  });

  test('freight has its own AWB Numbers register, which aviation does not', () => {
    // Two different registers: freight's is held against airline parties and
    // feeds the air-export MAWB; aviation's (2-16) against carriers.
    expect(findChild(setup('freight'), '2-17')).toMatchObject({ label: 'AWB Numbers' });
    expect(findChild(setup('aviation'), '2-17')).toBeFalsy();
  });

  test('Fiscal Years survives in both modes', () => {
    // Sanity check that the sea filtering is surgical rather than emptying
    // the section.
    expect(findChild(setup('aviation'), '2-13')).toBeTruthy();
    expect(findChild(setup('freight'), '2-13')).toBeTruthy();
  });
});

describe('Aviation Monthly report', () => {
  test('appears only in aviation mode', () => {
    expect(findChild(findParent(menu({ mode: 'aviation' }), REPORTS), '5-21'))
      .toMatchObject({ label: 'Aviation Monthly' });
    expect(findChild(findParent(menu({ mode: 'freight' }), REPORTS), '5-21'))
      .toBeFalsy();
  });
});

describe('access levels still gate the aviation section', () => {
  test('no air access means no Aviation Job section at all', () => {
    // An empty section a user cannot open is worse than no section.
    const items = menu({ mode: 'aviation', designation: 'employee', access: 'Commodity' });
    expect(findParent(items, AVIATION)).toBeFalsy();
  });

  test('ExAir alone is enough', () => {
    const items = menu({ mode: 'aviation', designation: 'employee', access: 'ExAir' });
    expect(findParent(items, AVIATION)).toBeTruthy();
  });

  test('the admin designation gets it regardless of access levels', () => {
    const items = menu({ mode: 'aviation', designation: 'admin', access: 'Commodity' });
    expect(findParent(items, AVIATION)).toBeTruthy();
  });
});

describe('no token', () => {
  test('aviation mode still returns a menu without crashing', () => {
    load();
    Cookies.get.mockImplementation((n) => (n === 'operationMode' ? 'aviation' : undefined));
    const items = setAccesLevels(jest.fn(), false);
    expect(Array.isArray(items)).toBe(true);
    expect(findParent(items, SEA_JOBS)).toBeFalsy();
  });
});

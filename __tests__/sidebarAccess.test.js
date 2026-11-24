/**
 * The sidebar's sections and entries against a user's access (2026-11-15).
 *
 * The session carries the access names as ONE STRING, and the entries were
 * matched against it with String.includes - a substring test - while the
 * sections were picked by a separate switch that had drifted from them. On
 * SNS that gave a sea-only user an empty Air Jobs section and showed Setup >
 * Charges to a user whose only "Charges" was in perm:jobCharges:view.
 *
 * The rule now: an entry is shown for a whole access name, and a section is
 * shown exactly when it has an entry - never empty, never missing.
 */
const SEA_JOBS = '4';
const AIR_JOBS = '7';
const SETUP = '2';
const ACCOUNTS = '3';
const REPORTS = '5';
const CUSTOMS = '11';

let Cookies; let jwt_decode; let setAccesLevels; let accessNames; let tabSlice;

const menu = ({ access, designation = 'employee', mode = 'freight' }) => {
  jest.resetModules();
  jest.mock('js-cookie', () => ({ get: jest.fn() }));
  jest.mock('jwt-decode', () => jest.fn());
  jest.mock('functions/logout', () => jest.fn());
  jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: jest.fn((x) => x) }));
  Cookies = require('js-cookie');
  jwt_decode = require('jwt-decode');
  tabSlice = require('redux/tabs/tabSlice');
  ({ setAccesLevels, accessNames } = require('functions/setAccesLevels'));
  Cookies.get.mockImplementation((name) => (name === 'operationMode' ? mode : 'valid.jwt.token'));
  jwt_decode.mockReturnValue({ designation, access });
  return setAccesLevels(jest.fn(), false);
};
const section = (items, key) => items.find((s) => s.key === key);
const labels = (items, key) => (section(items, key)?.children || []).map((p) => p.label);

describe('a section is shown exactly when it has an entry', () => {
  // Wahaib on SNS: sea export and import, no air.
  test('a sea-only user has Sea Jobs with both lists, and no empty Air Jobs', () => {
    const items = menu({ access: 'ExSea, ImSea, perm:seaExport:view, perm:seaImport:view' });
    expect(labels(items, SEA_JOBS)).toEqual(['Sea Export Jobs List', 'Sea Import Jobs List']);
    expect(section(items, AIR_JOBS)).toBeUndefined();
  });

  test('import alone reaches Sea Import - it used to open only an empty Air Jobs', () => {
    const items = menu({ access: 'ImSea' });
    expect(labels(items, SEA_JOBS)).toEqual(['Sea Import Jobs List']);
    expect(section(items, AIR_JOBS)).toBeUndefined();
  });

  test('air export alone: Air Jobs, and no empty Sea Jobs', () => {
    const items = menu({ access: 'ExAir' });
    expect(labels(items, AIR_JOBS)).toEqual(['Air Export Jobs List']);
    expect(section(items, SEA_JOBS)).toBeUndefined();
  });

  test('manifests alone are reachable', () => {
    expect(labels(menu({ access: 'manifest' }), AIR_JOBS)).toEqual(['Manifest List']);
  });

  test.each([
    ['ageingReport', 'Ageing Report'],
    ['auditLog', 'Audit Log'],
    ['climaxReconciliation', 'Climax Reconciliation'],
  ])('%s alone brings the Reports section with it', (name, label) => {
    expect(labels(menu({ access: name }), REPORTS)).toEqual([label]);
  });

  test('Direct Job alone brings the Accounts section with it', () => {
    expect(labels(menu({ access: 'DirectJobList' }), ACCOUNTS)).toEqual(['Direct Job E / R', 'Direct Job List']);
  });

  test('a user with nothing gets Setup only - Parties and Fiscal Years are everyone\'s', () => {
    const items = menu({ access: '' });
    expect(items.map((s) => s.key)).toEqual([SETUP]);
    expect(labels(items, SETUP)).toEqual(['Parties', 'Fiscal Years']);
  });

  test.each(['freight', 'customs', 'aviation'])('no section is ever empty (%s)', (mode) => {
    const sets = ['', 'ExSea', 'ImSea', 'ExAir', 'ImAir', 'manifest', 'Ledger', 'DirectJobList', 'ageingReport', 'Charges', 'AWBL, Airports', 'admin'];
    for (const access of sets) {
      for (const s of menu({ access, mode })) expect(s.children.length).toBeGreaterThan(0);
    }
  });

  test('customs: job access brings Customs Job, the freight sections never', () => {
    const items = menu({ access: 'ImSea', mode: 'customs' });
    expect(items[0].key).toBe(CUSTOMS);
    expect(section(items, SEA_JOBS)).toBeUndefined();
    expect(section(items, AIR_JOBS)).toBeUndefined();
  });
});

describe('an entry needs the whole access name', () => {
  // Shafih on SNS.
  test('perm:jobCharges:view does not show Setup > Charges', () => {
    const items = menu({ access: 'ExSea, perm:jobCharges:view, perm:seaExport:view' });
    expect(labels(items, SETUP)).not.toContain('Charges');
  });

  test('the Charges right does', () => {
    expect(labels(menu({ access: 'Charges' }), SETUP)).toContain('Charges');
  });

  test('AWB numbers (which carry Airports) do not show Ports', () => {
    const setup = labels(menu({ access: 'AWBL, Airports' }), SETUP);
    expect(setup).toEqual(expect.arrayContaining(['Airports', 'AWB Numbers']));
    expect(setup).not.toContain('Ports');
  });

  test('Voucher List does not show Voucher', () => {
    const accounts = labels(menu({ access: 'VoucherList' }), ACCOUNTS);
    expect(accounts).toEqual(['Voucher List']);
  });

  test('admin, in the access or as the designation, is everything', () => {
    for (const items of [menu({ access: 'admin' }), menu({ access: '', designation: 'admin' })]) {
      expect(items.map((s) => s.key)).toEqual(expect.arrayContaining([SEA_JOBS, AIR_JOBS, SETUP, ACCOUNTS, REPORTS]));
      expect(labels(items, SETUP)).toContain('Charges');
    }
  });

  test('accessNames splits the session\'s string, and takes a list as it is', () => {
    menu({ access: '' });
    expect(accessNames('ExSea, perm:jobCharges:view,ImSea ')).toEqual(['ExSea', 'perm:jobCharges:view', 'ImSea']);
    expect(accessNames(['Ledger', ' admin '])).toEqual(['Ledger', 'admin']);
    expect(accessNames(undefined)).toEqual([]);
  });
});

describe('the menu works while collapsed', () => {
  // Collapsed, the sidebar shows the sections' icons, each opening its
  // pages beside it - so a click has to open the page then too. It was
  // ignored while collapsed, when the menu showed nothing at all.
  test('a page entry makes and opens its tab with the menu collapsed', () => {
    jest.resetModules();
    jest.mock('js-cookie', () => ({ get: jest.fn(() => 'valid.jwt.token') }));
    jest.mock('jwt-decode', () => jest.fn(() => ({ designation: 'employee', access: 'Ledger' })));
    jest.mock('functions/logout', () => jest.fn());
    jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: jest.fn((x) => x) }));
    const { setAccesLevels: build } = require('functions/setAccesLevels');
    const dispatch = jest.fn();
    const openTab = jest.fn();
    const items = build(dispatch, true, openTab);
    section(items, REPORTS).children[0].onClick();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ key: '5-5' }));
    expect(openTab).toHaveBeenCalledWith(expect.objectContaining({ key: '5-5' }));
  });
});

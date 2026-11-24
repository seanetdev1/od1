/**
 * How this installation numbers its documents - functions/documentNumber.
 *
 * Numbering is the highest-consequence arithmetic in the app: a document
 * number is what an invoice is identified by in our books AND in the client's,
 * so the two failures worth guarding against are a number in the wrong shape
 * and, far worse, the same number issued twice.
 *
 * Config > Document Numbers decides, per class (jobs, invoices, vouchers), the
 * company prefix, the order of sequence and year, and the codes the customer
 * names. An install that never opens it must number exactly as before.
 *
 * The rule that no setting can restart or reuse a number is pinned against a
 * real database in tests/integration/documentNumbering.test.js.
 */

// Named `mock...` because jest.mock's factory is hoisted above every other
// statement and may only reach variables whose name says they are mocks.
const mockFindAll = jest.fn();
jest.mock('../../models', () => ({ AppSetting: { findAll: (...a) => mockFindAll(...a) } }));

const {
  CLASSES, CONFIGURABLE, FIXED, defaults, normalise, validate,
  readNumbering, resetNumbering, codeFor, formatNumber, perCompany, example,
} = require('../../functions/documentNumber');

const rows = (entries) => Object.entries(entries).map(([key, value]) => ({ key, value }));

beforeEach(() => {
  mockFindAll.mockReset();
  resetNumbering();
});

describe('an install that never opens the screen numbers as it always has', () => {
  test('company prefix on, sequence then year, every code as it was', async () => {
    mockFindAll.mockResolvedValue([]);
    const s = await readNumbering();
    expect(formatNumber(s, { klass: 'jobs', company: 'SNS', code: codeFor(s, 'jobs', 'SE'), seq: 140, suffix: '27' }))
      .toBe('SNS-SEJ-140/27');
    expect(codeFor(s, 'jobs', 'SI')).toBe('SIJ');
    expect(codeFor(s, 'jobs', 'AE')).toBe('AE');
    expect(codeFor(s, 'jobs', 'CC')).toBe('CCJ');
    expect(codeFor(s, 'invoices', 'Job Invoice')).toBe('JI');
    expect(codeFor(s, 'invoices', 'Agent Bill')).toBe('AB');
    expect(codeFor(s, 'vouchers', 'BPV')).toBe('BPV');
    expect(codeFor(s, 'vouchers', 'ADJ-R')).toBe('ADJ-R');
  });

  test('an install that chose year-first under the old single setting keeps it everywhere', async () => {
    mockFindAll.mockResolvedValue(rows({ documentNumberFormat: 'year/seq' }));
    const s = await readNumbering();
    for (const k of CLASSES) expect(s.yearFirst[k]).toBe(true);
    expect(formatNumber(s, { klass: 'vouchers', company: 'CL', code: 'BPV', seq: 5, suffix: '27' })).toBe('CL-BPV-27/5');
  });

  test('a database failure falls back to the defaults and is not cached', async () => {
    mockFindAll.mockRejectedValueOnce(new Error('connection lost'));
    expect((await readNumbering()).companyPrefix.jobs).toBe(true);
    mockFindAll.mockResolvedValue(rows({ documentNumbering: JSON.stringify({ companyPrefix: { jobs: false } }) }));
    expect((await readNumbering()).companyPrefix.jobs).toBe(false);
  });

  test('an unreadable stored value falls back rather than failing a document', async () => {
    mockFindAll.mockResolvedValue(rows({ documentNumbering: '{not json' }));
    expect(await readNumbering()).toEqual(defaults());
  });
});

describe('each class is laid out on its own', () => {
  const s = normalise({
    companyPrefix: { jobs: true, invoices: false, vouchers: true },
    yearFirst: { jobs: false, invoices: false, vouchers: true },
    codes: { jobs: { SE: 'SEX' }, vouchers: { BPV: 'BP' } },
  });

  test('prefix and order are per class', () => {
    expect(formatNumber(s, { klass: 'jobs', company: 'SNS', code: codeFor(s, 'jobs', 'SE'), seq: 1, suffix: '27' }))
      .toBe('SNS-SEX-1/27');
    expect(formatNumber(s, { klass: 'invoices', company: 'SNS', code: codeFor(s, 'invoices', 'Job Invoice'), seq: 1, suffix: '27' }))
      .toBe('JI-1/27');
    expect(formatNumber(s, { klass: 'vouchers', company: 'SNS', code: codeFor(s, 'vouchers', 'BPV'), seq: 1, suffix: '27' }))
      .toBe('SNS-BP-27/1');
  });

  test('a kind with no configured code keeps its fixed one, in its class layout', () => {
    expect(codeFor(s, 'jobs', 'AV', 'AVJ')).toBe('AVJ');
    expect(codeFor(s, 'vouchers', 'JV')).toBe('JV');
    expect(formatNumber(s, { klass: 'invoices', company: 'SNS', code: codeFor(s, 'invoices', 'Opening Invoice', 'OI'), seq: 3, suffix: '27' }))
      .toBe('OI-3/27');
  });

  test('the prefix decides whether each company keeps its own sequence', () => {
    expect(perCompany(s, 'jobs')).toBe(true);
    expect(perCompany(s, 'invoices')).toBe(false);
  });

  test('the screen\'s examples are what the formatter produces', () => {
    expect(example(s, 'jobs')).toBe('ABC-SEX-140/27');
    expect(example(s, 'invoices')).toBe('JI-140/27');
    expect(example(s, 'vouchers')).toBe('ABC-BP-27/140');
  });
});

describe('what the screen may save', () => {
  test('codes are upper-cased and trimmed', () => {
    const { settings } = validate({ codes: { jobs: { SE: ' sea ' } } });
    expect(settings.codes.jobs.SE).toBe('SEA');
  });

  test('two kinds in a class may not print the same code', () => {
    expect(validate({ codes: { vouchers: { BRV: 'BV', BPV: 'BV' } } }).error).toMatch(/already used by Bank Receipt/);
  });

  test('nor take a built-in code - an Agent Invoice coded OI would read as an opening invoice', () => {
    expect(validate({ codes: { invoices: { 'Agent Invoice': 'OI' } } }).error).toMatch(/built-in/);
    expect(validate({ codes: { vouchers: { CPV: 'JV' } } }).error).toMatch(/built-in/);
  });

  test('the same code in different classes is fine - they are different documents', () => {
    expect(validate({ codes: { jobs: { AI: 'AI' }, invoices: { 'Agent Invoice': 'AI' } } }).error).toBeUndefined();
  });

  test('blank, too long, or not letters and digits is refused with the reason', () => {
    expect(validate({ codes: { jobs: { SE: '' } } }).error).toMatch(/needs a code/);
    expect(validate({ codes: { jobs: { SE: 'ABCDEFGHI' } } }).error).toMatch(/longer than 8/);
    expect(validate({ codes: { jobs: { SE: 'S E' } } }).error).toMatch(/letters and digits/);
    expect(validate({ codes: { jobs: { SE: 'SE/1' } } }).error).toMatch(/letters and digits/);
    expect(validate({ codes: { vouchers: { 'ADJ-R': 'ADJ-R' } } }).error).toBeUndefined();
  });

  test('anything not sent keeps its default; unknown keys are dropped', () => {
    const { settings } = validate({ companyPrefix: { vouchers: false }, codes: { jobs: { XX: 'Q' } } });
    expect(settings.companyPrefix).toEqual({ jobs: true, invoices: true, vouchers: false });
    expect(settings.codes.jobs).toEqual(defaults().codes.jobs);
  });

  test('every configurable code is distinct from the fixed ones by default', () => {
    for (const k of CLASSES) {
      const codes = CONFIGURABLE[k].map((c) => c.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const c of codes) expect(FIXED[k]).not.toContain(c);
    }
  });
});

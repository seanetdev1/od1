/**
 * A Direct Job's lines - functions/directJobLines (asked 2026-11-13): a blank
 * line always at the bottom of a multiple-job entry, and only the filled lines
 * saved.
 */
import {
  blankLine, lineHasData, linesToSave, withBlankLast, jobFields, linesForJobs, linesPerJob,
  MAX_LINES_PER_JOB,
} from '../functions/directJobLines';

const filled = (over) => ({ ...blankLine(), ...over });

describe('what counts as a line', () => {
  test('a new line is blank', () => {
    expect(lineHasData(blankLine())).toBe(false);
  });

  test('the defaults a charge fills in are not something entered', () => {
    expect(lineHasData(filled({ Currency: 'USD', Basis: 'unit', RateGroup: 'Rate1', ExRate: 280 }))).toBe(false);
    // The first line of a fresh entry, as the slice starts it.
    expect(lineHasData(filled({ Currency: '', JobId: 0, VATCategory: null }))).toBe(false);
  });

  test.each([
    ['a job', { JobNumber: 'CCJ-1/27', JobId: 7 }],
    ['a charge', { Charge: 12 }],
    ['a file number', { FileNumber: 'F-1' }],
    ['a size', { SizeType: '40HC' }],
    ['a quantity', { Quantity: 2 }],
    ['a rate', { Rate: 500 }],
    ['a discount', { Discount: 10 }],
    ['tax', { TaxApply: true }],
    ['a tax amount', { TaxAmount: 5 }],
    ['a VAT category', { VATCategory: 3 }],
    ['a description', { Description: 'Labour' }],
  ])('%s is', (_, over) => {
    expect(lineHasData(filled(over))).toBe(true);
  });

  test('spaces alone are not', () => {
    expect(lineHasData(filled({ Description: '   ', JobNumber: ' ' }))).toBe(false);
  });
});

test('a save sends the filled lines, in order, and none of the blank ones', () => {
  const a = filled({ JobNumber: 'A' });
  const b = filled({ Charge: 3 });
  expect(linesToSave([blankLine(), a, blankLine(), b, blankLine()])).toEqual([a, b]);
  expect(linesToSave([blankLine()])).toEqual([]);
  expect(linesToSave(undefined)).toEqual([]);
});

describe('the blank line at the bottom', () => {
  test('is added once the last line has something on it', () => {
    const a = filled({ JobNumber: 'A' });
    const out = withBlankLast([a]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(a);
    expect(lineHasData(out[1])).toBe(false);
  });

  test('is not added again while the last line is blank', () => {
    expect(withBlankLast([filled({ JobNumber: 'A' }), blankLine()])).toBeNull();
  });

  test('is the only line of an entry with none', () => {
    expect(withBlankLast([])).toEqual([blankLine()]);
  });
});

/* Several jobs from the job list's ticks, so many lines each (asked
 * 2026-11-17). */
describe('lines for several jobs at once', () => {
  const A = { id: 11, jobNo: 'CL-CCJ-11/27', fileNo: 'SR-11' };
  const B = { id: 12, jobNo: 'CL-CCJ-12/27', fileNo: 'SR-12' };

  test("a line's job is the list row's id, number and file number", () => {
    expect(jobFields(A)).toEqual({ JobId: 11, JobNumber: 'CL-CCJ-11/27', FileNumber: 'SR-11' });
    expect(jobFields({ id: 3, jobNo: 'X' })).toEqual({ JobId: 3, JobNumber: 'X', FileNumber: '' });
  });

  test('so many lines per job, job by job, starting at the line the list was opened from', () => {
    const lines = linesForJobs([blankLine()], 0, [A, B], 2);
    expect(lines.map((l) => l.JobNumber)).toEqual(['CL-CCJ-11/27', 'CL-CCJ-11/27', 'CL-CCJ-12/27', 'CL-CCJ-12/27']);
    expect(lines.map((l) => l.FileNumber)).toEqual(['SR-11', 'SR-11', 'SR-12', 'SR-12']);
    // Only the job is filled - the charge and figures are typed afterwards.
    expect(lines.every((l) => l.Charge === '' && l.Rate === 0)).toBe(true);
  });

  test('the rest go in right after that line, not at the bottom; the lines around it are kept', () => {
    const before = [filled({ JobNumber: 'P', Charge: 1 }), filled({ Charge: 7, Rate: 50 }), filled({ JobNumber: 'Q', Charge: 2 })];
    const lines = linesForJobs(before, 1, [A, B], 1);
    expect(lines.map((l) => l.JobNumber)).toEqual(['P', 'CL-CCJ-11/27', 'CL-CCJ-12/27', 'Q']);
    // The line it was opened from keeps what was on it, as picking one job always did.
    expect(lines[1]).toMatchObject({ Charge: 7, Rate: 50, JobId: 11 });
    expect(before[1].JobNumber).toBe('');
  });

  test('the count is a whole number from 1 to the most allowed', () => {
    expect(linesPerJob(0)).toBe(1);
    expect(linesPerJob(null)).toBe(1);
    expect(linesPerJob('3')).toBe(3);
    expect(linesPerJob(10_000)).toBe(MAX_LINES_PER_JOB);
  });

  test('no jobs is no change', () => {
    const before = [blankLine()];
    expect(linesForJobs(before, 0, [], 3)).toEqual(before);
  });
});

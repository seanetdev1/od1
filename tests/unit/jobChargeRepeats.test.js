/**
 * One of each charge per job - functions/jobChargeRepeats (asked 2026-11-17,
 * an install switch, off until turned on): once as a Direct Job expense and
 * once as a revenue across every entry on the job, and once on each side of
 * the job's charge sheet. What a job already held may stay.
 */
const {
  chargeKey, sheetRepeats, directJobRepeats, sheetRepeatsMessage, directJobRepeatsMessage,
} = require('../../functions/jobChargeRepeats');

const PAY = 'Payble';
const REC = 'Recievable';

describe('a charge id', () => {
  test('a number and its string are the same charge', () => {
    expect(chargeKey(5)).toBe('5');
    expect(chargeKey(' 5 ')).toBe('5');
    expect(chargeKey('')).toBe('');
    expect(chargeKey(null)).toBe('');
  });
});

describe("the job's charge sheet", () => {
  test('a charge twice on one side is a repeat', () => {
    expect(sheetRepeats([{ type: PAY, charge: 5 }, { type: PAY, charge: '5' }])).toEqual([
      { type: PAY, charge: '5', count: 2 },
    ]);
  });

  test('once on Payable and once on Receivable is not', () => {
    expect(sheetRepeats([{ type: PAY, charge: 5 }, { type: REC, charge: 5 }])).toEqual([]);
  });

  test('a line with no charge yet is not counted', () => {
    expect(sheetRepeats([{ type: PAY, charge: '' }, { type: PAY, charge: null }])).toEqual([]);
  });

  test('repeats the job already had may stay - but not grow', () => {
    const before = [{ type: PAY, charge: 7 }, { type: PAY, charge: 7 }];
    expect(sheetRepeats(before, before)).toEqual([]);
    expect(sheetRepeats([...before, { type: PAY, charge: 7 }], before)).toEqual([
      { type: PAY, charge: '7', count: 3 },
    ]);
  });
});

describe('Direct Job E/R', () => {
  const WEBOC = 12;

  test('the same charge twice on one job in this entry is a repeat', () => {
    expect(directJobRepeats({
      lines: [{ jobId: 31, charge: WEBOC, jobNo: 'CL-CCJ-31/27' }, { jobId: 31, charge: '12' }],
    })).toEqual([{ jobId: '31', jobNo: 'CL-CCJ-31/27', charge: '12', count: 2 }]);
  });

  test('on two different jobs it is not', () => {
    expect(directJobRepeats({ lines: [{ jobId: 31, charge: WEBOC }, { jobId: 32, charge: WEBOC }] })).toEqual([]);
  });

  test('already on the job in another entry of the same side is a repeat, naming the entry', () => {
    expect(directJobRepeats({
      lines: [{ jobId: 31, charge: WEBOC, jobNo: 'CL-CCJ-31/27' }],
      others: [{ jobId: 31, charge: '12', entryNo: 'CL-DE-4/27' }, { jobId: 31, charge: '12', entryNo: 'CL-DE-4/27' }],
    })).toEqual([{ jobId: '31', jobNo: 'CL-CCJ-31/27', charge: '12', entries: ['CL-DE-4/27'] }]);
  });

  test('editing an entry: what it already held may stay, even where another entry has it too', () => {
    const line = { jobId: 31, charge: WEBOC };
    expect(directJobRepeats({
      lines: [line], before: [line], others: [{ jobId: 31, charge: WEBOC, entryNo: 'CL-DE-4/27' }],
    })).toEqual([]);
    // Two that were there may stay two; a third is refused.
    expect(directJobRepeats({ lines: [line, line], before: [line, line] })).toEqual([]);
    expect(directJobRepeats({ lines: [line, line, line], before: [line, line] })).toHaveLength(1);
  });

  test('a line without a job or a charge is not counted', () => {
    expect(directJobRepeats({ lines: [{ jobId: 0, charge: WEBOC }, { jobId: 0, charge: WEBOC }, { jobId: 31, charge: '' }] })).toEqual([]);
  });
});

describe('what a refused save says', () => {
  test('the Direct Job message names the charge, the job and where it already is', () => {
    const msg = directJobRepeatsMessage([
      { jobId: '31', jobNo: 'CL-CCJ-31/27', charge: '12', entries: ['CL-DE-4/27'] },
      { jobId: '32', jobNo: '', charge: '9', count: 2 },
    ], 'expense', { 12: 'WEBOC TOKEN' });
    expect(msg).toContain('WEBOC TOKEN is already on CL-CCJ-31/27 as an expense, in CL-DE-4/27.');
    expect(msg).toContain('Charge #9 is on job #32 2 times in this entry.');
  });

  test('a revenue says "a revenue"', () => {
    expect(directJobRepeatsMessage([{ jobId: '1', jobNo: 'J', charge: '1', entries: ['E'] }], 'revenue', { 1: 'X' }))
      .toContain('X is already on J as a revenue, in E.');
  });

  test('the sheet message names the side in plain English', () => {
    expect(sheetRepeatsMessage([{ type: PAY, charge: '5', count: 2 }], { 5: 'CARTAGE' }))
      .toContain('CARTAGE is on the Payable side 2 times.');
  });

  test('a long list is cut short', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ type: REC, charge: String(i), count: 2 }));
    expect(sheetRepeatsMessage(many)).toContain('And 3 more.');
  });
});

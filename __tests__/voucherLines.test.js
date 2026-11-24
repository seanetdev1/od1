/**
 * The Voucher screen's lines as Direct Job keeps its own (2026-11-16): a blank
 * one at the bottom always, only the filled ones saved, a new line on the side
 * that balances a journal, and a two-line journal's one figure - never copied
 * into the blank line. functions/voucherLines.
 */
import {
  voucherLineHasData, voucherLinesToSave, newLineSide, blankVoucherLine, withBlankLastVoucherLine, mirroredLines,
} from 'functions/voucherLines';

const line = (over = {}) => ({ ChildAccountId: undefined, amount: 0, narration: '', type: 'debit', ...over });

describe('what counts as a line', () => {
  test('an account, an amount or a narration', () => {
    expect(voucherLineHasData(line({ ChildAccountId: 12 }))).toBe(true);
    expect(voucherLineHasData(line({ amount: 500 }))).toBe(true);
    expect(voucherLineHasData(line({ narration: 'SALARY' }))).toBe(true);
  });
  test('its side alone does not - every line starts on one', () => {
    expect(voucherLineHasData(line({ type: 'credit' }))).toBe(false);
    expect(voucherLineHasData(line({ narration: '   ', ChildAccountId: '' }))).toBe(false);
    expect(voucherLineHasData(null)).toBe(false);
  });
  test('a save sends the filled ones, in their order', () => {
    const lines = [line({ ChildAccountId: 1 }), line(), line({ amount: 5 }), line()];
    expect(voucherLinesToSave(lines)).toEqual([lines[0], lines[2]]);
  });
});

describe('the blank line at the bottom', () => {
  test('added once the last line has something in it', () => {
    const lines = withBlankLastVoucherLine([line({ ChildAccountId: 1 })], 'BPV');
    expect(lines).toHaveLength(2);
    expect(voucherLineHasData(lines[1])).toBe(false);
  });
  test('not twice - nothing when the last line is already blank', () => {
    expect(withBlankLastVoucherLine([line({ ChildAccountId: 1 }), line()], 'BPV')).toBeNull();
  });
  test('the first line of a voucher with a type, none before there is one', () => {
    expect(withBlankLastVoucherLine([], 'JV')).toHaveLength(1);
    expect(withBlankLastVoucherLine([], '')).toBeNull();
  });
});

describe('the side a new line starts on', () => {
  test.each([['BPV', 'debit'], ['CPV', 'debit'], ['BRV', 'credit'], ['CRV', 'credit']])('%s: its own side', (vType, side) => {
    expect(newLineSide([], vType)).toBe(side);
    expect(blankVoucherLine([], vType).type).toBe(side);
  });
  test('a journal: the first on the debit, then the side that is short', () => {
    expect(newLineSide([], 'JV')).toBe('debit');
    expect(newLineSide([line({ ChildAccountId: 1, amount: 1000, type: 'debit' })], 'JV')).toBe('credit');
    expect(newLineSide([
      line({ ChildAccountId: 1, amount: 1000, type: 'debit' }),
      line({ ChildAccountId: 2, amount: 400, type: 'credit' }),
    ], 'TV')).toBe('credit');
    expect(newLineSide([
      line({ ChildAccountId: 1, amount: 300, type: 'debit' }),
      line({ ChildAccountId: 2, amount: 1000, type: 'credit' }),
    ], 'JV')).toBe('debit');
  });
  test('a balanced journal: the other side from the last line', () => {
    expect(newLineSide([
      line({ ChildAccountId: 1, amount: 500, type: 'debit' }),
      line({ ChildAccountId: 2, amount: 500, type: 'credit' }),
    ], 'JV')).toBe('debit');
  });
});

describe('a two-line journal is one figure', () => {
  test('typed on one of two filled lines, both carry it', () => {
    const lines = [line({ ChildAccountId: 1 }), line({ ChildAccountId: 2 }), line()];
    expect(mirroredLines(lines, 0)).toEqual([0, 1]);
  });
  test('never the blank line at the bottom', () => {
    expect(mirroredLines([line({ ChildAccountId: 1 }), line()], 0)).toEqual([0]);
  });
  test('three filled lines or more: the line typed on alone', () => {
    const lines = [line({ ChildAccountId: 1 }), line({ ChildAccountId: 2 }), line({ ChildAccountId: 3 }), line()];
    expect(mirroredLines(lines, 1)).toEqual([1]);
  });
});

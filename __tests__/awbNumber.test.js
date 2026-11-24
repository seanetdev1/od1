/**
 * The screen's copy of the IATA numbering rule.
 *
 * functions/awbNumber.js exists so Setup > AWB Stock can show which numbers a
 * series will produce before two hundred of them are registered. It MIRRORS
 * functions/awb.js on the backend, which is what actually gets stored - so
 * these cases are deliberately the same ones the backend's own tests use. If
 * the two ever disagree, the backend is right and this is the bug.
 */
import { checkDigitFor, formatNumber, previewSeries, MAX_SERIAL } from 'functions/awbNumber';

describe('the check digit', () => {
  test('is the serial modulo 7, and wraps 6 -> 0', () => {
    expect([1000005, 1000006, 1000007].map(checkDigitFor)).toEqual(['6', '0', '1']);
  });
});

describe('formatNumber', () => {
  test('splits the 3-digit carrier prefix off with a dash', () => {
    expect(formatNumber('21410000001')).toBe('214-10000001');
  });

  test('leaves anything that is not 11 digits alone rather than mangling it', () => {
    // Legacy consignments hold a number typed before the register existed.
    // Reformatting one into something that looks official would be worse than
    // showing it as it was entered.
    expect(formatNumber('LOCKME')).toBe('LOCKME');
    expect(formatNumber('')).toBe('');
  });
});

describe('previewSeries', () => {
  test('says nothing while the number is still being typed', () => {
    expect(previewSeries('214', '100', false, 1)).toBeNull();
  });

  test('names the carrier as the problem when it has no prefix', () => {
    // The prefix is not typed here - it comes off the carrier record - so this
    // is a Setup problem, and the message has to send the user there.
    expect(previewSeries('', '10000001', false, 1).error).toMatch(/Setup > Carriers/);
  });

  test('rejects a wrong check digit and gives the corrected number', () => {
    const p = previewSeries('214', '10000009', false, 1);
    expect(p.error).toMatch(/should be 1, not 9/);
    expect(p.error).toContain('214-10000001');
  });

  test('previews a single number', () => {
    expect(previewSeries('214', '10000001', false, 1)).toMatchObject({
      total: 1, head: ['214-10000001'], last: '214-10000001', truncated: false,
    });
  });

  test('previews a series, showing the first few and where it ends', () => {
    // "200 numbers from 214-10000001" does not tell anyone where the block
    // stops, which is the one thing worth checking before committing to it.
    const p = previewSeries('214', '10000001', true, 9);
    expect(p.total).toBe(9);
    expect(p.head).toEqual(['214-10000001', '214-10000012', '214-10000023', '214-10000034']);
    expect(p.last).toBe('214-10000082');   // check digit wrapped 6 -> 0 on the way
  });

  test('stops at the 7-digit ceiling and says so', () => {
    const p = previewSeries('214', `${MAX_SERIAL - 1}${checkDigitFor(MAX_SERIAL - 1)}`, true, 5);
    expect(p.total).toBe(2);
    expect(p.truncated).toBe(true);
  });
});

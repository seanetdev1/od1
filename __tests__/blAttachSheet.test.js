/**
 * Splitting a B/L's text between the form's box and the attach sheet
 * (functions/blAttachSheet). Measured here with a fixed half-em per
 * character, so a 3mm font in a 30mm box holds 20 characters a line.
 */
import { wrapLine, fitLines } from 'functions/blAttachSheet';

const em = (t) => t.length * 0.5;
// fitLines measures 0.3mm short of the box; 30.3mm leaves exactly 20 characters.
const box = (heightMm) => ({ widthMm: 30.3, heightMm, em });

describe('wrapping a line as the browser will', () => {
  test('breaks between words at the box edge', () => {
    expect(wrapLine('aaaa bbbb cccc dddd eeee', 30, 3, em)).toEqual(['aaaa bbbb cccc dddd', 'eeee']);
  });

  test('a word wider than the box breaks at the edge', () => {
    expect(wrapLine('x'.repeat(45), 30, 3, em)).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(5)]);
  });

  test('an empty line is still one line', () => {
    expect(wrapLine('', 30, 3, em)).toEqual(['']);
  });
});

describe('filling a box', () => {
  const short = (n) => Array.from({ length: n }, (_, i) => `LINE ${i + 1}`);

  test('36mm at 3mm and 1.2 holds 10 lines; the rest continue, in order', () => {
    const { fits, rest } = fitLines(short(12), box(36));
    expect(fits).toEqual(short(10));
    expect(rest).toEqual(['LINE 11', 'LINE 12']);
  });

  test('the description box (65mm) holds 18 and the marks box (45mm) 12', () => {
    expect(fitLines(short(30), box(65)).fits).toHaveLength(18);
    expect(fitLines(short(30), box(45)).fits).toHaveLength(12);
  });

  test('a line that would wrap past the foot goes over whole', () => {
    const lines = [...short(9), 'aaaa bbbb cccc dddd eeee', 'LAST'];   // the 10th prints as two
    const { fits, rest } = fitLines(lines, box(36));
    expect(fits).toEqual(short(9));
    expect(rest).toEqual(['aaaa bbbb cccc dddd eeee', 'LAST']);
  });

  test('everything fits: nothing continues', () => {
    expect(fitLines(short(3), box(36))).toEqual({ fits: short(3), rest: [] });
  });

  test('one line taller than the whole box is split at its foot', () => {
    const words = Array.from({ length: 30 }, () => 'wwww wwww').join(' ');   // 60 words, 15 lines
    const { fits, rest } = fitLines([words, 'NEXT'], box(36));
    expect(fits).toHaveLength(1);
    expect(wrapLine(fits[0], 30, 3, em)).toHaveLength(10);
    expect(`${fits[0]} ${rest[0]}`).toBe(words);
    expect(rest[1]).toBe('NEXT');
  });
});

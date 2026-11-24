/**
 * Splitting a B/L's marks and description between the form and its attach
 * sheet.
 *
 * The form's boxes hold a fixed amount: at the print's 3mm and 1.2 line
 * height, the description's 65mm holds 18 lines and the marks' 45mm 12 -
 * Climax's own limits for the Seanet form (18 x 46 characters). Whatever does
 * not fit continues on an attach sheet, as Climax printed it, instead of
 * running down over "Above particulars" and the charges table.
 *
 * Lines are wrapped the way the browser will wrap them (measured in the
 * print's font, functions/fitText), and a line is kept whole on whichever page
 * it starts on - one that does not fit goes over entire.
 */
import { textEm } from './fitText';

export const LINE_HEIGHT = 1.2;

/** One line word-wrapped to `widthMm` at `fontMm`: the lines it prints as. */
export function wrapLine(text, widthMm, fontMm = 3, em = textEm) {
  const maxEm = widthMm / fontMm;
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const out = [];
  let cur = '';
  for (let word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (em(next) <= maxEm) { cur = next; continue; }
    if (cur) out.push(cur);
    // A word wider than the box breaks where it reaches the edge.
    while (em(word) > maxEm && word.length > 1) {
      let n = word.length - 1;
      while (n > 1 && em(word.slice(0, n)) > maxEm) n -= 1;
      out.push(word.slice(0, n));
      word = word.slice(n);
    }
    cur = word;
  }
  out.push(cur);
  return out;
}

/**
 * The lines that fit a box, in order, and the rest.
 * @returns {{ fits: string[], rest: string[] }}
 */
export function fitLines(lines, { widthMm, heightMm, fontMm = 3, em = textEm }) {
  const max = Math.max(1, Math.floor(heightMm / (fontMm * LINE_HEIGHT) + 1e-6));
  // A hair narrower than the box: the canvas and the layout can round apart.
  const width = widthMm - 0.3;
  const fits = [];
  let used = 0;
  let i = 0;
  for (; i < lines.length; i += 1) {
    const n = wrapLine(lines[i], width, fontMm, em).length;
    if (used + n > max) break;
    fits.push(lines[i]);
    used += n;
  }
  const rest = lines.slice(i);
  // One line taller than the whole box: split it at the box's foot, or
  // nothing would ever print on the form.
  if (!fits.length && rest.length) {
    const wrapped = wrapLine(rest[0], width, fontMm, em);
    fits.push(wrapped.slice(0, max).join(' '));
    rest[0] = wrapped.slice(max).join(' ');
  }
  return { fits, rest };
}

/**
 * ONE SIZE FOR THE BIG BOXES (the user's request, 2026-10-13: "resize all
 * data to be the same font size"). The party boxes - shipper, consignee,
 * notify, delivery agent - have nowhere to overflow to, so a long one ran out
 * of its box. The largest size, from the print's 3mm down to `minMm` (2mm, the
 * smallest that still reads), at which EVERY one of them fits; every big box
 * prints at it - the marks and description too, which then fit their lines at
 * that size and send the rest to the attach sheet as before. Nothing too long
 * at `minMm` either: `minMm`, and it runs on.
 *
 * @param boxes  [{ lines: string[], widthMm, heightMm }]
 */
export function uniformFontMm(boxes, { maxMm = 3, minMm = 2, stepMm = 0.1, em = textEm } = {}) {
  const fits = (box, fontMm) => {
    const max = Math.max(1, Math.floor(box.heightMm / (fontMm * LINE_HEIGHT) + 1e-6));
    const used = (box.lines || []).reduce((n, line) => n + wrapLine(line, box.widthMm - 0.3, fontMm, em).length, 0);
    return used <= max;
  };
  for (let f = maxMm; f >= minMm - 1e-9; f = Math.round((f - stepMm) * 100) / 100) {
    if ((boxes || []).every((b) => fits(b, f))) return f;
  }
  return minMm;
}

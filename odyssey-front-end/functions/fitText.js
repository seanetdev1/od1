/**
 * Fitting one line of print text into a fixed box by its font size.
 *
 * For values printed into a form's boxes - a port name like "MUHAMMAD BIN
 * QASIM/KARACHI, PAKISTAN" is wider than its box at the BL's 3mm, and wrapped
 * onto the next box's heading. Shrinking it just enough keeps it on one line.
 *
 * Measured with a canvas in the browser (the print's font: bold Times New
 * Roman). Where there is none - tests - an estimate for bold capitals.
 */
let ctx = null;
const canMeasure = () => typeof document !== 'undefined'
  && typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent || '');

/** The text's width in ems of the given font. */
export function textEm(text, family = '"Times New Roman", serif') {
  const t = String(text ?? '');
  if (canMeasure()) {
    try {
      ctx = ctx || document.createElement('canvas').getContext('2d');
      if (ctx) {
        ctx.font = `bold 100px ${family}`;
        const w = ctx.measureText(t).width;
        if (w > 0) return w / 100;
      }
    } catch (_) { /* fall through to the estimate */ }
  }
  return t.length * 0.65;
}

/** The font size, in mm, that fits `text` on one line `widthMm` wide. */
export function fitFontMm(text, widthMm, maxMm = 3, minMm = 2.2) {
  const em = textEm(text);
  if (!em) return maxMm;
  return Math.max(minMm, Math.min(maxMm, Math.floor((widthMm / em) * 100) / 100));
}

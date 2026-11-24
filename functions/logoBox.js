/**
 * The box a company's logo is drawn in, in the sidebar - by its SHAPE.
 *
 * It was a fixed cap: at most 48px tall and the sidebar's width. A wide
 * wordmark filled the width and read well; a square logo came out 48 x 48,
 * its lettering too small to read (the user, 2026-11-18: "rectangular logos
 * look good here but square logos not so much").
 *
 * EQUAL AREA, NOT EQUAL HEIGHT - the usual way to give logos of different
 * shapes the same visual weight: each gets about AREA square pixels, so a
 * 4:1 wordmark is ~180 x 45 (as before) and a square one ~90 x 90. Kept
 * within the sidebar's width and a height that does not push the menu far
 * down; a very wide or very tall logo meets those limits first.
 */

export const LOGO_AREA = 8100;        // a 90 x 90 square
export const LOGO_MAX_WIDTH = 184;    // the sidebar's 224px less the brand button's margin and padding
export const LOGO_MAX_HEIGHT = 92;
export const LOGO_MIN_HEIGHT = 36;

/**
 * @param ratio  the logo's width / height, once it has loaded; anything else
 *               (not loaded yet, unreadable) gets the old cap
 * @returns a style: { width, height } in px
 */
export function logoBox(ratio, {
  area = LOGO_AREA, maxWidth = LOGO_MAX_WIDTH, maxHeight = LOGO_MAX_HEIGHT, minHeight = LOGO_MIN_HEIGHT,
} = {}) {
  if (!(Number.isFinite(ratio) && ratio > 0)) return { maxWidth: '100%', maxHeight: 48 };
  let height = Math.min(maxHeight, Math.max(minHeight, Math.sqrt(area / ratio)));
  let width = height * ratio;
  if (width > maxWidth) { width = maxWidth; height = width / ratio; }
  return { width: Math.round(width), height: Math.round(height) };
}

/** Square enough to stand in for the company's initial on the collapsed rail. */
export const isSquarish = (ratio) => Number.isFinite(ratio) && ratio >= 0.75 && ratio <= 1.34;

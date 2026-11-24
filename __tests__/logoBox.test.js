/**
 * The sidebar logo's box, by its shape - functions/logoBox (the user,
 * 2026-11-18: square logos came out too small).
 */
import { logoBox, isSquarish, LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT } from '../functions/logoBox';

test('a wide wordmark stays about as it was - the width, under 48px tall', () => {
  const box = logoBox(4);
  expect(box.width).toBeGreaterThanOrEqual(175);
  expect(box.width).toBeLessThanOrEqual(LOGO_MAX_WIDTH);
  expect(box.height).toBeLessThanOrEqual(48);
});

test('a square logo is about twice as tall as the old 48px stamp', () => {
  expect(logoBox(1)).toEqual({ width: 90, height: 90 });
  // Essani's shape, 535 x 467.
  const essani = logoBox(535 / 467);
  expect(essani.height).toBeGreaterThan(80);
  expect(essani.width).toBeLessThanOrEqual(LOGO_MAX_WIDTH);
});

test('never wider than the sidebar nor taller than the limit', () => {
  for (const ratio of [0.2, 0.5, 1, 2, 4, 8, 20]) {
    const { width, height } = logoBox(ratio);
    expect(width).toBeLessThanOrEqual(LOGO_MAX_WIDTH);
    expect(height).toBeLessThanOrEqual(LOGO_MAX_HEIGHT);
  }
});

test('before the logo has loaded, the old cap', () => {
  expect(logoBox(null)).toEqual({ maxWidth: '100%', maxHeight: 48 });
  expect(logoBox(NaN)).toEqual({ maxWidth: '100%', maxHeight: 48 });
});

test('square enough to stand in for the initial on the collapsed rail', () => {
  expect(isSquarish(1)).toBe(true);
  expect(isSquarish(535 / 467)).toBe(true);
  expect(isSquarish(4)).toBe(false);
  expect(isSquarish(null)).toBe(false);
});

/**
 * The pre-printed B/L's printer adjustment - Stamps' Adjust: { x: right mm,
 * y: down mm, scale % } - kept per PC, since the printer is the PC's.
 *
 * DEFAULT is what the SEANET 8.5 x 12in stock needed on the test printer
 * (2026-10-14): down 3mm, left 2.7mm, 102.1% - the user's choice for any PC
 * that has not saved its own.
 *
 * No React - unit tested.
 */
export const OFFSET_KEY = 'odyssey.blPrePrintedOffset';
export const DEFAULT_OFFSET = Object.freeze({ x: -2.7, y: 3, scale: 102.1 });

const LIMITS = { x: [-20, 20], y: [-20, 20], scale: [90, 110] };

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** One value, kept in range; anything unreadable falls back to the default. */
export function clampOffset(axis, value) {
  const n = num(value);
  if (!Number.isFinite(n)) return DEFAULT_OFFSET[axis];
  const [lo, hi] = LIMITS[axis];
  return Math.max(lo, Math.min(hi, n));
}

/** What this PC saved, or the default. A saved 0 stays 0. */
export function readOffset(storage) {
  try {
    const raw = storage?.getItem(OFFSET_KEY);
    if (!raw) return { ...DEFAULT_OFFSET };
    const saved = JSON.parse(raw) || {};
    return { x: clampOffset('x', saved.x), y: clampOffset('y', saved.y), scale: clampOffset('scale', saved.scale) };
  } catch (_) {
    return { ...DEFAULT_OFFSET };
  }
}

/** Saved for next time; quietly not, where the browser will not store it. */
export function saveOffset(storage, offset) {
  try { storage?.setItem(OFFSET_KEY, JSON.stringify(offset)); } catch (_) { /* not remembered */ }
}

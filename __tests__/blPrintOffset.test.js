/**
 * The pre-printed B/L's printer adjustment - functions/blPrintOffset. The
 * values the test printer needed are every PC's default (the user's request,
 * 2026-10-14); a PC that saves its own keeps them.
 */
import { readOffset, saveOffset, clampOffset, DEFAULT_OFFSET, OFFSET_KEY } from 'functions/blPrintOffset';

const store = (initial) => {
  const data = { ...(initial ? { [OFFSET_KEY]: initial } : {}) };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
};

test('a PC with nothing saved starts at down 3, left 2.7, 102.1%', () => {
  expect(DEFAULT_OFFSET).toEqual({ x: -2.7, y: 3, scale: 102.1 });
  expect(readOffset(store())).toEqual({ x: -2.7, y: 3, scale: 102.1 });
  expect(readOffset(null)).toEqual(DEFAULT_OFFSET);
});

test("a PC's own values win, a saved 0 included", () => {
  expect(readOffset(store(JSON.stringify({ x: 0, y: 1.5, scale: 100 })))).toEqual({ x: 0, y: 1.5, scale: 100 });
});

test('saved and read back; unreadable storage falls back to the default', () => {
  const s = store();
  saveOffset(s, { x: -1, y: 2, scale: 101 });
  expect(readOffset(s)).toEqual({ x: -1, y: 2, scale: 101 });
  expect(readOffset(store('not json'))).toEqual(DEFAULT_OFFSET);
  expect(() => saveOffset({ setItem: () => { throw new Error('blocked'); } }, DEFAULT_OFFSET)).not.toThrow();
});

test('kept in range', () => {
  expect(clampOffset('y', 50)).toBe(20);
  expect(clampOffset('x', -50)).toBe(-20);
  expect(clampOffset('scale', 150)).toBe(110);
  expect(clampOffset('scale', null)).toBe(102.1);
});

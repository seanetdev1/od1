/** A browser's date as the day it is in Pakistan - functions/pkDay. */
const { pkDay } = require('../../functions/pkDay');

test("midnight in Karachi, sent in UTC, is that day - not the one before", () => {
  expect(pkDay('2026-06-30T19:00:00.000Z')).toBe('2026-07-01');
  expect(pkDay('Wed Jul 01 2026 00:00:00 GMT+0500')).toBe('2026-07-01');
});
test('a plain day is that day; nothing readable is null', () => {
  expect(pkDay('2026-11-05')).toBe('2026-11-05');
  expect(pkDay('')).toBeNull();
  expect(pkDay('nonsense')).toBeNull();
});

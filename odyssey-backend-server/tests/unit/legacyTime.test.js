const { legacyTimestamp } = require('../../functions/legacyTime');

/* Climax entry times are Pakistan wall clock that the bridge reads as UTC.
 * SNS-BRV-00255/27 was entered at 19:09 on 30 Sep and showed in the ledger on
 * 1 Oct. */
describe('legacyTimestamp', () => {
  it('reads a Climax entry time as Pakistan time', () => {
    expect(legacyTimestamp('2026-09-30T19:09:36.380Z')).toBe('2026-09-30T14:09:36.380Z');
  });

  it('keeps an evening entry on its own day in Karachi', () => {
    const real = new Date(legacyTimestamp('2026-09-30T23:30:00.000Z'));
    const karachi = new Date(real.getTime() + 5 * 3600000).toISOString().slice(0, 10);
    expect(karachi).toBe('2026-09-30');
  });

  it('takes a Date as well as a string', () => {
    expect(legacyTimestamp(new Date('2024-03-07T13:31:19.813Z'))).toBe('2024-03-07T08:31:19.813Z');
  });

  it('is null for nothing, and leaves a non-date alone', () => {
    expect(legacyTimestamp(null)).toBeNull();
    expect(legacyTimestamp(undefined)).toBeNull();
    expect(legacyTimestamp('')).toBeNull();
    expect(legacyTimestamp('not a date')).toBe('not a date');
  });
});

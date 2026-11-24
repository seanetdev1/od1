/**
 * The named date ranges - functions/reportPeriods.js.
 *
 * These are CALENDAR periods, so the rules worth pinning are the boundaries a
 * reader cannot check for themselves: where a fortnight splits, what happens at
 * the ends of months of different lengths, and what an unrecognised or
 * half-typed period resolves to.
 *
 * `now` is passed to every case on purpose. A test that reckons from the day it
 * runs passes all month and then fails on the 16th.
 */
const { resolvePeriod, toExclusive, fortnightOf, PERIODS } = require('../../functions/reportPeriods');

describe('the fortnight', () => {
  test('splits on the 16th', () => {
    expect(resolvePeriod('fortnight', { now: '2026-10-01' }))
      .toEqual({ from: '2026-10-01', to: '2026-10-15', period: 'fortnight' });
    expect(resolvePeriod('fortnight', { now: '2026-10-15' }))
      .toEqual({ from: '2026-10-01', to: '2026-10-15', period: 'fortnight' });
    expect(resolvePeriod('fortnight', { now: '2026-10-16' }))
      .toEqual({ from: '2026-10-16', to: '2026-10-31', period: 'fortnight' });
    expect(resolvePeriod('fortnight', { now: '2026-10-31' }))
      .toEqual({ from: '2026-10-16', to: '2026-10-31', period: 'fortnight' });
  });

  test('the second half ends where the MONTH ends, not 14 days in', () => {
    // February is the case that catches a fortnight implemented as +14 days.
    expect(fortnightOf(require('moment')('2026-02-20', 'YYYY-MM-DD', true)))
      .toEqual({ from: '2026-02-16', to: '2026-02-28' });
    // And a leap year is the case that catches a hardcoded 28.
    expect(fortnightOf(require('moment')('2028-02-20', 'YYYY-MM-DD', true)))
      .toEqual({ from: '2028-02-16', to: '2028-02-29' });
  });

  test('is SHORT early in a period, which is the point of showing the dates', () => {
    // Not a bug: it is the half-month the books reconcile in. The screen shows
    // the resolved range so this is visible rather than surprising.
    const r = resolvePeriod('fortnight', { now: '2026-10-02' });
    expect(r.from).toBe('2026-10-01');
    expect(r.to).toBe('2026-10-15');
  });
});

describe('month and quarter', () => {
  test('month is the calendar month', () => {
    expect(resolvePeriod('month', { now: '2026-10-20' }))
      .toEqual({ from: '2026-10-01', to: '2026-10-31', period: 'month' });
    expect(resolvePeriod('month', { now: '2026-02-05' }))
      .toEqual({ from: '2026-02-01', to: '2026-02-28', period: 'month' });
  });

  test('quarter is the calendar quarter', () => {
    expect(resolvePeriod('quarter', { now: '2026-10-20' }))
      .toEqual({ from: '2026-10-01', to: '2026-12-31', period: 'quarter' });
    expect(resolvePeriod('quarter', { now: '2026-01-01' }))
      .toEqual({ from: '2026-01-01', to: '2026-03-31', period: 'quarter' });
  });
});

describe('the fiscal year', () => {
  test('is whatever the selected year says it is', () => {
    // Deliberately not a calendar year: it is passed in because only the route
    // knows which year the session has selected.
    expect(resolvePeriod('fiscalYear', {
      now: '2026-10-20',
      fiscalYear: { startDate: '2026-07-01', endDate: '2027-06-30' },
    })).toEqual({ from: '2026-07-01', to: '2027-06-30', period: 'fiscalYear' });
  });

  test('falls back to the fortnight when none is resolved', () => {
    // No session, or none selected. NOT a licence to read every invoice ever
    // written, which is what an absent date bound would mean.
    expect(resolvePeriod('fiscalYear', { now: '2026-10-20' }))
      .toEqual({ from: '2026-10-16', to: '2026-10-31', period: 'fortnight' });
  });
});

describe('a custom range', () => {
  test('is taken as typed', () => {
    expect(resolvePeriod('custom', { from: '2026-01-01', to: '2026-03-15' }))
      .toEqual({ from: '2026-01-01', to: '2026-03-15', period: 'custom' });
  });

  test('typed the wrong way round is a slip, not an empty range', () => {
    expect(resolvePeriod('custom', { from: '2026-03-15', to: '2026-01-01' }))
      .toEqual({ from: '2026-01-01', to: '2026-03-15', period: 'custom' });
  });

  test('half-typed falls back rather than dropping the missing bound', () => {
    // Dropping it would turn "from January" into "everything since records
    // began", which is the load this whole feature exists to avoid.
    expect(resolvePeriod('custom', { from: '2026-01-01', now: '2026-10-20' }).period)
      .toBe('fortnight');
    expect(resolvePeriod('custom', { now: '2026-10-20' }).period).toBe('fortnight');
  });
});

describe('an unrecognised period', () => {
  test('resolves to the fortnight - the NARROWEST, not the widest', () => {
    // A typo should cost a short list, never a year of invoices.
    for (const bad of ['year', '', null, undefined, 'FORTNIGHT', 'all']) {
      expect(resolvePeriod(bad, { now: '2026-10-20' }).period).toBe('fortnight');
    }
  });

  test('PERIODS names exactly what is understood', () => {
    expect(PERIODS).toEqual(['fortnight', 'month', 'quarter', 'fiscalYear', 'custom']);
  });
});

describe('toExclusive', () => {
  test('is the day after, so a timestamp on the closing day is inside', () => {
    // `createdAt <= '2026-10-15'` compares against midnight and drops
    // everything written during the 15th - most of that day's invoices.
    expect(toExclusive({ to: '2026-10-15' })).toBe('2026-10-16');
    expect(toExclusive({ to: '2026-10-31' })).toBe('2026-11-01');
    expect(toExclusive({ to: '2026-12-31' })).toBe('2027-01-01');
    expect(toExclusive({ to: '2028-02-29' })).toBe('2028-03-01');
  });
});

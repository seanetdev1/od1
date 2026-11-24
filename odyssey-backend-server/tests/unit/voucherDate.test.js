const moment = require('moment');
const {
  pickedDate, ledgerDateOf, openingBalanceDate, openingBalanceRedate,
} = require('../../functions/voucherDate');

const day = (d) => moment(d).format('YYYY-MM-DD');

describe('pickedDate - the date a screen picked for a voucher', () => {
  test('reads DD-MM-YYYY day first: 05-09-2026 is 5 September, not 9 May', () => {
    expect(day(pickedDate('05-09-2026'))).toBe('2026-09-05');
  });

  test('reads a day past the 12th, which month-first parsing rejected', () => {
    expect(day(pickedDate('28-09-2026'))).toBe('2026-09-28');
  });

  test('keeps a full ISO timestamp to the millisecond', () => {
    expect(pickedDate('2026-08-20T09:15:30.250Z').toISOString()).toBe('2026-08-20T09:15:30.250Z');
  });

  test('reads YYYY-MM-DD and DD/MM/YYYY', () => {
    expect(day(pickedDate('2026-07-16'))).toBe('2026-07-16');
    expect(day(pickedDate('03/08/2026'))).toBe('2026-08-03');
  });

  test('passes a valid Date through', () => {
    const d = new Date('2026-08-03T10:00:00Z');
    expect(pickedDate(d)).toBe(d);
  });

  test.each([undefined, null, '', 'not a date', '31-02-2026', new Date('nope')])('%p is no date', (v) => {
    expect(pickedDate(v)).toBeNull();
  });
});

describe('ledgerDateOf - falls back to now only when nothing was picked', () => {
  const now = new Date('2026-10-03T12:00:00Z');

  test('a picked date wins', () => {
    expect(day(ledgerDateOf('05-09-2026', now))).toBe('2026-09-05');
  });

  test.each([undefined, '', 'garbage'])('%p falls back to now', (v) => {
    expect(ledgerDateOf(v, now)).toBe(now);
  });
});

/* An opening balance stands on the day before its fiscal year opens, so every
 * ledger and trial balance of that year counts it in the balance brought
 * forward. It used to be the 30 June that ENDS the year - after every report
 * run during it. */
describe('openingBalanceDate - where an opening balance stands', () => {
  const fy2627 = { startDate: '2026-07-01' };

  test('2026-2027 opens on 1 July 2026, so its opening stands on 30 June 2026', () => {
    expect(openingBalanceDate(fy2627).toISOString()).toBe('2026-06-30T12:00:00.000Z');
  });

  test('NOT the 30 June that ends the year, whenever it is entered', () => {
    // Entered in October and in February - the old rule gave 30 June 2027 both times.
    expect(openingBalanceDate(fy2627, new Date('2026-10-17')).toISOString()).toBe('2026-06-30T12:00:00.000Z');
    expect(openingBalanceDate(fy2627, new Date('2027-02-10')).toISOString()).toBe('2026-06-30T12:00:00.000Z');
  });

  test('is 30 June in Pakistan as well as in UTC', () => {
    const d = openingBalanceDate(fy2627);
    expect(moment(d).utcOffset(300).format('YYYY-MM-DD')).toBe('2026-06-30');
    expect(moment(d).utc().format('YYYY-MM-DD')).toBe('2026-06-30');
  });

  test('a year that does not open in July is followed too', () => {
    expect(openingBalanceDate({ startDate: '2027-01-01' }).toISOString()).toBe('2026-12-31T12:00:00.000Z');
  });

  test('with no start date, the 30 June before today’s July-to-June year', () => {
    expect(openingBalanceDate(null, new Date('2026-10-17T10:00:00Z')).toISOString()).toBe('2026-06-30T12:00:00.000Z');
    expect(openingBalanceDate({}, new Date('2027-02-10T10:00:00Z')).toISOString()).toBe('2026-06-30T12:00:00.000Z');
  });
});

/* An opening balance already saved, when it is edited: only a date after the
 * first day of its year is the old rule's, and moves. */
describe('openingBalanceRedate - an edited opening balance', () => {
  const fy2627 = { startDate: '2026-07-01' };
  const iso = (d) => d.toISOString();

  test('the old rule’s 30 June 2027 moves to 30 June 2026', () => {
    expect(iso(openingBalanceRedate(new Date('2027-06-30T18:59:59.999Z'), fy2627))).toBe('2026-06-30T12:00:00.000Z');
  });

  test('so does the moment of an earlier edit', () => {
    expect(iso(openingBalanceRedate(new Date('2026-10-17T09:00:00Z'), fy2627))).toBe('2026-06-30T12:00:00.000Z');
  });

  test('one dated on the first day on purpose is kept - the demo seed’s', () => {
    expect(iso(openingBalanceRedate(new Date('2026-07-01T00:00:00Z'), fy2627))).toBe('2026-07-01T00:00:00.000Z');
  });

  test('one already on the right date stays there', () => {
    expect(iso(openingBalanceRedate(new Date('2026-06-30T12:00:00Z'), fy2627))).toBe('2026-06-30T12:00:00.000Z');
  });

  test('no date at all goes on the day before the year', () => {
    expect(iso(openingBalanceRedate(null, fy2627))).toBe('2026-06-30T12:00:00.000Z');
  });
});

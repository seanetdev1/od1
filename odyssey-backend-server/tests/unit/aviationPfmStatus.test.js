/**
 * Which PFM a flight may be built from.
 *
 * Three rules - confirmed, unused, not in the past - and the reason they are
 * tested here rather than left to the endpoint is that FOUR places have to
 * agree about them: /pfm/selectable builds the dropdown from them, the flight
 * save refuses on them, the PFM screen greys itself out on them, and the PFM
 * list colours by them. A rule that drifts between any two of those shows a
 * plan in the dropdown that the save then rejects.
 */
const {
  DRAFT, CONFIRMED, CANCELLED, PFM_STATUSES,
  statusOf, isCancelled, isConfirmed, selectableReason,
} = require('../../functions/aviationPfmStatus');

const TODAY = '2026-09-23';

// A plan that passes every rule, so each test can break exactly one.
const pfm = (over = {}) => ({
  pfmNo: 'IFA-PFM-4/26',
  status: CONFIRMED,
  flightDate: '2026-09-30',
  ...over,
});

describe('the three statuses', () => {
  test('are draft, confirmed and cancelled, in that order', () => {
    expect(PFM_STATUSES).toEqual([DRAFT, CONFIRMED, CANCELLED]);
  });

  test('a blank status reads as Draft - the model default means "still being written"', () => {
    expect(statusOf({ status: '' })).toBe(DRAFT);
    expect(statusOf({ status: null })).toBe(DRAFT);
    expect(statusOf({})).toBe(DRAFT);
    expect(statusOf(undefined)).toBe(DRAFT);
  });

  test('an unrecognised stored value is returned as itself, not relabelled', () => {
    // It came from the database. Quietly calling it a draft would hide
    // whatever put it there.
    expect(statusOf({ status: 'Provisional' })).toBe('Provisional');
  });

  test('isCancelled and isConfirmed read through the same rule', () => {
    expect(isCancelled({ status: CANCELLED })).toBe(true);
    expect(isCancelled({ status: DRAFT })).toBe(false);
    expect(isConfirmed({ status: CONFIRMED })).toBe(true);
    expect(isConfirmed({})).toBe(false);   // blank is Draft, not Confirmed
  });
});

describe('selectableReason - null means the flight may be built from it', () => {
  test('confirmed, unflown and dated ahead is selectable', () => {
    expect(selectableReason(pfm(), TODAY, null)).toBeNull();
  });

  test("today's flight is still selectable - the aircraft has not gone yet", () => {
    expect(selectableReason(pfm({ flightDate: TODAY }), TODAY, null)).toBeNull();
  });

  test('a draft is refused, and the message says to confirm it', () => {
    const why = selectableReason(pfm({ status: DRAFT }), TODAY, null);
    expect(why).toMatch(/draft/i);
    expect(why).toMatch(/confirm/i);
  });

  test('a cancelled plan is refused', () => {
    expect(selectableReason(pfm({ status: CANCELLED }), TODAY, null)).toMatch(/cancelled/i);
  });

  test('a plan already flown is refused, and the message names the flight', () => {
    const why = selectableReason(pfm(), TODAY, 'IFA-AVJ-12/26');
    expect(why).toMatch(/IFA-AVJ-12\/26/);
  });

  test('a date that has passed is refused, and the message says which date', () => {
    const why = selectableReason(pfm({ flightDate: '2026-09-22' }), TODAY, null);
    expect(why).toMatch(/2026-09-22/);
    expect(why).toMatch(/passed/i);
  });

  test('a plan with no flight date at all is refused', () => {
    expect(selectableReason(pfm({ flightDate: '' }), TODAY, null)).toMatch(/no flight date/i);
  });

  test('a missing plan is refused rather than throwing', () => {
    // The dropdown can hold an id whose row was deleted underneath it.
    expect(selectableReason(null, TODAY, null)).toMatch(/no longer exists/i);
  });

  /* ORDER MATTERS. A cancelled plan that has also been flown should report the
   * cancellation, not the flight: the first thing wrong with it is the thing
   * to say. The reverse - reporting "already flown" for a plan somebody
   * cancelled - sends the reader looking for a flight that explains nothing. */
  test('the first failing rule is the one reported', () => {
    const why = selectableReason(
      pfm({ status: CANCELLED, flightDate: '2020-01-01' }), TODAY, 'IFA-AVJ-1/20',
    );
    expect(why).toMatch(/cancelled/i);
    expect(why).not.toMatch(/passed/i);
  });

  /* Dates are 'YYYY-MM-DD' strings and compared as text. That is only correct
   * because the format is fixed-width and zero-padded, which is worth pinning:
   * a date that lost its padding would compare as later than it is. */
  test('string comparison orders dates correctly across a month boundary', () => {
    expect(selectableReason(pfm({ flightDate: '2026-10-01' }), TODAY, null)).toBeNull();
    expect(selectableReason(pfm({ flightDate: '2026-08-31' }), TODAY, null)).toMatch(/passed/i);
  });
});

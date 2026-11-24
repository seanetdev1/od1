/**
 * Which PFM a flight may be built from - the browser's copy of the rule.
 *
 * This module is a deliberate MIRROR of the backend's
 * functions/aviationPfmStatus. The two cannot import from each other, so the
 * rules are written twice, and the only thing standing between that and a
 * silent drift is that both sides are tested on the same cases. A drift shows
 * a plan in the flight's dropdown that the save then refuses, which is the
 * worst possible way to learn a rule exists.
 *
 * Four screens read this one: /pfm/selectable builds the dropdown from it, the
 * flight's save refuses on it, the PFM form greys itself out on it, and the
 * PFM list has a column of it.
 */
import {
  DRAFT, CONFIRMED, CANCELLED, PFM_STATUSES,
  statusOf, isCancelled, isConfirmed, statusColor, selectableReason, flownAs, isFrozen,
} from 'functions/aviationPfmStatus';

const TODAY = '2026-09-23';

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

  test('a blank status reads as Draft', () => {
    expect(statusOf({ status: '' })).toBe(DRAFT);
    expect(statusOf({})).toBe(DRAFT);
    expect(statusOf(undefined)).toBe(DRAFT);
  });

  test('an unrecognised stored value is returned as itself, not relabelled', () => {
    expect(statusOf({ status: 'Provisional' })).toBe('Provisional');
  });

  test('isCancelled and isConfirmed read through the same rule', () => {
    expect(isCancelled({ status: CANCELLED })).toBe(true);
    expect(isConfirmed({ status: CONFIRMED })).toBe(true);
    expect(isConfirmed({})).toBe(false);
  });

  test('the colours separate working, agreed and abandoned', () => {
    expect(statusColor(DRAFT)).toBe('blue');
    expect(statusColor(CONFIRMED)).toBe('green');
    expect(statusColor(CANCELLED)).toBe('red');
  });
});

describe('flownAs / isFrozen - has a flight been built from this plan', () => {
  test('a plan with no flight is not frozen', () => {
    expect(flownAs(pfm())).toBeNull();
    expect(isFrozen(pfm())).toBe(false);
  });

  test('a plan with a flight reports its job number', () => {
    const p = pfm({ Aviation_Job: { id: 9, jobNo: 'IFA-AVJ-12/26' } });
    expect(flownAs(p)).toBe('IFA-AVJ-12/26');
    expect(isFrozen(p)).toBe(true);
  });

  test('a flight with no job number still identifies itself', () => {
    // A flight always has an id even when its number has not been read back.
    // "flown as undefined" would be worse than useless in the banner.
    expect(flownAs(pfm({ Aviation_Job: { id: 9 } }))).toBe('flight #9');
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
    expect(selectableReason(pfm(), TODAY, 'IFA-AVJ-12/26')).toMatch(/IFA-AVJ-12\/26/);
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
    expect(selectableReason(null, TODAY, null)).toMatch(/no longer exists/i);
  });

  test('the first failing rule is the one reported', () => {
    const why = selectableReason(
      pfm({ status: CANCELLED, flightDate: '2020-01-01' }), TODAY, 'IFA-AVJ-1/20',
    );
    expect(why).toMatch(/cancelled/i);
    expect(why).not.toMatch(/passed/i);
  });

  test('string comparison orders dates correctly across a month boundary', () => {
    expect(selectableReason(pfm({ flightDate: '2026-10-01' }), TODAY, null)).toBeNull();
    expect(selectableReason(pfm({ flightDate: '2026-08-31' }), TODAY, null)).toMatch(/passed/i);
  });
});

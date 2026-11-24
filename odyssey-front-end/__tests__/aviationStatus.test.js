/**
 * A flight's status.
 *
 * Operated was spelled 'Active' until 1.2.2, and the value is stored as it is
 * displayed - so every flight entered before the rename still holds the old
 * word. These tests pin the one rule that keeps those readable without a
 * migration anyone has to remember to run.
 */
import {
  STATUSES, OPERATED, CANCELED, NILL, NOT_OPERATED,
  statusLabel, statusOf, statusColor, didNotFly,
} from 'functions/aviationStatus';

describe('the list offered', () => {
  test('is Operated, Canceled, Not-Operated, Nill - Active is gone', () => {
    expect(STATUSES).toEqual([OPERATED, CANCELED, NOT_OPERATED, NILL]);
    expect(STATUSES).not.toContain('Active');
  });
});

describe('a flight that did not go', () => {
  test('is either cancelled or not-operated', () => {
    expect(didNotFly({ status: NOT_OPERATED })).toBe(true);
    expect(didNotFly({ status: CANCELED })).toBe(true);
  });

  test('is NOT a NIL flight - that one went and carried nothing', () => {
    // The confusion this vocabulary exists to prevent. A NIL flight counts as
    // operated everywhere, on both the screen and the server.
    expect(didNotFly({ status: NILL })).toBe(false);
    expect(didNotFly({ status: OPERATED })).toBe(false);
    expect(didNotFly({ status: 'Active' })).toBe(false);
  });

  test('the cancel flag still wins over the dropdown', () => {
    // Matches isNotOperated on the backend: a flight holding both is
    // cancelled, so it cannot be counted in two buckets at once.
    expect(statusOf({ status: NOT_OPERATED, canceled: true })).toBe(CANCELED);
  });

  test('is amber, not the red kept for a deliberate cancellation', () => {
    expect(statusColor(NOT_OPERATED)).toBe('orange');
    expect(statusColor(CANCELED)).toBe('red');
  });
});

describe('reading a stored status', () => {
  test("'Active' reads as Operated", () => {
    // Stored on every flight entered before 1.2.2. An antd Select handed a
    // value that is not in its options renders a blank, so without this the
    // status simply disappeared off old flights.
    expect(statusLabel('Active')).toBe(OPERATED);
  });

  test('blank and missing read as Operated too', () => {
    // Which is what the model default has always meant: a flight with nothing
    // said about it is one that flew.
    expect(statusLabel('')).toBe(OPERATED);
    expect(statusLabel(null)).toBe(OPERATED);
    expect(statusLabel(undefined)).toBe(OPERATED);
    expect(statusLabel('   ')).toBe(OPERATED);
  });

  test('the other two are left exactly as they are', () => {
    expect(statusLabel(CANCELED)).toBe(CANCELED);
    expect(statusLabel(NILL)).toBe(NILL);
  });
});

describe('the status of a row', () => {
  test('the canceled FLAG wins over the status column', () => {
    // The two are not kept in step, and a flight somebody cancelled is
    // cancelled whatever its status still says. Matches isCancelled on the
    // backend, which takes the union for the same reason.
    expect(statusOf({ canceled: true, status: 'Active' })).toBe(CANCELED);
    expect(statusOf({ canceled: true, status: NILL })).toBe(CANCELED);
  });

  test('otherwise it is the stored status, normalised', () => {
    expect(statusOf({ canceled: false, status: 'Active' })).toBe(OPERATED);
    expect(statusOf({ status: OPERATED })).toBe(OPERATED);
    expect(statusOf({})).toBe(OPERATED);
  });
});

describe('colour', () => {
  test('a cancelled flight is red and a nil one is plain', () => {
    expect(statusColor(CANCELED)).toBe('red');
    expect(statusColor(NILL)).toBe('default');
  });

  test('operated is blue - and so is a legacy row read through statusOf', () => {
    expect(statusColor(OPERATED)).toBe('blue');
    expect(statusColor(statusOf({ status: 'Active' }))).toBe('blue');
  });
});

import { ageingDays, sortAgeingRows } from 'functions/ageingRows';
import { startingSize, chargeSizeOptions, EQUIPMENT_SIZES, DEFAULT_CHARGE_SIZE } from 'functions/equipmentSizes';

/* THE AGEING REPORT - functions/ageingRows (the user's requests, 2026-10-09).
 * An invoice is aged by its own date - not by when it was last touched - as on
 * TODAY, whatever the To date (2026-11-02), and the accounts are listed
 * largest first. The second argument stands in for today here. */
describe('ageingDays', () => {
  test("from the invoice's date to today, in whole days", () => {
    expect(ageingDays({ createdAt: '2026-07-01T10:00:00Z' }, '2026-07-31T00:00:00Z')).toBe(30);
    expect(ageingDays({ createdAt: '2026-07-31T05:00:00Z' }, '2026-07-31T18:00:00Z')).toBe(0);
  });

  test('not when it was last touched: a part payment yesterday does not make it young', () => {
    const inv = { createdAt: '2025-10-01T07:00:00Z', updatedAt: '2026-10-08T07:00:00Z' };
    expect(ageingDays(inv, '2026-10-09T07:00:00Z')).toBe(373);
  });

  test('no date: current; and it is today unless told', () => {
    expect(ageingDays({}, '2026-10-09')).toBe(0);
    expect(ageingDays({ createdAt: new Date().toISOString() })).toBe(0);
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
    expect(ageingDays({ createdAt: tenDaysAgo })).toBe(10);
  });

  test('a forward-dated invoice is current until its date comes', () => {
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString();
    expect(ageingDays({ createdAt: nextMonth })).toBe(0);
  });
});

describe('sortAgeingRows', () => {
  const row = (AccountTitle, Currency, total) => ({ AccountTitle, Currency, total });

  test('largest first - a payable (negative) by its size', () => {
    const sorted = sortAgeingRows([row('A', 'PKR', 500), row('B', 'PKR', -9000), row('C', 'PKR', 12000)]);
    expect(sorted.map((r) => r.AccountTitle)).toEqual(['C', 'B', 'A']);
  });

  test('within each currency, rupees first - USD and PKR are not one list', () => {
    const sorted = sortAgeingRows([row('U1', 'USD', 900), row('P1', 'PKR', 100), row('E1', 'EUR', 50000), row('U2', 'USD', 4000)]);
    expect(sorted.map((r) => r.AccountTitle)).toEqual(['P1', 'E1', 'U2', 'U1']);
  });

  test('a tie by name; the list it was given is left alone', () => {
    const given = [row('Zeta', 'PKR', 100), row('Alpha', 'PKR', 100)];
    expect(sortAgeingRows(given).map((r) => r.AccountTitle)).toEqual(['Alpha', 'Zeta']);
    expect(given[0].AccountTitle).toBe('Zeta');
  });
});

/* A FREIGHT CHARGE'S SIZE - functions/equipmentSizes (the user's report,
 * 2026-10-09: charges were not picking the size from Equipment Info). */
describe('equipment sizes on the charge sheet', () => {
  test("a new line starts at the job's equipment size", () => {
    expect(startingSize([{ size: '20SD', qty: 2 }])).toBe('20SD');
    expect(startingSize([{ size: '' }, { size: '45HC' }, { size: '40HC' }])).toBe('45HC');
  });

  test('no equipment: 40HC, as before', () => {
    expect(startingSize([])).toBe(DEFAULT_CHARGE_SIZE);
    expect(startingSize(undefined)).toBe('40HC');
  });

  test("offers the job's sizes first, then every other - 20SD included", () => {
    const ids = chargeSizeOptions([{ size: '20SD' }, { size: '40HCRF' }], '20SD').map((o) => o.id);
    expect(ids.slice(0, 2)).toEqual(['20SD', '40HCRF']);
    expect(ids).toHaveLength(EQUIPMENT_SIZES.length);
    expect(chargeSizeOptions([], '40HC')[0]).toEqual({ id: '40HC', name: '40HC' });
  });

  test("keeps a line's own size that is on no list - Climax's '40 FR'", () => {
    expect(chargeSizeOptions([], '40 FR').map((o) => o.id)).toContain('40 FR');
  });
});

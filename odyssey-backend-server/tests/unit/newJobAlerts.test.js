const {
  withDefaults, validate, subscribed, readCursor, worthTelling,
} = require('../../functions/newJobAlerts');

/* NEW JOB ALERTS (the user, 2026-11-23) - the rules without a database. */
describe('new job alerts - who gets them', () => {
  it('nobody until designations are picked', () => {
    expect(withDefaults(null)).toEqual({ designations: [] });
    expect(subscribed('ceo', withDefaults(null))).toBe(false);
  });

  it('the picked designations, whatever their case; unknown ones dropped', () => {
    const s = withDefaults({ designations: ['GD Operator', 'ceo', 'system', 'janitor'] });
    expect(s.designations).toEqual(['ceo', 'gd operator']);
    expect(subscribed('CEO', s)).toBe(true);
    expect(subscribed('gd operator', s)).toBe(true);
    expect(subscribed('manager', s)).toBe(false);
    expect(subscribed(null, s)).toBe(false);
  });

  it('refuses what the screen could not have sent', () => {
    expect(() => validate(null)).toThrow('Send { designations: [...] }.');
    expect(() => validate({ designations: 'ceo' })).toThrow('Send { designations: [...] }.');
    expect(() => validate({ designations: ['ceo', 'janitor'] })).toThrow('Unknown designation: janitor.');
    expect(validate({ designations: ['Manager'] })).toEqual({ designations: ['manager'] });
  });
});

describe('new job alerts - the cursor', () => {
  it('none sent is a first ask', () => {
    expect(readCursor({})).toBeNull();
    expect(readCursor({ freight: 'x', customs: '-1' })).toBeNull();
  });

  it('whole numbers per kind; a kind not sent is left out', () => {
    expect(readCursor({ freight: '120', customs: '0' })).toEqual({ freight: 120, customs: 0 });
  });
});

describe('new job alerts - which new jobs to tell about', () => {
  const rows = [
    { id: 1, jobNo: 'A', createdBy: 'Admin', companyId: '1', climaxId: null },
    { id: 2, jobNo: 'B', createdBy: 'Noman', companyId: '1', climaxId: null },
    { id: 3, jobNo: 'C', createdBy: null, companyId: '3', climaxId: 991 },
    { id: 4, jobNo: 'D', createdBy: 'Admin', companyId: '3' },
  ];

  it('not your own, not migrated', () => {
    expect(worthTelling(rows, { companies: null, me: ' noman ' }).map((r) => r.jobNo)).toEqual(['A', 'D']);
  });

  it('only companies you work in, when you are limited to some', () => {
    expect(worthTelling(rows, { companies: new Set(['3']), me: 'Noman' }).map((r) => r.jobNo)).toEqual(['D']);
  });
});

const { daysWithDefaults, validateDays, DAYS } = require('../../functions/bellAlerts');

/* THE BELL'S ALERT DAYS (the user, 2026-11-23) - set in Configuration. */
describe('bell alert days', () => {
  it('default to 90 / 45 / 7 / 7 / 7, and a stored one that makes no sense reads as its default', () => {
    expect(daysWithDefaults(null)).toEqual({ critical: 90, due: 45, noCharges: 7, onVessel: 7, unfinished: 7 });
    expect(daysWithDefaults({ critical: 120, due: 0, noCharges: 'x', unfinished: 2.5 })).toEqual({ ...DAYS, critical: 120 });
  });

  it('keep Invoices Due under Critical, even from a damaged store', () => {
    expect(daysWithDefaults({ critical: 30 }).due).toBe(29);
    expect(daysWithDefaults({ critical: 120, due: 60 }).due).toBe(60);
  });

  it('a save: whole days from 1 to 3650, over what is stored, Due under Critical', () => {
    expect(validateDays({ critical: '120' }, { ...DAYS, noCharges: 14 })).toEqual({ ...DAYS, critical: 120, noCharges: 14 });
    expect(() => validateDays({ critical: 0 })).toThrow('critical must be a whole number of days from 1 to 3650.');
    expect(() => validateDays({ due: 12.5 })).toThrow('due must be a whole number');
    expect(() => validateDays({ due: '' })).toThrow('due must be a whole number');
    expect(() => validateDays({ weeks: 2 })).toThrow('Unknown setting: weeks.');
    expect(() => validateDays({ due: 90 })).toThrow(/Invoices Due \(90\) must be fewer days than Critical \(90\)/);
    expect(() => validateDays(null)).toThrow(/Send the days/);
  });
});

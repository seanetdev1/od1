const rules = require('../../functions/taskRules');

/**
 * Status used to be a free string enforced only by a dropdown. These pin the
 * vocabulary and the date arithmetic that recurrence depends on.
 */
describe('normaliseStatus', () => {
  it('accepts the canonical spellings', () => {
    for (const s of rules.STATUSES) expect(rules.normaliseStatus(s)).toBe(s);
  });

  it('accepts a different case and returns the canonical spelling', () => {
    // "done" from an API client is unambiguous. Rejecting it, or worse storing
    // it verbatim so the task drops out of every active list, both help nobody.
    expect(rules.normaliseStatus('done')).toBe('Done');
    expect(rules.normaliseStatus('IN-PROGRESS')).toBe('In-progress');
  });

  it('tolerates surrounding whitespace', () => {
    expect(rules.normaliseStatus('  Done  ')).toBe('Done');
  });

  it('rejects anything else rather than storing it', () => {
    expect(rules.normaliseStatus('Complete')).toBeNull();
    expect(rules.normaliseStatus('finished')).toBeNull();
    expect(rules.normaliseStatus('Do ne')).toBeNull();
  });

  it('treats absent as absent, not invalid', () => {
    expect(rules.normaliseStatus(undefined)).toBeNull();
    expect(rules.normaliseStatus('')).toBeNull();
  });
});

describe('normaliseRecurrence', () => {
  it('defaults an unset value to none', () => {
    expect(rules.normaliseRecurrence(undefined)).toBe('none');
    expect(rules.normaliseRecurrence('')).toBe('none');
  });

  it('accepts the known intervals', () => {
    for (const r of rules.RECURRENCES) expect(rules.normaliseRecurrence(r)).toBe(r);
  });

  it('rejects an unknown interval', () => {
    expect(rules.normaliseRecurrence('fortnightly')).toBeNull();
  });
});

describe('isActive / isDone', () => {
  it('treats a task with no status as still active', () => {
    // Rows created before this feature have a null status; they must not
    // silently disappear from everyone's list.
    expect(rules.isActive(null)).toBe(true);
  });

  it('separates open from finished', () => {
    expect(rules.isActive('Backlog')).toBe(true);
    expect(rules.isActive('In-Review')).toBe(true);
    expect(rules.isActive('Done')).toBe(false);
    expect(rules.isDone('Done')).toBe(true);
    expect(rules.isDone('In-progress')).toBe(false);
  });
});

describe('nextOccurrence', () => {
  const at = (iso) => new Date(iso);

  it('advances a day and a week', () => {
    expect(rules.nextOccurrence(at('2026-03-10T09:00:00Z'), 'daily').toISOString())
      .toBe('2026-03-11T09:00:00.000Z');
    expect(rules.nextOccurrence(at('2026-03-10T09:00:00Z'), 'weekly').toISOString())
      .toBe('2026-03-17T09:00:00.000Z');
  });

  it('advances a month by the calendar, not by 30 days', () => {
    // Adding 30 days would land on 9 April and drift further every cycle.
    expect(rules.nextOccurrence(at('2026-03-10T09:00:00Z'), 'monthly').toISOString())
      .toBe('2026-04-10T09:00:00.000Z');
  });

  it('clamps to the end of a shorter month', () => {
    // 31 Jan + 1 month must be 28 Feb, not 3 March.
    expect(rules.nextOccurrence(at('2026-01-31T09:00:00Z'), 'monthly').toISOString())
      .toBe('2026-02-28T09:00:00.000Z');
  });

  it('handles a leap year', () => {
    expect(rules.nextOccurrence(at('2028-01-31T09:00:00Z'), 'monthly').toISOString())
      .toBe('2028-02-29T09:00:00.000Z');
  });

  it('advances a quarter and crosses the year end', () => {
    expect(rules.nextOccurrence(at('2026-11-15T09:00:00Z'), 'quarterly').toISOString())
      .toBe('2027-02-15T09:00:00.000Z');
  });

  it('returns null when there is nothing to advance', () => {
    expect(rules.nextOccurrence(null, 'monthly')).toBeNull();
    expect(rules.nextOccurrence(at('2026-03-10T09:00:00Z'), 'none')).toBeNull();
    expect(rules.nextOccurrence(at('2026-03-10T09:00:00Z'), undefined)).toBeNull();
  });

  it('returns null for an unparseable date rather than an Invalid Date', () => {
    expect(rules.nextOccurrence('not a date', 'daily')).toBeNull();
  });
});

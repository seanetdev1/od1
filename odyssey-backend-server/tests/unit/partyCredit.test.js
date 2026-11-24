const { creditLimitsFrom } = require('../../functions/partyCredit');

describe("a party's credit limits as the party form sends them", () => {
  it('stores what was typed', () => {
    expect(creditLimitsFrom({ creditLimitDays: 30, creditLimitAmount: 500000 }))
      .toEqual({ creditLimitDays: 30, creditLimitAmount: 500000 });
    expect(creditLimitsFrom({ creditLimitDays: '45', creditLimitAmount: '1,250,000.50' }))
      .toEqual({ creditLimitDays: 45, creditLimitAmount: 1250000.5 });
  });

  it('keeps a blank box apart from 0 - no limit set, against no credit at all', () => {
    expect(creditLimitsFrom({ creditLimitDays: '', creditLimitAmount: null }))
      .toEqual({ creditLimitDays: null, creditLimitAmount: null });
    expect(creditLimitsFrom({ creditLimitDays: 0, creditLimitAmount: '0' }))
      .toEqual({ creditLimitDays: 0, creditLimitAmount: 0 });
  });

  it('leaves the columns alone when the form did not send them', () => {
    expect(creditLimitsFrom({ name: 'ACME' })).toEqual({});
    expect(creditLimitsFrom(undefined)).toEqual({});
  });

  it('rounds the amount to paisa', () => {
    expect(creditLimitsFrom({ creditLimitAmount: 100.555 }).creditLimitAmount).toBe(100.56);
  });

  it('refuses a limit it would otherwise have to drop', () => {
    expect(() => creditLimitsFrom({ creditLimitDays: 7.5 })).toThrow('whole number of days');
    expect(() => creditLimitsFrom({ creditLimitDays: -1 })).toThrow('whole number of days');
    expect(() => creditLimitsFrom({ creditLimitDays: 'thirty' })).toThrow('whole number of days');
    expect(() => creditLimitsFrom({ creditLimitAmount: -5 })).toThrow('0 or more');
    expect(() => creditLimitsFrom({ creditLimitAmount: 'lots' })).toThrow('0 or more');
  });
});

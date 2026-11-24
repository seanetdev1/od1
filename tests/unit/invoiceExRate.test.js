/**
 * An invoice's exchange rate from its lines, at approval -
 * functions/invoiceExRate.
 */
const { rateFromLines, exRatePatch } = require('../../functions/invoiceExRate');

const usd = (rate, extra = {}) => ({ currency: 'USD', ex_rate: String(rate), ...extra });
const pkr = (extra = {}) => ({ currency: 'PKR', ex_rate: '1', ...extra });

describe('an invoice in a foreign currency', () => {
  const agent = { currency: 'USD', ex_rate: '280' };

  test('follows its lines when they were corrected to a new rate', () => {
    expect(rateFromLines({ invoice: agent, charges: [usd(285), usd(285)], total: 200, defaultTotal: 57000 })).toBe('285');
  });

  test('lines at two rates: the rate their totals imply', () => {
    // 100 @ 280 + 100 @ 290 = 57,000 rupees for 200 dollars - 285 a dollar.
    expect(rateFromLines({ invoice: agent, charges: [usd(280), usd(290)], total: 200, defaultTotal: 57000 })).toBe('285');
    expect(rateFromLines({ invoice: agent, charges: [usd(280), usd(281)], total: 3, defaultTotal: 841 })).toBe('280.3333');
  });

  test('reads only the lines in its own currency', () => {
    expect(rateFromLines({ invoice: agent, charges: [usd(285), pkr()], total: 100, defaultTotal: 28600 })).toBe('285');
  });

  test('nothing to go on: left as it is', () => {
    expect(rateFromLines({ invoice: agent, charges: [], total: 0, defaultTotal: 0 })).toBeNull();
    expect(rateFromLines({ invoice: agent, charges: [usd(0)], total: 0, defaultTotal: 0 })).toBeNull();
  });
});

describe('an invoice in rupees', () => {
  test('at rate 1 - customs, and rupee-only freight - is left alone', () => {
    expect(rateFromLines({ invoice: { currency: 'PKR', ex_rate: '1' }, charges: [usd(285)], total: 28500, defaultTotal: 28500 })).toBeNull();
    expect(rateFromLines({ invoice: { currency: 'PKR', ex_rate: null }, charges: [usd(285)] })).toBeNull();
  });

  test('carrying a foreign rate: kept in step with its foreign lines', () => {
    const jobInvoice = { currency: 'PKR', ex_rate: '282.4' };
    expect(rateFromLines({ invoice: jobInvoice, charges: [usd(285), pkr()] })).toBe('285');
    // Two rates on a rupee invoice name no single one.
    expect(rateFromLines({ invoice: jobInvoice, charges: [usd(285), usd(290)] })).toBeNull();
  });
});

describe('the patch', () => {
  test('only when the rate actually changes', () => {
    expect(exRatePatch({ invoice: { currency: 'USD', ex_rate: '285.00' }, charges: [usd(285)], total: 100, defaultTotal: 28500 })).toEqual({});
    expect(exRatePatch({ invoice: { currency: 'USD', ex_rate: '280' }, charges: [usd(285)], total: 100, defaultTotal: 28500 }))
      .toEqual({ ex_rate: '285' });
    expect(exRatePatch({ invoice: { currency: 'PKR', ex_rate: '1' }, charges: [usd(285)] })).toEqual({});
  });
});

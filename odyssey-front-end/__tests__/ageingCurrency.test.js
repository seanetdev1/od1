import {
  ageingFigures, currencyTotals, currencyLabel, ALL_CURRENCIES, ALL_IN_LOCAL,
} from '../functions/ageingCurrency';

const usdInvoice = { currency: 'USD', ex_rate: '280', payType: 'Recievable', total: '1000', recieved: '400', paid: '0' };
const pkrBill = { currency: 'PKR', ex_rate: '282.4', payType: 'Payble', total: '50000', paid: '10000', recieved: '0' };

describe('what an invoice adds to the ageing', () => {
  test('in its own currency: the outstanding balance, a payable negative', () => {
    expect(ageingFigures(usdInvoice, ALL_CURRENCIES)).toEqual({ currency: 'USD', balance: 600 });
    expect(ageingFigures(pkrBill, ALL_CURRENCIES)).toEqual({ currency: 'PKR', balance: -40000 });
  });

  test('a single currency shows it the same way', () => {
    expect(ageingFigures(usdInvoice, 'USD')).toEqual({ currency: 'USD', balance: 600 });
  });

  test('all in PKR: converted at the invoice\'s own rate', () => {
    expect(ageingFigures(usdInvoice, ALL_IN_LOCAL)).toEqual({ currency: 'PKR', balance: 168000 });
  });

  test('a PKR invoice converts at 1, whatever rate it carries', () => {
    expect(ageingFigures(pkrBill, ALL_IN_LOCAL)).toEqual({ currency: 'PKR', balance: -40000 });
  });

  test('no currency is PKR; blank figures are nothing, not NaN', () => {
    expect(ageingFigures({ total: '', payType: 'Recievable' }, ALL_CURRENCIES)).toEqual({ currency: 'PKR', balance: 0 });
  });
});

describe('the total line for each currency', () => {
  const buckets = ['Current', 'oneThirty'];
  const rows = [
    { Currency: 'USD', Current: 100, oneThirty: 50, total: 150 },
    { Currency: 'PKR', Current: 1000, oneThirty: 0, total: 1000 },
    { Currency: 'USD', Current: 10, oneThirty: 5, total: 15 },
    { Currency: 'EUR', Current: 0, oneThirty: 7, total: 7 },
  ];

  test('adds each currency on its own - never USD into PKR - PKR first', () => {
    expect(currencyTotals(rows, buckets)).toEqual([
      { Currency: 'PKR', Current: 1000, oneThirty: 0, total: 1000 },
      { Currency: 'EUR', Current: 0, oneThirty: 7, total: 7 },
      { Currency: 'USD', Current: 110, oneThirty: 55, total: 165 },
    ]);
  });

  test('nothing to total, no lines', () => {
    expect(currencyTotals([], buckets)).toEqual([]);
  });
});

test('the heading names the choice', () => {
  expect(currencyLabel(ALL_IN_LOCAL)).toBe('All, in PKR');
  expect(currencyLabel('USD')).toBe('USD');
  expect(currencyLabel(undefined)).toBe('All currencies');
});

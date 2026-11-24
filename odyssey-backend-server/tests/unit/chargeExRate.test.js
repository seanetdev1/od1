const { foreignRateProblem } = require('../../functions/chargeExRate');

/* A FOREIGN CHARGE'S RATE - functions/chargeExRate (the user's request,
 * 2026-10-13). The same cases as the screen's (frontend
 * __tests__/freightChargeRatesAndSizes). */
const usd = (over) => ({ type: 'Recievable', currency: 'USD', ex_rate: '280', status: '0', particular: 'OCEAN FREIGHT', ...over });

test('an open USD line at 1 is refused, naming it', () => {
  expect(foreignRateProblem([usd(), usd({ ex_rate: '1' })])).toBe('Charge line 2 (OCEAN FREIGHT, USD) needs an exchange rate above 1.');
  expect(foreignRateProblem([usd({ currency: 'EUR', ex_rate: 0 })])).toMatch(/EUR/);
});

test('rupee lines, and lines already approved or on an approved invoice, are not', () => {
  expect(foreignRateProblem([{ currency: 'PKR', ex_rate: '1' }])).toBeNull();
  expect(foreignRateProblem([usd({ ex_rate: '1', status: '1' })])).toBeNull();
  expect(foreignRateProblem([usd({ ex_rate: '1', Invoice: { approved: '1' } })])).toBeNull();
  expect(foreignRateProblem(undefined)).toBeNull();
});

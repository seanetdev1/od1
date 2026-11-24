const { currencyChange } = require('../../functions/invoiceCurrency');

/* CHANGING AN INVOICE'S CURRENCY - functions/invoiceCurrency (the user's
 * report, 2026-10-12). The total comes from the charge lines, as approval
 * builds it; a foreign currency must be the lines' own; an approved invoice
 * keeps the currency its voucher was posted in. */
const usd = [
  { type: 'Recievable', currency: 'USD', net_amount: '100', local_amount: '28000' },
  { type: 'Recievable', currency: 'USD', net_amount: '50', local_amount: '14150' },
];
const open = { approved: '0' };

test("to PKR: the lines' own PKR amounts - each at its own rate, not the invoice's one", () => {
  expect(currencyChange(open, usd, 'pkr')).toEqual({ currency: 'PKR', total: 42150 });
});

test("to the lines' currency: their own amounts", () => {
  expect(currencyChange(open, usd, 'USD')).toEqual({ currency: 'USD', total: 150 });
});

test('not to another foreign currency: USD 100 is not EUR 100', () => {
  expect(currencyChange(open, usd, 'EUR').refusal).toBe('Its charges are in USD, so it can be in USD or PKR.');
  const mixed = [...usd, { type: 'Recievable', currency: 'EUR', net_amount: '10', local_amount: '3300' }];
  expect(currencyChange(open, mixed, 'USD').refusal).toBe('Its charges are in USD and EUR, so it can only be in PKR.');
  expect(currencyChange(open, mixed, 'PKR')).toEqual({ currency: 'PKR', total: 45450 });
});

test('an agent invoice with both sides: receivables less payables, as approval nets them', () => {
  const both = [...usd, { type: 'Payble', currency: 'USD', net_amount: '30', local_amount: '8400' }];
  expect(currencyChange(open, both, 'USD').total).toBe(120);
  expect(currencyChange(open, both, 'PKR').total).toBe(33750);
});

test('refused once approved, and for a currency nobody invoices in', () => {
  expect(currencyChange({ approved: '1' }, usd, 'PKR').refusal).toMatch(/approved/);
  expect(currencyChange(open, usd, 'XYZ').refusal).toMatch(/not a currency/);
});

test('lines with no currency are rupees', () => {
  expect(currencyChange(open, [{ type: 'Recievable', net_amount: '500', local_amount: '500' }], 'PKR'))
    .toEqual({ currency: 'PKR', total: 500 });
});

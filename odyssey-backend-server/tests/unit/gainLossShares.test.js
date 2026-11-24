/**
 * Each invoice's share of its receipt's or payment's exchange gain/loss -
 * functions/gainLossShares (the user, 2026-11-20: Job P&L amounts wrong).
 * The voucher's whole gain/loss is stored on every line it knocks off.
 */
const { gainLossShares, weightOf } = require('../../functions/gainLossShares');

const line = (id, over) => ({ id, voucherId: 1, currency: 'USD', payType: 'Recievable', voucherRate: 276.95, ...over });

test('a receipt over nine invoices: shares add up to the stored total once, not nine times', () => {
  // SNS-BRV-356/27-like: rates from 277 to 279, -64,303.36 stored on each line.
  const lines = [
    line(1, { amount: 10000, invoiceRate: 278.0015, stored: -64303.36 }),
    line(2, { amount: 20000, invoiceRate: 279, stored: -64303.36 }),
    line(3, { amount: 5000, invoiceRate: 277.5, stored: -64303.36 }),
  ];
  const s = gainLossShares(lines);
  const shares = [1, 2, 3].map((id) => s.get(id).share);
  expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(-64303.36, 4);
  // In proportion to each line's own rate difference.
  const w = lines.map(weightOf);
  expect(shares[1] / shares[0]).toBeCloseTo(w[1] / w[0], 6);
});

test('a payment: the sign is the other way - paying at a lower rate than billed is a gain', () => {
  expect(weightOf({ currency: 'USD', payType: 'Payble', voucherRate: 276.95, invoiceRate: 280, amount: 637.44 })).toBeGreaterThan(0);
  expect(weightOf({ currency: 'USD', payType: 'Recievable', voucherRate: 276.95, invoiceRate: 280, amount: 100 })).toBeLessThan(0);
});

test('a PKR invoice has no exchange difference; with nothing to weigh, the split is by amount', () => {
  const s = gainLossShares([
    line(1, { currency: 'PKR', amount: 300, invoiceRate: 280, stored: 90 }),
    line(2, { currency: 'PKR', amount: 600, invoiceRate: 280, stored: 90 }),
  ]);
  expect(s.get(1).share).toBeCloseTo(30);
  expect(s.get(2).share).toBeCloseTo(60);
});

test('lines with figures of their own, and a single line, are left as they are', () => {
  const s = gainLossShares([
    line(1, { amount: 10, invoiceRate: 280, stored: 5 }),
    line(2, { amount: 10, invoiceRate: 280, stored: 7 }),
    line(3, { voucherId: 2, amount: 10, invoiceRate: 280, stored: -12 }),
  ]);
  expect([s.get(1).share, s.get(2).share, s.get(3).share]).toEqual([5, 7, -12]);
});

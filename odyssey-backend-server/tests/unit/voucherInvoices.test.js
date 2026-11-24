const { invoiceIdsOf } = require('../../functions/voucherInvoices');

describe('the invoices a payment or receipt settled', () => {
  test('every id in the list, as makeTransaction writes it', () => {
    expect([...invoiceIdsOf('80761,80762,')]).toEqual(['80761', '80762']);
  });
  test('whole ids only - 8076 is not in "80761,"', () => {
    expect(invoiceIdsOf('80761,').has('8076')).toBe(false);
    expect(invoiceIdsOf('80761,').has('80761')).toBe(true);
  });
  test('spaces and an empty or missing list', () => {
    expect([...invoiceIdsOf(' 5, 6 ,')]).toEqual(['5', '6']);
    expect(invoiceIdsOf('').size).toBe(0);
    expect(invoiceIdsOf(null).size).toBe(0);
  });
});

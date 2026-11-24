import reducer, { clearVoucher, setPRField } from '../redux/paymentReciept/paymentRecieptSlice';

/* Opening a saved receipt clears the last one first. A receipt with no
 * invoices (an advance), or no bank charges, used to show the PREVIOUS
 * receipt's - so a second party's receipt showed the first party's lines. */
describe('opening a saved payment or receipt', () => {
  const set = (state, field, value) => reducer(state, setPRField({ field, value }));

  let previous;
  beforeEach(() => {
    previous = reducer(undefined, { type: '@@init' });
    previous = set(previous, 'PRaccounts', [{ id: 1, name: 'PARTY A' }, { id: 2, name: 'PARTY B' }]);
    previous = set(previous, 'oldVouchers', [{ id: 10 }, { id: 11 }]);
    previous = set(previous, 'search', 'BRV');
    previous = set(previous, 'invoicePageSize', 100);
    // What PARTY A's receipt put on screen.
    previous = set(previous, 'voucherId', 10);
    previous = set(previous, 'selectedAccount', 1);
    previous = set(previous, 'invoices', [{ id: 8076, invoice_No: 'JI-8076/27' }]);
    previous = set(previous, 'selectedInvoices', { 8076: { id: 8076, receiving: 500 } });
    previous = set(previous, 'bankChargesAmount', 150);
    previous = set(previous, 'gainLossAmount', 42);
    previous = set(previous, 'voucherNarration', 'Received from PARTY A');
  });

  test('the last receipt\'s invoices, charges and amounts are gone', () => {
    const next = reducer(previous, clearVoucher());
    expect(next.invoices).toEqual([]);
    expect(next.selectedInvoices).toEqual({});
    expect(next.bankChargesAmount).toBe(0);
    expect(next.gainLossAmount).toBe(0);
    expect(next.voucherNarration).toBe('');
    expect(next.voucherId).toBeUndefined();
    expect(next.selectedAccount).toBeUndefined();
  });

  test('what the screen fetched, and how it is set up, stays', () => {
    const next = reducer(previous, clearVoucher());
    expect(next.PRaccounts).toHaveLength(2);
    expect(next.oldVouchers).toHaveLength(2);
    expect(next.search).toBe('BRV');
    expect(next.invoicePageSize).toBe(100);
  });
});

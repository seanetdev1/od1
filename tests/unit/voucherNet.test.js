const { netAmount, isPaymentOrReceipt } = require('../../functions/voucherNet');

/* The Voucher List's Net Amount (the user's request, 2026-10-26): what the
 * bank or cash paid out or took in. */
describe('the voucher list net amount', () => {
  const line = (type, amount, accountType = 'partyAccount', rate = 1) => ({ type, amount: String(amount), defaultAmount: String(amount * rate), accountType });

  it("a payment: its bank / cash credit - salary 100,000 less a 20,000 loan instalment is 80,000", () => {
    expect(netAmount('BPV', [line('debit', 100000), line('credit', 20000), line('credit', 80000, 'payAccount')]))
      .toEqual({ amount: 80000, amountPkr: 80000 });
  });

  it('a receipt: its bank / cash debit - 100,000 received less 500 bank charges is 99,500', () => {
    expect(netAmount('BRV', [line('credit', 100000), line('debit', 500), line('debit', 99500, 'payAccount')]))
      .toEqual({ amount: 99500, amountPkr: 99500 });
    expect(netAmount('crv', [line('credit', 10), line('debit', 10, 'payAccount')])).toEqual({ amount: 10, amountPkr: 10 });
  });

  it("Climax's cash drawn from the bank, both lines bank / cash: the amount moved, not 0", () => {
    expect(netAmount('BPV', [line('debit', 75000, 'payAccount'), line('credit', 75000, 'payAccount')]))
      .toEqual({ amount: 75000, amountPkr: 75000 });
  });

  it('a payment that also pays into another bank account: everything that left the bank', () => {
    expect(netAmount('BPV', [line('credit', 90000, 'payAccount'), line('debit', 50000), line('debit', 15000), line('debit', 25000, 'payAccount')]))
      .toEqual({ amount: 90000, amountPkr: 90000 });
  });

  it('a foreign-currency one in its own currency and in rupees', () => {
    expect(netAmount('BPV', [line('debit', 150.25, 'partyAccount', 280), line('credit', 150.25, 'payAccount', 280)]))
      .toEqual({ amount: 150.25, amountPkr: 42070 });
  });

  it('nothing for a voucher with no bank or cash side, or no bank / cash line', () => {
    for (const vType of ['JV', 'TV', 'SI', 'PI', 'OP', 'ADJ-P', 'ADJ-R', 'SV', null]) {
      expect(netAmount(vType, [line('debit', 5, 'payAccount'), line('credit', 5, 'payAccount')])).toBeNull();
    }
    expect(netAmount('BPV', [line('debit', 5), line('credit', 5)])).toBeNull();
    expect(isPaymentOrReceipt(' cpv ')).toBe(true);
    expect(isPaymentOrReceipt('TV')).toBe(false);
  });
});

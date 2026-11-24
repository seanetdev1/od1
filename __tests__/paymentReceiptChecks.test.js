/**
 * What stops a payment / receipt from posting - functions/paymentReceiptChecks.
 *
 * These seven checks were lifted verbatim out of BillComp's makeTransaction,
 * where they were seven early returns. The point of the tests is not that the
 * rules are good - it is that they are UNCHANGED. Each one decides whether a
 * transaction reaches the ledger, and the loose comparisons they were written
 * with are part of the rule: `state.totalReceivable == 0` accepts an empty
 * string where `=== 0` would not.
 *
 * So each case below is written against the original condition, not against
 * what the condition arguably ought to be.
 */
import {
  paymentProblems, canPost, postBlockedReason,
} from 'functions/paymentReceiptChecks';

// A form with nothing wrong with it.
const ok = (x = {}) => ({
  currency: 'PKR',
  exRate: 1,
  totalReceivable: 1000,
  receivingAccount: 12,
  transactionMode: 'Cash',
  checkNo: '',
  gainLossAmount: 0,
  gainLossAccount: undefined,
  bankChargesAmount: 0,
  bankChargesAccount: undefined,
  taxAmount: 0,
  taxAccount: undefined,
  ...x,
});

describe('a form with nothing wrong with it', () => {
  test('has no problems and can post', () => {
    expect(paymentProblems(ok())).toEqual([]);
    expect(canPost(ok())).toBe(true);
    expect(postBlockedReason(ok())).toBe('');
  });
});

describe('the exchange rate', () => {
  test('is only checked on a foreign currency', () => {
    // PKR at rate 1 must not trip the "rate <= 50" test, or every local
    // receipt in the book would be refused.
    expect(paymentProblems(ok({ currency: 'PKR', exRate: 1 }))).toEqual([]);
  });

  test('is refused below 50 on a foreign one', () => {
    expect(paymentProblems(ok({ currency: 'USD', exRate: 50 })))
      .toContain('Select Proper ExChange Rate');
    expect(paymentProblems(ok({ currency: 'USD', exRate: 280 }))).toEqual([]);
  });
});

describe('the amount', () => {
  test('nothing selected is refused', () => {
    expect(paymentProblems(ok({ totalReceivable: 0 }))).toContain('No transaction selected');
  });

  test('an empty box counts as nothing, exactly as it did before', () => {
    // `== 0` is true for '', and this was written with `==`. Tightening it
    // would change which transactions the app accepts.
    expect(paymentProblems(ok({ totalReceivable: '' }))).toContain('No transaction selected');
  });

  test('a negative amount is allowed - it is a refund, not an error', () => {
    expect(paymentProblems(ok({ totalReceivable: -500 }))).toEqual([]);
  });
});

describe('the cheque number', () => {
  test('is required when the mode is not Cash', () => {
    expect(paymentProblems(ok({ transactionMode: 'Cheque', checkNo: '' })))
      .toContain('Enter Cheque No.');
    expect(paymentProblems(ok({ transactionMode: 'Cheque', checkNo: '100241' }))).toEqual([]);
  });

  test('is not asked for on a cash transaction', () => {
    expect(paymentProblems(ok({ transactionMode: 'Cash', checkNo: '' }))).toEqual([]);
  });

  test('is not asked for on an adjustment - no money moves through a bank', () => {
    expect(paymentProblems(ok({ transactionMode: 'Adjust', checkNo: '' }))).toEqual([]);
    expect(paymentProblems(ok({ transactionMode: 'Bank', checkNo: '' }))).toContain('Enter Cheque No.');
  });
});

describe('an amount that needs an account to post to', () => {
  test('gain/loss, bank charges and tax each demand their own', () => {
    expect(paymentProblems(ok({ gainLossAmount: 40 })))
      .toContain('Select Gain Loss Account');
    expect(paymentProblems(ok({ bankChargesAmount: 250 })))
      .toContain('Select Bank Charges Account');
    expect(paymentProblems(ok({ taxAmount: 75 })))
      .toContain('Select Tax Account');
  });

  test('and are satisfied once one is chosen', () => {
    expect(paymentProblems(ok({ gainLossAmount: 40, gainLossAccount: 9 }))).toEqual([]);
    expect(paymentProblems(ok({ bankChargesAmount: 250, bankChargesAccount: 9 }))).toEqual([]);
    expect(paymentProblems(ok({ taxAmount: 75, taxAccount: 9 }))).toEqual([]);
  });

  test('a zero amount needs no account', () => {
    // Which is the ordinary case: most receipts carry none of the three.
    expect(paymentProblems(ok({ gainLossAmount: 0, bankChargesAmount: 0, taxAmount: 0 })))
      .toEqual([]);
  });

  // 2026-10-22: what the PARTY pays still goes to the selected account,
  // against the party - see functions/paymentReceiptCosts.
  test('tax or bank charges the party pays still need their account', () => {
    expect(paymentProblems(ok({ taxAmount: 75, taxBy: 'party' }))).toContain('Select Tax Account');
    expect(paymentProblems(ok({ bankChargesAmount: 250, bankChargesBy: 'party' }))).toContain('Select Bank Charges Account');
    expect(paymentProblems(ok({ taxAmount: 75, taxBy: 'party', taxAccount: 9 }))).toEqual([]);
  });
});

describe('the bank charges check is not written like the other two', () => {
  test('an UNSET bank charge demands an account, where an unset gain/loss does not', () => {
    // Pinned because it is surprising, not because it is right: gain/loss and
    // tax both guard with `!= 0 && != undefined`, bank charges only with
    // `!= 0`, and `undefined != 0` is true. It never bites in the app because
    // redux initialises all three to 0.0 (paymentRecieptSlice), so a state
    // where it is undefined does not arise - but a caller assembling one by
    // hand would meet it.
    const bare = { currency: 'PKR', totalReceivable: 1, receivingAccount: 1, transactionMode: 'Cash' };
    expect(paymentProblems(bare)).toContain('Select Bank Charges Account');
    expect(paymentProblems(bare)).not.toContain('Select Gain Loss Account');
    expect(paymentProblems(bare)).not.toContain('Select Tax Account');
  });
});

describe('everything at once', () => {
  test('is the whole reason this was collected', () => {
    // The old screen returned at the first failure, so a form with three
    // things missing took three presses to find that out.
    const problems = paymentProblems(ok({
      currency: 'USD', exRate: 1,
      totalReceivable: 0,
      receivingAccount: undefined,
      transactionMode: 'Cheque', checkNo: '',
    }));
    expect(problems).toEqual([
      'Select Proper ExChange Rate',
      'No transaction selected',
      'Select Receiving Account',
      'Enter Cheque No.',
    ]);
  });

  test('and the reason reads as one line for the button that is disabled', () => {
    const state = ok({ totalReceivable: 0, receivingAccount: undefined });
    expect(postBlockedReason(state))
      .toBe('2 things to fix: No transaction selected · Select Receiving Account');
  });

  test('a single problem is said plainly, without a count', () => {
    expect(postBlockedReason(ok({ totalReceivable: 0 }))).toBe('No transaction selected');
  });
});

/* An open voucher ticked at less than it brought in may not be saved as an
 * EDIT: that rebuilt it at the ticked total, and the rest of the money left
 * the books. Settling it (Refresh) keeps it whole - functions/advanceSettlement
 * (the user, 2026-11-06). */
describe('a partly used voucher is settled, not cut down', () => {
  const open = (x = {}) => ok({ edit: true, editing: false, voucherAmount: 1775000, totalReceivable: 96386, ...x });

  test('saved as an edit it would shrink: refused, and says to press Refresh', () => {
    expect(paymentProblems(open())).toEqual([
      'Press Refresh to settle invoices against this voucher - saved as an edit it would be cut to 96386.00 of its 1775000.00',
    ]);
  });

  test('ticked at its whole amount, an edit is fine as before', () => {
    expect(paymentProblems(open({ totalReceivable: 1775000 }))).toEqual([]);
  });

  test('a new receipt, an advance, or one being settled is not this check', () => {
    expect(paymentProblems(open({ edit: false }))).toEqual([]);
    expect(paymentProblems(open({ advance: true }))).toEqual([]);
    expect(paymentProblems(open({ editing: true }))).toEqual([]);
  });

  test('a payment, whose ticks total below zero, is compared by size', () => {
    expect(paymentProblems(open({ voucherAmount: 5000, totalReceivable: -5000 }))).toEqual([]);
    expect(paymentProblems(open({ voucherAmount: 5000, totalReceivable: -3000 }))).toHaveLength(1);
  });
});

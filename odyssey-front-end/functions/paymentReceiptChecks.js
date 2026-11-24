/**
 * What stops a payment / receipt from being posted.
 *
 * These seven checks used to sit at the top of BillComp's makeTransaction as
 * seven early returns, each raising a toast and stopping. So the screen told
 * you one thing at a time: wrong exchange rate, fix it, press again, no
 * receiving account, fix it, press again — up to six rounds to learn what the
 * form needed. Collected here, they can all be said at once, and the button
 * that posts can be disabled until there is nothing left to say.
 *
 * THE CONDITIONS ARE COPIED EXACTLY, loose comparisons and all. This decides
 * whether money gets posted, and `state.totalReceivable == 0` is not the same
 * test as `=== 0` — an empty string passes the first and fails the second.
 * Tightening them would change which transactions the app accepts, which is a
 * decision about the books rather than a tidy-up, so nothing here is
 * "improved". The MESSAGES are unchanged too: the office knows them.
 *
 * Order matters only in that it is the order they are read in, which is the
 * order the form is filled in.
 */

export const paymentProblems = (state = {}) => {
  const problems = [];

  if (state.currency != 'PKR' && state.exRate <= 50) {
    problems.push('Select Proper ExChange Rate');
  }
  if (state.totalReceivable == 0) {
    problems.push('No transaction selected');
  }
  if (state.receivingAccount == undefined) {
    problems.push('Select Receiving Account');
  }
  // A cheque number for a bank transaction. NOT for Cash, and not for an
  // Adjust - an adjustment moves no money through a bank, so there is no
  // cheque to quote; the box stays open for a reference if one is wanted.
  if (state.transactionMode != 'Cash' && state.transactionMode != 'Adjust' && state.checkNo == '') {
    problems.push('Enter Cheque No.');
  }
  if ((state.gainLossAmount != 0 && state.gainLossAmount != undefined)
      && state.gainLossAccount == undefined) {
    problems.push('Select Gain Loss Account');
  }
  // Whoever pays them: the party's go to the selected account too, against
  // the party (functions/paymentReceiptCosts).
  if (state.bankChargesAmount != 0 && state.bankChargesAccount == undefined) {
    problems.push('Select Bank Charges Account');
  }
  if ((state.taxAmount != 0 && state.taxAmount != undefined)
      && state.taxAccount == undefined) {
    problems.push('Select Tax Account');
  }
  /* An open voucher whose ticks come to LESS than it brought in. Saved as an
   * edit, the voucher - bank line and all - is rebuilt at the ticked total,
   * and the rest of the money really received leaves the books: a partly
   * used advance (ACS-BRV-00856/24: 1,775,000, 96,386 knocked off) would have
   * become 96,386. Its invoices are settled with Refresh instead, which keeps
   * the voucher as it is (functions/advanceSettlement; the user, 2026-11-06). */
  const ticked = Math.abs(Number(state.totalReceivable) || 0);
  const amount = Math.abs(Number(state.voucherAmount) || 0);
  if (state.edit && !state.editing && !state.advance && amount - ticked > 0.005) {
    problems.push(`Press Refresh to settle invoices against this voucher - saved as an edit it would be cut to ${ticked.toFixed(2)} of its ${amount.toFixed(2)}`);
  }

  return problems;
};

/** Can this be posted? The same question, asked the other way round. */
export const canPost = (state) => paymentProblems(state).length === 0;

/**
 * The problems as one line, for a tooltip on the disabled button.
 *
 * A disabled button that does not say why is worse than one that complains
 * when pressed - which is what this screen did before - so this text is
 * load-bearing, not decoration.
 */
export const postBlockedReason = (state) => {
  const problems = paymentProblems(state);
  if (!problems.length) return '';
  return problems.length === 1
    ? problems[0]
    : `${problems.length} things to fix: ${problems.join(' · ')}`;
};

/**
 * The rate an invoice's figures convert to rupees at - in Payments & Receipts:
 * the balances it lists, what it posts, and its print.
 *
 * A PKR INVOICE CONVERTS AT 1, whatever its ex_rate says. A Job Bill or Job
 * Invoice is held in rupees, but approving it stores the rate of the charges
 * on it - a USD 115 freight line at 282.40 gave SNS-JB-551/27 (PKR 32,476)
 * an ex_rate of 282.4. Taken at its word, that rate printed the bill as
 * 32,476 x 282.40 = 9,171,222.40 on the payment voucher, and showed its
 * outstanding balance as 32,476 / 282.40 = 115. The rupee posting was right
 * all along: Gl.js settles a PKR payment without the rate.
 *
 * A foreign invoice converts at its own rate; a missing or zero rate is 1,
 * never a division by zero.
 */
export const LOCAL_CURRENCY = 'PKR';

export const invoiceRate = (invoice) => {
  if (String(invoice?.currency ?? '').trim().toUpperCase() === LOCAL_CURRENCY) return 1;
  const rate = parseFloat(invoice?.ex_rate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
};

export default invoiceRate;

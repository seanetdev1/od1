/**
 * WHAT IS STILL OWED ON AN INVOICE, ROUND OFF INCLUDED - one rule for every
 * screen that lists open invoices or leaves settled ones out (Payments &
 * Receipts, Job Balancing, Agent Invoice Balancing). Mirrors the server's
 * functions/invoiceOwed, which the Payments & Receipts list is filtered by.
 *
 *   owed = total + roundOff - (paid on a bill, recieved on an invoice)
 *
 * The rounded total, because that is what the ledger has the party owing and
 * what the knock-off settles (functions/paymentReceiptSelection). Settled is
 * under half a paisa - what shows as 0.00 - never "exactly 0": a knock-off's
 * last share carries floating point (1234.5599999999999) into `recieved`, and
 * "exactly 0" kept those invoices listed at 0.00 forever.
 */
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Half a paisa - anything smaller shows as 0.00. */
export const SETTLED_BELOW = 0.005;

export const owedOn = (invoice) => num(invoice?.total) + num(invoice?.roundOff)
  - num(invoice?.payType === 'Payble' ? invoice?.paid : invoice?.recieved);

export const isOwed = (invoice) => Math.abs(owedOn(invoice)) >= SETTLED_BELOW;

/** A balance worked out already - is it more than 0.00? */
export const hasBalance = (balance) => Math.abs(num(balance)) >= SETTLED_BELOW;

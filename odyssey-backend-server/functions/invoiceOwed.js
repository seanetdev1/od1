/**
 * WHAT IS STILL OWED ON AN INVOICE, ROUND OFF INCLUDED - the rule Payments &
 * Receipts lists by, and the balancing reports filter by. Mirrored by the
 * frontend's functions/invoiceOwed.
 *
 *   owed = total + roundOff - (paid on a bill, recieved on an invoice)
 *
 * The ROUNDED total, because that is what the ledger has the party owing and
 * what the knock-off settles (functions/paymentReceiptSelection on the
 * screen). An invoice is settled when what is owed comes to under half a
 * paisa - when it would show as 0.00.
 *
 * NOT functions/invoiceOutstanding, the dashboard's rule, which reads the bare
 * total and lists only what is owed TO the business, above a paisa. That
 * answers a different question and is left as it is.
 *
 * The lists here used "total - recieved is not exactly 0". Two things defeated
 * it, and kept invoices paid in full on the list:
 *   - the knock-off's last share is whatever floating point leaves over
 *     (1234.5599999999999), and it went into `recieved` as it came - so the
 *     invoice stayed open by a hair and listed at 0.00;
 *   - the knock-off pays the round off too, so a rounded invoice paid in full
 *     has recieved = total + roundOff, and listed at -0.44.
 *
 * total / paid / recieved / roundOff are text columns; a blank one is 0.
 */
const PAYABLE = 'Payble';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Half a paisa - anything smaller shows as 0.00. */
const SETTLED_BELOW = 0.005;

const owedOn = (invoice) => num(invoice?.total) + num(invoice?.roundOff)
  - num(invoice?.payType === PAYABLE ? invoice?.paid : invoice?.recieved);

const isOwed = (invoice) => Math.abs(owedOn(invoice)) >= SETTLED_BELOW;

/** The same rule as a WHERE condition on "Invoice". */
const col = (name) => `COALESCE(NULLIF(TRIM("Invoice"."${name}"), ''), '0')::numeric`;
const OWED_SQL = `ABS(${col('total')} + ${col('roundOff')} - CASE WHEN "Invoice"."payType" = '${PAYABLE}' `
  + `THEN ${col('paid')} ELSE ${col('recieved')} END) >= ${SETTLED_BELOW}`;

/** A money figure to the paisa, as it should be stored. */
// "|| 0" so a hair below zero is 0, not -0.
const toCents = (v) => (Math.round(num(v) * 100) / 100) || 0;

module.exports = { owedOn, isOwed, OWED_SQL, SETTLED_BELOW, toCents };

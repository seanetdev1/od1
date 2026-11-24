import { lineAmount } from 'functions/invoicePrintCurrency';
// Shared by InvoiceCharges.js (interactive viewer) and pages/invoice-print/[id].js
// (bare page rendered headlessly for the emailed PDF) so bank account details
// and the total calculation can't drift between the two.

// REMOVED: `bankDetails` held our own Soneri / Bank Al Habib account numbers
// for AIR CARGO SERVICES and SEA NET SHIPPING, hardcoded here and printed on
// every invoice and emailed PDF. In a leased product that meant a client's
// customers were told to pay into our accounts.
//
// Bank details now come from the BankAccounts table (Config > Bank Accounts),
// via functions/companyBranding.js for the interactive screen and via the
// /invoice/getPrintData payload for the headless PDF, which has no redux store.

// A CUSTOMS line is always its local_amount. Its `amount` is not money - it is
// the multiplier in the pricing formula, fixed at 1 (functions/customsCharge
// on the server) - and its partyType is the role from Setup > Charges
// ("Client", "Shipping Line"...), not the lowercase client/vendor the test
// below expects. Reading `amount` totalled CL-JI-1/27's 111,425 as 3.00.
//
// `foreign` - whether the invoice prints in a foreign currency (functions/
// invoicePrintCurrency printsForeign). Given, every line is its amount in that
// currency - the invoice's own, as the print and its Currency box now are.
// Left out, the old rule below: by each line's party.
export const calculateTotal = (data, foreign) => {
  if (typeof foreign === 'boolean') {
    const net = (data || []).reduce((t, x) => (x.type == 'Recievable' ? t + lineAmount(x, foreign) : t - lineAmount(x, foreign)), 0);
    return Math.abs(net).toFixed(2);
  }
  let result = 0;
  data?.forEach((x) => {
    // An agent line totals in its own currency, from net_amount. `amount` is
    // the pricing multiplier (1 on every line entered in Odyssey, and on
    // migrated lines from 1.2.27), so summing it printed the NUMBER OF LINES
    // as the total. Kept as the fallback for a line that carries no net.
    const agentNet = x.net_amount !== undefined && x.net_amount !== null && x.net_amount !== ''
      ? x.net_amount : x.amount;
    let amount = x.CustomsJobId || x.partyType=="client"||x.partyType=="vendor" ? parseFloat(x.local_amount) : parseFloat(agentNet);
    result = x.type == 'Recievable' ? result + parseFloat(amount) : result - parseFloat(amount);
  });
  return Math.abs(result).toFixed(2);
};

/* ROUND OFF - the same rule as the server's functions/invoiceRoundOff, which
 * works it out again from the approved total (and rounds every invoice in
 * rupees when Configuration > Invoices > Round off automatically is on).
 *
 * The +/- that brings a total to a whole rupee: half a rupee or less rounds
 * down. "0" when it is whole already. */
export const roundOffFor = (total) => {
  const cents = Math.round(Math.abs(Number(total) || 0) * 100) % 100;
  if (!cents) return '0';
  return cents <= 50 ? `-${(cents / 100).toFixed(2)}` : `+${((100 - cents) / 100).toFixed(2)}`;
};

/** Is a stored round off one at all? "0", "0.00", "-0.00", blank: no. */
export const hasRoundOff = (value) => Math.abs(parseFloat(value) || 0) >= 0.005;

const AGENT_TYPES = ['Agent Invoice', 'Agent Bill', 'Old Agent Invoice', 'Old Agent Bill'];

/** Only an invoice in rupees - an agent's is in its agent's currency. */
export const isRoundable = (invoice) => !AGENT_TYPES.includes(invoice?.type)
  && (!invoice?.currency || String(invoice.currency).toUpperCase() === 'PKR');

/* THE INVOICE PAGE'S TOTAL AMOUNT (LOCAL) - with its round off, as the print
 * and the Excel sheet have it (InvoicePrint, functions/invoiceExcel) and as the
 * ledger posts it. It showed the bare total: SNS-JI-574/27 read 117,959.60
 * beside a +0.40 round off (2026-10-22). The round off is in rupees. */
export const localTotal = (invoice) => {
  const total = parseFloat(invoice?.total) || 0;
  const rate = String(invoice?.currency || 'PKR').toUpperCase() === 'PKR' ? 1 : (parseFloat(invoice?.ex_rate) || 0);
  const round = hasRoundOff(invoice?.roundOff) ? parseFloat(invoice.roundOff) : 0;
  return Math.round((total * rate + round) * 100) / 100;
};

/* The Round Off line under the invoice page's charges - one cell for each of
 * its 18 columns (#, Charge, Particular, Basis, PP/CC, Size, DG, Qty,
 * Currency, Type, Rate, Amount, Disc, Tax, Tax, Net, Ex., Total). It had 16,
 * so everything from Type on sat one column or two to the left and Total was
 * empty. Null when there is no round off - "0.00" included. */
export const roundOffLine = (invoice, lineNo) => {
  if (!hasRoundOff(invoice?.roundOff)) return null;
  const value = parseFloat(invoice.roundOff);
  const signed = `${value > 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}`;
  const size = Math.abs(value).toFixed(2);
  return [
    lineNo, 'ROFC', 'Round Off', '-', '-', '-', '-', 1, 'PKR',
    invoice?.payType === 'Recievable' ? 'DN' : 'CN',
    size, size, '0', 'No', '0.00', signed, '1.00', signed,
  ];
};

// The Round Off box. Ticked: off, always - it could not be unticked once the
// total it was ticked for had become whole. Unticked: the round off for the
// charges' total ("0" when there is nothing to round).
export const computeRoundOff = (records, currentRoundOff) => (
  hasRoundOff(currentRoundOff) ? '0' : roundOffFor(calculateTotal(records))
);

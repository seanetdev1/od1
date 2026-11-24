/**
 * THE CURRENCY AN INVOICE PRINTS IN - the print, the emailed PDF and the Excel
 * alike (Components/Shared/InvoicePrint, functions/invoiceExcel).
 *
 * The invoice's OWN currency - what the invoice page's Currency box sets. The
 * print used to decide by the invoice's TYPE: a job invoice or bill said PKR,
 * an agent one USD, and each line's amount followed its party (client and
 * vendor lines in rupees, agent lines in their own currency) - so an agent
 * invoice changed to PKR still printed USD (the user's report, 2026-10-12),
 * and a job invoice changed to USD still printed rupees.
 *
 * The type is the fallback only, for an invoice with no currency recorded.
 *
 * In rupees, a line prints its PKR amount (local_amount); in a foreign
 * currency, its own amount (net_amount) - the same figures the server builds
 * the invoice's total from on approval. A customs line is always its PKR
 * amount: customs invoices are raised in rupees.
 */
const AGENT_TYPES = ['Agent Invoice', 'Agent Bill', 'Old Agent Invoice', 'Old Agent Bill'];

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const present = (v) => v !== undefined && v !== null && v !== '';

export function printCurrency(invoice) {
  const own = String(invoice?.currency ?? '').trim().toUpperCase();
  if (own) return own;
  return AGENT_TYPES.includes(invoice?.type) ? 'USD' : 'PKR';
}

/** Whether the invoice prints in a foreign currency. */
export const printsForeign = (invoice) => printCurrency(invoice) !== 'PKR';

/** One line's amount, in the currency the invoice prints in. */
export function lineAmount(line, foreign) {
  if (line?.CustomsJobId || !foreign) return num(line?.local_amount);
  if (present(line?.net_amount)) return num(line.net_amount);
  // A line with no net of its own: its PKR amount back at its own rate.
  return num(line?.local_amount) / (num(line?.ex_rate) || 1);
}

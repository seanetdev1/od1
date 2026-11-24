/**
 * What the Sale Tax Invoice prints - the "VAT Tax Invoice" option on an
 * invoice's Printing Options.
 *
 * ONLY THE TAXED LINES. A clearing invoice is mostly pass-through money -
 * duty, wharfage, port charges - with one or two fees of the agent's own on
 * top, and it is the fee that carries sales tax. The legacy JI-2378/27 came to
 * 94,140 across eleven lines; its Sale Tax Invoice showed one of them:
 * SERVICES CHARGES 2,500, Sale Tax @ 15% 375, total 2,875. A line is on it when
 * its Tax box is ticked and the tax came to something - the same test the
 * server uses to give the invoice its GST number (functions/salesTaxInvoice).
 *
 * In LOCAL currency, which is what the tax authority is paid in.
 */
import { computeTaxableAmount, taxPercOf, isTaxed, num } from 'functions/customsPricing';

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * One line's taxable value, tax and rate.
 *
 * A customs line is priced qty x (rate - discount) with the tax on top - see
 * functions/customsPricing - and that holds for a migrated line too, whose
 * net_amount was imported WITHOUT its tax. Any other line (freight, aviation)
 * stores its net including tax, so the taxable value is what is left when the
 * tax comes off.
 */
export const lineFigures = (c) => {
  const exRate = num(c?.ex_rate) || 1;
  if (c?.CustomsJobId) {
    const taxable = computeTaxableAmount(c);
    const perc = taxPercOf(c);
    return { taxable: taxable * exRate, tax: (taxable * perc) / 100 * exRate, perc };
  }
  const tax = num(c?.tax_amount);
  const taxable = num(c?.net_amount) - tax;
  const perc = num(c?.taxPerc) || (taxable ? round2((tax / taxable) * 100) : 0);
  return { taxable: taxable * exRate, tax: tax * exRate, perc };
};

/** A line the Sale Tax Invoice carries. */
export const isSaleTaxLine = (c) =>
  c?.type === 'Recievable' && isTaxed(c) && lineFigures(c).tax > 0;

/**
 * The figures for the whole Sale Tax Invoice.
 *
 * `rate` is the one percentage every taxed line shares - the "Sale Tax @ 15 %"
 * line. Lines at different rates leave it null, and the print says so rather
 * than naming one of them.
 */
export const saleTaxFigures = (records) => {
  const lines = (records || []).filter(isSaleTaxLine).map((c) => ({ ...lineFigures(c), charge: c }));
  const serviceCharges = round2(lines.reduce((t, l) => t + l.taxable, 0));
  const saleTax = round2(lines.reduce((t, l) => t + l.tax, 0));
  const rates = [...new Set(lines.map((l) => round2(l.perc)))];
  return {
    lines,
    serviceCharges,
    saleTax,
    // Kept as a line of its own because the form has one; nothing in Odyssey
    // levies an additional sales tax yet.
    additionalTax: 0,
    total: round2(serviceCharges + saleTax),
    rate: rates.length === 1 ? rates[0] : null,
  };
};

/**
 * The GST Inv # an invoice's page shows, or null when it shows none.
 *
 *   its number      once it has one - given on approval to an invoice with
 *                   sales tax on it (the server's functions/salesTaxInvoice),
 *                   kept through an unapprove;
 *   'On approval'   an invoice with taxed lines, not yet approved - it will get
 *                   one, and where to look for it is the useful thing to say;
 *   '-'             approved with tax and no number: a migrated invoice the
 *                   legacy system never numbered;
 *   null            nothing taxed, or a bill - neither ever gets one.
 */
export const gstNoField = (invoice, records) => {
  const no = invoice?.Sales_Tax_Invoice?.taxInvoiceNo;
  if (no) return { text: no, pending: false };
  if (invoice?.payType !== 'Recievable' || !(records || []).some(isSaleTaxLine)) return null;
  return String(invoice?.approved) === '1'
    ? { text: '-', pending: false }
    : { text: 'On approval', pending: true };
};

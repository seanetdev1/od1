/**
 * Currency in the ageing report - Summary and Weekly alike.
 *
 * The report always split each account by currency, but offered no choice and
 * no totals, so a reader had to add up the USD rows by eye and could not ask
 * for one currency at all. Now:
 *
 *   All currencies   each account per currency, as before, with a total line
 *                    for every currency - never USD added to PKR
 *   one currency     that currency's invoices only (filtered by the server)
 *   All, in PKR      every balance converted to rupees at its invoice's own
 *                    rate, so an account is one row and the report one total
 *
 * Converting uses invoiceRate: a PKR invoice at 1 whatever its ex_rate says,
 * a foreign one at its own rate - see functions/invoiceRate.
 */
import { invoiceRate, LOCAL_CURRENCY } from './invoiceRate';

export const ALL_CURRENCIES = 'All';
export const ALL_IN_LOCAL = 'All-PKR';

/** The currencies an invoice is raised in on this system. */
export const AGEING_CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'CHF', 'OMR', 'BDT'];

export const currencyOptions = [
  { value: ALL_CURRENCIES, label: 'All currencies' },
  { value: ALL_IN_LOCAL, label: `All, in ${LOCAL_CURRENCY}` },
  ...AGEING_CURRENCIES.map((c) => ({ value: c, label: c })),
];

/** How the choice reads in the report's heading. */
export const currencyLabel = (choice) =>
  (currencyOptions.find((o) => o.value === choice) || currencyOptions[0]).label;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What one invoice adds to the ageing: the currency it is shown under and its
 * outstanding balance in it - receivable positive, payable negative.
 */
export function ageingFigures(invoice, choice) {
  // With its round off - the rounded total is what the ledger has owing.
  const outstanding = num(invoice?.total) + num(invoice?.roundOff) - num(invoice?.paid) - num(invoice?.recieved);
  const signed = String(invoice?.payType || '').toLowerCase() === 'payble' ? -outstanding : outstanding;
  if (choice === ALL_IN_LOCAL) {
    return { currency: LOCAL_CURRENCY, balance: signed * invoiceRate(invoice) };
  }
  return { currency: invoice?.currency || LOCAL_CURRENCY, balance: signed };
}

/**
 * The total line for each currency, bucket by bucket - local currency first,
 * then the rest alphabetically.
 *
 * @param rows     the report's rows: { Currency, total, [bucket]: amount }
 * @param buckets  the bucket keys the report uses
 */
export function currencyTotals(rows, buckets) {
  const byCurrency = new Map();
  for (const row of rows || []) {
    const key = row.Currency || LOCAL_CURRENCY;
    if (!byCurrency.has(key)) {
      byCurrency.set(key, { Currency: key, total: 0, ...Object.fromEntries(buckets.map((b) => [b, 0])) });
    }
    const t = byCurrency.get(key);
    for (const b of buckets) t[b] += num(row[b]);
    t.total += num(row.total);
  }
  return [...byCurrency.values()].sort((a, b) =>
    (a.Currency === LOCAL_CURRENCY ? -1 : 0) - (b.Currency === LOCAL_CURRENCY ? -1 : 0)
    || a.Currency.localeCompare(b.Currency));
}

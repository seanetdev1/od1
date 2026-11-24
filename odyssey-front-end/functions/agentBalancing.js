import { invoiceRate } from './invoiceRate';

/**
 * One row of the Agent Invoice Balancing report - its figures, as numbers.
 *
 * In a foreign currency (USD, EUR...) the figures are the invoice's own; the
 * server returns only invoices in that currency. In PKR every invoice is
 * converted at its own rate - 1 for a PKR one (functions/invoiceRate). In All
 * every invoice keeps its own currency and figures.
 *
 * WHAT THIS REPLACES. The PKR view built the paid amount as display TEXT
 * ("1, 234.00") and then subtracted it from a number, so every balance was
 * NaN; the table formatted that text again and showed "1.00"; and the totals
 * row read the unconverted paid/received fields, mixing currencies. Every
 * figure is a number here, and paid / recieved are converted alongside the
 * total so the totals row adds like with like.
 */
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function agentBalancingFigures(invoice, currency) {
  const rate = String(currency || '').toUpperCase() === 'PKR' ? invoiceRate(invoice) : 1;
  const receivable = invoice?.payType === 'Recievable';
  const total = num(invoice?.total) * rate;
  const paid = num(invoice?.paid) * rate;
  const recieved = num(invoice?.recieved) * rate;
  const settled = receivable ? recieved : paid;
  return {
    total,
    paid,
    recieved,
    debit: receivable ? total : 0,
    credit: receivable ? 0 : total,
    paidRec: settled,
    balance: total - settled,
  };
}

/**
 * A row AS SHOWN: a CN's figures below zero - its Credit, its invoice total,
 * what was paid on it and what is still owed - and `amount`, Debit and Credit
 * as one signed figure for the one-column layout. A DN's are as they are.
 *
 * ALWAYS, since 2026-11-16 (the user: "in agent invoice balancing we need to
 * show credit values in negative"). It was the "CN as negative" switch, off by
 * default, and only in the one-Amount-column layout - so the usual Debit /
 * Credit view showed credits positive, and its Paid/Rcvd and Balance columns
 * did not add up to their own net Total lines. The CN's paid and balance
 * going below zero with it is the user's choice of 2026-10-09.
 *
 * For what is SHOWN and exported only. The totals are worked out from the
 * figures as they are (agentBalancingTotals), which already net CN against DN.
 */
export function withCnSign(row) {
  if (row?.payType !== 'Payble') return { ...row, amount: num(row?.debit) };
  return {
    ...row,
    amount: -num(row.credit),
    credit: -num(row.credit),
    total: -num(row.total),
    paidRec: -num(row.paidRec),
    balance: -num(row.balance),
  };
}

/** The Currency choice that lists every currency as invoiced - nothing converted. */
export const ALL_CURRENCIES = 'All';
export const isAllCurrencies = (currency) => String(currency || '').trim().toUpperCase() === 'ALL';

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * The report's Total lines, from its rows' figures (agentBalancingFigures).
 *
 * One currency - PKR included, where every row is already in PKR - is one
 * line. All is a line per currency: adding USD to EUR is not a total. Paid /
 * Rcvd and Balance are net, receivables less payables, as the single Total
 * line always was.
 *
 * WHAT THIS REPLACES. Three totals worked out on the page, the Paid / Rcvd one
 * converting to PKR a second time figures that were already in PKR.
 */
export function agentBalancingTotals(rows, currency) {
  const lines = new Map();
  for (const x of rows || []) {
    const key = isAllCurrencies(currency) ? (x?.currency || '-') : String(currency || '').trim().toUpperCase();
    const t = lines.get(key) || { currency: key, debit: 0, credit: 0, paidRec: 0, balance: 0 };
    const sign = x?.payType === 'Payble' ? -1 : 1;
    t.debit += num(x?.debit);
    t.credit += num(x?.credit);
    t.paidRec += sign * num(x?.paidRec);
    t.balance += sign * num(x?.balance);
    lines.set(key, t);
  }
  return [...lines.values()]
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((t) => ({ ...t, debit: round2(t.debit), credit: round2(t.credit), paidRec: round2(t.paidRec), balance: round2(t.balance) }));
}

export default agentBalancingFigures;

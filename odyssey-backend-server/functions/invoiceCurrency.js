/**
 * CHANGING AN INVOICE'S CURRENCY - the Currency box on the invoice page.
 *
 * An invoice's currency is what it is BILLED in; its charge lines keep their
 * own. A PKR invoice of USD charges is the ordinary case on these books (about
 * 13,400 migrated invoices and growing), each line with its own rate and its
 * PKR amount (local_amount).
 *
 * So the total comes from the LINES, by the rule approval uses
 * (routes/invoice approval): in PKR, the lines' PKR amounts; in a foreign
 * currency, the lines' own amounts - receivables less payables where an
 * invoice has both, as an agent invoice can.
 *
 * WHAT THIS REPLACES (the user's report, 2026-10-12: "it isn't working as it
 * is supposed to"). The box changed only the screen: it multiplied or divided
 * the total by the invoice's one rate - which is not what the lines add up to
 * when their rates differ - left a USD 100 invoice as "EUR 100" when moved
 * between two foreign currencies, saved nothing until the note was saved, and
 * let an APPROVED invoice change under the voucher already posted from it.
 *
 * No database here - unit tested.
 */
const CURRENCIES = ['PKR', 'USD', 'EUR', 'CHF', 'GBP', 'OMR', 'AED', 'BDT'];

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Whether an invoice may go to `currency`, and what its total then is.
 *
 * @param invoice  { approved, currency }
 * @param lines    its charge lines: { type, currency, net_amount, local_amount }
 * @returns { currency, total } or { refusal: 'why not' }
 */
function currencyChange(invoice, lines, currency) {
  const to = String(currency || '').trim().toUpperCase();
  if (!CURRENCIES.includes(to)) return { refusal: `${currency || 'That'} is not a currency invoices are raised in.` };
  if (String(invoice?.approved) === '1' || String(invoice?.approved) === 'true') {
    return { refusal: 'This invoice is approved and its voucher is posted. Unapprove it first to change its currency.' };
  }
  const list = Array.isArray(lines) ? lines : [];
  const lineCurrencies = [...new Set(list.map((l) => String(l.currency || 'PKR').toUpperCase()))];
  // A foreign currency has to be the lines' own: their amounts ARE in it.
  if (to !== 'PKR' && lineCurrencies.some((c) => c !== to)) {
    const theirs = lineCurrencies.join(' and ');
    return {
      refusal: lineCurrencies.length === 1
        ? `Its charges are in ${theirs}, so it can be in ${theirs} or PKR.`
        : `Its charges are in ${theirs}, so it can only be in PKR.`,
    };
  }
  const amount = (l) => (to === 'PKR' ? num(l.local_amount) : num(l.net_amount));
  const rec = list.filter((l) => l.type !== 'Payble').reduce((t, l) => t + amount(l), 0);
  const pay = list.filter((l) => l.type === 'Payble').reduce((t, l) => t + amount(l), 0);
  const total = rec && pay ? Math.abs(rec - pay) : rec + pay;
  return { currency: to, total: round2(total) };
}

module.exports = { currencyChange, CURRENCIES };

/**
 * An invoice's exchange rate, from its charge lines - worked out again at
 * approval, as its total, side and party already are.
 *
 * An invoice takes its rate from its first charge when it is made, and nothing
 * moved it after that. Unapproving, correcting a charge's rate and approving
 * again recomputed the total from the corrected lines and left the header on
 * the OLD rate - so the print's Exchange Rate, the page's rupee total, the
 * approval voucher (which posts an agent invoice at the header's rate) and
 * every settlement converting it disagreed with the lines.
 *
 *   An invoice in a FOREIGN currency (Agent Invoice / Bill): the rate its own
 *   lines carry. Lines at more than one rate: the rate their totals imply -
 *   the rupees they hold over the foreign total - so total x rate is what the
 *   lines add up to.
 *
 *   An invoice in RUPEES at rate 1 (customs, and freight rupee-only ones):
 *   left alone. Customs sets 1 on purpose, and nothing converts a rupee
 *   invoice by its rate (functions/invoiceRate on the screen).
 *
 *   An invoice in RUPEES carrying a foreign rate (a freight Job Invoice made
 *   from USD charges): kept in step with those charges when they share one
 *   rate. Several rates on a rupee invoice name no single one - left alone.
 *
 * @returns the rate as the column stores it (a string), or null to leave it.
 */
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const upper = (v) => String(v ?? '').trim().toUpperCase();
const isRupees = (currency) => !upper(currency) || upper(currency) === 'PKR';
const distinct = (list) => [...new Set(list)];
// Rates are typed to a few places (282.4, 279.85); four keeps an implied one
// exact to the paisa on any invoice this side of a billion.
const round4 = (v) => Math.round(v * 10000) / 10000;

const rateFromLines = ({ invoice, charges, total, defaultTotal }) => {
  const lines = (charges || []).filter((c) => num(c?.ex_rate) > 0);
  if (isRupees(invoice?.currency)) {
    if (num(invoice?.ex_rate) <= 1) return null;
    const rates = distinct(lines.filter((c) => !isRupees(c.currency)).map((c) => num(c.ex_rate)));
    return rates.length === 1 ? String(rates[0]) : null;
  }
  const own = lines.filter((c) => upper(c.currency) === upper(invoice.currency));
  const rates = distinct(own.map((c) => num(c.ex_rate)));
  if (rates.length === 1) return String(rates[0]);
  const foreign = num(total);
  const local = num(defaultTotal);
  if (foreign > 0 && local > 0) return String(round4(local / foreign));
  return null;
};

/** The header patch: the rate when it differs from what is stored, else nothing. */
const exRatePatch = (args) => {
  const rate = rateFromLines(args);
  if (rate === null || num(rate) === num(args.invoice?.ex_rate)) return {};
  return { ex_rate: rate };
};

module.exports = { rateFromLines, exRatePatch };

/**
 * A freight job's charge sheet and its USD rates (Jobs/ChargesComp).
 *
 * THE RULE - a USD (or any non-rupee) charge still open to change needs an
 * exchange rate above 1 (the user's request, 2026-10-13). As the server's
 * functions/chargeExRate - test both on the same cases.
 *
 * THE JOB'S RATES - Ex.Rate USD, Selling and Buying, as Climax kept them on
 * the job: receivable (DN) lines take the selling rate, payable (CN) lines
 * the buying one. "Refresh" puts them on every USD line still open to change.
 *
 * No React - unit tested.
 */
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(v * 100) / 100;

/** Not approved, and not on an approved invoice - a line that can still change. */
export const isOpen = (line) => String(line?.status) !== '1' && String(line?.Invoice?.approved) !== '1';
export const isForeign = (line) => {
  const c = String(line?.currency || '').trim().toUpperCase();
  return c !== '' && c !== 'PKR';
};

/** The first open foreign line whose rate is 1 or less - as a refusal - or null. */
export function foreignRateProblem(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const i = list.findIndex((l) => isOpen(l) && isForeign(l) && num(l.ex_rate) <= 1);
  if (i === -1) return null;
  const l = list[i];
  const what = [l.particular || l.description, String(l.currency).toUpperCase()].filter(Boolean).join(', ');
  return `Charge line ${i + 1} (${what}) needs an exchange rate above 1.`;
}

/** The rate a line of this side starts at: selling for a receivable, buying for a payable. */
export const rateFor = (type, { selling, buying }) => (type === 'Payble' ? num(buying) || num(selling) : num(selling));

/**
 * The job's USD rates on every USD line still open to change, its local
 * amount worked out again. Lines already approved, or on an approved
 * invoice, are left as they were posted.
 *
 * @returns {{ lines, changed }} - a new list, and how many lines moved
 */
export function refreshUsdRates(lines, rates) {
  let changed = 0;
  const out = (Array.isArray(lines) ? lines : []).map((l) => {
    if (!isOpen(l) || String(l?.currency || '').toUpperCase() !== 'USD') return l;
    const rate = rateFor(l.type, rates);
    if (!rate) return l;
    if (num(l.ex_rate) === rate) return l;
    changed += 1;
    return { ...l, ex_rate: rate, local_amount: round2(num(l.net_amount) * rate).toFixed(2) };
  });
  return { lines: out, changed };
}

/**
 * An invoice's round off - the +/- that brings its total to a whole rupee.
 *
 * Stored on the invoice as text: "0" for none, "+0.44" / "-0.40" otherwise. The
 * ledger posts it at approval (the party line carries the rounded total; the
 * difference goes to income or expense), and everything that asks what is owed
 * - payments, Job Balancing, Ageing - adds it to the total.
 *
 * ROUNDED AT APPROVAL, FROM THE APPROVED TOTAL. The invoice page stores the
 * figure when the box is ticked, but the total can change after that (unapprove,
 * correct a rate, approve again); a stored +0.44 then rounded the old total and
 * the new one came out at 1,250.84. So approval works it out again from the
 * total it is about to post, for every invoice that has the box ticked - and,
 * with Configuration > Invoices > Round off automatically, for every one.
 *
 * Only an invoice in rupees: an agent invoice is in its agent's currency, and
 * rounding its USD total by a rupee figure would post a wrong amount.
 */
const AGENT_TYPES = ['Agent Invoice', 'Agent Bill', 'Old Agent Invoice', 'Old Agent Bill'];

const isRoundable = (invoice) => !AGENT_TYPES.includes(invoice?.type)
  && (!invoice?.currency || String(invoice.currency).toUpperCase() === 'PKR');

/** The round off that makes `total` whole: half a rupee or less rounds down. */
function roundOffFor(total) {
  const cents = Math.round(Math.abs(Number(total) || 0) * 100) % 100;
  if (!cents) return '0';
  return cents <= 50 ? `-${(cents / 100).toFixed(2)}` : `+${((100 - cents) / 100).toFixed(2)}`;
}

/** Is a stored round off one at all? "0", "0.00", "-0.00", blank: no. */
const hasRoundOff = (value) => Math.abs(parseFloat(value) || 0) >= 0.005;

/**
 * The round off an invoice is approved with. Ticked (a stored figure) or
 * automatic: worked out from the total being approved. Not ticked: none. An
 * invoice that cannot be rounded keeps what it has.
 */
function approvalRoundOff(invoice, total, auto) {
  if (!isRoundable(invoice)) return invoice?.roundOff ?? '0';
  return auto || hasRoundOff(invoice?.roundOff) ? roundOffFor(total) : '0';
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The approval voucher's lines, as far as the round off shapes them: what the
 * party line and the contra (income / expense) line carry, and the separate
 * rounding line when the total is rounded DOWN.
 *
 *   none     party = total            contra = total
 *   up +r    party = total + r        contra = total + r   (the r is income /
 *                                                           expense with it)
 *   down -r  party = total - r        contra = total       and r on its own
 *                                                           line, the party's
 *                                                           side, to the OTHER
 *                                                           account (a sale's
 *                                                           to expense, a
 *                                                           bill's to income)
 *
 * EACH IN BOTH AMOUNTS. A line has `amount`, in the voucher's currency, and
 * `defaultAmount`, in rupees - and the ledger, the trial balance and every
 * balance read `defaultAmount`. The approval rounded `amount` only: the party
 * line kept the unrounded rupee total, a rounded-down sale's income line had
 * no rupee amount at all, and its 0.50 rounding line carried the WHOLE total in
 * rupees - so the books showed the invoice as an expense. Reported 2026-10-22
 * (SNS-JI-574/27 posted 117,959.60 where it was rounded to 117,960; on the CL
 * copy every invoice rounded down, 26 of them, went to expense in full).
 *
 * `r` in rupees is the round off at the voucher's rate - 1 for an invoice in
 * rupees, which is the only kind rounded (isRoundable); kept general so an
 * older invoice that carries one in another currency still balances.
 */
function roundOffHeads({ total, defaultTotal, roundOff }) {
  const t = Number(total) || 0;
  const dt = Number(defaultTotal) || 0;
  const r = hasRoundOff(roundOff) ? Number(parseFloat(roundOff)) : 0;
  const rate = t ? dt / t : 1;
  const rd = round2(r * rate);

  if (!r) {
    return { party: { amount: t, defaultAmount: dt }, contra: { amount: t, defaultAmount: dt }, rounding: null };
  }
  if (r > 0) {
    const up = { amount: round2(t + r), defaultAmount: round2(dt + rd) };
    return { party: up, contra: { ...up }, rounding: null };
  }
  return {
    party: { amount: round2(t + r), defaultAmount: round2(dt + rd) },
    contra: { amount: t, defaultAmount: dt },
    rounding: { amount: round2(-r), defaultAmount: round2(-rd) },
  };
}

module.exports = { isRoundable, roundOffFor, hasRoundOff, approvalRoundOff, roundOffHeads, AGENT_TYPES };

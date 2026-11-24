/* A party's credit terms, as the party form sends them (2026-10-23).
 *
 *   creditLimitDays   - how many days an invoice to the party may stay unpaid
 *   creditLimitAmount - how much the party may owe
 *
 * Both optional. A blank box is NULL, "no limit set", and is kept apart from
 * 0, which is a real answer: a party given no credit at all. The form sends a
 * blank as '' (or null, or nothing), and '' in an INTEGER column is a
 * Postgres error that would lose the whole party save.
 *
 * Anything else that is not a number of the right kind is refused rather than
 * quietly stored as "no limit" - a limit the user typed and the system dropped
 * is the one outcome worse than not having the field.
 */
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const asNumber = (v) => (typeof v === 'string' ? Number(v.replace(/,/g, '').trim()) : Number(v));

class CreditLimitError extends Error {}

const creditLimitsFrom = (value = {}) => {
  const out = {};

  if ('creditLimitDays' in value) {
    const v = value.creditLimitDays;
    if (blank(v)) out.creditLimitDays = null;
    else {
      const n = asNumber(v);
      if (!Number.isInteger(n) || n < 0) throw new CreditLimitError('Credit limit (days) must be a whole number of days, 0 or more.');
      out.creditLimitDays = n;
    }
  }

  if ('creditLimitAmount' in value) {
    const v = value.creditLimitAmount;
    if (blank(v)) out.creditLimitAmount = null;
    else {
      const n = asNumber(v);
      if (!Number.isFinite(n) || n < 0) throw new CreditLimitError('Credit limit (amount) must be an amount of 0 or more.');
      out.creditLimitAmount = Math.round(n * 100) / 100;
    }
  }

  return out;
};

module.exports = { creditLimitsFrom, CreditLimitError };

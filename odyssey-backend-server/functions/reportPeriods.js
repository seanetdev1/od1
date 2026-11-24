/**
 * The named date ranges a screen can ask for: fortnight, month, quarter,
 * fiscal year, or one typed by hand.
 *
 * CALENDAR PERIODS, NOT TRAILING WINDOWS. "This fortnight" is the 1st to the
 * 15th or the 16th to the end of the month - the half-month the business
 * reconciles in, the same period functions/aviationFortnight decides an AWB's
 * rates by, and the same one the aviation dashboard counts. A trailing
 * fifteen days would have been steadier to read, but it would mean three
 * different things called "fortnight" in one application, and the one that
 * closes the books has to win.
 *
 * The cost is worth stating plainly: early in a period these are SHORT. On the
 * 2nd of a month the fortnight holds two days. That is correct and it is what
 * the books do, but a screen offering it should show the dates it resolved to
 * rather than only the word - see the period selector on Payments & Receipts.
 *
 * INCLUSIVE AT BOTH ENDS, as 'YYYY-MM-DD'. Callers comparing against a
 * timestamp column have to take the whole of the last day, which is what
 * `toExclusive` is for: a row written at 14:30 on the closing day is inside
 * the period, and `createdAt <= '2026-10-15'` silently excludes it.
 *
 * Kept free of model imports so the arithmetic can be tested without a
 * database. The fiscal year is passed IN for the same reason - resolving which
 * one is selected is the route's job, not this module's.
 */

const moment = require('moment');

const FMT = 'YYYY-MM-DD';

/** The periods this understands. `custom` needs `from` and `to`. */
const PERIODS = ['fortnight', 'month', 'quarter', 'fiscalYear', 'custom'];

const day = (m) => m.format(FMT);

/**
 * The calendar fortnight a date falls in.
 *
 * Split on the 16th: the 1st-15th, or the 16th to the end of the month, so
 * every row in the same half-month belongs to the same period. February and a
 * 31-day month both end where their month ends rather than 14 days in, which
 * is what makes these periods reconcilable against a statement.
 */
const fortnightOf = (m) => {
  const firstHalf = m.date() <= 15;
  return {
    from: day(firstHalf ? m.clone().startOf('month') : m.clone().startOf('month').date(16)),
    to: day(firstHalf ? m.clone().startOf('month').date(15) : m.clone().endOf('month')),
  };
};

/**
 * Resolve a named period to `{ from, to }`, both inclusive 'YYYY-MM-DD'.
 *
 * @param {string} period      one of PERIODS. Anything unrecognised - including
 *                             nothing at all - resolves to the fortnight, which
 *                             is the narrowest and so the cheapest thing to
 *                             load. Falling back to the WIDEST would mean a
 *                             typo quietly fetching a whole year.
 * @param {Object} opts
 * @param {string} opts.from   custom only: inclusive start, 'YYYY-MM-DD'
 * @param {string} opts.to     custom only: inclusive end
 * @param {Object} opts.fiscalYear  fiscalYear only: { startDate, endDate }
 * @param {string} opts.now    the day to reckon from; defaults to today. Present
 *                             so tests do not depend on the date they run on.
 * @returns {{from: string, to: string, period: string}}
 */
function resolvePeriod(period, opts = {}) {
  const now = opts.now ? moment(opts.now, FMT, true) : moment();
  const base = now.isValid() ? now : moment();
  const name = PERIODS.includes(period) ? period : 'fortnight';

  if (name === 'custom') {
    // A half-typed custom range is not a reason to fetch everything, so an
    // incomplete one falls back rather than dropping the bound it is missing.
    const from = moment(opts.from, FMT, true);
    const to = moment(opts.to, FMT, true);
    if (!from.isValid() || !to.isValid()) {
      return { ...fortnightOf(base), period: 'fortnight' };
    }
    // Typed the wrong way round is a slip, not an empty range.
    return from.isAfter(to)
      ? { from: day(to), to: day(from), period: 'custom' }
      : { from: day(from), to: day(to), period: 'custom' };
  }

  if (name === 'fiscalYear') {
    const fy = opts.fiscalYear || {};
    const from = moment(fy.startDate, FMT, true);
    const to = moment(fy.endDate, FMT, true);
    // No fiscal year resolved - no session, or none selected - is not a licence
    // to read every invoice ever written.
    if (!from.isValid() || !to.isValid()) {
      return { ...fortnightOf(base), period: 'fortnight' };
    }
    return { from: day(from), to: day(to), period: 'fiscalYear' };
  }

  if (name === 'month') {
    return {
      from: day(base.clone().startOf('month')),
      to: day(base.clone().endOf('month')),
      period: 'month',
    };
  }

  if (name === 'quarter') {
    return {
      from: day(base.clone().startOf('quarter')),
      to: day(base.clone().endOf('quarter')),
      period: 'quarter',
    };
  }

  return { ...fortnightOf(base), period: 'fortnight' };
}

/**
 * The day AFTER a period's last day, for comparing against a TIMESTAMP.
 *
 * `createdAt` is a timestamp; the period's `to` is a date. `createdAt <= to`
 * compares against midnight and drops everything written during the closing
 * day, which is most of a day's invoices. So ranges are applied as
 * `from <= createdAt < toExclusive`.
 */
const toExclusive = (range) => day(moment(range.to, FMT, true).add(1, 'day'));

module.exports = { resolvePeriod, toExclusive, fortnightOf, PERIODS };

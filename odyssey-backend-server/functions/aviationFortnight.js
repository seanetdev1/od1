/**
 * The fortnight a flight's rates may still be changed in.
 *
 * WHY THIS EXISTS. An AWB's buying and selling rates are not finally settled
 * on the day it flies. The carrier and the master agent reconcile a period at
 * a time, and until that period closes a rate is still genuinely open to
 * change - a correction inside the window is bookkeeping, not tampering. Once
 * it closes the figures have been reported and reconciled, and changing one
 * afterwards silently restates a period somebody has already signed off.
 *
 * THE PERIOD is the calendar fortnight the FLIGHT DATE falls in - the 1st to
 * the 15th, or the 16th to the end of the month. Calendar, not fourteen
 * rolling days: every flight in the same half-month closes together, which is
 * what makes it a period that can be reconciled at all.
 *
 * Dated by the FLIGHT, not by when the row was typed. A flight entered late
 * belongs to the fortnight it flew in; dating it by entry would hand a
 * backdated flight a fresh window.
 *
 * Mirrored by functions/aviationFortnight.js in the frontend so the screen can
 * grey a field out before the server refuses the edit. THIS is the one that
 * decides; if the two disagree, this is right.
 *
 * Kept free of model imports so it can be tested without a database.
 */

/** Today, as 'YYYY-MM-DD' in local time. */
const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * The last day of the fortnight `date` falls in, as 'YYYY-MM-DD'.
 *
 * Returns null for anything that is not a date, which callers read as "no
 * window" - see ratesOpen.
 */
const fortnightEnd = (date) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || '').trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const day = Number(d);
  const month = Number(mo);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (day <= 15) return `${y}-${mo}-15`;
  // Day 0 of the NEXT month is the last day of this one, which is how
  // February and the 30-day months are got right without a table.
  const last = new Date(Date.UTC(Number(y), month, 0)).getUTCDate();
  return `${y}-${mo}-${String(last).padStart(2, '0')}`;
};

/**
 * May this flight's rates still be changed?
 *
 * A flight with NO DATE is open. The date is a required field now, but flights
 * entered before it became one exist, and refusing to let anyone correct a
 * rate because a date is missing punishes the wrong thing - the fix there is
 * to date the flight, which this does not stand in the way of.
 *
 * Both sides are 'YYYY-MM-DD' strings, which compare chronologically as text.
 */
const ratesOpen = (flightDate, now = today()) => {
  const end = fortnightEnd(flightDate);
  if (!end) return true;
  return String(now).slice(0, 10) <= end;
};

module.exports = { fortnightEnd, ratesOpen, today };

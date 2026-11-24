/* The install's own clock for credit control.
 *
 * The containers run on UTC; "9am" is 9am where the office is - Config >
 * Credit Control's time zone, Asia/Karachi by default. And an invoice's age is
 * counted in that zone's days, as the Ageing report counts it on the user's
 * screen: from the invoice's date to today, 0 = dated today.
 */
const partsIn = (date, timeZone) => {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    weekday,
  };
};

/** 'YYYY-MM-DD' of `date` in the zone. */
const localDate = (date, timeZone) => partsIn(date instanceof Date ? date : new Date(date), timeZone).date;

const dayNumber = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

/** Whole days from `from` to `to` ('YYYY-MM-DD' each); never negative. */
const daysBetween = (from, to) => Math.max(0, dayNumber(to) - dayNumber(from));

/** 'YYYY-MM-DD' `days` after `ymd`. */
const addDays = (ymd, days) => {
  const d = new Date((dayNumber(ymd) + days) * 86400000);
  return d.toISOString().slice(0, 10);
};

/** How far the zone is ahead of UTC at `instant`, in ms. */
const offsetMs = (instant, timeZone) => {
  const at = (zone) => Date.parse(new Date(instant).toLocaleString('en-US', { timeZone: zone }));
  return at(timeZone) - at('UTC');
};

/** The instant the day 'YYYY-MM-DD' starts in the zone. */
const startOfDay = (ymd, timeZone) => {
  const guess = Date.parse(`${ymd}T00:00:00.000Z`);
  return new Date(guess - offsetMs(guess, timeZone));
};

module.exports = { partsIn, localDate, daysBetween, addDays, startOfDay, offsetMs };

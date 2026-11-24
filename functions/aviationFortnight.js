// Whether a flight's rates may still be changed - see the backend's
// functions/aviationFortnight.js for what the rule is and why.
//
// MIRRORS that file. It is what actually refuses the edit; this is here so the
// screen can grey the rate cells out and say why, rather than letting someone
// retype a figure the save will silently drop.

/** Today, as 'YYYY-MM-DD' in local time. */
export const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * The last day of the fortnight `date` falls in: the 15th, or month end.
 * Null for anything that is not a date - callers read that as "no window".
 */
export const fortnightEnd = (date) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || '').trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const day = Number(d);
  const month = Number(mo);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (day <= 15) return `${y}-${mo}-15`;
  const last = new Date(Date.UTC(Number(y), month, 0)).getUTCDate();
  return `${y}-${mo}-${String(last).padStart(2, '0')}`;
};

/** May this flight's rates still be changed? An undated flight always may. */
export const ratesOpen = (flightDate, now = today()) => {
  const end = fortnightEnd(flightDate);
  if (!end) return true;
  return String(now).slice(0, 10) <= end;
};

/** DD-MM-YYYY, matching how every other date on these screens is shown. */
export const showDate = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

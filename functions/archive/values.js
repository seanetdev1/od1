// How a Climax value leaves the archive. Pure - no database.
//
// DATES ARE WALL DATES. Climax stored the office's local date and time with no
// zone; the driver hands it over as that same clock reading in UTC (mssql's
// useUTC). Sent on as an ISO instant it would move by the browser's offset -
// 2016-01-01 00:00 arriving as 2016-01-01 05:00 in Karachi, and as the 31st
// anywhere west of Greenwich - so it leaves as the plain 'YYYY-MM-DD' it was.

const pad = (n) => String(n).padStart(2, '0');

function valid(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** 'YYYY-MM-DD', or '' for none. */
function wallDate(d) {
  if (!valid(d)) return '';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 'YYYY-MM-DD HH:mm', or '' for none. */
function wallTime(d) {
  if (!valid(d)) return '';
  return `${wallDate(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** A Climax numeric as a plain number rounded to the paisa; 0 for none. */
function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

module.exports = { wallDate, wallTime, money };

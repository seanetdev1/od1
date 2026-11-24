/**
 * A date the browser sent, as the DAY it is in Pakistan - 'YYYY-MM-DD'.
 *
 * Report screens send a picked date as an instant: ISO in UTC
 * ("2026-06-30T19:00:00.000Z" for midnight on 1 July in Karachi) or moment's
 * toString ("Wed Jul 01 2026 00:00:00 GMT+0500"). The servers run in UTC (no
 * TZ in the kits), so formatting that as a day gave 30 June: a report from
 * 1 July took in the 30th, on every filter that compares DAYS - the customs
 * and aviation Job P&L, Job Balancing's Pending (found 2026-11-20). Asia/
 * Karachi has no daylight saving, so +05:00 always; functions/directJobSearch
 * reads dates in the same zone.
 *
 * A plain 'YYYY-MM-DD' is that day. Nothing readable is null.
 */
const moment = require('moment');

const PK_OFFSET_MINUTES = 5 * 60;

function pkDay(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = moment(new Date(s));
  return m.isValid() ? m.utcOffset(PK_OFFSET_MINUTES).format('YYYY-MM-DD') : null;
}

module.exports = { pkDay, PK_OFFSET_MINUTES };

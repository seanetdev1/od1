/**
 * A Climax entry time as the instant it really was.
 *
 * Climax stores AddOn / EditOn as SQL Server `datetime`: the office's wall
 * clock, Pakistan time, with no zone. The legacy bridge reads them as UTC, so
 * an entry made at 19:09 on 30 September arrived as 19:09Z - which is 00:09 on
 * 1 October in Karachi. Everything dated by them landed five hours late: the
 * ledger, which places every line by createdAt, showed evening entries on the
 * next day, and at a month or year end in the next period. Corrected by hand on
 * SNS and CargoLinkers on 2026-10-01.
 *
 * FOR ENTRY TIMES ONLY. Date-only legacy fields - VoucherDate, InvoiceDate,
 * TranDate - are midnight, already land on the right day, and must not move:
 * shifting them would put every one on the evening before.
 *
 * Pakistan has kept UTC+5 without daylight saving since 2009, so the offset is
 * a constant. LEGACY_UTC_OFFSET_MINUTES overrides it for a legacy system that
 * ran on another clock.
 *
 * No model imports - unit tested without a database.
 */

const DEFAULT_OFFSET_MINUTES = 300;

function offsetMinutes() {
  const n = Number(process.env.LEGACY_UTC_OFFSET_MINUTES);
  return Number.isFinite(n) ? n : DEFAULT_OFFSET_MINUTES;
}

/**
 * @param value  an AddOn / EditOn as the bridge sends it (ISO string or Date)
 * @returns ISO string of the real instant; null for nothing; the value as it
 *          came for anything that is not a date, rather than throwing on it
 */
function legacyTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms - offsetMinutes() * 60000).toISOString();
}

module.exports = { legacyTimestamp, DEFAULT_OFFSET_MINUTES };

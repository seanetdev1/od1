/**
 * The order a ledger lists its entries in: every entry in the order it was
 * MADE (the user, 2026-11-10).
 *
 *   1. the DAY, as the reader sees it - in their own time zone, which is why
 *      this is done here and not by the server: an entry stamped midnight
 *      Pakistan time is the day before in UTC
 *   2. WHEN THE VOUCHER WAS ENTERED - `Voucher.createdOn`, the audit stamp.
 *      Not the ledger date's time: an invoice's voucher stands on the
 *      invoice's date with no time of day, and a back-dated entry stands on
 *      a day it was not made on. A voucher with no stamp (entered before the
 *      stamps, v1.2.57) goes by its ledger time, `createdAt`, which for
 *      those is when it was keyed. Migrated vouchers carry Climax's own entry
 *      time in createdOn (voucher-entry-times.sql in cl-deploy / sns-deploy,
 *      made by tools/gen-voucher-entry-times.js).
 *   3. the order the server sent them in - the time, then the voucher, then
 *      the line - for everything still tied, so a voucher's lines stay together
 *
 * Until 2026-11-10 a day's invoice entries came first, in invoice-number
 * order - a stand-in for entry order while CL's migrated invoices had no time.
 */
import moment from 'moment';

const enteredAt = (row) => {
  const t = new Date(row['Voucher.createdOn'] || row.createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
};

export function inLedgerOrder(rows) {
  return (rows || [])
    .map((row, at) => ({ row, at, day: moment(row.createdAt).format('YYYY-MM-DD'), entered: enteredAt(row) }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.entered - b.entered || a.at - b.at)
    .map((x) => x.row);
}

export default inLedgerOrder;

/**
 * The date a voucher stands on in the ledger, from the date a screen picked.
 *
 * The ledger places every line by Voucher_Heads.createdAt. Direct Job E/R kept
 * the picked Entry Date in tranDate only: the voucher and its lines took the
 * moment of saving, so a back-dated entry sat in the ledger on the day it was
 * keyed in - and moved to the day of every later edit, which rewrites them.
 *
 * A picked date is read strictly, in every shape the screens have sent, and
 * DD-MM-YYYY before anything that could take it the American way round: handed
 * straight to `new Date()`, 05-09-2026 is 9 May and 28-09-2026 no date at all.
 * (The old Payments & Receipts GL modal, PaymentsReceipt/Gl.js, sent that
 * shape; nothing renders it now.) Nothing readable falls back to now - the old
 * behaviour, and the right one for a screen that sends no date.
 *
 * No model imports - unit tested.
 */
const moment = require('moment');

const FORMATS = [moment.ISO_8601, 'DD-MM-YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY'];

/** A Date for the picked value, or null if it is not one. */
function pickedDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const m = moment(String(value), FORMATS, true);
  return m.isValid() ? m.toDate() : null;
}

/** The ledger date: the picked one, or now when none was picked. */
function ledgerDateOf(value, now = new Date()) {
  return pickedDate(value) || now;
}

/**
 * The date an OPENING BALANCE stands on: the day before its fiscal year opens
 * - 30 June 2026 for 2026-2027 - so every ledger and trial balance of that
 * year counts it in the balance brought forward.
 *
 * It was "30 June" worked out from today, one year late both ways: an opening
 * entered in October 2026 stood on 30 June 2027, the END of the year it opens.
 * The ledger drops a line dated after the period it shows, so the balance was
 * missing from every ledger run that year - and then arrived as a movement on
 * the last day of it.
 *
 * From the SELECTED fiscal year, the one the voucher is numbered in - not from
 * today. At MIDDAY UTC (5 pm in Pakistan): 30 June in UTC and in Pakistan
 * alike, so it reads as 30 June whichever zone a report compares in. 23:59 on
 * a UTC server is already 1 July in Pakistan - inside the period again - and
 * midnight in Pakistan is still 29 June in UTC.
 *
 * @param fiscalYear  { startDate: 'YYYY-MM-DD' } (FiscalYears is DATEONLY)
 */
function openingBalanceDate(fiscalYear, now = new Date()) {
  const start = moment.utc(String(fiscalYear?.startDate || ''), 'YYYY-MM-DD', true);
  if (start.isValid()) return start.subtract(1, 'day').hour(12).toDate();
  // No start date to go by: the 30 June before today's July-to-June year.
  const today = moment.utc(now);
  const year = today.month() >= 6 ? today.year() : today.year() - 1;
  return moment.utc({ year, month: 5, date: 30, hour: 12 }).toDate();
}

/**
 * Where an opening balance that is ALREADY SAVED should stand, when it is
 * edited (and what cl-deploy/opening-balance-dates.sql applies).
 *
 * Only a date AFTER the first day of its year is wrong: that is what the old
 * rule produced (the 30 June ending the year), and what an edit did (the
 * moment of the edit). Anything on or before the first day was put there on
 * purpose - the demo seed's opening stands on 1 July - and is kept.
 * The first day ends at midnight UTC after it, which is 5 am on the 2nd in
 * Pakistan: generous by a few hours rather than short.
 */
function openingBalanceRedate(current, fiscalYear) {
  const start = moment.utc(String(fiscalYear?.startDate || ''), 'YYYY-MM-DD', true);
  const at = current ? moment(current) : null;
  if (start.isValid() && at?.isValid() && at.isBefore(start.clone().add(1, 'day'))) return at.toDate();
  return openingBalanceDate(fiscalYear);
}

module.exports = { pickedDate, ledgerDateOf, openingBalanceDate, openingBalanceRedate };

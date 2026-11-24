import moment from 'moment';

/**
 * A CASH voucher has no cheque - no number, no date.
 *
 * Reported 2026-10-21. The Voucher screen, Payments & Receipts and Direct Job
 * E/R each disabled their cheque fields for cash but still SENT them: the date
 * picker's default (the moment the screen opened) and any number typed before
 * the mode was switched. So every cash voucher was stored, listed, printed and
 * shown on the ledger with a cheque dated the day it was keyed in. The server
 * now refuses to store one too (functions/cashCheque there); the screens show
 * the fields empty and send nothing.
 *
 * Cash vouchers are CPV / CRV; on P&R and Direct Job that is the Cash mode.
 */
export const isCashVoucher = (vType) => ['CPV', 'CRV'].includes(String(vType || '').trim().toUpperCase());

export const isCashMode = (mode) => String(mode || '').trim().toLowerCase() === 'cash';

/**
 * What a cheque date picker shows: nothing when there is no date.
 * `moment(undefined)` is NOW - which is how an empty date became today's on
 * screen - and `moment(null)` is "Invalid date".
 */
export const pickerDate = (value) => {
  if (!value) return null;
  const m = moment(value);
  return m.isValid() ? m : null;
};

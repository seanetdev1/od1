/**
 * A CASH voucher has no cheque.
 *
 * Every screen that writes one sent a cheque anyway: the date picker's default
 * - the moment the screen was opened - and, on Payments & Receipts, whatever
 * number was typed before the mode was switched to Cash. So cash payments and
 * receipts were stored, listed, printed and shown on the ledger with a cheque
 * dated the day they were entered, and P&R wrote ", Date: ..." into the
 * narration. Reported 2026-10-21.
 *
 * Kept off here, on the way in, whatever a screen sends. Cash vouchers are
 * CPV / CRV - what the voucher screen, Payments & Receipts (party and agent)
 * and Direct Job E/R all post for cash.
 */
const CASH_TYPES = new Set(['CPV', 'CRV']);

const isCashVoucher = (vType) => CASH_TYPES.has(String(vType || '').trim().toUpperCase());

// A fresh object each time: callers assign it into bodies they then change.
const noCheque = () => ({ chequeNo: '', chequeDate: null });

module.exports = { isCashVoucher, noCheque };

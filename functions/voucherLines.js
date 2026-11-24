/**
 * THE VOUCHER SCREEN'S LINES, kept as Direct Job E/R keeps its own
 * (functions/directJobLines, asked for here 2026-11-16): always a blank one at
 * the bottom to type into, and only the filled ones saved.
 *
 * WHAT COUNTS AS A LINE. Something entered on it: an account, an amount or a
 * narration. NOT its side - every line starts on one - so a line holding only
 * that is the blank one at the bottom, and is never sent: the save refused it
 * ("Account not Selected in Row 3") and the narration it builds read every
 * line's account, so a blank one stopped the save altogether.
 */
import { hasSettlementLine, defaultLineSide } from 'functions/voucherTotals';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v) => String(v ?? '').trim();

/** Has anything been entered on this line? See above for what counts. */
export const voucherLineHasData = (line) => Boolean(
  line && (
    (line.ChildAccountId !== undefined && line.ChildAccountId !== null && text(line.ChildAccountId) !== '')
    || num(line.amount)
    || text(line.narration)
  ),
);

/** The lines a Save sends: the filled ones, in their order. */
export const voucherLinesToSave = (lines) => (lines || []).filter(voucherLineHasData);

/**
 * Which side a new line starts on. A payment's is a debit and a receipt's a
 * credit - the usual case; its Type box can turn it round. A JV or TV line
 * starts on the side that is short, so the next line typed balances the
 * voucher - the first on the debit.
 */
export function newLineSide(lines, vType) {
  if (hasSettlementLine(vType)) return defaultLineSide(vType);
  let debit = 0;
  let credit = 0;
  for (const l of voucherLinesToSave(lines)) {
    if (l.type === 'credit') credit += num(l.amount);
    else debit += num(l.amount);
  }
  const filled = voucherLinesToSave(lines);
  if (!filled.length) return 'debit';
  if (debit === credit) return filled[filled.length - 1].type === 'debit' ? 'credit' : 'debit';
  return debit > credit ? 'credit' : 'debit';
}

/** A new, empty line - what Add Row and the bottom row start as. No date of
 *  its own: save() dates every line with the voucher's, and a Moment kept
 *  here was a value Redux warned it could not store. */
export const blankVoucherLine = (lines, vType) => ({
  defaultAmount: 0.0,
  amount: 0.0,
  type: newLineSide(lines, vType),
  narration: '',
  settlement: '',
  accountType: '',
  ChildAccountId: undefined,
});

/**
 * The lines with a blank one at the bottom, or null when they already end in
 * one. Nothing until the voucher has a type: its side depends on it.
 */
export const withBlankLastVoucherLine = (lines, vType) => {
  if (!vType) return null;
  const list = lines || [];
  if (list.length && !voucherLineHasData(list[list.length - 1])) return null;
  return [...list, blankVoucherLine(list, vType)];
};

/**
 * Which lines an amount typed on a JV or TV is copied to: with two lines
 * filled (counting the one typed on), both - a two-line journal is one
 * figure, as it always was; with more, that line alone. The blank line at the
 * bottom is never one of them - an amount would make it a line.
 */
export const mirroredLines = (lines, index) => {
  const filled = (lines || [])
    .map((l, i) => ((i === index || voucherLineHasData(l)) ? i : -1))
    .filter((i) => i >= 0);
  return filled.length < 3 ? filled : [index];
};

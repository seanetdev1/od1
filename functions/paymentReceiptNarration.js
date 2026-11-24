/**
 * The narration TYPED on Payments & Receipts, for its print - shown there as
 * Narration, apart from the Remarks the print writes itself (the user,
 * 2026-11-10). The print never showed it.
 *
 * A voucher's narration is one of two things, and the screen's Narration box
 * shows either when the voucher is opened:
 *   - what was typed in the box, or
 *   - left empty, the server's own text (routes/voucher makeTransaction):
 *       Received|Paid <sub type>[ <cheque no>][, Date: YYYY-MM-DD]
 *       [, Against[, HBL# ..][, MBL# ..], Invoice# .., ..., Job# .., For <party>]
 *     which says what Remarks says - so it is not printed again.
 *
 * Told apart by that shape. The sub type is matched as the voucher has it, so
 * "Received cash from Ali" typed on a Cheque receipt is a narration. The
 * cheque number is matched loosely - an edited voucher keeps the text made at
 * first save, with the cheque it had then.
 */
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const isAutoNarration = (text, { subType } = {}) => {
  const t = String(text ?? '').trim();
  if (!t) return false;
  const re = new RegExp(
    `^(?:Received|Paid) ${esc(subType)}`
    + '(?: [^,]*)?'                                   // the cheque number
    + '(?:, Date: \\d{4}-\\d{2}-\\d{2})?'
    + '(?:, (?:Against|HBL#|MBL#|Invoice#|Job#|For)\\b[\\s\\S]*)?$',
  );
  return re.test(t);
};

/** The typed narration, or '' when there is none. */
export const typedNarration = (state = {}) => {
  const t = String(state.voucherNarration ?? '').trim();
  return t && !isAutoNarration(t, state) ? t : '';
};

export default typedNarration;

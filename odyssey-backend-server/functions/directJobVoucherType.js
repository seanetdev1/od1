/**
 * The voucher a Direct Job E/R posts, by its Type and Tran Mode - the same
 * codes the Payments & Receipts screen issues for the same money:
 *
 *                 expense   revenue
 *     Bank        BPV       BRV
 *     Cash        CPV       CRV
 *     Adjust      ADJ-P     ADJ-R
 *
 * WHAT THIS REPLACES. The route compared Tran_Mode to 'bank' and 'cash' while
 * the screen sends 'Bank', 'Cash' and 'Adjust', so neither ever matched and
 * every entry fell through to the fallback: a debit note (DN) for revenue, a
 * credit note (CN) for expense - a cash payment numbered as a credit note.
 * The mode is now read without regard to case, and a mode that is none of the
 * three is refused rather than guessed at.
 *
 * Pure, so it can be tested without a database.
 *
 * @param type     Direct_Jobs.Type - 'expense' | 'revenue'
 * @param tranMode Direct_Jobs.Tran_Mode - 'Bank' | 'Cash' | 'Adjust'
 * @returns the vType, or null when the mode is not one of the three
 */
const BY_MODE = {
  bank: { expense: 'BPV', revenue: 'BRV' },
  cash: { expense: 'CPV', revenue: 'CRV' },
  adjust: { expense: 'ADJ-P', revenue: 'ADJ-R' },
};

const directJobVoucherType = (type, tranMode) => {
  const mode = String(tranMode || '').trim().toLowerCase();
  const codes = BY_MODE[mode === 'adjustment' ? 'adjust' : mode];
  if (!codes) return null;
  return String(type || '').trim().toLowerCase() === 'revenue' ? codes.revenue : codes.expense;
};

/**
 * Whether a saved entry's voucher can keep the type it has when the entry is
 * edited. When it cannot - the mode or the side changed, or it is one of the
 * CN/DN vouchers the old code issued - it is renumbered into the right series.
 *
 * Climax posted its adjustment entries as journal vouchers, and an entry
 * migrated from it keeps that JV and its number: it is not wrong, only older.
 */
const keepsVoucherType = (current, wanted) =>
  current === wanted || (current === 'JV' && /^ADJ-/.test(String(wanted)));

module.exports = { directJobVoucherType, keepsVoucherType };

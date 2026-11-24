/**
 * How legacy ledger records map onto Odyssey's columns.
 *
 * Two importers used to write these same columns with different rules -
 * /importVouchers resolved the party through the client association and worked
 * out payable/receivable, /importV read the party straight off the COA line -
 * and whichever ran second won. These are the decisions that used to be made
 * by insertion order.
 *
 * Kept free of model imports so it can be tested without a database, which is
 * the point: this is the part worth checking, and standing up Sequelize to do
 * it would mean it never got checked.
 */

/* --------------- WHICH LIST A VOUCHER APPEARS IN -----------------------------
 * `Vouchers.type` is the ONLY thing that decides, and the two screens are
 * exactly complementary on it:
 *
 *   Payments & Receipts   type IN  ('Job Payment', 'Job Reciept')
 *   Voucher List          type NOT IN the same two
 *
 * So 'Job Payment' is not a description of how money moved - a cash payment is
 * still a payment either way - it is a claim that this voucher is one of the
 * ones that SETTLES AN INVOICE OR BILL, which is what the Payments & Receipts
 * screen exists to show and to open.
 *
 * Mapping every legacy CPV/BPV/BRV/CRV to it was therefore wrong, and wrong at
 * scale. On CargoLinkers 7,525 vouchers carry those four type codes and only
 * 136 settle anything: the other 7,389 are cash and bank movements against a
 * party account with no document behind them - office expenses, transfers,
 * advances - and they belong in the Voucher List. Sent to Payments & Receipts
 * they arrive as rows with no invoice to show, they bury the 136 that matter,
 * and the Voucher List looks empty.
 *
 * A voucher that settles nothing keeps its LEGACY TYPE NAME - 'CASH PAYMENT
 * VOUCHER', 'BANK RECEIPT VOUCHER'. That is not a new vocabulary: it is the
 * same fall-through every other legacy type already takes (JOURNAL VOUCHER,
 * TRANSFER VOUCHER, CHEQUE RETURN), so the Voucher List already knows how to
 * show one.
 * -------------------------------------------------------------------------- */
const VOUCHER_TYPE_MAP = {
  // Settling is the whole test - see above. `settlesInvoice` comes from
  // GL_InvAdjustments, which is the only record of a legacy voucher having
  // been applied to a document.
  PAYMENT: (VT, settles) => (settles
    ? { type: 'Job Payment', vType: VT.TypeCode }
    : { type: VT.VoucherType, vType: VT.TypeCode }),
  RECEIPT: (VT, settles) => (settles
    ? { type: 'Job Reciept', vType: VT.TypeCode }
    : { type: VT.VoucherType, vType: VT.TypeCode }),
  // A note is an adjustment document in its own right and never appears in
  // Payments & Receipts, settled or not. Only its type CODE is rewritten.
  'DEBIT NOTE': (VT) => ({ type: VT.VoucherType, vType: 'ADJ-R' }),
  'CREDIT NOTE': (VT) => ({ type: VT.VoucherType, vType: 'ADJ-P' }),
};

/**
 * Legacy voucher type -> Odyssey type/vType pair.
 *
 * @param VT                the GL_VoucherType row
 * @param settlesInvoice    does this voucher apply money to an invoice or
 *                          bill? Defaults FALSE, so a caller that has not been
 *                          told sends the voucher to the Voucher List rather
 *                          than claiming a settlement it cannot see. Being in
 *                          the wrong list is recoverable; a payment screen
 *                          full of vouchers with no document is not obviously
 *                          wrong to anyone looking at it.
 */
function resolveVoucherType(VT = {}, settlesInvoice = false) {
  const name = String(VT.VoucherType || '');
  const key = Object.keys(VOUCHER_TYPE_MAP).find((k) => name.includes(k));
  return key
    ? VOUCHER_TYPE_MAP[key](VT, Boolean(settlesInvoice))
    : { type: VT.VoucherType, vType: VT.TypeCode };
}

/** Which bucket a voucher head's account falls into. */
function resolveAccountType(coa = {}) {
  const subCat = coa?.GL_COASubCategory?.SubCategory || '';
  const accName = coa?.AccountName || '';
  if (subCat.includes('Customer') || subCat.includes('Vendor')) return 'partyAccount';
  if (subCat.includes('Bank') || subCat.includes('Cash')) return 'payAccount';
  if (accName.includes('EX-CHANGE RATE GAIN / LOSS')) return 'Gain/Loss Account';
  if (accName.includes('TAX')) return 'Tax Account';
  return 'Adjust Charges Account';
}

/**
 * Is this voucher on the payable side?
 *
 * THE SUB-CATEGORY FIRST, the parent account name only as a fallback.
 *
 * This read the parent name alone, matching PAYABLE / LIABILITIES. That is how
 * IFA's chart words its control accounts; CargoLinkers files its 25 vendor
 * accounts under "SUNDRY CREDITORS", which matches none of them - so every
 * vendor voucher on that book was classified as a client one.
 *
 * `subCategory` says it outright and is the same word on both charts, so it is
 * asked first. "Customer/Vendor" exists on a handful of accounts and says
 * nothing either way, which is exactly when the parent name is worth reading.
 */
function isPayableAccount(leadingDetail = {}) {
  const sub = leadingDetail?.GL_COA?.GL_COASubCategory?.SubCategory || '';
  if (sub.includes('Vendor') && !sub.includes('Customer')) return true;
  if (sub.includes('Customer') && !sub.includes('Vendor')) return false;

  const parent = leadingDetail?.GL_COA?.GL_COA?.AccountName || '';
  // "LAIBILITY" is a misspelling that exists in the real legacy chart of
  // accounts. Dropping it would flip those vouchers to the client side.
  return parent.includes('PAYABLE') || parent.includes('CREDITOR')
    || parent.includes('LIABILITIES') || parent.includes('LAIBILITY');
}

/** Invoice type and pay direction, as the app's screens read them. */
function resolveInvoiceMeta(I = {}) {
  const number = String(I.InvoiceNumber || '');
  if (number.includes('JI')) return { type: 'Job Invoice', payType: 'Recievable', operation: 'JI' };
  if (number.includes('JB')) return { type: 'Job Bill', payType: 'Payble', operation: 'JB' };
  if (number.includes('AI')) {
    return {
      type: 'Agent Invoice',
      // An agent invoice can go either way, so the direction comes from the
      // mode rather than the number.
      payType: I?.GL_InvMode?.ModeType === 'Receivable' ? 'Recievable' : 'Payble',
      operation: 'AI',
    };
  }
  return { type: '', payType: '', operation: '' };
}

/**
 * "SNS-PV-1043/25" -> "1043". Also "BPV-00001/25" -> "1".
 *
 * THE LAST DASH-SEPARATED SEGMENT, not the third.
 *
 * Reading parts[2] hard-coded one customer's numbering. IFA prefixes the
 * company - ACS-BRV-00123/23, three parts - while CargoLinkers does not:
 * every one of its 59,993 vouchers is BPV-00001/25, two parts. So this
 * returned null for the whole book, every voucher was reported `unnumbered`,
 * and the ledger stage would have imported nothing at all while reporting
 * success.
 *
 * Taking the last segment is right for both, and stays right for a numbering
 * with four parts. The digits check is what the length check was really
 * standing in for: `voucher_No` is an INTEGER NOT NULL, so a segment that is
 * not a number has to be refused here rather than becoming NaN at insert.
 *
 * Returns null rather than throwing. The old code did
 *     number.split("-")[2].split("/")[0]
 * unguarded, so a number in an unexpected shape threw and took the whole
 * voucher down with it.
 */
function sequenceFromNumber(number) {
  const text = String(number || '').trim();
  if (!text) return null;

  const seq = text.split('-').pop().split('/')[0].trim();
  if (!/^\d+$/.test(seq)) return null;

  // All zeros is not a sequence, which is what the old `seq || null` caught.
  return seq.replace(/^0+/, '') || null;
}

/**
 * Which detail line carries the party?
 *
 * A voucher's lines are the control account (accounts payable / receivable)
 * and the party's own subledger account. Which comes first is not fixed, so
 * taking line 0 puts the control account in party_Id for every voucher that
 * happens to list it second.
 *
 * UploadChargesPayb/Recv already resolved this: if the first line's PARENT is
 * one of the control categories then that line IS the party line, otherwise
 * the party is on line 1. This is that rule, in one place.
 */
const CONTROL_PARENTS = [
  'PAYABLE', 'RECEIVABLE', 'ASSETS', 'LIABILITIES', 'LAIBILITY',
  // How CargoLinkers words the same two control accounts.
  'DEBTOR', 'CREDITOR',
];

function partyDetailLine(details = []) {
  const lines = Array.isArray(details) ? details : [];
  if (!lines.length) return null;

  // THE SUB-CATEGORY NAMES THE PARTY ACCOUNT OUTRIGHT, so ask it before
  // guessing from position.
  //
  // The rule below infers the party line from whether line 0 sits under a
  // control account, which depends on how a customer happens to NAME that
  // account. CargoLinkers calls them SUNDRY DEBTORS and SUNDRY CREDITORS, so
  // the test failed, the second line was taken on every voucher, and the
  // party came out blank on 54,954 of 54,963 - the party is on the FIRST line
  // on all but nine of them.
  //
  // subCategory is 'Customer' / 'Vendor' on both charts and needs no such
  // guess. The positional rule stays as the fallback for a chart that does not
  // categorise its accounts.
  const byCategory = lines.find((l) => {
    const s = l?.GL_COA?.GL_COASubCategory?.SubCategory || '';
    return s.includes('Customer') || s.includes('Vendor');
  });
  if (byCategory) return byCategory;

  const firstParent = lines[0]?.GL_COA?.GL_COA?.AccountName || '';
  const firstIsUnderControl = CONTROL_PARENTS.some((c) => firstParent.includes(c));
  return firstIsUnderControl ? lines[0] : (lines[1] || lines[0]);
}

/**
 * The legacy COA id for a detail line, which is also the Odyssey
 * Child_Account.id - /importAccount creates them with `id: item.Id`, so the
 * ids are the same on both sides and no name matching is needed.
 */
function accountIdForLine(line = {}) {
  const id = line?.COAAccountId ?? line?.GL_COA?.Id;
  return id == null ? null : id;
}

module.exports = {
  resolveVoucherType,
  resolveAccountType,
  isPayableAccount,
  resolveInvoiceMeta,
  sequenceFromNumber,
  partyDetailLine,
  accountIdForLine,
  CONTROL_PARENTS,
};

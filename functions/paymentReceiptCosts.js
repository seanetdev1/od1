/**
 * Who pays the tax and the bank charges on a payment / receipt, and what the
 * journal makes of it. Chosen on the screen per transaction (state.taxBy,
 * state.bankChargesBy); both default to US, which is how it always posted.
 *
 * The party is always settled at the full amount. What changes is where the
 * cost lands:
 *
 *   paid by US      the tax / bank charges account is DEBITED and our bank
 *                   carries it: a receipt lands that much less, a payment
 *                   takes that much more out. ("The tax amount is always
 *                   settled in our bank", 2026-10-21.)
 *
 *   paid by the     NOT through our bank - the bank moves the settled amount
 *   PARTY           only. The party is charged it and the account selected
 *                   for it takes it (the user's correction, 2026-10-22):
 *
 *                     payment  Party Dr  /  Withholding Tax (or Bank Charges) Cr
 *                     receipt  Party Cr  /  Withholding Tax (or Bank Charges) Dr
 *
 *                   A vendor's tax withheld is owed to the tax authority; a
 *                   customer's deducted from us is ours to claim, and they are
 *                   credited with it. It had been: the party debited instead
 *                   of the tax account with the bank still carrying it, and
 *                   the party's bank charges not posted at all.
 *
 * The party's lines go to its ledger account on the server: a line whose
 * partyId is the party is posted there, as the gain/loss line already is.
 */
export const PAID_BY_US = 'us';
export const PAID_BY_PARTY = 'party';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const partyPaysTax = (state = {}) => state.taxBy === PAID_BY_PARTY;
export const partyPaysCharges = (state = {}) => state.bankChargesBy === PAID_BY_PARTY;

/**
 * What the bank line carries beyond the settled amount: taken off a receipt,
 * added to a payment. Only what WE pay - the party's goes past the bank.
 */
export const bankCarries = (state = {}) =>
  (partyPaysTax(state) ? 0 : num(state.taxAmount))
  + (partyPaysCharges(state) ? 0 : num(state.bankChargesAmount));

const debit = (amount) => ({ debit: amount, credit: 0, type: 'debit' });
const credit = (amount) => ({ debit: 0, credit: amount, type: 'credit' });

/**
 * The journal's tax and bank charge lines.
 *
 * `receipt`: the money comes in - the side the party's lines fall on when it
 * pays (credited on a receipt, debited on a payment).
 */
export const costLines = (state = {}, receipt = true) => {
  const lines = [];
  const partyName = (state.PRaccounts || []).find((x) => x.id === state.selectedAccount)?.name || 'N/A';
  const accountName = (id) => (state.adjustAccounts || []).find((x) => x.id === id)?.title || 'N/A';

  const add = (amount, accountType, accountId, byParty) => {
    if (amount === 0) return;
    if (!byParty) {
      lines.push({ partyId: accountId, accountType, accountName: accountName(accountId), ...debit(amount) });
      return;
    }
    // The party first, then the account it goes to - the way it reads.
    lines.push({ partyId: state.selectedAccount, onParty: true, accountType, accountName: partyName, ...(receipt ? credit(amount) : debit(amount)) });
    lines.push({ partyId: accountId, accountType, accountName: accountName(accountId), ...(receipt ? debit(amount) : credit(amount)) });
  };

  add(num(state.taxAmount), 'Tax Account', state.taxAccount, partyPaysTax(state));
  // As it always read: "Cash Charges Account" on cash, otherwise "Adjust
  // Charges Account" (the Bank case of the old expression was unreachable).
  add(
    num(state.bankChargesAmount),
    state.transactionMode == 'Cash' ? 'Cash Charges Account' : 'Adjust Charges Account',
    state.bankChargesAccount,
    partyPaysCharges(state),
  );
  return lines;
};

/**
 * Who paid, read back from a saved voucher's lines - there is no column for
 * it. A tax or bank charge line on the party's own ledger account means the
 * party paid; the line on the other account is the account that was chosen.
 *
 * @returns { taxBy, taxHead, bankChargesBy, chargesHead } - the heads are the
 *          account's own lines (amount, ChildAccountId), or null.
 */
export const paidByFromHeads = (heads = []) => {
  const partyAccount = heads.find((h) => h.accountType === 'partyAccount')?.ChildAccountId;
  const onParty = (h) => partyAccount != null && String(h.ChildAccountId) === String(partyAccount);
  const of = (text) => heads.filter((h) => String(h.accountType || '').includes(text));
  const taxHeads = of('Tax Account');
  const chargeHeads = of('Charges Account');
  return {
    taxBy: taxHeads.some(onParty) ? PAID_BY_PARTY : PAID_BY_US,
    taxHead: taxHeads.find((h) => !onParty(h)) || null,
    bankChargesBy: chargeHeads.some(onParty) ? PAID_BY_PARTY : PAID_BY_US,
    chargesHead: chargeHeads.find((h) => !onParty(h)) || null,
  };
};

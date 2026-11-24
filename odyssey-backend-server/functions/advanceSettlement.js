/**
 * SETTLING AN ADVANCE - knocking invoices off against money a payment or
 * receipt already brought in. The user's workflow (2026-11-06): open the
 * payment or receipt on Payments & Receipts, press Refresh for the party's
 * unsettled invoices, tick them, save.
 *
 * That save used to rebuild the whole voucher from the invoices ticked: tick
 * less than the advance and the receipt - bank line included - shrank to the
 * ticked total, so money really received left the books; tick more and it
 * grew past what came in. Hasnain Cargo's two 2024 advances could not be
 * settled at all without one of them losing 163,734.10.
 *
 * Now it records the KNOCK-OFFS ONLY (the user's choice): the voucher and its
 * ledger lines are not touched, the ticks are capped at what the voucher
 * brought in, and what is not ticked stays on the party as advance - as
 * Climax's GL_InvAdjustments did. Unticking an invoice gives its share back
 * to the advance. A rate difference on a foreign-currency invoice is not
 * posted at settlement.
 *
 * planSettlement is the rules, with no database - unit tested.
 */
const { toCents } = require('./invoiceOwed');

// A receipt's knock-off adds to what the party has paid off; a payment's to
// what we have - signed so one voucher can net an agent's invoice and bill.
const SIGN = { Recievable: 1, Payble: -1 };
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TOLERANCE = 0.005;

/** The voucher's money on the party: its party lines, credit less debit - a receipt positive, a payment negative. */
function partyAmount(heads) {
  return toCents((heads || [])
    .filter((h) => h.accountType === 'partyAccount')
    .reduce((t, h) => t + (h.type === 'credit' ? 1 : -1) * num(h.amount), 0));
}

/**
 * Check a settlement and work out what it changes.
 *
 * @param voucher    { voucher_Id, currency, amount } - amount from partyAmount
 * @param prior      Map invoiceId (string) -> this voucher's share before
 * @param requested  [{ id, receiving }] - the share wanted from this voucher;
 *                   0 takes the invoice off it
 * @param invoices   Map invoiceId (string) -> { invoice_No, payType, currency,
 *                   total, roundOff, recieved, paid, ownParty }
 * @returns { error } or { changes: [{ id, column, share, change }], applied, left }
 */
function planSettlement({ voucher, prior = new Map(), requested = [], invoices = new Map() }) {
  const currency = String(voucher?.currency || 'PKR').toUpperCase();
  const shares = new Map(prior);
  const changes = [];

  for (const r of requested) {
    const id = String(r?.id ?? '');
    const share = Number(r?.receiving);
    const inv = invoices.get(id);
    if (!inv) return { error: `Invoice ${id} was not found.` };
    if (!Number.isFinite(share) || share < 0) {
      return { error: `${inv.invoice_No}: the amount must be a number, zero or more.` };
    }
    if (!(inv.payType in SIGN)) return { error: `${inv.invoice_No} is not an invoice or a bill.` };
    if (!inv.ownParty) return { error: `${inv.invoice_No} is not this party's - it cannot be settled from ${voucher.voucher_Id}.` };
    if (String(inv.currency || 'PKR').toUpperCase() !== currency) {
      return { error: `${inv.invoice_No} is in ${inv.currency}; ${voucher.voucher_Id} is in ${currency}.` };
    }

    const before = num(prior.get(id));
    const change = toCents(toCents(share) - before);
    if (change > 0) {
      const owed = num(inv.total) + num(inv.roundOff);
      // Its knock-offs added up when the caller has them (Invoice_Transactions
      // - see the route); the running received / paid figure otherwise.
      const settled = inv.knockedOff !== undefined && inv.knockedOff !== null
        ? num(inv.knockedOff)
        : num(inv.payType === 'Recievable' ? inv.recieved : inv.paid);
      const over = toCents(settled + change - owed);
      if (over > TOLERANCE) {
        return { error: `${inv.invoice_No} would be settled ${money(over)} more than it is for.` };
      }
    }
    shares.set(id, toCents(share));
    if (change !== 0) {
      changes.push({ id, column: inv.payType === 'Recievable' ? 'recieved' : 'paid', share: toCents(share), change });
    }
  }

  // Everything this voucher settles once saved, signed: its earlier shares on
  // invoices not in the request, and the new ones. `invoices` holds both (the
  // caller loads every invoice either names); a share on an invoice that no
  // longer exists counts for nothing.
  let applied = 0;
  for (const [id, share] of shares) {
    const inv = invoices.get(id);
    if (inv && inv.payType in SIGN) applied += SIGN[inv.payType] * share;
  }
  applied = toCents(applied);

  const amount = num(voucher.amount);
  const sameWay = amount >= 0 ? applied >= -TOLERANCE : applied <= TOLERANCE;
  if (!sameWay) {
    return { error: `${voucher.voucher_Id} is a ${amount >= 0 ? 'receipt' : 'payment'}; what is ticked would settle the other way.` };
  }
  if (Math.abs(applied) - Math.abs(amount) > TOLERANCE) {
    return {
      error: `${voucher.voucher_Id} is ${money(amount)}; the invoices ticked come to ${money(applied)} - `
        + `${money(Math.abs(applied) - Math.abs(amount))} more than it has.`,
    };
  }
  return { changes, applied, left: toCents(amount - applied) };
}

module.exports = { partyAmount, planSettlement };

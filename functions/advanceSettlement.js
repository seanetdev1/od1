/**
 * SETTLING A PAYMENT OR RECEIPT on Payments & Receipts - the user's workflow
 * (2026-11-06): open the voucher, press Refresh for the party's unsettled
 * invoices, tick them, save.
 *
 * That save used to rebuild the voucher from the ticks, so ticking less than
 * an advance shrank the receipt - bank line and all - and ticking more grew
 * it. Now, once Refresh is pressed on an open voucher, the screen is SETTLING
 * it: the save sends only the ticks (POST /voucher/settleTransaction), the
 * voucher and its ledger lines do not change, the ticks may come to no more
 * than the voucher brought in, and what is not ticked stays as advance. The
 * server checks the same; this says it before the press.
 *
 * No React - unit tested.
 */
import { receiptTotals, entriesToSubmit, setAllocation } from './paymentReceiptSelection';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const toCents = (n) => (Math.round(num(n) * 100) / 100) || 0;
const money = (v) => Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Refresh was pressed on an open voucher. */
export const isSettling = (state) => Boolean(state?.edit && state?.editing);

/** The voucher's money on the party - its party lines, as posted. */
export const voucherAmountOf = (heads = []) => toCents(Math.abs((heads || [])
  .filter((h) => h?.accountType === 'partyAccount')
  .reduce((t, h) => t + (h.type === 'credit' ? 1 : -1) * num(h.amount), 0)));

/** What the ticks knock off against the voucher, and what stays on it as advance. */
export const settlementFigures = (state = {}, selection = {}) => {
  const { total } = receiptTotals(entriesToSubmit(selection), state.exRate);
  const amount = toCents(num(state.voucherAmount));
  const applied = toCents(Math.abs(total));
  return { amount, applied, left: toCents(amount - applied) };
};

/** Why the settlement cannot be saved - nothing when it can. */
export const settleProblems = (state = {}, selection = {}) => {
  const { amount, applied, left } = settlementFigures(state, selection);
  if (left < -0.005) {
    return [`The invoices ticked come to ${money(applied)} - ${money(-left)} more than this voucher's ${money(amount)}`];
  }
  return [];
};

/**
 * How much of `wanted` an invoice can take from the voucher being settled,
 * once every other invoice in the selection has its share - never more than
 * the voucher has left. A bill on a receipt (or an invoice on a payment) nets
 * the other way, so it can take as far as the other side of zero.
 */
export const roomFor = (state = {}, selection = {}, invoice, wanted) => {
  const others = { ...selection };
  delete others[String(invoice?.id)];
  const { total } = receiptTotals(entriesToSubmit(others), state.exRate);
  const amount = toCents(num(state.voucherAmount));
  const sign = invoice?.payType === 'Payble' ? -1 : 1;
  const want = toCents(num(wanted));
  if (Math.abs(total + sign * want) <= amount + 0.005) return want;
  const room = sign * total >= 0 ? amount - Math.abs(total) : Math.abs(total) + amount;
  return toCents(Math.max(0, Math.min(want, room)));
};

/**
 * SETTLING CANNOT GO OVER (the user, 2026-11-06: "why doesn't it just stop
 * the user from going over?"). Every invoice whose share a change raised -
 * a tick, a typed amount, select-all - takes no more than the voucher still
 * has, in the order they come (oldest first on the list): the one that
 * reaches the end takes what is left, any after it nothing. Not settling,
 * the selection is as given.
 *
 * @returns { selection, capped } - capped when something got less than asked
 */
export const capToVoucher = (state = {}, prev = {}, next = {}) => {
  if (!isSettling(state)) return { selection: next, capped: false };
  const raised = Object.keys(next).filter((k) => num(next[k]?.receiving) > num(prev[k]?.receiving) + 0.005);
  if (!raised.length) return { selection: next, capped: false };
  // The raises taken back out, then put in one at a time.
  let sel = { ...next };
  for (const k of raised) {
    if (prev[k]) sel[k] = prev[k];
    else delete sel[k];
  }
  let capped = false;
  for (const k of raised) {
    const wanted = num(next[k].receiving);
    const fit = Math.max(roomFor(state, sel, next[k], wanted), num(prev[k]?.receiving));
    if (fit < wanted - 0.005) capped = true;
    sel = setAllocation(sel, next[k], fit);
  }
  return { selection: sel, capped };
};

/** What the save sends: every invoice in the selection, at its share from this voucher (0 takes it off). */
export const settlementPayload = (state = {}, selection = {}, employeeId) => ({
  voucherId: state.voucherId,
  employeeId,
  invoices: entriesToSubmit(selection).map((e) => ({ id: e.id, receiving: toCents(num(e.receiving)) })),
});

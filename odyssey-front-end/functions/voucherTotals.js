/**
 * The Debit / Credit totals under the Voucher screen's lines.
 *
 * They were recalculated only when the settlement line changed - which the
 * amount box does on every keystroke, and nothing else does. Taking a line
 * out, or switching a JV line between debit and credit, left the totals as
 * they were. Worked out here from the lines themselves, so the screen can
 * recalculate whenever any of them changes.
 */

/** A payment or receipt carries a settlement line (bank / cash); JV and TV do not. */
export const hasSettlementLine = (vType) => vType !== 'JV' && vType !== 'TV';

const amountOf = (line) => {
  const n = parseFloat(line?.amount);
  return Number.isFinite(n) ? n : 0;
};

/** What the lines add up to, whichever side each is on. */
export function linesTotal(lines = []) {
  return lines.reduce((sum, line) => sum + amountOf(line), 0);
}

/** A receipt (BRV / CRV): its bank or cash line is the debit. */
export const isReceipt = (vType) => vType === 'BRV' || vType === 'CRV';

/** The side a new line starts on: credit on a receipt, debit otherwise. */
export const defaultLineSide = (vType) => (isReceipt(vType) ? 'credit' : 'debit');

/**
 * The settlement (bank / cash) line's amount on a payment or receipt: what
 * the lines come to NET, not added up regardless of side.
 *
 * A payment's lines need not all be debits. Salary of 100,000 paid with a
 * 20,000 loan instalment held back is salary Dr 100,000, loan Cr 20,000 - and
 * the bank pays out the difference, Cr 80,000. The lines used to be locked to
 * one side and simply added up, so that voucher could not be entered at all.
 * A receipt is the mirror: customer Cr 100,000, bank charges Dr 500, bank
 * Dr 99,500.
 *
 * Positive when the lines come out on the voucher's own side (a payment's net
 * debit, a receipt's net credit); zero or less means there is nothing for the
 * bank or cash to pay or receive - see save, which refuses it.
 */
export function settlementAmount(lines = [], vType) {
  const net = lines.reduce((sum, line) => {
    if (line?.type === 'debit') return sum + amountOf(line);
    if (line?.type === 'credit') return sum - amountOf(line);
    return sum;
  }, 0);
  const amount = isReceipt(vType) ? -net : net;
  return Math.round(amount * 100) / 100;
}

/** Debit and credit totals, the settlement line included where the voucher has one. */
export function voucherTotals(lines = [], settlementLine, vType) {
  const all = hasSettlementLine(vType) && settlementLine ? [...lines, settlementLine] : lines;
  return all.reduce((t, line) => (
    line?.type === 'debit'
      ? { ...t, debit: t.debit + amountOf(line) }
      : { ...t, credit: t.credit + amountOf(line) }
  ), { debit: 0, credit: 0 });
}

/**
 * The Voucher screen's Debit / Credit / Net Amount, laid out as Climax shows
 * them (the user's request, 2026-10-26): the lines ENTERED, without the bank
 * or cash line a payment or receipt adds itself - a payment of 32,574.83 reads
 * Debit 32,574.83, Credit 0.00, Net Amount 32,574.83.
 *
 * Net Amount reads the way the voucher does: what a payment pays out (debit -
 * credit), what a receipt receives (credit - debit), and on a journal or
 * transfer what it is out by (debit - credit, 0 when it balances). `off`: a
 * figure the save would refuse - a journal that does not balance, a payment
 * or receipt on the wrong side.
 */
export function voucherSummary(lines = [], vType) {
  const sums = lines.reduce((t, line) => (
    line?.type === 'debit' ? { ...t, debit: t.debit + amountOf(line) }
      : line?.type === 'credit' ? { ...t, credit: t.credit + amountOf(line) } : t
  ), { debit: 0, credit: 0 });
  const round = (n) => Math.round(n * 100) / 100;
  const debit = round(sums.debit);
  const credit = round(sums.credit);
  const net = round(isReceipt(vType) ? credit - debit : debit - credit);
  const off = hasSettlementLine(vType) ? (net <= 0 && (debit > 0 || credit > 0)) : net !== 0;
  return { debit, credit, net, off };
}

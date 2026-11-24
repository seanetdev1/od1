/**
 * SALES TAX ON ITS OWN ACCOUNT, when an invoice is approved.
 *
 * Approval posts the party against the invoice total and, on the other side,
 * the whole total to the job's income (or expense) account - tax included. A
 * SERVICES CHARGES line of 2,500 at 15% put 2,875 into income, where the 375 is
 * not the agency's money at all: it is owed to the tax authority (or, on a
 * bill, reclaimable from it). Configuration > Ledger Accounts > Sales tax now
 * names an account for each side, and the tax goes there: income 2,500, tax
 * 375 (the user's request, 2026-10-17).
 *
 * NOTHING CHANGES UNTIL AN ACCOUNT IS SET. Unset, the caller finds no tax
 * account and posts exactly as before.
 *
 * ONLY THE TAX THAT IS IN THE TOTAL. The voucher's party line is the invoice
 * total, built from each line's net amount - so the tax that can come off the
 * income line is the tax that net amount actually carries, and the three job
 * screens do not store it alike:
 *
 *   customs   tax_amount is the LINE's tax, on top of qty x (rate - discount).
 *             A MIGRATED line's net was imported WITHOUT its tax (2,500, with
 *             375 beside it) - its tax is not in the total, so there is none
 *             to move. Worked out as what the net carries above its base.
 *   freight   tax_amount is PER UNIT: net = (amount x rate - discount + tax)
 *             x qty. Checked against the net either way round, because a line
 *             that matches neither is one this cannot read - and that leaves
 *             its tax in income rather than guessing.
 *   aviation  tax_amount is the line's tax, inside its net.
 *
 * Kept free of model imports so the arithmetic can be tested on its own.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const CENT = 0.01;

const isTaxed = (c) =>
  c?.tax_apply === true || c?.tax_apply === 'true' || c?.tax_apply === 1 || c?.tax_apply === '1';

/** The tax inside one charge line's net amount, in the line's own currency. */
function lineTaxIn(c) {
  if (!isTaxed(c)) return 0;
  const net = num(c.net_amount);
  const tax = num(c.tax_amount);
  if (net <= 0 || tax <= 0) return 0;

  if (c.CustomsJobId) {
    // The customs formula - see functions/customsCharge chargeValues.
    const qty = c.qty === null || c.qty === undefined || c.qty === '' ? 1 : num(c.qty);
    const base = (num(c.rate_charge) - num(c.discount)) * qty;
    return Math.min(tax, Math.max(0, net - base));
  }

  if (c.AviationConsignmentId) return Math.min(tax, net);

  // Freight: per unit, as the freight sheet works it out.
  const qty = num(c.qty) || 1;
  const unit = num(c.amount) * num(c.rate_charge) - num(c.discount);
  if (Math.abs((unit + tax) * qty - net) < CENT) return Math.min(tax * qty, net);
  if (Math.abs(unit * qty + tax - net) < CENT) return Math.min(tax, net);
  return 0;
}

/**
 * The tax to post to the tax account, on the same footing as the invoice's
 * own total: in its currency (`amount`) and in rupees (`defaultAmount`).
 *
 * An invoice can carry both sides - an agent's, netted - and its total is the
 * one side less the other. The tax nets the same way: a line on the invoice's
 * own side adds, a line on the other side takes away, and a net figure that
 * comes out at nothing or less moves nothing.
 *
 * @param charges  the invoice's Charge_Head rows (plain)
 * @param payType  'Recievable' or 'Payble' - the side the invoice posts as
 * @param inPkr    true when the invoice total is summed from local amounts
 */
function invoiceTax({ charges = [], payType, inPkr }) {
  let amount = 0;
  let defaultAmount = 0;
  for (const c of charges || []) {
    const taxIn = lineTaxIn(c);
    if (!taxIn) continue;
    const net = num(c.net_amount);
    // The line's own conversion, as its local amount records it.
    const rate = net ? num(c.local_amount) / net : (num(c.ex_rate) || 1);
    const local = taxIn * rate;
    const sign = (c.type === 'Recievable') === (payType === 'Recievable') ? 1 : -1;
    amount += sign * (inPkr ? local : taxIn);
    defaultAmount += sign * local;
  }
  return {
    amount: Math.max(0, round2(amount)),
    defaultAmount: Math.max(0, round2(defaultAmount)),
  };
}

/**
 * The contra side of the voucher, split: what goes to the job's account, what
 * to the tax account, what to disbursements.
 *
 * Tax comes off first, then the reimbursable share - neither may take the
 * whole of it: a split that would leave the job's own line at nothing is not
 * made, as the disbursement split already refused (an unbalanced or zero line
 * is worse than an unsplit one). With no tax this is the disbursement split
 * exactly as it was, down to a missing `defaultAmount` - one round-off branch
 * passes none - counting as nothing.
 *
 * @returns [{ to: 'main' | 'tax' | 'disbursement', amount, defaultAmount }]
 */
function splitContra({ amount, defaultAmount, tax = {}, reimbursable = {} }) {
  let main = num(amount);
  let mainDefault = num(defaultAmount);
  const parts = [];

  const take = (to, part) => {
    const a = Math.min(num(part.amount), main);
    if (a <= 0 || main - a <= 0) return;
    const d = Math.min(num(part.defaultAmount), mainDefault);
    parts.push({ to, amount: round2(a), defaultAmount: round2(d) });
    main -= a;
    mainDefault -= d;
  };
  take('tax', tax);
  take('disbursement', reimbursable);

  // Nothing split: the line exactly as it was handed in.
  if (!parts.length) return [{ to: 'main', amount, defaultAmount }];
  return [{ to: 'main', amount: round2(main), defaultAmount: round2(mainDefault) }, ...parts];
}

module.exports = { lineTaxIn, invoiceTax, splitContra, isTaxed };

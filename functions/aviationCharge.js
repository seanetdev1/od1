/**
 * Pricing for an aviation charge.
 *
 * Lives here rather than inside the route so it can be tested without a
 * database - the arithmetic is the part worth checking, and standing up
 * Sequelize to do it would mean it never got checked.
 *
 * The frontend mirrors these rules in functions/aviationPricing.js so the
 * screen can show a figure before it is saved. THIS is what actually gets
 * stored; if the two ever disagree, this one is right.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Build a Charge_Head row for an aviation charge.
 *
 * Aviation charges ARE Charge_Heads - the same table the freight side uses -
 * so they are invoiced, posted and printed by exactly the same code. The field
 * names below are Charge_Head's, and the arithmetic is the freight one:
 *
 *   net_amount = (amount x rate_charge - discount) x qty + tax
 *
 * With `amount` fixed at 1 that reduces to qty x (rate - discount), which is
 * the aviation rule: chargeable weight x (rate - adhoc). So:
 *
 *   qty          = chargeable weight  (Per Unit) | how many   (Per Shipment)
 *   rate_charge  = rate               (Per Unit) | fee each   (Per Shipment)
 *   discount     = adhoc              (Per Unit) | 0          (Per Shipment)
 *
 * PER SHIPMENT IS A FEE TIMES A COUNT, not a single flat figure. The same
 * handling charge is raised once per shipment, per pallet, per document - so
 * the fee is typed and the number of them is counted beside it. A row that
 * predates the count carries qty 1, which is exactly what it meant, so it
 * prices unchanged.
 *
 * TAX rides on top of that base, at the percentage the charge was registered
 * with in Setup > Charges. It is folded INTO net_amount rather than left
 * beside it: an invoice's total is the sum of its charges' net amounts (see
 * makeInvoice, and approveInvoice which recomputes it), so tax left out of
 * net_amount would be printed on the line and missing from the document.
 * tax_amount keeps the tax on its own for printing.
 *
 * `type` is 'Recievable'/'Payble' - the app's own spelling. makeInvoiceNew and
 * the ledger branch on those exact strings, so using the correct spelling here
 * would silently misclassify every aviation invoice.
 */
const CH_RECEIVABLE = 'Recievable';
const CH_PAYABLE = 'Payble';

/**
 * The exchange rate an AWB converts one side of its ledger at.
 *
 * ONE PER SIDE: the space was bought and sold on different days, and sometimes
 * in different currencies, so a single conversion moved the reported margin by
 * the difference between the two rates.
 *
 * `exRate` is the LEGACY single field and is read only as a fallback, which is
 * what keeps every consignment entered before the split pricing exactly as it
 * did. Mirrored by exRateFor in the frontend's functions/aviationPricing.
 *
 * `|| 1`: a zero exchange rate would silently zero the charge out of the
 * books, and is never what anyone means by it.
 */
const exRateFor = (line, type) => num(
  (type === CH_PAYABLE ? line?.buyingExRate : line?.sellingExRate) ?? line?.exRate
) || 1;

const chargeValues = (c, i, consignmentId, line) => {
  const type = c.type === CH_PAYABLE ? CH_PAYABLE : CH_RECEIVABLE;
  const defaultRate = type === CH_PAYABLE ? line?.buyingRate : line?.sellingRate;

  // Per Shipment is a FEE, not a per-kg rate, so it has NO fallback to the
  // AWB's: the AWB is priced at 1.70 a kilo and that says nothing about what
  // one document costs. Clearing the fee therefore means nought, which is what
  // it looks like on the screen.
  //
  // Per Unit uses `??` not `||`: an explicit 0 is a legitimate rate (a waived
  // charge) and must not fall through to the AWB's.
  const perShipment = c.basis === 'Per Shipment';
  const rate = perShipment ? (c.rate_charge ?? 0) : (c.rate_charge ?? defaultRate ?? 0);
  const discount = c.discount ?? 0;
  const exRate = num(c.ex_rate ?? exRateFor(line, type)) || 1;

  // Adhoc discounts a per-kg rate, so it plays no part in a flat fee.
  //
  // A Per Shipment row with no count at all is ONE - that is what every row
  // stored before the count existed meant, and it is what someone who types a
  // fee and nothing else means too. `== null` and not `||`, so a typed 0 is
  // honoured as nothing rather than quietly billed as one.
  const qty = perShipment ? (c.qty == null ? 1 : num(c.qty)) : num(c.qty);
  const rateUsed = num(rate);
  const discountUsed = perShipment ? 0 : num(discount);
  const baseAmount = (1 * rateUsed - discountUsed) * qty;

  /* ------------------------------ tax --------------------------------
   * Applied at the rate the charge was REGISTERED with (Setup > Charges,
   * taxApply/taxPerc) and carried onto the row, where it can still be turned
   * off or adjusted for the one shipment that is exempt.
   *
   * The percentage is only read when the toggle is on, so a charge switched
   * off keeps the figure it was set up with rather than losing it, and cannot
   * be taxed by a percentage nobody can see.
   * ------------------------------------------------------------------ */
  const taxApply = Boolean(c.tax_apply);
  const taxPerc = taxApply ? num(c.taxPerc) : 0;
  const taxAmount = (baseAmount * taxPerc) / 100;
  const netAmount = baseAmount + taxAmount;

  const approved = String(c.status) === '1';
  return {
    // What it is
    charge:        c.charge ?? null,          // Charges.id
    particular:    c.particular || null,      // charge name, for printing
    description:   c.description || null,
    type,
    basis:         perShipment ? 'Per Shipment' : 'Per Unit',
    partyId:       c.partyId || null,
    name:          c.name || null,            // party name, for printing
    partyType:     c.partyType || null,

    // What it costs
    amount:        '1',                       // see the formula above
    qty:           String(qty),
    rate_charge:   String(rateUsed),
    discount:      String(discountUsed),
    currency:      c.currency || null,
    ex_rate:       String(exRate),
    net_amount:    String(netAmount),
    local_amount:  String(netAmount * exRate),

    // Tax. Numbers rather than nulls throughout, because the printing and
    // ledger code reads these without guarding. taxPerc is stored as 0 when
    // the toggle is off, so nothing downstream can apply a percentage that is
    // not being charged.
    tax_apply:     taxApply,
    taxPerc:       String(taxPerc),
    tax_amount:    String(taxAmount),

    // Approval
    status:        approved ? '1' : '0',
    approved_by:   approved ? (c.approved_by || null) : null,
    approval_date: approved ? (c.approval_date || null) : null,

    // An aviation charge hangs off the AWB, never off an SE_Job.
    AviationConsignmentId: consignmentId,
    SEJobId:       null,
  };
};

/* The rule moved to functions/invoiceLock so customs could enforce the same
 * one. Re-exported here because this module is what the aviation route and its
 * tests import, and because a rule about what may be rewritten in the ledger
 * must not exist twice. */
const { isInvoiceLocked } = require('./invoiceLock');

// A charge is worth keeping if it names a charge, a party, a description or
// anything that prices it. net_amount is NOT tested: it is derived, so a row
// with only a weight typed in would otherwise be discarded on save.
const isRealCharge = (c) =>
  c && (c.charge || c.partyId || c.description ||
        c.qty != null || c.rate_charge != null || c.discount != null);

/**
 * A Charges row as the flight screen needs it.
 *
 * THIS IS A CONTRACT, and it is the reason this projection lives in a tested
 * module rather than inline in the route. /getValues does not send the charge
 * master through untouched - it reshapes it - so a field added to the query
 * and not added HERE is selected from the database, thrown away, and arrives
 * in the browser as `undefined`. The screen then reads it, gets nothing, and
 * silently does nothing: no error, no empty box, just a feature that does not
 * happen. That is exactly how the tax toggle and the fixed amount shipped in
 * 1.2.1 without working.
 *
 * `name` is the CHARGE'S OWN NAME, because that is what an invoice prints as
 * the line - Charge_Head.particular is set from it. `label` is how the
 * dropdown reads, "(code) short", which is how the freight charge screens
 * label a charge and how the office recognises one. They were one field until
 * 1.2.2, which is why aviation invoices raised before then print "(2) AF"
 * where the charge name should be.
 *
 * Every field here is read by the frontend's functions/aviationChargeRow. If
 * you add one, add it to the test below it too.
 */
const chargeOption = (x) => ({
  id: x.id,
  code: x.code ?? null,
  // The charge's own name, and its abbreviation.
  name: x.name ?? null,
  short: x.short ?? null,
  // How the dropdown labels it.
  label: `(${x.code}) ${x.short}`,
  // `?? null` throughout, never a bare pass-through: undefined disappears from
  // JSON entirely, so the screen cannot tell "not configured" from "the server
  // forgot to send it" - which is the whole failure this shape exists to stop.
  currency: x.currency ?? null,
  // Per Unit / Per Shipment - seeds the row's basis.
  calculationType: x.calculationType ?? null,
  // Which party on the AWB the charge falls to. BOTH OPTIONAL since 1.2.2 - a
  // charge that lands on a different party every time names neither.
  defaultRecivableParty: x.defaultRecivableParty ?? null,
  defaultPaybleParty: x.defaultPaybleParty ?? null,
  // Tax, as it was registered. 'Yes'/'No' STRINGS, not booleans.
  taxApply: x.taxApply ?? null,
  taxPerc: x.taxPerc ?? null,
  // The standing amount the charge is raised at.
  fixAmount: x.fixAmount ?? null,
});

module.exports = {
  chargeValues, isRealCharge, exRateFor, isInvoiceLocked, chargeOption,
  CH_RECEIVABLE, CH_PAYABLE, num,
};

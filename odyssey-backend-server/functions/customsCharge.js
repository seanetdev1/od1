/**
 * Pricing for a customs charge.
 *
 * Lives here rather than inside the route so it can be tested without a
 * database - the arithmetic is the part worth checking, and standing up
 * Sequelize to do it would mean it never got checked.
 *
 * The frontend mirrors these rules in functions/customsPricing.js so the
 * screen can show a figure before it is saved. THIS is what actually gets
 * stored; if the two ever disagree, this one is right.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Type values are the app's own misspellings. makeInvoiceNew and the ledger
// branch on these exact strings, so "correcting" them here would silently
// misclassify every customs invoice.
const CH_RECEIVABLE = 'Recievable';
const CH_PAYABLE = 'Payble';

/**
 * Build a Charge_Head row for a customs charge.
 *
 * Customs charges ARE Charge_Heads - the same table the freight and aviation
 * sides use - so they are invoiced, posted and printed by exactly the same
 * code. The field names below are Charge_Head's, and the arithmetic is the
 * freight one:
 *
 *   net_amount = (amount x rate_charge - discount) x qty
 *
 * With `amount` fixed at 1 that reduces to qty x (rate - discount), and that
 * is now the formula on BOTH bases:
 *
 *   qty          = the count being charged for; UNSET MEANS ONE
 *   rate_charge  = the rate per unit, or the flat fee when the qty is one
 *   discount     = a per-unit reduction
 *
 * Per Shipment used to force the quantity to 1 and take the flat fee off
 * net_amount instead. That special case is gone: the quantity is enterable on
 * a flat fee now, and a quantity the server quietly rewrote to 1 would be a
 * box that discards what is typed into it. Per Shipment is still the default
 * and still what most clearance work is billed as - it now decides only what
 * the screen SEEDS the quantity with, not how the line is priced.
 *
 * Every Per Shipment row already on the live database satisfies
 * qty x rate = net, so nothing stored is revalued by this.
 *
 * SALES TAX ON THE LINE - the freight sheet's system: a charge ticked for tax
 * in Setup > Charges brings its percentage, and the line carries
 *
 *   tax_amount = qty x (rate - discount) x taxPerc / 100
 *   net_amount = qty x (rate - discount) + tax_amount
 *
 * so the invoice total, which is the sum of local amounts, includes the tax -
 * as it does on freight. Unlike freight, tax_amount is the LINE's tax rather
 * than per unit: it is what the Sale Tax Invoice prints, line by line.
 *
 * This is tax on the AGENT'S FEE (sales tax on services). The duty and sales
 * tax on the consignment are assessed on the GD, live on Customs_Job, and
 * reach an invoice as an ordinary reimbursement charge line.
 *
 * UNLIKE AVIATION there is no rate to fall back to on the parent. A flight
 * prices every charge on an AWB off that AWB's buying/selling rate; a GD has
 * no such thing, because a clearance file is a list of unrelated fees rather
 * than one commodity sold twice. An unpriced charge is therefore 0 here, and
 * that is correct: nothing else on the job could have supplied the figure.
 */
/**
 * The line's sales tax.
 *
 * A MIGRATED line knows its tax AMOUNT but not its rate: the legacy system
 * kept the percentage in a side table the charge-line import never read, so it
 * arrived as 0 - on CargoLinkers every SERVICES CHARGES line is 15% with
 * taxPerc 0. Taken at face value, re-saving such a job would recompute its tax
 * as zero and quietly take the sales tax off the file. So where the line is
 * taxed, carries an amount and has no rate, the rate is read back out of the
 * amount; from then on it is an ordinary line.
 */
const lineTax = (c, taxable) => {
  const taxApply = c.tax_apply === true || c.tax_apply === 'true' || c.tax_apply === 1 || c.tax_apply === '1';
  if (!taxApply) return { taxApply: false, taxPerc: 0, taxAmount: 0 };
  let taxPerc = num(c.taxPerc);
  if (!taxPerc && num(c.tax_amount) && taxable) {
    taxPerc = Math.round((num(c.tax_amount) / taxable) * 100 * 10000) / 10000;
  }
  return { taxApply: true, taxPerc, taxAmount: (taxable * taxPerc) / 100 };
};

const chargeValues = (c, i, jobId, job) => {
  const type = c.type === CH_PAYABLE ? CH_PAYABLE : CH_RECEIVABLE;

  // `|| 1`: a zero exchange rate would silently zero the charge out of the
  // books, and is never what anyone means by it. Falls back to the job's own
  // rate so a charge typed in the job's currency needs nothing said about it.
  const exRate = num(c.ex_rate ?? job?.exRate) || 1;

  const perShipment = c.basis !== 'Per Unit';
  // UNSET MEANS ONE - the same rule as qtyOf on the screen, and what lets the
  // formula below carry a flat fee with no special case.
  const qty = (c.qty === null || c.qty === undefined || c.qty === '') ? 1 : num(c.qty);
  const rateUsed = num(c.rate_charge);
  const discountUsed = num(c.discount);
  const taxable = (1 * rateUsed - discountUsed) * qty;
  const { taxApply, taxPerc, taxAmount } = lineTax(c, taxable);
  const netAmount = taxable + taxAmount;

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

    // Sales tax on the line - see lineTax. Numbers even when off, so the
    // printing and ledger code that reads these never meets a null.
    tax_apply:     taxApply,
    taxPerc:       String(taxPerc),
    tax_amount:    String(taxAmount),

    // Approval
    status:        approved ? '1' : '0',
    approved_by:   approved ? (c.approved_by || null) : null,
    approval_date: approved ? (c.approval_date || null) : null,

    // A customs charge hangs off the GD, never off an SE_Job.
    CustomsJobId:  jobId,
    SEJobId:       null,
  };
};

// A charge is worth keeping if it names a charge, a party, a description or
// anything that prices it. net_amount IS tested here, unlike aviation: a Per
// Shipment charge is nothing BUT its net amount, so a row carrying only a
// typed figure would otherwise be discarded on save.
const isRealCharge = (c) =>
  c && (c.charge || c.partyId || c.description ||
        c.qty != null || c.rate_charge != null || c.discount != null ||
        c.net_amount != null);

/* RECEIVABLES ARE APPROVED ONLY ONCE THE JOB IS ON VESSEL OR DRAYOFF.
 *
 * CargoLinkers bill a client when the goods are on the vessel - or, for a
 * file that ends at the container drop, at DrayOff - and approving a
 * receivable is what makes it billable, so a receivable cannot be approved
 * while the job is at any other stage. 'Complete' is the stored status the
 * screen shows as "On Vessel" (functions/customsStatus on the frontend).
 *
 * Only a NEWLY approved receivable is refused: one approved before this rule
 * existed, or before the job's status changed, stays as it is, so saving an
 * older job is never blocked by approvals nobody is making now. Payables are
 * not affected; neither is a charge already on an invoice.
 *
 * @param sent           the charges the screen is saving
 * @param approvedBefore ids of this job's charges approved in the database
 * @returns the receivables this save would newly approve
 */
const ON_VESSEL = 'Complete';
const DRAY_OFF = 'DrayOff';
const BILLABLE_STATUSES = [ON_VESSEL, DRAY_OFF];
const isBillableStatus = (status) => BILLABLE_STATUSES.includes(status);
const newlyApprovedReceivables = (sent, approvedBefore = new Set()) =>
  (Array.isArray(sent) ? sent : []).filter((c) =>
    isRealCharge(c)
    && c.type !== CH_PAYABLE
    && String(c.status) === '1'
    && !c.InvoiceId
    && !approvedBefore.has(String(c.id ?? '')));

module.exports = {
  chargeValues, lineTax, isRealCharge, CH_RECEIVABLE, CH_PAYABLE, num,
  ON_VESSEL, DRAY_OFF, BILLABLE_STATUSES, isBillableStatus, newlyApprovedReceivables,
};

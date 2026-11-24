// Pricing for a customs charge, as the screen shows it.
//
// Extracted from the Charges grid so it can be tested on its own. It MIRRORS
// functions/customsCharge.js on the backend, which is what actually gets
// stored - if the two ever disagree, the backend is right and this is the bug.
// That is also why the tests here check the same cases the backend's do.
//
//   taxable      = qty x (rate - discount)   - on BOTH bases
//   tax amount   = taxable x tax % / 100      - when the line is taxed
//   net amount   = taxable + tax amount
//   local amount = net amount x ex-rate
//
// Field names are Charge_Head's, because a customs charge IS a Charge_Head.

// Charge_Head.charge is a string column over an integer master - see the file
// for why that has to be reconciled whenever two of them are compared.
import { asId } from 'functions/chargeIds';

// Type values are the app's own misspellings. makeInvoiceNew and the ledger
// branch on these exact strings, so "correcting" them would silently
// misclassify every customs invoice.
export const RECEIVABLE = 'Recievable';
export const PAYABLE = 'Payble';

export const PER_UNIT = 'Per Unit';
export const PER_SHIPMENT = 'Per Shipment';

export const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Per Shipment is still the DEFAULT, unlike aviation where Per Unit is: most
// clearance work is a flat fee for the file - an agency fee, a documentation
// charge, a duty reimbursement.
//
// It no longer changes the ARITHMETIC, only what the quantity is seeded with
// (one, against the declaration's piece count) - see computeNetAmount.
export const isPerShipment = (c) => c?.basis !== PER_UNIT;

/**
 * How many units a line is for.
 *
 * UNSET MEANS ONE, which is what makes the quantity safe to leave alone on a
 * flat fee: a charge nobody has given a quantity is one of whatever it is, so
 * the arithmetic needs no special case for the basis. An explicit zero is
 * still zero - somebody typed it.
 */
export const qtyOf = (c) => {
  const raw = c?.qty;
  return (raw === null || raw === undefined || raw === '') ? 1 : num(raw);
};
export const isInvoiced = (c) => Boolean(c?.InvoiceId);
export const isApproved = (c) => String(c?.status) === '1';

/**
 * Is this charge FROZEN by the invoice it sits on?
 *
 * BEING ON AN INVOICE IS NOT THE SAME AS BEING FROZEN BY ONE. An APPROVED
 * invoice has been posted to the ledger and issued, so rewriting its charges
 * would change what an issued document says. Unapproving it destroys the
 * voucher and takes it back out of the books - at which point there is nothing
 * left for the figures to contradict, and correcting them is the whole reason
 * somebody unapproved it.
 *
 * The charge KEEPS its InvoiceId throughout, so it stays on that invoice and is
 * re-approved onto the same document rather than onto a new one; approval
 * recomputes the total from the charges, so the corrected figures are what get
 * posted.
 *
 * A charge whose Invoice could not be loaded is treated as FROZEN. Guessing
 * "unapproved" there would open an issued document for editing, and this
 * screen does not always carry the invoice row.
 *
 * The same rule aviation uses - see functions/aviationPricing. Mirrored by
 * isInvoiceLocked in the backend's functions/invoiceLock, which is what
 * actually refuses the write.
 */
export const isInvoiceLocked = (c) =>
  isInvoiced(c) && String(c?.Invoice?.approved ?? '1') === '1';

/**
 * ONE FORMULA, WHATEVER THE BASIS: qty x (rate - discount).
 *
 * Per Shipment used to be special - it returned the typed net_amount and
 * ignored the quantity, which is why the quantity box was greyed out on a flat
 * fee. That had to go the moment the quantity was opened up on those lines: an
 * editable box that changes nothing is a lie, and the invoice prints Qty and
 * Rate as adjacent columns, so a quantity of 3 beside a rate of 5,000 beside a
 * total of 5,000 reads to the client as an arithmetic error.
 *
 * SAFE ON EVERY ROW ALREADY STORED, which is not an assumption - it was
 * checked against the book. All 1,682 Per Shipment charges on the live
 * database already satisfy qty x rate = net, including the twelve carrying a
 * quantity of 2 to 4; none has a missing rate. The data was already kept on
 * this basis and only the screen disagreed.
 *
 * There is no rate to fall back to on the job, unlike an aviation AWB. A GD is
 * a list of unrelated fees rather than one commodity sold twice, so an
 * unpriced charge is 0 - nothing on the file could have supplied the figure.
 */
export const computeTaxableAmount = (c) =>
  qtyOf(c) * (num(c?.rate_charge) - num(c?.discount));

/** Is the line taxed? The box on the line, however it was stored. */
export const isTaxed = (c) =>
  c?.tax_apply === true || c?.tax_apply === 'true' || c?.tax_apply === 1 || c?.tax_apply === '1';

/**
 * The line's tax rate. A MIGRATED line knows its tax amount but arrived with
 * a 0% rate (the legacy percentage lived in a table the import did not read),
 * so the rate is read back out of the amount - exactly as lineTax does on the
 * server, which is what keeps a re-saved job's sales tax from zeroing.
 */
export const taxPercOf = (c) => {
  if (!isTaxed(c)) return 0;
  const perc = num(c?.taxPerc);
  if (perc) return perc;
  const taxable = computeTaxableAmount(c);
  return num(c?.tax_amount) && taxable
    ? Math.round((num(c.tax_amount) / taxable) * 100 * 10000) / 10000
    : 0;
};

/** The line's sales tax - the whole line's, not per unit. */
export const computeTaxAmount = (c) => (computeTaxableAmount(c) * taxPercOf(c)) / 100;

/** What the line comes to, tax included - as the server stores net_amount. */
export const computeNetAmount = (c) => computeTaxableAmount(c) + computeTaxAmount(c);

/**
 * Falls back to the JOB's ex-rate exactly as the backend does. Without that
 * fallback a charge with no ex-rate of its own would display net x 1 while the
 * server stored net x the job's rate - the same charge, two amounts.
 *
 * `|| 1` last: a zero anywhere in the chain means "same currency" rather than
 * wiping the charge out of the books.
 */
export const exRateOf = (c, job) => num(c?.ex_rate ?? job?.exRate) || 1;

export const computeLocalAmount = (c, job) => computeNetAmount(c) * exRateOf(c, job);

/**
 * What the job is worth, from its charge lines.
 *
 * In LOCAL currency throughout, because that is the only basis on which a
 * receivable in dollars and a payable in rupees can be subtracted from one
 * another. Invoiced and uninvoiced lines both count: the profit on a file does
 * not change because half of it has been billed.
 */
export const chargeTotals = (charges, job) => {
  const t = { receivable: 0, payable: 0, profit: 0 };
  for (const c of charges || []) {
    const local = computeLocalAmount(c, job);
    if (c?.type === PAYABLE) t.payable += local;
    else t.receivable += local;
  }
  t.profit = t.receivable - t.payable;
  return t;
};

/**
 * How many units a Per Unit charge is for, by default.
 *
 * PIECES, from the declaration's own Quantity (PCS). The freight charge sheet
 * seeds this from the chargeable WEIGHT, which is right for freight - an air
 * or sea rate is per kilo - and wrong for clearance work, where the per-unit
 * charges are per package, per case, per carton. Seeding from a weight prices
 * a hundred cartons as though they were 1,240 of something.
 *
 * Falls back to 1 rather than 0: a GD with no piece count yet is a file
 * somebody is still filling in, and a charge priced at zero units reads as a
 * charge worth nothing.
 */
export const perUnitQty = (job) => {
  const pcs = num(job?.packages);
  return pcs > 0 ? pcs : 1;
};

/**
 * Two charge lines are "the same line" when they name the same charge and
 * carry the same description.
 *
 * The charge alone is not enough - a file can legitimately carry two
 * transport lines against different legs, told apart only by what is typed in
 * the description - and the description alone is not enough either, because
 * most of them are blank.
 *
 * Through asId, because Charge_Head.charge is a STRING column pointing at an
 * integer master: a row just picked on screen holds the number 12 and the same
 * row read back from the server holds "12". Keyed raw, those are two different
 * lines, and a copy would duplicate every charge that had been saved.
 */
export const chargeCopyKey = (c) =>
  `${asId(c?.charge) ?? ''}|${String(c?.description || '').trim()}`;

/**
 * The lines to add to one side of the charge sheet, copied from the other.
 *
 * A clearance file is billed out very nearly as it was bought in - the same
 * dozen heads - so each side is mostly a retyping of the other, and that
 * retyping is where a head gets missed. A missed payable is profit the file
 * appears to have made and has not.
 *
 * THE PARTY IS NOT COPIED. It is re-derived for the side being copied TO, via
 * the caller's `partyFor`: a receivable is billed to the client, while the
 * payable for the same head is owed to a vendor, and carrying the client
 * across would post it against the wrong account. This is the rule the whole
 * function exists to get right.
 *
 * Nor is anything that makes a line an ISSUED one - id, approval, invoice.
 * Every copy arrives new, unapproved and unbilled, because it has been neither
 * agreed nor issued. That is what `blank` supplies.
 *
 * Lines already present on the target side are skipped, so pressing the button
 * twice does nothing the second time.
 *
 * ONLY THE LINES THE USER TICKED. Copying a whole sheet is the wrong default
 * on a file where half the costs are not rebilled - a disbursement paid on the
 * client's behalf is not a sale - and un-copying afterwards is more work than
 * ticking four boxes. No ticks means nothing is copied, deliberately: an empty
 * selection is somebody who has not chosen yet, not somebody asking for
 * everything.
 *
 * @param charges     every line on the sheet, both sides
 * @param toType      the side being copied TO
 * @param blank       () => a new, empty charge of that type
 * @param partyFor    (chargeId, receivable) => a party patch, or {}
 * @param isSelected  (charge) => was this line ticked? Defaults to all of
 *                    them, so the rule lives with the caller that owns the
 *                    selection rather than being assumed here.
 */
export const copiesAcross = (charges, toType, { blank, partyFor, isSelected = () => true }) => {
  const all = charges || [];
  const receivable = toType === RECEIVABLE;
  const fromType = receivable ? PAYABLE : RECEIVABLE;
  const already = new Set(all.filter((c) => c?.type === toType).map(chargeCopyKey));
  return all
    .filter((c) => c?.type === fromType && isSelected(c) && !already.has(chargeCopyKey(c)))
    .map((c) => ({
      ...blank(),
      charge: c.charge ?? null,
      particular: c.particular || null,
      description: c.description || '',
      basis: c.basis,
      qty: c.qty,
      rate_charge: c.rate_charge,
      discount: c.discount,
      currency: c.currency,
      ex_rate: c.ex_rate,
      net_amount: c.net_amount,
      local_amount: c.local_amount,
      ...partyFor(c.charge, receivable),
    }));
};

/**
 * A DIRECT JOB line, in the shape of a charge on the sheet - so copiesAcross
 * can treat it as one more line on the side it was booked to.
 *
 * Money entered through Accounts > Direct Job E / R never becomes a charge
 * here; it shows only in the Summary. A cartage bill paid in cash that way is
 * still a cost the client is billed for, and retyping it onto the receivable
 * side is where it gets missed.
 *
 * An EXPENSE sits on the payable side and a REVENUE on the receivable side, so
 * "Copy from Payable" takes the ticked expenses and "Copy from Receivable" the
 * ticked revenues - the same two buttons the sheet's own lines use.
 *
 * PRICED TO THE SAME TOTAL. The line stores its total - rate x quantity less a
 * discount on the whole line - where the sheet works in qty x rate. So the
 * rate is the total per unit, discount already taken off. A quantity that
 * does not divide the total exactly - 1,000 over 3 - becomes one of the total,
 * rather than a copy a fraction of a rupee short.
 *
 * `directLineId` marks it for the caller's isSelected; copiesAcross carries
 * only the pricing fields, so the marker never reaches the copy.
 *
 * @param line  one of the summary's directLines (see directLineDetail on the
 *              server)
 */
export const directLineAsCharge = (line) => {
  const amount = num(line?.amount);
  let qty = num(line?.quantity) || 1;
  let rate = Math.round((amount / qty) * 10000) / 10000;
  if (Math.abs(rate * qty - amount) > 1e-6) { qty = 1; rate = amount; }
  const currency = String(line?.currency || '').trim().toUpperCase();
  const exRate = currency === 'PKR' ? 1 : (num(line?.exRate) || 1);
  return {
    type: line?.type === 'revenue' ? RECEIVABLE : PAYABLE,
    charge: line?.charge ?? null,
    particular: null,
    description: line?.description || '',
    // 'unit' / 'shipment' is the Direct Job screen's vocabulary.
    basis: /unit/i.test(String(line?.basis || '')) ? PER_UNIT : PER_SHIPMENT,
    qty,
    rate_charge: rate,
    discount: null,
    currency,
    ex_rate: exRate,
    net_amount: qty * rate,
    local_amount: qty * rate * exRate,
    directLineId: line?.id ?? null,
  };
};

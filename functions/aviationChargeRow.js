// Building a charge row on an aviation AWB.
//
// Three things live here, and they are one thing really: a charge row is
// either blank, or it has had a registered charge applied to it, and the Air
// Freight pair an approved AWB raises is exactly the second case done without
// anybody clicking.
//
// EXTRACTED FROM THE CHARGES GRID so the automatic rows and the hand-picked
// ones are built by the SAME code. Two constructions of "a charge row for this
// master on this AWB" would drift, and the drift would show up as an
// auto-generated charge priced differently from the identical one somebody
// added by hand - which nobody would think to check.

import {
  RECEIVABLE, PAYABLE, PER_UNIT, PER_SHIPMENT, num,
  rateFor, exRateFor, isInvoiced, isInvoiceLocked,
  computeNetAmount, computeLocalAmount, taxAmountOf,
} from './aviationPricing';
// Which party a charge's default TYPE resolves to on a given consignment.
import { PARTY_RESOLVERS, carrierPartyFor } from './aviationParty';
// Charge_Head.charge is a STRING column pointing at an integer master - see
// the file for why that has to be reconciled on read.
import { asId } from './chargeIds';

/**
 * A blank charge row.
 *
 * `party` pre-fills who the charge falls to. Passed in rather than left null
 * because a payable is almost always paid to the airline, and typing the same
 * party onto every payable row is the sort of repetition that eventually gets
 * one row wrong.
 */
export const blankCharge = (type, qty = null, rate = null, exRate = null, party = null) => ({
  type,
  charge: null,
  particular: '',
  partyId: party?.partyId ?? null,
  name: party?.name ?? '',
  partyType: party?.partyType ?? null,
  description: '',
  basis: PER_UNIT,
  qty: qty ?? null,
  rate_charge: rate ?? null,
  discount: null,
  // Off until a charge is picked that says otherwise.
  tax_apply: false,
  taxPerc: null,
  tax_amount: 0,
  net_amount: num(qty) * num(rate),
  currency: '',
  ex_rate: exRate ?? null,
  local_amount: num(qty) * num(rate) * (num(exRate) || 1),
  // Charges start unapproved and uninvoiced - both are deliberate acts.
  status: '0',
  approved_by: null,
  approval_date: null,
  InvoiceId: null,
});

/**
 * What picking a registered charge puts on a row.
 *
 * Everything Setup > Charges holds about it: the name an invoice prints, its
 * currency, how it is calculated, which party it falls to, whether it is taxed
 * and at what percentage, and its fixed amount if it has one. Every one is a
 * DEFAULT - the row stays editable, because the one shipment that is exempt or
 * priced differently is exactly the case a registered charge cannot express.
 *
 * Returns a PATCH rather than a whole row, so the grid can apply it through
 * the same setFields that recomputes the amounts and handles a change of
 * basis.
 *
 * @param master  the Charges row, or null/undefined when the charge is cleared
 * @param line    the consignment, for resolving the party
 * @param values  the screen's pick lists - needs `carrier` and `party`
 */
export const chargeMasterPatch = (master, line, values, receivable) => {
  const patch = {
    charge: master?.id ?? null,
    // particular is what an invoice prints as the line name.
    particular: master?.name || null,
  };
  if (!master) return patch;

  if (master.currency) patch.currency = master.currency;
  if (master.calculationType) patch.basis = master.calculationType;

  // The standing amount the charge is raised at (Setup > Charges, "Fixed
  // Charge Amount"). On a Per Shipment charge that is the fee; on a Per Unit
  // one it is the rate, which is why it OVERRIDES the AWB's - a charge
  // registered at a fixed figure is not priced per kilo of whatever it happens
  // to be attached to.
  //
  // Only when non-zero: nought is what every charge registered before the
  // field was filled in carries, and pushing that onto the row would waive it.
  const fixed = num(master.fixAmount);
  if (fixed) patch.rate_charge = fixed;

  // Stored in Setup as the STRING 'Yes'/'No', not a boolean.
  const taxed = String(master.taxApply || '').trim().toLowerCase() === 'yes';
  patch.tax_apply = taxed;
  patch.taxPerc = num(master.taxPerc) || null;

  // Which party this charge falls to, per Setup > Charges. BOTH ROLES ARE
  // OPTIONAL: a charge that lands on a different party every time names
  // neither, and an absent role resolves to no resolver, which fills in
  // nothing rather than filling in something wrong.
  const role = receivable ? master.defaultRecivableParty : master.defaultPaybleParty;
  const resolve = PARTY_RESOLVERS[role];
  if (resolve) {
    // values.carrier is only consulted for the Carrier role; the other three
    // read a field off the line.
    const partyId = resolve(line, values?.carrier);
    const party = (values?.party || []).find((p) => p.id === partyId);
    patch.partyId = partyId ?? null;
    patch.name = party?.name || null;
    patch.partyType = role;
  }
  return patch;
};

/* ------------------------- the Air Freight charge -------------------------
 * The one charge every AWB carries on both sides: what the airline is paid to
 * fly the cargo, and what the customer is billed to have it flown. It is the
 * reason the AWB exists, it is priced off figures the consignment already
 * holds - chargeable weight times the buying or selling rate - and it was
 * being typed twice onto every single AWB.
 *
 * So approving an AWB raises it automatically. RAISED ONCE, THEN REPRICED:
 * re-approving brings the existing rows back into line with the AWB rather
 * than raising a second pair, because once a row is on an invoice its id is
 * what ties it there. Un-approving removes them only while none has been
 * invoiced. See airFreightRows, repriceAirFreight and invoicedAirFreight.
 * ---------------------------------------------------------------------- */

/**
 * How the Air Freight charge is recognised in Setup > Charges.
 *
 * By SHORT NAME first - that is the abbreviation the office actually uses, and
 * it is what appears on the charge sheet - then by full name, so an install
 * that filled in "Air Freight" and left the short name as something else still
 * works. Matched case- and space-insensitively, because neither field is
 * validated for either.
 *
 * NOT a hardcoded id: the charge is set up per install, so there is no id to
 * hardcode. If it is not registered at all, approval says so rather than
 * quietly raising nothing.
 */
const AF_SHORT = 'af';
const AF_NAME = 'air freight';
const norm = (v) => String(v ?? '').trim().toLowerCase();

export const findAirFreight = (charges) => {
  const list = charges || [];
  return list.find((c) => norm(c.short) === AF_SHORT)
      || list.find((c) => norm(c.name) === AF_NAME)
      || null;
};

/** Is this row the Air Freight charge? `charge` arrives as a string - see asId. */
export const isAirFreightRow = (c, af) => Boolean(af) && asId(c?.charge) === af.id;

/**
 * The receivable/payable pair an approved AWB raises.
 *
 * Built exactly as picking Air Freight on a blank row would build it: the
 * AWB's chargeable weight as the quantity, its selling rate on the receivable
 * and its buying rate on the payable, each converted at its own side's
 * ex-rate. A payable starts against the carrier - the airline sold the space,
 * so it is who this is owed to in all but the exceptional case - and the
 * charge's own registered role overrides that if it names one.
 *
 * The rows are ORDINARY charge rows once created. Nothing marks them as
 * automatic and nothing stops them being edited: a rate negotiated for this
 * one shipment is normal, and a row that sprang back to the AWB's rate
 * whenever it was touched would be worse than one typed by hand.
 */
export const airFreightRows = (line, values) => {
  const af = findAirFreight(values?.charge);
  if (!af) return [];

  return [RECEIVABLE, PAYABLE].map((type) => {
    const receivable = type === RECEIVABLE;
    const row = {
      ...blankCharge(
        type,
        line?.chargeableWeight ?? null,
        rateFor(line, type),
        exRateFor(line, type),
        receivable ? null : carrierPartyFor(line, values?.carrier, values?.party)
      ),
      ...chargeMasterPatch(af, line, values, receivable),
    };
    row.net_amount = computeNetAmount(row, line);
    row.tax_amount = taxAmountOf(row, line);
    row.local_amount = computeLocalAmount(row, line);
    return row;
  });
};

/** The Air Freight rows on this AWB. */
export const airFreightOn = (charges, af) =>
  (charges || []).filter((c) => isAirFreightRow(c, af));

/**
 * The Air Freight rows that BELONG TO AN INVOICE - approved or not.
 *
 * AN AIR FREIGHT CHARGE IS NEVER DESTROYED ONCE IT HAS BEEN INVOICED, and that
 * is the whole rule. Its id is what ties it to the invoice: Charge_Head points
 * at the Invoice, so the invoice's lines ARE the charges carrying its id.
 * Delete the row and the invoice has nothing on it; raise a fresh one and that
 * one points nowhere. The document is left empty and the correction is
 * invisible.
 *
 * Worse in practice, because saveCharges only destroys rows with NO invoice
 * (`InvoiceId: null`). A row on an unapproved invoice dropped from the payload
 * is therefore neither deleted nor updated - it survives, untouched, at the
 * old figures - and re-approving adds a SECOND pair beside it. One AWB, two
 * Air Freight charges, and the invoice still holding the wrong one.
 *
 * So un-approving is refused whenever this is non-empty, and the correction is
 * made by REPRICING instead - see repriceAirFreight. UNAPPROVED counts as
 * invoiced here, deliberately: unapproving an invoice takes it out of the
 * books so its lines can be corrected, not so they can be deleted out from
 * under it.
 */
export const invoicedAirFreight = (charges, af) =>
  airFreightOn(charges, af).filter(isInvoiced);

/**
 * The charges with the Air Freight rows taken out.
 *
 * Only ever called when none of them is invoiced - see invoicedAirFreight.
 * Edited rows go too: a row somebody adjusted is still the Air Freight charge
 * on an AWB that is no longer approved.
 */
export const withoutAirFreight = (charges, af) =>
  (charges || []).filter((c) => !isAirFreightRow(c, af));

/**
 * The Air Freight rows brought back into line with the AWB.
 *
 * What re-approving does instead of raising a new pair. Each row keeps its id -
 * and so its place on whatever invoice it is on - and takes the AWB's current
 * rate and ex-rate for its side. saveCharges UPDATEs a row on an unapproved
 * invoice in place, and approveInvoice recomputes that invoice's total from
 * its charges, so the corrected figure reaches the books when the invoice is
 * approved again.
 *
 * A row frozen by an APPROVED invoice is left alone: that is an issued
 * document, and the server refuses to rewrite it anyway.
 */
export const repriceAirFreight = (charges, line, af) =>
  (charges || []).map((c) => {
    if (!isAirFreightRow(c, af) || isInvoiceLocked(c)) return c;
    const updated = {
      ...c,
      qty: line?.chargeableWeight ?? c.qty,
      rate_charge: rateFor(line, c.type),
      ex_rate: exRateFor(line, c.type),
    };
    updated.net_amount = computeNetAmount(updated, line);
    updated.tax_amount = taxAmountOf(updated, line);
    updated.local_amount = computeLocalAmount(updated, line);
    return updated;
  });

/** Already carrying an Air Freight charge, so approving would double it. */
export const hasAirFreight = (charges, af) => airFreightOn(charges, af).length > 0;

// Re-exported so the grid can report a billed row without importing the
// pricing module for one predicate.
export { isInvoiced };

/* ===========================================================================
 * THE AWB'S RATES, AND WHAT AN INVOICE FREEZES
 *
 * Both tabs edit the SAME four fields - the Consignments grid has them beside
 * the weights, the Charges tab has them above the charge rows - so both have
 * to do the same two things with them, and neither can be the only one that
 * knows the rule.
 * ======================================================================== */

/**
 * Which side of the ledger each AWB rate drives, and the Charge_Head column it
 * writes.
 *
 * The ex-rate is split per side because the space was bought and sold on
 * different days, and sometimes in different currencies - one figure for both
 * moved the reported margin by the difference between them. Nothing governs
 * both sides: an ex-rate that reached both was exactly the behaviour being
 * replaced.
 */
export const GOVERNS = {
  sellingRate:   { type: RECEIVABLE, field: 'rate_charge' },
  buyingRate:    { type: PAYABLE,    field: 'rate_charge' },
  sellingExRate: { type: RECEIVABLE, field: 'ex_rate' },
  buyingExRate:  { type: PAYABLE,    field: 'ex_rate' },
};

export const isAwbRateField = (field) => Object.hasOwn(GOVERNS, field);

/**
 * The charges repriced by a change to one of the AWB's rates.
 *
 * The rates on the AWB are DEFAULTS pushed down onto its charges: changing one
 * reprices every charge it governs, and individual rows can be adjusted after.
 * A rate that only took effect on charges added later would leave the AWB
 * saying one thing and its existing charges another.
 *
 * `line` must already carry the NEW value - the caller has applied it - because
 * the amounts are recomputed from the line, not from the field alone.
 *
 * THREE ROWS ARE LEFT ALONE:
 *
 *   the other side's        a selling rate has nothing to say about a payable.
 *   a frozen one            on an APPROVED invoice: an issued document, and
 *                           the server refuses to rewrite it anyway. A charge
 *                           on an UNAPPROVED invoice IS repriced - that is
 *                           what unapproving an invoice is for, and saveCharges
 *                           updates it in place, so it stays on its invoice and
 *                           is re-approved with the corrected figure.
 *   a Per Shipment fee      not a per-kg rate. Pushing 1.70 a kilo into a 750
 *                           handling fee would silently reprice it to 1.70.
 *                           Its EX-RATE still follows the AWB: that is a
 *                           conversion, and a flat fee converts like anything.
 */
export const repriceForAwb = (charges, line, field) => {
  const governs = GOVERNS[field];
  if (!governs) return charges || [];
  return (charges || []).map((c) => {
    if (isInvoiceLocked(c)) return c;
    if (c.type !== governs.type) return c;
    if (governs.field === 'rate_charge' && c.basis === PER_SHIPMENT) return c;
    const updated = { ...c, [governs.field]: line?.[field] };
    updated.net_amount = computeNetAmount(updated, line);
    updated.tax_amount = taxAmountOf(updated, line);
    updated.local_amount = computeLocalAmount(updated, line);
    return updated;
  });
};

/** Every charge on the AWB recomputed from it - after a weight change. */
export const repriceAll = (charges, line) =>
  (charges || []).map((c) => {
    if (isInvoiceLocked(c)) return c;
    const updated = { ...c };
    updated.net_amount = computeNetAmount(updated, line);
    updated.tax_amount = taxAmountOf(updated, line);
    updated.local_amount = computeLocalAmount(updated, line);
    return updated;
  });

/**
 * WHICH RATE CELLS AN INVOICE SHUTS - and only those.
 *
 * A receivable on an approved invoice freezes the SELLING pair, because those
 * are the figures it was computed from. It says nothing about what the airline
 * is paid, so the buying pair stays open - and the other way round.
 *
 * Before this, one invoiced charge on either side locked all four, so
 * correcting what a customer is billed meant unapproving the bill to the
 * airline as well: two documents disturbed to fix one. The two sides of an AWB
 * are separate deals and are invoiced separately, so they freeze separately.
 *
 * WEIGHTS AND PARTIES ARE NOT SPLIT and are locked by EITHER side - see
 * isLocked in the Consignments grid. Chargeable weight prices both sides at
 * once, so changing it with a live invoice on either would put that invoice at
 * odds with the AWB it was raised from.
 */
export const sideLocked = (charges, type) =>
  (charges || []).some((c) => c.type === type && isInvoiceLocked(c));

export const sellingLocked = (charges) => sideLocked(charges, RECEIVABLE);
export const buyingLocked = (charges) => sideLocked(charges, PAYABLE);

/** The invoice that froze this side, for saying WHICH document did it. */
export const lockingInvoice = (charges, type) =>
  (charges || []).find((c) => c.type === type && isInvoiceLocked(c)) || null;

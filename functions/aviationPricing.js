// Pricing for an aviation charge, as the screen shows it.
//
// Extracted from the Charges grid so it can be tested on its own. It MIRRORS
// functions/aviationCharge.js on the backend, which is what actually gets
// stored - if the two ever disagree, the backend is right and this is the bug.
// That is also why the tests here check the same cases the backend's do.
//
//   net amount   = Per Unit     -> qty x (rate - discount)   } plus tax, at
//                  Per Shipment -> qty x fee                  } the row's rate
//   local amount = net amount x ex-rate
//
// PER SHIPMENT IS A FEE TIMES A COUNT. The same handling charge is raised once
// per shipment, per pallet, per document, so the fee is typed and the number
// of them counted beside it. A row stored before the count carries qty 1,
// which is exactly what it meant, so it prices unchanged.
//
// TAX is folded INTO the net amount rather than left beside it: an invoice's
// total is the sum of its charges' net amounts, so tax left out would be
// printed on the line and missing from the document. taxAmountOf keeps the tax
// on its own for display.
//
// Field names are Charge_Head's, because an aviation charge IS a Charge_Head.

// Type values are the app's own misspellings. makeInvoiceNew and the ledger
// branch on these exact strings, so "correcting" them would silently
// misclassify every aviation invoice.
export const RECEIVABLE = 'Recievable';
export const PAYABLE = 'Payble';

export const PER_UNIT = 'Per Unit';
export const PER_SHIPMENT = 'Per Shipment';

export const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const isPerShipment = (c) => c?.basis === PER_SHIPMENT;
/** Tax is charged on this row. Mirrors `Boolean(c.tax_apply)` on the backend. */
export const isTaxed = (c) => Boolean(c?.tax_apply);
/** On an invoice - approved or not. What the invoice tag and link read. */
export const isInvoiced = (c) => Boolean(c?.InvoiceId);
export const isApproved = (c) => String(c?.status) === '1';

/**
 * On an APPROVED invoice, and so read-only.
 *
 * BEING ON AN INVOICE IS NOT THE SAME AS BEING FROZEN BY ONE. An approved
 * invoice has been posted to the ledger and issued, so its charges are part of
 * a document that has left the building. Unapproving it destroys the voucher
 * and takes it back out of the books - at which point there is nothing left
 * for the figures to contradict, and the whole point of unapproving is to fix
 * them. The charge keeps its InvoiceId throughout, so it stays on that invoice
 * and is re-approved onto the same document with the corrected total.
 *
 * DEFAULTS TO LOCKED when the invoice was not loaded with the charge
 * (`?? '1'`): several endpoints return charges without their Invoice, and
 * guessing "unapproved" there would open an issued document for editing.
 * Mirrored by isInvoiceLocked in functions/aviationCharge.js on the backend,
 * which is what actually refuses the write.
 */
export const isInvoiceLocked = (c) =>
  isInvoiced(c) && String(c?.Invoice?.approved ?? '1') === '1';

/** The rate an AWB prices this side of the ledger at. */
export const rateFor = (line, type) =>
  num(type === PAYABLE ? line?.buyingRate : line?.sellingRate);

/**
 * The exchange rate an AWB converts this side of the ledger at.
 *
 * The two sides of an AWB are not always bought and sold in the same currency,
 * and even when they are, the rate the space was BOUGHT at and the rate it was
 * SOLD at are struck on different days. One figure for both reported a margin
 * that was partly an artefact of the conversion.
 *
 * `exRate` is the LEGACY single field, kept as the fallback so that every
 * consignment entered before the split keeps pricing exactly as it did - see
 * withSplitExRates, which is what turns it into the two on first touch.
 *
 * `|| 1` last: a zero anywhere in the chain means "same currency" rather than
 * wiping the charge out of the books.
 */
export const exRateFor = (line, type) => num(
  (type === PAYABLE ? line?.buyingExRate : line?.sellingExRate) ?? line?.exRate
) || 1;

/**
 * A consignment with both ex-rates filled in, seeded from the legacy one.
 *
 * Applied to every line as it arrives from the server, so an AWB saved before
 * the split opens showing its old rate in BOTH boxes rather than two blanks
 * over a value that is still quietly pricing its charges. Saving then writes
 * them, and the row has migrated itself.
 */
export const withSplitExRates = (line) => ({
  ...line,
  buyingExRate:  line?.buyingExRate  ?? line?.exRate ?? 1,
  sellingExRate: line?.sellingExRate ?? line?.exRate ?? 1,
});

/**
 * The rate a charge is priced at: its own, else the AWB's for its side.
 *
 * `??` not `||`, so an explicit 0 stays 0 - a waived charge is a real thing
 * and must not fall back to the AWB's rate. Mirrors chargeValues() on the
 * backend, which resolves `c.rate_charge ?? defaultRate ?? 0`.
 *
 * NO FALLBACK ON A PER SHIPMENT ROW. The AWB's rate is per kilo, and what one
 * document costs has nothing to do with it - so clearing the fee means nought,
 * which is what it looks like on screen. The backend does the same.
 */
export const rateOf = (c, line) => (isPerShipment(c)
  ? num(c?.rate_charge)
  : num(c?.rate_charge ?? rateFor(line, c?.type)));

/**
 * How many of this charge. Weight on a Per Unit row; a COUNT on a Per Shipment
 * one - how many shipments, pallets or documents the fee is raised for.
 *
 * A Per Shipment row with no count is ONE: that is what every row stored
 * before the count existed meant, and what someone who types a fee and nothing
 * else means. `== null` rather than `||`, so a typed 0 stays nothing instead
 * of being quietly billed as one. Mirrors the backend.
 */
export const qtyOf = (c) =>
  (isPerShipment(c) && c?.qty == null ? 1 : num(c?.qty));

/**
 * What the charge comes to BEFORE tax.
 *
 * `line` is required for the rate fallback above. Omitting it prices a
 * rate-less charge at 0 here while the server prices it at the AWB's rate -
 * the screen and the database then disagree about the same charge.
 */
export const computeBaseAmount = (c, line) =>
  qtyOf(c) * (rateOf(c, line) - (isPerShipment(c) ? 0 : num(c?.discount)));

/**
 * The tax on a charge, at the percentage it was registered with in Setup >
 * Charges and carried onto the row.
 *
 * The percentage is read ONLY while the toggle is on, so a charge switched off
 * keeps the figure it was set up with rather than losing it, and can never be
 * taxed by a percentage nobody can see.
 */
export const taxAmountOf = (c, line) =>
  (isTaxed(c) ? (computeBaseAmount(c, line) * num(c?.taxPerc)) / 100 : 0);

export const computeNetAmount = (c, line) =>
  computeBaseAmount(c, line) + taxAmountOf(c, line);

/**
 * Falls back to the AWB's ex-rate FOR THIS CHARGE'S SIDE, exactly as the
 * backend does. Without that fallback a charge with no ex-rate of its own
 * would display net x 1 while the server stored net x the AWB's rate.
 *
 * `|| 1` last: a zero anywhere in the chain means "same currency" rather than
 * wiping the charge out of the books.
 */
export const exRateOf = (c, line) => num(c?.ex_rate ?? exRateFor(line, c?.type)) || 1;

export const computeLocalAmount = (c, line) => computeNetAmount(c, line) * exRateOf(c, line);

/**
 * Uplift per carrier tag, off a flight's consignments.
 *
 * WHAT FLEW, not what was booked: grossWeight less offload. Counting gross
 * alone would credit a flight with the full weight of an AWB it left 300 kg of
 * on the ground. Manifest - the booked figure - is summed separately, which is
 * why the report has both columns.
 *
 * Mirrors the same arithmetic in routes/aviationJobs' report route; if the two
 * disagree, the backend is right and this is the bug.
 */
/**
 * What a leg was asked to carry, read against the leg before it.
 *
 * grossWeight is the AWB's DOCUMENTED total - the air waybill says 1,000 kg
 * however many aircraft it takes to move it - so it is copied verbatim onto
 * every leg of a split shipment. Summing it would report a 1,000 kg AWB as
 * 1,700 kg carried across two legs, and price a second offload against the
 * wrong base. So a continuation leg is read from its predecessor instead.
 *
 * THE RULE, and it mirrors resolveCarryIn in functions/aviationPendingLoads on
 * the backend - if the two ever disagree, the backend is right and this is the
 * bug:
 *
 *   no earlier leg      grossWeight. This leg IS the shipment.
 *   gross changed       grossWeight. The AWB was RE-CUT - see below.
 *   otherwise           the earlier leg's offload: what it left behind is
 *                       exactly what this one was asked to pick up.
 *
 * A CHANGED GROSS MEANS THE AWB WAS RE-CUT. Gross cannot legitimately differ
 * between two legs of one split, because it describes the shipment rather than
 * the flight. When it does differ, the number was not continued but REUSED: the
 * load was offloaded in full and the air waybill re-cut for a different, bigger
 * shipment. Reading the earlier leg's offload there reports the OLD cargo - the
 * very weight that was left behind - and nothing about what the previous flight
 * dropped can know that new cargo joined it. The operator's own gross is the
 * only figure that does.
 *
 * `prevLeg` is attached to every line by the server - the screen holds one
 * flight and cannot find an AWB's other legs for itself. See withPrevLegs.
 *
 * WITHOUT ONE it falls back to the stored carriedForward snapshot, which is the
 * old behaviour: a line the server has not enriched (a brand new row, or a
 * payload from before this shipped) still prices the way it used to rather than
 * jumping to its full gross.
 */
export const carryInOf = (line) => {
  const prev = line?.prevLeg;
  if (prev) {
    if (num(line?.grossWeight) !== num(prev?.grossWeight)) return num(line?.grossWeight);
    return num(prev?.offload);
  }
  return line?.carriedForward === null || line?.carriedForward === undefined
    ? num(line?.grossWeight)
    : num(line.carriedForward);
};

/** What actually left the ground on this leg. */
export const flownWeight = (line) => Math.max(0, carryInOf(line) - num(line?.offload));

/* ------------------ a booking that flew none of its cargo -------------------
 * The load was accepted onto the flight and then every kilo of it was left
 * behind. What gets typed is the offload - that is the exception, and it is
 * what the operator is looking at - and Pieces and Gross WT are left blank,
 * because "what it carried" feels like nothing.
 *
 * But those two columns are what the AWB was ASKED to carry, and the flight
 * was asked to carry all of it. Left empty the row reads as an AWB that was
 * never booked: the manifest sums carryIn and so loses the weight, a
 * continuation leg prefills its pieces and gross from this one and gets blanks,
 * and the grid shows an offload against no load.
 *
 * The outstanding-loads list is NOT affected - it reads the offload directly,
 * so the cargo is chased either way. This is about the booking being right.
 *
 * SO THE OFFLOAD IS THE BOOKING when nothing else was recorded. Returns the
 * fields to fill in, or null when the rule does not apply.
 *
 * ALL FOUR CONDITIONS, deliberately - both booked figures empty AND both
 * offload figures present. A partly offloaded leg (gross 1000, offload 300) is
 * not this, and neither is 5 of 10 pieces left behind: copying 5 into Pieces
 * would rewrite the booking as a smaller one than it was.
 *
 * Requiring all four is also what makes it FIRE ONCE. It fills the two booked
 * cells, which is exactly what stops it matching again - so it cannot rewrite
 * a figure it already wrote, and editing the offload afterwards means what it
 * says: some of the load flew after all.
 *
 * MIRRORS bookedFromOffload in functions/aviationPendingLoads.js on the
 * backend, which is what actually gets stored - the grid runs it as the cells
 * are typed so the operator sees it happen, but the server decides.
 * ------------------------------------------------------------------------- */
export const bookedFromOffload = (line) => {
  if (!line) return null;
  // A continuation leg already records what it was asked to take, and its
  // gross is the whole shipment's rather than this flight's share.
  if (line.carriedForward !== null && line.carriedForward !== undefined) return null;

  if (num(line.pieces) > 0 || num(line.grossWeight) > 0) return null;

  const offPieces = num(line.offloadPieces);
  const offGross = num(line.offload);
  if (offPieces <= 0 || offGross <= 0) return null;

  return { pieces: offPieces, grossWeight: offGross };
};

/**
 * The chargeable weight an AWB's figures imply: what this leg carried, less
 * anything it left behind.
 *
 * You bill what flew, so an offload has to come off it - leaving it at the
 * booked figure charges the customer for cargo still sitting on the ground.
 * The consignment grid applies this whenever a driver changes.
 *
 * Returns the line's EXISTING value when the leg has nothing to carry yet, so
 * an empty row is not stamped with a 0 the moment it is touched. Clamped at 0
 * otherwise: an offload bigger than the load is a typo, and a negative
 * chargeable weight would price every charge on the AWB backwards.
 */
export const chargeableWeightFor = (line) => {
  if (!carryInOf(line)) return line?.chargeableWeight;
  return flownWeight(line);
};

export const upliftByTag = (lines, carriers = []) => {
  const t = { ER: 0, IFA: 0, Other: 0, untagged: 0 };
  for (const l of lines || []) {
    const tag = l?.Aviation_Carrier?.category
      || carriers.find((c) => c.id === l?.AviationCarrierId)?.category;
    const w = flownWeight(l);
    if (tag && t[tag] !== undefined) t[tag] += w;
    else if (w) t.untagged += w;
  }
  return t;
};

/** ER + IFA + Other. Offloads are what did NOT fly, so they are excluded. */
export const totalUplift = (byTag) => num(byTag?.ER) + num(byTag?.IFA) + num(byTag?.Other);

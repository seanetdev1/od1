// What a flight and its consignments must carry before they can be saved.
//
// Kept out of the components so the rules can be tested without rendering a
// twenty-column grid, and so the Consignments header, the save check on
// CreateOrEdit and the tests all read ONE list rather than three copies that
// drift apart.
//
// These are FRONT-END rules. The server deliberately stays permissive: a
// flight entered before these rules existed, or one loaded by the migration,
// must still be readable and re-saveable, and a validation added here should
// not turn historic data into rows nobody can open. See the note on
// saveConsignments in routes/aviationJobs.

import { num, carryInOf } from './aviationPricing';
// IATA air waybill numbering. A DIRECT AWB is typed rather than picked, so it
// is the one number in this module nothing else has already checked.
import { validateAwbNumber } from './awbNumber';

/** Blank means "nothing was entered". 0 is a value, not a blank. */
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * The fields every consignment must name, and what to call them in an error.
 *
 * Ordered as the grid is, so the message reads left to right across the row
 * the user is looking at.
 *
 * `positive` fields must be more than zero as well as filled in: a
 * consignment of nought pieces weighing nought kilos is not a consignment,
 * and letting one through only moves the problem to whoever reconciles the
 * manifest. Selling is deliberately NOT positive - a rate of 0 is a waived
 * charge, which is a real thing the Charges tab already honours.
 */
export const REQUIRED_CONSIGNMENT_FIELDS = [
  { field: 'AviationCarrierId', label: 'Carrier' },
  { field: 'awb',               label: 'AWB #' },
  { field: 'masterAgentId',     label: 'Master Agent' },
  { field: 'destination',       label: 'Destination' },
  { field: 'CommodityId',       label: 'Commodity' },
  { field: 'pieces',            label: 'Pieces',        positive: true },
  { field: 'grossWeight',       label: 'Gross WT',      positive: true },
  // Required, but NOT `positive`: a chargeable weight of nought is legitimate
  // on an AWB that flew none of its cargo, and the blanket rule refused to
  // save that flight at all. Which zeroes are allowed is its own question with
  // its own answer - see chargeableWeightError.
  { field: 'chargeableWeight',  label: 'Chargeable WT' },
  { field: 'sellingRate',       label: 'Selling' },
];

/**
 * A row worth validating: one that names a party or an AWB.
 *
 * MIRRORS isRealLine in routes/aviationJobs - anything else is an "Add
 * Consignment +" the user thought better of, which the server drops rather
 * than saving. Validating those would refuse to save a flight over a blank
 * row that was never going to be stored in the first place; the grid also
 * starts every new flight with exactly such a row.
 */
export const isRealLine = (x) =>
  Boolean(x && (x.shipperId || x.consigneeId || x.masterAgentId ||
    x.AviationAwbId || String(x.awb || '').trim()));

/** The fields a flight itself must name. */
export const REQUIRED_FLIGHT_FIELDS = [
  { field: 'flightNo',            label: 'Flight No.' },
  { field: 'operatingCarrierId',  label: 'Airline' },
  { field: 'origin',              label: 'Origin' },
  { field: 'flightDate',          label: 'Flight Date' },
];

const missingFrom = (record, spec) => spec
  .filter(({ field, positive }) => {
    if (isBlank(record?.[field])) return true;
    return Boolean(positive) && num(record[field]) <= 0;
  })
  .map(({ label }) => label);

/** Labels of the required fields this consignment has not filled in. */
export const missingConsignmentFields = (line) =>
  missingFrom(line, REQUIRED_CONSIGNMENT_FIELDS);

/** Labels of the required fields this flight has not filled in. */
export const missingFlightFields = (job) =>
  missingFrom(job, REQUIRED_FLIGHT_FIELDS);

/**
 * Selling must beat buying.
 *
 * Every receivable on an AWB is billed at Selling and every payable costed at
 * Buying, so a selling rate at or below the buying rate is a consignment
 * flown at a loss - almost always a transposed pair of numbers rather than a
 * deliberate decision. Refused rather than warned about, because by the time
 * it reaches an invoice the margin has already been reported wrong.
 *
 * Checked only when BOTH rates are entered: a buying rate is not required, and
 * an AWB with no cost recorded yet is not evidence of anything. Returns a
 * message or null so the caller can name the row.
 */
export const rateOrderError = (line) => ratesInOrder(line?.buyingRate, line?.sellingRate);

/**
 * The same rule on a CHARTER's common pair.
 *
 * A charter is one deal for the whole aircraft, so a selling rate below the
 * buying rate there is the same mistake at twenty times the size - it prices
 * every AWB the charter reaches at a loss at once.
 */
export const charterRateOrderError = (job) => {
  if (!job?.charter) return null;
  return ratesInOrder(job.charterBuyingRate, job.charterSellingRate);
};

/**
 * A typed AWB number that is not a valid air waybill.
 *
 * ONLY FOR A DIRECT CONSIGNMENT. Every other AWB on a flight is PICKED out of
 * Setup > AWB Stock, where the number was checked when it was registered and
 * where the prefix is read off the carrier - it cannot be malformed by the
 * time it reaches the grid. A direct AWB is someone else's document, typed
 * straight off their paperwork into a free-text box, and until now nothing
 * looked at it at all.
 *
 * The check is on the FORMAT, not the register: a direct number is by
 * definition not our stock, so there is nothing to look it up in. What the
 * check digit gives is arithmetic proof that the digits were copied correctly
 * - see validateAwbNumber.
 *
 * A blank is not reported here. The AWB is already in
 * REQUIRED_CONSIGNMENT_FIELDS, and one empty box should produce one complaint.
 */
export const awbFormatError = (line) => {
  if (!line?.direct) return null;
  if (isBlank(line.awb)) return null;
  const check = validateAwbNumber(line.awb);
  return check.ok ? null : check.error;
};

/**
 * A chargeable weight of nought that has not earned it.
 *
 * YOU BILL WHAT FLEW, so chargeable weight is what the leg was asked to carry
 * less what it left behind. Nought therefore says one specific thing: this AWB
 * carried nothing at all. That happens - a load accepted onto the flight and
 * then offloaded in its entirety - and it has to be saveable, which is why
 * Chargeable WT is no longer a blanket `positive` field.
 *
 * But it is the ONLY thing nought can mean, and every other route to it is a
 * mistake that prices the AWB at zero:
 *
 *   an offload BIGGER than the load    a typo. flownWeight clamps at 0 rather
 *                                      than pricing the AWB backwards, so the
 *                                      transposed digit disappears into a
 *                                      plausible-looking nought.
 *   a nought TYPED over the figure     the cell is editable, because
 *                                      chargeable is conventionally the
 *                                      greater of actual and volumetric and
 *                                      an airline sometimes raises it by hand.
 *                                      Nothing stopped it being lowered to 0.
 *   a load with no offload at all      cargo flew and is billed at nothing.
 *
 * So: nought is allowed exactly when the whole load was offloaded, and both
 * figures have to be there to say so. Nought against nought is an empty row,
 * not a fully offloaded one.
 *
 * MEASURED AGAINST WHAT THE LEG WAS ASKED TO CARRY, which on an ordinary
 * consignment IS its gross weight - the rule as stated. On a CONTINUATION leg
 * it is what the flight before it left behind: gross there is the AWB's
 * documented total for the whole shipment and is repeated on every leg, so
 * comparing the offload against it would refuse a continuation leg that was
 * legitimately offloaded in full. See carryInOf.
 *
 * Returns a message or null, so the caller can name the row.
 */
export const chargeableWeightError = (line) => {
  if (isBlank(line?.chargeableWeight)) return null;   // already reported as missing
  const chargeable = num(line.chargeableWeight);
  if (chargeable > 0) return null;

  const asked = carryInOf(line);
  const offload = num(line?.offload);

  if (asked > 0 && offload > 0 && asked === offload) return null;

  if (chargeable < 0) {
    return `Chargeable WT cannot be negative (${chargeable})`;
  }
  if (asked > 0 && offload > asked) {
    // The likeliest single cause, and the one the user cannot see: the grid
    // clamps at 0, so an offload of 5,000 against a load of 500 looks like a
    // tidy nought rather than like the transposition it is.
    // Names the figure the offload was actually measured against, which on a
    // continuation leg is what the flight before it left behind rather than
    // anything typed on this row - see carryInOf.
    return `Chargeable WT is 0 because the offload (${offload}) is bigger than the ${
      line?.prevLeg ? 'weight carried forward' : 'gross weight'} (${asked}) — check both figures`;
  }
  return 'Chargeable WT can only be 0 when the whole load was offloaded — ' +
    'Gross WT and Offload WT must both be filled in and equal';
};

const ratesInOrder = (buyingRate, sellingRate) => {
  if (isBlank(buyingRate) || isBlank(sellingRate)) return null;
  const buying = num(buyingRate);
  const selling = num(sellingRate);
  if (selling > buying) return null;
  return `Selling (${selling}) must be higher than Buying (${buying})`;
};

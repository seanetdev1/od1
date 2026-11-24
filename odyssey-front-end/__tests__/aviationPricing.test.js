/**
 * Aviation charge pricing, as the SCREEN computes it.
 *
 * This mirrors functions/aviationCharge.js on the backend, which is what
 * actually gets stored. The cases below deliberately match that file's tests:
 * if the screen and the server ever disagree about a figure, someone
 * reconciles an invoice against a total that was never real.
 */
import {
  RECEIVABLE, PAYABLE, PER_SHIPMENT,
  computeBaseAmount, computeNetAmount, computeLocalAmount, taxAmountOf,
  exRateOf, rateFor, rateOf, qtyOf,
  isPerShipment, isTaxed, isInvoiced, isApproved,
  upliftByTag, totalUplift, chargeableWeightFor, flownWeight, carryInOf, bookedFromOffload,
} from 'functions/aviationPricing';

const AWB = { sellingRate: 1.7, buyingRate: 1.4, exRate: 280 };

describe('rate selection', () => {
  test('a receivable takes the selling rate, a payable the buying rate', () => {
    expect(rateFor(AWB, RECEIVABLE)).toBe(1.7);
    expect(rateFor(AWB, PAYABLE)).toBe(1.4);
  });

  test('a missing rate is 0, not NaN', () => {
    expect(rateFor({}, RECEIVABLE)).toBe(0);
    expect(rateFor(undefined, PAYABLE)).toBe(0);
  });
});

describe('net amount', () => {
  test('Per Unit is weight x rate', () => {
    expect(computeNetAmount({ qty: 100, rate_charge: 1.7 })).toBeCloseTo(170, 6);
  });

  test('discount comes off the RATE, so it scales with weight', () => {
    expect(computeNetAmount({ qty: 100, rate_charge: 5, discount: 1 })).toBeCloseTo(400, 6);
  });

  test('a negative discount surcharges per kg', () => {
    expect(computeNetAmount({ qty: 100, rate_charge: 5, discount: -1 })).toBeCloseTo(600, 6);
  });

  test('a discount equal to the rate zeroes the charge', () => {
    expect(computeNetAmount({ qty: 100, rate_charge: 5, discount: 5 })).toBe(0);
  });

  test('Per Shipment is the fee times how many, and the adhoc plays no part', () => {
    // The same handling charge raised on three documents is three fees.
    expect(computeNetAmount({
      basis: PER_SHIPMENT, rate_charge: 750, qty: 3, discount: 2,
    })).toBe(2250);
  });

  test('a Per Shipment charge with no count at all is ONE', () => {
    // Which is exactly what every row stored before the count meant, so those
    // rows price unchanged.
    expect(computeNetAmount({ basis: PER_SHIPMENT, rate_charge: 750 })).toBe(750);
    expect(qtyOf({ basis: PER_SHIPMENT })).toBe(1);
  });

  test('a Per Shipment count of ZERO is nothing, not one', () => {
    // Typing 0 is a statement; billing it as one puts a fee on an invoice
    // nobody asked for.
    expect(computeNetAmount({ basis: PER_SHIPMENT, rate_charge: 750, qty: 0 })).toBe(0);
  });

  test('a Per Shipment fee does NOT fall back to the AWB rate', () => {
    // 1.70 a kilo says nothing about what one document costs. The server does
    // the same, so clearing the fee reads as nought on both sides.
    expect(computeNetAmount({ basis: PER_SHIPMENT, qty: 2 }, AWB)).toBe(0);
    expect(rateOf({ basis: PER_SHIPMENT }, AWB)).toBe(0);
  });

  test('blank inputs give 0 rather than NaN', () => {
    expect(computeNetAmount({})).toBe(0);
    expect(computeNetAmount({ qty: null, rate_charge: undefined })).toBe(0);
  });

  test('a charge with no rate of its own falls back to the AWB', () => {
    // The server does this, so the screen must too. Clearing the Rate field
    // otherwise showed a free charge that invoiced at the AWB's rate.
    expect(computeNetAmount({ type: PAYABLE, qty: 100 }, AWB)).toBeCloseTo(140, 6);
    expect(computeNetAmount({ type: RECEIVABLE, qty: 100 }, AWB)).toBeCloseTo(170, 6);
  });

  test('an explicit rate of 0 is honoured, not overridden by the AWB', () => {
    // A waived charge is a real thing; `??` rather than `||` keeps it waived.
    expect(computeNetAmount({ type: PAYABLE, qty: 100, rate_charge: 0 }, AWB)).toBe(0);
  });

  test('rateOf resolves own rate, then the AWB, then 0', () => {
    expect(rateOf({ type: PAYABLE, rate_charge: 9 }, AWB)).toBe(9);
    expect(rateOf({ type: PAYABLE }, AWB)).toBe(1.4);
    expect(rateOf({ type: PAYABLE }, {})).toBe(0);
    expect(rateOf({}, undefined)).toBe(0);
  });
});

describe('tax', () => {
  // Registered in Setup > Charges and carried onto the row, where it can still
  // be turned off for the one shipment that is exempt. Mirrors the backend.
  const taxed = { qty: 100, rate_charge: 5, tax_apply: true, taxPerc: 17 };

  test('is charged on the amount BEFORE tax', () => {
    expect(computeBaseAmount(taxed)).toBe(500);
    expect(taxAmountOf(taxed)).toBeCloseTo(85, 6);
  });

  test('is included in the net amount', () => {
    // The invoice total is the sum of the charges' net amounts, so tax left
    // out of it prints on the line and is missing from the document.
    expect(computeNetAmount(taxed)).toBeCloseTo(585, 6);
  });

  test('the toggle off means no tax, whatever percentage the row carries', () => {
    expect(taxAmountOf({ ...taxed, tax_apply: false })).toBe(0);
    expect(computeNetAmount({ ...taxed, tax_apply: false })).toBe(500);
    expect(isTaxed({ ...taxed, tax_apply: false })).toBe(false);
  });

  test('discount comes off before tax', () => {
    // Tax is charged on what is billed, not on what was quoted.
    expect(taxAmountOf({ ...taxed, discount: 1 })).toBeCloseTo(68, 6);
    expect(computeNetAmount({ ...taxed, discount: 1 })).toBeCloseTo(468, 6);
  });

  test('applies to a Per Shipment fee too', () => {
    const c = { basis: PER_SHIPMENT, rate_charge: 1000, qty: 2, tax_apply: true, taxPerc: 10 };
    expect(taxAmountOf(c)).toBeCloseTo(200, 6);
    expect(computeNetAmount(c)).toBeCloseTo(2200, 6);
  });

  test('converts like anything else', () => {
    expect(computeLocalAmount({ ...taxed, ex_rate: 280 })).toBeCloseTo(585 * 280, 4);
  });
});

describe('exchange rate', () => {
  test('local amount is net x ex-rate', () => {
    expect(computeLocalAmount({ qty: 100, rate_charge: 1.7, ex_rate: 280 }, AWB))
      .toBeCloseTo(170 * 280, 6);
  });

  test('a charge with no ex-rate falls back to the AWB', () => {
    // Not 1. Without this the screen showed net x 1 while the server stored
    // net x the AWB rate, and the two silently disagreed about money.
    expect(exRateOf({}, AWB)).toBe(280);
    expect(computeLocalAmount({ qty: 100, rate_charge: 1.7 }, AWB)).toBeCloseTo(170 * 280, 6);
  });

  test('a charge can override the AWB rate', () => {
    expect(exRateOf({ ex_rate: 300 }, AWB)).toBe(300);
  });

  test('zero anywhere in the chain means 1, never zero', () => {
    expect(exRateOf({ ex_rate: 0 }, AWB)).toBe(1);
    expect(exRateOf({}, { exRate: 0 })).toBe(1);
    expect(exRateOf({}, {})).toBe(1);
  });
});

describe('row state', () => {
  test('per shipment, invoiced and approved read off the row', () => {
    expect(isPerShipment({ basis: PER_SHIPMENT })).toBe(true);
    expect(isPerShipment({ basis: 'Per Unit' })).toBe(false);
    expect(isInvoiced({ InvoiceId: 7 })).toBe(true);
    expect(isInvoiced({ InvoiceId: null })).toBe(false);
    expect(isApproved({ status: '1' })).toBe(true);
    expect(isApproved({ status: 1 })).toBe(true);     // numeric from the server
    expect(isApproved({ status: '0' })).toBe(false);
    expect(isApproved({})).toBe(false);
  });
});

describe('uplift by carrier tag', () => {
  const carriers = [
    { id: 1, category: 'ER' },
    { id: 2, category: 'IFA' },
    { id: 3, category: 'Other' },
  ];

  test('sums each AWB into its carrier bucket', () => {
    const t = upliftByTag([
      { AviationCarrierId: 1, grossWeight: 100 },
      { AviationCarrierId: 2, grossWeight: 50 },
      { AviationCarrierId: 3, grossWeight: 25 },
    ], carriers);
    expect(t).toEqual({ ER: 100, IFA: 50, Other: 25, untagged: 0 });
  });

  test('prefers the carrier the server sent over the pick list', () => {
    const t = upliftByTag([
      { Aviation_Carrier: { category: 'IFA' }, AviationCarrierId: 1, grossWeight: 10 },
    ], carriers);
    expect(t.IFA).toBe(10);
    expect(t.ER).toBe(0);
  });

  test('an AWB with no carrier is UNTAGGED, not guessed into a bucket', () => {
    const t = upliftByTag([{ grossWeight: 250 }], carriers);
    expect(t.untagged).toBe(250);
    expect(totalUplift(t)).toBe(0);
  });

  test('a weightless untagged AWB is not counted at all', () => {
    expect(upliftByTag([{ grossWeight: 0 }], carriers).untagged).toBe(0);
  });

  test('total uplift excludes untagged cargo', () => {
    const t = upliftByTag([
      { AviationCarrierId: 1, grossWeight: 100 },
      { grossWeight: 999 },
    ], carriers);
    expect(totalUplift(t)).toBe(100);
  });

  test('an empty flight totals zero', () => {
    expect(upliftByTag([], carriers)).toEqual({ ER: 0, IFA: 0, Other: 0, untagged: 0 });
    expect(totalUplift(upliftByTag([], carriers))).toBe(0);
  });
});

describe('type values', () => {
  test("are the app's own misspellings", () => {
    // makeInvoiceNew and the ledger branch on these exact strings.
    expect(RECEIVABLE).toBe('Recievable');
    expect(PAYABLE).toBe('Payble');
  });
});

/**
 * The three weights: booked, offloaded, and what flew.
 *
 *   grossWeight       what was BOOKED on this leg
 *   offload           the part of it that stayed on the ground
 *   chargeableWeight  gross - offload, which is what gets billed
 *
 * Leaving chargeable at the booked figure after an offload bills the customer
 * for cargo still sitting at the airport, so this is the rule the consignment
 * grid applies on every change to either driver.
 */
describe('chargeableWeightFor', () => {
  test('with no offload it is simply the booked weight', () => {
    expect(chargeableWeightFor({ grossWeight: 1000 })).toBe(1000);
    expect(chargeableWeightFor({ grossWeight: 1000, offload: 0 })).toBe(1000);
    expect(chargeableWeightFor({ grossWeight: 1000, offload: null })).toBe(1000);
  });

  test('an offload comes off it', () => {
    expect(chargeableWeightFor({ grossWeight: 1000, offload: 300 })).toBe(700);
  });

  test('an offload larger than the booking clamps at zero, never negative', () => {
    // A typo, but a negative chargeable weight would price every charge on
    // the AWB backwards rather than just looking wrong.
    expect(chargeableWeightFor({ grossWeight: 100, offload: 400 })).toBe(0);
  });

  test('leaves an existing value alone until something is booked', () => {
    // Otherwise touching any field on a fresh row stamps a 0 into it.
    expect(chargeableWeightFor({ grossWeight: null, chargeableWeight: 250 })).toBe(250);
    expect(chargeableWeightFor({ grossWeight: 0, chargeableWeight: null })).toBeNull();
  });
});

describe('uplift counts what FLEW', () => {
  const carriers = [
    { id: 1, category: 'ER' },
    { id: 2, category: 'IFA' },
  ];

  test('an offloaded AWB contributes only the part that left the ground', () => {
    // Counting grossWeight alone credits the flight with 300 kg it did not
    // carry - the exact overstatement that made Manifest and Uplift identical.
    const t = upliftByTag([
      { AviationCarrierId: 1, grossWeight: 1000, offload: 300 },
    ], carriers);
    expect(t.ER).toBe(700);
  });

  test('flownWeight never goes negative', () => {
    expect(flownWeight({ grossWeight: 100, offload: 400 })).toBe(0);
  });

  test('untagged weight is counted as flown too', () => {
    const t = upliftByTag([{ grossWeight: 500, offload: 100 }], carriers);
    expect(t.untagged).toBe(400);
  });
});

/**
 * A continuation leg: the AWB's documented figures are copied forward, and
 * what THIS flight is taking lives in carriedForward.
 */
describe('carriedForward', () => {
  test('carryInOf prefers it over the document\'s gross', () => {
    expect(carryInOf({ grossWeight: 1000 })).toBe(1000);
    expect(carryInOf({ grossWeight: 1000, carriedForward: null })).toBe(1000);
    expect(carryInOf({ grossWeight: 1000, carriedForward: 300 })).toBe(300);
    // Explicitly zero is a real answer and must not fall back to 1,000.
    expect(carryInOf({ grossWeight: 1000, carriedForward: 0 })).toBe(0);
  });

  test('chargeable on a continuation leg is what it took, not the document', () => {
    // The AWB still says 1,000 kg; this flight is carrying the outstanding
    // 300. Billing the customer 1,000 again is the failure being prevented.
    expect(chargeableWeightFor({ grossWeight: 1000, carriedForward: 300 })).toBe(300);
  });

  test('a further offload comes off the carried amount, not the document', () => {
    // 300 forward, 100 of it bumped again -> 200 flew and 200 is billed.
    // Against gross it would have read 900.
    expect(chargeableWeightFor({ grossWeight: 1000, carriedForward: 300, offload: 100 })).toBe(200);
  });

  test('uplift counts the carried amount too', () => {
    const t = upliftByTag([
      { AviationCarrierId: 1, grossWeight: 1000, carriedForward: 300, offload: 100 },
    ], [{ id: 1, category: 'ER' }]);
    expect(t.ER).toBe(200);
  });
});

describe('a booking that flew none of its cargo', () => {
  // Pieces and Gross WT are what the AWB was ASKED to carry. On a leg where
  // every kilo was offloaded, the operator types the offload and leaves those
  // blank - and blank reads as an AWB that was never booked at all.
  const leg = (x) => ({ pieces: null, grossWeight: null, offloadPieces: null, offload: null, ...x });

  test('books the leg from what it left behind', () => {
    expect(bookedFromOffload(leg({ offloadPieces: 5, offload: 500 })))
      .toEqual({ pieces: 5, grossWeight: 500 });
  });

  test('leaves a partly offloaded leg alone', () => {
    // 300 of 1000 stayed behind: 700 flew, and the booking is already right.
    expect(bookedFromOffload(leg({ pieces: 10, grossWeight: 1000, offloadPieces: 3, offload: 300 })))
      .toBeNull();
  });

  test('does not shrink a booking when only some pieces were left behind', () => {
    // Pieces recorded, weight not. Copying 5 into Pieces would rewrite a
    // 10-piece booking as a 5-piece one.
    expect(bookedFromOffload(leg({ pieces: 10, offloadPieces: 5, offload: 500 }))).toBeNull();
  });

  test('does not fire on a weight that was booked but not counted in pieces', () => {
    expect(bookedFromOffload(leg({ grossWeight: 1000, offloadPieces: 5, offload: 500 }))).toBeNull();
  });

  test('needs BOTH offload figures, so it cannot half-fill a row', () => {
    // This is also what lets the grid run it on every keystroke: typing the
    // offload pair in either order only completes the rule on the second one.
    expect(bookedFromOffload(leg({ offload: 500 }))).toBeNull();
    expect(bookedFromOffload(leg({ offloadPieces: 5 }))).toBeNull();
  });

  test('an empty row is not a fully offloaded one', () => {
    expect(bookedFromOffload(leg({}))).toBeNull();
    expect(bookedFromOffload(null)).toBeNull();
  });

  test('fires once - the fields it writes are what stop it matching again', () => {
    const first = leg({ offloadPieces: 5, offload: 500 });
    const filled = { ...first, ...bookedFromOffload(first) };
    // Editing the offload afterwards now means what it says: some of it flew.
    expect(bookedFromOffload({ ...filled, offload: 400 })).toBeNull();
  });

  test('skips a continuation leg', () => {
    // carriedForward already records what this leg was asked to take, and its
    // gross is the whole shipment's rather than this flight's share of it.
    expect(bookedFromOffload(leg({ carriedForward: 300, offloadPieces: 5, offload: 300 })))
      .toBeNull();
    // Including a carriedForward of 0 - that is a recorded answer too.
    expect(bookedFromOffload(leg({ carriedForward: 0, offloadPieces: 5, offload: 300 })))
      .toBeNull();
  });

  test('nothing is chargeable on a leg that carried nothing', () => {
    // The point of filling the booking in: gross less offload is 0, so the
    // AWB prices at nothing rather than off a booking of nothing.
    const filled = { ...leg({ offloadPieces: 5, offload: 500 }) };
    Object.assign(filled, bookedFromOffload(filled));
    expect(chargeableWeightFor(filled)).toBe(0);
    expect(flownWeight(filled)).toBe(0);
  });
});

describe('WHEN the fully-offloaded rule is allowed to run', () => {
  /* The rule itself is right; running it on the wrong keystroke is not.
   *
   * InputNumber fires onChange for every character, so typing "100" into
   * Offload WT arrives as 1, then 10, then 100. These two tests are the same
   * user doing the same thing, and differ only in when the rule is consulted.
   */
  const typing = (field, digits) => digits.split('').reduce(
    (steps, _, n) => [...steps, { [field]: Number(digits.slice(0, n + 1)) }], []
  );

  // Offload Pcs filled in first, then Offload WT typed a digit at a time.
  const KEYSTROKES = [
    ...typing('offloadPieces', '100'),
    ...typing('offload', '100'),
  ];

  test('per keystroke it books the leg at the first digit typed', () => {
    // The reported bug: gross 1 against an offload of 100. The rule fires on
    // offload=1 - Offload Pcs is already complete and both booked cells are
    // blank - and filling them in is exactly what stops it correcting itself
    // as the remaining digits arrive.
    let row = { pieces: null, grossWeight: null, offloadPieces: null, offload: null };
    for (const stroke of KEYSTROKES) {
      row = { ...row, ...stroke };
      const filled = bookedFromOffload(row);
      if (filled) row = { ...row, ...filled };
    }
    expect(row.grossWeight).toBe(1);
    expect(row.offload).toBe(100);
  });

  test('on blur it books the leg at what the user actually meant', () => {
    // Same keystrokes; the rule is only consulted when a cell is LEFT, which
    // is the first moment it holds a complete number.
    let row = { pieces: null, grossWeight: null, offloadPieces: null, offload: null };
    const blur = () => {
      const filled = bookedFromOffload(row);
      if (filled) row = { ...row, ...filled };
    };
    for (const stroke of typing('offloadPieces', '100')) row = { ...row, ...stroke };
    blur();   // leaving Offload Pcs: no offload weight yet, so nothing fires
    expect(row.grossWeight).toBeNull();

    for (const stroke of typing('offload', '100')) row = { ...row, ...stroke };
    blur();   // leaving Offload WT: now both are there

    expect(row.pieces).toBe(100);
    expect(row.grossWeight).toBe(100);
    expect(chargeableWeightFor(row)).toBe(0);
  });

  test('and in the other order too', () => {
    // Offload WT first, then Offload Pcs.
    let row = { pieces: null, grossWeight: null, offloadPieces: null, offload: null };
    const blur = () => {
      const filled = bookedFromOffload(row);
      if (filled) row = { ...row, ...filled };
    };
    for (const stroke of typing('offload', '250')) row = { ...row, ...stroke };
    blur();
    expect(row.grossWeight).toBeNull();

    for (const stroke of typing('offloadPieces', '7')) row = { ...row, ...stroke };
    blur();

    expect(row.pieces).toBe(7);
    expect(row.grossWeight).toBe(250);
  });
});

/**
 * CARRY-IN READ AGAINST THE LEG BEFORE IT.
 *
 * `prevLeg` is attached to every saved line by the server (withPrevLegs) and,
 * for a line picked off the pending list, by the consignments grid itself. It
 * is what lets one flight's screen price a leg the way the reports will.
 *
 * MIRRORS resolveCarryIn in functions/aviationPendingLoads.js on the backend -
 * the cases below are deliberately the same ones its tests cover, because a
 * disagreement between the two shows up as a screen that contradicts the report
 * printed off it.
 */
describe('carryInOf against a predecessor', () => {
  test('no predecessor: the leg IS the shipment', () => {
    expect(carryInOf({ grossWeight: 1000 })).toBe(1000);
    expect(carryInOf({ grossWeight: 1000, prevLeg: null })).toBe(1000);
  });

  test('a continuation carries what the leg before it left behind', () => {
    // Gross unchanged between the legs: one shipment, two aircraft.
    expect(carryInOf({
      grossWeight: 1000,
      prevLeg: { grossWeight: 1000, offload: 300 },
    })).toBe(300);
  });

  test('a RE-CUT AWB carries its own gross', () => {
    // Offloaded in full, the number reused for a bigger shipment. Reading the
    // predecessor's offload would report the cargo that was left behind.
    expect(carryInOf({
      grossWeight: 2000,
      carriedForward: 500,
      prevLeg: { grossWeight: 500, offload: 500 },
    })).toBe(2000);
  });

  test('a snapshot with no offload behind it carries nothing', () => {
    expect(carryInOf({
      grossWeight: 1000,
      carriedForward: 300,
      prevLeg: { grossWeight: 1000, offload: null },
    })).toBe(0);
  });

  test('without a predecessor it falls back to the stored snapshot', () => {
    // A row the server has not enriched still prices as it used to, rather than
    // jumping to its full gross.
    expect(carryInOf({ grossWeight: 1000, carriedForward: 300 })).toBe(300);
  });

  test('the flight totals follow, which is what was wrong on screen', () => {
    // Manifest sums carry-in; uplift sums carry-in less offload. The flight
    // that re-cut the AWB reported 500 - the weight it had been offloaded by -
    // on both figures, however much gross was corrected to.
    const recut = {
      grossWeight: 2000, offload: 0, carriedForward: 500,
      prevLeg: { grossWeight: 500, offload: 500 },
      Aviation_Carrier: { category: 'IFA' },
    };
    expect(carryInOf(recut)).toBe(2000);
    expect(flownWeight(recut)).toBe(2000);
    expect(totalUplift(upliftByTag([recut]))).toBe(2000);
  });

  test('chargeable weight follows the resolved figure too', () => {
    // It is what every charge on the AWB is priced off, so a stale carry-in
    // billed the customer for the wrong shipment.
    expect(chargeableWeightFor({
      grossWeight: 2000, offload: 250,
      prevLeg: { grossWeight: 500, offload: 500 },
    })).toBe(1750);
  });
});

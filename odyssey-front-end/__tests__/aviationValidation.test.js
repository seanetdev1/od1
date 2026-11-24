/**
 * What a flight and its consignments must carry before they can be saved -
 * functions/aviationValidation.js.
 *
 * These are FRONT-END rules by design: the server stays permissive so that a
 * flight entered before a rule existed, or loaded by the migration, is still
 * openable and re-saveable. That makes this file the only place they are
 * checked, which is the reason to check them here.
 */
import { bookedFromOffload, chargeableWeightFor } from 'functions/aviationPricing';
import {
  REQUIRED_CONSIGNMENT_FIELDS,
  missingConsignmentFields,
  missingFlightFields,
  chargeableWeightError,
  rateOrderError,
  isRealLine,
} from 'functions/aviationValidation';

// A consignment with nothing wrong with it, so each test can break one thing.
const OK_LINE = {
  AviationCarrierId: 3,
  awb: '21410000001',
  masterAgentId: 7,
  destination: 'JED',
  CommodityId: 2,
  pieces: 10,
  grossWeight: 1000,
  chargeableWeight: 1000,
  offload: null,
  sellingRate: 1.7,
};

const line = (x) => ({ ...OK_LINE, ...x });

describe('required consignment fields', () => {
  test('a complete line is not missing anything', () => {
    expect(missingConsignmentFields(OK_LINE)).toEqual([]);
  });

  test('names every blank, in the order the grid shows them', () => {
    expect(missingConsignmentFields({})).toEqual(
      REQUIRED_CONSIGNMENT_FIELDS.map((f) => f.label)
    );
  });

  test('nought pieces or nought gross is not a consignment', () => {
    expect(missingConsignmentFields(line({ pieces: 0 }))).toEqual(['Pieces']);
    expect(missingConsignmentFields(line({ grossWeight: 0 }))).toEqual(['Gross WT']);
  });

  test('a BLANK chargeable weight is still missing', () => {
    expect(missingConsignmentFields(line({ chargeableWeight: null }))).toEqual(['Chargeable WT']);
  });

  test('a chargeable weight of nought is not reported as missing', () => {
    // It is a value, and whether this particular nought is allowed is
    // chargeableWeightError's question - asking it here would refuse a fully
    // offloaded AWB with the wrong message, or refuse it twice.
    expect(missingConsignmentFields(line({ chargeableWeight: 0 })))
      .not.toContain('Chargeable WT');
  });

  test('a selling rate of nought is a waived charge, not a mistake', () => {
    expect(missingConsignmentFields(line({ sellingRate: 0 }))).toEqual([]);
  });
});

describe('a chargeable weight of nought', () => {
  test('is allowed when the whole load was offloaded', () => {
    // The one thing nought can legitimately mean: this AWB carried nothing.
    expect(chargeableWeightError(line({ grossWeight: 500, offload: 500, chargeableWeight: 0 })))
      .toBeNull();
  });

  test('is refused when nothing was offloaded at all', () => {
    // Cargo flew and would be billed at nothing.
    expect(chargeableWeightError(line({ grossWeight: 500, offload: null, chargeableWeight: 0 })))
      .toMatch(/only be 0 when the whole load was offloaded/);
    expect(chargeableWeightError(line({ grossWeight: 500, offload: 0, chargeableWeight: 0 })))
      .toMatch(/only be 0 when the whole load was offloaded/);
  });

  test('is refused when only part of the load was offloaded', () => {
    expect(chargeableWeightError(line({ grossWeight: 500, offload: 200, chargeableWeight: 0 })))
      .toMatch(/only be 0 when the whole load was offloaded/);
  });

  test('names the transposed offload when it is bigger than the load', () => {
    // The likeliest single cause, and the one the user cannot see: the grid
    // clamps at 0, so 5,000 offloaded against 500 carried looks like a tidy
    // nought rather than like the typo it is.
    const msg = chargeableWeightError(line({ grossWeight: 500, offload: 5000, chargeableWeight: 0 }));
    expect(msg).toMatch(/bigger than the gross weight/);
    expect(msg).toContain('5000');
    expect(msg).toContain('500');
  });

  test('nought against nought is an empty row, not a fully offloaded one', () => {
    expect(chargeableWeightError({ chargeableWeight: 0, grossWeight: 0, offload: 0 }))
      .toMatch(/only be 0 when the whole load was offloaded/);
  });

  test('is measured against carriedForward on a continuation leg', () => {
    // Gross there is the AWB's DOCUMENTED total for the whole shipment and is
    // repeated on every leg, so comparing the offload against it would refuse
    // a continuation leg that really was offloaded in full.
    expect(chargeableWeightError(line({
      grossWeight: 1000, carriedForward: 300, offload: 300, chargeableWeight: 0,
    }))).toBeNull();

    // And a partly offloaded continuation leg is still refused.
    expect(chargeableWeightError(line({
      grossWeight: 1000, carriedForward: 300, offload: 100, chargeableWeight: 0,
    }))).toMatch(/only be 0 when the whole load was offloaded/);
  });

  test('says so plainly when the figure is negative', () => {
    expect(chargeableWeightError(line({ chargeableWeight: -5 }))).toMatch(/cannot be negative/);
  });
});

describe('a chargeable weight that is not nought', () => {
  test('passes whatever the offload says', () => {
    expect(chargeableWeightError(OK_LINE)).toBeNull();
    expect(chargeableWeightError(line({ grossWeight: 1000, offload: 300, chargeableWeight: 700 })))
      .toBeNull();
    // Raised by hand above gross - chargeable is conventionally the greater of
    // actual and volumetric, which is why the cell stays editable.
    expect(chargeableWeightError(line({ grossWeight: 1000, chargeableWeight: 1200 })))
      .toBeNull();
  });

  test('a blank is left to the missing-fields check', () => {
    // One empty box should produce one complaint.
    expect(chargeableWeightError(line({ chargeableWeight: null }))).toBeNull();
    expect(chargeableWeightError(line({ chargeableWeight: '' }))).toBeNull();
  });
});

describe('the rules that were already here', () => {
  test('selling must beat buying', () => {
    expect(rateOrderError(line({ buyingRate: 2, sellingRate: 1.5 }))).toMatch(/must be higher/);
    expect(rateOrderError(line({ buyingRate: 1.4, sellingRate: 1.7 }))).toBeNull();
    // Not checked until both are entered - a buying rate is not required.
    expect(rateOrderError(line({ buyingRate: null, sellingRate: 1.7 }))).toBeNull();
  });

  test('a row nobody filled in is not validated', () => {
    expect(isRealLine({})).toBe(false);
    expect(isRealLine({ awb: '21410000001' })).toBe(true);
  });

  test('a flight names its own required fields', () => {
    expect(missingFlightFields({})).toEqual(['Flight No.', 'Airline', 'Origin', 'Flight Date']);
  });
});

describe('the two rules that meet on a fully offloaded AWB', () => {
  // A load accepted onto the flight and then offloaded in its entirety is
  // entered as an offload against blank booked columns. One rule fills the
  // booking in from the offload; the other has to then ALLOW the nought
  // chargeable weight that follows from it. If they ever disagree, the flight
  // that rule was written for is the one that cannot be saved.
  test('the filled-in booking produces a chargeable weight the save accepts', () => {
    const typed = line({
      pieces: null, grossWeight: null, chargeableWeight: null,
      offloadPieces: 5, offload: 500,
    });

    const booked = { ...typed, ...bookedFromOffload(typed) };
    expect(booked.pieces).toBe(5);
    expect(booked.grossWeight).toBe(500);

    booked.chargeableWeight = chargeableWeightFor(booked);
    expect(booked.chargeableWeight).toBe(0);

    // Nothing missing, and the nought is earned.
    expect(missingConsignmentFields(booked)).toEqual([]);
    expect(chargeableWeightError(booked)).toBeNull();
  });
});

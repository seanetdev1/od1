/**
 * The screen and the server must price a charge identically.
 *
 * functions/aviationPricing.js computes what the Charges grid displays;
 * Odyssey-Backend-Server/functions/aviationCharge.js computes what is actually
 * stored and later invoiced. They are separate files in separate projects, so
 * nothing but a test stops them drifting - and a drift here is not a rendering
 * bug, it is an invoice that disagrees with the screen it was raised from.
 *
 * This sweeps the combinations rather than checking a handful, because the
 * divergence we already hit in this area - a charge with no ex-rate of its own
 * falling back to 1 on one side and to the AWB's rate on the other - only
 * showed up on one specific combination.
 */
import fs from 'fs';
import path from 'path';
import {
  RECEIVABLE, PAYABLE, PER_SHIPMENT, PER_UNIT,
  computeNetAmount, computeLocalAmount, taxAmountOf,
} from 'functions/aviationPricing';
// The row builder the screen uses, driven below by the BACKEND's own charge
// projection - the only check that catches a field going missing between them.
import { findAirFreight, airFreightRows, chargeMasterPatch } from 'functions/aviationChargeRow';

// Required directly rather than through a package: the backend is a sibling
// project, and this is the one test that has a legitimate reason to reach into
// it.
//
// It is not always there. A CI job that checks out this repo alone has no
// sibling, so the suite reports the comparison as skipped rather than failing
// on a missing file - a red build that means "the other repo wasn't cloned"
// teaches people to ignore red builds.
//
// SKIPPING IS NOT FREE: nothing then guards the two implementations against
// drift. Set REQUIRE_PARITY=1 in any job that is supposed to check it, and a
// missing backend becomes a hard failure instead of a quiet pass.
const backendPath = path.resolve(
  __dirname, '..', '..', 'Odyssey-Backend-Server', 'functions', 'aviationCharge.js'
);
const havebackend = fs.existsSync(backendPath);

if (!havebackend && process.env.REQUIRE_PARITY === '1') {
  throw new Error(
    `REQUIRE_PARITY=1 but the backend is not at ${backendPath}. ` +
    'Check out Odyssey-Backend-Server alongside this repo, or unset REQUIRE_PARITY.'
  );
}

// eslint-disable-next-line import/no-dynamic-require, global-require
const { chargeValues, chargeOption } = havebackend ? require(backendPath) : {};

// eslint-disable-next-line no-console
if (!havebackend) console.warn(`[parity] SKIPPED - no backend at ${backendPath}`);

const describeParity = havebackend ? describe : describe.skip;

const AWB = { sellingRate: 1.7, buyingRate: 1.4, exRate: 280 };

const backendFigures = (charge, line) => {
  const stored = chargeValues(charge, 0, 7, line);
  return {
    net: Number(stored.net_amount),
    local: Number(stored.local_amount),
    tax: Number(stored.tax_amount),
  };
};
const frontendFigures = (charge, line) => ({
  net: computeNetAmount(charge, line),
  local: computeLocalAmount(charge, line),
  tax: taxAmountOf(charge, line),
});

describeParity('pricing parity between the screen and the server', () => {
  const bases = [PER_UNIT, PER_SHIPMENT, undefined];
  const types = [RECEIVABLE, PAYABLE];
  const weights = [0, 1, 100, 25600, 1234.5];
  const rates = [undefined, 0, 1.4, 1.7, 12.75];
  const discounts = [undefined, 0, 1, -2];
  const exRates = [undefined, 0, 1, 280, 0.5];
  // Off, on at a real rate, on at nought, and on with no percentage set - the
  // last two being the states a half-configured charge arrives in.
  const taxes = [
    {},
    { tax_apply: true, taxPerc: 17 },
    { tax_apply: true, taxPerc: 0 },
    { tax_apply: true },
    { tax_apply: false, taxPerc: 17 },
  ];
  const flatFees = [0, 750];

  const cases = [];
  for (const basis of bases) {
    for (const type of types) {
      for (const qty of weights) {
        for (const rate_charge of rates) {
          for (const discount of discounts) {
            for (const ex_rate of exRates) {
              for (const tax of taxes) {
                cases.push({
                  basis, type, qty, rate_charge, discount, ex_rate, ...tax,
                  // Not read by either side any more - a Per Shipment fee is
                  // rate_charge, like every other rate. Left in the case so a
                  // stale net_amount cannot start being believed again without
                  // this sweep noticing.
                  net_amount: flatFees[qty % flatFees.length],
                });
              }
            }
          }
        }
      }
    }
  }

  test(`agree on every one of ${cases.length} combinations`, () => {
    const mismatches = [];
    for (const c of cases) {
      const fe = frontendFigures(c, AWB);
      const be = backendFigures(c, AWB);
      // Both sides do the same float arithmetic in the same order, so exact
      // equality is the right assertion - a difference means a rule differs,
      // not that a rounding step does.
      if (fe.net !== be.net || fe.local !== be.local) {
        mismatches.push({ charge: c, screen: fe, server: be });
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('agree when the AWB itself carries no rates', () => {
    const bare = {};
    const mismatches = [];
    for (const c of cases) {
      const fe = frontendFigures(c, bare);
      const be = backendFigures(c, bare);
      if (fe.net !== be.net || fe.local !== be.local) mismatches.push(c);
    }
    expect(mismatches).toEqual([]);
  });

  test('a Per Shipment fee is counted, and taxed, the same way on both sides', () => {
    // The two changes that moved this rule: a count beside the fee, and tax on
    // top of it. Both are folded into net_amount, which is what an invoice
    // totals - so a disagreement here is an invoice that differs from the
    // screen it was raised from.
    const charge = {
      type: RECEIVABLE, basis: PER_SHIPMENT, rate_charge: 750, qty: 3,
      tax_apply: true, taxPerc: 17, ex_rate: 280,
    };
    expect(frontendFigures(charge, AWB)).toEqual(backendFigures(charge, AWB));
    expect(frontendFigures(charge, AWB).net).toBeCloseTo(2250 * 1.17, 6);
  });

  test('the case this sweep caught: no rate on the charge', () => {
    // Regression guard. The screen priced a rate-less charge at 0 while the
    // server fell back to the AWB's buying rate, so clearing the Rate field
    // showed a free charge that invoiced at 4,197.30.
    const charge = { type: PAYABLE, qty: 1234.5, discount: -2 };
    expect(frontendFigures(charge, AWB)).toEqual(backendFigures(charge, AWB));
    expect(frontendFigures(charge, AWB).net).toBeCloseTo(1234.5 * 3.4, 6);
  });

  test('the specific case that once diverged: no ex-rate on the charge', () => {
    // Regression guard. The screen fell back to 1 while the server fell back
    // to the AWB's 280, so a row showed 43,520 and the database held
    // 12,185,600 for the same charge.
    const charge = { type: RECEIVABLE, qty: 25600, rate_charge: 1.7 };
    expect(frontendFigures(charge, AWB)).toEqual(backendFigures(charge, AWB));
    expect(frontendFigures(charge, AWB).local).toBeCloseTo(43520 * 280, 4);
  });
});

/* ---------------------------------------------------------------------------
 * The charge master has to survive the trip.
 *
 * THE BUG THIS EXISTS FOR. /aviationJob/getValues does not send a Charges row
 * through untouched - it reshapes it - so a column added to the query and not
 * added to that projection is selected, discarded, and arrives here as
 * `undefined`. Nothing throws. The screen reads it, gets nothing, and silently
 * does not do the thing.
 *
 * That shipped twice in one release: tax registered on a charge raised an
 * untaxed row, a charge with a fixed amount was priced at the AWB's rate, and
 * approving an AWB could not find the Air Freight charge because `short` had
 * never been carried at all. Every one of them was a feature that appeared to
 * work and quietly did not.
 *
 * So this drives the FRONTEND's row builder with the BACKEND's own projection,
 * which is the only check that catches a field going missing between them.
 * ------------------------------------------------------------------------ */
describeParity('a registered charge reaches the charge row', () => {
  // As Setup > Charges holds it - the column names and the string 'Yes'.
  const REGISTERED = {
    id: 2, code: 2, name: 'Air Freight', short: 'AF', currency: 'USD',
    calculationType: PER_UNIT,
    defaultRecivableParty: 'Master Agent', defaultPaybleParty: 'Carrier',
    taxApply: 'Yes', taxPerc: '17', fixAmount: 2.5,
  };

  const LINE = {
    chargeableWeight: 100, sellingRate: 1.7, buyingRate: 1.4,
    sellingExRate: 280, buyingExRate: 279,
    AviationCarrierId: 3, masterAgentId: 55,
  };
  const values = () => ({
    charge: [chargeOption(REGISTERED)],
    carrier: [{ id: 3, name: 'PIA', partyId: 77 }],
    party: [{ id: 77, name: 'PIA (12)' }, { id: 55, name: 'Agent (13)' }],
  });

  test('approving finds it by its short name', () => {
    // `short` was dropped by the projection, so this found nothing and
    // approving an AWB reported that no Air Freight charge was registered -
    // with one plainly registered on the screen behind the message.
    expect(findAirFreight(values().charge)).not.toBeNull();
  });

  test('its tax reaches the row', () => {
    const rows = airFreightRows(LINE, values());
    expect(rows[0].tax_apply).toBe(true);
    expect(rows[0].taxPerc).toBe(17);
  });

  test('its fixed amount reaches the row', () => {
    expect(Number(airFreightRows(LINE, values())[0].rate_charge)).toBe(2.5);
  });

  test('its party roles reach the row', () => {
    const rows = airFreightRows(LINE, values());
    expect(rows.find((r) => r.type === RECEIVABLE).partyId).toBe(55);
    expect(rows.find((r) => r.type === PAYABLE).partyId).toBe(77);
  });

  test('the charge NAME reaches particular, which is what an invoice prints', () => {
    // Not the "(2) AF" dropdown label, which is what was stored until 1.2.2.
    expect(chargeMasterPatch(chargeOption(REGISTERED), LINE, values(), true).particular)
      .toBe('Air Freight');
  });

  test('and the screen and the server still agree on what it costs', () => {
    // The whole point of carrying the fields: both sides price the row the
    // same way once the row is built from them.
    const row = airFreightRows(LINE, values())[0];
    expect(frontendFigures(row, LINE)).toEqual(backendFigures(row, LINE));
  });
});

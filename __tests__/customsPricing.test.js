/**
 * Customs charge pricing, on the screen and against the server.
 *
 * The first half pins what the Charges grid computes. The second sweeps every
 * combination against the backend's own implementation, because these are
 * separate files in separate projects and nothing but a test stops them
 * drifting - and a drift here is not a rendering bug, it is an invoice that
 * disagrees with the screen it was raised from.
 */
import fs from 'fs';
import path from 'path';
import {
  RECEIVABLE, PAYABLE, PER_SHIPMENT, PER_UNIT,
  isPerShipment, isApproved, isInvoiced, qtyOf,
  computeNetAmount, computeLocalAmount, exRateOf, chargeTotals,
} from 'functions/customsPricing';

const JOB = { exRate: 280 };

describe('what the grid computes', () => {
  test('a flat fee is its Amount, because an unset quantity counts as one', () => {
    // This is what makes one formula serve both bases. The quantity box is
    // enterable on a flat fee now; leaving it empty has to mean the same thing
    // it always did.
    expect(computeNetAmount({ basis: PER_SHIPMENT, rate_charge: 25000 })).toBe(25000);
    expect(computeNetAmount({ basis: PER_SHIPMENT, rate_charge: 25000, qty: 1 })).toBe(25000);
  });

  test('a quantity on a flat fee MULTIPLIES it', () => {
    // The rule that changed. It used to be ignored, which was tenable only
    // while the box was greyed out - and the invoice prints Qty and Amount as
    // adjacent columns, so "3 x 5,000 = 5,000" would reach a client.
    expect(computeNetAmount({ basis: PER_SHIPMENT, rate_charge: 5000, qty: 3 })).toBe(15000);
  });

  test('the basis no longer changes the arithmetic at all', () => {
    // It decides only what the screen SEEDS the quantity with. Every Per
    // Shipment row on the live book already satisfied qty x rate = net, so
    // nothing stored was revalued by making this uniform.
    const priced = { qty: 4, rate_charge: 7500, discount: 500 };
    expect(computeNetAmount({ ...priced, basis: PER_UNIT })).toBe(28000);
    expect(computeNetAmount({ ...priced, basis: PER_SHIPMENT })).toBe(28000);
    expect(computeNetAmount(priced)).toBe(28000);
  });

  test('Per Shipment is still the default basis', () => {
    expect(isPerShipment({})).toBe(true);
    expect(isPerShipment({ basis: PER_UNIT })).toBe(false);
  });

  test('an unset quantity is one; an explicit zero is zero', () => {
    // Somebody typed the zero. Treating it as one would price a line they
    // deliberately zeroed.
    expect(qtyOf({})).toBe(1);
    expect(qtyOf({ qty: null })).toBe(1);
    expect(qtyOf({ qty: '' })).toBe(1);
    expect(qtyOf({ qty: 0 })).toBe(0);
    expect(qtyOf({ qty: '3' })).toBe(3);
    expect(computeNetAmount({ rate_charge: 5000, qty: 0 })).toBe(0);
  });

  test('an unpriced Per Unit charge is zero - a GD has no rate to fall back to', () => {
    // Unlike an aviation AWB, which supplies the rate. Nothing on a clearance
    // file could have supplied this figure.
    expect(computeNetAmount({ basis: PER_UNIT, qty: 4 })).toBe(0);
    expect(computeNetAmount({ basis: PER_SHIPMENT })).toBe(0);
  });

  test('the ex-rate falls back to the job, then to 1', () => {
    expect(exRateOf({ ex_rate: 3 }, JOB)).toBe(3);
    expect(exRateOf({}, JOB)).toBe(280);
    expect(exRateOf({}, {})).toBe(1);
    // A zero anywhere in the chain means "same currency" rather than wiping
    // the charge out of the books.
    expect(exRateOf({ ex_rate: 0 }, JOB)).toBe(1);
  });

  test('local amount is net x ex-rate', () => {
    expect(computeLocalAmount({ rate_charge: 100 }, JOB)).toBe(28000);
    expect(computeLocalAmount({ rate_charge: 100, ex_rate: 1 }, JOB)).toBe(100);
  });

  test('approval and invoicing are read off the shared Charge_Head fields', () => {
    expect(isApproved({ status: '1' })).toBe(true);
    expect(isApproved({ status: 1 })).toBe(true);
    expect(isApproved({ status: '0' })).toBe(false);
    expect(isInvoiced({ InvoiceId: 4 })).toBe(true);
    expect(isInvoiced({ InvoiceId: null })).toBe(false);
  });
});

describe('job totals', () => {
  const charges = [
    { type: RECEIVABLE, rate_charge: 25000, ex_rate: 1 },
    { type: RECEIVABLE, rate_charge: 100, ex_rate: 280 },
    { type: PAYABLE, rate_charge: 4000, ex_rate: 1 },
  ];

  test('are in local currency, which is the only basis both sides share', () => {
    // A receivable in dollars and a payable in rupees cannot be subtracted
    // from one another in any other unit.
    const t = chargeTotals(charges, JOB);
    expect(t.receivable).toBe(25000 + 28000);
    expect(t.payable).toBe(4000);
    expect(t.profit).toBe(49000);
  });

  test('count invoiced lines too - billing half a file does not change its profit', () => {
    const billed = charges.map((c) => ({ ...c, InvoiceId: 7 }));
    expect(chargeTotals(billed, JOB)).toEqual(chargeTotals(charges, JOB));
  });

  test('treat anything that is not a payable as a receivable', () => {
    // Matching the backend, which stores 'Recievable' for every type it does
    // not recognise - so a row with no type must not vanish from the totals.
    expect(chargeTotals([{ rate_charge: 10, ex_rate: 1 }], JOB).receivable).toBe(10);
  });

  test('survive an empty or missing list', () => {
    expect(chargeTotals([], JOB)).toEqual({ receivable: 0, payable: 0, profit: 0 });
    expect(chargeTotals(undefined, JOB)).toEqual({ receivable: 0, payable: 0, profit: 0 });
  });
});

// --- parity with the server -------------------------------------------------

// Required directly rather than through a package: the backend is a sibling
// project, and this is one of the two tests with a legitimate reason to reach
// into it.
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
  __dirname, '..', '..', 'Odyssey-Backend-Server', 'functions', 'customsCharge.js'
);
const haveBackend = fs.existsSync(backendPath);

if (!haveBackend && process.env.REQUIRE_PARITY === '1') {
  throw new Error(
    `REQUIRE_PARITY=1 but the backend is not at ${backendPath}. ` +
    'Check out Odyssey-Backend-Server alongside this repo, or unset REQUIRE_PARITY.'
  );
}

// eslint-disable-next-line import/no-dynamic-require, global-require
const { chargeValues } = haveBackend ? require(backendPath) : {};

// eslint-disable-next-line no-console
if (!haveBackend) console.warn(`[parity] SKIPPED - no backend at ${backendPath}`);

const describeParity = haveBackend ? describe : describe.skip;

const backendFigures = (charge, job) => {
  const stored = chargeValues(charge, 0, 7, job);
  return { net: Number(stored.net_amount), local: Number(stored.local_amount) };
};
const frontendFigures = (charge, job) => ({
  net: computeNetAmount(charge),
  local: computeLocalAmount(charge, job),
});

describeParity('pricing parity between the screen and the server', () => {
  const cases = [];
  for (const basis of [PER_UNIT, PER_SHIPMENT, undefined]) {
    for (const type of [RECEIVABLE, PAYABLE]) {
      for (const qty of [0, 1, 4, 100, 1234.5]) {
        for (const rate_charge of [undefined, 0, 750, 12.75]) {
          for (const discount of [undefined, 0, 1, -2]) {
            for (const ex_rate of [undefined, 0, 1, 280, 0.5]) {
              for (const net_amount of [undefined, 0, 25000]) {
                cases.push({ basis, type, qty, rate_charge, discount, ex_rate, net_amount });
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
      const fe = frontendFigures(c, JOB);
      const be = backendFigures(c, JOB);
      // Both sides do the same float arithmetic in the same order, so exact
      // equality is the right assertion - a difference means a rule differs,
      // not that a rounding step does.
      if (fe.net !== be.net || fe.local !== be.local) {
        mismatches.push({ charge: c, screen: fe, server: be });
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('agree when the job itself carries no ex-rate', () => {
    const bare = {};
    const mismatches = [];
    for (const c of cases) {
      const fe = frontendFigures(c, bare);
      const be = backendFigures(c, bare);
      if (fe.net !== be.net || fe.local !== be.local) mismatches.push(c);
    }
    expect(mismatches).toEqual([]);
  });

  test('agree that an unset quantity is one, on either basis', () => {
    // The rule that carries a flat fee through a qty x rate formula. Get it
    // wrong on one side only and every charge nobody gave a quantity prices at
    // 0 on that side - which is most of them.
    for (const basis of [PER_SHIPMENT, PER_UNIT, undefined]) {
      const charge = { type: RECEIVABLE, basis, rate_charge: 25000 };
      expect(frontendFigures(charge, JOB)).toEqual(backendFigures(charge, JOB));
      expect(frontendFigures(charge, JOB).net).toBe(25000);
    }
  });

  test('agree that the basis does not change the arithmetic', () => {
    const priced = { type: RECEIVABLE, qty: 3, rate_charge: 5000 };
    const perShipment = backendFigures({ ...priced, basis: PER_SHIPMENT }, JOB);
    const perUnit = backendFigures({ ...priced, basis: PER_UNIT }, JOB);
    expect(perShipment).toEqual(perUnit);
    expect(perShipment.net).toBe(15000);
    expect(frontendFigures({ ...priced, basis: PER_SHIPMENT }, JOB)).toEqual(perShipment);
  });
});

/**
 * What an invoice freezes.
 *
 * Mirrors the backend's functions/invoiceLock, which is what actually refuses
 * the write. Tested here as well because this is what greys the row: if the
 * two disagree, the screen either offers an edit that will be silently thrown
 * away, or refuses one the server would have accepted.
 */
describe('isInvoiceLocked', () => {
  const { isInvoiceLocked } = require('functions/customsPricing');

  test('a charge on no invoice is not frozen', () => {
    expect(isInvoiceLocked({ InvoiceId: null })).toBe(false);
    expect(isInvoiceLocked({})).toBe(false);
  });

  test('an APPROVED invoice freezes its charge', () => {
    expect(isInvoiceLocked({ InvoiceId: 7, Invoice: { approved: '1' } })).toBe(true);
  });

  test('an UNAPPROVED one does not - that is what unapproving is for', () => {
    expect(isInvoiceLocked({ InvoiceId: 7, Invoice: { approved: '0' } })).toBe(false);
  });

  test('a charge whose invoice was not loaded is treated as frozen', () => {
    // Erring the other way would open an issued document for editing, and not
    // every screen carries the invoice row.
    expect(isInvoiceLocked({ InvoiceId: 7 })).toBe(true);
  });
});

// Sales tax on a customs charge - the same rule as the server's lineTax in
// functions/customsCharge.js, on the same cases.
describe('sales tax on the line', () => {
  const {
    computeTaxAmount, computeNetAmount: net, taxPercOf, isTaxed,
  } = require('functions/customsPricing');

  test('2,500 at 15% is 375, and the net includes it', () => {
    const c = { rate_charge: 2500, tax_apply: true, taxPerc: 15 };
    expect(computeTaxAmount(c)).toBe(375);
    expect(net(c)).toBe(2875);
  });

  test('the tax is on the whole line - quantity and discount included', () => {
    const c = { qty: 2, rate_charge: 1100, discount: 100, tax_apply: true, taxPerc: 15 };
    expect(computeTaxAmount(c)).toBe(300);
    expect(net(c)).toBe(2300);
  });

  test('a rate with the box unticked is not charged', () => {
    const c = { rate_charge: 2500, tax_apply: false, taxPerc: 15 };
    expect(isTaxed(c)).toBe(false);
    expect(net(c)).toBe(2500);
  });

  test('a migrated line - tax amount, no rate - reads its rate back out of the amount', () => {
    const c = { rate_charge: 2500, tax_apply: true, taxPerc: 0, tax_amount: 375 };
    expect(taxPercOf(c)).toBe(15);
    expect(net(c)).toBe(2875);
  });
});

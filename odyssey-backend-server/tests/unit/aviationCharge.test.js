/**
 * Aviation charge pricing.
 *
 * An aviation charge is a Charge_Head, so it is priced with the freight
 * formula: net_amount = (amount x rate_charge - discount) x qty, with `amount`
 * pinned to 1. These tests pin the behaviour that makes that equivalent to the
 * aviation rule, and the edge cases where a wrong answer silently moves money.
 */
const {
  chargeValues, isRealCharge, chargeOption, CH_RECEIVABLE, CH_PAYABLE,
} = require('../../functions/aviationCharge');

const AWB = { sellingRate: 1.7, buyingRate: 1.4, exRate: 280 };
const at = (c, line = AWB) => chargeValues(c, 0, 7, line);
const n = (v) => Number(v);

describe('aviation charge pricing', () => {
  test('a receivable prices on the AWB selling rate', () => {
    const r = at({ type: CH_RECEIVABLE, qty: 100 });
    expect(n(r.rate_charge)).toBe(1.7);
    expect(n(r.net_amount)).toBeCloseTo(170, 6);
  });

  test('a payable prices on the AWB buying rate', () => {
    const r = at({ type: CH_PAYABLE, qty: 100 });
    expect(n(r.rate_charge)).toBe(1.4);
    expect(n(r.net_amount)).toBeCloseTo(140, 6);
  });

  test('an unknown type falls to receivable rather than being stored as typed', () => {
    // The ledger branches on these exact strings; anything else must not reach it.
    expect(at({ type: 'Receivable', qty: 1 }).type).toBe(CH_RECEIVABLE);
    expect(at({ type: 'nonsense', qty: 1 }).type).toBe(CH_RECEIVABLE);
  });

  test('a rate on the charge overrides the AWB', () => {
    expect(n(at({ type: CH_RECEIVABLE, qty: 10, rate_charge: 9 }).net_amount)).toBe(90);
  });

  test('an explicit ZERO rate is honoured, not treated as unset', () => {
    // ?? not ||. A waived charge is a real thing and must not silently fall
    // back to the AWB's rate.
    const r = at({ type: CH_RECEIVABLE, qty: 100, rate_charge: 0 });
    expect(n(r.rate_charge)).toBe(0);
    expect(n(r.net_amount)).toBe(0);
  });

  test('discount comes off the RATE, so it scales with weight', () => {
    // 1 off a 100kg AWB is 100 off, not 1 off.
    expect(n(at({ type: CH_RECEIVABLE, qty: 100, rate_charge: 5, discount: 1 }).net_amount))
      .toBeCloseTo(400, 6);
  });

  test('a negative discount surcharges, per kg', () => {
    expect(n(at({ type: CH_RECEIVABLE, qty: 100, rate_charge: 5, discount: -1 }).net_amount))
      .toBeCloseTo(600, 6);
  });

  test('amount is pinned to 1 so the freight formula reproduces the aviation rule', () => {
    // net = (amount x rate - discount) x qty. Anything but 1 changes the maths
    // for every downstream consumer of Charge_Head.
    expect(at({ type: CH_RECEIVABLE, qty: 10 }).amount).toBe('1');
  });

  describe('Per Shipment', () => {
    const flat = { type: CH_RECEIVABLE, basis: 'Per Shipment', rate_charge: 750 };

    test('is the fee times how many, and ignores the weight-side fields', () => {
      // The same handling charge raised on three documents is three fees.
      const r = at({ ...flat, qty: 3, discount: 2 });
      expect(n(r.net_amount)).toBe(2250);
      expect(n(r.discount)).toBe(0);
    });

    test('no count at all is ONE, which is what every row stored before it meant', () => {
      const r = at(flat);
      expect(n(r.qty)).toBe(1);
      expect(n(r.rate_charge)).toBe(750);
      expect(n(r.net_amount)).toBe(750);
      // The freight formula, applied to what was stored, gives the same figure.
      expect((1 * n(r.rate_charge) - n(r.discount)) * n(r.qty)).toBe(750);
    });

    test('a count of ZERO is nothing, not one', () => {
      // `== null` and not `||`: typing 0 is a statement, and billing it as one
      // would put a fee on an invoice nobody asked for.
      expect(n(at({ ...flat, qty: 0 }).net_amount)).toBe(0);
    });

    test('does NOT fall back to the AWB rate - a fee is not a per-kg rate', () => {
      // 1.70 a kilo says nothing about what one document costs, and letting it
      // through would silently reprice a cleared fee at the AWB's rate.
      const r = at({ type: CH_RECEIVABLE, basis: 'Per Shipment', qty: 2 });
      expect(n(r.rate_charge)).toBe(0);
      expect(n(r.net_amount)).toBe(0);
    });

    test('records the basis it was priced on', () => {
      expect(at(flat).basis).toBe('Per Shipment');
      expect(at({ type: CH_RECEIVABLE, qty: 1 }).basis).toBe('Per Unit');
    });
  });

  describe('tax', () => {
    // Registered in Setup > Charges and carried onto the row, where it can
    // still be turned off for the one shipment that is exempt.
    const taxed = (extra) => at({
      type: CH_RECEIVABLE, qty: 100, rate_charge: 5, tax_apply: true, taxPerc: 17, ...extra,
    });

    test('is charged on the amount before tax', () => {
      const r = taxed();
      expect(n(r.tax_amount)).toBeCloseTo(85, 6);   // 500 x 17%
    });

    test('is INCLUDED in the net amount', () => {
      // An invoice's total is the sum of its charges' net amounts, so tax left
      // out of net_amount would print on the line and be missing from the
      // document - see makeInvoice.
      expect(n(taxed().net_amount)).toBeCloseTo(585, 6);
    });

    test('carries through the exchange rate like anything else', () => {
      expect(n(taxed().local_amount)).toBeCloseTo(585 * 280, 4);
    });

    test('the toggle off means no tax, whatever percentage the row carries', () => {
      // The percentage is kept as the charge was registered rather than wiped,
      // but it is stored as 0 so nothing downstream can apply it.
      const r = taxed({ tax_apply: false });
      expect(n(r.net_amount)).toBe(500);
      expect(r.taxPerc).toBe('0');
      expect(n(r.tax_amount)).toBe(0);
      expect(r.tax_apply).toBe(false);
    });

    test('applies to a Per Shipment fee too', () => {
      const r = at({
        type: CH_RECEIVABLE, basis: 'Per Shipment', rate_charge: 1000, qty: 2,
        tax_apply: true, taxPerc: 10,
      });
      expect(n(r.tax_amount)).toBeCloseTo(200, 6);
      expect(n(r.net_amount)).toBeCloseTo(2200, 6);
    });

    test('discount comes off BEFORE tax', () => {
      // Tax is charged on what is billed, not on what was quoted.
      const r = taxed({ discount: 1 });
      expect(n(r.tax_amount)).toBeCloseTo(68, 6);    // 400 x 17%
      expect(n(r.net_amount)).toBeCloseTo(468, 6);
    });
  });

  describe('exchange rate', () => {
    test('local amount is net x ex-rate', () => {
      expect(n(at({ type: CH_RECEIVABLE, qty: 100 }).local_amount)).toBeCloseTo(170 * 280, 6);
    });

    test('falls back to the AWB rate when the charge has none', () => {
      expect(n(at({ type: CH_RECEIVABLE, qty: 100 }).ex_rate)).toBe(280);
    });

    test('a charge can convert at its own rate', () => {
      const r = at({ type: CH_RECEIVABLE, qty: 100, ex_rate: 300 });
      expect(n(r.ex_rate)).toBe(300);
      expect(n(r.local_amount)).toBeCloseTo(170 * 300, 6);
    });

    test('a ZERO ex-rate is treated as 1, never as zero', () => {
      // || 1, not ?? 1. Multiplying by zero would wipe the charge out of the
      // books entirely, which is never what anyone means by a blank rate.
      const r = at({ type: CH_RECEIVABLE, qty: 100, ex_rate: 0 });
      expect(n(r.ex_rate)).toBe(1);
      expect(n(r.local_amount)).toBeCloseTo(170, 6);
    });

    test('no rate anywhere still gives 1', () => {
      expect(n(at({ type: CH_RECEIVABLE, qty: 10, rate_charge: 2 }, { sellingRate: 2 }).ex_rate))
        .toBe(1);
    });
  });

  describe('approval', () => {
    test('an approved charge keeps who and when', () => {
      const r = at({
        type: CH_RECEIVABLE, qty: 1, status: '1',
        approved_by: 'bilal', approval_date: '2026-08-14 10:00',
      });
      expect(r.status).toBe('1');
      expect(r.approved_by).toBe('bilal');
      expect(r.approval_date).toBe('2026-08-14 10:00');
    });

    test('withdrawing approval CLEARS who and when', () => {
      // Otherwise a name sits against a charge nobody currently backs.
      const r = at({
        type: CH_RECEIVABLE, qty: 1, status: '0',
        approved_by: 'bilal', approval_date: '2026-08-14 10:00',
      });
      expect(r.status).toBe('0');
      expect(r.approved_by).toBeNull();
      expect(r.approval_date).toBeNull();
    });

    test('a missing status is unapproved, and numeric 1 counts as approved', () => {
      expect(at({ type: CH_RECEIVABLE, qty: 1 }).status).toBe('0');
      expect(at({ type: CH_RECEIVABLE, qty: 1, status: 1 }).status).toBe('1');
    });
  });

  test('an aviation charge hangs off the AWB and never off an SE_Job', () => {
    const r = at({ type: CH_RECEIVABLE, qty: 1 });
    expect(r.AviationConsignmentId).toBe(7);
    expect(r.SEJobId).toBeNull();
  });

  test('an untaxed charge stores numbers, not nulls', () => {
    // The printing and ledger code reads these without guarding.
    const r = at({ type: CH_RECEIVABLE, qty: 1 });
    expect(r.taxPerc).toBe('0');
    expect(r.tax_amount).toBe('0');
    expect(r.tax_apply).toBe(false);
  });

  describe('isRealCharge', () => {
    test('keeps a row that names anything at all', () => {
      expect(isRealCharge({ charge: 3 })).toBeTruthy();
      expect(isRealCharge({ partyId: 5 })).toBeTruthy();
      expect(isRealCharge({ description: 'x' })).toBeTruthy();
      expect(isRealCharge({ qty: 100 })).toBeTruthy();
      expect(isRealCharge({ rate_charge: 2 })).toBeTruthy();
    });

    test('drops an untouched blank row', () => {
      expect(isRealCharge({})).toBeFalsy();
      expect(isRealCharge(null)).toBeFalsy();
    });

    test('keeps a row that only has a weight typed in', () => {
      // net_amount is derived, so testing it here would discard work in progress.
      expect(isRealCharge({ qty: 250 })).toBeTruthy();
    });
  });
});

/**
 * The charge master, as the flight screen receives it.
 *
 * THE BUG THIS EXISTS FOR. /getValues does not send the Charges row through
 * untouched - it reshapes it. A column added to the query and not added to
 * that projection is selected from the database, discarded, and arrives in the
 * browser as `undefined`; the screen reads it, gets nothing, and does nothing
 * at all. No error, no empty box - the feature just does not happen.
 *
 * That is how taxApply and fixAmount shipped in 1.2.1: both were added to the
 * SELECT and neither reached the browser, so a charge registered as taxed
 * raised an untaxed row and a charge with a fixed amount was priced at the
 * AWB's rate. It is also why approving an AWB could not find the Air Freight
 * charge - `short` had never been carried at all.
 *
 * So the projection is asserted FIELD BY FIELD. Anything the screen reads has
 * to be named here, which is the point.
 */
describe('chargeOption - what the flight screen gets', () => {
  const ROW = {
    id: 2, code: 2, name: 'Air Freight', short: 'AF', currency: 'USD',
    calculationType: 'Per Unit',
    defaultRecivableParty: 'Master Agent', defaultPaybleParty: 'Carrier',
    taxApply: 'Yes', taxPerc: '17', fixAmount: 2.5,
    // Columns the screen has no use for. Present to prove they are not just
    // passed through wholesale.
    reimbursable: true, climaxId: 88, status: true,
  };
  const opt = chargeOption(ROW);

  test('carries every field the charge row is built from', () => {
    // functions/aviationChargeRow reads exactly these. Add one there, add it
    // here - that is the whole contract.
    expect(Object.keys(opt).sort()).toEqual([
      'calculationType', 'code', 'currency', 'defaultPaybleParty',
      'defaultRecivableParty', 'fixAmount', 'id', 'label', 'name', 'short',
      'taxApply', 'taxPerc',
    ]);
  });

  test('name is the CHARGE NAME, because an invoice prints it', () => {
    // Charge_Head.particular is set from this. It used to be the "(2) AF"
    // label, so aviation invoices printed that where the charge name belongs.
    expect(opt.name).toBe('Air Freight');
  });

  test('label is how the dropdown reads it', () => {
    expect(opt.label).toBe('(2) AF');
  });

  test('short is carried - it is how the Air Freight charge is recognised', () => {
    expect(opt.short).toBe('AF');
  });

  test('tax and the fixed amount reach the screen', () => {
    // 'Yes'/'No' are STRINGS in Setup > Charges, not booleans; the screen
    // compares against the string, so it must arrive as one.
    expect(opt.taxApply).toBe('Yes');
    expect(opt.taxPerc).toBe('17');
    expect(opt.fixAmount).toBe(2.5);
  });

  test('an unset field is null, never undefined', () => {
    // undefined disappears from JSON entirely, so the screen cannot tell "not
    // configured" from "the server forgot to send it" - which is the failure
    // this whole block is about.
    const bare = chargeOption({ id: 1, code: 1, name: 'X', short: 'X' });
    expect(bare.taxApply).toBeNull();
    expect(bare.fixAmount).toBeNull();
    expect(bare.defaultPaybleParty).toBeNull();
    for (const [k, v] of Object.entries(bare)) {
      expect([k, v]).not.toEqual([k, undefined]);
    }
  });

  test('does not leak columns the screen has no business with', () => {
    expect(opt).not.toHaveProperty('reimbursable');
    expect(opt).not.toHaveProperty('climaxId');
  });
});

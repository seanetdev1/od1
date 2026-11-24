/**
 * Copying a charge sheet's heads from one side to the other - copiesAcross.
 *
 * A clearance file is billed out very nearly as it was bought in, so the
 * payable side is mostly a retyping of the receivable side. The button that
 * does the retyping is only worth having if it gets three things right, and
 * each of them fails SILENTLY - the copies look perfectly plausible either way:
 *
 *   - the party is re-derived for the side being copied to, never carried
 *     across. A payable posted against the client is money the books say we
 *     owe our own customer.
 *   - nothing that makes a line an ISSUED one comes with it. A copy that
 *     arrived pre-approved could be invoiced without anyone agreeing it.
 *   - a line already on the target side is not duplicated, so a second press
 *     of the button does not double the file's costs.
 */
import {
  copiesAcross, chargeCopyKey, perUnitQty, directLineAsCharge, computeNetAmount,
  RECEIVABLE, PAYABLE, PER_UNIT, PER_SHIPMENT,
} from 'functions/customsPricing';

// A blank of the kind the sheet makes: unapproved, unbilled, no id.
const blankOf = (type) => () => ({
  type,
  charge: null,
  particular: '',
  partyId: null,
  name: '',
  partyType: null,
  description: '',
  basis: 'Per Shipment',
  qty: 1,
  rate_charge: null,
  discount: null,
  net_amount: null,
  currency: '',
  ex_rate: null,
  local_amount: null,
  status: '0',
  approved_by: null,
  approval_date: null,
  InvoiceId: null,
});

// Charge 5 is billed to the client and bought from the shipping line - which
// is the whole point: the two sides do not name the same party.
const partyFor = (chargeId, receivable) => {
  if (String(chargeId) !== '5') return {};
  return receivable
    ? { partyId: 100, name: 'Client Co', partyType: 'Client' }
    : { partyId: 200, name: 'Carrier Co', partyType: 'Shipping-Line' };
};

const payableLine = (over = {}) => ({
  type: PAYABLE,
  charge: 5,
  particular: 'Terminal Handling',
  description: '',
  basis: 'Per Unit',
  qty: 4,
  rate_charge: 250,
  discount: 10,
  currency: 'USD',
  ex_rate: 280,
  net_amount: 960,
  local_amount: 268800,
  partyId: 200,
  name: 'Carrier Co',
  partyType: 'Shipping-Line',
  // The things that make it an issued line.
  id: 77,
  status: '1',
  approved_by: '12',
  approval_date: '2027-01-04',
  InvoiceId: 9,
  ...over,
});

// Everything ticked, which is the helper's default - see copiesAcross.
const copy = (charges, to = RECEIVABLE) =>
  copiesAcross(charges, to, { blank: blankOf(to), partyFor });

// Only the ids listed, which is what the screen passes.
const copySelected = (charges, ids, to = RECEIVABLE) =>
  copiesAcross(charges, to, {
    blank: blankOf(to),
    partyFor,
    isSelected: (c) => ids.includes(c.id),
  });

describe('what comes across', () => {
  test('the head and everything that prices it', () => {
    const [made] = copy([payableLine()]);
    expect(made).toMatchObject({
      type: RECEIVABLE,
      charge: 5,
      particular: 'Terminal Handling',
      basis: 'Per Unit',
      qty: 4,
      rate_charge: 250,
      discount: 10,
      currency: 'USD',
      ex_rate: 280,
      net_amount: 960,
      local_amount: 268800,
    });
  });

  test('but NOT the party - it is re-derived for the side copied to', () => {
    // The payable is owed to the carrier. The receivable for the same head is
    // billed to the client, and carrying the carrier across would put a sale
    // against the account of the company we bought it from.
    const [made] = copy([payableLine()]);
    expect(made.partyId).toBe(100);
    expect(made.name).toBe('Client Co');
    expect(made.partyType).toBe('Client');
  });

  test('and NOT approval, invoice or id', () => {
    const [made] = copy([payableLine()]);
    expect(made.status).toBe('0');
    expect(made.approved_by).toBeNull();
    expect(made.approval_date).toBeNull();
    expect(made.InvoiceId).toBeNull();
    expect(made.id).toBeUndefined();
  });

  test('a head with no default party for this side keeps the blank one', () => {
    // Not the source line's party as a fallback: no party at all is a gap
    // somebody fills in, where the wrong party is a posting nobody questions.
    const [made] = copy([payableLine({ charge: 9 })]);
    expect(made.partyId).toBeNull();
    expect(made.name).toBe('');
  });
});

describe('what is left alone', () => {
  test('a head already on this side is not copied again', () => {
    const charges = [
      payableLine(),
      { type: RECEIVABLE, charge: 5, description: '' },
    ];
    expect(copy(charges)).toHaveLength(0);
  });

  test('so pressing the button twice adds nothing the second time', () => {
    let charges = [payableLine()];
    charges = [...charges, ...copy(charges)];
    expect(charges).toHaveLength(2);
    expect(copy(charges)).toHaveLength(0);
  });

  test('the SAME head with a different description is a different line', () => {
    // A file can carry two transport lines for two legs, told apart only by
    // what is typed in the description.
    const charges = [
      payableLine({ description: 'Leg 1' }),
      payableLine({ description: 'Leg 2' }),
      { type: RECEIVABLE, charge: 5, description: 'Leg 1' },
    ];
    const made = copy(charges);
    expect(made).toHaveLength(1);
    expect(made[0].description).toBe('Leg 2');
  });

  test('the other side is not touched, and neither is the source', () => {
    const source = payableLine();
    copy([source]);
    expect(source.type).toBe(PAYABLE);
    expect(source.partyId).toBe(200);
  });
});

describe('the id types the column actually stores', () => {
  test('a saved "5" and a picked 5 are the same line', () => {
    // Charge_Head.charge is a STRING column over an integer master, so the
    // same charge is 5 on screen and "5" once it has been round-tripped.
    // Keyed raw, a copy would duplicate every head that had been saved.
    expect(chargeCopyKey({ charge: 5 })).toBe(chargeCopyKey({ charge: '5' }));
    const charges = [payableLine({ charge: '5' }), { type: RECEIVABLE, charge: 5 }];
    expect(copy(charges)).toHaveLength(0);
  });
});

describe('copying the other way', () => {
  test('receivable to payable derives the payable party', () => {
    const charges = [{
      type: RECEIVABLE, charge: 5, description: '', basis: 'Per Shipment',
      net_amount: 5000, partyId: 100, name: 'Client Co', partyType: 'Client',
    }];
    const [made] = copiesAcross(charges, PAYABLE, { blank: blankOf(PAYABLE), partyFor });
    expect(made.type).toBe(PAYABLE);
    expect(made.partyId).toBe(200);
    expect(made.name).toBe('Carrier Co');
  });
});

describe('an empty sheet', () => {
  test('produces nothing rather than throwing', () => {
    expect(copy([])).toEqual([]);
    expect(copy(null)).toEqual([]);
    expect(copy(undefined)).toEqual([]);
  });
});

describe('only what was ticked', () => {
  /* Copying a whole sheet is the wrong default on a file where half the costs
   * are not rebilled - a disbursement paid on the client's behalf is not a
   * sale - and un-copying afterwards is more work than ticking four boxes. */
  const sheet = [
    payableLine({ id: 1, description: 'Agency' }),
    payableLine({ id: 2, description: 'Terminal' }),
    payableLine({ id: 3, description: 'Transport' }),
  ];

  test('copies the ticked lines and leaves the rest', () => {
    const made = copySelected(sheet, [1, 3]);
    expect(made.map((c) => c.description)).toEqual(['Agency', 'Transport']);
  });

  test('NOTHING is copied when nothing is ticked', () => {
    // An empty selection is somebody who has not chosen yet, not somebody
    // asking for everything - which is the reading that would silently double
    // a file's charges on a stray click.
    expect(copySelected(sheet, [])).toEqual([]);
  });

  test('a line with no id cannot be ticked, so it is never copied', () => {
    // The tick boxes are keyed by Charge_Head id, so an unsaved row has
    // nothing to be selected by.
    const withUnsaved = [...sheet, payableLine({ id: undefined, description: 'Typed just now' })];
    const made = copySelected(withUnsaved, [1]);
    expect(made).toHaveLength(1);
    expect(made[0].description).toBe('Agency');
  });

  test('the skip-what-is-already-here rule still applies to the ticked ones', () => {
    const charges = [...sheet, { type: RECEIVABLE, charge: 5, description: 'Agency' }];
    const made = copySelected(charges, [1, 2]);
    expect(made.map((c) => c.description)).toEqual(['Terminal']);
  });
});

describe('copying a Direct Job line from the Summary', () => {
  /* Money entered through Accounts > Direct Job E / R shows only in the
   * Summary. Ticking its row there and pressing Copy brings it onto the sheet
   * - an expense to the receivable side, to bill the client for it. */
  const directLine = (over = {}) => ({
    id: 41,
    charge: '5',
    type: 'expense',
    entryNo: 'SNS-DE-12/26',
    description: 'Cartage',
    basis: 'shipment',
    quantity: 1,
    currency: 'PKR',
    exRate: 1,
    amount: 1500,
    ...over,
  });

  test('an expense is a payable, a revenue a receivable', () => {
    expect(directLineAsCharge(directLine()).type).toBe(PAYABLE);
    expect(directLineAsCharge(directLine({ type: 'revenue' })).type).toBe(RECEIVABLE);
  });

  test('copies at the total the voucher posted', () => {
    const [made] = copy([directLineAsCharge(directLine())]);
    expect(made).toMatchObject({
      type: RECEIVABLE, charge: '5', description: 'Cartage',
      basis: PER_SHIPMENT, qty: 1, rate_charge: 1500, currency: 'PKR', ex_rate: 1,
    });
    expect(computeNetAmount(made)).toBe(1500);
  });

  test('with the receivable party, not the vendor who was paid', () => {
    const [made] = copy([directLineAsCharge(directLine())]);
    expect(made.partyId).toBe(100);
    expect(made.partyType).toBe('Client');
    expect(made.status).toBe('0');
    expect(made.InvoiceId).toBeNull();
  });

  test('the stored amount is the line total, so the rate is per unit', () => {
    // 4 x 250 less a 100 discount on the line, stored as 900.
    const made = directLineAsCharge(directLine({ basis: 'unit', quantity: 4, amount: 900 }));
    expect(made).toMatchObject({ basis: PER_UNIT, qty: 4, rate_charge: 225 });
    expect(computeNetAmount(made)).toBe(900);
  });

  test('a quantity that does not divide the total becomes one of the total', () => {
    const made = directLineAsCharge(directLine({ quantity: 3, amount: 1000 }));
    expect(made).toMatchObject({ qty: 1, rate_charge: 1000 });
  });

  test('a foreign-currency line keeps its rate; PKR converts at 1', () => {
    const usd = directLineAsCharge(directLine({ currency: 'USD', exRate: 280, amount: 50 }));
    expect(usd).toMatchObject({ currency: 'USD', ex_rate: 280, local_amount: 14000 });
    expect(directLineAsCharge(directLine({ exRate: 5 })).ex_rate).toBe(1);
  });

  test('only a ticked line comes across, beside the sheet\'s own', () => {
    const lines = [
      payableLine({ id: 1, description: 'Agency' }),
      directLineAsCharge(directLine({ id: 41, description: 'Cartage' })),
      directLineAsCharge(directLine({ id: 42, charge: '9', description: 'Lifter' })),
    ];
    const made = copiesAcross(lines, RECEIVABLE, {
      blank: blankOf(RECEIVABLE),
      partyFor,
      isSelected: (c) => c.id === 1 || c.directLineId === 41,
    });
    expect(made.map((c) => c.description)).toEqual(['Agency', 'Cartage']);
    // The marker does not ride along onto the new line.
    expect(made[1].directLineId).toBeUndefined();
  });

  test('a head already billed with that description is not copied twice', () => {
    const lines = [
      { type: RECEIVABLE, charge: 5, description: 'Cartage' },
      directLineAsCharge(directLine()),
    ];
    expect(copy(lines)).toHaveLength(0);
  });
});

describe('how many units a Per Unit charge is for', () => {
  test('the pieces on the declaration, not its weight', () => {
    // Clearance work is charged per package, per case, per carton. The freight
    // sheet seeds from chargeable weight, which would price a hundred cartons
    // as though they were 1,240 of something.
    expect(perUnitQty({ packages: 100, grossWeight: 1240, netWeight: 1100 })).toBe(100);
  });

  test('one when the declaration has no piece count yet', () => {
    // Not zero: a charge priced at zero units reads as a charge worth nothing.
    expect(perUnitQty({ packages: null })).toBe(1);
    expect(perUnitQty({ packages: 0 })).toBe(1);
    expect(perUnitQty({})).toBe(1);
    expect(perUnitQty(undefined)).toBe(1);
  });

  test('reads a piece count that arrived as a string', () => {
    expect(perUnitQty({ packages: '250' })).toBe(250);
  });
});

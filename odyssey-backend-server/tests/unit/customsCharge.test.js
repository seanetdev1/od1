/**
 * Customs charge pricing.
 *
 * A customs charge is a Charge_Head, so it is priced with the freight formula:
 * net_amount = (amount x rate_charge - discount) x qty, with `amount` pinned
 * to 1. These tests pin the behaviour that makes that equivalent to the
 * customs rule, and the edge cases where a wrong answer silently moves money.
 */
const {
  chargeValues, isRealCharge, CH_RECEIVABLE, CH_PAYABLE,
} = require('../../functions/customsCharge');

const JOB = { exRate: 280 };
const at = (c, job = JOB) => chargeValues(c, 0, 7, job);
const n = (v) => Number(v);

describe('customs charge pricing', () => {
  test('a flat fee is its Amount, because an unset quantity counts as one', () => {
    // The common case by far: an agency fee is one figure for the file. It
    // reaches the same answer through the qty x rate formula rather than
    // through a special case, which is what lets the quantity box be open on
    // one of these lines at all.
    const r = at({ type: CH_RECEIVABLE, basis: 'Per Shipment', rate_charge: 25000 });
    expect(n(r.net_amount)).toBe(25000);
    expect(n(r.qty)).toBe(1);
  });

  test('a quantity on a flat fee is KEPT, and multiplies it', () => {
    // It used to be rewritten to 1 and ignored. A box that discards what is
    // typed into it is worse than one that is greyed out, and the invoice
    // prints Qty beside Amount - so "3 x 5,000 = 5,000" would reach a client.
    const r = at({ type: CH_RECEIVABLE, basis: 'Per Shipment', rate_charge: 5000, qty: 3 });
    expect(n(r.qty)).toBe(3);
    expect(n(r.net_amount)).toBe(15000);
  });

  test('Per Shipment is still the default basis', () => {
    expect(at({ type: CH_RECEIVABLE, rate_charge: 25000 }).basis).toBe('Per Shipment');
  });

  test('the basis no longer changes the arithmetic', () => {
    // Every Per Shipment row on the live book already satisfied
    // qty x rate = net, so making this uniform revalued nothing stored.
    const priced = { type: CH_RECEIVABLE, qty: 3, rate_charge: 5000 };
    const flat = at({ ...priced, basis: 'Per Shipment' });
    const unit = at({ ...priced, basis: 'Per Unit' });
    expect(n(flat.net_amount)).toBe(n(unit.net_amount));
    expect(n(flat.net_amount)).toBe(15000);
  });

  test('Per Unit is qty x (rate - discount)', () => {
    const r = at({ type: CH_RECEIVABLE, basis: 'Per Unit', qty: 4, rate_charge: 7500, discount: 500 });
    expect(n(r.net_amount)).toBe(4 * (7500 - 500));
  });

  test('an unpriced charge is zero - a GD has no rate to fall back to', () => {
    // Unlike aviation, where an AWB supplies the rate. Nothing on a clearance
    // file could have supplied this figure, so 0 is the honest answer.
    const r = at({ type: CH_RECEIVABLE, basis: 'Per Unit', qty: 4 });
    expect(n(r.net_amount)).toBe(0);
  });

  test('local amount converts at the charge ex-rate', () => {
    const r = at({ type: CH_PAYABLE, basis: 'Per Shipment', rate_charge: 100, ex_rate: 3 });
    expect(n(r.local_amount)).toBe(300);
  });

  test('falls back to the job ex-rate when the charge does not name one', () => {
    // Without this the screen would show net x 1 while the server stored
    // net x the job's rate - the same charge, two amounts.
    const r = at({ type: CH_RECEIVABLE, basis: 'Per Shipment', rate_charge: 100 });
    expect(n(r.ex_rate)).toBe(280);
    expect(n(r.local_amount)).toBe(28000);
  });

  test('a zero ex-rate becomes 1 rather than wiping the charge out of the books', () => {
    const r = at({ type: CH_RECEIVABLE, basis: 'Per Shipment', rate_charge: 100, ex_rate: 0 });
    expect(n(r.ex_rate)).toBe(1);
    expect(n(r.local_amount)).toBe(100);
  });

  test('keeps the app misspellings, which the ledger branches on', () => {
    // "Correcting" these would silently misclassify every customs invoice.
    expect(at({ type: 'Payble' }).type).toBe('Payble');
    expect(at({ type: 'Recievable' }).type).toBe('Recievable');
    expect(at({ type: 'Receivable' }).type).toBe('Recievable');
    expect(at({}).type).toBe('Recievable');
  });

  test('hangs off the GD and never off an SE_Job', () => {
    const r = at({ type: CH_RECEIVABLE, net_amount: 1 });
    expect(r.CustomsJobId).toBe(7);
    expect(r.SEJobId).toBeNull();
  });

  test('an unapproved charge carries no approver', () => {
    const r = at({ type: CH_RECEIVABLE, net_amount: 1, status: '0', approved_by: 3, approval_date: '2026-08-19' });
    expect(r.status).toBe('0');
    expect(r.approved_by).toBeNull();
    expect(r.approval_date).toBeNull();
  });

  test('tax fields are numbers, not nulls, for the ledger and print code', () => {
    const r = at({ type: CH_RECEIVABLE, net_amount: 1 });
    expect(r.tax_apply).toBe(false);
    expect(r.taxPerc).toBe('0');
    expect(r.tax_amount).toBe('0');
  });
});

describe('sales tax on a customs charge', () => {
  const PKR = { exRate: 1 };

  test('a taxed service charge: 2,500 at 15% is 375, and the net includes it', () => {
    // The legacy JI-2378/27: SERVICES CHARGES 2,500 + 375 SRB = 2,875.
    const r = at({ type: CH_RECEIVABLE, rate_charge: 2500, tax_apply: true, taxPerc: 15 }, PKR);
    expect(r.tax_apply).toBe(true);
    expect(n(r.taxPerc)).toBe(15);
    expect(n(r.tax_amount)).toBe(375);
    expect(n(r.net_amount)).toBe(2875);
    expect(n(r.local_amount)).toBe(2875);
  });

  test('the tax is on the whole line - quantity and discount included', () => {
    const r = at({ type: CH_RECEIVABLE, basis: 'Per Unit', qty: 2, rate_charge: 1100, discount: 100, tax_apply: true, taxPerc: 15 }, PKR);
    expect(n(r.tax_amount)).toBe(300); // 2 x 1,000 x 15%
    expect(n(r.net_amount)).toBe(2300);
  });

  test('a rate with the box unticked is not charged', () => {
    const r = at({ type: CH_RECEIVABLE, rate_charge: 2500, tax_apply: false, taxPerc: 15 }, PKR);
    expect(n(r.tax_amount)).toBe(0);
    expect(n(r.net_amount)).toBe(2500);
  });

  test('a MIGRATED line - tax amount but no rate - keeps its tax on re-save', () => {
    // The charge-line import carried TaxAmount but not the percentage. Taken
    // at face value, saving the job again would zero the sales tax.
    const r = at({ type: CH_RECEIVABLE, rate_charge: 2500, tax_apply: true, taxPerc: 0, tax_amount: 375 }, PKR);
    expect(n(r.taxPerc)).toBe(15);
    expect(n(r.tax_amount)).toBe(375);
  });
});

describe('which rows are worth saving', () => {
  test('keeps a row that carries only a typed flat fee', () => {
    // A Per Shipment charge is nothing BUT its net amount, so testing every
    // field except that one would discard the most common charge on the file.
    expect(isRealCharge({ net_amount: 25000 })).toBeTruthy();
  });

  test('keeps a row that names a charge, a party or a description', () => {
    expect(isRealCharge({ charge: 4 })).toBeTruthy();
    expect(isRealCharge({ partyId: 9 })).toBeTruthy();
    expect(isRealCharge({ description: 'Terminal handling' })).toBeTruthy();
  });

  test('drops an untouched row', () => {
    // An "Add +" the user thought better of. Saving it would put a blank
    // charge on the job that has to be deleted by hand later.
    expect(isRealCharge({})).toBeFalsy();
    expect(isRealCharge(null)).toBeFalsy();
  });
});

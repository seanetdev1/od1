/**
 * Sales tax onto its own account at approval - functions/invoiceTaxSplit.
 *
 * The case it exists for: SERVICES CHARGES 2,500 at 15%. The client owes
 * 2,875; income is 2,500 and the 375 goes to the tax account.
 */
const { lineTaxIn, invoiceTax, splitContra } = require('../../functions/invoiceTaxSplit');

// A customs line as functions/customsCharge stores it: tax on top of the base.
const customs = (x = {}) => ({
  CustomsJobId: 9, type: 'Recievable', tax_apply: true,
  qty: '1', rate_charge: '2500', discount: '0',
  tax_amount: '375', net_amount: '2875', local_amount: '2875', ex_rate: '1', ...x,
});

describe('the tax inside one line', () => {
  test('customs: the line tax on top of qty x rate', () => {
    expect(lineTaxIn(customs())).toBe(375);
  });

  test('a MIGRATED customs line carries its tax beside the net, not in it - nothing to move', () => {
    expect(lineTaxIn(customs({ net_amount: '2500', local_amount: '2500' }))).toBe(0);
  });

  test('an untaxed line has none, whatever tax_amount says', () => {
    // The freight sheet leaves tax_amount behind when the box is unticked.
    expect(lineTaxIn(customs({ tax_apply: false }))).toBe(0);
  });

  test('freight: tax_amount is per unit', () => {
    // (1 x 1000 - 0 + 150) x 2 = 2,300, of which 300 is tax.
    expect(lineTaxIn({
      SEJobId: 4, tax_apply: true, amount: '1', rate_charge: '1000', discount: '0',
      qty: '2', tax_amount: '150', net_amount: '2300',
    })).toBe(300);
  });

  test('freight: a line that holds its tax for the whole line is read that way too', () => {
    expect(lineTaxIn({
      SEJobId: 4, tax_apply: true, amount: '1', rate_charge: '1000', discount: '0',
      qty: '2', tax_amount: '300', net_amount: '2300',
    })).toBe(300);
  });

  test('freight: a line that matches neither is left alone rather than guessed', () => {
    expect(lineTaxIn({
      SEJobId: 4, tax_apply: true, amount: '1', rate_charge: '1000', discount: '0',
      qty: '2', tax_amount: '150', net_amount: '9999',
    })).toBe(0);
  });

  test('aviation: the line tax, inside its net', () => {
    expect(lineTaxIn({ AviationConsignmentId: 3, tax_apply: true, tax_amount: '50', net_amount: '550' })).toBe(50);
  });
});

describe('the tax on an invoice', () => {
  test('the example: 375 of a 2,875 invoice', () => {
    expect(invoiceTax({ charges: [customs()], payType: 'Recievable', inPkr: true }))
      .toEqual({ amount: 375, defaultAmount: 375 });
  });

  test('only the taxed lines count', () => {
    const duty = customs({ tax_apply: false, rate_charge: '40000', tax_amount: '0', net_amount: '40000', local_amount: '40000' });
    expect(invoiceTax({ charges: [customs(), duty], payType: 'Recievable', inPkr: true }).amount).toBe(375);
  });

  test('a foreign-currency invoice: its own currency, and rupees beside it', () => {
    const usd = customs({ rate_charge: '100', tax_amount: '15', net_amount: '115', local_amount: '32200', ex_rate: '280' });
    expect(invoiceTax({ charges: [usd], payType: 'Recievable', inPkr: false }))
      .toEqual({ amount: 15, defaultAmount: 4200 });
    // On a rupee invoice the total is summed from local amounts, so the tax is too.
    expect(invoiceTax({ charges: [usd], payType: 'Recievable', inPkr: true }).amount).toBe(4200);
  });

  test('a netted invoice nets its tax the same way', () => {
    const pay = customs({ type: 'Payble', rate_charge: '1000', tax_amount: '150', net_amount: '1150', local_amount: '1150' });
    expect(invoiceTax({ charges: [customs(), pay], payType: 'Recievable', inPkr: true }).amount).toBe(225);
    // ...and moves nothing when the other side's tax is the larger.
    expect(invoiceTax({ charges: [pay], payType: 'Recievable', inPkr: true }).amount).toBe(0);
  });
});

describe('splitting the income line', () => {
  test('income 2,500, tax 375', () => {
    expect(splitContra({ amount: 2875, defaultAmount: 2875, tax: { amount: 375, defaultAmount: 375 } })).toEqual([
      { to: 'main', amount: 2500, defaultAmount: 2500 },
      { to: 'tax', amount: 375, defaultAmount: 375 },
    ]);
  });

  test('no tax and no disbursements: the line exactly as it came', () => {
    expect(splitContra({ amount: '2875.00', defaultAmount: 2875 }))
      .toEqual([{ to: 'main', amount: '2875.00', defaultAmount: 2875 }]);
  });

  test('tax and disbursements together, and the three still add up', () => {
    const parts = splitContra({
      amount: 42875, defaultAmount: 42875,
      tax: { amount: 375, defaultAmount: 375 },
      reimbursable: { amount: 40000, defaultAmount: 40000 },
    });
    expect(parts).toEqual([
      { to: 'main', amount: 2500, defaultAmount: 2500 },
      { to: 'tax', amount: 375, defaultAmount: 375 },
      { to: 'disbursement', amount: 40000, defaultAmount: 40000 },
    ]);
    expect(parts.reduce((t, p) => t + p.amount, 0)).toBe(42875);
  });

  test('a round off folded into income stays with income, not the tax', () => {
    const [main, tax] = splitContra({ amount: 2875.4, defaultAmount: 2875, tax: { amount: 375, defaultAmount: 375 } });
    expect(main.amount).toBe(2500.4);
    expect(tax.amount).toBe(375);
  });

  test('never a split that leaves the income line at nothing', () => {
    expect(splitContra({ amount: 375, defaultAmount: 375, tax: { amount: 375, defaultAmount: 375 } }))
      .toEqual([{ to: 'main', amount: 375, defaultAmount: 375 }]);
  });

  test('the disbursement split alone is what it always was', () => {
    // The round-off branch that passes no rupee amount: counted as nothing.
    expect(splitContra({ amount: 1000, defaultAmount: undefined, reimbursable: { amount: 400, defaultAmount: 400 } }))
      .toEqual([
        { to: 'main', amount: 600, defaultAmount: 0 },
        { to: 'disbursement', amount: 400, defaultAmount: 0 },
      ]);
  });
});

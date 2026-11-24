const { partyAmount, planSettlement } = require('../../functions/advanceSettlement');
const { advanceRows } = require('../../functions/jobBalancingAdvances');

/* Settling an advance: knock-offs only, capped at what the voucher brought in
 * (the user's choice, 2026-11-06). Hasnain Cargo's ACS-BRV-00856/24 is the
 * running example: 1,775,000 received, 96,386 knocked off. */
const inv = (over = {}) => ({
  invoice_No: 'JI-1', payType: 'Recievable', currency: 'PKR', total: '1000000', roundOff: '0',
  recieved: '0', paid: '0', ownParty: true, ...over,
});
const advance = { voucher_Id: 'ACS-BRV-00856/24', currency: 'PKR', amount: 1775000 };

describe('partyAmount', () => {
  test('a receipt is positive, a payment negative - its party lines only', () => {
    expect(partyAmount([
      { accountType: 'partyAccount', type: 'credit', amount: '1775000' },
      { accountType: 'payAccount', type: 'debit', amount: '1775000' },
    ])).toBe(1775000);
    expect(partyAmount([
      { accountType: 'partyAccount', type: 'debit', amount: '500.5' },
      { accountType: 'Tax Account', type: 'debit', amount: '20' },
    ])).toBe(-500.5);
  });
});

describe('planSettlement', () => {
  const prior = new Map([['10', 96386]]);
  const base = new Map([['10', inv({ invoice_No: 'JI-OLD', total: '96386', recieved: '96386' })]]);

  test('ticks within what is left: each invoice moves by its share; the rest stays as advance', () => {
    const invoices = new Map([...base, ['20', inv({ invoice_No: 'JI-685', total: '1263520.10' })]]);
    const plan = planSettlement({ voucher: advance, prior, requested: [{ id: 20, receiving: 1263520.1 }], invoices });
    expect(plan.error).toBeUndefined();
    expect(plan.changes).toEqual([{ id: '20', column: 'recieved', share: 1263520.1, change: 1263520.1 }]);
    expect(plan.applied).toBe(1359906.1);
    expect(plan.left).toBe(415093.9);
  });

  test('more than the voucher brought in is refused - it used to grow the receipt', () => {
    const invoices = new Map([...base, ['20', inv({ total: '2000000' })]]);
    const plan = planSettlement({ voucher: advance, prior, requested: [{ id: 20, receiving: 1700000 }], invoices });
    expect(plan.error).toMatch(/ACS-BRV-00856\/24 is 1,775,000\.00; the invoices ticked come to 1,796,386\.00 - 21,386\.00 more than it has/);
  });

  test('an invoice cannot be settled past what it is for', () => {
    const invoices = new Map([['20', inv({ total: '1000', recieved: '600' })]]);
    const plan = planSettlement({ voucher: advance, requested: [{ id: 20, receiving: 500 }], invoices });
    expect(plan.error).toMatch(/would be settled 100\.00 more than it is for/);
  });

  test("what is settled is the invoice's knock-offs, not a received figure an edit wiped", () => {
    // ACS-JI-1303/26: 251,860, all knocked off, its received cut to 8,173.75.
    const wiped = inv({ invoice_No: 'ACS-JI-1303/26', total: '251860', recieved: '8173.75', knockedOff: 251860 });
    const plan = planSettlement({ voucher: advance, requested: [{ id: 30, receiving: 243686.25 }], invoices: new Map([['30', wiped]]) });
    expect(plan.error).toBe('ACS-JI-1303/26 would be settled 243,686.25 more than it is for.');
  });

  test("unticking gives the invoice's share back to the advance", () => {
    const plan = planSettlement({ voucher: advance, prior, requested: [{ id: 10, receiving: 0 }], invoices: base });
    expect(plan.changes).toEqual([{ id: '10', column: 'recieved', share: 0, change: -96386 }]);
    expect(plan.left).toBe(1775000);
  });

  test("another party's invoice, or one in another currency, is refused", () => {
    expect(planSettlement({ voucher: advance, requested: [{ id: 20, receiving: 1 }],
      invoices: new Map([['20', inv({ ownParty: false })]]) }).error).toMatch(/not this party's/);
    expect(planSettlement({ voucher: advance, requested: [{ id: 20, receiving: 1 }],
      invoices: new Map([['20', inv({ currency: 'USD' })]]) }).error).toMatch(/in USD; ACS-BRV-00856\/24 is in PKR/);
  });

  test('a payment settles bills; an invoice on it would settle the other way', () => {
    const payment = { voucher_Id: 'BPV-1', currency: 'PKR', amount: -5000 };
    const bill = inv({ payType: 'Payble', total: '3000' });
    const ok = planSettlement({ voucher: payment, requested: [{ id: 1, receiving: 3000 }], invoices: new Map([['1', bill]]) });
    expect(ok.changes[0]).toMatchObject({ column: 'paid', change: 3000 });
    expect(ok.left).toBe(-2000);
    expect(planSettlement({ voucher: payment, requested: [{ id: 2, receiving: 100 }],
      invoices: new Map([['2', inv()]]) }).error).toMatch(/is a payment; what is ticked would settle the other way/);
  });

  test('a negative or non-numeric amount is refused', () => {
    expect(planSettlement({ voucher: advance, requested: [{ id: 20, receiving: -5 }],
      invoices: new Map([['20', inv()]]) }).error).toMatch(/must be a number, zero or more/);
  });
});

describe('advanceRows (Job Balancing)', () => {
  const row = (over = {}) => ({
    voucherId: 21920, voucher_Id: 'ACS-BRV-00856/24', createdAt: '2024-04-01', currency: 'PKR', exRate: 1,
    CompanyId: 3, partyName: 'HASNAIN', acc: 5686, amount: '1775000', applied: '96386',
    clientName: 'HASNAIN CARGO SERVICES', types: 'Shipper', ...over,
  });

  test("a receipt's money left over: an invoice-shaped row whose balance is minus that", () => {
    const [r] = advanceRows([row()]);
    expect(r).toMatchObject({
      advance: true, voucherId: 21920, invoice_No: 'ACS-BRV-00856/24', payType: 'Recievable',
      total: '0', recieved: '1678614', paid: '0', party_Name: 'HASNAIN CARGO SERVICES', SE_Job: null, Charge_Heads: [],
    });
    expect(Number(r.total) - Number(r.recieved)).toBe(-1678614);
  });

  test('fully knocked off: no row', () => {
    expect(advanceRows([row({ applied: '1775000' })])).toEqual([]);
  });

  test("a payment's money left over is on the payable side", () => {
    const [r] = advanceRows([row({ amount: '-5000', applied: '-3000' })]);
    expect(r).toMatchObject({ payType: 'Payble', paid: '2000', recieved: '0' });
  });

  test("the pay type filter, and an overseas agent's left out", () => {
    expect(advanceRows([row()], 'Payble')).toEqual([]);
    expect(advanceRows([row()], 'All')).toHaveLength(1);
    expect(advanceRows([row({ types: 'Overseas Agent' })])).toEqual([]);
  });
});

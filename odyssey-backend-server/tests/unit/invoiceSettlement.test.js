const { settlementFor, STATUS } = require('../../functions/invoiceSettlement');

describe('settlementFor', () => {
  it('reports an invoice with no adjustments as open and unpaid', () => {
    expect(settlementFor([], 1000, true)).toEqual({
      settled: 0, paid: 0, recieved: 0, status: STATUS.OPEN,
    });
  });

  it('treats a missing adjustments list the same as an empty one', () => {
    // The legacy payload omits the key entirely when an invoice was never
    // settled, so this is the common case rather than a defensive edge.
    expect(settlementFor(undefined, 1000, true).status).toBe(STATUS.OPEN);
    expect(settlementFor(null, 1000, false).status).toBe(STATUS.OPEN);
  });

  it('sums part payments and marks the invoice part settled', () => {
    const r = settlementFor([{ Amount: 300 }, { Amount: 250 }], 1000, true);
    expect(r.settled).toBe(550);
    expect(r.recieved).toBe(550);
    expect(r.status).toBe(STATUS.PART);
  });

  it('marks an invoice settled when the adjustments cover it exactly', () => {
    const r = settlementFor([{ Amount: 600 }, { Amount: 400 }], 1000, true);
    expect(r.status).toBe(STATUS.SETTLED);
    expect(r.recieved).toBe(1000);
  });

  it('does not let float drift turn a settled invoice into a part-settled one', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. Without a tolerance this
    // invoice would read as part settled forever.
    const r = settlementFor([{ Amount: 0.1 }, { Amount: 0.2 }], 0.3, true);
    expect(r.status).toBe(STATUS.SETTLED);
  });

  it('marks an overpayment as part settled rather than settled', () => {
    // Over-settlement is a real condition in the legacy data and must not be
    // rounded away into "fully paid" - it needs to stay visible.
    expect(settlementFor([{ Amount: 1200 }], 1000, true).status).toBe(STATUS.PART);
  });

  it('puts the figure in paid for a payable and recieved for a receivable', () => {
    const payable = settlementFor([{ Amount: 500 }], 500, false);
    expect(payable.paid).toBe(500);
    expect(payable.recieved).toBe(0);

    const receivable = settlementFor([{ Amount: 500 }], 500, true);
    expect(receivable.recieved).toBe(500);
    expect(receivable.paid).toBe(0);
  });

  it('handles amounts that arrive as strings', () => {
    // SQL Server decimals come back as strings through tedious.
    expect(settlementFor([{ Amount: '250.50' }, { Amount: '249.50' }], '500', true).status)
      .toBe(STATUS.SETTLED);
  });

  it('ignores null and unparseable amounts instead of producing NaN', () => {
    const r = settlementFor([{ Amount: null }, { Amount: 'n/a' }, { Amount: 100 }], 100, true);
    expect(r.settled).toBe(100);
    expect(r.status).toBe(STATUS.SETTLED);
  });

  it('does not report a zero-total invoice with no payments as settled', () => {
    // 0 settled against a 0 total is arithmetically "in full", but an invoice
    // nobody has paid anything towards is open, not closed.
    expect(settlementFor([], 0, true).status).toBe(STATUS.OPEN);
  });
});

import { hasSettlementLine, linesTotal, voucherTotals, settlementAmount, defaultLineSide, isReceipt } from '../functions/voucherTotals';

describe('the Voucher screen totals', () => {
  const bank = { type: 'credit', amount: 300 };

  test('a payment: the lines on one side, the bank line on the other', () => {
    const lines = [{ type: 'debit', amount: 100 }, { type: 'debit', amount: 200 }];
    expect(voucherTotals(lines, bank, 'BPV')).toEqual({ debit: 300, credit: 300 });
  });

  test('a line taken out comes off the total, and off the bank line with it', () => {
    const lines = [{ type: 'debit', amount: 100 }];
    const settled = { ...bank, amount: linesTotal(lines) };
    expect(voucherTotals(lines, settled, 'BPV')).toEqual({ debit: 100, credit: 100 });
  });

  test('a JV has no settlement line, whatever is left in state', () => {
    const lines = [{ type: 'debit', amount: 50 }, { type: 'credit', amount: 50 }];
    expect(voucherTotals(lines, bank, 'JV')).toEqual({ debit: 50, credit: 50 });
    expect(hasSettlementLine('TV')).toBe(false);
    expect(hasSettlementLine('CRV')).toBe(true);
  });

  test('switching a JV line between debit and credit moves its amount across', () => {
    const before = [{ type: 'debit', amount: 50 }, { type: 'credit', amount: 50 }];
    const flipped = before.map((l) => ({ ...l, type: l.type === 'debit' ? 'credit' : 'debit' }));
    expect(voucherTotals(flipped, undefined, 'JV')).toEqual({ debit: 50, credit: 50 });
    expect(voucherTotals([{ type: 'credit', amount: 50 }, { type: 'credit', amount: 50 }], undefined, 'JV'))
      .toEqual({ debit: 0, credit: 100 });
  });

  test('a blank amount counts as nothing, not NaN', () => {
    expect(linesTotal([{ amount: '' }, { amount: '25.5' }, {}])).toBe(25.5);
    expect(voucherTotals([{ type: 'debit', amount: '' }], { type: 'credit' }, 'CPV')).toEqual({ debit: 0, credit: 0 });
  });
});

/* A PAYMENT OR RECEIPT WITH LINES ON BOTH SIDES - the CFO's case. The lines
 * were locked to the voucher's own side and the bank line was their plain sum;
 * now each line has its side and the bank / cash line carries their NET. */
describe('a payment or receipt with lines on both sides', () => {
  const salary = { type: 'debit', amount: 100000 };
  const loan = { type: 'credit', amount: 20000 };

  test('salary paid with a loan instalment held back: the bank pays the difference', () => {
    expect(settlementAmount([salary, loan], 'BPV')).toBe(80000);
    expect(settlementAmount([salary, loan], 'CPV')).toBe(80000);
  });

  test('and the voucher balances, the bank line on its own side', () => {
    const bankLine = { type: 'credit', amount: settlementAmount([salary, loan], 'BPV') };
    expect(voucherTotals([salary, loan], bankLine, 'BPV')).toEqual({ debit: 100000, credit: 100000 });
  });

  test('a receipt the mirror: customer credit, bank charges debit, the bank receives the rest', () => {
    const lines = [{ type: 'credit', amount: 100000 }, { type: 'debit', amount: 500 }];
    expect(settlementAmount(lines, 'BRV')).toBe(99500);
    expect(voucherTotals(lines, { type: 'debit', amount: 99500 }, 'BRV')).toEqual({ debit: 100000, credit: 100000 });
  });

  test('lines all on the usual side add up as before', () => {
    expect(settlementAmount([salary, { type: 'debit', amount: 50 }], 'BPV')).toBe(100050);
    expect(settlementAmount([{ type: 'credit', amount: 300 }], 'CRV')).toBe(300);
  });

  test('lines that come out the wrong way are zero or less - which save refuses', () => {
    expect(settlementAmount([{ type: 'debit', amount: 10 }, { type: 'credit', amount: 50 }], 'BPV')).toBe(-40);
    expect(settlementAmount([{ type: 'debit', amount: 50 }], 'BRV')).toBe(-50);
    expect(settlementAmount([{ type: 'debit', amount: 20 }, { type: 'credit', amount: 20 }], 'CPV')).toBe(0);
  });

  test('to the paisa', () => {
    expect(settlementAmount([{ type: 'debit', amount: 0.3 }, { type: 'credit', amount: 0.1 }], 'BPV')).toBe(0.2);
  });

  test('a new line starts on the voucher\'s own side', () => {
    expect(['BPV', 'CPV'].map(defaultLineSide)).toEqual(['debit', 'debit']);
    expect(['BRV', 'CRV'].map(defaultLineSide)).toEqual(['credit', 'credit']);
    expect(isReceipt('BRV')).toBe(true);
    expect(isReceipt('BPV')).toBe(false);
  });
});

/* Debit / Credit / Net Amount, as Climax shows them (the user's request,
 * 2026-10-26): the lines entered, without the bank or cash line. */
describe('the Debit / Credit / Net Amount panel', () => {
  const { voucherSummary } = require('functions/voucherTotals');
  const dr = (amount) => ({ type: 'debit', amount });
  const cr = (amount) => ({ type: 'credit', amount });

  test("a payment: what the bank or cash pays out - the user's example", () => {
    expect(voucherSummary([dr('32574.83')], 'BPV')).toEqual({ debit: 32574.83, credit: 0, net: 32574.83, off: false });
    // Salary paid with a loan instalment held back: the bank pays the difference.
    expect(voucherSummary([dr(100000), cr(20000)], 'CPV')).toMatchObject({ debit: 100000, credit: 20000, net: 80000, off: false });
  });

  test('a receipt: what it receives', () => {
    expect(voucherSummary([cr(100000), dr(500)], 'BRV')).toMatchObject({ debit: 500, credit: 100000, net: 99500, off: false });
  });

  test('a journal: what it is out by - 0 when it balances', () => {
    expect(voucherSummary([dr(1000), cr(1000)], 'JV')).toMatchObject({ net: 0, off: false });
    expect(voucherSummary([dr(1000), cr(400)], 'TV')).toMatchObject({ net: 600, off: true });
  });

  test('what the save would refuse is flagged; an empty voucher is not', () => {
    expect(voucherSummary([cr(500)], 'BPV').off).toBe(true);
    expect(voucherSummary([], 'BPV')).toEqual({ debit: 0, credit: 0, net: 0, off: false });
  });
});

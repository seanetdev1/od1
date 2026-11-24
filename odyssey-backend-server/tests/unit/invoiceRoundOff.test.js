const { roundOffFor, hasRoundOff, isRoundable, approvalRoundOff } = require('../../functions/invoiceRoundOff');

describe('round off', () => {
  test('to the nearest rupee - half a rupee or less rounds down', () => {
    expect(roundOffFor(1234.56)).toBe('+0.44');
    expect(roundOffFor(1234.5)).toBe('-0.50');
    expect(roundOffFor(1234.01)).toBe('-0.01');
    expect(roundOffFor(1234.99)).toBe('+0.01');
    expect(roundOffFor(1234)).toBe('0');
    expect(roundOffFor('980.30')).toBe('-0.30');
    // Floating point does not leak in: 0.1 + 0.2 is 0.30000000000000004.
    expect(roundOffFor(0.1 + 0.2)).toBe('-0.30');
  });

  test('"0", "0.00" and "-0.00" are no round off', () => {
    for (const v of ['0', '0.00', '-0.00', '', null, undefined]) expect(hasRoundOff(v)).toBe(false);
    for (const v of ['+0.44', '-0.40', '0.01']) expect(hasRoundOff(v)).toBe(true);
  });

  test('only an invoice in rupees, and never an agent document', () => {
    expect(isRoundable({ type: 'Job Invoice', currency: 'PKR' })).toBe(true);
    expect(isRoundable({ type: 'Job Bill' })).toBe(true);
    expect(isRoundable({ type: 'Job Invoice', currency: 'USD' })).toBe(false);
    expect(isRoundable({ type: 'Agent Invoice', currency: 'PKR' })).toBe(false);
    expect(isRoundable({ type: 'Old Agent Bill', currency: 'USD' })).toBe(false);
  });

  test('at approval: from the approved total when ticked or automatic, else none', () => {
    const inv = { type: 'Job Invoice', currency: 'PKR' };
    expect(approvalRoundOff({ ...inv, roundOff: '0' }, 1234.56, false)).toBe('0');
    expect(approvalRoundOff({ ...inv, roundOff: '+0.30' }, 1234.56, false)).toBe('+0.44');
    expect(approvalRoundOff({ ...inv, roundOff: '0' }, 1234.56, true)).toBe('+0.44');
    expect(approvalRoundOff({ ...inv, roundOff: '+0.30' }, 1234, false)).toBe('0');
    // An agent invoice keeps whatever it has - it is never rounded here.
    expect(approvalRoundOff({ type: 'Agent Invoice', currency: 'USD', roundOff: '0' }, 10.25, true)).toBe('0');
  });
});

/* THE APPROVAL VOUCHER'S LINES - roundOffHeads. Each line in BOTH amounts:
 * `amount` (the voucher's currency) and `defaultAmount` (rupees), which is the
 * one the ledger and the trial balance read. Approval rounded `amount` only -
 * 2026-10-22: SNS-JI-574/27 posted 117,959.60 in rupees where it was rounded to
 * 117,960, and every sale rounded down posted its whole total to expense. */
describe('roundOffHeads', () => {
  const { roundOffHeads } = require('../../functions/invoiceRoundOff');
  // Debits less credits in rupees, for a sale: party and rounding are debits.
  const rupeeBalance = ({ party, contra, rounding }) =>
    Math.round((party.defaultAmount + (rounding ? rounding.defaultAmount : 0) - contra.defaultAmount) * 100) / 100;

  test('no round off: the total on both lines', () => {
    expect(roundOffHeads({ total: 1234.56, defaultTotal: 1234.56, roundOff: '0' })).toEqual({
      party: { amount: 1234.56, defaultAmount: 1234.56 },
      contra: { amount: 1234.56, defaultAmount: 1234.56 },
      rounding: null,
    });
    // "0.00" and "-0.00" are none too.
    expect(roundOffHeads({ total: 10, defaultTotal: 10, roundOff: '-0.00' }).rounding).toBeNull();
  });

  test('rounded UP: party and contra at the rounded total, in rupees too', () => {
    const h = roundOffHeads({ total: 117959.6, defaultTotal: 117959.6, roundOff: '+0.40' });
    expect(h.party).toEqual({ amount: 117960, defaultAmount: 117960 });
    expect(h.contra).toEqual({ amount: 117960, defaultAmount: 117960 });
    expect(h.rounding).toBeNull();
  });

  test('rounded DOWN: party at the rounded total, contra at the total, the difference on its own line', () => {
    // CL's JI-2888/27: income had no rupee amount, the 0.50 line carried 7,462.50.
    const h = roundOffHeads({ total: 7462.5, defaultTotal: 7462.5, roundOff: '-0.50' });
    expect(h.party).toEqual({ amount: 7462, defaultAmount: 7462 });
    expect(h.contra).toEqual({ amount: 7462.5, defaultAmount: 7462.5 });
    expect(h.rounding).toEqual({ amount: 0.5, defaultAmount: 0.5 });
    expect(rupeeBalance(h)).toBe(0);
  });

  test('balances in rupees either way, and leaves no float dust', () => {
    for (const [total, roundOff] of [[1234.4, '-0.40'], [1234.56, '+0.44'], [0.3, '-0.30'], [99.5, '-0.50']]) {
      const h = roundOffHeads({ total, defaultTotal: total, roundOff });
      expect(rupeeBalance(h)).toBe(0);
      expect(Number.isInteger(h.party.defaultAmount)).toBe(true);
    }
  });

  test('a round off on an invoice in another currency is carried into rupees at its rate', () => {
    // Not rounded any more (isRoundable), but an older one can carry a figure.
    const h = roundOffHeads({ total: 100.25, defaultTotal: 28070, roundOff: '-0.25' });
    expect(h.party).toEqual({ amount: 100, defaultAmount: 28000 });
    expect(h.rounding).toEqual({ amount: 0.25, defaultAmount: 70 });
    expect(rupeeBalance(h)).toBe(0);
  });
});

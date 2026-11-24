/**
 * Duty and taxes on a goods declaration.
 *
 * Duty is stored as RATES per item and turned into money here, so these tests
 * are what stands between a mis-stated cascade and figures that reconcile with
 * nothing. The cases that matter are the ones where a wrong answer is still
 * plausible: a tax charged on the wrong base, a rate summed across lines that
 * do not share it, and a value counted as a duty.
 *
 * NOTE the cascade itself is not yet confirmed against a real declaration -
 * see the banner in functions/customsDuty.js. These tests PIN what it
 * currently does so that correcting it is a deliberate, visible change rather
 * than a silent drift.
 */
const {
  RATE_HEADS, AMOUNT_HEADS, assessLine, lineTotal,
  totalDuty, dutyBreakdown, reimbursableDuty, effectiveDutyRate, dutyLinesOf,
} = require('../../functions/customsDuty');

// One item, assessed at a realistic set of rates.
const LINE = {
  assessedValue: 1000000,
  customDutyPerc: 20,
  salesTaxPerc: 18,
  incomeTaxPerc: 6,
};

const job = (lines) => ({ Customs_Duties: lines });

const headOf = (heads, field) => heads.find((h) => h.field === field);

describe('assessing one line', () => {
  const { heads, total } = assessLine(LINE);

  test('a duty is charged on the customs value', () => {
    expect(headOf(heads, 'customDutyPerc')).toMatchObject({ base: 1000000, amount: 200000 });
  });

  test('sales tax is charged on the value PLUS the duties above it', () => {
    // The trap: charging it on the value alone gives 180,000, which looks
    // entirely reasonable and is wrong by 36,000.
    expect(headOf(heads, 'salesTaxPerc')).toMatchObject({ base: 1200000, amount: 216000 });
  });

  test('income tax is charged on the value, the duties AND the sales taxes', () => {
    expect(headOf(heads, 'incomeTaxPerc')).toMatchObject({ base: 1416000, amount: 84960 });
  });

  test('no head is ever charged on itself', () => {
    // Each base must be strictly less than the running total after it.
    for (const h of heads.filter((x) => x.kind === 'rate')) {
      expect(h.base).toBeLessThan(total + h.base);
      expect(h.base).toBeGreaterThan(0);
    }
  });

  test('the total is every head together', () => {
    expect(total).toBeCloseTo(200000 + 216000 + 84960, 6);
    expect(lineTotal(LINE)).toBeCloseTo(total, 6);
  });

  test('a rate of zero is dropped, not shown as nothing', () => {
    // A GD levies three or four of the ten heads; printing the rest as 0.00
    // buries the ones that matter.
    expect(headOf(heads, 'regulatoryDutyPerc')).toBeUndefined();
    expect(headOf(heads, 'federalExcisePerc')).toBeUndefined();
  });

  test('flat amounts are carried as entered, with no base and no rate', () => {
    const withCharges = assessLine({ ...LINE, demurrage: 45000, stampDuty: 1200 });
    expect(headOf(withCharges.heads, 'demurrage'))
      .toMatchObject({ amount: 45000, perc: null, base: null, kind: 'amount' });
    expect(withCharges.total).toBeCloseTo(assessLine(LINE).total + 46200, 6);
  });

  test('an unassessed line comes to nothing rather than NaN', () => {
    expect(assessLine({}).total).toBe(0);
    expect(assessLine(null).total).toBe(0);
    expect(lineTotal({ assessedValue: 'n/a', customDutyPerc: 'x' })).toBe(0);
  });

  test('reads numeric strings, which is what a form posts', () => {
    expect(lineTotal({ assessedValue: '1000000', customDutyPerc: '20' })).toBe(200000);
  });

  test('every head the module declares can actually be assessed', () => {
    // A head added to one array but forgotten by the cascade would silently
    // never be charged.
    const allRates = Object.fromEntries(RATE_HEADS.map((h) => [h.field, 1]));
    const allAmounts = Object.fromEntries(AMOUNT_HEADS.map((h) => [h.field, 5]));
    const r = assessLine({ assessedValue: 100000, ...allRates, ...allAmounts });
    expect(r.heads).toHaveLength(RATE_HEADS.length + AMOUNT_HEADS.length);
    expect(r.total).toBeGreaterThan(AMOUNT_HEADS.length * 5);
  });
});

describe('a whole declaration', () => {
  const TWO = [
    { assessedValue: 1000000, customDutyPerc: 20, salesTaxPerc: 18 },
    { assessedValue: 500000,  customDutyPerc: 10, salesTaxPerc: 18 },
  ];

  test('totals every line, not just the first', () => {
    // The failure the item-level rewrite exists to prevent: a multi-item GD
    // collapsed to one line loses everything after it.
    expect(totalDuty(job(TWO))).toBeCloseTo(lineTotal(TWO[0]) + lineTotal(TWO[1]), 6);
  });

  test('accepts lines however the caller holds them', () => {
    expect(dutyLinesOf(job(TWO))).toHaveLength(2);
    expect(dutyLinesOf({ dutyLines: TWO })).toHaveLength(2);
    expect(dutyLinesOf(TWO)).toHaveLength(2);
    expect(dutyLinesOf({})).toEqual([]);
    expect(dutyLinesOf(null)).toEqual([]);
  });

  test('a GD with nothing assessed comes to nothing', () => {
    expect(totalDuty(job([]))).toBe(0);
    expect(totalDuty({})).toBe(0);
  });
});

describe('the breakdown', () => {
  const TWO = [
    { assessedValue: 1000000, customDutyPerc: 20, salesTaxPerc: 18 },
    { assessedValue: 500000,  customDutyPerc: 10, salesTaxPerc: 18 },
  ];
  const rows = dutyBreakdown(job(TWO));

  test('sums each head across the lines', () => {
    expect(headOf(rows, 'customDutyPerc').amount).toBeCloseTo(200000 + 50000, 6);
  });

  test('keeps a rate the lines agree on', () => {
    expect(headOf(rows, 'salesTaxPerc').perc).toBe(18);
  });

  test('reports null for a rate the lines disagree on', () => {
    // Two items at 20% and 10% have no single rate. Showing one of them would
    // be a number that cannot be checked against either line.
    expect(headOf(rows, 'customDutyPerc').perc).toBeNull();
  });

  test('reads in assessment order, not the order the lines filled it', () => {
    const mixed = dutyBreakdown(job([
      { assessedValue: 100000, incomeTaxPerc: 6, customDutyPerc: 20, demurrage: 100 },
    ]));
    expect(mixed.map((r) => r.field))
      .toEqual(['customDutyPerc', 'incomeTaxPerc', 'demurrage']);
  });

  test('drops heads no line carries', () => {
    expect(headOf(rows, 'regulatoryDutyPerc')).toBeUndefined();
  });
});

describe('reimbursable duty', () => {
  const GD = { ...job([LINE]), dutyPaidBy: 'Agent' };

  test('is the whole total when the agent paid it', () => {
    expect(reimbursableDuty(GD)).toBeCloseTo(totalDuty(GD), 6);
  });

  test('is nothing unless the agent explicitly paid', () => {
    // Billing a client for money they already paid is the worse of the two
    // mistakes, so an unanswered field answers zero.
    for (const dutyPaidBy of ['Client', null, '', undefined]) {
      expect(reimbursableDuty({ ...GD, dutyPaidBy })).toBe(0);
    }
  });

  test('is not fooled by case or padding, which is what a picker sends back', () => {
    expect(reimbursableDuty({ ...GD, dutyPaidBy: ' agent ' })).toBeCloseTo(totalDuty(GD), 6);
  });
});

describe('effective duty rate', () => {
  test('measures against what the LINES were assessed at', () => {
    // Not the header's assessedValue: the lines are what customs actually
    // assessed, and the two are allowed to disagree.
    const j = { ...job([LINE]), assessedValue: 9999999 };
    expect(effectiveDutyRate(j)).toBeCloseTo((totalDuty(j) / 1000000) * 100, 6);
  });

  test('falls back to the header when no line carries a value', () => {
    const j = { ...job([{ demurrage: 5000 }]), assessedValue: 100000 };
    expect(effectiveDutyRate(j)).toBeCloseTo(5, 6);
  });

  test('answers null, not zero, when there is nothing to measure against', () => {
    // A 0% badge on an unassessed GD reads as a duty-free consignment.
    expect(effectiveDutyRate(job([]))).toBeNull();
    expect(effectiveDutyRate({ ...job([{ customDutyPerc: 20 }]), assessedValue: 0 })).toBeNull();
  });
});

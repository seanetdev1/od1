/**
 * Duty and taxes on a goods declaration, as the screen computes them.
 *
 * Duty is stored as RATES per item and turned into money here. The first half
 * pins what the screen computes; the second sweeps it against the backend's
 * own implementation, because these are separate files in separate projects
 * and nothing but a test stops them drifting - and a drift here is not a
 * rendering bug, it is a declaration whose total differs between the form and
 * the register.
 *
 * NOTE the cascade itself is not yet confirmed against a real declaration -
 * see the banner in functions/customsDuty.js. These PIN what it currently
 * does, so correcting it is a deliberate, visible change on both sides.
 */
import fs from 'fs';
import path from 'path';
import {
  RATE_HEADS, AMOUNT_HEADS, assessLine, lineTotal, dutyLinesOf,
  totalDuty, dutyBreakdown, reimbursableDuty, effectiveDutyRate, money,
} from 'functions/customsDuty';

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

  test('the total is every head together', () => {
    expect(total).toBeCloseTo(200000 + 216000 + 84960, 6);
    expect(lineTotal(LINE)).toBeCloseTo(total, 6);
  });

  test('a rate of zero is dropped, not shown as nothing', () => {
    expect(headOf(heads, 'regulatoryDutyPerc')).toBeUndefined();
  });

  test('flat amounts are carried as entered, with no base and no rate', () => {
    const r = assessLine({ ...LINE, demurrage: 45000 });
    expect(headOf(r.heads, 'demurrage'))
      .toMatchObject({ amount: 45000, perc: null, base: null, kind: 'amount' });
  });

  test('an unassessed line comes to nothing rather than NaN', () => {
    expect(assessLine({}).total).toBe(0);
    expect(assessLine(null).total).toBe(0);
    expect(lineTotal({ assessedValue: 'n/a', customDutyPerc: 'x' })).toBe(0);
  });

  test('every head the module declares can actually be assessed', () => {
    const allRates = Object.fromEntries(RATE_HEADS.map((h) => [h.field, 1]));
    const allAmounts = Object.fromEntries(AMOUNT_HEADS.map((h) => [h.field, 5]));
    const r = assessLine({ assessedValue: 100000, ...allRates, ...allAmounts });
    expect(r.heads).toHaveLength(RATE_HEADS.length + AMOUNT_HEADS.length);
  });

  test('every rate head has a short label for the grid heading', () => {
    // The grid renders `short`; a head without one shows "undefined %".
    for (const h of RATE_HEADS) expect(typeof h.short).toBe('string');
  });
});

describe('a whole declaration', () => {
  const TWO = [
    { assessedValue: 1000000, customDutyPerc: 20, salesTaxPerc: 18 },
    { assessedValue: 500000,  customDutyPerc: 10, salesTaxPerc: 18 },
  ];

  test('totals every line, not just the first', () => {
    // The failure the item-level rewrite exists to prevent.
    expect(totalDuty(job(TWO))).toBeCloseTo(lineTotal(TWO[0]) + lineTotal(TWO[1]), 6);
  });

  test('accepts lines however the caller holds them', () => {
    // The editor passes a bare array; the server sends Customs_Duties.
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
    expect(headOf(rows, 'customDutyPerc').amount).toBeCloseTo(250000, 6);
  });

  test('keeps a rate the lines agree on, and reports null when they do not', () => {
    // Showing one line's rate as if it covered all of them is a number that
    // checks out against nothing - the grid renders "mixed" instead.
    expect(headOf(rows, 'salesTaxPerc').perc).toBe(18);
    expect(headOf(rows, 'customDutyPerc').perc).toBeNull();
  });

  test('reads in assessment order, not the order the lines filled it', () => {
    const mixed = dutyBreakdown(job([
      { assessedValue: 100000, incomeTaxPerc: 6, customDutyPerc: 20, demurrage: 100 },
    ]));
    expect(mixed.map((r) => r.field))
      .toEqual(['customDutyPerc', 'incomeTaxPerc', 'demurrage']);
  });
});

describe('reimbursable duty', () => {
  const GD = { ...job([LINE]), dutyPaidBy: 'Agent' };

  test('is the whole total when the agent paid it', () => {
    expect(reimbursableDuty(GD)).toBeCloseTo(totalDuty(GD), 6);
  });

  test('is nothing unless the agent explicitly paid', () => {
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
    const j = { ...job([LINE]), assessedValue: 9999999 };
    expect(effectiveDutyRate(j)).toBeCloseTo((totalDuty(j) / 1000000) * 100, 6);
  });

  test('answers null, not zero, when there is nothing to measure against', () => {
    // A 0% badge on an unassessed GD reads as a duty-free consignment.
    expect(effectiveDutyRate(job([]))).toBeNull();
  });
});

describe('money formatting', () => {
  test('always shows two decimals, so a column of figures lines up', () => {
    expect(money(1000)).toBe('1,000.00');
    expect(money('2500.5')).toBe('2,500.50');
  });

  test('shows nothing as 0.00 rather than NaN', () => {
    for (const v of [null, undefined, '']) expect(money(v)).toBe('0.00');
  });
});

// --- parity with the server -------------------------------------------------

// Required directly rather than through a package: the backend is a sibling
// project, and this is one of the tests with a legitimate reason to reach into
// it. A CI job that checks out this repo alone has no sibling, so the
// comparison skips rather than failing on a missing file - set REQUIRE_PARITY=1
// in any job that is supposed to check it.
const backendPath = path.resolve(
  __dirname, '..', '..', 'Odyssey-Backend-Server', 'functions', 'customsDuty.js'
);
const haveBackend = fs.existsSync(backendPath);

if (!haveBackend && process.env.REQUIRE_PARITY === '1') {
  throw new Error(
    `REQUIRE_PARITY=1 but the backend is not at ${backendPath}. ` +
    'Check out Odyssey-Backend-Server alongside this repo, or unset REQUIRE_PARITY.'
  );
}

// eslint-disable-next-line import/no-dynamic-require, global-require
const backend = haveBackend ? require(backendPath) : null;

// eslint-disable-next-line no-console
if (!haveBackend) console.warn(`[parity] SKIPPED - no backend at ${backendPath}`);

const describeParity = haveBackend ? describe : describe.skip;

describeParity('duty parity between the screen and the server', () => {
  test('the two declare the same heads, in the same order', () => {
    // The cascade is order-dependent: a head that moved on one side only would
    // change every base below it.
    expect(RATE_HEADS.map((h) => h.field)).toEqual(backend.RATE_HEADS.map((h) => h.field));
    expect(RATE_HEADS.map((h) => h.base)).toEqual(backend.RATE_HEADS.map((h) => h.base));
    expect(AMOUNT_HEADS.map((h) => h.field)).toEqual(backend.AMOUNT_HEADS.map((h) => h.field));
  });

  const cases = [];
  for (const assessedValue of [0, 1000, 1000000, 12345.67]) {
    for (const customDutyPerc of [0, 5, 20]) {
      for (const salesTaxPerc of [0, 18]) {
        for (const incomeTaxPerc of [0, 1, 6]) {
          for (const regulatoryDutyPerc of [0, 10]) {
            for (const demurrage of [0, 45000]) {
              cases.push({
                assessedValue, customDutyPerc, salesTaxPerc,
                incomeTaxPerc, regulatoryDutyPerc, demurrage,
              });
            }
          }
        }
      }
    }
  }

  test(`agree on every one of ${cases.length} combinations`, () => {
    const mismatches = [];
    for (const c of cases) {
      const fe = lineTotal(c);
      const be = backend.lineTotal(c);
      // Both sides do the same float arithmetic in the same order, so exact
      // equality is the right assertion - a difference means a rule differs,
      // not that a rounding step does.
      if (fe !== be) mismatches.push({ line: c, screen: fe, server: be });
    }
    expect(mismatches).toEqual([]);
  });

  test('agree on each head\'s base, not merely on the total', () => {
    // Two cascades can reach the same total by different routes; a base that
    // differs is the bug that shows up on the next GD with a different mix.
    for (const c of cases.slice(0, 40)) {
      expect(assessLine(c).heads.map((h) => [h.field, h.base, h.amount]))
        .toEqual(backend.assessLine(c).heads.map((h) => [h.field, h.base, h.amount]));
    }
  });

  test('agree on a multi-item declaration', () => {
    const lines = [cases[10], cases[40], cases[90]];
    expect(totalDuty({ Customs_Duties: lines }))
      .toBe(backend.totalDuty({ Customs_Duties: lines }));
  });
});

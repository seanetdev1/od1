/**
 * The aviation Sales Report - functions/aviationSalesReport.js.
 *
 * One row per AWB, buying against selling. The rules worth pinning are the
 * ones a reader of the report cannot check for themselves: which figure each
 * money column sums, that the breakout columns can never pull Payable out of
 * step with the invoice, and what the settlement columns say when the bill has
 * not been paid.
 */
const {
  buildSalesReport, salesRow, settlementOf, currencyLabelFor, carrierLabelFor,
} = require('../../functions/aviationSalesReport');

const charge = (x = {}) => ({
  code: '2', type: 'Payble', currency: 'USD', exRate: 281,
  localAmount: 0, invoiceId: null, ...x,
});

const awb = (x = {}) => ({
  id: 1, jobNo: 'AVJ-1', flightNo: 'PK-301', date: '2026-07-15',
  awb: '230-68287494', origin: 'ISB', destination: 'SCL',
  grossWeight: 470, chargeableWeight: 470,
  buyingRate: 7.1, sellingRate: 7.27, buyingExRate: 281,
  agent: 'AGL PAKISTAN', airline: 'Fits Air', charges: [], ...x,
});

/* The two rows of the department's workbook, reproduced exactly.
 *
 * This is the regression anchor for the whole report: every column below was
 * read off the sheet the report was modelled on, so a change to the arithmetic
 * that stops reproducing it is a change the sales office would notice. */
const SHEET = [
  {
    label: 'ISB-SCL, AGL PAKISTAN',
    cw: 470, buy: 7.1, sell: 7.27, exr: 281,
    freightPay: 937697, gtcPay: 5620, freightRec: 960148.9, otherRec: 7982.1,
    payable: 943317, receivable: 968131, profit: 24814, dollarPayable: 3357,
    remitAmount: 939960, remitExRate: 280, gainLoss: 3357,
  },
  {
    label: 'ISB-MDE, ICC',
    cw: 285, buy: 6.9, sell: 7.12, exr: 281,
    freightPay: 552586.5, gtcPay: 5620, freightRec: 570205.2, otherRec: 7981.8,
    payable: 558206.5, receivable: 578187, profit: 19980.5, dollarPayable: 1986.5,
    remitAmount: 556220, remitExRate: 280, gainLoss: 1986.5,
  },
];

const fromSheet = (s, invoiceId = 10) => awb({
  chargeableWeight: s.cw, buyingRate: s.buy, sellingRate: s.sell, buyingExRate: s.exr,
  charges: [
    charge({ code: '2', exRate: s.exr, localAmount: s.freightPay, invoiceId }),
    charge({ code: '9', exRate: s.exr, localAmount: s.gtcPay, invoiceId }),
    charge({ code: '2', type: 'Recievable', exRate: s.exr, localAmount: s.freightRec }),
    charge({ code: '7', type: 'Recievable', exRate: 1, localAmount: s.otherRec }),
  ],
});

describe('the workbook it was modelled on', () => {
  test.each(SHEET)('reproduces the $label row', (s) => {
    const bills = {
      10: { total: s.payable, transactions: [
        { amount: s.remitAmount, gainLoss: s.gainLoss, settleExRate: s.remitExRate },
      ] },
    };
    const r = salesRow(fromSheet(s), { bills, gtcCodes: '9' });

    expect(r.payable).toBeCloseTo(s.payable, 1);
    expect(r.receivable).toBeCloseTo(s.receivable, 1);
    expect(r.profit).toBeCloseTo(s.profit, 1);
    expect(r.dollarPayable).toBeCloseTo(s.dollarPayable, 2);
    // The $20 flat fee, broken out of the payable rather than added to it.
    expect(r.gtcScan).toBeCloseTo(20, 2);
    expect(r.remitAmount).toBeCloseTo(s.remitAmount, 1);
    expect(r.remitExRate).toBe(s.remitExRate);
    expect(r.exGainLoss).toBeCloseTo(s.gainLoss, 1);
  });

  test('the exchange gain is the spread between booking and remittance', () => {
    // $ PAYABLE x (Ex-Rate - Remit Ex.Rate). Asserted against the settlement
    // the report actually reads, so a voucher recording something else than
    // the spread is not quietly restated as the spread.
    for (const s of SHEET) {
      expect(s.dollarPayable * (s.exr - s.remitExRate)).toBeCloseTo(s.gainLoss, 1);
    }
  });

  test('totals the period the way the sheet does', () => {
    const bills = {
      10: { total: SHEET[0].payable, transactions: [{ amount: SHEET[0].remitAmount, gainLoss: SHEET[0].gainLoss, settleExRate: 280 }] },
      11: { total: SHEET[1].payable, transactions: [{ amount: SHEET[1].remitAmount, gainLoss: SHEET[1].gainLoss, settleExRate: 280 }] },
    };
    const out = buildSalesReport(
      [fromSheet(SHEET[0], 10), fromSheet(SHEET[1], 11)],
      { bills, gtcCodes: '9' },
    );

    expect(out.totals.awbs).toBe(2);
    expect(out.totals.payable).toBeCloseTo(1501523.5, 0);
    expect(out.totals.receivable).toBeCloseTo(1546318, 0);
    expect(out.totals.profit).toBeCloseTo(44794.5, 0);
    expect(out.totals.dollarPayable).toBeCloseTo(5343.5, 1);
    expect(out.totals.remitAmount).toBeCloseTo(1496180, 0);
    expect(out.totals.exGainLoss).toBeCloseTo(5343.5, 1);
  });
});

describe('a sales row', () => {
  test('sums every charge line, not chargeable x rate', () => {
    // The whole point of pricing off the charges: an AWB carries more than air
    // freight, and rate arithmetic would drop the rest and disagree with the
    // invoice.
    const r = salesRow(awb({
      charges: [
        charge({ localAmount: 100000 }),
        charge({ code: '5', localAmount: 5000 }),
        charge({ type: 'Recievable', localAmount: 130000 }),
      ],
    }));
    expect(r.payable).toBe(105000);
    expect(r.receivable).toBe(130000);
    expect(r.profit).toBe(25000);
  });

  test('a charge in no breakout list is still in Payable', () => {
    // The breakouts are informational. However the two lists are configured,
    // the report cannot stop reconciling with the invoice.
    const r = salesRow(awb({
      charges: [
        charge({ code: '2', localAmount: 90000 }),
        charge({ code: '9', localAmount: 5620 }),
        charge({ code: '4', localAmount: 2810 }),
      ],
    }), { gtcCodes: '9' });
    expect(r.payable).toBe(98430);
    expect(r.gtcScan).toBe(20);
    expect(r.er).toBe(0);
  });

  test('breaking out the same code twice does not double the payable', () => {
    const r = salesRow(awb({
      charges: [charge({ code: '9', localAmount: 5620 })],
    }), { gtcCodes: '9', erCodes: '9' });
    expect(r.payable).toBe(5620);
    expect(r.gtcScan).toBe(20);
    expect(r.er).toBe(20);
    expect(r.erPayable).toBe(5620);
  });

  test('converts each line at its own ex-rate', () => {
    // Two charges struck on different days. Dividing the total by one of the
    // rates would misstate what the carrier is actually remitted.
    const r = salesRow(awb({
      charges: [
        charge({ exRate: 280, localAmount: 28000 }),
        charge({ exRate: 250, localAmount: 25000 }),
      ],
    }));
    expect(r.payable).toBe(53000);
    expect(r.dollarPayable).toBe(200);
  });

  test('keeps a rate that was never set as null, not zero', () => {
    // An AWB priced at nothing and an AWB not yet priced are different, and a
    // 0.00 in the rate column looks like the former.
    const r = salesRow(awb({ buyingRate: null, sellingRate: null }));
    expect(r.buyingRate).toBeNull();
    expect(r.sellingRate).toBeNull();
  });

  test('reports a loss as a negative profit', () => {
    const r = salesRow(awb({
      charges: [
        charge({ localAmount: 100000 }),
        charge({ type: 'Recievable', localAmount: 90000 }),
      ],
    }));
    expect(r.profit).toBe(-10000);
  });
});

describe('the settlement columns', () => {
  test('are null on an unsettled bill, not zero', () => {
    const r = salesRow(awb({
      charges: [charge({ localAmount: 100000, invoiceId: 5 })],
    }), { bills: { 5: { total: 100000, transactions: [] } } });
    expect(r.remitAmount).toBeNull();
    expect(r.remitExRate).toBeNull();
    expect(r.exGainLoss).toBeNull();
  });

  test('are null when the payable has not been invoiced at all', () => {
    const r = salesRow(awb({ charges: [charge({ localAmount: 100000 })] }));
    expect(r.remitAmount).toBeNull();
  });

  test('split a bill across the AWBs on it, in proportion', () => {
    // One bill for two AWBs: 75/25. Settling it settles both, pro rata.
    const bills = { 5: { total: 100000, transactions: [{ amount: 99000, gainLoss: 1000, settleExRate: 280 }] } };
    const big = salesRow(awb({ charges: [charge({ localAmount: 75000, invoiceId: 5 })] }), { bills });
    const small = salesRow(awb({ charges: [charge({ localAmount: 25000, invoiceId: 5 })] }), { bills });

    expect(big.remitAmount).toBe(74250);
    expect(small.remitAmount).toBe(24750);
    expect(big.exGainLoss).toBe(750);
    expect(small.exGainLoss).toBe(250);
    // A share of a bill is still settled at the rate the bill was settled at.
    expect(big.remitExRate).toBe(280);
    expect(small.remitExRate).toBe(280);
  });

  test('weights the remit rate by the amount each payment carried', () => {
    // Two part-payments at different rates settle at neither of them.
    const out = settlementOf(new Map([[5, 100]]), {
      5: { total: 100, transactions: [
        { amount: 75, gainLoss: 0, settleExRate: 280 },
        { amount: 25, gainLoss: 0, settleExRate: 288 },
      ] },
    });
    expect(out.remitAmount).toBe(100);
    expect(out.remitExRate).toBe(282);
  });

  test('a zero-value bill is not divided by zero', () => {
    const out = settlementOf(new Map([[5, 0]]), {
      5: { total: 0, transactions: [{ amount: 0, gainLoss: 0, settleExRate: 280 }] },
    });
    expect(out.remitAmount).toBe(0);
    expect(out.exGainLoss).toBe(0);
    // Nothing was paid, so no rate can be inferred from it.
    expect(out.remitExRate).toBeNull();
  });

  test('count only the rows they actually speak for', () => {
    // Without this the remittance total reads as covering every AWB listed.
    const bills = { 5: { total: 1000, transactions: [{ amount: 990, gainLoss: 10, settleExRate: 280 }] } };
    const out = buildSalesReport([
      awb({ id: 1, charges: [charge({ localAmount: 1000, invoiceId: 5 })] }),
      awb({ id: 2, awb: '230-2', charges: [charge({ localAmount: 2000 })] }),
    ], { bills });

    expect(out.totals.awbs).toBe(2);
    expect(out.totals.settled).toBe(1);
    expect(out.totals.remitAmount).toBe(990);
  });
});

describe('the currency heading', () => {
  test('is the currency when every payable agrees on one', () => {
    expect(currencyLabelFor([awb({ charges: [charge({ localAmount: 100 })] })])).toBe('USD');
  });

  test('falls back when a run spans two currencies', () => {
    // A single heading cannot name two currencies, and picking one would
    // mislabel the other's money.
    expect(currencyLabelFor([
      awb({ charges: [charge({ currency: 'USD', localAmount: 100 })] }),
      awb({ charges: [charge({ currency: 'EUR', exRate: 300, localAmount: 100 })] }),
    ])).toBe('FCY');
  });

  test('ignores a line already in local currency', () => {
    // ex-rate 1 says nothing about what the AWB was bought in.
    expect(currencyLabelFor([
      awb({ charges: [
        charge({ currency: 'USD', localAmount: 100 }),
        charge({ currency: 'PKR', exRate: 1, localAmount: 500 }),
      ] }),
    ])).toBe('USD');
  });
});

describe('the buying-rate heading', () => {
  test('is the airline when every AWB flew the same one', () => {
    // The sheet says "Payable to UX" because it covers one carrier.
    expect(carrierLabelFor([awb(), awb({ id: 2 })])).toBe('Fits Air');
  });

  test('falls back when the run spans two airlines', () => {
    // Heading another airline's cost with this one's name would misread as
    // the whole report being that carrier's.
    expect(carrierLabelFor([awb(), awb({ id: 2, airline: 'Gamma Air' })])).toBe('Carrier');
    expect(carrierLabelFor([])).toBe('Carrier');
  });

  test('is carried on the report so the export cannot disagree', () => {
    expect(buildSalesReport([awb()]).labels).toEqual({ currency: 'FCY', carrier: 'Fits Air' });
  });
});

describe('the report', () => {
  test('reads oldest first, then by AWB', () => {
    const out = buildSalesReport([
      awb({ id: 1, date: '2026-07-31', awb: '230-1' }),
      awb({ id: 2, date: '2026-07-15', awb: '230-9' }),
      awb({ id: 3, date: '2026-07-31', awb: '230-0' }),
    ]);
    expect(out.rows.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  test('margin is struck on the totals, not averaged across rows', () => {
    // Averaging the rows' own percentages would weight a 30 kg AWB the same as
    // a 7,000 kg one.
    const out = buildSalesReport([
      awb({ id: 1, charges: [charge({ localAmount: 900000 }), charge({ type: 'Recievable', localAmount: 1000000 })] }),
      awb({ id: 2, awb: '230-2', charges: [charge({ localAmount: 100 }), charge({ type: 'Recievable', localAmount: 1000 })] }),
    ]);
    expect(out.totals.receivable).toBe(1001000);
    expect(out.totals.profit).toBe(100900);
    expect(out.totals.marginPerc).toBe(10.08);
  });

  test('rounds to two places, so float noise is not printed', () => {
    const out = buildSalesReport([
      awb({ charges: [charge({ exRate: 1, localAmount: 0.1 }), charge({ exRate: 1, localAmount: 0.2 })] }),
    ]);
    expect(out.totals.payable).toBe(0.3);
  });

  test('an empty period is an empty report, not an error', () => {
    const out = buildSalesReport([]);
    expect(out.rows).toEqual([]);
    expect(out.totals.awbs).toBe(0);
    expect(out.totals.marginPerc).toBe(0);
    expect(buildSalesReport(undefined).rows).toEqual([]);
  });
});

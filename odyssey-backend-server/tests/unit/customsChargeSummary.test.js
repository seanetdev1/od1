/**
 * What one declaration earned - functions/customsChargeSummary.
 *
 * The arithmetic somebody will check against a printed statement, so it is
 * tested the way they would check it: a known sheet, a known payment, and the
 * figure it should produce.
 *
 * The two things worth pinning, because both have been got wrong in this app
 * already:
 *
 *   - DIRECT JOB money counts. A cartage bill paid in cash through Accounts >
 *     Direct Job E / R never becomes a charge on the sheet, so a summary built
 *     from the sheet alone reports a profit that is too high by exactly that
 *     cost - which is the report the whole feature exists to correct.
 *
 *   - SETTLEMENT IS PER INVOICE, NOT PER LINE. The freight summary credits
 *     every charge on an invoice with the whole payment, so an invoice of five
 *     charges settled in full reports five times its value as realized. Here
 *     it is apportioned.
 */
const {
  summariseCharges, settledFractionOf, directLineDetail, directEntryRefs,
} = require('../../functions/customsChargeSummary');

const RECEIVABLE = 'Recievable';   // the app's own spellings, misspelled and
const PAYABLE = 'Payble';          // load-bearing - see functions/customsCharge

const charge = (x = {}) => ({
  charge: '1', type: RECEIVABLE, local_amount: 1000, Invoice: null, ...x,
});

const invoice = (total, settled, receivable = true) => ({
  id: 1, total, paid: receivable ? 0 : settled, recieved: receivable ? settled : 0,
});

const direct = (x = {}) => ({
  Charge_Name: '1', Amount: 100, Ex_Rate: 1,
  DirectJob: { Type: 'expense' }, ...x,
});

const only = (result) => {
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
};

describe('a sheet with no settlement', () => {
  test('an uninvoiced receivable is revenue, and all of it unrealized', () => {
    const row = only(summariseCharges({ charges: [charge({ local_amount: 5000 })] }));
    expect(row.unrealizedRevenue).toBe(5000);
    expect(row.realizedRevenue).toBe(0);
    expect(row.totalRevenue).toBe(5000);
  });

  test('a payable is cost, never negative revenue', () => {
    const row = only(summariseCharges({
      charges: [charge({ type: PAYABLE, local_amount: 1500 })],
    }));
    expect(row.unrealizedCost).toBe(1500);
    expect(row.totalRevenue).toBe(0);
    expect(row.totalNet).toBe(-1500);
  });

  test('an invoice raised but not paid is still unrealized', () => {
    // Invoiced is not settled. This is the distinction the column exists for.
    const row = only(summariseCharges({
      charges: [charge({ local_amount: 5000, Invoice: invoice(5000, 0) })],
    }));
    expect(row.realizedRevenue).toBe(0);
    expect(row.unrealizedRevenue).toBe(5000);
  });

  test('the LOCAL amount is used, not the face amount', () => {
    // A charge raised in USD is money in the books only once converted, and a
    // summary mixing the two would add dollars to rupees and print the sum.
    const row = only(summariseCharges({
      charges: [charge({ currency: 'USD', rate_charge: 100, local_amount: 28100 })],
    }));
    expect(row.totalRevenue).toBe(28100);
  });
});

describe('settlement, apportioned', () => {
  test('a fully paid invoice realizes its charge in full', () => {
    const row = only(summariseCharges({
      charges: [charge({ local_amount: 5000, Invoice: invoice(5000, 5000) })],
    }));
    expect(row.realizedRevenue).toBe(5000);
    expect(row.unrealizedRevenue).toBe(0);
  });

  test('a half-paid invoice splits each of its lines in half', () => {
    // NOT "the first line is paid and the second is not" - a part payment says
    // nothing about which charge it was for, so the only division the data
    // supports is each line's share.
    const inv = invoice(4000, 2000);
    const { rows, totals } = summariseCharges({
      charges: [
        charge({ charge: '1', local_amount: 3000, Invoice: inv }),
        charge({ charge: '2', local_amount: 1000, Invoice: inv }),
      ],
    });
    expect(rows.find((r) => r.charge === '1').realizedRevenue).toBe(1500);
    expect(rows.find((r) => r.charge === '2').realizedRevenue).toBe(500);
    // And the whole payment is accounted for exactly once.
    expect(totals.realizedRevenue).toBe(2000);
  });

  test('does NOT credit every line with the whole payment', () => {
    // The freight summary's bug, pinned here so this one cannot acquire it: an
    // invoice of five charges settled in full reported five times its value.
    const inv = invoice(5000, 5000);
    const { totals } = summariseCharges({
      charges: [1, 2, 3, 4, 5].map((n) => charge({ charge: String(n), local_amount: 1000, Invoice: inv })),
    });
    expect(totals.realizedRevenue).toBe(5000);
  });

  test('a payable reads `paid`, a receivable reads `recieved`', () => {
    const rec = only(summariseCharges({
      charges: [charge({ local_amount: 1000, Invoice: invoice(1000, 1000, true) })],
    }));
    expect(rec.realizedRevenue).toBe(1000);

    const pay = only(summariseCharges({
      charges: [charge({ type: PAYABLE, local_amount: 1000, Invoice: invoice(1000, 1000, false) })],
    }));
    expect(pay.realizedCost).toBe(1000);
  });

  test('an over-payment does not realize more than was billed', () => {
    // Real in this book - rounding, or a client clearing an old balance with a
    // new invoice. A line must not report more revenue than it ever raised.
    const row = only(summariseCharges({
      charges: [charge({ local_amount: 1000, Invoice: invoice(1000, 1500) })],
    }));
    expect(row.realizedRevenue).toBe(1000);
    expect(row.unrealizedRevenue).toBe(0);
  });

  test('a rounding-sized remainder counts as fully settled', () => {
    const row = only(summariseCharges({
      charges: [charge({ local_amount: 1000, Invoice: invoice(1000, 999.999) })],
    }));
    expect(row.realizedRevenue).toBe(1000);
  });

  test('an invoice with no total but money against it is fully realized', () => {
    // Rather than dividing by zero and silently reporting nothing.
    expect(settledFractionOf({ total: 0, recieved: 500 }, true)).toBe(1);
  });
});

describe('Direct Job money, which is the point of this', () => {
  test('an expense entered through Direct Job becomes REALIZED cost', () => {
    // It is not an invoice waiting to be paid - it is a voucher that already
    // moved money.
    const row = only(summariseCharges({ directLines: [direct({ Amount: 1500 })] }));
    expect(row.realizedCost).toBe(1500);
    expect(row.unrealizedCost).toBe(0);
  });

  test('a revenue entry becomes realized revenue', () => {
    const row = only(summariseCharges({
      directLines: [direct({ Amount: 900, DirectJob: { Type: 'revenue' } })],
    }));
    expect(row.realizedRevenue).toBe(900);
  });

  test('it is converted at its own ex-rate', () => {
    const row = only(summariseCharges({
      directLines: [direct({ Amount: 100, Ex_Rate: 281 })],
    }));
    expect(row.realizedCost).toBe(28100);
  });

  test('a missing ex-rate is 1, not zero', () => {
    // A zero would silently drop the line from the report entirely.
    const row = only(summariseCharges({ directLines: [direct({ Amount: 500, Ex_Rate: null })] }));
    expect(row.realizedCost).toBe(500);
  });

  test('it lands on the SAME row as a sheet charge for the same head', () => {
    // One charge head, both sources, one line in the report.
    const result = summariseCharges({
      charges: [charge({ charge: '7', local_amount: 5000 })],
      directLines: [direct({ Charge_Name: '7', Amount: 1500 })],
    });
    const row = only(result);
    expect(row.totalRevenue).toBe(5000);
    expect(row.totalCost).toBe(1500);
    expect(row.totalNet).toBe(3500);
    expect(row.fromCharges).toBe(1);
    expect(row.fromDirect).toBe(1);
  });

  test('a charge head that exists ONLY as a direct entry still gets a row', () => {
    // The whole failure this fixes: money against the file that the charge
    // sheet has never heard of.
    const result = summariseCharges({
      charges: [charge({ charge: '1', local_amount: 5000 })],
      directLines: [direct({ Charge_Name: '99', Amount: 1500 })],
    });
    expect(result.rows).toHaveLength(2);
    expect(result.totals.totalCost).toBe(1500);
    expect(result.totals.totalNet).toBe(3500);
  });
});

describe('the report as a whole', () => {
  test('totals are the sum of the rows', () => {
    const { rows, totals } = summariseCharges({
      charges: [
        charge({ charge: '1', local_amount: 5000, Invoice: invoice(5000, 2500) }),
        charge({ charge: '2', type: PAYABLE, local_amount: 1000 }),
      ],
      directLines: [direct({ Charge_Name: '3', Amount: 250 })],
    });
    expect(rows).toHaveLength(3);
    expect(totals.totalRevenue).toBe(5000);
    expect(totals.totalCost).toBe(1250);
    expect(totals.realizedRevenue).toBe(2500);
    expect(totals.totalNet).toBe(3750);
  });

  test('names come from the master, and unnamed heads sort last', () => {
    const { rows } = summariseCharges({
      charges: [
        charge({ charge: '2', local_amount: 1 }),
        charge({ charge: '9', local_amount: 1 }),
        charge({ charge: '1', local_amount: 1 }),
      ],
      names: { 1: 'Same Day Services', 2: 'Cartage' },
    });
    expect(rows.map((r) => r.name || r.charge)).toEqual(['Cartage', 'Same Day Services', '9']);
  });

  test('an empty job is an empty report, not a crash', () => {
    const { rows, totals } = summariseCharges({});
    expect(rows).toEqual([]);
    expect(totals.totalNet).toBe(0);
  });

  test('a charge with no amount still appears, so the head is not lost', () => {
    // A head typed onto the sheet with the figure still to come. Showing it at
    // zero says "nothing yet"; dropping it says "no such charge".
    const row = only(summariseCharges({ charges: [charge({ local_amount: null })] }));
    expect(row.totalRevenue).toBe(0);
    expect(row.fromCharges).toBe(1);
  });

  test('rubbish in the amount is zero, not NaN', () => {
    // A NaN propagates into every total and the whole report prints blank.
    const { totals } = summariseCharges({
      charges: [charge({ local_amount: 'not a number' })],
      directLines: [direct({ Amount: undefined })],
    });
    expect(totals.totalRevenue).toBe(0);
    expect(totals.totalCost).toBe(0);
  });
});

describe('the Direct Job lines, for copying onto the sheet', () => {
  /* A summary row is a total per head and cannot be copied back into a
   * charge line, so the lines go out beside it - see directLineDetail. */
  test('carries what a charge line needs, in plain numbers', () => {
    expect(directLineDetail(direct({
      id: 7, Charge_Name: '5', Description: 'Cartage', Basis: 'unit',
      Quantity: 4, Currency: 'USD', Ex_Rate: '280.000000', Amount: '900.000000',
      DirectJob: { Type: 'expense', Entry_No: 'SNS-DE-12/26' },
    }))).toEqual({
      id: 7, charge: '5', type: 'expense', entryNo: 'SNS-DE-12/26',
      description: 'Cartage', basis: 'unit', quantity: 4,
      currency: 'USD', exRate: 280, amount: 900,
    });
  });

  test('a revenue stays a revenue; anything else is an expense', () => {
    expect(directLineDetail(direct({ DirectJob: { Type: 'revenue' } })).type).toBe('revenue');
    expect(directLineDetail(direct({ DirectJob: null })).type).toBe('expense');
  });

  test('a missing ex-rate is 1, not 0', () => {
    expect(directLineDetail(direct({ Ex_Rate: null })).exRate).toBe(1);
  });
});

describe('the entries behind the Direct Job money, to open them', () => {
  /* The summary names each entry and a click opens it (asked 2026-11-17),
   * so each one goes out with its id - once, however many lines it has. */
  test('one per entry, in the order met, with id, number and side', () => {
    expect(directEntryRefs([
      { DirectJob: { id: 4, Entry_No: 'CL-DE-4/27', Type: 'expense' } },
      { DirectJob: { id: 9, Entry_No: 'CL-DE-9/27', Type: 'revenue' } },
      { DirectJob: { id: 4, Entry_No: 'CL-DE-4/27', Type: 'expense' } },
    ])).toEqual([
      { id: 4, entryNo: 'CL-DE-4/27', type: 'expense' },
      { id: 9, entryNo: 'CL-DE-9/27', type: 'revenue' },
    ]);
  });

  test('a line with no entry, or an entry with no number, is left out', () => {
    expect(directEntryRefs([{ DirectJob: null }, { DirectJob: { id: 2, Entry_No: '' } }, null])).toEqual([]);
    expect(directEntryRefs(undefined)).toEqual([]);
  });
});

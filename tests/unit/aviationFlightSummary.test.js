/**
 * The per-flight summary - functions/aviationFlightSummary.js.
 *
 * One row per flight, uplift AND offload split by reporting tag. The rules
 * worth pinning are the ones a reader of the report cannot check for
 * themselves: which figure each column sums, what a cancelled flight
 * contributes, and where an AWB lands when its own tag and its carrier's
 * disagree.
 */
const {
  buildFlightSummary, flightRow, gamLabelFor,
} = require('../../functions/aviationFlightSummary');

const line = (x = {}) => ({
  grossWeight: null, carriedForward: null, offload: null,
  reportingTag: null, carrierCategory: null, ...x,
});

const flight = (x = {}) => ({
  id: 1, jobNo: 'AVJ-1', flightNo: 'PK-301', flightDate: '2026-04-10',
  status: 'Operated', canceled: false, pfm: 1000,
  origin: 'KHI', destination: 'JED',
  aircraft: 'A330', operatingCarrier: { name: 'Gamma Air', category: 'GAM' },
  consignments: [], ...x,
});

describe('a flight row', () => {
  test('splits uplift and offload into the tag each AWB carries', () => {
    const r = flightRow(flight({
      consignments: [
        line({ grossWeight: 1000, offload: 200, carrierCategory: 'GAM' }),
        line({ grossWeight: 500, offload: 0, carrierCategory: 'IFA' }),
        line({ grossWeight: 300, offload: 100, carrierCategory: 'Other' }),
      ],
    }));

    // Uplift is what LEFT: asked less offloaded.
    expect(r.uplift.GAM).toBe(800);
    expect(r.uplift.IFA).toBe(500);
    expect(r.uplift.Other).toBe(200);
    expect(r.offload.GAM).toBe(200);
    expect(r.offload.Other).toBe(100);
    expect(r.totalUplift).toBe(1500);
    expect(r.totalOffload).toBe(300);
  });

  test("prefers the AWB's own tag over its carrier's", () => {
    // The per-AWB override: a GAM carrier flying a load that belongs to Other.
    const r = flightRow(flight({
      consignments: [line({ grossWeight: 400, carrierCategory: 'GAM', reportingTag: 'Other' })],
    }));
    expect(r.uplift.GAM).toBe(0);
    expect(r.uplift.Other).toBe(400);
  });

  test("reads a carrier still tagged 'ER' as GAM", () => {
    // Pre-1.2.3 carriers. Untranslated, this cargo would land in `untagged`
    // and the GAM column would silently lose a month of it.
    const r = flightRow(flight({
      consignments: [line({ grossWeight: 250, carrierCategory: 'ER' })],
    }));
    expect(r.uplift.GAM).toBe(250);
  });

  test('counts an AWB with no tag at all as untagged, not as Other', () => {
    // A real gap someone has to fill in. Folding it into Other would bury it
    // in a column that looks correct.
    const r = flightRow(flight({
      consignments: [line({ grossWeight: 100, offload: 40 })],
    }));
    expect(r.uplift.Other).toBe(0);
    expect(r.uplift.untagged).toBe(60);
    expect(r.offload.untagged).toBe(40);
    // But it still reaches the totals - the flight did carry it.
    expect(r.totalUplift).toBe(60);
    expect(r.totalOffload).toBe(40);
  });

  test('manifest is what the flight was ASKED to carry', () => {
    // carryIn, not grossWeight: on a continuation leg gross is the AWB's
    // documented total and is repeated, so summing it counts the shipment
    // twice across its legs.
    const r = flightRow(flight({
      consignments: [
        line({ grossWeight: 1000, carriedForward: 300, offload: 100, carrierCategory: 'GAM' }),
      ],
    }));
    expect(r.manifest).toBe(300);
    expect(r.uplift.GAM).toBe(200);
  });

  test('an offload bigger than the load does not make uplift negative', () => {
    const r = flightRow(flight({
      consignments: [line({ grossWeight: 100, offload: 5000, carrierCategory: 'GAM' })],
    }));
    expect(r.uplift.GAM).toBe(0);
  });

  test('a cancelled flight carries nothing, whatever is recorded on it', () => {
    const rows = [
      flightRow(flight({ canceled: true, consignments: [line({ grossWeight: 900, offload: 100, carrierCategory: 'GAM' })] })),
      flightRow(flight({ status: 'Canceled', consignments: [line({ grossWeight: 900, carrierCategory: 'GAM' })] })),
    ];
    for (const r of rows) {
      expect(r.xxld).toBe(1);
      expect(r.pfm).toBe(0);
      expect(r.manifest).toBe(0);
      expect(r.totalUplift).toBe(0);
      expect(r.totalOffload).toBe(0);
    }
  });
});

describe('Flight Counts - one row per aircraft', () => {
  const f = (x) => flight({ consignments: [line({ grossWeight: 1000, carrierCategory: 'GAM' })], ...x });

  test('every flight lands in exactly one of the three counts', () => {
    const { byAircraft } = buildFlightSummary([
      f({ id: 1 }),
      f({ id: 2, status: 'Nill', consignments: [] }),
      f({ id: 3, canceled: true }),
      f({ id: 4, status: 'Not-Operated' }),
    ]);
    const [a] = byAircraft;
    expect([a.ttlFlt, a.opFlt, a.xxld, a.notOp]).toEqual([4, 2, 1, 1]);
    // The invariant the view is read for: the three add back to the total.
    expect(a.opFlt + a.xxld + a.notOp).toBe(a.ttlFlt);
  });

  test('TTL Wgt is what flew, so a grounded flight adds nothing', () => {
    const { byAircraft } = buildFlightSummary([
      f({ id: 1 }),
      f({ id: 2, canceled: true }),
      f({ id: 3, status: 'Not-Operated' }),
    ]);
    expect(byAircraft[0].totalUplift).toBe(1000);
  });

  test('one row per aircraft, in name order', () => {
    const { byAircraft } = buildFlightSummary([
      f({ id: 1, aircraft: 'B737' }),
      f({ id: 2, aircraft: 'A330' }),
      f({ id: 3, aircraft: 'A330' }),
    ]);
    expect(byAircraft.map((r) => [r.aircraft, r.ttlFlt])).toEqual([['A330', 2], ['B737', 1]]);
  });

  test('a flight with no aircraft is kept, labelled', () => {
    // Losing flights from a count of flights is the one unforgivable bug here.
    const { byAircraft } = buildFlightSummary([f({ id: 1, aircraft: '' })]);
    expect(byAircraft[0].aircraft).toBe('(no aircraft)');
    expect(byAircraft[0].ttlFlt).toBe(1);
  });

  describe('PLA, reduced from many flights to one figure', () => {
    test('agreeing flights report that figure, and say it does not vary', () => {
      const { byAircraft } = buildFlightSummary([
        f({ id: 1, pla: 60000 }), f({ id: 2, pla: 60000 }),
      ]);
      expect(byAircraft[0].pla).toBe(60000);
      expect(byAircraft[0].plaVaries).toBe(false);
    });

    test('differing flights report the mean, and say so', () => {
      const { byAircraft } = buildFlightSummary([
        f({ id: 1, pla: 60000 }), f({ id: 2, pla: 50000 }),
      ]);
      expect(byAircraft[0].pla).toBe(55000);
      expect(byAircraft[0].plaVaries).toBe(true);
    });

    test('flights with no PLA typed are left out of the mean, not counted as nought', () => {
      // Counting them as zero would drag the figure toward nought for every
      // flight nobody filled in, and it is a figure people plan against.
      const { byAircraft } = buildFlightSummary([
        f({ id: 1, pla: 60000 }), f({ id: 2 }), f({ id: 3, pla: null }),
      ]);
      expect(byAircraft[0].pla).toBe(60000);
      expect(byAircraft[0].plaFrom).toBe(1);
      expect(byAircraft[0].ttlFlt).toBe(3);
    });

    test('no PLA anywhere reads as null, not zero', () => {
      // "Nobody typed one" and "this aircraft can lift nothing" are different
      // statements, and 0.00 makes them look the same.
      const { byAircraft } = buildFlightSummary([f({ id: 1 })]);
      expect(byAircraft[0].pla).toBeNull();
    });

    test('a cancelled flight still contributes its PLA', () => {
      const { byAircraft } = buildFlightSummary([f({ id: 1, canceled: true, pla: 60000 })]);
      expect(byAircraft[0].pla).toBe(60000);
    });
  });
});

describe('the GAM column heading', () => {
  test('is the airline when the flights name exactly one GAM carrier', () => {
    expect(gamLabelFor([flight(), flight({ id: 2 })])).toBe('Gamma Air');
  });

  test('falls back to the tag when a run spans two GAM airlines', () => {
    // A single heading cannot name two carriers, and picking one would
    // mislabel the other's cargo.
    expect(gamLabelFor([
      flight(),
      flight({ id: 2, operatingCarrier: { name: 'Delta Cargo', category: 'GAM' } }),
    ])).toBe('GAM');
  });

  test('ignores an airline that is not tagged GAM', () => {
    expect(gamLabelFor([
      flight({ operatingCarrier: { name: 'Someone Else', category: 'Other' } }),
    ])).toBe('GAM');
    expect(gamLabelFor([])).toBe('GAM');
  });

  test("names a GAM airline still stored as 'ER'", () => {
    expect(gamLabelFor([
      flight({ operatingCarrier: { name: 'Gamma Air', category: 'ER' } }),
    ])).toBe('Gamma Air');
  });
});

describe('the report', () => {
  test('totals every column across the flights', () => {
    const out = buildFlightSummary([
      flight({ id: 1, pfm: 1000, consignments: [line({ grossWeight: 800, offload: 100, carrierCategory: 'GAM' })] }),
      flight({ id: 2, pfm: 500, flightDate: '2026-04-11', consignments: [line({ grossWeight: 400, offload: 50, carrierCategory: 'IFA' })] }),
    ]);

    expect(out.totals.flights).toBe(2);
    expect(out.totals.pfm).toBe(1500);
    expect(out.totals.manifest).toBe(1200);
    expect(out.totals.uplift.GAM).toBe(700);
    expect(out.totals.uplift.IFA).toBe(350);
    expect(out.totals.offload.GAM).toBe(100);
    expect(out.totals.totalUplift).toBe(1050);
    expect(out.totals.totalOffload).toBe(150);
  });

  test('counts a cancelled flight as a flight, and as an XXLD', () => {
    // It is part of the schedule. Dropping the row would make the report
    // disagree with the flight list about how many flights the month had.
    const out = buildFlightSummary([
      flight({ id: 1 }),
      flight({ id: 2, canceled: true, pfm: 900 }),
    ]);
    expect(out.totals.flights).toBe(2);
    expect(out.totals.xxld).toBe(1);
    expect(out.totals.pfm).toBe(1000);
  });

  test('reads oldest first, then by flight number', () => {
    const out = buildFlightSummary([
      flight({ id: 1, flightDate: '2026-04-12', flightNo: 'PK-301' }),
      flight({ id: 2, flightDate: '2026-04-10', flightNo: 'PK-999' }),
      flight({ id: 3, flightDate: '2026-04-12', flightNo: 'PK-100' }),
    ]);
    expect(out.rows.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  test('carries the label the GAM column should be headed with', () => {
    const out = buildFlightSummary([flight()]);
    expect(out.labels).toEqual({ gam: 'Gamma Air', ifa: 'IFA', other: 'Other' });
  });

  test('rounds to two places, so float noise is not printed', () => {
    const out = buildFlightSummary([
      flight({ consignments: [line({ grossWeight: 0.1, carrierCategory: 'GAM' }), line({ grossWeight: 0.2, carrierCategory: 'GAM' })] }),
    ]);
    expect(out.totals.uplift.GAM).toBe(0.3);
  });

  test('an empty period is an empty report, not an error', () => {
    const out = buildFlightSummary([]);
    expect(out.rows).toEqual([]);
    expect(out.totals.flights).toBe(0);
    expect(buildFlightSummary(undefined).rows).toEqual([]);
  });
});

/**
 * MANIFEST AND UPLIFT ARE BUILT FROM RESOLVED CARRY-IN.
 *
 * Not from grossWeight, which is the air waybill's documented total and is
 * repeated on every leg of a split; and no longer from the carriedForward
 * snapshot stored on the row, which nothing recomputes and nobody can see.
 * Each leg is read against the leg before it on the same AWB.
 *
 * These go through buildFlightSummary rather than flightRow, because resolving
 * a leg needs the AWB's other legs - which is exactly what a single row cannot
 * see, and what the bug came down to.
 */
describe('carry-in across a split shipment', () => {
  const leg = (x = {}) => line({ id: 1, awb: '91236843', ...x });

  const twoFlights = (first, second) => buildFlightSummary([
    flight({ id: 6, jobNo: 'AVJ-6', flightDate: '2026-09-21', consignments: [first] }),
    flight({ id: 7, jobNo: 'AVJ-7', flightDate: '2026-09-22', consignments: [second] }),
  ]);

  test('a genuine continuation is counted once across both legs', () => {
    // A 1,000 kg AWB, 300 of it bumped to the next aircraft. Gross says 1,000
    // on BOTH legs; summing it would report 1,700 carried.
    const { rows, totals } = twoFlights(
      leg({ id: 1, grossWeight: 1000, offload: 300, carrierCategory: 'GAM' }),
      leg({ id: 2, grossWeight: 1000, offload: 0, carrierCategory: 'GAM' }),
    );
    expect(rows.map((r) => r.manifest)).toEqual([1000, 300]);
    expect(rows.map((r) => r.totalUplift)).toEqual([700, 300]);
    expect(totals.totalUplift).toBe(1000);   // the air waybill, not 1,700
  });

  test('a RE-CUT AWB reports its new weight, not the weight it was offloaded by', () => {
    // The case this was all found from: offloaded in full on the first flight,
    // then the number reused for a bigger shipment on the second. Both screens
    // went on reporting 500 - the cargo that had been left behind - however
    // much the operator corrected on the row.
    const { rows } = twoFlights(
      leg({ id: 15, grossWeight: 500, offload: 500, carrierCategory: 'GAM' }),
      leg({ id: 16, grossWeight: 2000, offload: 0, carriedForward: 500, carrierCategory: 'GAM' }),
    );
    expect(rows[0]).toMatchObject({ manifest: 500, totalUplift: 0, totalOffload: 500 });
    expect(rows[1]).toMatchObject({ manifest: 2000, totalUplift: 2000, totalOffload: 0 });
  });

  test('a carried-forward figure with no offload behind it counts for nothing', () => {
    // The first leg flew the lot, so the second was asked to carry nothing -
    // whatever its snapshot still says. Left alone it inflated the AWB to 1,300.
    const { rows, totals } = twoFlights(
      leg({ id: 1, grossWeight: 1000, offload: null, carrierCategory: 'GAM' }),
      leg({ id: 5, grossWeight: 1000, offload: null, carriedForward: 300, carrierCategory: 'GAM' }),
    );
    expect(rows.map((r) => r.manifest)).toEqual([1000, 0]);
    expect(totals.totalUplift).toBe(1000);
  });

  test('a predecessor outside the period is taken from the prior legs', () => {
    // The report is bounded by a month; the AWB is not. Without the earlier leg
    // the continuation looks like a first leg and reports the whole air waybill.
    const continuation = leg({ id: 2, grossWeight: 1000, offload: 0, carrierCategory: 'GAM' });
    const august = {
      id: 1, awb: '91236843', grossWeight: 1000, offload: 300,
      flightDate: '2026-07-28', status: 'Operated', canceled: false,
    };

    // Dated AFTER the prior leg - the default fixture flight flies in April,
    // which would put the "earlier" leg later and make it the continuation.
    const inAugust = flight({ flightDate: '2026-08-02', consignments: [continuation] });

    const alone = buildFlightSummary([inAugust]);
    expect(alone.rows[0].manifest).toBe(1000);

    const withPrior = buildFlightSummary([inAugust], [august]);
    expect(withPrior.rows[0].manifest).toBe(300);
  });

  test('a leg with no id falls back to its stored snapshot', () => {
    // Nothing can be resolved without one, and reading the row beats nought.
    const r = buildFlightSummary([flight({
      consignments: [line({ awb: 'X', grossWeight: 1000, carriedForward: 250, carrierCategory: 'GAM' })],
    })]);
    expect(r.rows[0].manifest).toBe(250);
  });
});

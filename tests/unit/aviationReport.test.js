/**
 * The monthly sector report.
 *
 * The figures below are taken from the department's own Sep-24 workbook, so
 * these tests check the report reproduces what they already publish rather
 * than merely being self-consistent.
 */
const { buildReport, isCancelled, isNil } = require('../../functions/aviationReport');

const flight = (o) => ({
  sector: 'LHE - JED', aircraft: 'A330', region: 'KSA',
  status: 'Active', uplift: {}, ...o,
});

describe('flight status', () => {
  test('cancelled by either the flag or the status', () => {
    expect(isCancelled({ canceled: true, status: 'Active' })).toBe(true);
    expect(isCancelled({ status: 'Canceled' })).toBe(true);
    expect(isCancelled({ status: 'Active' })).toBe(false);
  });

  test('a cancelled flight is not also counted as NIL', () => {
    expect(isNil({ status: 'Nill', canceled: true })).toBe(false);
    expect(isNil({ status: 'Nill' })).toBe(true);
  });
});

describe('LHE - JED A330, September 2024', () => {
  // 17 operated flights, one of them carrying 580 kg for another carrier.
  //
  // The Sep-24 sheet also shows a 7,960 kg ER offload on the 13th. Offload is
  // no longer a flight figure - it is recorded on the AWB it happened to - so
  // it is not part of this report and the uplift totals below are unaffected
  // by it, which is the point: an offload never counted toward uplift anyway.
  const rows = [
    [2290, 0], [15060, 0], [9480, 0], [9140, 0], [17110, 0],
    [11990, 0], [20260, 0], [19200, 0], [18260, 0], [15710, 0],
    [16040, 0], [13270, 0], [8940, 0], [8330, 0], [19460, 580],
    [12860, 0], [17860, 0],
  ].map(([er, other], i) => flight({
    flightDate: `2024-09-${String(i + 1).padStart(2, '0')}`,
    uplift: { GAM: er, IFA: 0, Other: other },
  }));

  const t = buildReport(rows).sheets[0].totals;

  test('flight counts match the sheet', () => {
    expect([t.flights, t.nil, t.xxld, t.ops]).toEqual([17, 0, 0, 17]);
  });

  test('uplift totals match the sheet', () => {
    expect(t.gamUplift).toBe(235260);
    expect(t.otherCarrier).toBe(580);
  });

  test('carries no offload figures at all', () => {
    // Offload moved to the consignment. A totals object still holding the
    // keys would have them silently stuck at zero, which reads as "nothing
    // was offloaded this month" rather than "this report does not say".
    expect(t).not.toHaveProperty('erOffload');
    expect(t).not.toHaveProperty('otherOffload');
  });

  test('TTl uplift is ER + IFA + Other, excluding offloads', () => {
    expect(t.ttlUplift).toBe(235840);
  });

  test('ER average is per OPERATED flight', () => {
    expect(t.gamAvg).toBeCloseTo(235260 / 17, 6);
  });
});

describe('ISB - JED A330, September 2024', () => {
  // 18 flights, 5 NIL, 1 cancelled -> 17 operated. A NIL flight FLEW; it just
  // carried nothing, so it counts toward ops.
  const rows = [
    ...Array.from({ length: 5 }, (_, i) =>
      flight({ flightDate: `2024-09-0${i + 1}`, status: 'Nill' })),
    flight({ flightDate: '2024-09-06', status: 'Canceled' }),
    ...Array.from({ length: 12 }, (_, i) =>
      flight({ flightDate: `2024-09-${10 + i}`, uplift: { GAM: 100 } })),
  ];

  test('ops excludes cancellations but NOT NIL flights', () => {
    const t = buildReport(rows).sheets[0].totals;
    expect([t.flights, t.nil, t.xxld, t.ops]).toEqual([18, 5, 1, 17]);
  });
});

describe('a cancelled flight', () => {
  const t = buildReport([flight({
    flightDate: '2024-09-01', status: 'Canceled',
    pfm: 5000, manifest: 4000,
    uplift: { GAM: 4000, IFA: 10, Other: 5 },
  })]).sheets[0].totals;

  test('contributes no cargo, whatever is recorded against it', () => {
    // A cancellation entered after the load figures would otherwise inflate
    // the month with cargo that never left the ground.
    expect([t.pfm, t.manifest, t.gamUplift, t.ttlUplift]).toEqual([0, 0, 0, 0]);
  });

  test('still counts as a flight, and as cancelled', () => {
    expect([t.flights, t.xxld, t.ops]).toEqual([1, 1, 0]);
  });

  test('leaves the averages null rather than zero', () => {
    // "0.00 avg" reads as a real result; nothing operated, so there is none.
    expect(t.gamAvg).toBeNull();
    expect(t.ttlAvg).toBeNull();
  });
});

describe('grouping', () => {
  const report = buildReport([
    flight({ flightDate: '2024-09-01', sector: 'LHE - JED', aircraft: 'A330', region: 'KSA', uplift: { GAM: 10 } }),
    flight({ flightDate: '2024-09-02', sector: 'LHE - JED', aircraft: 'B737', region: 'KSA', uplift: { GAM: 20 } }),
    flight({ flightDate: '2024-09-03', sector: 'ISB - DXB', aircraft: 'A330', region: 'UAE', uplift: { IFA: 30 } }),
  ]);

  test('one sheet per sector AND aircraft', () => {
    expect(report.sheets.map((s) => `${s.sector} ${s.aircraft}`))
      .toEqual(['ISB - DXB A330', 'LHE - JED A330', 'LHE - JED B737']);
  });

  test('regions roll up by region and aircraft', () => {
    expect(report.regions.map((r) => `${r.region} ${r.aircraft}`))
      .toEqual(['KSA A330', 'KSA B737', 'UAE A330']);
  });

  test('the grand total spans every sheet', () => {
    expect(report.grand.flights).toBe(3);
    expect(report.grand.ttlUplift).toBe(60);
  });

  test('rows within a sheet read in date order', () => {
    const out = buildReport([
      flight({ flightDate: '2024-09-20' }),
      flight({ flightDate: '2024-09-02' }),
      flight({ flightDate: '2024-09-11' }),
    ]);
    expect(out.sheets[0].rows.map((r) => r.date))
      .toEqual(['2024-09-02', '2024-09-11', '2024-09-20']);
  });

  test('a flight with no route or aircraft still appears, labelled', () => {
    // Losing a flight from the month is worse than showing it as unassigned.
    const out = buildReport([flight({ flightDate: '2024-09-01', sector: '', aircraft: '', region: '' })]);
    expect(out.sheets[0].sector).toBe('(no route)');
    expect(out.sheets[0].aircraft).toBe('(no aircraft)');
    expect(out.grand.flights).toBe(1);
  });
});

describe('a flight that did not operate', () => {
  const base = { flightDate: '2024-09-01', uplift: { GAM: 5000 }, pfm: 6000, pla: 60000 };

  test('is its own count, not a cancellation', () => {
    // An airline is asked how many scheduled flights it cancelled. Rolling a
    // not-operated flight into XXLD answers that question wrongly.
    const t = buildReport([
      flight({ ...base }),
      flight({ ...base, status: 'Not-Operated' }),
      flight({ ...base, status: 'Canceled' }),
    ]).sheets[0].totals;
    expect([t.flights, t.xxld, t.notOp, t.ops]).toEqual([3, 1, 1, 1]);
  });

  test('carried nothing, exactly like a cancelled flight', () => {
    const [r] = buildReport([flight({ ...base, status: 'Not-Operated' })]).sheets[0].rows;
    expect([r.gamUplift, r.ttlUplift, r.pfm, r.manifest]).toEqual([0, 0, 0, 0]);
  });

  test('keeps its PLA, because the aircraft did not shrink', () => {
    // PFM is cargo that never flew; PLA is the payload that was available
    // whether or not anyone used it. Zeroing it would pull the fleet's
    // available payload down every time a flight was scrubbed.
    const rows = buildReport([
      flight({ ...base, status: 'Not-Operated' }),
      flight({ ...base, status: 'Canceled' }),
    ]).sheets[0].rows;
    expect(rows.map((r) => r.pla)).toEqual([60000, 60000]);
  });

  test('is out of the averages, which divide by operated flights', () => {
    // Two flights, one scrubbed: 5,000 kg over ONE operated flight is 5,000.
    // Counting the scrubbed one would report 2,500 and read as a bad month.
    const t = buildReport([
      flight({ ...base }),
      flight({ ...base, status: 'Not-Operated', uplift: {} }),
    ]).sheets[0].totals;
    expect(t.ops).toBe(1);
    expect(t.ttlAvg).toBe(5000);
  });

  test('cancellation still wins when a flight says both', () => {
    // The Cancel Flight button sets a flag the status dropdown knows nothing
    // about. Counted in both buckets, the counts would not add up.
    const t = buildReport([
      flight({ ...base, status: 'Not-Operated', canceled: true }),
    ]).sheets[0].totals;
    expect([t.xxld, t.notOp, t.ops]).toEqual([1, 0, 0]);
  });

  test('a NIL flight is still operated', () => {
    // It went, it carried nothing. Unchanged by any of the above.
    const t = buildReport([flight({ ...base, status: 'Nill', uplift: {} })]).sheets[0].totals;
    expect([t.nil, t.notOp, t.ops]).toEqual([1, 0, 1]);
  });
});

describe('merged aircraft', () => {
  const flights = [
    flight({ flightDate: '2024-09-01', sector: 'LHE - JED', aircraft: 'A330', region: 'KSA', uplift: { GAM: 10 } }),
    flight({ flightDate: '2024-09-02', sector: 'LHE - JED', aircraft: 'B737', region: 'KSA', uplift: { GAM: 20 } }),
    flight({ flightDate: '2024-09-03', sector: 'ISB - DXB', aircraft: 'A330', region: 'UAE', uplift: { IFA: 30 } }),
  ];
  const merged = buildReport(flights, { mergeAircraft: true });

  test('one sheet per sector, whatever flew it', () => {
    expect(merged.sheets.map((s) => s.sector)).toEqual(['ISB - DXB', 'LHE - JED']);
  });

  test('a merged sheet names no aircraft, and says how many there were', () => {
    // null rather than a joined string: the caller decides what to show, and
    // cannot accidentally print 'A330, B737' into a column sized for one.
    const lhe = merged.sheets.find((s) => s.sector === 'LHE - JED');
    expect(lhe.aircraft).toBeNull();
    expect(lhe.aircraftCount).toBe(2);
  });

  test('every flight row carries its own aircraft, in both groupings', () => {
    const lhe = merged.sheets.find((s) => s.sector === 'LHE - JED');
    expect(lhe.rows.map((r) => r.aircraft)).toEqual(['A330', 'B737']);
    // Split mode too - a row that only sometimes knows what flew it is a trap.
    const split = buildReport(flights).sheets.find((s) => s.aircraft === 'B737');
    expect(split.rows[0].aircraft).toBe('B737');
  });

  test('merged totals equal the split sheets added together', () => {
    const split = buildReport(flights).sheets.filter((s) => s.sector === 'LHE - JED');
    const lhe = merged.sheets.find((s) => s.sector === 'LHE - JED');
    expect(lhe.totals.flights).toBe(split.reduce((n, s) => n + s.totals.flights, 0));
    expect(lhe.totals.gamUplift).toBe(30);
  });

  test('averages are per operated flight, not an average of the averages', () => {
    // The whole reason the merge happens on rows rather than on finished
    // sheets. Two flights carrying 10 and 20 average 15 either way; make one
    // sheet carry two flights and the two readings part company.
    const out = buildReport([
      flight({ flightDate: '2024-09-01', aircraft: 'A330', uplift: { GAM: 10 } }),
      flight({ flightDate: '2024-09-02', aircraft: 'A330', uplift: { GAM: 20 } }),
      flight({ flightDate: '2024-09-03', aircraft: 'B737', uplift: { GAM: 120 } }),
    ], { mergeAircraft: true });
    // 150 over 3 operated flights. Averaging the tails' own averages (15 and
    // 120) would give 67.5 and weight a one-flight tail like a two-flight one.
    // ttlAvg is the one the report actually shows; gamAvg is asserted beside
    // it because both are computed the same way and either would drift alone.
    expect(out.sheets[0].totals.ttlAvg).toBe(50);
    expect(out.sheets[0].totals.gamAvg).toBe(50);
  });

  test('regions roll up by region alone', () => {
    expect(merged.regions.map((r) => r.region)).toEqual(['KSA', 'UAE']);
    expect(merged.regions.every((r) => r.aircraft === null)).toBe(true);
    expect(merged.regions.find((r) => r.region === 'KSA').aircraftCount).toBe(2);
  });

  test('the grand total is the same either way', () => {
    const split = buildReport(flights);
    expect(merged.grand).toEqual(split.grand);
  });

  test('the report says which grouping it used', () => {
    // The screen and the workbook read this rather than their own toggle -
    // while a reload is in flight the two disagree, and the data is the one
    // telling the truth about the rows it came with.
    expect(merged.mergeAircraft).toBe(true);
    expect(buildReport(flights).mergeAircraft).toBe(false);
  });
});

describe('untagged cargo', () => {
  test('is carried through so the screen can warn about it', () => {
    // Cargo on an AWB with no carrier belongs to no uplift column. Counting it
    // into one would be a guess; dropping it silently understates the month.
    const t = buildReport([
      flight({ flightDate: '2024-09-01', uplift: { GAM: 100, untagged: 250 } }),
    ]).sheets[0].totals;
    expect(t.untagged).toBe(250);
    expect(t.ttlUplift).toBe(100);
  });
});

describe('an empty month', () => {
  test('produces no sheets and a zeroed grand total', () => {
    const out = buildReport([]);
    expect(out.sheets).toEqual([]);
    expect(out.regions).toEqual([]);
    expect(out.grand.flights).toBe(0);
    expect(out.grand.gamAvg).toBeNull();
  });
});

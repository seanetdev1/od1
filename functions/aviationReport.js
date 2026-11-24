/**
 * The monthly sector report.
 *
 * Shaped after the workbook the department already keeps: one sheet per
 * SECTOR + AIRCRAFT (LHE-JED A330, ISB-DXB 737...), one row per flight, then
 * two rollups - by sector+aircraft, and by region+aircraft.
 *
 * TWO GROUPINGS, and the choice is the caller's (`mergeAircraft`). Split is
 * the workbook's own shape and stays the default. Merged puts one sheet per
 * SECTOR, whatever flew it, and moves the aircraft into a column on each
 * flight row - which is the reading you want when a sector is worked by two
 * or three tails and the question is how the SECTOR did, not how each tail
 * did on it. Split answers the opposite question, so neither replaces the
 * other.
 *
 * The merge happens HERE, on the flight rows, not by adding up split sheets
 * afterwards. Totals are summed from rows either way, so a merged sector's
 * figures are arrived at exactly as a split one's are - and the averages come
 * out right, which summing gamAvg across aircraft would not (an average of
 * averages weights a 2-flight tail the same as a 20-flight one).
 *
 * Kept free of model imports so the arithmetic can be tested without a
 * database. The route hands it plain flight rows; everything below is pure.
 *
 * THE RULES, each verified against every sector sheet of the Sep-24 workbook:
 *
 *   ops         = flights - xxld - notOp
 *                                       NIL flights DO operate: a NIL flight
 *                                       flew, it just carried nothing. A
 *                                       NOT-OPERATED one did not go at all, so
 *                                       it is out of the operated count and
 *                                       out of the averages - counting it
 *                                       would divide the month's uplift by
 *                                       flights that never left.
 *   ttlUplift   = gamUplift + ifaLoads + otherCarrier
 *                                       Offloads are what did NOT fly, so they
 *                                       are excluded. They are no longer in
 *                                       this report at all: an offload happens
 *                                       to a particular AWB, so it is recorded
 *                                       on the consignment rather than as two
 *                                       typed figures on the flight that named
 *                                       no cargo and reconciled with nothing.
 *   gamAvg      = gamUplift / ops       Averages are per OPERATED flight, not
 *   ttlAvg      = ttlUplift / ops       per scheduled one; dividing by flights
 *                                       would understate a month with
 *                                       cancellations.
 *
 * GAM WAS SPELLED 'ER' UNTIL 1.2.3. The flights handed in here already carry
 * the current spelling: routes/aviationJobs translates a carrier's stored tag
 * through functions/carrierCategory on the way in, so nothing below has to
 * know there was ever another name for it.
 */

// The status rules live in functions/aviationPendingLoads and are imported
// rather than restated here. A pure module, so this one is still testable
// without a database - which is the property that matters, not the absence of
// imports. Two copies of "what counts as cancelled" is how the flight screen
// and the report come to different answers about the same flight.
const { isCancelled, isNotOperated } = require('./aviationPendingLoads');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const isNil = (f) => !isCancelled(f) && f.status === 'Nill';

/** One flight, as a row of the sector sheet. */
function flightRow(f) {
  const cancelled = isCancelled(f);
  const notOperated = isNotOperated(f);
  // Cancelled or not-operated, the aircraft did not go. Both zero their cargo
  // for the same reason and are counted in different columns for a different
  // one - see isNotOperated.
  const grounded = cancelled || notOperated;
  const uplift = f.uplift || {};

  // A flight that did not go carried nothing, whatever happens to be recorded
  // against it. Counting its figures would inflate the month with cargo that
  // never left the ground.
  const gam = grounded ? 0 : num(uplift.GAM);
  const ifa = grounded ? 0 : num(uplift.IFA);
  const other = grounded ? 0 : num(uplift.Other);

  return {
    id: f.id,
    jobNo: f.jobNo,
    date: f.flightDate || '',
    flightNo: f.flightNo || '',
    // Carried on every row, in both groupings. Merged mode shows it as a
    // column; split mode does not need it (the sheet heading says it), but a
    // row that only sometimes knows what flew it is a trap for whatever reads
    // this next.
    aircraft: f.aircraft || '',
    nil: isNil(f) ? 1 : 0,
    xxld: cancelled ? 1 : 0,
    notOp: notOperated ? 1 : 0,
    // PLA IS NOT ZEROED on a flight that did not go, and PFM is.
    //
    // PFM is cargo - a plan for what would be carried, and nothing was. PLA is
    // the aircraft's available payload, a property of the aircraft and the
    // route that was as true that day as any other. Zeroing it would drag the
    // fleet's available payload down every time a flight was cancelled, which
    // reads as an aircraft that shrank.
    pla: num(f.pla),
    pfm: grounded ? 0 : num(f.pfm),
    manifest: grounded ? 0 : num(f.manifest),
    gamUplift: gam,
    ifaLoads: ifa,
    otherCarrier: other,
    ttlUplift: gam + ifa + other,
    untagged: grounded ? 0 : num(uplift.untagged),
    remarks: f.remarks || '',
  };
}

const ZERO = () => ({
  flights: 0, nil: 0, xxld: 0, notOp: 0, ops: 0,
  pla: 0, pfm: 0, manifest: 0,
  gamUplift: 0, ifaLoads: 0, otherCarrier: 0,
  ttlUplift: 0, untagged: 0,
});

function addRow(t, r) {
  t.flights += 1;
  t.nil += r.nil;
  t.xxld += r.xxld;
  t.notOp += r.notOp;
  t.pla += r.pla;
  t.pfm += r.pfm;
  t.manifest += r.manifest;
  t.gamUplift += r.gamUplift;
  t.ifaLoads += r.ifaLoads;
  t.otherCarrier += r.otherCarrier;
  t.ttlUplift += r.ttlUplift;
  t.untagged += r.untagged;
  return t;
}

function close(t) {
  t.ops = t.flights - t.xxld - t.notOp;
  // null, not 0, when nothing operated - "0.00 avg" reads as a real result.
  t.gamAvg = t.ops ? t.gamUplift / t.ops : null;
  t.ttlAvg = t.ops ? t.ttlUplift / t.ops : null;
  return t;
}

/**
 * Build the whole report from a month's flights.
 *
 * Each flight must already carry: sector, aircraft, region, and an `uplift`
 * map of { GAM, IFA, Other, untagged } summed off its consignments.
 *
 * `mergeAircraft` folds every tail on a sector into one sheet, and every tail
 * in a region into one rollup row. A merged sheet reports `aircraft: null` -
 * null rather than a joined string, so a reader has to decide what to show
 * instead of printing "A330, 737, (no aircraft)" into a column sized for one
 * tail - and `aircraftCount`, the number of distinct tails behind it.
 */
function buildReport(flights, { mergeAircraft = false } = {}) {
  const sheets = new Map();   // sector [+ aircraft]
  const regions = new Map();  // region [+ aircraft]
  // Distinct tails per group, for `aircraftCount`. A Set per key, so the same
  // aircraft flying a sector thirty times counts once.
  const sheetTails = new Map();
  const regionTails = new Map();

  for (const f of flights) {
    const row = flightRow(f);
    const sector = f.sector || '(no route)';
    const aircraft = f.aircraft || '(no aircraft)';
    const region = f.region || '(unmapped)';

    const sheetKey = mergeAircraft ? sector : `${sector}|${aircraft}`;
    if (!sheets.has(sheetKey)) {
      sheets.set(sheetKey, {
        sector,
        aircraft: mergeAircraft ? null : aircraft,
        rows: [],
        totals: ZERO(),
      });
      sheetTails.set(sheetKey, new Set());
    }
    const sheet = sheets.get(sheetKey);
    sheet.rows.push(row);
    addRow(sheet.totals, row);
    sheetTails.get(sheetKey).add(aircraft);

    const regionKey = mergeAircraft ? region : `${region}|${aircraft}`;
    if (!regions.has(regionKey)) {
      regions.set(regionKey, {
        region,
        aircraft: mergeAircraft ? null : aircraft,
        totals: ZERO(),
      });
      regionTails.set(regionKey, new Set());
    }
    addRow(regions.get(regionKey).totals, row);
    regionTails.get(regionKey).add(aircraft);
  }

  for (const [key, sheet] of sheets) sheet.aircraftCount = sheetTails.get(key).size;
  for (const [key, r] of regions) r.aircraftCount = regionTails.get(key).size;

  const grand = ZERO();
  for (const s of sheets.values()) {
    close(s.totals);
    // Rows read in date order; the sheet list reads by sector then aircraft,
    // so the same month always comes out in the same order.
    s.rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const r of s.rows) addRow(grand, r);
  }
  for (const r of regions.values()) close(r.totals);

  // `|| ''` because a merged group's aircraft is null on purpose; sorting must
  // not be the thing that discovers that.
  const byAircraft = (a, b) => String(a.aircraft || '').localeCompare(String(b.aircraft || ''));

  return {
    mergeAircraft,
    sheets: [...sheets.values()].sort((a, b) =>
      a.sector.localeCompare(b.sector) || byAircraft(a, b)),
    regions: [...regions.values()].sort((a, b) =>
      a.region.localeCompare(b.region) || byAircraft(a, b)),
    grand: close(grand),
  };
}

module.exports = { buildReport, flightRow, isCancelled, isNil, ZERO, addRow, close };

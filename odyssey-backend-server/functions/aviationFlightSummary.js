/**
 * The per-flight summary report.
 *
 * ONE ROW PER FLIGHT, unlike functions/aviationReport.js, which is shaped
 * after the department's workbook - a sheet per sector+aircraft with rollups.
 * Both are wanted: that one answers "how did the LHE-JED A330 do this month",
 * this one answers "what happened on each flight, and what did not fly".
 *
 * OFFLOADS ARE BACK, and split by tag. The sector report drops them, and for
 * good reason: it predates per-AWB offloads, when they were two typed figures
 * on the flight that named no cargo. They are recorded per consignment now, so
 * they can be attributed the same way uplift is - by the reporting tag of the
 * AWB they happened to.
 *
 * THE THREE TAG COLUMNS ARE GAM / IFA / OTHER, and each carries an uplift and
 * an offload. Every AWB on the flight is counted and lands in the column its
 * own tag names - see carrierCategory.tagFor, which prefers the AWB's own
 * override and falls back to its carrier's category.
 *
 * WHAT EACH FIGURE MEANS:
 *
 *   pfm       the plan - what the flight was scheduled to carry. A flight
 *             level figure, typed, and the only one here that is not derived.
 *   manifest  what the flight was ASKED to carry: the sum of each leg's
 *             RESOLVED carry-in. NOT a sum of grossWeight - that is the AWB's
 *             documented total and is repeated on every leg of a split
 *             shipment, so summing it counts a 1,000 kg AWB twice. Nor is it
 *             the carriedForward stored on the row: that is a snapshot taken
 *             when the leg was created and never corrected afterwards. It is
 *             worked out from the AWB's own legs - see carryInByLeg.
 *   uplift    what actually left: carryIn less offload, clamped at 0.
 *   offload   what stayed on the ground.
 *
 * A FLIGHT THAT DID NOT GO CARRIES NOTHING, whatever is recorded against it -
 * cancelled, or marked Not-Operated. Its row is kept - it is part of the
 * month's schedule and the operator wants to see it - but every cargo figure
 * on it is zero, and `xxld` / `notOp` mark which it was. Same rule as
 * functions/aviationReport, so the two reports cannot disagree about a flight
 * that stayed on the ground.
 *
 * TWO READINGS FROM ONE BUILD. `rows` is the flight-by-flight table;
 * `byAircraft` is the same flights counted per aircraft, for the Flight Counts
 * view. Both come back from one call because they are the same arithmetic
 * asked two ways - a second endpoint could be filtered differently and report
 * a different number of cancellations for the same period.
 *
 * Kept free of model imports so the arithmetic can be tested without a
 * database. The route hands it plain rows.
 */

const {
  carryInByLeg, carryInOf, flownWeightOf, isCancelled, isNotOperated, num,
} = require('./aviationPendingLoads');
const carrierCategory = require('./carrierCategory');

const TAGS = ['GAM', 'IFA', 'Other'];

const zeroTags = () => ({ GAM: 0, IFA: 0, Other: 0, untagged: 0 });

/**
 * What to call the GAM column.
 *
 * The tag is a reporting bucket; the thing the operator recognises is the
 * airline. So when the flights in this result are operated by a GAM-category
 * carrier, the column is named after that carrier.
 *
 * ONE NAME OR NONE. A column heading is a single string for the whole table,
 * so it can only be a carrier's name when the result names exactly one such
 * carrier. Where a run spans two GAM airlines it falls back to the tag itself
 * rather than picking one of them and quietly mislabelling the other's cargo.
 */
function gamLabelFor(flights) {
  const names = new Set();
  for (const f of flights || []) {
    const carrier = f.operatingCarrier;
    if (!carrier) continue;
    if (carrierCategory.read(carrier.category) !== 'GAM') continue;
    const name = String(carrier.name || '').trim();
    if (name) names.add(name);
  }
  return names.size === 1 ? [...names][0] : 'GAM';
}

/**
 * One flight, as a row of the summary.
 *
 * `resolved` is the carry-in map from carryInByLeg - what each leg was asked
 * to carry, decided from its AWB's whole history rather than from the snapshot
 * stored on the row. Omitting it falls each leg back to its own snapshot,
 * which is what the old behaviour was; see aviationPendingLoads.
 */
function flightRow(f, resolved) {
  const cancelled = isCancelled(f);
  const notOperated = isNotOperated(f);
  const grounded = cancelled || notOperated;
  const uplift = zeroTags();
  const offload = zeroTags();
  let manifest = 0;

  if (!grounded) {
    for (const c of f.consignments || []) {
      manifest += carryInOf(resolved, c);
      // The AWB's own tag first, then its carrier's - one rule, shared with
      // the sector report and the flight screen's own totals.
      const tag = carrierCategory.tagFor(c.reportingTag, c.carrierCategory);
      const key = tag && uplift[tag] !== undefined ? tag : 'untagged';
      uplift[key] += flownWeightOf(resolved, c);
      offload[key] += num(c.offload);
    }
  }

  const totalUplift = TAGS.reduce((t, k) => t + uplift[k], 0) + uplift.untagged;
  const totalOffload = TAGS.reduce((t, k) => t + offload[k], 0) + offload.untagged;

  return {
    id: f.id,
    jobNo: f.jobNo || '',
    flightNo: f.flightNo || '',
    date: f.flightDate || '',
    aircraft: f.aircraft || '',
    airline: f.operatingCarrier?.name || '',
    origin: f.origin || '',
    destination: f.destination || '',
    sector: [f.origin, f.destination].filter(Boolean).join(' - '),
    xxld: cancelled ? 1 : 0,
    notOp: notOperated ? 1 : 0,
    status: f.status || '',
    // PLA survives a grounded flight, PFM does not - see the note in
    // functions/aviationReport.flightRow. The aircraft's available payload is
    // not a thing the flight failed to carry.
    pla: num(f.pla),
    pfm: grounded ? 0 : num(f.pfm),
    manifest,
    uplift,
    offload,
    totalUplift,
    totalOffload,
  };
}

const ZERO_TOTALS = () => ({
  flights: 0,
  xxld: 0,
  notOp: 0,
  pfm: 0,
  manifest: 0,
  uplift: zeroTags(),
  offload: zeroTags(),
  totalUplift: 0,
  totalOffload: 0,
});

function addRow(t, r) {
  t.flights += 1;
  t.xxld += r.xxld;
  t.notOp += r.notOp;
  t.pfm += r.pfm;
  t.manifest += r.manifest;
  for (const k of [...TAGS, 'untagged']) {
    t.uplift[k] += r.uplift[k];
    t.offload[k] += r.offload[k];
  }
  t.totalUplift += r.totalUplift;
  t.totalOffload += r.totalOffload;
  return t;
}

// Two decimals, applied once at the end. These are sums of per-line
// arithmetic and carry float noise a report would otherwise print.
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

function roundTotals(t) {
  t.pfm = round(t.pfm);
  t.manifest = round(t.manifest);
  for (const k of [...TAGS, 'untagged']) {
    t.uplift[k] = round(t.uplift[k]);
    t.offload[k] = round(t.offload[k]);
  }
  t.totalUplift = round(t.totalUplift);
  t.totalOffload = round(t.totalOffload);
  return t;
}

/**
 * The same flights counted per AIRCRAFT - the Flight Counts view.
 *
 * Aircraft, PLA, then how the period's flights divided: total, operated,
 * cancelled, not-operated, and the weight that actually flew.
 *
 *   ttlFlt = opFlt + xxld + notOp      always, by construction. A NIL flight
 *                                      is OPERATED - it went, it carried
 *                                      nothing - which is why opFlt is not
 *                                      "flights that carried something".
 *
 * PLA IS ONE FIGURE FOR A ROW OF MANY FLIGHTS, and it is typed per flight, so
 * it has to be reduced. Where every flight that carries a PLA agrees, that is
 * the figure and there is nothing to explain. Where they differ - the same
 * aircraft on a longer sector, or a hot day - the mean of the flights that
 * carry one is reported and `plaVaries` says so, because a single number that
 * silently stands for several is the kind of figure someone plans against.
 * Flights with no PLA typed are left OUT of the mean rather than counted as
 * zero, which would drag it toward nought for every flight nobody filled in.
 */
function byAircraftRows(rows) {
  const groups = new Map();

  for (const r of rows) {
    const key = r.aircraft || '(no aircraft)';
    if (!groups.has(key)) {
      groups.set(key, {
        aircraft: key,
        ttlFlt: 0, opFlt: 0, xxld: 0, notOp: 0,
        totalUplift: 0,
        plaValues: [],
      });
    }
    const g = groups.get(key);
    g.ttlFlt += 1;
    g.xxld += r.xxld;
    g.notOp += r.notOp;
    g.totalUplift += r.totalUplift;
    if (r.pla > 0) g.plaValues.push(r.pla);
  }

  return [...groups.values()]
    .map((g) => {
      const { plaValues, ...row } = g;
      const distinct = new Set(plaValues);
      row.opFlt = row.ttlFlt - row.xxld - row.notOp;
      row.pla = plaValues.length
        ? round(plaValues.reduce((a, b) => a + b, 0) / plaValues.length)
        : null;   // null, not 0: nobody typed one, which is not "no payload"
      row.plaVaries = distinct.size > 1;
      row.plaFrom = plaValues.length;   // how many flights the figure rests on
      row.totalUplift = round(row.totalUplift);
      return row;
    })
    .sort((a, b) => a.aircraft.localeCompare(b.aircraft));
}

/**
 * Build the report from the flights the route selected.
 *
 * `labels.gam` is what the GAM column should be headed - see gamLabelFor.
 * Returned rather than left to the screen, so the report and anything printed
 * or exported from it agree about what that column is called.
 */
function buildFlightSummary(flights, priorLegs = []) {
  const list = Array.isArray(flights) ? flights : [];

  /* Every leg of every AWB on these flights, so each one can be read against
   * the leg before it.
   *
   * PRIOR LEGS MATTER AND THE CALLER MUST SUPPLY THEM. A leg whose predecessor
   * flew before the reported period is not in `list`, so without them it looks
   * like a first leg and reports the whole air waybill instead of its share.
   * The route fetches them by AWB with no date bound; see /flightSummary.
   *
   * Consignments are stamped with their flight's date and status because that
   * is what orders them and what says whether the flight went at all - the
   * arithmetic groups legs across flights, so it cannot read those off the row.
   */
  const legs = [
    ...list.flatMap((f) => (f.consignments || []).map((c) => ({
      ...c, flightDate: f.flightDate, status: f.status, canceled: f.canceled,
    }))),
    ...(Array.isArray(priorLegs) ? priorLegs : []),
  ];
  const resolved = carryInByLeg(legs);

  const rows = list.map((f) => flightRow(f, resolved));

  const totals = ZERO_TOTALS();
  for (const r of rows) addRow(totals, r);

  // Rows read oldest first, then by flight number, so the same period always
  // comes out in the same order and two runs can be compared line by line.
  rows.sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
    || String(a.flightNo).localeCompare(String(b.flightNo)));

  for (const r of rows) {
    r.pfm = round(r.pfm);
    r.manifest = round(r.manifest);
    for (const k of [...TAGS, 'untagged']) {
      r.uplift[k] = round(r.uplift[k]);
      r.offload[k] = round(r.offload[k]);
    }
    r.totalUplift = round(r.totalUplift);
    r.totalOffload = round(r.totalOffload);
  }

  return {
    rows,
    byAircraft: byAircraftRows(rows),
    totals: roundTotals(totals),
    labels: { gam: gamLabelFor(list), ifa: 'IFA', other: 'Other' },
  };
}

module.exports = { buildFlightSummary, flightRow, byAircraftRows, gamLabelFor, TAGS };

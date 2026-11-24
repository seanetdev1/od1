/**
 * AWBs still carrying cargo that never flew.
 *
 * THE SITUATION THIS EXISTS FOR. An AWB is booked at 1,000 kg. On the flight
 * it goes out on, 700 kg flies and 300 kg is offloaded - bumped for weight,
 * space or paperwork. That 300 kg is supposed to go on a later flight. If
 * nobody puts the AWB on one, the cargo sits at the airport and nothing in the
 * system ever says so: the flight looks complete, the AWB looks shipped, and
 * the only record of the 300 kg is a number in a column no report reads.
 *
 * THE RULE: an AWB's outstanding amount is the offload on its LATEST leg.
 *
 * Not the sum of its offloads - that double-counts. Work through it:
 *
 *   leg 1   carried 700, offload 300      -> 300 outstanding
 *   leg 2   carried 200, offload 100      -> 100 outstanding, NOT 400
 *
 * Leg 2's 100 is what is left of leg 1's 300, not a second, separate offload.
 * Each leg's offload restates the whole remainder, so the newest one is the
 * answer and the earlier ones are history. Settle it completely - leg 3
 * carries the last 100 with offload 0 - and the AWB drops off this list on its
 * own, with nothing to tick off.
 *
 * The same AWB legitimately appears on several flights (that is what a split
 * shipment IS, and what /aviationJob/relatedCharges bills), so legs are
 * grouped by AWB NUMBER rather than by consignment.
 *
 * Cancelled flights are skipped entirely. A cancelled flight carried nothing,
 * so neither its uplift nor its offload happened - counting its offload would
 * invent cargo that was never left behind. Same rule as
 * functions/aviationReport.
 *
 * Kept free of model imports so the arithmetic can be tested without a
 * database.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What a leg was asked to carry.
 *
 * grossWeight is the AWB's DOCUMENTED total and is repeated verbatim on every
 * leg of a split shipment - it describes the shipment, not the flight. So a
 * continuation leg records what it actually took in carriedForward, and that
 * is the figure every sum has to use. Reading gross instead reports a 1,000 kg
 * AWB as 1,700 kg carried across two legs.
 *
 * Null on a first leg, where the two are the same thing.
 */
const carryIn = (leg) =>
  leg?.carriedForward === null || leg?.carriedForward === undefined
    ? num(leg?.grossWeight)
    : num(leg.carriedForward);

/** What actually left the ground on this leg. */
const flownWeight = (leg) => Math.max(0, carryIn(leg) - num(leg?.offload));

/* ------------------ what a leg was asked to carry, RESOLVED ----------------
 * carryIn above reads the snapshot stored on the row. This reads the AWB's
 * own history instead, and is what every total should use.
 *
 * WHY THE SNAPSHOT IS NOT ENOUGH. carriedForward is written once, when a
 * pending AWB is picked onto a new flight, and never recomputed. It is not
 * shown as a column either, so an operator editing the leg afterwards can
 * neither see it nor correct it. Three ways that goes wrong, all seen in the
 * same book of flights:
 *
 *   a snapshot with nothing behind it   the earlier leg's offload was cleared
 *                                       after this leg was created, so this
 *                                       leg carries forward cargo that already
 *                                       flew - and the AWB reports more
 *                                       carried than it weighs.
 *   a snapshot that outlived its AWB    the number was offloaded in full and
 *                                       then REUSED for a bigger shipment. The
 *                                       snapshot still holds the old weight.
 *   a leg dated before the one it       nothing ever checked the order, so the
 *   continues                           cargo is recorded as flying out the
 *                                       day before it was left behind.
 *
 * THE RULE, given the leg before it on the same AWB:
 *
 *   no earlier leg      grossWeight. This leg IS the shipment.
 *   gross changed       grossWeight. See below - the AWB was re-cut.
 *   otherwise           the earlier leg's offload: what it left behind is
 *                       exactly what this one was asked to pick up.
 *
 * A CHANGED GROSS MEANS THE AWB WAS RE-CUT, and that is the one signal that
 * can be trusted. Gross is the air waybill's DOCUMENTED total - "the same
 * figure on every leg of a split shipment, because it is what the air waybill
 * says" (see the model). So between two legs of one split it cannot
 * legitimately differ. When it does, the number was not continued but reused:
 * the load was offloaded in full and the AWB re-cut for a different, usually
 * larger shipment. Reading the earlier leg's offload there reports the OLD
 * cargo - the very weight that was left behind - and no rule based on what the
 * previous flight dropped can know that new cargo joined it. The operator's
 * own gross is the only figure that does.
 *
 * GROUNDED LEGS ARE NOT PREDECESSORS. A cancelled or not-operated flight
 * carried nothing, so it neither leaves cargo behind nor settles an earlier
 * offload - it is skipped when looking back, exactly as pendingLoads skips it.
 */
const resolveCarryIn = (leg, prev) => {
  if (!prev) return num(leg?.grossWeight);
  if (num(leg?.grossWeight) !== num(prev?.grossWeight)) return num(leg?.grossWeight);
  return num(prev?.offload);
};

/**
 * Resolve every leg in one pass: `Map` of leg id -> what it was asked to carry.
 *
 * Legs are grouped by AWB NUMBER and walked in flight order, the same way
 * pendingLoads groups them - a split shipment is the same AWB on several
 * flights, which is the whole point.
 *
 * FEED IT EVERY LEG OF THE AWBS INVOLVED, not just the ones in the period
 * being reported. A leg whose predecessor flew the month before would
 * otherwise look like a first leg and report the whole air waybill.
 *
 * @param {Array} legs consignment rows carrying at least id, awb, grossWeight,
 *   offload, and enough of their flight to order and ground them: flightDate,
 *   status, canceled.
 */
/**
 * The leg BEFORE each one, on the same air waybill: `Map` of leg id -> leg.
 *
 * The single place the ordering rule lives. Legs are grouped by AWB NUMBER and
 * walked in flight order, the same way pendingLoads groups them - a split
 * shipment is the same AWB on several flights, which is the whole point.
 *
 * Also what the flight screen is sent, so the grid can price a leg the way the
 * reports will: an operator editing Gross WT sees the manifest move as the
 * server would move it, rather than finding out after saving.
 */
function prevLegByLeg(legs) {
  const byAwb = new Map();
  // FIRST MENTION OF A LEG WINS. Callers hand us the period's legs and then
  // every leg of the AWBs involved, which overlap by construction - and the
  // first copy is the one carrying its flight's date and status. A leg counted
  // twice would appear as its own predecessor and settle its own offload.
  const seen = new Set();

  for (const leg of legs || []) {
    if (!leg || leg.id === null || leg.id === undefined) continue;
    if (seen.has(leg.id)) continue;
    if (isCancelled(leg) || isNotOperated(leg)) continue;
    const key = String(leg.awb || '').trim();
    if (!key) continue;
    seen.add(leg.id);
    if (!byAwb.has(key)) byAwb.set(key, []);
    byAwb.get(key).push(leg);
  }

  const prevOf = new Map();
  for (const group of byAwb.values()) {
    group.sort(byFlightOrder);
    let prev = null;
    for (const leg of group) {
      prevOf.set(leg.id, prev);
      prev = leg;
    }
  }
  return prevOf;
}

/**
 * Resolve every leg in one pass: `Map` of leg id -> what it was asked to carry.
 *
 * FEED IT EVERY LEG OF THE AWBS INVOLVED, not just the ones in the period
 * being reported. A leg whose predecessor flew the month before would
 * otherwise look like a first leg and report the whole air waybill.
 *
 * @param {Array} legs consignment rows carrying at least id, awb, grossWeight,
 *   offload, and enough of their flight to order and ground them: flightDate,
 *   status, canceled.
 */
function carryInByLeg(legs) {
  const prevOf = prevLegByLeg(legs);

  const byId = new Map();
  for (const leg of legs || []) {
    if (leg && leg.id !== null && leg.id !== undefined && !byId.has(leg.id)) {
      byId.set(leg.id, leg);
    }
  }

  const resolved = new Map();
  for (const [id, prev] of prevOf) resolved.set(id, resolveCarryIn(byId.get(id), prev));
  return resolved;
}

/**
 * A leg's resolved carry-in, falling back to its stored snapshot.
 *
 * The fallback is what makes this safe to call from anywhere: a leg with no
 * AWB number, one on a grounded flight, or one whose siblings were simply not
 * fetched is not in the map, and reading the row is a better answer than
 * reporting nought.
 */
const carryInOf = (resolved, leg) =>
  (resolved && leg && resolved.has(leg.id) ? resolved.get(leg.id) : carryIn(leg));

/** What actually left the ground, off a resolved carry-in. */
const flownWeightOf = (resolved, leg) =>
  Math.max(0, carryInOf(resolved, leg) - num(leg?.offload));

/* ------------------ a booking that flew none of its cargo -------------------
 * The load was accepted onto the flight and then every kilo of it was left
 * behind. What gets typed is the offload - that is the exception, and it is
 * what the operator is looking at - and the booked figures are left blank,
 * because "what it carried" feels like nothing.
 *
 * But blank is not nothing here: those two columns are what the AWB was ASKED
 * to carry, and the flight was asked to carry all of it. Left empty the leg
 * reads as an AWB that was never booked, and what reads it agrees:
 *
 *   the MANIFEST loses the weight. It sums carryIn, which falls back to gross,
 *   so the flight reports having been asked to carry less than it was - by
 *   exactly the amount that was left behind.
 *
 *   a CONTINUATION LEG prefills from nothing. /awb/available copies the last
 *   leg's pieces and gross onto the next one, so the flight that finally
 *   carries this cargo starts with both blank too.
 *
 *   the GRID and its flight totals show an AWB with an offload and no load.
 *
 * The outstanding-loads list is NOT among them: it reads the offload directly,
 * so the cargo is chased either way. This rule is about the booking being
 * right, not about the cargo being found.
 *
 * SO THE OFFLOAD IS THE BOOKING when nothing else was recorded. Returns the
 * fields to fill in, or null when the rule does not apply.
 *
 * ALL FOUR CONDITIONS, deliberately. Both booked figures empty AND both
 * offload figures present is the only combination that means "all of it was
 * offloaded" without having to guess:
 *
 *   gross 1000, offload 300     part of it flew. Not this rule.
 *   pieces 10, offload pcs 5    5 of 10 left behind. Not this rule - and
 *                               copying 5 into pieces would rewrite the
 *                               booking as a smaller one than it was.
 *   nothing at all              an empty row, not a fully offloaded one.
 *
 * Requiring all four also makes the rule FIRE ONCE. It fills the two booked
 * columns, which is exactly what stops it matching again - so a figure it
 * wrote is never rewritten by a later edit to the offload beside it, and
 * changing that offload afterwards means what it says: some of the load flew
 * after all.
 *
 * A CONTINUATION LEG IS SKIPPED. carriedForward already records what that leg
 * was asked to take, so the booking is not missing - and on such a leg gross
 * is the AWB's documented total, which is the whole shipment rather than this
 * flight's share of it. Copying an offload into it would state the wrong
 * number in the one column that is supposed to be the same on every leg.
 * ------------------------------------------------------------------------- */
const bookedFromOffload = (leg) => {
  if (!leg) return null;
  // A leg that already says what it was asked to carry - see above.
  if (leg.carriedForward !== null && leg.carriedForward !== undefined) return null;

  const pieces = num(leg.pieces);
  const gross = num(leg.grossWeight);
  if (pieces > 0 || gross > 0) return null;

  const offPieces = num(leg.offloadPieces);
  const offGross = num(leg.offload);
  if (offPieces <= 0 || offGross <= 0) return null;

  return { pieces: offPieces, grossWeight: offGross };
};

// A flight is cancelled if EITHER says so - the status dropdown and the Cancel
// Flight button's flag are not kept in step, so the union is the only reading
// that cannot undercount. Mirrors functions/aviationReport.
const isCancelled = (leg) => Boolean(leg.canceled) || leg.status === 'Canceled';

/**
 * A flight somebody has marked NOT-OPERATED.
 *
 * A fourth status beside Operated / Canceled / Nill, and the distinction it
 * draws is against Canceled: a cancelled flight was taken out of the schedule,
 * a not-operated one was in the schedule and did not go. Both flew nothing, so
 * both carry zero cargo - but an airline is asked how many of its scheduled
 * flights it cancelled, and rolling the two together answers that wrongly.
 *
 * Cancellation WINS, exactly as it does over every other status: the Cancel
 * Flight button sets a flag that the status dropdown knows nothing about, so a
 * flight holding both is cancelled. Without this guard a cancelled flight
 * whose status still said Not-Operated would be counted in both buckets and
 * the counts would not add up to the flights.
 */
const isNotOperated = (leg) =>
  !isCancelled(leg) && String(leg?.status || '').trim() === 'Not-Operated';

/**
 * An AWB somebody has CLOSED is not outstanding, whatever it was offloaded by.
 *
 * An offload does not always leave cargo waiting for an aircraft. Flowers,
 * fish and chilled pharmaceuticals go back to the master agent because the
 * cold chain is broken; a shipment can be withdrawn, re-booked on another
 * airline, or written off. In every one of those the offload really happened
 * and belongs on the manifest, but nothing is WAITING - and listing it here
 * has the office chasing cargo that left days ago.
 *
 * WHICH ONES THOSE ARE IS A JUDGEMENT, so it is ticked on the consignment
 * (Aviation_Consignment.awbClosed, the "Close AWB" box beside the offload)
 * rather than guessed from the commodity. This used to close every perishable
 * commodity automatically, which was wrong in both directions: a perishable
 * shipment offloaded an hour before the next flight is still going, and a
 * withdrawn crate of machine parts is not - and neither case could be said.
 *
 * The offload figure itself is untouched. What this decides is only whether
 * anything is still waiting to be carried.
 */
const isAwbClosed = (leg) => Boolean(leg?.awbClosed);

// Legs in the order they flew. flightDate is a 'YYYY-MM-DD' STRING, which
// sorts chronologically as text; id breaks ties so two legs on the same date
// still have a definite "latest", and a leg with no date sorts before dated
// ones rather than randomly.
const byFlightOrder = (a, b) => {
  const da = String(a.flightDate || '');
  const db = String(b.flightDate || '');
  if (da !== db) return da < db ? -1 : 1;
  return num(a.id) - num(b.id);
};

/**
 * @param {Array} legs consignment rows, each carrying at least:
 *   awb, offload, grossWeight, awbClosed, flightDate, status, canceled, and
 *   enough of the flight to name it (jobNo / flightNo / AviationJobId).
 * @returns {{rows: Array, totalPending: number, count: number}}
 *   rows are heaviest-outstanding first - the biggest problem is the one
 *   worth looking at, not the most recent.
 */
function pendingLoads(legs) {
  // Resolved from the AWB's own history rather than each row's snapshot, so
  // `carried` cannot disagree with the manifest the reports print.
  const resolved = carryInByLeg(legs);
  const byAwb = new Map();

  for (const leg of legs || []) {
    // A flight that did not go carried nothing, so it neither leaves cargo
    // behind nor settles an earlier offload. Not-Operated is skipped for the
    // same reason as Canceled - the difference between them is a fact about
    // the schedule, and makes no difference to what is still on the ground.
    if (!leg || isCancelled(leg) || isNotOperated(leg)) continue;
    // No AWB number, nothing to track it by. A consignment is identified to
    // the airline by its air waybill; without one there is no later flight to
    // match it against.
    const key = String(leg.awb || '').trim();
    if (!key) continue;
    if (!byAwb.has(key)) byAwb.set(key, []);
    byAwb.get(key).push(leg);
  }

  const rows = [];
  for (const [awb, group] of byAwb) {
    group.sort(byFlightOrder);
    const last = group[group.length - 1];
    const pending = num(last.offload);
    if (pending <= 0) continue;
    // Closed on the flight that left it behind: it is not coming back for a
    // later aircraft, so it is not outstanding.
    if (isAwbClosed(last)) continue;

    rows.push({
      awb,
      pending,
      // What HAS flown, across every leg. Shown beside the outstanding amount
      // so the row reads as "700 of 1,000 went" rather than a bare 300.
      //
      // What each leg was asked to carry, less what it left behind - NOT
      // gross, which is the AWB's documented total and is repeated on every
      // leg. See carryIn: summing gross would report this 1,000 kg AWB as
      // 1,700 kg carried across two flights.
      carried: group.reduce((t, l) => t + flownWeightOf(resolved, l), 0),
      legs: group.length,
      // The flight the cargo was last left behind by - where to start asking.
      lastFlight: {
        id: last.AviationJobId ?? null,
        jobNo: last.jobNo || '',
        flightNo: last.flightNo || '',
        flightDate: last.flightDate || '',
      },
      carrier: last.carrier || '',
      masterAgent: last.masterAgent || '',
      shipper: last.shipper || '',
      destination: last.destination || '',
    });
  }

  rows.sort((a, b) => b.pending - a.pending || String(a.awb).localeCompare(String(b.awb)));

  return {
    rows,
    totalPending: rows.reduce((t, r) => t + r.pending, 0),
    count: rows.length,
  };
}

module.exports = {
  pendingLoads, isCancelled, isNotOperated, isAwbClosed, byFlightOrder, num, carryIn, flownWeight,
  bookedFromOffload,
  // Cross-leg resolution - what every total should use. See the block above
  // resolveCarryIn for why the stored snapshot is not enough.
  resolveCarryIn, prevLegByLeg, carryInByLeg, carryInOf, flownWeightOf,
};

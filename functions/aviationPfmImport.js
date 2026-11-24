// Building a flight from a PFM.
//
// The one place that knows WHICH parts of a plan become a flight. Kept out of
// the flight screen so it can be tested without rendering a twenty-column
// grid, and so there is a single answer to the question the whole feature
// turns on: what is copied, and what deliberately is not.
//
// ------------------------------------------------------------------------
// WHAT CROSSES OVER
//
//   the header      flight number, airline, aircraft, origin, flight date.
//                   The five facts both documents state, stored in identically
//                   named columns on both tables precisely so this is a copy
//                   rather than a translation.
//
//   each line       carrier, AWB (and the register row it came out of),
//                   master agent, destination, commodity, and the Load Plan
//                   into the consignment's Remarks - the flight has nowhere
//                   else to put a loading instruction.
//
//   the total       the plan's total chargeable weight, into the flight's PFM
//                   field. Which is not a pun: that field has always held "the
//                   planned figure for this flight", and this is now where the
//                   plan comes from.
//
// WHAT DOES NOT, AND WHY
//
//   pieces, gross and chargeable weight, PER LINE. A plan's weights are what
//   an agent SAYS is coming; a flight's are what the warehouse WEIGHED. They
//   are different figures taken by different people on different days, and the
//   flight's are what gets invoiced. Copying the expectation into the
//   measurement would put a number nobody weighed onto a billable document,
//   and - worse - it would look filled in, so nobody would weigh it.
//
//   the second leg. slCarrier and slFlightNo have no column on a consignment
//   and are not given one: the onward booking is planning information, and the
//   flight's View PFM button is how it is read back. See the model.
//
//   shipper, consignee, rates. A plan does not name or price them.
//
//   the plan's own Remarks, EXCEPT onto a flight that has none. Overwriting
//   what somebody typed on the flight is the one thing an import must never
//   do; leaving a new flight's remarks blank when the plan had some is merely
//   unhelpful. So it fills a gap and never replaces.

/** Blank means "nothing was entered". 0 is a value, not a blank. */
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The plan's total chargeable weight - what lands in the flight's PFM field.
 *
 * Rounded to two places, once, at the end. These are sums of typed figures and
 * carry float noise that the flight header would otherwise print.
 *
 * A plan with no weights typed totals 0 rather than null. That is honest: the
 * plan says nothing is expected, and null would read as "not planned" on a
 * field somebody did plan.
 */
export const plannedChargeable = (pfm) => {
  const total = (pfm?.Aviation_Pfm_Lines || []).reduce((t, l) => t + num(l.chargeableWeight), 0);
  return Math.round(total * 100) / 100;
};

/**
 * The header fields a flight takes from its plan.
 *
 * `current` is the flight as it stands, and is read for one thing only: its
 * Remarks, which are filled from the plan's only when the flight has none.
 * Everything else is the plan's outright - picking a PFM IS the statement that
 * this flight is that plan.
 */
export const pfmHeaderPatch = (pfm, current = {}) => {
  if (!pfm) return {};
  return {
    // The link itself. A real foreign key, so anything later asking what a
    // flight was planned to carry has a join to make instead of a flight
    // number to match on - numbers repeat every week.
    AviationPfmId: pfm.id,
    flightNo: pfm.flightNo || '',
    operatingCarrierId: pfm.operatingCarrierId ?? null,
    AviationAircraftId: pfm.AviationAircraftId ?? null,
    origin: pfm.origin || '',
    flightDate: pfm.flightDate || '',
    // The planned figure for this flight - see the note at the top.
    pfm: plannedChargeable(pfm),
    // Fills a gap, never replaces. See the note at the top.
    ...(isBlank(current.remarks) && !isBlank(pfm.remarks) ? { remarks: pfm.remarks } : {}),
  };
};

/**
 * One planned line as a flight consignment.
 *
 * `blank` is the flight grid's own blank row, passed in rather than imported:
 * it lives in the Consignments component, and a pure module reaching into a
 * component for a constant is how a test ends up needing React. Spreading it
 * first means a field the grid adds later arrives here already correct,
 * instead of silently missing from every imported row.
 */
export const pfmLineToConsignment = (line, blank = {}) => ({
  ...blank,
  AviationCarrierId: line.AviationCarrierId ?? null,
  // Both halves of the AWB: the digits the flight shows, and the register row
  // they came out of. Carrying the id is what keeps Setup > AWB Stock honest -
  // without it every imported consignment would look like a number somebody
  // typed, and the register would never be claimed for a real flight.
  AviationAwbId: line.AviationAwbId ?? null,
  awb: line.awb || '',
  masterAgentId: line.masterAgentId ?? null,
  destination: line.destination || '',
  CommodityId: line.CommodityId ?? null,
  // The loading instruction, into the only field on a consignment that can
  // hold one.
  remarks: line.loadPlan || '',
  // Said out loud rather than left to the spread of `blank`. These three are
  // the point of the whole rule at the top of this file, and a reader looking
  // for them should find them here being explicitly not copied.
  pieces: null,
  grossWeight: null,
  chargeableWeight: null,
});

/**
 * Every line of the plan, as consignments.
 *
 * In the plan's own order - Aviation_Pfm_Lines comes back sorted by sortOrder
 * - so the flight reads the way the plan was built. A plan with no lines gives
 * back a single blank row rather than an empty grid: the flight screen must
 * never be a table with nothing to type into.
 */
export const pfmLinesToConsignments = (pfm, blank = {}) => {
  const lines = pfm?.Aviation_Pfm_Lines || [];
  if (!lines.length) return [{ ...blank }];
  return lines.map((l) => pfmLineToConsignment(l, blank));
};

/**
 * Is there anything on this flight that replacing would destroy?
 *
 * Asked before a re-import, so the operator is warned with a number rather
 * than a vague question. Uses the SAME rule the grid and the server drop blank
 * rows by - an untouched "Add Consignment +" is not work anyone did.
 *
 * `isReal` is passed in (functions/aviationValidation.isRealLine) so this
 * module keeps exactly one definition of a real row in play rather than
 * growing a second one.
 */
export const realLineCount = (lines, isReal) =>
  (Array.isArray(lines) ? lines : []).filter((l) => isReal(l)).length;

// A CHARTER flight: the whole aircraft sold as one deal.
//
// On an ordinary flight every AWB is priced on its own - a different rate per
// consignment, negotiated per shipment. A charter is the opposite: somebody has
// taken the aircraft, so one buying rate, one selling rate and one conversion
// per side govern the load rather than twenty separately typed sets.
//
// WHICH AWBs THE COMMON RATES REACH. Only those whose CARRIER is the airline
// operating the flight. A charter aircraft still carries other carriers' AWBs
// alongside the chartered load - interline, someone else's uplift bought on the
// same aircraft - and those are their own deals at their own rates. Matching on
// the carrier is what separates "part of this charter" from "also on board".
//
// The rates are PRE-FILLED, not imposed. Ticking Charter, changing a common
// rate, or picking the operating carrier on a row copies the common figures
// down onto the AWBs they reach; each row can then be adjusted. That keeps the
// exceptional AWB - a rebate, a short-shipped leg - possible without having to
// turn the charter off to express it.

/**
 * Does this consignment fall under the flight's charter?
 *
 * Three things must hold: the flight is a charter, it names an operating
 * airline, and the AWB names the same one. A flight with no airline chartered
 * to nobody in particular reaches no AWB - which is the honest answer, not an
 * excuse to price everything at the common rate.
 */
// The AWB rates reach the charges they price through one shared rule -
// the same one the Consignments grid and the Charges tab use.
import { repriceForAwb } from './aviationChargeRow';

export const charterAppliesTo = (line, job) => {
  if (!job?.charter) return false;
  const airline = job?.operatingCarrierId;
  if (airline === null || airline === undefined) return false;
  return line?.AviationCarrierId === airline;
};

/**
 * The four per-AWB rate fields a charter fills in.
 *
 * ONE EX-RATE PER SIDE, the same shape an ordinary AWB carries. Chartering the
 * aircraft and selling the space on it are two transactions: the aircraft is
 * very often bought in one currency and the space sold in another, and even
 * within one currency the two are struck on different days. Converting both at
 * a single rate would put the difference straight into the reported margin -
 * and on a charter that error reaches every AWB on the load at once.
 */
export const charterRates = (job) => ({
  buyingRate:    job?.charterBuyingRate ?? null,
  sellingRate:   job?.charterSellingRate ?? null,
  buyingExRate:  job?.charterBuyingExRate ?? 1,
  sellingExRate: job?.charterSellingExRate ?? 1,
});

/**
 * `line` with the charter's rates copied in, if the charter reaches it.
 *
 * `skip` is the rows the charter must not touch - the ones an approved invoice
 * or a closed fortnight has already frozen. Pre-filling those would put a
 * figure on screen that the save is going to drop.
 */
export const applyCharter = (line, job, skip = () => false) => {
  if (!charterAppliesTo(line, job) || skip(line)) return line;
  const next = { ...line, ...charterRates(job) };
  /* AND THE CHARGES FOLLOW. The charter writes the same four fields the grid
   * writes, so it has to do the same thing to the charges those fields price -
   * otherwise ticking Charter moved four numbers on screen and left every
   * charge on the AWB at whatever it was, which is not a display problem: the
   * AWB and its charges disagree, and the invoice carries the stale figure.
   *
   * All four in one pass, through the rule both tabs share. Rows frozen by an
   * approved invoice are skipped inside it, and a Per Shipment fee keeps its
   * fee - see repriceForAwb. */
  const priced = Object.keys(charterRates(job)).reduce(
    (charges, field) => repriceForAwb(charges, next, field),
    next.Charge_Heads || next.charges || []
  );
  next.charges = priced;
  next.Charge_Heads = priced;
  return next;
};

/** Every line the charter reaches, re-priced in one pass. */
export const applyCharterToAll = (lines, job, skip) =>
  (lines || []).map((l) => applyCharter(l, job, skip));

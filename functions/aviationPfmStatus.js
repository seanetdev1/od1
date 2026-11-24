/**
 * The life of a PFM.
 *
 * A PLAN'S lifecycle, not a flight's. Aviation_Job has Operated / Canceled /
 * Not-Operated / Nill, which are all statements about an aircraft that has
 * already been somewhere; a pre-flight manifest is only ever being written,
 * agreed, or abandoned.
 *
 *   Draft      being built. Agents are still adding to it.
 *   Confirmed  agreed and ready to fly. THE ONLY STATE A FLIGHT MAY BE
 *              BUILT FROM - see selectableReason.
 *   Cancelled  abandoned. Never offered, never deleted: the number was
 *              quoted to the agents on it.
 *
 * Kept in one module, mirrored by the frontend's functions/aviationPfmStatus,
 * because the list screen, the PFM form, the flight's selector and the server
 * all have to agree about which plans may be flown. Two copies of that rule
 * would show a PFM in the dropdown that the save then refuses.
 */

const DRAFT = 'Draft';
const CONFIRMED = 'Confirmed';
const CANCELLED = 'Cancelled';

// Order is the order of the dropdown: a PFM is born a draft, is confirmed, and
// is only cancelled when something has gone wrong.
const PFM_STATUSES = [DRAFT, CONFIRMED, CANCELLED];

/**
 * A stored status as it should be read.
 *
 * A blank reads as Draft, which is what the model's default means - a plan
 * with nothing said about it is one still being written. An unrecognised value
 * is returned as itself rather than forced into the list: it came from the
 * database, and quietly relabelling it would hide whatever put it there.
 */
const statusOf = (pfm) => {
  const s = String(pfm?.status ?? '').trim();
  return s || DRAFT;
};

const isCancelled = (pfm) => statusOf(pfm) === CANCELLED;
const isConfirmed = (pfm) => statusOf(pfm) === CONFIRMED;

/**
 * Why this PFM may NOT be built into a flight - or null if it may.
 *
 * THREE RULES, and the message says which one bit. A dropdown that simply does
 * not contain the plan somebody raised this morning is the support call this
 * function exists to prevent, so every caller that hides a PFM can also say
 * why.
 *
 *   confirmed   a draft is still being edited; flying it would freeze a
 *               half-agreed load onto a flight.
 *   unused      a plan is flown once. `flightNo` here is the job already
 *               built from it - see the hasOne in the association file.
 *   not past    a flight date that has gone by belongs to a plan that was
 *               never used and never will be.
 *
 * `today` is passed in rather than read from the clock, so this is testable
 * and so one request cannot straddle midnight and disagree with itself.
 * Dates are 'YYYY-MM-DD' strings and compare correctly as text - the same
 * property every date rule in this module relies on.
 */
const selectableReason = (pfm, today, usedByJobNo = null) => {
  if (!pfm) return 'That PFM no longer exists.';
  if (isCancelled(pfm)) return `PFM ${pfm.pfmNo || ''} has been cancelled.`.replace('  ', ' ');
  if (!isConfirmed(pfm)) {
    return `PFM ${pfm.pfmNo || ''} is still a draft — confirm it before building a flight from it.`;
  }
  if (usedByJobNo) {
    return `PFM ${pfm.pfmNo || ''} has already been flown as ${usedByJobNo}.`;
  }
  const date = String(pfm.flightDate || '').trim();
  if (!date) return `PFM ${pfm.pfmNo || ''} has no flight date.`;
  if (date < today) {
    return `PFM ${pfm.pfmNo || ''} was for ${date}, which has passed.`;
  }
  return null;
};

module.exports = {
  DRAFT, CONFIRMED, CANCELLED, PFM_STATUSES,
  statusOf, isCancelled, isConfirmed, selectableReason,
};

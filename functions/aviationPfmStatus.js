// The life of a PFM.
//
// A PLAN'S lifecycle, not a flight's. functions/aviationStatus holds the
// flight's four - Operated / Canceled / Not-Operated / Nill - and every one of
// them is a statement about an aircraft that has already been somewhere. A
// pre-flight manifest is only ever being written, agreed, or abandoned.
//
//   Draft      being built. Agents are still adding to it.
//   Confirmed  agreed and ready to fly. THE ONLY STATE A FLIGHT MAY BE BUILT
//              FROM - see selectableReason.
//   Cancelled  abandoned. Never offered to a flight, and never deleted: the
//              number was quoted to every agent with cargo on it.
//
// MIRRORS the backend's functions/aviationPfmStatus, deliberately and
// exactly. The two cannot import from each other - they are separate packages
// - so the rules are written twice and tested on both sides. A drift between
// them shows a plan in the flight's dropdown that the save then refuses,
// which is the single worst way to learn a rule exists.

export const DRAFT = 'Draft';
export const CONFIRMED = 'Confirmed';
export const CANCELLED = 'Cancelled';

// Order is the order of the dropdown: a PFM is born a draft, is confirmed, and
// is only cancelled when something has gone wrong.
export const PFM_STATUSES = [DRAFT, CONFIRMED, CANCELLED];

/**
 * A stored status as it should be read.
 *
 * A blank reads as Draft, which is what the model's default means - a plan
 * with nothing said about it is one still being written. An unrecognised value
 * is returned as itself rather than forced into the list: it came from the
 * database, and quietly relabelling it would hide whatever put it there.
 */
export const statusOf = (pfm) => {
  const s = String(pfm?.status ?? '').trim();
  return s || DRAFT;
};

export const isCancelled = (pfm) => statusOf(pfm) === CANCELLED;
export const isConfirmed = (pfm) => statusOf(pfm) === CONFIRMED;

// Blue for the working state, green for agreed, red for abandoned. Matches how
// functions/aviationStatus colours a flight, so the two lists read alike.
export const statusColor = (status) =>
  (status === CONFIRMED ? 'green' : status === CANCELLED ? 'red' : 'blue');

/**
 * Why this PFM may NOT be built into a flight - or null if it may.
 *
 * THREE RULES, and the message says which one bit. A dropdown that simply does
 * not contain the plan somebody raised this morning is the support call this
 * function exists to prevent, so every caller that hides a PFM can also say
 * why.
 *
 * `today` is passed in rather than read from the clock, so this is testable
 * and so one screen cannot straddle midnight and disagree with itself. Dates
 * are 'YYYY-MM-DD' strings and compare correctly as text - fixed width and
 * zero-padded - which is the same property every date rule in this module
 * relies on.
 */
export const selectableReason = (pfm, today, usedByJobNo = null) => {
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
  if (date < today) return `PFM ${pfm.pfmNo || ''} was for ${date}, which has passed.`;
  return null;
};

/**
 * The flight built from this plan, if there is one.
 *
 * A PFM read back from the server carries its job through the hasOne - see the
 * association file - and its PRESENCE is the whole of the "unused" rule. Every
 * screen that has to know whether a plan is spent asks here rather than
 * reaching into the include itself, so the shape of that include is known in
 * one place.
 */
export const flownAs = (pfm) => {
  const job = pfm?.Aviation_Job;
  if (!job) return null;
  return job.jobNo || `flight #${job.id}`;
};

/** A plan that has been flown is frozen - see the PFM router. */
export const isFrozen = (pfm) => Boolean(flownAs(pfm));

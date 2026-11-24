/**
 * The carrier reporting tag - GAM, IFA or Other.
 *
 * WHAT IT DECIDES. Every consignment's weight lands in one of three columns of
 * the monthly sector report, and this tag on the CARRIER is what chooses which.
 * Tagging the carrier is why those figures are counted rather than typed on
 * each flight.
 *
 * 'ER' IS THE OLD SPELLING OF 'GAM', and it is read, never written.
 *
 * The tag was renamed in 1.2.3. Renaming a stored value is not the same as
 * renaming a column: every carrier registered before the change still holds
 * 'ER' in the database, and until those rows are updated
 * (ifa-deploy/1.2.3-gam-reporting-tag.sql) they have to keep working. If they
 * did not, the failure would be silent and expensive - an untranslated 'ER'
 * matches none of the three buckets, so a month's GAM cargo would quietly
 * report as untagged, and nothing on the screen would say why.
 *
 * So reading normalises and writing does not: `read` turns a stored 'ER' into
 * 'GAM' at the boundary, and everything above it only ever sees the three
 * current tags. New writes are validated against those three, with 'ER'
 * accepted as an alias so a browser tab left open across the upgrade saves
 * correctly rather than failing on a value it was itself given.
 *
 * Kept free of model imports so it can be tested without a database.
 */

// The tags as they are offered, stored and reported today. Order is the order
// they appear in the report and in the Setup dropdown.
const CARRIER_CATEGORIES = ['GAM', 'IFA', 'Other'];

// Old spelling -> current one. Matched case-insensitively, because the value
// is free text in the column and 'er' has been seen in imported data.
const LEGACY = { ER: 'GAM' };

const DEFAULT_CATEGORY = 'Other';

/**
 * A stored category as the application should see it.
 *
 * Anything unrecognised falls back to 'Other' rather than being passed
 * through: an unknown tag reaching the report would count toward no column at
 * all, which reads on the sheet as cargo that was never carried.
 */
const read = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_CATEGORY;

  const upper = raw.toUpperCase();
  if (LEGACY[upper]) return LEGACY[upper];

  const match = CARRIER_CATEGORIES.find((c) => c.toUpperCase() === upper);
  return match || DEFAULT_CATEGORY;
};

/**
 * A category being SAVED, or null if it is not one.
 *
 * Returns the tag to store - which for 'ER' is 'GAM', so a stale tab that
 * still offers the old spelling quietly writes the new one instead of being
 * refused over a value the application handed it in the first place.
 */
const forWrite = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_CATEGORY;

  const upper = raw.toUpperCase();
  if (LEGACY[upper]) return LEGACY[upper];

  // Exact match only, unlike `read`. This is the validation boundary: 'other'
  // typed by hand at the endpoint should be told it is wrong, not silently
  // accepted, or the column fills with spellings the report has to guess at.
  return CARRIER_CATEGORIES.includes(raw) ? raw : null;
};

/**
 * A PER-AWB OVERRIDE being saved, or null for "no override".
 *
 * Distinct from `forWrite`, and the difference is the whole point: on a
 * carrier, a blank category means 'Other' - every carrier has a tag, and the
 * dropdown is never empty. On a consignment, blank means INHERIT THE CARRIER'S,
 * which is what every AWB does unless somebody deliberately says otherwise.
 * Storing 'Other' for a blank override would silently retag every consignment
 * on the flight to Other and move a month's cargo out of its column.
 *
 * An unrecognised value is also null rather than a refusal. This is one cell in
 * a twenty-column grid that only ever offers the three tags, so a value that is
 * not one of them came from a stale tab or straight from the endpoint - and the
 * safe reading of "I do not understand this override" is to not override, which
 * is exactly the behaviour the field did not exist for.
 */
const forOverride = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (LEGACY[upper]) return LEGACY[upper];

  return CARRIER_CATEGORIES.includes(raw) ? raw : null;
};

/**
 * The tag a consignment actually counts under: its own override if it has
 * one, otherwise its carrier's.
 *
 * NULL means untagged - no override AND no carrier - which is a real gap
 * somebody has to fill in, not a third state to report. It is deliberately not
 * 'Other': an AWB nobody has said anything about is a missing answer, and
 * counting it as Other Carrier would bury that in a column that looks correct.
 *
 * @param {string|null} override      the consignment's own reportingTag
 * @param {string|null} carrierTag    the carrier's stored category
 */
const tagFor = (override, carrierTag) => {
  const own = forOverride(override);
  if (own) return own;

  const inherited = String(carrierTag ?? '').trim();
  return inherited ? read(inherited) : null;
};

module.exports = {
  CARRIER_CATEGORIES, DEFAULT_CATEGORY, LEGACY, read, forWrite, forOverride, tagFor,
};

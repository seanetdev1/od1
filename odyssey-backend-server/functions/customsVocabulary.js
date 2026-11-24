/**
 * The customs module's closed vocabularies, in ONE place.
 *
 * WHY THIS FILE EXISTS
 *
 * These lists were declared in routes/customsJobs, which is where they are
 * served from - and the migration, which has to produce values that fit them,
 * could not see them. The two drifted immediately: the legacy terminal names
 * are spelled FAST TRACK, BAYWEST, BADARUDDIN and SUPREME OFF DOCK, the served
 * list spells them Fast Track, Bay West, Badaruddin and Supreme Off Dock, and
 * 2,158 migrated jobs would have carried a terminal the picker does not offer.
 *
 * A pure module with no database and no express in it, so both the route and
 * functions/lgJobMigrationPlan.js can require it.
 */

// The terminals a sea clearance goes through.
//
// Includes the ones the legacy book actually uses that the original list did
// not name: KEPZ (42 jobs), NLC (19) and BY ROAD (242). BY ROAD is not really
// a terminal - it is what somebody typed when the goods never went through one
// - but 242 files say it, and a list that cannot represent what the data says
// pushes those rows off the form.
const TERMINAL_SEA = [
  'QICT', 'KICT', 'KGTL', 'SAPT', 'QFS', 'ICT', 'DP World', 'Fast Track',
  'Shaheen (PQ)', 'Pak Shaheen (KPT)', 'Badaruddin', 'Bay West',
  'Supreme Off Dock', 'KEPZ', 'NLC', 'By Road',
].map((x) => ({ id: x, name: x }));

// The four air sheds, under the names the people filing there use.
//
// RENAMED, not added to: these are the same four as before under their working
// names - Menzies took over Royal Airport Services, and SAPS is Shaheen
// Airport Services. `id` is kept at the old spelling so a job already filed
// against one still resolves; only the label changed.
//
// AFU is the air freight unit at the airport, and 661 legacy jobs clear
// through it.
const TERMINAL_AIR = [
  { id: "Gerry's Dnata", name: "Gerry's" },
  { id: 'Royal Airport Service', name: 'Menzies (Royal)' },
  { id: 'Pakistan International Air', name: 'PIA' },
  { id: 'Shaheen Air', name: 'SAPS' },
  { id: 'AFU', name: 'AFU' },
];

// Shipment type, which is not the same question by sea and by air.
//
// A sea consignment is full-container, part-container or loose; an air one is
// consolidated or on a chartered aircraft. One combined list offered FCL to
// somebody booking a flight.
// 'General Cargo' is kept for HISTORY. It is what the legacy system called a
// non-containerised shipment, 7,624 files say it, and those files should go on
// saying what they said. 'Part' is the word for new jobs.
//
// 'Empty' is here for the same reason - 5 legacy jobs carry it.
const CARGO_TYPES_SEA = ['FCL', 'LCL', 'Part', 'General Cargo', 'Empty'];
// FCL and Empty are here for HISTORY, on the same principle as the sea list
// above: 523 legacy air jobs are recorded as FCL and 3 as Empty. A full
// container load by air is almost certainly mis-keyed, but those files say it,
// and a value the list cannot offer is one nobody can re-select after clearing
// it. LCL and Chartered are what a new air job should be.
const CARGO_TYPES_AIR = ['LCL', 'Chartered', 'FCL', 'Empty'];

/**
 * Spellings the legacy database uses that this vocabulary does not.
 *
 * Only for names that differ by more than case and spacing - everything else
 * is handled by the squash below, which is why this map is three entries and
 * not fifteen. Keyed on the squashed legacy form.
 */
const TERMINAL_ALIASES = {
  pakshaheenpq: 'Shaheen (PQ)',
};

/** Case, spaces and punctuation removed, so FAST TRACK and Fast Track match. */
const squash = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A legacy terminal name -> the spelling the picker offers.
 *
 * Returns the canonical entry when one matches, and the ORIGINAL value
 * otherwise. Never null and never a guess: a terminal this vocabulary has
 * never heard of is carried across as it was recorded, so the data is
 * preserved and the mismatch is visible rather than silently blanked.
 */
function canonicalTerminal(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const key = squash(raw);
  for (const { id } of [...TERMINAL_SEA, ...TERMINAL_AIR]) {
    if (squash(id) === key) return id;
  }
  return TERMINAL_ALIASES[key] || raw;
}

module.exports = {
  TERMINAL_SEA, TERMINAL_AIR,
  CARGO_TYPES_SEA, CARGO_TYPES_AIR,
  TERMINAL_ALIASES, canonicalTerminal,
};

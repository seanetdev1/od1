/**
 * Finding a charge in the master, by any of the three things it is known by.
 *
 * A charge has a code (THC), a short name (Terminal) and a full name
 * (Terminal Handling Charge - Import). Which one somebody has in their head
 * depends on who they are: the accounts clerk quotes the code, the person
 * reading a vendor's bill has the full description in front of them, and the
 * operations staff say the short name. A picker that matched only the label it
 * happened to display sent two of those three people scrolling.
 *
 * So the search reads all three, and the picker SHOWS all three.
 *
 * EVERY TERM MUST MATCH, and each may match a different field. "thc import"
 * finds "(THC) Terminal / Terminal Handling Charge - Import" because THC hits
 * the code and `import` hits the full name. A single substring test over a
 * joined string would do the same, but only while the words are typed in the
 * order the fields happen to be concatenated in; this does not care.
 */

const norm = (v) => String(v ?? '').toLowerCase();

/** The three fields a charge can be found by, as one haystack per charge. */
const haystack = (charge) => [
  norm(charge?.code),
  norm(charge?.short),
  norm(charge?.fullName),
  // The joined label too, so a query typed the way the old dropdown showed it
  // - "(thc) terminal" - still finds its charge.
  norm(charge?.name),
];

/** Does this charge match every word of the query? */
export const chargeMatches = (charge, query) => {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const fields = haystack(charge);
  return terms.every((term) => fields.some((f) => f.includes(term)));
};

/**
 * The charges to show for a query, best first.
 *
 * Ranked, because on a master of a few hundred an unranked substring match
 * buries the obvious answer. A charge whose CODE is exactly what was typed is
 * what the person meant - "THC" should not sit below four charges that merely
 * mention it in their description.
 *
 *   0  the code is exactly the query          THC -> (THC)
 *   1  a field STARTS with the query          THC -> (THCX), "Terminal..."
 *   2  it matches somewhere                   THC -> "... incl THC"
 *
 * Ties keep the master's own order, which is by code - so the list is stable
 * and a second identical search never reshuffles it.
 */
export const rankedCharges = (charges, query) => {
  const q = norm(query);
  const matched = (charges || []).filter((c) => chargeMatches(c, q));
  if (!q) return matched;

  const rank = (c) => {
    if (norm(c?.code) === q) return 0;
    if (haystack(c).some((f) => f.startsWith(q))) return 1;
    return 2;
  };
  // A stable sort by rank alone - Array.prototype.sort is stable in every
  // engine this runs on, so equal ranks keep the order they came in.
  return matched
    .map((c, i) => ({ c, i, r: rank(c) }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map(({ c }) => c);
};

/**
 * The charges whose CODE is exactly what was typed - for typing a code
 * straight into a charge line rather than opening the picker. Case and the
 * spaces around it do not matter; nothing else is matched, because a code
 * typed blind should land on that code or on nothing. More than one means the
 * master repeats a code, and the picker is the place to choose between them.
 */
export const chargesWithCode = (charges, text) => {
  const wanted = norm(text).trim();
  if (!wanted) return [];
  return (charges || []).filter((c) => norm(c?.code).trim() === wanted);
};

/**
 * The charges whose SHORT NAME is exactly what was typed. The charge box on a
 * customs line shows the short name, so it is what people type back into it.
 * Same rules as chargesWithCode - whole name, case and spaces aside.
 */
export const chargesWithShortName = (charges, text) => {
  const wanted = norm(text).trim();
  if (!wanted) return [];
  return (charges || []).filter((c) => norm(c?.short).trim() === wanted);
};

/**
 * What a charge box takes for what was typed: the charge with that short
 * name, or - when no short name matches - with that code. The SHORT NAME
 * first (the user's call): it is what the box shows, so text that is one
 * charge's short name and another's code means the short name's charge.
 */
export const chargesTyped = (charges, text) => {
  const byShort = chargesWithShortName(charges, text);
  return byShort.length ? byShort : chargesWithCode(charges, text);
};

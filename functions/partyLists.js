/**
 * The two list columns on a party, as the form needs them.
 *
 * Clients.operations and Clients.types are STRING columns holding a joined
 * list - "Sea Import, Sea Export" - while the checkbox groups that edit them
 * work in arrays. Every party form therefore splits them on the way in, and
 * all three did it like this:
 *
 *     tempState.operations = tempState.operations?.split(', ');
 *
 * WHICH YIELDS `undefined`, NOT `[]`, when the column is null - and on the
 * CargoLinkers book it is null on 12,716 of 12,918 parties. Optional chaining
 * stops the crash at the split and moves it downstream: the edit history then
 * calls .forEach on it and throws, which happens BEFORE the save request, so
 * the party is silently never saved. The Non-GL form had no `?.` at all, so
 * its edit page could not even open on those parties.
 *
 * A party with no operations recorded has an EMPTY list of them, not an absent
 * one. That is the whole fix, and it belongs in one place because the same
 * line is written in three files.
 *
 * Splits on any comma with optional spaces rather than on the literal ", ",
 * which is what the backend already does when it reads the same column (see
 * routes/customsJobs getValues). A value stored without the space used to come
 * back as one long entry matching no checkbox, so the tick silently vanished.
 */

/** A joined list column as an array. Never undefined, never null. */
export const toList = (value) => {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/\s*,\s*/)
    .map((v) => v.trim())
    .filter(Boolean);
};

/**
 * Reading the id fields on a Charge_Head.
 *
 * THE PROBLEM
 *
 * Charge_Head.charge and Charge_Head.partyId are STRING columns - see
 * models/Charge_Head.js - but the things they point at are not. Charges.id and
 * Clients.id are integers, so every dropdown built from those masters is keyed
 * by a number.
 *
 * That mismatch is invisible until a charge makes a round trip. Pick a charge
 * and the Select is handed the number 12, matches the option, and shows its
 * name. Save it, and the server stores "12"; read it back and the Select is
 * handed the STRING "12", which matches no option - antd compares its value to
 * option values strictly. With nothing to match, it falls back to rendering the
 * value itself, so the box shows a bare id where the charge name used to be.
 *
 * Same for the party. Same on the aviation sheet and the customs one, because
 * both are editing the same shared table.
 *
 * WHY IT IS FIXED HERE AND NOT IN THE COLUMN
 *
 * Changing Charge_Head.charge to an integer would be correct and is not worth
 * it: the column is shared with the freight job screens, holds years of rows,
 * and every one of them would have to be cast in a migration that has no way
 * to fail safely. The display layer knowing "these arrive as strings" costs one
 * function.
 *
 * WHY NOT JUST STRING EVERYTHING INSTEAD
 *
 * Because the option lists come from the masters, where the ids really are
 * numbers, and the lookups on the other side of a pick (`find(x => x.id === e)`)
 * are number comparisons. Coercing the stored value up to match the master is
 * one change; coercing every master down is many.
 */

/**
 * A Charge_Head id field, as the option lists key it.
 *
 * Returns undefined for anything empty so a Select shows its placeholder
 * rather than the string "null", and leaves a genuinely non-numeric value
 * alone rather than turning it into NaN.
 */
export const asId = (v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
};

/** True when a stored id and an option id are the same id, whatever their types. */
export const sameId = (a, b) => {
  const x = asId(a);
  const y = asId(b);
  return x !== undefined && y !== undefined && x === y;
};

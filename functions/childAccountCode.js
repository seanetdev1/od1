/**
 * The next code for a child account under a given parent.
 *
 * Chart-of-accounts codes are HIERARCHICAL BY MULTIPLICATION: a child's block
 * starts at parentCode * 10000 and its siblings count up from there, so a code
 * gains four digits per level of depth.
 *
 *   level 1                        1
 *   level 2   1 x 10000 + 1        10001
 *   level 3   10001 x 10000 + 1    100010001
 *   level 4   100010001 x 10000 + 1  1000100010001     <- THIRTEEN digits
 *
 * WHICH IS WHY THIS IS COMPUTED IN JS AND NEVER IN SQL.
 *
 * `code` is a STRING column, so the obvious way to find the highest sibling is
 * MAX(CAST(code AS INTEGER)). That works until the chart is four levels deep
 * and then fails outright: int4 tops out at 2,147,483,647 - ten digits - so
 * Postgres raises 22003 "value 1000100010001 is out of range for type integer"
 * and creating a party dies with a 500. It is not an edge case; every
 * fourth-level parent hits it, every time.
 *
 * Casting to BIGINT instead would only trade a loud failure for a silent one:
 * node-postgres returns int8 as a STRING to avoid losing precision, so
 * `max + 1` becomes "1000100010001" + 1 = "10001000100011" - a fourteen-digit
 * code, quietly wrong, sitting in the ledger.
 *
 * AND WHY IT IS BigInt, NOT parseInt. Ordinary JS numbers hold integers
 * exactly only up to 2^53, about 9.0e15 - sixteen digits. A level-4 code is
 * ~1e12 and safe, but multiplying it by the block to number a level-5 child
 * gives ~1e16, past that limit, and the result comes out quietly wrong rather
 * than failing. Depth is the thing that keeps breaking this numbering, so it
 * is worth removing the ceiling altogether instead of moving it one level up.
 *
 * Kept free of model imports so the arithmetic can be tested without a
 * database, the way functions/aviationReport.js is.
 */

// How many numbers each level reserves for its children.
const BLOCK = 10000;
const BLOCK_N = BigInt(BLOCK);

/**
 * A code as an exact integer, or null if it is not one.
 *
 * Reads the LEADING run of digits, which is what parseInt did before this and
 * so keeps every code the old numbering accepted - while a code that is not a
 * number at all is skipped rather than becoming NaN and poisoning the maximum.
 */
const asExactInt = (value) => {
  const m = /^\s*([0-9]+)/.exec(String(value ?? ''));
  return m ? BigInt(m[1]) : null;
};

/**
 * @param {string|number|null} parentCode  the parent's code; null/absent for a
 *   top-level account, which counts from 1 rather than continuing a block.
 * @param {Array<string|number>} siblingCodes  every existing code under that
 *   same parent. Found by the PARENT LINK, never by a range over `code` - see
 *   the note in routes/accounts createChildAccount for why a string range
 *   silently returns the wrong siblings.
 * @returns {string} the next code, as the string the column stores.
 */
const nextChildAccountCode = (parentCode, siblingCodes = []) => {
  const parent = asExactInt(parentCode);

  // Starting from the parent's block means a sibling left with a bad code by
  // the old numbering can never drag the next one below the block it belongs
  // in - it is a floor, not just a starting guess.
  let highest = parent === null ? 0n : parent * BLOCK_N;

  for (const code of siblingCodes || []) {
    const n = asExactInt(code);
    if (n !== null && n > highest) highest = n;
  }

  return String(highest + 1n);
};

module.exports = { BLOCK, nextChildAccountCode };

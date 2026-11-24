/**
 * Chart-of-accounts child numbering.
 *
 * The rule is hierarchical by multiplication - a child's block starts at
 * parentCode * 10000 - which means a code grows four digits per level. That is
 * the whole reason this arithmetic is not allowed back into SQL, and the
 * fourth-level case below is the one that took party creation down with a
 * Postgres 22003.
 */
const { nextChildAccountCode, BLOCK } = require('../../functions/childAccountCode');

describe('top-level accounts', () => {
  test('count from 1 when there is no parent', () => {
    expect(nextChildAccountCode(null, [])).toBe('1');
    expect(nextChildAccountCode(undefined, [])).toBe('1');
    // routes/accounts passes the string '0' for "no parent".
    expect(nextChildAccountCode('0', [])).toBe('1');
  });

  test('continue from the highest existing one', () => {
    expect(nextChildAccountCode('0', ['1', '2', '3'])).toBe('4');
  });

  test('take the highest NUMERICALLY, not lexicographically', () => {
    // '9' > '10' as strings, which is how five top-level accounts once came
    // out numbered 1, 2, 2, 2, 2.
    expect(nextChildAccountCode('0', ['9', '10', '11'])).toBe('12');
  });
});

describe('children of a parent', () => {
  test('the first one starts its parent block, not at 1', () => {
    // The old clients-route allocator produced the literal 1 here, which sat
    // outside the parent's block entirely and collided with the top-level
    // accounts.
    expect(nextChildAccountCode('1', [])).toBe('10001');
    expect(nextChildAccountCode('10001', [])).toBe('100010001');
  });

  test('later ones count up inside the block', () => {
    expect(nextChildAccountCode('1', ['10001', '10002'])).toBe('10003');
  });

  test('a sibling with a code below the block cannot drag the next one down', () => {
    // A party created by the old allocator is sitting there with code '1'.
    // Seeding the reduce at the block base is what stops it being read as the
    // highest sibling and handing out '2'.
    expect(nextChildAccountCode('10001', ['1'])).toBe('100010001');
  });

  test('non-numeric sibling codes are skipped, not turned into NaN', () => {
    expect(nextChildAccountCode('1', ['10001', 'N/A', '', null, '10002'])).toBe('10003');
  });
});

describe('a chart four levels deep', () => {
  // THE REGRESSION. `SELECT MAX(CAST(code AS INTEGER))` on a parent whose code
  // is 1000100010001 fails with 22003: int4 stops at 2,147,483,647, ten
  // digits, and this is thirteen. Creating a party under such a parent
  // returned a 500 every single time.
  const LEVEL_4 = '1000100010001';

  test('the level-4 code is past what int4 can hold', () => {
    expect(Number(LEVEL_4)).toBeGreaterThan(2147483647);
    expect(LEVEL_4).toHaveLength(13);
  });

  test('numbering under a level-3 parent produces it without complaint', () => {
    expect(nextChildAccountCode('100010001', [])).toBe(LEVEL_4);
  });

  test('and numbering continues alongside it', () => {
    expect(nextChildAccountCode('100010001', [LEVEL_4])).toBe('1000100010002');
  });
});

describe('a fifth level, where ordinary JS numbers stop being exact', () => {
  const LEVEL_4 = '1000100010001';
  const LEVEL_5 = '10001000100010001';

  test('the level-5 code is past what a double holds exactly', () => {
    // This is the reason the arithmetic is BigInt rather than parseInt: the
    // multiplication that produces this number is already outside the range a
    // double represents exactly, so a Number-based allocator would not throw -
    // it would hand back a code that is quietly off by a digit or two.
    expect(Number.isSafeInteger(Number(LEVEL_4) * BLOCK)).toBe(false);
  });

  test('but the allocator still gets it exactly right', () => {
    expect(nextChildAccountCode(LEVEL_4, [])).toBe(LEVEL_5);
    expect(nextChildAccountCode(LEVEL_4, [LEVEL_5])).toBe('10001000100010002');
  });
});

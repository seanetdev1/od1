const { bumpPartyCode, NON_NUMERIC_CODES } = require('../../functions/partyCode');

// The party numbering shared by Setup > Parties and Setup > Carriers. Extracted
// so the two cannot drift; these pin the behaviour that was extracted, not a
// new one.

describe('bumpPartyCode', () => {
  test('adds one to the newest code', () => {
    expect(bumpPartyCode('1041')).toBe(1042);
    expect(bumpPartyCode(1041)).toBe(1042);
  });

  test('the very first party gets 1', () => {
    // parseInt(undefined || 0) === 0. An install with no parties at all, and
    // the reason the original wrote `|| 0` rather than guarding.
    expect(bumpPartyCode(undefined)).toBe(1);
    expect(bumpPartyCode(null)).toBe(1);
    expect(bumpPartyCode('')).toBe(1);
    expect(bumpPartyCode(0)).toBe(1);
  });

  test('reads a leading number out of a padded code', () => {
    expect(bumpPartyCode('00099')).toBe(100);
  });

  // The hazard the exclusion list exists for, pinned rather than fixed: a
  // non-numeric code reaching the top of the ordering yields NaN, which would
  // then be written as the next party's code. The eight known legacy rows are
  // excluded by the query so this cannot happen with them.
  test('a non-numeric code yields NaN - which is what the exclusion list prevents', () => {
    expect(Number.isNaN(bumpPartyCode('CU-00633'))).toBe(true);
  });

  test('the exclusion list holds the known legacy codes', () => {
    expect(NON_NUMERIC_CODES).toContain('CU-00633');
    expect(NON_NUMERIC_CODES).toContain('CC-11914');
    expect(NON_NUMERIC_CODES).toHaveLength(8);
    // Every one of them is genuinely non-numeric - if a numeric code were
    // added here it would be skipped for no reason and numbering would jump.
    NON_NUMERIC_CODES.forEach((code) => {
      expect(Number.isNaN(parseInt(code))).toBe(true);
    });
  });
});

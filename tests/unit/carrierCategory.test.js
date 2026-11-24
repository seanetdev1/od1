/**
 * The carrier reporting tag - functions/carrierCategory.js.
 *
 * The tag was renamed from ER to GAM in 1.2.3, and the rename is the only
 * reason this module exists: carriers registered before it still hold 'ER' in
 * a free-text column, and the way that fails without translation is silent.
 * An unrecognised tag matches none of the three report buckets, so a month's
 * GAM cargo would report as untagged with nothing on the screen saying why.
 */
const {
  CARRIER_CATEGORIES, read, forWrite, forOverride, tagFor,
} = require('../../functions/carrierCategory');

describe('the tags themselves', () => {
  test('are GAM, IFA and Other', () => {
    expect(CARRIER_CATEGORIES).toEqual(['GAM', 'IFA', 'Other']);
  });

  test('no longer include the old spelling', () => {
    expect(CARRIER_CATEGORIES).not.toContain('ER');
  });
});

describe('reading a stored tag', () => {
  test('passes the current spellings through', () => {
    expect(read('GAM')).toBe('GAM');
    expect(read('IFA')).toBe('IFA');
    expect(read('Other')).toBe('Other');
  });

  test('reads a pre-1.2.3 ER as GAM', () => {
    // The whole point: this is what a carrier registered before the rename
    // holds, and the report has to count it in the right column.
    expect(read('ER')).toBe('GAM');
  });

  test('is case- and space-insensitive, because the column is free text', () => {
    expect(read(' er ')).toBe('GAM');
    expect(read('gam')).toBe('GAM');
    expect(read('other')).toBe('Other');
  });

  test('falls back to Other rather than passing an unknown tag through', () => {
    // An unknown tag reaching the report counts toward no column at all,
    // which reads on the sheet as cargo that was never carried.
    expect(read('Cargolux')).toBe('Other');
    expect(read('')).toBe('Other');
    expect(read(null)).toBe('Other');
    expect(read(undefined)).toBe('Other');
  });
});

describe('writing a tag', () => {
  test('accepts the three current ones', () => {
    expect(forWrite('GAM')).toBe('GAM');
    expect(forWrite('IFA')).toBe('IFA');
    expect(forWrite('Other')).toBe('Other');
  });

  test('translates ER rather than refusing it', () => {
    // A browser tab left open across the upgrade is still offering the old
    // spelling. Rejecting a value the application itself handed out is a bad
    // way to tell someone to reload.
    expect(forWrite('ER')).toBe('GAM');
  });

  test('refuses anything else, so the column cannot fill with spellings', () => {
    expect(forWrite('gam')).toBeNull();
    expect(forWrite('other')).toBeNull();
    expect(forWrite('Cargolux')).toBeNull();
  });

  test('an absent category is the default, not a refusal', () => {
    // The field is optional on the carrier form.
    expect(forWrite('')).toBe('Other');
    expect(forWrite(null)).toBe('Other');
    expect(forWrite(undefined)).toBe('Other');
  });
});

describe('a per-AWB override being saved', () => {
  test('accepts the three tags', () => {
    expect(forOverride('GAM')).toBe('GAM');
    expect(forOverride('IFA')).toBe('IFA');
    expect(forOverride('Other')).toBe('Other');
  });

  test('translates the old spelling, like everything else', () => {
    expect(forOverride('ER')).toBe('GAM');
  });

  test('a BLANK override is null, not Other', () => {
    // The difference from forWrite, and the whole reason this exists. On a
    // carrier, blank means Other. On a consignment, blank means "inherit the
    // carrier's" - storing Other would silently retag every AWB on the flight
    // and move a month's cargo out of its column.
    expect(forOverride('')).toBeNull();
    expect(forOverride('   ')).toBeNull();
    expect(forOverride(null)).toBeNull();
    expect(forOverride(undefined)).toBeNull();
  });

  test('an unrecognised value falls back to inheriting', () => {
    // One cell in a grid that only offers three values, so this came from a
    // stale tab. Not overriding is exactly the behaviour the field did not
    // exist for, which makes it the safe reading.
    expect(forOverride('Cargolux')).toBeNull();
    expect(forOverride('gam')).toBeNull();
  });
});

describe('the tag a consignment counts under', () => {
  test('is its own when it has one', () => {
    expect(tagFor('Other', 'GAM')).toBe('Other');
  });

  test("is the carrier's when it has none", () => {
    expect(tagFor(null, 'IFA')).toBe('IFA');
    expect(tagFor('', 'GAM')).toBe('GAM');
  });

  test('normalises whichever one it ends up using', () => {
    // A carrier registered before 1.2.3 still holds 'ER'.
    expect(tagFor(null, 'ER')).toBe('GAM');
    expect(tagFor('ER', 'IFA')).toBe('GAM');
  });

  test('an override rescues an AWB whose carrier has no tag', () => {
    // The case the column was added for.
    expect(tagFor('IFA', null)).toBe('IFA');
    expect(tagFor('IFA', '')).toBe('IFA');
  });

  test('is null - untagged - when neither says anything', () => {
    // Deliberately NOT 'Other'. An AWB nobody has tagged is a missing answer,
    // and counting it as Other Carrier buries that in a column that looks
    // correct.
    expect(tagFor(null, null)).toBeNull();
    expect(tagFor('', '')).toBeNull();
    expect(tagFor(undefined, undefined)).toBeNull();
  });

  test('an unusable override still falls back to the carrier', () => {
    expect(tagFor('Cargolux', 'GAM')).toBe('GAM');
  });
});

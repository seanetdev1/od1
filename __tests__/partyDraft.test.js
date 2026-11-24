/**
 * The party form's draft round trip.
 *
 * Switching tabs unmounts the form, so what has been typed only survives by
 * going through here into redux and back. Two things have to hold: nothing
 * non-serializable reaches the store, and nothing is quietly altered on the
 * way back.
 */
import moment from 'moment';
import { toDraft, fromDraft, draftDiffersFrom } from 'functions/partyDraft';

describe('toDraft', () => {
  test('turns the moment fields into strings the store can hold', () => {
    const d = toDraft({
      name: 'Falcon Agencies',
      registerDate: moment('2026-08-30'),
      bankAuthorizeDate: moment('2026-01-15'),
    });
    expect(typeof d.registerDate).toBe('string');
    expect(typeof d.bankAuthorizeDate).toBe('string');
    // redux-toolkit's serializableCheck is the thing being satisfied here.
    expect(() => JSON.stringify(d)).not.toThrow();
  });

  test('an empty or invalid date becomes an empty string, not "Invalid date"', () => {
    // "Invalid date" would revive into an invalid moment and render as a
    // convincing blank, which is worse than being blank.
    expect(toDraft({ registerDate: '' }).registerDate).toBe('');
    expect(toDraft({ registerDate: moment('not a date') }).registerDate).toBe('');
    expect(toDraft({ registerDate: null }).registerDate).toBe('');
  });

  test('keeps the ordinary fields as they were', () => {
    const values = {
      name: 'Falcon', city: 'Karachi', active: true,
      types: ['Shipper', 'Consignee'], operations: ['Air Export'],
      nonGl: false, parentAccount: 7,
    };
    expect(toDraft(values)).toMatchObject(values);
  });

  test('drops values JSON cannot represent rather than storing them', () => {
    const d = toDraft({ name: 'Falcon', onSave: () => {}, missing: undefined });
    expect(d.name).toBe('Falcon');
    expect('onSave' in d).toBe(false);
    expect('missing' in d).toBe(false);
  });
});

describe('fromDraft', () => {
  test('revives the date fields as moments, so a restored form matches a loaded one', () => {
    const revived = fromDraft(toDraft({ registerDate: moment('2026-08-30') }));
    expect(moment.isMoment(revived.registerDate)).toBe(true);
    expect(revived.registerDate.format('YYYY-MM-DD')).toBe('2026-08-30');
  });

  test('an empty date stays empty rather than becoming "now"', () => {
    // moment(undefined) is the current time - restoring a form would silently
    // stamp today onto a date the user never filled in.
    expect(fromDraft({ registerDate: '' }).registerDate).toBe('');
  });

  test('returns null for no draft, so the caller can tell there was none', () => {
    expect(fromDraft(null)).toBeNull();
    expect(fromDraft(undefined)).toBeNull();
  });

  test('survives a full round trip with every field type the form uses', () => {
    const values = {
      name: 'Falcon', city: 'Karachi', active: true, zip: '',
      types: ['Shipper'], operations: ['Air Export', 'Air Import'],
      registerDate: moment('2026-08-30'), bankAuthorizeDate: '',
      nonGl: false, parentAccount: 7,
    };
    const back = fromDraft(toDraft(values));
    expect(back.name).toBe('Falcon');
    expect(back.types).toEqual(['Shipper']);
    expect(back.operations).toEqual(['Air Export', 'Air Import']);
    expect(back.nonGl).toBe(false);
    expect(back.parentAccount).toBe(7);
    expect(back.registerDate.format('YYYY-MM-DD')).toBe('2026-08-30');
    expect(back.bankAuthorizeDate).toBe('');
  });
});

describe('draftDiffersFrom', () => {
  const saved = { name: 'Falcon', city: 'Karachi', types: ['Shipper'], zip: '' };

  test('a form that was opened and not touched is not a draft', () => {
    // Every open form fires a watch, so without this every party ever viewed
    // would come back wearing an "unsaved changes" banner.
    expect(draftDiffersFrom({ ...saved }, saved)).toBe(false);
  });

  test('notices a changed, added or cleared field', () => {
    expect(draftDiffersFrom({ ...saved, name: 'Falcon Agencies' }, saved)).toBe(true);
    expect(draftDiffersFrom({ ...saved, ntn: '1234567' }, saved)).toBe(true);
    expect(draftDiffersFrom({ ...saved, city: '' }, saved)).toBe(true);
  });

  test('compares arrays by content, not identity', () => {
    // types and operations are rebuilt as new arrays on every load, so
    // reference equality would report a change on every single open.
    expect(draftDiffersFrom({ ...saved, types: ['Shipper'] }, saved)).toBe(false);
    expect(draftDiffersFrom({ ...saved, types: ['Shipper', 'Consignee'] }, saved)).toBe(true);
  });

  test("treats '', null and undefined as the same empty", () => {
    // The form produces all three for "not filled in", depending on which
    // input cleared it.
    expect(draftDiffersFrom({ ...saved, zip: null }, { ...saved, zip: undefined })).toBe(false);
    expect(draftDiffersFrom({ ...saved, zip: '0' }, saved)).toBe(true);
  });

  test('no draft is never a difference; no baseline always is', () => {
    expect(draftDiffersFrom(null, saved)).toBe(false);
    expect(draftDiffersFrom(saved, null)).toBe(true);
  });
});

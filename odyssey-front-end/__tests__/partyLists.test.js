/**
 * Reading a party's list columns, and building the edit history from them.
 *
 * THE BUG THIS PINS lost edits silently. Clients.operations is a joined STRING
 * column and is NULL on 12,716 of CargoLinkers' 12,918 parties. Every party
 * form turned it into an array with `value?.split(', ')`, which yields
 * `undefined` rather than `[]` - and the edit history then called .forEach on
 * it and threw.
 *
 * The throw happened on the line BEFORE the save request, so there was no
 * error anyone could act on and no request: the party simply never updated.
 * That is the shape of failure worth a test - not a crash people report, but a
 * save that quietly does not happen.
 */
import { toList } from 'functions/partyLists';
import {
  createHistoryCheck, createHistoryCompanies, createHistorySelect,
} from 'functions/historyChecks';

describe('a joined list column, as the form needs it', () => {
  test('an unrecorded list is EMPTY, not absent', () => {
    // The whole bug in one line: `null?.split(', ')` is undefined, and
    // undefined has no .forEach.
    expect(toList(null)).toEqual([]);
    expect(toList(undefined)).toEqual([]);
    expect(toList('')).toEqual([]);
  });

  test('splits the format the column is actually written in', () => {
    expect(toList('Sea Import, Sea Export')).toEqual(['Sea Import', 'Sea Export']);
    expect(toList('Shipper')).toEqual(['Shipper']);
  });

  test('and tolerates one written without the space', () => {
    // Split on the literal ', ', a value stored as "Shipper,Consignee" came
    // back as ONE entry, matched no checkbox, and the tick vanished on save.
    expect(toList('Shipper,Consignee')).toEqual(['Shipper', 'Consignee']);
    expect(toList('Shipper ,  Consignee')).toEqual(['Shipper', 'Consignee']);
  });

  test('leaves an array alone, so calling it twice is safe', () => {
    const already = ['Shipper'];
    expect(toList(already)).toBe(already);
  });

  test('drops the empty entries a trailing comma produces', () => {
    expect(toList('Shipper, ')).toEqual(['Shipper']);
    expect(toList(', ,')).toEqual([]);
  });
});

describe('the edit history cannot block a save', () => {
  /* It is built on the line before the request goes out, so anything thrown
   * here discards the edit. A note about what changed is worth nothing next to
   * the change itself. */
  test('a party with no operations recorded does not throw', () => {
    expect(() => createHistoryCheck(undefined, ['Sea Import'], 'Operations')).not.toThrow();
    expect(() => createHistoryCheck(null, ['Sea Import'], 'Operations')).not.toThrow();
    expect(() => createHistoryCheck(['Sea Import'], undefined, 'Operations')).not.toThrow();
    expect(() => createHistoryCheck(undefined, undefined, 'Operations')).not.toThrow();
  });

  test('and the change is still reported, not swallowed', () => {
    // Absent reads as "there was nothing here before", which is what it means.
    const html = createHistoryCheck(undefined, ['Sea Import'], 'Operations');
    expect(html).toContain('Operations');
    expect(html).toContain('Sea Import');
  });

  test('nothing before and nothing after is not a change', () => {
    expect(createHistoryCheck(undefined, [], 'Operations')).toBe('');
    expect(createHistoryCheck(undefined, undefined, 'Operations')).toBe('');
  });

  test('an unchanged list is still reported as no change', () => {
    expect(createHistoryCheck(['Shipper'], ['Shipper'], 'Types')).toBe('');
  });

  test('the companies and select builders survive the same gaps', () => {
    expect(() => createHistoryCompanies(undefined, undefined, undefined, 'Companies')).not.toThrow();
    expect(() => createHistoryCompanies([{ id: 1, title: 'A' }], null, [1], 'Companies')).not.toThrow();
    expect(() => createHistorySelect(undefined, 1, 2, 'Sales Rep')).not.toThrow();
  });
});

describe('the reported failure, end to end', () => {
  test('a migrated party saves its history instead of throwing it away', () => {
    // Exactly the row the crash came from: operations null in the database,
    // types populated, and the user ticking an operation on the way through.
    const fromDatabase = { operations: null, types: 'Shipper, Consignee' };

    const oldRecord = {
      operations: toList(fromDatabase.operations),
      types: toList(fromDatabase.types),
    };
    const submitted = { operations: ['Sea Import'], types: ['Shipper', 'Consignee'] };

    let html = '';
    expect(() => {
      html = createHistoryCheck(oldRecord.types, submitted.types, 'Types')
        + createHistoryCheck(oldRecord.operations, submitted.operations, 'Operations');
    }).not.toThrow();

    // Types did not move, operations gained one.
    expect(html).toContain('Operations');
    expect(html).not.toContain('Types');
    expect(html).toContain('Sea Import');
  });
});

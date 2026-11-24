/**
 * Finding a charge in the master - functions/chargeSearch.
 *
 * The picker exists because a charge is known by three different names to
 * three different people: the code to accounts, the short name to operations,
 * the full description to whoever is reading the vendor's bill. Search that
 * only reads the field it happens to display sends two of those three
 * scrolling, which is the state this replaced.
 *
 * Ranking is the other half. On a master of a few hundred, an unranked
 * substring match buries the obvious answer: typing THC must put the charge
 * whose code IS "THC" first, not four charges that mention it in passing.
 */
import { chargeMatches, rankedCharges } from 'functions/chargeSearch';

const MASTER = [
  { id: 1, code: 'AGN', short: 'Agency', name: '(AGN) Agency', fullName: 'Agency Fee - Clearing' },
  { id: 2, code: 'THC', short: 'Terminal', name: '(THC) Terminal', fullName: 'Terminal Handling Charge - Import' },
  { id: 3, code: 'THCE', short: 'Terminal Exp', name: '(THCE) Terminal Exp', fullName: 'Terminal Handling Charge - Export' },
  { id: 4, code: 'TRN', short: 'Transport', name: '(TRN) Transport', fullName: 'Inland Transport, incl THC at yard' },
  { id: 5, code: 'DUT', short: 'Duty', name: '(DUT) Duty', fullName: 'Duty & Taxes Reimbursement' },
];

const ids = (rows) => rows.map((r) => r.id);

describe('the three names a charge goes by', () => {
  test('finds it by its code', () => {
    expect(ids(rankedCharges(MASTER, 'AGN'))).toEqual([1]);
  });

  test('finds it by its short name', () => {
    expect(ids(rankedCharges(MASTER, 'agency'))).toEqual([1]);
  });

  test('finds it by words only in the full description', () => {
    // Nothing about "reimbursement" appears in the code or the short name.
    // This is the case the old dropdown could not serve at all.
    expect(ids(rankedCharges(MASTER, 'reimbursement'))).toEqual([5]);
  });

  test('is case-insensitive', () => {
    expect(ids(rankedCharges(MASTER, 'ThC'))).toEqual(ids(rankedCharges(MASTER, 'thc')));
  });

  test('and still answers a query typed the way the old dropdown read', () => {
    expect(ids(rankedCharges(MASTER, '(dut) duty'))).toEqual([5]);
  });
});

describe('every word has to match, but not all in one field', () => {
  test('narrows two near-identical charges apart', () => {
    // THC and THCE differ ONLY in the tail of the full name, which is exactly
    // what the one-line dropdown could not show.
    expect(ids(rankedCharges(MASTER, 'thc import'))).toEqual([2]);
    expect(ids(rankedCharges(MASTER, 'thc export'))).toEqual([3]);
  });

  test('the words may land in different fields', () => {
    // "terminal" is the short name, "export" is in the full name.
    expect(ids(rankedCharges(MASTER, 'terminal export'))).toEqual([3]);
  });

  test('order does not matter', () => {
    expect(ids(rankedCharges(MASTER, 'import thc')))
      .toEqual(ids(rankedCharges(MASTER, 'thc import')));
  });

  test('a word that matches nothing rules the charge out', () => {
    expect(rankedCharges(MASTER, 'thc bicycle')).toEqual([]);
  });
});

describe('the obvious answer comes first', () => {
  test('an exact code beats a mention of it elsewhere', () => {
    // THC is charge 2's code; charge 4 only mentions it in its description,
    // and charge 3's code merely starts with it.
    expect(ids(rankedCharges(MASTER, 'THC'))).toEqual([2, 3, 4]);
  });

  test('a field that starts with the query beats one that contains it', () => {
    expect(ids(rankedCharges(MASTER, 'terminal'))).toEqual([2, 3]);
  });

  test('equal ranks keep the master order, so the list does not reshuffle', () => {
    const once = ids(rankedCharges(MASTER, 'charge'));
    const twice = ids(rankedCharges(MASTER, 'charge'));
    expect(once).toEqual(twice);
    expect(once).toEqual([2, 3]);
  });
});

describe('an empty query', () => {
  test('is the whole master, in its own order', () => {
    expect(ids(rankedCharges(MASTER, ''))).toEqual([1, 2, 3, 4, 5]);
    expect(ids(rankedCharges(MASTER, '   '))).toEqual([1, 2, 3, 4, 5]);
    expect(ids(rankedCharges(MASTER, undefined))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('gaps in the master do not throw', () => {
  // A charge set up with no short name, or served by a backend that predates
  // the separate code/short fields.
  const ragged = [
    { id: 9, fullName: 'Only a full name' },
    { id: 10, code: null, short: undefined, name: '(X) X' },
    null,
  ];

  test('a charge missing fields is still searchable by the ones it has', () => {
    expect(ids(rankedCharges(ragged, 'full name'))).toEqual([9]);
  });

  test('and nothing in the list can blow it up', () => {
    expect(() => rankedCharges(ragged, 'x')).not.toThrow();
    expect(() => rankedCharges(null, 'x')).not.toThrow();
    expect(rankedCharges(undefined, 'x')).toEqual([]);
    expect(chargeMatches(null, 'x')).toBe(false);
    expect(chargeMatches(undefined, '')).toBe(true);
  });
});

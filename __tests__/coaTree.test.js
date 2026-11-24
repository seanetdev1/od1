/**
 * Finding an account in the chart and opening the tree onto it.
 *
 * The behaviour that matters is what the search does to branches it was NOT
 * asked about: it opens the way to the account and leaves everything else as
 * the user left it. A search that tidied up behind itself would undo work the
 * user could see themselves doing.
 */
import {
  childrenOf, flattenAccounts, ancestorIdsOf, expandToAccount, visibleRows,
} from 'functions/coaTree';

/* A chart with the two things that make this awkward: depth, and the same leaf
 * name in two different places. */
const CHART = [
  {
    id: 1, title: 'Assets', code: '1', check: false,
    children: [
      {
        id: 11, title: 'Current Assets', code: '10001', check: false,
        children: [
          { id: 111, title: 'Bank', code: '100010001', check: false, children: [] },
          { id: 112, title: 'Cash', code: '100010002', check: false, children: [] },
        ],
      },
    ],
  },
  {
    id: 2, title: 'Expense', code: '2', check: false,
    children: [
      { id: 21, title: 'Bank', code: '20001', check: false, children: [] },
    ],
  },
];

describe('childrenOf accepts either shape the API uses', () => {
  test('normalised .children', () => {
    expect(childrenOf({ children: [{ id: 1 }] })).toHaveLength(1);
  });

  test('raw .Child_Accounts', () => {
    expect(childrenOf({ Child_Accounts: [{ id: 1 }] })).toHaveLength(1);
  });

  test('a leaf, and rubbish, give an empty list rather than throwing', () => {
    expect(childrenOf({ id: 1 })).toEqual([]);
    expect(childrenOf(null)).toEqual([]);
    expect(childrenOf(undefined)).toEqual([]);
  });
});

describe('flattenAccounts', () => {
  const flat = flattenAccounts(CHART);

  test('returns every account in the chart, at every depth', () => {
    expect(flat.map((a) => a.id)).toEqual([1, 11, 111, 112, 2, 21]);
  });

  test('each one carries the path that leads to it', () => {
    // Without this, the two accounts called Bank are identical rows in a
    // dropdown and the user is asked to pick between them blind.
    const banks = flat.filter((a) => a.title === 'Bank');
    expect(banks.map((b) => b.path)).toEqual(['Assets › Current Assets', 'Expense']);
  });

  test('a top-level account has no path - it IS the heading', () => {
    expect(flat.find((a) => a.id === 1).path).toBe('');
  });

  test('depth counts the ancestors', () => {
    expect(flat.find((a) => a.id === 1).depth).toBe(0);
    expect(flat.find((a) => a.id === 11).depth).toBe(1);
    expect(flat.find((a) => a.id === 111).depth).toBe(2);
  });

  test('groups are distinguished from leaves', () => {
    expect(flat.find((a) => a.id === 11).hasChildren).toBe(true);
    expect(flat.find((a) => a.id === 111).hasChildren).toBe(false);
  });

  test('search matches on code, title or any ancestor, lowercased', () => {
    const bank = flat.find((a) => a.id === 111);
    expect(bank.search).toContain('100010001');   // its code
    expect(bank.search).toContain('bank');        // its title
    expect(bank.search).toContain('current assets'); // where it lives
  });

  test('an empty chart flattens to nothing', () => {
    expect(flattenAccounts([])).toEqual([]);
    expect(flattenAccounts(undefined)).toEqual([]);
    expect(flattenAccounts([null])).toEqual([]);
  });
});

describe('ancestorIdsOf', () => {
  test('lists the ancestors outermost first', () => {
    expect(ancestorIdsOf(CHART, 111)).toEqual([1, 11]);
  });

  test('a top-level account has none', () => {
    expect(ancestorIdsOf(CHART, 1)).toEqual([]);
  });

  test('matches across string and number ids', () => {
    // The Select hands back whatever antd holds; the tree holds numbers.
    expect(ancestorIdsOf(CHART, '111')).toEqual([1, 11]);
  });

  test('an account not in the chart gives null, not an empty path', () => {
    // [] means "found, at the top"; null means "not here". Collapsing the two
    // would make a deleted account look like a top-level one.
    expect(ancestorIdsOf(CHART, 999)).toBeNull();
    expect(ancestorIdsOf(CHART, null)).toBeNull();
    expect(ancestorIdsOf(CHART, undefined)).toBeNull();
  });
});

describe('expandToAccount', () => {
  const find = (records, id) => flattenAccountsRaw(records).find((n) => String(n.id) === String(id));
  // Walks the real nodes rather than the flattened summaries, so `check` is
  // readable.
  const flattenAccountsRaw = (nodes) => (nodes || []).flatMap(
    (n) => [n, ...flattenAccountsRaw(childrenOf(n))]
  );

  test('opens every ancestor of the account', () => {
    const next = expandToAccount(CHART, 111);
    expect(find(next, 1).check).toBe(true);
    expect(find(next, 11).check).toBe(true);
  });

  test('does NOT open the account itself', () => {
    // Revealing something means making it visible, not opening its own
    // children - which is a different request.
    const next = expandToAccount(CHART, 111);
    expect(find(next, 111).check).toBe(false);
  });

  test('leaves branches it was not asked about closed', () => {
    const next = expandToAccount(CHART, 111);
    expect(find(next, 2).check).toBe(false);
  });

  /* THE ONE THAT MATTERS. A branch the user opened by hand on the way to
   * something else stays open - a search that closed it would undo work the
   * user could see themselves doing, and the next search would undo this one. */
  test('never closes a branch that was already open', () => {
    const opened = expandToAccount(CHART, 21);          // opens Expense
    const then = expandToAccount(opened, 111);          // now go to Assets › Bank
    expect(find(then, 2).check).toBe(true);             // Expense is still open
    expect(find(then, 1).check).toBe(true);
  });

  test('a top-level account needs nothing opened, and nothing is', () => {
    const next = expandToAccount(CHART, 2);
    expect(find(next, 1).check).toBe(false);
    expect(find(next, 2).check).toBe(false);
  });

  test('an account that is not in the chart leaves it exactly as it was', () => {
    // A stale id - something deleted in another tab - must not rebuild the
    // tree, which would drop every expansion the user had made.
    const next = expandToAccount(CHART, 999);
    expect(next).toBe(CHART);
  });

  test('the original records are not mutated', () => {
    expandToAccount(CHART, 111);
    expect(CHART[0].check).toBe(false);
    expect(CHART[0].children[0].check).toBe(false);
  });
});

/* The rows the screen draws (2026-11-15 redesign): the chart in order, into
 * the open branches only - which are kept apart from the chart, so a reload
 * of the chart does not shut them. */
describe('visibleRows', () => {
  const titles = (rows) => rows.map((r) => `${'-'.repeat(r.depth)}${r.node.title}`);

  test('nothing open: the top level only, each with its count', () => {
    const rows = visibleRows(CHART, new Set());
    expect(rows.map((r) => r.node.id)).toEqual(CHART.map((n) => n.id));
    expect(rows[0]).toMatchObject({ depth: 0, open: false, childCount: CHART[0].children.length });
  });

  test('an open branch shows its children one level in, and only its children', () => {
    const rows = visibleRows(CHART, new Set(['1']));
    expect(titles(rows).slice(0, 1 + CHART[0].children.length)).toEqual([
      'Assets', ...CHART[0].children.map((c) => `-${c.title}`),
    ]);
    expect(rows[0].open).toBe(true);
  });

  test('a branch inside a shut one stays out of sight', () => {
    const rows = visibleRows(CHART, new Set(['11']));
    expect(rows.map((r) => r.node.id)).toEqual(CHART.map((n) => n.id));
  });

  test('ids are matched as strings - the finder hands back either', () => {
    expect(visibleRows(CHART, new Set(['1'])).length).toBe(visibleRows(CHART, new Set([String(1)])).length);
  });

  test('the check flags of the old tree are ignored', () => {
    const flagged = expandToAccount(CHART, 111);
    expect(visibleRows(flagged, new Set()).length).toBe(CHART.length);
  });

  test('a leaf is never open, whatever the set says', () => {
    const leaf = { id: 5, title: 'Leaf', children: [] };
    expect(visibleRows([leaf], new Set(['5']))[0]).toMatchObject({ open: false, childCount: 0 });
  });
});

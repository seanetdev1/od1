/**
 * The sidebar's rules (functions/sidebarNav): which entry is marked for the
 * open tab, the page finder's choices, one section open at a time.
 */
import {
  menuKeyFor, sectionOf, findPage, searchOptions, matchesSearch, accordion, pageKeys,
} from 'functions/sidebarNav';

const ITEMS = [
  { key: '11', label: 'Customs Job', children: [{ key: '11-1', label: 'Customs Job List' }, { key: '11-3', label: 'Program Book' }] },
  { key: '2', label: 'Setup', children: [{ key: '2-2', label: 'Parties' }, { key: '2-13', label: 'Fiscal Years' }] },
  { key: '5', label: 'Reports', children: [{ key: '5-1', label: 'Job Balancing' }, { key: '5-5', label: 'Ledger' }, { key: '5-4', label: 'Job Profit/Loss' }] },
];

describe('the entry marked for the open tab', () => {
  test('a page in the menu is itself', () => {
    expect(menuKeyFor('5-5', ITEMS)).toBe('5-5');
    expect(menuKeyFor('11-3', ITEMS)).toBe('11-3');
  });

  test('a record is the list it was opened from', () => {
    expect(menuKeyFor('11-2', ITEMS)).toBe('11-1'); // a customs job
    expect(menuKeyFor('5-7', ITEMS)).toBe('5-5'); // a ledger
    expect(menuKeyFor('2-7', ITEMS)).toBe('2-2'); // a client
  });

  test('a report page a-b-c is its report a-b', () => {
    expect(menuKeyFor('5-1-1', ITEMS)).toBe('5-1');
    expect(menuKeyFor('5-4-3', ITEMS)).toBe('5-4');
  });

  test('nothing for the dashboard, nothing yet, or a page this menu does not have', () => {
    expect(menuKeyFor('0-0', ITEMS)).toBeNull();
    expect(menuKeyFor(0, ITEMS)).toBeNull();
    expect(menuKeyFor(undefined, ITEMS)).toBeNull();
    expect(menuKeyFor('4-2', ITEMS)).toBeNull(); // a sea job: no Sea Jobs here
  });

  test('the section of an entry', () => {
    expect(sectionOf('11-1')).toBe('11');
    expect(sectionOf('5-1-1')).toBe('5');
  });
});

describe('the page finder', () => {
  test('every page, under its section, in the menu\'s order', () => {
    const groups = searchOptions(ITEMS);
    expect(groups.map((g) => g.label)).toEqual(['Customs Job', 'Setup', 'Reports']);
    expect(groups[2].options.map((o) => o.label)).toEqual(['Job Balancing', 'Ledger', 'Job Profit/Loss']);
    expect(pageKeys(ITEMS)).toHaveLength(7);
  });

  test('a typed word finds a page by its name, any case, or a whole section by its own', () => {
    const groups = searchOptions(ITEMS);
    const ledger = groups[2].options[1];
    expect(matchesSearch('LED', ledger)).toBe(true);
    expect(matchesSearch('led', groups[0].options[0])).toBe(false);
    expect(matchesSearch('report', groups[2])).toBe(true);
    expect(matchesSearch('  ', ledger)).toBe(true);
  });

  test('a chosen page is found again by its key', () => {
    expect(findPage(ITEMS, '11-3')).toEqual({ key: '11-3', label: 'Program Book' });
    expect(findPage(ITEMS, '9-9')).toBeNull();
  });

  test('a section with nothing in it offers nothing', () => {
    expect(searchOptions([{ key: '4', label: 'Sea Jobs', children: [null] }])).toEqual([]);
  });
});

describe('one section open at a time', () => {
  test('opening one closes the other', () => {
    expect(accordion(['11'], ['11', '5'])).toEqual(['5']);
  });
  test('closing it leaves none open', () => {
    expect(accordion(['5'], [])).toEqual([]);
  });
  test('the first one opened', () => {
    expect(accordion([], ['2'])).toEqual(['2']);
  });
});

// The Archive's pure parts: which books an install has, what a search
// screen sends made safe to bind, how Climax values leave, and the trial
// balance's roll-up of the chart. The queries themselves need the old books
// on a SQL Server and are not run here.

const { parseBooks, books, isConfigured, bookFor, connection } = require('../../functions/archive/books');
const { likeContains, day, id, paging, tranNumber } = require('../../functions/archive/inputs');
const { wallDate, wallTime, money } = require('../../functions/archive/values');
const { rollUp } = require('../../functions/archive/accounts');

describe('archive books', () => {
  const env = {
    ARCHIVE_DB_HOST: 'host.docker.internal',
    ARCHIVE_DB_USER: 'odyssey_archive',
    ARCHIVE_DB_PASS: 'x',
    ARCHIVE_BOOKS: 'CTLS_CLINK_2016=2016 - Aug 2024; CTLS_CLINK=2012 - 2015 ;CTLS_CLINK_1314',
  };

  it('reads DATABASE=Label pairs in order, the label defaulting to the name', () => {
    expect(books(env)).toEqual([
      { key: 'CTLS_CLINK_2016', label: '2016 - Aug 2024' },
      { key: 'CTLS_CLINK', label: '2012 - 2015' },
      { key: 'CTLS_CLINK_1314', label: 'CTLS_CLINK_1314' },
    ]);
  });

  it('drops a name that is not a plain database name, and a repeat', () => {
    expect(parseBooks('A=1;bad name=2;x;y]=3;a=again;B_2=ok').map((b) => b.key)).toEqual(['A', 'x', 'B_2']);
  });

  it('has no books without a host and a user, whatever ARCHIVE_BOOKS says', () => {
    expect(books({ ...env, ARCHIVE_DB_HOST: '' })).toEqual([]);
    expect(isConfigured({ ...env, ARCHIVE_DB_USER: ' ' })).toBe(false);
    expect(isConfigured(env)).toBe(true);
    expect(isConfigured({})).toBe(false);
  });

  it('finds a book only by a key on the list - case aside', () => {
    expect(bookFor('ctls_clink', env)).toEqual({ key: 'CTLS_CLINK', label: '2012 - 2015' });
    expect(bookFor('CSUL_CLINKLOG_PAK', env)).toBeNull();
    expect(bookFor('CTLS_CLINK;DROP', env)).toBeNull();
    expect(bookFor(undefined, env)).toBeNull();
  });

  it('defaults the port and reads encryption as an explicit true only', () => {
    expect(connection(env)).toMatchObject({ port: 1433, encrypt: false, instance: '' });
    expect(connection({ ...env, ARCHIVE_DB_PORT: '14330', ARCHIVE_DB_ENCRYPT: 'TRUE' })).toMatchObject({ port: 14330, encrypt: true });
    expect(connection({ ...env, ARCHIVE_DB_PORT: 'abc' }).port).toBe(1433);
  });
});

describe('archive inputs', () => {
  it('wraps a search in % and takes the user\'s own wildcards literally', () => {
    expect(likeContains(' JL-001 ')).toBe('%JL-001%');
    expect(likeContains('50%_off[1]')).toBe('%50[%][_]off[[]1]%');
    expect(likeContains('')).toBeNull();
    expect(likeContains(null)).toBeNull();
  });

  it('takes a day only as YYYY-MM-DD', () => {
    expect(day('2016-01-01').toISOString()).toBe('2016-01-01T00:00:00.000Z');
    expect(day('2016-02-30')).toBeNull();
    expect(day('01-01-2016')).toBeNull();
    expect(day("2016-01-01'; --")).toBeNull();
  });

  it('takes ids and voucher numbers as digits only', () => {
    expect(id('42')).toBe(42);
    expect(id('0')).toBeNull();
    expect(id('4 2')).toBeNull();
    expect(tranNumber('161700009619')).toBe('161700009619');
    expect(tranNumber('1617-1')).toBeNull();
  });

  it('clamps paging', () => {
    expect(paging({})).toEqual({ page: 1, pageSize: 50, offset: 0 });
    expect(paging({ page: '3', pageSize: '20' })).toEqual({ page: 3, pageSize: 20, offset: 40 });
    expect(paging({ page: '-1', pageSize: '100000' })).toEqual({ page: 1, pageSize: 200, offset: 0 });
  });
});

describe('archive values', () => {
  it('sends a Climax date as the wall date it was, not an instant', () => {
    // The driver reads Climax's zoneless 2016-01-01 00:00 as that clock in UTC.
    const d = new Date(Date.UTC(2016, 0, 1, 0, 0));
    expect(wallDate(d)).toBe('2016-01-01');
    expect(wallTime(new Date(Date.UTC(2016, 0, 1, 19, 5)))).toBe('2016-01-01 19:05');
    expect(wallDate(null)).toBe('');
    expect(wallDate(new Date('x'))).toBe('');
  });

  it('rounds money to the paisa and reads nothing as 0', () => {
    expect(money('1234.565')).toBe(1234.57);
    expect(money(null)).toBe(0);
    expect(money('abc')).toBe(0);
  });
});

describe('the archive trial balance roll-up', () => {
  // ASSETS (1) > FIXED ASSETS (2) > MOTOR VEHICLES (98) > two bikes; and a
  // ledger straight under FIXED ASSETS. LIABILITY (5) > a creditor.
  const chart = [
    { id: 1, code: '1', name: 'ASSETS', parentId: 0, kind: 1, category: 1 },
    { id: 2, code: '11', name: 'FIXED ASSETS', parentId: 1, kind: 1, category: 1 },
    { id: 98, code: '1101', name: 'MOTOR VEHICLES', parentId: 2, kind: 1, category: 1 },
    { id: 3019, code: '110103', name: 'BIKE-KNK-1194', parentId: 98, kind: 2, category: 1, opening: 100, debit: 50, credit: 0 },
    { id: 3020, code: '110104', name: 'BIKE-KMX-8314', parentId: 98, kind: 2, category: 1, opening: 0, debit: 0, credit: 30 },
    { id: 1716, code: '1105', name: 'CIVIC LEASING', parentId: 2, kind: 2, category: 1, opening: 10, debit: 0, credit: 0 },
    { id: 5, code: '2', name: 'LIABILITY', parentId: 0, kind: 1, category: 2 },
    { id: 600, code: '201', name: 'CREDITOR', parentId: 5, kind: 2, category: 2, opening: -110, debit: 0, credit: 20 },
  ];

  it('lays the chart out parent first, children in account-code order', () => {
    expect(rollUp(chart).map((r) => `${r.level}:${r.code}`)).toEqual([
      '1:1', '2:11', '3:1101', '4:110103', '4:110104', '3:1105', '1:2', '2:201',
    ]);
  });

  it('adds every ledger into each group above it', () => {
    const rows = Object.fromEntries(rollUp(chart).map((r) => [r.code, r]));
    expect(rows['1101']).toMatchObject({ opening: 100, debit: 50, credit: 30, closing: 120, isGroup: true });
    expect(rows['11']).toMatchObject({ opening: 110, debit: 50, credit: 30, closing: 130 });
    expect(rows['1']).toMatchObject({ closing: 130, category: 'Assets' });
    expect(rows['2']).toMatchObject({ opening: -110, credit: 20, closing: -130 });
    expect(rows['110103']).toMatchObject({ closing: 150, isGroup: false });
  });

  it('counts a figure posted straight to a group', () => {
    const rows = Object.fromEntries(rollUp([
      { id: 1, code: '1', name: 'G', parentId: 0, kind: 1, opening: 5, debit: 1, credit: 0 },
      { id: 2, code: '11', name: 'L', parentId: 1, kind: 2, opening: 0, debit: 2, credit: 0 },
    ]).map((r) => [r.code, r]));
    expect(rows['1']).toMatchObject({ opening: 5, debit: 3, closing: 8 });
  });

  it('survives a chart that loops or names a missing parent', () => {
    const rows = rollUp([
      { id: 1, code: '1', name: 'A', parentId: 2, kind: 1 },
      { id: 2, code: '2', name: 'B', parentId: 1, kind: 1 },
      { id: 3, code: '3', name: 'ORPHAN', parentId: 999, kind: 2, opening: 7 },
    ]);
    expect(rows.find((r) => r.code === '3')).toMatchObject({ level: 1, closing: 7 });
  });
});

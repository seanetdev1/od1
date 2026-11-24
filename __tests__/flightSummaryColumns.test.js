/**
 * Which columns the Flight Summary shows - functions/flightSummaryColumns.
 *
 * The rules worth pinning are the ones that break a TABLE rather than a
 * figure: a group heading that spans the wrong number of columns puts every
 * heading after it over the wrong numbers, and a locked column that can be
 * hidden leaves rows nobody can tell apart.
 */
import {
  FLIGHT_COLUMNS, COUNT_COLUMNS, columnsFor, visibleColumns, hiddenCount,
  groupSpans, readHidden, writeHidden, STORAGE_KEY,
  sheetMatrix, numFormatFor,
} from 'functions/flightSummaryColumns';

describe('the two views', () => {
  test('have the columns the report is read for', () => {
    expect(columnsFor('flights')).toBe(FLIGHT_COLUMNS);
    expect(columnsFor('counts')).toBe(COUNT_COLUMNS);
    expect(COUNT_COLUMNS.map((c) => c.key))
      .toEqual(['aircraft', 'pla', 'ttlFlt', 'opFlt', 'xxld', 'notOp', 'ttlWgt']);
  });

  test('every column key is unique within its view', () => {
    // The cell renderers, the header and the modal are all keyed by it; a
    // duplicate would render one column's figures under another's heading.
    for (const view of ['flights', 'counts']) {
      const keys = columnsFor(view).map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('hiding', () => {
  test('takes the column out of the table', () => {
    const cols = visibleColumns('flights', ['pfm', 'manifest']);
    expect(cols.map((c) => c.key)).not.toContain('pfm');
    expect(cols.map((c) => c.key)).not.toContain('manifest');
    expect(hiddenCount('flights', ['pfm', 'manifest'])).toBe(2);
  });

  test('cannot take away the column that identifies the row', () => {
    // Flight in Per Flight, Aircraft in Flight Counts. Rows of figures with
    // nothing naming them is not a smaller report.
    expect(visibleColumns('flights', ['flightNo']).map((c) => c.key)).toContain('flightNo');
    expect(visibleColumns('counts', ['aircraft']).map((c) => c.key)).toContain('aircraft');
    expect(hiddenCount('counts', ['aircraft'])).toBe(0);
  });

  test('a key from another view, or a key that no longer exists, is harmless', () => {
    // Stored preferences outlive releases. An unknown key must not throw, and
    // must not hide something else by accident.
    expect(visibleColumns('counts', ['pfm', 'sector', 'columnFromLastYear']))
      .toEqual(COUNT_COLUMNS);
  });

  test('counts only what this view could hide', () => {
    // The button says "3 hidden" and the list shows this view's columns; a
    // count that included the other view's would never reach nought.
    expect(hiddenCount('counts', ['pfm', 'manifest', 'pla'])).toBe(1);
  });
});

describe('the two-tier header', () => {
  test('spans the lead columns and each group', () => {
    const { lead, spans } = groupSpans(FLIGHT_COLUMNS);
    expect(lead).toBe(4);
    expect(spans.map((g) => [g.key, g.span]))
      .toEqual([['plan', 2], ['gam', 2], ['ifa', 2], ['other', 2], ['total', 2]]);
  });

  test('a half-hidden group narrows to what is left', () => {
    const { spans } = groupSpans(visibleColumns('flights', ['gamOffload']));
    expect(spans.find((g) => g.key === 'gam').span).toBe(1);
  });

  test('a group with nothing left disappears rather than spanning nought', () => {
    // A th with colSpan={0} is rendered by the browser as a full column, which
    // puts every heading after it one place out - the figures then read under
    // the wrong airline.
    const { spans } = groupSpans(visibleColumns('flights', ['ifaUplift', 'ifaOffload']));
    expect(spans.map((g) => g.key)).not.toContain('ifa');
    expect(spans.map((g) => g.span).every((n) => n > 0)).toBe(true);
  });

  test('the lead width follows the lead columns that are left', () => {
    const { lead } = groupSpans(visibleColumns('flights', ['date', 'sector']));
    expect(lead).toBe(2);
  });

  test('the spans and the lead always add up to the columns rendered', () => {
    // The invariant behind every one of the above: header width equals row
    // width, whatever is hidden.
    const cols = visibleColumns('flights', ['date', 'gamOffload', 'ifaUplift', 'ifaOffload']);
    const { lead, spans } = groupSpans(cols);
    expect(lead + spans.reduce((n, g) => n + g.span, 0)).toBe(cols.length);
  });
});

describe('remembering the choice', () => {
  beforeEach(() => window.localStorage.clear());

  test('survives a round trip', () => {
    writeHidden(['pfm', 'manifest']);
    expect(readHidden()).toEqual(['pfm', 'manifest']);
  });

  test('nothing stored reads as nothing hidden', () => {
    expect(readHidden()).toEqual([]);
  });

  test('junk in storage does not stop the report opening', () => {
    // A half-written value, or a preference from an older shape. The report
    // opening with every column is a fine outcome; throwing is not.
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(readHidden()).toEqual([]);
    window.localStorage.setItem(STORAGE_KEY, '{"pfm":true}');
    expect(readHidden()).toEqual([]);
    window.localStorage.setItem(STORAGE_KEY, '["pfm", 7, null]');
    expect(readHidden()).toEqual(['pfm']);
  });

  test('storage that cannot be written is not fatal either', () => {
    // Private windows and blocked site data both throw on setItem. The choice
    // still applies to this session; it simply is not there next time.
    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => writeHidden(['pfm'])).not.toThrow();
    window.localStorage.setItem = setItem;
  });
});

describe('the exported workbook', () => {
  const flight = (x = {}) => ({
    id: 1, date: '2026-09-01', flightNo: 'PK-301', aircraft: 'A330',
    sector: 'KHI - JED', xxld: 0, notOp: 0, pfm: 60000, manifest: 1234.5,
    uplift: { GAM: 1000, IFA: 200, Other: 0, untagged: 0 },
    offload: { GAM: 50, IFA: 0, Other: 0, untagged: 0 },
    totalUplift: 1200, totalOffload: 50, ...x,
  });
  const totals = {
    flights: 2, xxld: 1, notOp: 0, pfm: 60000, manifest: 1234.5,
    uplift: { GAM: 1000, IFA: 200, Other: 0, untagged: 0 },
    offload: { GAM: 50, IFA: 0, Other: 0, untagged: 0 },
    totalUplift: 1200, totalOffload: 50,
  };
  const labels = { plan: 'Planned & Manifested', gam: 'Gamma Air', ifa: 'IFA', other: 'Other', total: 'Total' };

  test('has a header, a row per flight and a totals row', () => {
    const cols = visibleColumns('flights', []);
    const { header, body, foot } = sheetMatrix('flights', cols, [flight()], totals, labels);
    expect(header).toHaveLength(cols.length);
    expect(body[0]).toHaveLength(cols.length);
    expect(foot).toHaveLength(cols.length);
  });

  test('every row is as wide as the header, whatever is hidden', () => {
    // The failure this exists to catch: a totals row one cell out of step with
    // its header, which nobody notices until the workbook is read.
    const cols = visibleColumns('flights', ['date', 'gamOffload', 'ifaUplift', 'ifaOffload']);
    const { header, body, foot } = sheetMatrix('flights', cols, [flight(), flight({ id: 2 })], totals, labels);
    expect(new Set([header.length, body[0].length, body[1].length, foot.length]).size).toBe(1);
  });

  test('carries NUMBERS, not the strings the screen shows', () => {
    // So the office can select a column and have Excel sum it.
    const cols = visibleColumns('flights', []);
    const { body } = sheetMatrix('flights', cols, [flight()], totals, labels);
    const at = (key) => body[0][cols.findIndex((c) => c.key === key)];
    expect(at('manifest')).toBe(1234.5);
    expect(at('gamUplift')).toBe(1000);
    expect(typeof at('totalOffload')).toBe('number');
  });

  test('qualifies the repeated headings with their group', () => {
    // Five columns are called Uplift or Offload, and a spreadsheet header has
    // no tier above it to say which airline each belongs to.
    const cols = visibleColumns('flights', []);
    const { header } = sheetMatrix('flights', cols, [], null, labels);
    expect(header).toContain('Gamma Air Uplift');
    expect(header).toContain('IFA Offload');
    expect(header).toContain('Date');
  });

  test('marks a flight that did not go, since a workbook has no tint', () => {
    const cols = visibleColumns('flights', []);
    const { body } = sheetMatrix('flights', cols, [flight({ xxld: 1 })], null, labels);
    expect(body[0][cols.findIndex((c) => c.key === 'flightNo')]).toBe('PK-301 (XXLD)');
    const notOp = sheetMatrix('flights', cols, [flight({ notOp: 1 })], null, labels);
    expect(notOp.body[0][cols.findIndex((c) => c.key === 'flightNo')]).toBe('PK-301 (NOT-OP)');
  });

  test('labels the totals row and leaves untotallable columns empty', () => {
    const cols = visibleColumns('flights', []);
    const { foot } = sheetMatrix('flights', cols, [flight()], totals, labels);
    expect(foot[0]).toBe('Total');
    // Aircraft has no total - an empty cell, not a nought that would be added
    // into anything drawn underneath it.
    expect(foot[cols.findIndex((c) => c.key === 'aircraft')]).toBeNull();
  });

  test('no totals at all means no totals row', () => {
    expect(sheetMatrix('flights', visibleColumns('flights', []), [], null, labels).foot).toBeNull();
  });

  describe('Flight Counts', () => {
    const ac = { aircraft: 'A330', pla: 60000, plaVaries: false, plaFrom: 3, ttlFlt: 4, opFlt: 2, xxld: 1, notOp: 1, totalUplift: 1000 };

    test('reads one row per aircraft off byAircraft', () => {
      const cols = visibleColumns('counts', []);
      const { body } = sheetMatrix('counts', cols, [ac], totals, labels);
      expect(body[0]).toEqual(['A330', 60000, 4, 2, 1, 1, 1000]);
    });

    test('a PLA nobody typed stays empty rather than becoming nought', () => {
      // A nought would be summed or averaged by whoever reads the sheet.
      const cols = visibleColumns('counts', []);
      const { body } = sheetMatrix('counts', cols, [{ ...ac, pla: null }], null, labels);
      expect(body[0][1]).toBeNull();
    });

    test('the totals row counts flights, and does not total PLA', () => {
      const cols = visibleColumns('counts', []);
      const { foot } = sheetMatrix('counts', cols, [ac], totals, labels);
      expect(foot[cols.findIndex((c) => c.key === 'ttlFlt')]).toBe(2);
      expect(foot[cols.findIndex((c) => c.key === 'opFlt')]).toBe(1);
      expect(foot[cols.findIndex((c) => c.key === 'pla')]).toBeNull();
    });
  });
});

describe('number formats', () => {
  test('counts are whole, weights carry two places, text carries none', () => {
    const by = (view, key) => columnsFor(view).find((c) => c.key === key);
    expect(numFormatFor(by('counts', 'ttlFlt'))).toBe('#,##0');
    expect(numFormatFor(by('counts', 'pla'))).toBe('#,##0');
    expect(numFormatFor(by('flights', 'manifest'))).toBe('#,##0.00');
    expect(numFormatFor(by('flights', 'pfm'))).toBe('#,##0');
    expect(numFormatFor(by('flights', 'aircraft'))).toBeUndefined();
  });
});

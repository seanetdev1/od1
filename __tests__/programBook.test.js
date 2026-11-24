/**
 * The Program Book grid's bookkeeping - functions/programBook: what is sent on
 * Save, what the filters show, and the numbers the rows keep.
 */
import moment from 'moment';
import {
  fromServer, newRow, isBlankRow, rowChanged, rowsToSave, stateCounts, visibleRows, periodRange, inPeriod,
} from '../functions/programBook';

const saved = (id, over = {}) => fromServer({
  id, status: 'Pending', shipperId: 3, invoiceNo: `IN-${id}`, qty: 1, size: '40HC', CustomsJobId: null, ...over,
});

test('a new row is Pending and blank; its status alone is not something', () => {
  const row = newRow(1);
  expect(row).toMatchObject({ key: 'new-1', status: 'Pending', shipperId: null });
  expect(isBlankRow(row)).toBe(true);
  expect(isBlankRow({ ...row, status: 'Confirmed' })).toBe(true);
  expect(isBlankRow({ ...row, qty: 0 })).toBe(false);
});

test('a saved row has changed when a field differs - null and empty are the same', () => {
  const original = saved(1, { remarks: null });
  expect(rowChanged({ ...original, remarks: '' }, original)).toBe(false);
  expect(rowChanged({ ...original, remarks: 'x' }, original)).toBe(true);
  expect(rowChanged({ ...original, qty: '1' }, original)).toBe(false);
});

test('Save sends the changed and the new, each with its row number - never a blank or a moved one', () => {
  const one = saved(1);
  const two = saved(2);
  const moved = saved(3, { status: 'Confirmed', CustomsJobId: 9, remarks: 'edited' });
  const originals = new Map([one, two, moved].map((r) => [r.key, r]));
  const rows = [one, { ...two, status: 'Confirmed' }, { ...moved, remarks: 'changed' }, newRow(1),
    { ...newRow(2), invoiceNo: 'IN-NEW' }];
  const sent = rowsToSave(rows, originals);
  expect(sent.map((r) => [r.id, r.rowNo, r.status, r.invoiceNo])).toEqual([
    [2, 2, 'Confirmed', 'IN-2'],
    [undefined, 5, 'Pending', 'IN-NEW'],
  ]);
  // Only the plan's own fields go - not the key, the job, or the parties as objects.
  expect(Object.keys(sent[0]).sort()).toEqual([
    'bookingNo', 'containerList', 'currentStatus', 'cutOff', 'gateInTime', 'gdNumber', 'id', 'invoiceNo',
    'pod', 'pol', 'qty', 'remarks', 'rowNo', 'shipperId', 'shippingLineId', 'size', 'status',
    'transporterId', 'vessel',
  ]);
});

test('counts every saved plan by state', () => {
  const rows = [saved(1), saved(2, { status: 'Confirmed' }), saved(3, { CustomsJobId: 4 }), newRow(1)];
  expect(stateCounts(rows)).toEqual({ Pending: 1, Confirmed: 1, Cancelled: 0, Moved: 1 });
});

describe('what the grid shows', () => {
  const rows = [
    saved(1),
    saved(2, { status: 'Cancelled' }),
    saved(3, { status: 'Confirmed', CustomsJobId: 9, Customs_Job: { jobNo: 'CL-CCJ-91/27' } }),
    newRow(1),
  ];

  test('the states picked, each row keeping its book number - and always a new row', () => {
    expect(visibleRows(rows, { states: new Set(['Pending', 'Confirmed']) }).map((x) => x.rowNo)).toEqual([1, 4]);
    expect(visibleRows(rows, { states: new Set(['Moved']) }).map((x) => x.rowNo)).toEqual([3, 4]);
    expect(visibleRows(rows, { states: new Set() })).toHaveLength(4);
  });

  test('search reads the job number and the parties\' names too', () => {
    const nameOf = (id) => (id === 3 ? 'ABC TEXTILES' : '');
    expect(visibleRows(rows, { states: new Set(), search: 'ccj-91' }).map((x) => x.rowNo)).toEqual([3, 4]);
    expect(visibleRows(rows, { states: new Set(), search: 'textiles', nameOf })).toHaveLength(4);
    expect(visibleRows(rows, { states: new Set(), search: 'in-2' }).map((x) => x.rowNo)).toEqual([2, 4]);
  });
});

describe('the time filter - by the date a row was entered', () => {
  const day = (d) => periodRange(d.period, d.custom || null, moment(d.on));
  const span = (r) => (r ? [r.from && r.from.format('YYYY-MM-DD HH:mm'), r.to && r.to.format('YYYY-MM-DD HH:mm')] : null);

  test('today, and a week from Monday to Sunday', () => {
    expect(span(day({ period: 'today', on: '2026-10-08T10:00' }))).toEqual(['2026-10-08 00:00', '2026-10-08 23:59']);
    // 8 October 2026 is a Thursday.
    expect(span(day({ period: 'week', on: '2026-10-08T10:00' }))).toEqual(['2026-10-05 00:00', '2026-10-11 23:59']);
  });

  test('a fortnight is the half of the month today is in', () => {
    expect(span(day({ period: 'fortnight', on: '2026-10-08' }))).toEqual(['2026-10-01 00:00', '2026-10-15 23:59']);
    expect(span(day({ period: 'fortnight', on: '2026-10-15' }))).toEqual(['2026-10-01 00:00', '2026-10-15 23:59']);
    expect(span(day({ period: 'fortnight', on: '2026-10-16' }))).toEqual(['2026-10-16 00:00', '2026-10-31 23:59']);
    expect(span(day({ period: 'fortnight', on: '2026-02-20' }))).toEqual(['2026-02-16 00:00', '2026-02-28 23:59']);
  });

  test('a month; All is every date; Custom is the range picked, either end open', () => {
    expect(span(day({ period: 'month', on: '2026-02-10' }))).toEqual(['2026-02-01 00:00', '2026-02-28 23:59']);
    expect(day({ period: 'all', on: '2026-10-08' })).toBeNull();
    expect(span(day({ period: 'custom', on: '2026-10-08', custom: [moment('2026-09-01'), null] })))
      .toEqual(['2026-09-01 00:00', null]);
    expect(day({ period: 'custom', on: '2026-10-08', custom: [null, null] })).toBeNull();
  });

  test('a row in the range is in, either side out; a row not saved yet always in', () => {
    const range = periodRange('today', null, moment('2026-10-08T10:00'));
    expect(inPeriod(saved(1, { createdAt: '2026-10-08T00:00:00' }), range)).toBe(true);
    expect(inPeriod(saved(1, { createdAt: '2026-10-08T23:59:59' }), range)).toBe(true);
    expect(inPeriod(saved(1, { createdAt: '2026-10-07T23:59:59' }), range)).toBe(false);
    expect(inPeriod(saved(1, { createdAt: null }), range)).toBe(false);
    expect(inPeriod(newRow(1), range)).toBe(true);
    expect(inPeriod(saved(1, { createdAt: '2020-01-01' }), null)).toBe(true);
  });

  test('the status tags count only the rows in the period', () => {
    const range = periodRange('today', null, moment('2026-10-08T10:00'));
    const rows = [saved(1, { createdAt: '2026-10-08T09:00:00' }), saved(2, { createdAt: '2026-09-01T09:00:00' })];
    expect(stateCounts(rows, { range }).Pending).toBe(1);
    expect(stateCounts(rows).Pending).toBe(2);
  });
});

describe('with the statuses Configuration > Customs sets', () => {
  const list = [
    { value: 'Pending', label: 'Awaiting Client', color: 'gold', rules: ['shown'], hidden: false },
    { value: 'Docs Ready', label: 'Docs Ready', color: 'cyan', rules: ['start', 'shown'], hidden: false },
    { value: 'Confirmed', label: 'Booked', color: 'green', rules: ['movable'], hidden: false },
  ];

  test('a new row starts at the status the setting says', () => {
    expect(newRow(1, list).status).toBe('Docs Ready');
  });

  test('the counts are by its statuses, a blank one read as where rows start', () => {
    const rows = [saved(1), saved(2, { status: '' }), saved(3, { status: 'Confirmed', CustomsJobId: 4 })];
    expect(stateCounts(rows, { list })).toEqual({ Pending: 1, 'Docs Ready': 1, Confirmed: 0, Moved: 1 });
  });
});

/* THE CONTAINER SECTION - a line per container (the user's request, 2026-10-10). */
describe("a plan's containers", () => {
  const { asContainerNo, containerNoOk, cleanContainers, badContainerNos, blankContainer } = require('functions/programBook');

  test('a number is four letters then seven digits, typed spaces and dashes closed up', () => {
    expect(asContainerNo(' mscu 123456-7 ')).toBe('MSCU1234567');
    expect(containerNoOk('MSCU1234567')).toBe(true);
    expect(containerNoOk('')).toBe(true);
    expect(containerNoOk('MSC1234567')).toBe(false);
    expect(containerNoOk('MSCU123456')).toBe(false);
    expect(badContainerNos({ containerList: [{ containerNo: 'MSCU1234567' }, { containerNo: 'ABCD12' }] })).toEqual(['ABCD12']);
  });

  test('blank lines are dropped; a new line starts with the plan\'s Transport and Size', () => {
    expect(cleanContainers([{ containerNo: '' }, { size: '40hc', containerNo: 'mscu1234567', transporterId: 9 }]))
      .toEqual([{ transporterId: 9, size: '40HC', containerNo: 'MSCU1234567', vehicleDetail: null }]);
    expect(blankContainer({ transporterId: 4, size: '20GP' })).toEqual({ transporterId: 4, size: '20GP', containerNo: '', vehicleDetail: '' });
  });

  test('an older plan kept in the two free-text cells opens as lines - trucks paired when there is one each', () => {
    const row = fromServer({ id: 7, size: '40HC', containers: 'MSKU 1234567, TGHU7654321', vehicleDetail: 'JW-1, JW-2' });
    expect(row.containerList.map((c) => [c.containerNo, c.vehicleDetail, c.size])).toEqual([
      ['MSKU1234567', 'JW-1', '40HC'], ['TGHU7654321', 'JW-2', '40HC'],
    ]);
  });

  test('a change to a line is a change to the row; the same lines are not', () => {
    const original = fromServer({ id: 1, containerList: JSON.stringify([{ containerNo: 'MSCU1234567', size: '40HC' }]) });
    const same = { ...original, containerList: original.containerList.map((c) => ({ ...c })) };
    expect(rowsToSave([same], new Map([[original.key, original]]))).toEqual([]);
    const edited = { ...original, containerList: [{ ...original.containerList[0], vehicleDetail: 'JW-9' }] };
    expect(rowsToSave([edited], new Map([[original.key, original]]))).toHaveLength(1);
  });
});

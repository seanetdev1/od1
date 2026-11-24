/**
 * The Program Book screen - Components/Layouts/CustomsPlans/ProgramBook.
 *
 * Rows typed straight across like the client's sheet, saved without job
 * numbers; the ticked CONFIRMED rows moved to the jobs list; a moved row read
 * only, showing its job. The toolbar is the page's (usePageActions), so the
 * test takes the registered actions and presses them.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { Modal } from 'antd';
import moment from 'moment';
import { getPlans, savePlans, deletePlans, movePlans } from 'apis/customsPlans';
import { getCustomsStatuses } from 'apis/customsStatuses';
import { DEFAULT_STATUSES, resetCustomsStatuses } from 'functions/customsStatuses';
import ProgramBook from '../Components/Layouts/CustomsPlans/ProgramBook';

jest.mock('apis/customsPlans', () => ({
  getPlans: jest.fn(), savePlans: jest.fn(), deletePlans: jest.fn(), movePlans: jest.fn(),
}));
jest.mock('apis/customsStatuses', () => ({ getCustomsStatuses: jest.fn() }));
jest.mock('apis/customsJobs', () => ({
  getCustomsValues: () => Promise.resolve({ status: 'success', result: {
    client: [{ id: 3, name: 'ABC TEX (A1)' }],
    shippingLine: [{ id: 8, name: 'MSC (M1)' }],
    port: [{ id: 'AEJEA', name: 'JEBEL ALI' }],
    vocabulary: { polSea: [{ id: 'MEK', name: 'MCC Export Karachi' }] },
  } }),
}));
const mockDispatch = jest.fn();
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('js-cookie', () => ({ get: (k) => ({ fiscalYearId: '5', loginId: '77' }[k]) }));
jest.mock('Components/Shared/Notification', () => jest.fn());
const mockActions = { current: null };
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: (a) => { mockActions.current = a; } }));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const plan = (id, over = {}) => ({
  id, status: 'Pending', shipperId: 3, invoiceNo: `IN-${id}`, qty: 1, size: '40HC', pol: 'MEK', pod: 'AEJEA',
  shippingLineId: 8, CustomsJobId: null, Customs_Job: null, ...over,
});
const BOOK = [
  plan(1),
  plan(2, { status: 'Confirmed' }),
  plan(3, { status: 'Cancelled' }),
  plan(4, { status: 'Confirmed', CustomsJobId: 90, Customs_Job: { id: 90, jobNo: 'CL-CCJ-91/27' }, vessel: 'MSC AURORA' }),
];

const open = async (rows = BOOK) => {
  getPlans.mockResolvedValue({ status: 'success', result: rows, counts: {} });
  const utils = render(<ProgramBook companyId={1} />);
  await waitFor(() => expect(document.querySelector('.pb-table')).toBeTruthy());
  return utils;
};
const shownRows = () => [...document.querySelectorAll('tbody tr.pb-row')].map((tr) => Number(tr.dataset.row));
const tick = (n) => fireEvent.click(screen.getByLabelText(`Select row ${n}`));
const action = (key) => (key === 'move'
  ? mockActions.current.extras.find((x) => x.key === 'move')
  : mockActions.current[key]);

beforeEach(() => {
  jest.clearAllMocks();
  mockActions.current = null;
  resetCustomsStatuses();
  getCustomsStatuses.mockResolvedValue({ status: 'success', result: DEFAULT_STATUSES });
  window.localStorage.clear();
});

test('opens on the plans still to confirm or move, each keeping its book number', async () => {
  await open();
  expect(shownRows()).toEqual([1, 2]);
  // The other two a tick away, each tag counting its plans.
  fireEvent.click(screen.getByText('Moved'));
  expect(shownRows()).toEqual([1, 2, 4]);
  expect(screen.getByText('Cancelled').closest('.pb-tag').textContent).toBe('Cancelled 1');
});

test('a moved row is read, not edited, and its Job No opens the job', async () => {
  await open();
  fireEvent.click(screen.getByText('Moved'));
  const row = document.querySelector('tr[data-row="4"]');
  expect(row.querySelectorAll('input, textarea')).toHaveLength(1);   // its tick box only
  expect(row.querySelector('input').disabled).toBe(true);
  expect(within(row).getByText('MSC AURORA')).toBeTruthy();
  fireEvent.click(within(row).getByText('CL-CCJ-91/27'));
  expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
    payload: { label: 'CL-CCJ-91/27', key: '11-2', id: 90 },
  }));
});

test('Save sends the rows changed and the rows added, by their numbers', async () => {
  savePlans.mockResolvedValue({ status: 'success', result: { created: 1, updated: 1 } });
  await open();
  expect(action('save').disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Row 1 remarks'), { target: { value: 'call shipper' } });
  act(() => action('new').onClick());
  fireEvent.change(screen.getByLabelText('Row 5 invoiceNo'), { target: { value: 'IN-NEW' } });
  expect(screen.getByText('2 rows not saved yet - Save before moving plans.')).toBeTruthy();
  expect(action('save').disabled).toBe(false);

  await act(async () => { await action('save').onClick(); });
  const { companyId, rows } = savePlans.mock.calls[0][0];
  expect(companyId).toBe(1);
  expect(rows.map((r) => [r.id, r.rowNo, r.remarks, r.invoiceNo])).toEqual([
    [1, 1, 'call shipper', 'IN-1'],
    [undefined, 5, null, 'IN-NEW'],
  ]);
  expect(getPlans).toHaveBeenCalledTimes(2);   // reloaded
});

test('an added row nobody fills is not saved', async () => {
  await open();
  act(() => action('new').onClick());
  expect(shownRows()).toEqual([1, 2, 5]);
  expect(action('save').disabled).toBe(true);
});

test('Move takes only confirmed plans, and not while anything is unsaved', async () => {
  movePlans.mockResolvedValue({ status: 'success', result: [{ planId: 2, jobId: 91, jobNo: 'CL-CCJ-92/27' }] });
  jest.spyOn(Modal, 'confirm').mockImplementation(({ onOk }) => onOk());
  await open();
  expect(action('move').title).toBe('Tick the Confirmed plans to move');

  tick(1);
  expect(action('move').disabled).toBe(true);
  expect(action('move').title).toBe('Only Confirmed plans can be moved - it is Pending - set its Job Status to Confirmed first.');
  tick(1);
  tick(2);
  expect(action('move').disabled).toBe(false);

  fireEvent.change(screen.getByLabelText('Row 1 remarks'), { target: { value: 'x' } });
  expect(action('move').title).toBe('Save your changes first');
  fireEvent.change(screen.getByLabelText('Row 1 remarks'), { target: { value: '' } });

  await act(async () => { await action('move').onClick(); });
  expect(movePlans).toHaveBeenCalledWith({ companyId: 1, ids: [2], fiscalYearId: '5', employeeId: '77' });
  expect(getPlans).toHaveBeenCalledTimes(2);
});

test('Delete drops a new row here and asks the server only for saved ones', async () => {
  deletePlans.mockResolvedValue({ status: 'success', result: { deleted: 1 } });
  await open();
  act(() => action('new').onClick());
  tick(1);
  tick(5);
  expect(action('delete').confirm).toBe('Delete 2 plans?');
  await act(async () => { await action('delete').onClick(); });
  expect(deletePlans).toHaveBeenCalledWith({ companyId: 1, ids: [1] });
});

test('no company picked: says so, and offers nothing to add to', async () => {
  getPlans.mockResolvedValue({ status: 'success', result: [], counts: {}, noCompany: true });
  render(<ProgramBook companyId={null} />);
  expect(await screen.findByText(/Pick your company at the top of the screen/)).toBeTruthy();
});

const tag = (label) => [...document.querySelectorAll('.pb-tag')].find((t) => t.textContent.startsWith(`${label} `));
// Pinned tick, S No, Job No; then Shipper ... Line, Transport, Job Status.
const statusCell = (n) => document.querySelector(`tr[data-row="${n}"]`).querySelectorAll('td')[3 + 8];

test('a moved row shows where its job has got to - its status on the jobs list, not "Moved"', async () => {
  await open([
    plan(1, { status: 'Confirmed', CustomsJobId: 90, Customs_Job: { id: 90, jobNo: 'CL-CCJ-91/27', status: 'Complete' } }),
    plan(2, { status: 'Confirmed', CustomsJobId: 91, Customs_Job: { id: 91, jobNo: 'CL-CCJ-92/27', status: 'Incomplete' } }),
    // Cancel Job's flag wins, as on the jobs list.
    plan(3, { status: 'Confirmed', CustomsJobId: 92, Customs_Job: { id: 92, jobNo: 'CL-CCJ-93/27', status: 'Complete', canceled: true } }),
  ]);
  fireEvent.click(tag('Moved'));
  expect([1, 2, 3].map((n) => statusCell(n).textContent)).toEqual(['On Vessel', 'In Process', 'Canceled']);
  expect(statusCell(1).querySelector('.ant-tag-green')).toBeTruthy();
  expect(statusCell(1).querySelector('.ant-tag').title).toBe('CL-CCJ-91/27 on the jobs list');
});

test('the statuses Configuration > Customs sets: names, the filter, where a row starts, what moves', async () => {
  getCustomsStatuses.mockResolvedValue({ status: 'success', result: {
    job: DEFAULT_STATUSES.job.map((s) => (s.value === 'Complete' ? { ...s, label: 'Sailed' } : s)),
    plan: [
      { value: 'Pending', label: 'Awaiting Client', color: 'gold', rules: ['shown'], hidden: false },
      { value: 'Docs Ready', label: 'Docs Ready', color: 'cyan', rules: ['start', 'shown'], hidden: false },
      { value: 'Confirmed', label: 'Booked', color: 'green', rules: ['movable', 'shown'], hidden: false },
      { value: 'Cancelled', label: 'Lost', color: 'red', rules: ['faded'], hidden: false },
    ],
  } });
  await open([
    plan(1), plan(2, { status: 'Confirmed' }), plan(3, { status: 'Cancelled' }),
    plan(4, { status: 'Confirmed', CustomsJobId: 90, Customs_Job: { id: 90, jobNo: 'CL-CCJ-91/27', status: 'Complete' } }),
  ]);
  await waitFor(() => expect(tag('Awaiting Client')).toBeTruthy());
  expect([...document.querySelectorAll('.pb-tag')].map((t) => t.textContent))
    .toEqual(['Awaiting Client 1', 'Docs Ready 0', 'Booked 1', 'Lost 1', 'Moved 1']);
  // Opens on the statuses the setting shows on opening.
  expect(shownRows()).toEqual([1, 2]);
  expect(statusCell(2).textContent).toBe('Booked');
  // A new row starts where the setting says.
  act(() => action('new').onClick());
  expect(statusCell(5).textContent).toBe('Docs Ready');
  // Booked moves; Awaiting Client does not, and says what would.
  tick(1);
  expect(action('move').title).toBe('Only Booked plans can be moved - it is Awaiting Client - set its Job Status to Booked first.');
  // A closed status is faded; a moved row names its job's status by the job list's names.
  fireEvent.click(tag('Lost'));
  fireEvent.click(tag('Moved'));
  expect(document.querySelector('tr[data-row="3"]').className).toContain('pb-faded');
  expect(statusCell(4).textContent).toBe('Sailed');
});

test('the time filter: by the date each row was entered, remembered', async () => {
  await open([
    plan(1, { createdAt: moment().toISOString() }),
    plan(2, { createdAt: moment().subtract(1, 'year').toISOString() }),
  ]);
  expect(shownRows()).toEqual([1, 2]);   // All, to begin with
  fireEvent.click(screen.getByText('Today'));
  expect(shownRows()).toEqual([1]);
  expect(tag('Pending').textContent).toBe('Pending 1');
  expect(window.localStorage.getItem('odyssey.programBook.period')).toBe('today');
  // A row added now is always shown, whatever the period.
  act(() => action('new').onClick());
  expect(shownRows()).toEqual([1, 3]);
  fireEvent.click(screen.getByText('All'));
  expect(shownRows()).toEqual([1, 2, 3]);
  fireEvent.click(screen.getByText('Custom'));
  expect(screen.getByLabelText('Entered between')).toBeTruthy();
});

describe('live updates', () => {
  const live = () => mockActions.current.extras.find((x) => x.key === 'live');
  const minute = () => act(async () => { jest.advanceTimersByTime(60 * 1000); });

  beforeEach(() => {
    window.localStorage.clear();
    jest.useFakeTimers();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('off to begin with: a toggle in the toolbar, and nothing reloads', async () => {
    await open();
    expect(live()).toMatchObject({ pressed: false, label: 'Live updates off' });
    await minute();
    expect(getPlans).toHaveBeenCalledTimes(1);
  });

  test('on: reloads now and every minute after, quietly, and is remembered', async () => {
    await open();
    await act(async () => { live().onClick(); });
    expect(live()).toMatchObject({ pressed: true, label: 'Live updates on' });
    expect(window.localStorage.getItem('odyssey.programBook.live')).toBe('on');
    expect(getPlans).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toMatch(/^Live - updated \d\d:\d\d$/);

    // A plan another desk confirmed meanwhile comes in - with no spinner.
    getPlans.mockResolvedValue({ status: 'success', result: [...BOOK, plan(5, { status: 'Confirmed' })], counts: {} });
    await minute();
    expect(getPlans).toHaveBeenCalledTimes(3);
    expect(shownRows()).toEqual([1, 2, 5]);
    expect(document.querySelector('.pb-loading')).toBeNull();
  });

  test('opens on, where this browser left it on', async () => {
    window.localStorage.setItem('odyssey.programBook.live', 'on');
    await open();
    await waitFor(() => expect(live().pressed).toBe(true));
    await minute();
    expect(getPlans).toHaveBeenCalledTimes(2);
  });

  test('never overwrites what is being typed: paused while there are unsaved changes', async () => {
    window.localStorage.setItem('odyssey.programBook.live', 'on');
    await open();
    await waitFor(() => expect(live().pressed).toBe(true));
    fireEvent.change(screen.getByLabelText('Row 1 remarks'), { target: { value: 'call shipper' } });
    expect(screen.getByRole('status').textContent).toBe('Live - paused until you save');
    await minute();
    await minute();
    expect(getPlans).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Row 1 remarks').value).toBe('call shipper');
  });

  test('a reply that lands after typing began is dropped', async () => {
    window.localStorage.setItem('odyssey.programBook.live', 'on');
    await open();
    await waitFor(() => expect(live().pressed).toBe(true));
    let answer;
    getPlans.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    await minute();
    fireEvent.change(screen.getByLabelText('Row 1 remarks'), { target: { value: 'typed meanwhile' } });
    await act(async () => { answer({ status: 'success', result: BOOK, counts: {} }); });
    expect(screen.getByLabelText('Row 1 remarks').value).toBe('typed meanwhile');
  });

  test('keeps the ticks, and a new row nobody has filled yet', async () => {
    window.localStorage.setItem('odyssey.programBook.live', 'on');
    await open();
    await waitFor(() => expect(live().pressed).toBe(true));
    tick(2);
    act(() => mockActions.current.new.onClick());
    await minute();
    expect(getPlans).toHaveBeenCalledTimes(2);
    expect(shownRows()).toEqual([1, 2, 5]);
    expect(screen.getByLabelText('Select row 2').checked).toBe(true);
  });

  test('a failed reload says so quietly, and tries again next minute', async () => {
    window.localStorage.setItem('odyssey.programBook.live', 'on');
    await open();
    await waitFor(() => expect(live().pressed).toBe(true));
    getPlans.mockRejectedValue(new Error('offline'));
    await minute();
    expect(screen.getByRole('status').textContent).toMatch(/^Live - could not update/);
    getPlans.mockResolvedValue({ status: 'success', result: BOOK, counts: {} });
    await minute();
    expect(screen.getByRole('status').textContent).toMatch(/^Live - updated/);
  });
});

/* THE CONTAINER SECTION (the user's request, 2026-10-10): each row opens to a
   line per container - transporter, size, number, vehicle. A number is four
   letters then seven digits; a wrong one is marked and stops Save. */
test("a row's containers: opened from its count, added to, and checked before Save", async () => {
  await open([plan(1, { containerList: JSON.stringify([{ containerNo: 'MSCU1234567', size: '40HC', vehicleDetail: 'JW-1234' }]) })]);
  const row = document.querySelector('tr[data-row="1"]');
  fireEvent.click(within(row).getByText(/1 container/));
  expect(screen.getByLabelText('Row 1 container 1 number').value).toBe('MSCU1234567');
  expect(screen.getByLabelText('Row 1 container 1 vehicle').value).toBe('JW-1234');

  // A new line starts at the row's size; a short number is marked and refused.
  fireEvent.click(screen.getByText('+ Add container'));
  expect(document.querySelector('input[aria-label="Row 1 container 2 size"]').value).toBe('40HC');
  fireEvent.change(screen.getByLabelText('Row 1 container 2 number'), { target: { value: 'msc123' } });
  expect(screen.getByLabelText('Row 1 container 2 number').closest('.ant-input-status-error')
    || screen.getByLabelText('Row 1 container 2 number').className).toBeTruthy();
  await act(async () => { await action('save').onClick(); });
  expect(savePlans).not.toHaveBeenCalled();

  // Corrected, it goes - the section's lines, closed up and in capitals.
  fireEvent.change(screen.getByLabelText('Row 1 container 2 number'), { target: { value: 'mscu 765432-1' } });
  savePlans.mockResolvedValue({ status: 'success', result: { created: 0, updated: 1 } });
  await act(async () => { await action('save').onClick(); });
  const [[{ rows: sent }]] = savePlans.mock.calls;
  expect(sent[0].containerList).toEqual([
    { transporterId: null, size: '40HC', containerNo: 'MSCU1234567', vehicleDetail: 'JW-1234' },
    { transporterId: null, size: '40HC', containerNo: 'MSCU7654321', vehicleDetail: null },
  ]);
});

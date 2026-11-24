/**
 * The customs job list - Components/Layouts/CustomsJobs/List. Pins the
 * Invoices and Bills columns: how many of each a job's charges are on, as the
 * server counts them (routes/customsJobs /get).
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, within, waitFor } from '@testing-library/react';
import List from '../Components/Layouts/CustomsJobs/List';
import { getCustomsStatuses } from 'apis/customsStatuses';
import { DEFAULT_STATUSES, resetCustomsStatuses } from 'functions/customsStatuses';

jest.mock('apis/customsStatuses', () => ({ getCustomsStatuses: jest.fn() }));
beforeEach(() => {
  resetCustomsStatuses();
  getCustomsStatuses.mockResolvedValue({ status: 'success', result: DEFAULT_STATUSES });
});

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: (x) => x }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('apis/customsJobs', () => ({
  getCustomsJobs: jest.fn().mockResolvedValue({
    result: [
      { id: 1, jobNo: 'TP-2640/27', status: 'Complete', invoiceCount: 2, billCount: 1 },
      { id: 2, jobNo: 'TP-2641/27', status: 'Incomplete', invoiceCount: 0, billCount: 0 },
    ],
    count: 2,
    counts: { Complete: 1, Incomplete: 1 },
  }),
}));

// antd's responsive table asks for it; jsdom has none. As ChargesPagination.
beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const cellsOf = (jobNo) => within(screen.getByText(jobNo).closest('tr')).getAllByRole('cell').map((c) => c.textContent);
const column = (title) => screen.getAllByRole('columnheader').findIndex((h) => h.textContent === title);

test('each job shows how many invoices and bills it is on', async () => {
  render(<List companyId='1' />);
  await screen.findByText('TP-2640/27');

  const inv = column('Invoices');
  const bills = column('Bills');
  expect(inv).toBeGreaterThan(-1);
  expect(bills).toBeGreaterThan(-1);

  expect(cellsOf('TP-2640/27')[inv]).toBe('2');
  expect(cellsOf('TP-2640/27')[bills]).toBe('1');
  // None yet reads as a dash, not a 0.
  expect(cellsOf('TP-2641/27')[inv]).toBe('-');
  expect(cellsOf('TP-2641/27')[bills]).toBe('-');
});

// STRICT: no company picked, no jobs - see functions/selectedCompany.
test('with no company picked it lists nothing, says why, and asks the server for nothing', async () => {
  const { getCustomsJobs } = require('apis/customsJobs');
  getCustomsJobs.mockClear();
  render(<List companyId='' />);
  expect(await screen.findByText(/No company selected/)).toBeTruthy();
  expect(screen.getByText(/Pick your company at the top of the screen/)).toBeTruthy();
  expect(getCustomsJobs).not.toHaveBeenCalled();
});

test('statuses by Configuration > Customs: their names and colours, a retired one only while jobs are at it', async () => {
  getCustomsStatuses.mockResolvedValue({ status: 'success', result: {
    job: [
      { value: 'Incomplete', label: 'Under Clearance', color: 'cyan', rules: ['start'], hidden: false },
      { value: 'Complete', label: 'Sailed', color: 'green', rules: ['billable', 'finished'], hidden: false },
      { value: 'DrayOff', label: 'DrayOff', color: 'purple', rules: ['billable', 'finished'], hidden: true },
      { value: 'Canceled', label: 'Canceled', color: 'red', rules: ['finished'], hidden: false },
    ],
    plan: DEFAULT_STATUSES.plan,
  } });
  render(<List companyId='1' />);
  await screen.findByText('TP-2640/27');
  await waitFor(() => expect(within(screen.getByText('TP-2640/27').closest('tr')).getByText('Sailed')).toBeTruthy());
  expect(within(screen.getByText('TP-2641/27').closest('tr')).getByText('Under Clearance').className).toContain('ant-tag-cyan');
  const tags = [...document.querySelectorAll('.status-filter .filter-tag')].map((t) => t.textContent);
  // DrayOff is retired and no job is at it: no tag.
  expect(tags).toEqual(['Under Clearance 1', 'Sailed 1', 'Canceled 0']);
});

/* A TIME PERIOD on the list, by job date, as Payments & Receipts has (the
   user, 2026-11-14) - All until another is picked, so it opens as before. */
describe('the time period', () => {
  const { fireEvent } = require('@testing-library/react');
  const lastQuery = () => {
    const { getCustomsJobs } = require('apis/customsJobs');
    return getCustomsJobs.mock.calls.at(-1)[0];
  };

  test('opens on All - every job date, no period asked for', async () => {
    render(<List companyId='1' />);
    await screen.findByText('TP-2640/27');
    expect(lastQuery().period).toBeUndefined();
    expect(screen.getByTestId('period-range').textContent).toBe('Every job date');
  });

  test('a named period is asked of the server, which says the dates it came to', async () => {
    const { getCustomsJobs } = require('apis/customsJobs');
    render(<List companyId='1' />);
    await screen.findByText('TP-2640/27');
    getCustomsJobs.mockResolvedValueOnce({
      result: [], count: 0, counts: {}, period: { from: '2026-11-01', to: '2026-11-30', period: 'month' },
    });
    fireEvent.click(screen.getByText('Month'));
    await waitFor(() => expect(lastQuery()).toMatchObject({ period: 'month', page: 1 }));
    await waitFor(() => expect(screen.getByTestId('period-range').textContent).toBe('Job date 01-11-2026 to 30-11-2026'));
  });

  test('Custom waits for both dates and Apply', async () => {
    render(<List companyId='1' />);
    await screen.findByText('TP-2640/27');
    const { getCustomsJobs } = require('apis/customsJobs');
    fireEvent.click(screen.getByText('Custom'));
    await waitFor(() => expect(screen.getByText('Apply')).toBeDisabled());
    const calls = getCustomsJobs.mock.calls.length;
    // Nothing asked for while the dates are not in.
    expect(lastQuery().period).toBeUndefined();
    expect(getCustomsJobs.mock.calls.length).toBe(calls);
  });

  test('the search box names everything it looks in', async () => {
    render(<List companyId='1' />);
    await screen.findByText('TP-2640/27');
    expect(screen.getByPlaceholderText(/S\/R Page, Client Invoice, Container or Job No\./)).toBeTruthy();
  });
});

/* The S/R Page # (under the install's name for it) and the Client Invoice #
   as columns (the user, 2026-11-14). */
test('shows each job\'s S/R Page # and Client Invoice #', async () => {
  const { getCustomsJobs } = require('apis/customsJobs');
  getCustomsJobs.mockResolvedValueOnce({
    result: [
      { id: 7, jobNo: 'ESS-CC-7/27', status: 'Incomplete', jobRef: 'F-881', invoiceNo: 'CI-77-WHOLE', clientRef: 'CI-77' },
      { id: 8, jobNo: 'ESS-CC-8/27', status: 'Incomplete', jobRef: '', clientRef: 'ONLY-REF' },
    ],
    count: 2,
    counts: { Incomplete: 2 },
  });
  render(<List companyId='1' />);
  await screen.findByText('ESS-CC-7/27');
  const sr = column('S/R Page #');
  const ci = column('Client Invoice #');
  expect(sr).toBeGreaterThan(-1);
  expect(ci).toBeGreaterThan(-1);
  expect(cellsOf('ESS-CC-7/27')[sr]).toBe('F-881');
  // The whole number where both columns hold one, else the one there is.
  expect(cellsOf('ESS-CC-7/27')[ci]).toBe('CI-77-WHOLE');
  expect(cellsOf('ESS-CC-8/27')[ci]).toBe('ONLY-REF');
  expect(cellsOf('ESS-CC-8/27')[sr]).toBe('-');
});

// No B/L - AWB or Channel columns (the user, 2026-11-14).
test('has no B/L - AWB or Channel column', async () => {
  render(<List companyId='1' />);
  await screen.findByText('TP-2640/27');
  expect(column('B/L - AWB')).toBe(-1);
  expect(column('Channel')).toBe(-1);
});

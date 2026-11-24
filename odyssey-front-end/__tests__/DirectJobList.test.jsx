/**
 * Accounts > Direct Job E/R list. CargoLinkers (2026-11-12): 13k pages and
 * ~30 s to open. Part of that was this screen: it fetched the whole chart of
 * accounts on every page change and every keystroke, only to name ten
 * accounts, and searched once per letter typed. The server now sends each
 * entry's accountTitle; this pins that the screen uses it and asks for one
 * page per change.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axiosClient from 'apis/axiosClient';
import DirectJobList from '../Components/Layouts/AccountsComp/directJob/list';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());

const entry = {
  id: 7, Entry_No: 'CL-JER-513/26', Account_No: 42, accountTitle: 'AZEEM NEW IOU',
  Currency: 'PKR', Reference_No: 'REF-1', Tran_Mode: 'Cash', Job_Type: 'multiple',
  Type: 'expense', Operation: 'logistics', Cheque_No: null, Cheque_Date: null,
  createdAt: '2026-10-08T00:00:00.000Z',
  Associations: [
    { id: 1, Job_No: 'CL-CCJ-9/27', Amount: '1000.00', Voucher: { voucher_Id: 'CPV-1/27', tranDate: '2026-10-08', createdBy: 'Saim' } },
    { id: 2, Job_No: 'CL-CCJ-10/27', Amount: '500.00', Voucher: { voucher_Id: 'CPV-1/27', tranDate: '2026-10-08', createdBy: 'Saim' } },
  ],
};

const listCalls = () => axiosClient.get.mock.calls.filter(([url]) => String(url).includes('getDirectJobList'));

beforeAll(() => {
  // antd's grid asks for breakpoints; jsdom has no matchMedia.
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

beforeEach(() => {
  axiosClient.get.mockReset();
  axiosClient.get.mockResolvedValue({ data: { status: 'success', total: 1, result: [entry] } });
});

test("names the account from the entry, without loading the chart of accounts", async () => {
  render(<DirectJobList />);
  await screen.findByText('AZEEM NEW IOU');
  expect(screen.getByText('CL-JER-513/26')).toBeTruthy();
  expect(screen.getByText('1,500.00')).toBeTruthy();
  expect(axiosClient.get).toHaveBeenCalledTimes(1);
  expect(listCalls()).toHaveLength(1);
});

test("shows who made a migrated entry by name, not Climax's whole add log", async () => {
  const migrated = { ...entry, id: 8, Associations: entry.Associations.map((a) => ({
    ...a, Voucher: { ...a.Voucher, createdBy: 'DIRECTOR 1 # 192.168.50.213:51582' },
  })) };
  axiosClient.get.mockResolvedValue({ data: { status: 'success', total: 1, result: [migrated] } });
  render(<DirectJobList />);
  expect(await screen.findByText('DIRECTOR 1')).toBeTruthy();
  expect(screen.queryByText(/192\.168\.50\.213/)).toBeNull();
});

test('searches once typing pauses, from page 1, not once per letter', async () => {
  render(<DirectJobList />);
  await screen.findByText('AZEEM NEW IOU');
  const box = screen.getByPlaceholderText('Search entries…');
  for (const text of ['J', 'JE', 'JER', 'JER-5']) fireEvent.change(box, { target: { value: text } });

  await waitFor(() => expect(listCalls()).toHaveLength(2));
  expect(listCalls()[1][1].params).toEqual({ page: 1, pageSize: 25, search: 'JER-5' });
  await new Promise((r) => setTimeout(r, 400));
  expect(listCalls()).toHaveLength(2);
});

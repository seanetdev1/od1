/**
 * The customs job list's columns are picked (the user, 2026-11-20) -
 * functions/customsJobListColumns and the list's Columns button.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axiosClient from 'apis/axiosClient';
import { getCustomsStatuses } from 'apis/customsStatuses';
import { DEFAULT_STATUSES, resetCustomsStatuses } from 'functions/customsStatuses';
import {
  CUSTOMS_JOB_LIST_BUILT_IN, CUSTOMS_JOB_LIST_PICKS_KEY, customsJobListDefaults, customsJobListShown, customsJobListOrder,
} from '../functions/customsJobListColumns';
import List from '../Components/Layouts/CustomsJobs/List';

jest.mock('apis/axiosClient', () => ({ get: jest.fn() }));
jest.mock('apis/customsStatuses', () => ({ getCustomsStatuses: jest.fn() }));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: (x) => x }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('apis/customsJobs', () => ({
  getCustomsJobs: jest.fn().mockResolvedValue({
    result: [{
      id: 1, jobNo: 'TP-2640/27', status: 'Complete', channel: 'Green', blNo: 'MSKU123',
      shipper: { id: 7, name: 'ALPHA TEXTILES' }, consignee: { id: 8, name: 'BETA IMPORTS' },
      chaChb: { id: 9, name: 'GAMMA FORWARDERS' }, shippingLine: null, transporter: null,
      Commodity: { id: 3, name: 'COTTON YARN' },
    }],
    count: 1, counts: { Complete: 1 },
  }),
}));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});
let configured = null;
beforeEach(() => {
  resetCustomsStatuses();
  getCustomsStatuses.mockResolvedValue({ status: 'success', result: DEFAULT_STATUSES });
  axiosClient.get.mockImplementation((url) => Promise.resolve({ data: { status: 'success', result: /reportColumns/.test(url) ? configured : {} } }));
  window.localStorage.clear();
  configured = null;
});

const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent);

describe('the rules', () => {
  test('the built-in set is the twelve the list always had', () => {
    expect(CUSTOMS_JOB_LIST_BUILT_IN).toHaveLength(12);
    expect(customsJobListDefaults(null)).toEqual(CUSTOMS_JOB_LIST_BUILT_IN);
  });
  test("Configuration's set wins, in its order; unknown ids are dropped", () => {
    expect(customsJobListDefaults(['status', 'channel', 'nonsense', 'jobNo'])).toEqual(['status', 'channel', 'jobNo']);
  });
  test('ticked columns show in picker order, and never none', () => {
    const defaults = ['jobNo', 'status'];
    expect(customsJobListShown(defaults, ['blNo', 'status', 'jobNo'])).toEqual(['jobNo', 'status', 'blNo']);
    expect(customsJobListShown(defaults, [])).toEqual(defaults);
    expect(customsJobListOrder(defaults).slice(0, 2)).toEqual(['jobNo', 'status']);
  });
});

describe('the Columns button', () => {
  test('ticking a column shows it, and the pick is kept in this browser', async () => {
    render(<List companyId='1' />);
    await screen.findByText('TP-2640/27');
    expect(headers()).not.toContain('Channel');

    fireEvent.click(screen.getByText('Columns (12)'));
    fireEvent.click(await screen.findByText('Channel'));
    await waitFor(() => expect(headers()).toContain('Channel'));
    expect(screen.getByText('Green')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(CUSTOMS_JOB_LIST_PICKS_KEY))).toContain('channel');
  });

  test('the other parties and the commodity can be ticked on (the user, 2026-11-20)', async () => {
    window.localStorage.setItem(CUSTOMS_JOB_LIST_PICKS_KEY,
      JSON.stringify(['jobNo', 'shipper', 'consignee', 'forwarder', 'shippingLine', 'commodity']));
    render(<List companyId='1' />);
    await screen.findByText('TP-2640/27');
    expect(headers()).toEqual(['Job No.', 'Shipper', 'Consignee', 'Shipping Line', 'Freight Forwarder', 'Commodity']);
    for (const name of ['ALPHA TEXTILES', 'BETA IMPORTS', 'GAMMA FORWARDERS', 'COTTON YARN']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  test('opens on the columns Configuration saved', async () => {
    configured = ['jobNo', 'blNo', 'status'];
    render(<List companyId='1' />);
    await screen.findByText('TP-2640/27');
    await waitFor(() => expect(headers()).toEqual(['Job No.', 'B/L - AWB No.', 'Status']));
  });
});

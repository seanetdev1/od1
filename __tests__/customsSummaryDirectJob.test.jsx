/**
 * A customs job's charge Summary and Accounts > Direct Job E / R (asked
 * 2026-11-17): each Direct Job entry it names opens that entry, and Add
 * Direct E/R starts a new one already on this job - its number, and its
 * S/R Page # as the File #.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import axiosClient from 'apis/axiosClient';
import Router from 'next/router';

const dispatch = jest.fn();
jest.mock('react-redux', () => ({ useDispatch: () => dispatch, useSelector: () => null }));
jest.mock('next/router', () => ({ push: jest.fn(() => Promise.resolve()) }));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn(() => Promise.resolve({ data: { status: 'success', result: [] } })), post: jest.fn() }));
jest.mock('apis/customsJobs', () => ({ getCustomsChargeSummary: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
let rights = () => true;
jest.mock('functions/myPermissions', () => ({ useMyPermissions: () => (m, a) => rights(m, a) }));
jest.mock('functions/customsStatuses', () => {
  const real = jest.requireActual('functions/customsStatuses');
  return { ...real, useCustomsStatuses: () => real.DEFAULT_STATUSES };
});

// eslint-disable-next-line import/first
import { getCustomsChargeSummary } from 'apis/customsJobs';
// eslint-disable-next-line import/first
import Charges from '../Components/Layouts/CustomsJobs/Charges';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

const SUMMARY = {
  rows: [{ charge: '5', name: 'WEBOC TOKEN', fromCharges: 0, fromDirect: 1, totalCost: 1500, realizedCost: 1500 }],
  totals: { totalCost: 1500, realizedCost: 1500 },
  directEntries: ['CL-DE-4/27', 'CL-DE-9/27'],
  directEntryRefs: [
    { id: 4, entryNo: 'CL-DE-4/27', type: 'expense' },
    { id: 9, entryNo: 'CL-DE-9/27', type: 'revenue' },
  ],
  // One head with both entries - each named beside the charge.
  directLines: [
    { id: 41, charge: '5', type: 'expense', entryNo: 'CL-DE-4/27', description: '', basis: null, quantity: 1, currency: 'PKR', exRate: 1, amount: 1000 },
    { id: 91, charge: '5', type: 'revenue', entryNo: 'CL-DE-9/27', description: '', basis: null, quantity: 1, currency: 'PKR', exRate: 1, amount: 500 },
  ],
};

const open = async ({ summary = SUMMARY, jobId = '31' } = {}) => {
  getCustomsChargeSummary.mockResolvedValue({ status: 'success', result: summary });
  await act(async () => {
    render(
      <Charges job={{ jobNo: 'CL-CCJ-31/27', jobRef: 'SR-1726', clientId: 3 }} jobId={jobId}
        charges={[]} setCharges={() => {}} values={{ charge: [], party: [] }} disabled={false}
        onInvoice={() => {}} invoicing={false} onInvoiceApproval={() => {}} approvingInvoices={false} active />
    );
  });
};

const actions = () => dispatch.mock.calls.map(([a]) => a);

beforeEach(() => {
  jest.clearAllMocks();
  rights = () => true;
});

test('each entry number opens its Direct Job entry, in the Direct Job tab', async () => {
  await open();
  fireEvent.click(screen.getByText('CL-DE-9/27'));
  expect(actions()).toContainEqual(expect.objectContaining({
    payload: expect.objectContaining({ key: '3-15', id: 9 }),
  }));
  expect(Router.push).toHaveBeenCalledWith('/accounts/directJob/9');
});

test('Add Direct E/R opens a new entry already on this job, with the File # the Direct Job screen would fill', async () => {
  // The Direct Job screen's own exact lookup decides the File # - on Essani the
  // S/R Page # (Configuration > Customs > Job Screen).
  axiosClient.get.mockImplementation((url, config) => Promise.resolve({ data: /getDirectJobNumbers/.test(url)
    ? { status: 'success', data: [{ id: 31, jobNo: 'CL-CCJ-31/27', fileNo: 'SR-1726' }] }
    : { status: 'success', result: [] } }));
  await open();
  fireEvent.click(screen.getByText('Add Direct E/R +'));
  await waitFor(() => expect(Router.push).toHaveBeenCalledWith('/accounts/directJob/new'));
  expect(axiosClient.get).toHaveBeenCalledWith(expect.stringMatching(/getDirectJobNumbers/), { params: expect.objectContaining({ search: 'CL-CCJ-31/27', exact: 1 }) });

  const sent = actions();
  const reset = sent.findIndex((a) => /resetDirectJob/.test(a.type));
  expect(reset).toBeGreaterThanOrEqual(0);
  // The first line's job, set after the reset.
  const line = sent.slice(reset).filter((a) => /updateDirectJobItem/.test(a.type)).map((a) => a.payload);
  expect(line).toEqual(expect.arrayContaining([
    { index: 0, field: 'JobId', value: 31 },
    { index: 0, field: 'JobNumber', value: 'CL-CCJ-31/27' },
    { index: 0, field: 'FileNumber', value: 'SR-1726' },
  ]));
  expect(sent).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ key: '3-15', id: 'new' }) }));
  expect(Router.push).toHaveBeenCalledWith('/accounts/directJob/new');
});

test('without Direct Job rights: the numbers are plain text and there is no Add', async () => {
  rights = (m) => m !== 'directJob';
  await open();
  fireEvent.click(screen.getByText(/CL-DE-9\/27/));
  expect(Router.push).not.toHaveBeenCalled();
  expect(screen.queryByText('Add Direct E/R +')).toBeNull();
});

test('a server from before the ids still lists the numbers, unlinked', async () => {
  const { directEntryRefs, ...older } = SUMMARY;
  await open({ summary: older });
  expect(screen.getByText(/CL-DE-4\/27, CL-DE-9\/27/)).toBeTruthy();
  fireEvent.click(screen.getByText(/CL-DE-4\/27/));
  expect(Router.push).not.toHaveBeenCalled();
});

test('a job not yet saved has no Add Direct E/R - there is no job to put it on', async () => {
  await open({ jobId: 'new' });
  expect(screen.queryByText('Add Direct E/R +')).toBeNull();
});

/* EACH ROW NAMES ITS OWN ENTRIES, beside the charge (the user, 2026-11-20) -
 * and a line booked with no charge head says so instead of a bare "#". */
const PER_ROW = {
  rows: [
    { charge: '5', name: 'WEBOC TOKEN CHARGES', fromCharges: 0, fromDirect: 1, totalCost: 500, realizedCost: 500 },
    { charge: '', name: null, fromCharges: 0, fromDirect: 1, totalCost: 1500, realizedCost: 1500 },
  ],
  totals: { totalCost: 2000, realizedCost: 2000 },
  directEntries: ['DE-1/27', 'DE-18/27'],
  directEntryRefs: [
    { id: 1, entryNo: 'DE-1/27', type: 'expense' },
    { id: 18, entryNo: 'DE-18/27', type: 'expense' },
  ],
  directLines: [
    { id: 11, charge: '5', type: 'expense', entryNo: 'DE-1/27', description: '', basis: null, quantity: 1, currency: 'PKR', exRate: 1, amount: 500 },
    { id: 12, charge: null, type: 'expense', entryNo: 'DE-18/27', description: '', basis: null, quantity: 1, currency: 'PKR', exRate: 1, amount: 1500 },
  ],
};

test("each row names its own Direct Job entry beside the charge, and it opens the entry", async () => {
  await open({ summary: PER_ROW });
  expect(screen.getByText('Direct Job #')).toBeTruthy();
  const weboc = screen.getByText('WEBOC TOKEN CHARGES').closest('tr');
  expect(within(weboc).getByText('DE-1/27')).toBeTruthy();
  expect(within(weboc).queryByText('DE-18/27')).toBeNull();

  const noHead = screen.getByText('No charge head').closest('tr');
  expect(within(noHead).getByText('DE-18/27')).toBeTruthy();
  expect(within(noHead).queryByText('DE-1/27')).toBeNull();
  expect(screen.queryByText('#')).toBeNull();

  fireEvent.click(within(noHead).getByText('DE-18/27'));
  expect(Router.push).toHaveBeenCalledWith('/accounts/directJob/18');
  // The note that listed them all under the table is gone (the user, 2026-11-20).
  expect(screen.queryByText(/counted here/)).toBeNull();
});

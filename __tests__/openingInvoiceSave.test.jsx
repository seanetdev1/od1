/**
 * Saving an opening invoice (2026-11-16). An edit REPLACES it: the new one is
 * made first and the old one removed only once it is saved - it was deleted
 * first, unawaited, so a refused save left nothing. Its amount loads to the
 * paisa (parseInt kept the rupees). A new one saves with its date untouched
 * (the store's default date is text, and the save called toISOString on it).
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import openingInvoice from '../redux/openingInvoices/openingInvoicesSlice';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import OpeningInvoice from '../Components/Layouts/AccountsComp/OpeningInvoices/OpeningInvoice';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
// The toolbar's Save, as the screen registers it.
let toolbar = {};
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: (actions) => { toolbar = actions || {}; } }));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

const saved = {
  result: {
    partyType: 'client', payType: 'Recievable', operation: 'SE', currency: 'PKR', ex_rate: 1,
    party_Id: 900, total: '1234.56', date: '2026-06-30T00:00:00Z',
  },
  voucher: { Voucher_Heads: [{ accountType: 'payAccount', ChildAccountId: 7 }] },
};
const parties = [{ name: 'ACME TRADERS', code: '101', Client_Associations: [{ ChildAccountId: 900 }] }];

beforeEach(() => {
  jest.clearAllMocks();
  axiosClient.get.mockImplementation((url) => Promise.resolve({ data: {
    status: 'success',
    result: String(url).includes('getOpeningInvoice') ? saved : String(url).includes('getPartiesbyType') ? parties : [],
  } }));
});

const open = async (id) => {
  const store = configureStore({ reducer: { openingInvoice }, middleware: (d) => d({ serializableCheck: false }) });
  // As the page passes it: its own props, { id }.
  await act(async () => { render(<Provider store={store}><OpeningInvoice id={{ id }} /></Provider>); });
  return store;
};
const posted = () => axiosClient.post.mock.calls.map(([url]) => String(url).split('/').pop());

test('an opening invoice loads to the paisa', async () => {
  const store = await open('55');
  expect(store.getState().openingInvoice.total).toBe(1234.56);
});

test('saving an edit makes the new one, THEN removes the old', async () => {
  await open('55');
  axiosClient.post.mockImplementation((url) => Promise.resolve({ data: { status: 'success', result: {} } }));
  await act(async () => { await toolbar.save.onClick(); });
  expect(posted()).toEqual(['openingInvoice', 'deleteOpeningInvoices']);
  expect(axiosClient.post.mock.calls[0][1]).toMatchObject({ amount: 1234.56, party_Name: 'ACME TRADERS' });
  expect(axiosClient.post.mock.calls[1][1]).toMatchObject({ headers: { id: '55' } });
});

test('a refused save leaves the old one where it is', async () => {
  await open('55');
  axiosClient.post.mockResolvedValue({ data: { status: 'error', result: 'Fiscal year locked' } });
  await act(async () => { await toolbar.save.onClick(); });
  expect(posted()).toEqual(['openingInvoice']);
  expect(openNotification).toHaveBeenCalledWith('Error', 'Fiscal year locked', 'red');
});

test('a bad exchange rate is refused before anything is sent - or deleted', async () => {
  const store = await open('55');
  await act(async () => {
    store.dispatch({ type: 'ledger/setField', payload: { field: 'currency', value: 'USD' } });
    store.dispatch({ type: 'ledger/setField', payload: { field: 'ex_rate', value: 1 } });
  });
  await act(async () => { await toolbar.save.onClick(); });
  expect(axiosClient.post).not.toHaveBeenCalled();
  expect(openNotification).toHaveBeenCalledWith('Error', 'Invalid Exchange Rate', 'red');
});

test('a new one saves with its date untouched, and nothing is deleted', async () => {
  await open('new');
  axiosClient.post.mockResolvedValue({ data: { status: 'success', result: {} } });
  await act(async () => { await toolbar.save.onClick(); });
  expect(posted()).toEqual(['openingInvoice']);
  expect(axiosClient.post.mock.calls[0][1].date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test('the old one not removed: saved, and said so', async () => {
  await open('55');
  axiosClient.post.mockImplementation((url) => Promise.resolve({ data: {
    status: String(url).includes('deleteOpeningInvoices') ? 'error' : 'success', result: {},
  } }));
  await act(async () => { await toolbar.save.onClick(); });
  expect(openNotification).toHaveBeenCalledWith('Saved - check the list', expect.stringMatching(/could not be removed/), 'orange');
});

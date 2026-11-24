/**
 * Accounts > Direct Job E/R - which entry a Save writes to.
 *
 * Reported 2026-11-12: a user edited an entry's amount and got a NEW voucher
 * instead of the entry's own one changing. The server's edit is right
 * (tests/integration/directJob.test.js, "editing an entry's amount"): sent the
 * entry's id it rewrites the same voucher. The screen did not always send it.
 *
 * After a NEW entry was saved the screen moved to /accounts/directJob/<id> but
 * left its tab saying id 'new'. Back on that tab later, the tab opened
 * /accounts/directJob/new - with the saved entry still in the form, since
 * nothing clears it there - and Save, deciding by the address alone, sent no
 * id: the server created a second entry with a voucher of its own, and the
 * screen said "Direct Job Updated".
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import axiosClient from 'apis/axiosClient';
import directJobReducer from 'redux/directJob/directJobSlice';
import tabsReducer from 'redux/tabs/tabSlice';
import { usePageActions } from 'Components/Shared/PageActions';
import DirectJob from '../Components/Layouts/AccountsComp/directJob';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn(() => Promise.resolve()) }));
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('react-to-print', () => ({ useReactToPrint: () => jest.fn() }));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const line = {
  id: 1, JobId: 77, JobNumber: 'CL-CCJ-9/27', Charge: 5, Quantity: 1, Rate: 1500, Amount: 1500,
  Discount: 0, NetAmount: 1500, TaxApply: false, TaxAmount: 0, ExRate: 1, Currency: 'PKR', Description: 'Handling',
};

// The form as it stands once entry 1758 has been opened (or just saved).
const storeHolding = (fields) => {
  const blank = directJobReducer(undefined, { type: '@@init' });
  return configureStore({
    reducer: { directJob: directJobReducer, tabs: tabsReducer },
    preloadedState: {
      directJob: { ...blank, directJob: [line], directJob_Type: 'expense', directJob_TransMode: 'Cash',
        directJob_Currency: 'PKR', directJob_JobType: 'single', directJob_Account: 5439, ...fields },
    },
  });
};

const saveFrom = async (id, store) => {
  render(<Provider store={store}><DirectJob id={id} /></Provider>);
  const actions = usePageActions.mock.calls.at(-1)[0];
  await actions.save.onClick();
  await waitFor(() => expect(axiosClient.post).toHaveBeenCalled());
  return axiosClient.post.mock.calls.at(-1)[1].direct_Job;
};

beforeEach(() => {
  jest.clearAllMocks();
  axiosClient.get.mockResolvedValue({ data: { status: 'success', result: [], data: [], columns: [] } });
  axiosClient.post.mockResolvedValue({ data: { status: 'success', result: { id: 1758, Entry_Number: 'DE-1/27', Voucher_Number: 'CPV-603/27' } } });
});

test('a saved entry in the form is updated, even when the address says new', async () => {
  const store = storeHolding({ directJob_Id: '1758', directJob_VoucherId: 95885, directJob_EntryNumber: 'DE-1/27' });
  const sent = await saveFrom('new', store);
  expect(sent.id).toBe(1758);
  expect(sent.Voucher_Id).toBe(95885);
});

test('an entry opened by its address is updated', async () => {
  const store = storeHolding({ directJob_Id: '1758', directJob_VoucherId: 95885, directJob_EntryNumber: 'DE-1/27' });
  const sent = await saveFrom('1758', store);
  expect(sent.id).toBe(1758);
  expect(sent.Voucher_Id).toBe(95885);
});

test('a blank form is created, whatever the address', async () => {
  const sent = await saveFrom('new', storeHolding({}));
  expect(sent.id).toBeUndefined();
  expect(sent.Voucher_Id).toBeUndefined();
});

test('after a new entry is saved, its tab points at it, not at "new"', async () => {
  const store = storeHolding({});
  await saveFrom('new', store);
  await waitFor(() => expect(store.getState().tabs.value).toMatchObject({ key: '3-15', id: 1758 }));
});

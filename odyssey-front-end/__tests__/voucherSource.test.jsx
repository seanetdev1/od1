/**
 * The Voucher screen and a voucher another screen made (asked 2026-11-13):
 * ADJ-P-113/27 is a Direct Job adjustment's voucher. It is shown, says which
 * entry made it with a way to open it, and is changed and deleted there - the
 * server refuses it here (functions/voucherSource). A voucher of the Voucher
 * screen's own is deleted from the toolbar.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import Router from 'next/router';
import vouchers from '../redux/vouchers/voucherSlice';
import fiscalYear from '../redux/fiscalYear/fiscalYearSlice';
import Voucher from '../Components/Layouts/AccountsComp/Voucher';
import { PageActionsProvider, PageActionBar } from 'Components/Shared/PageActions';
import axiosClient from 'apis/axiosClient';
import { sourceLink } from 'functions/voucherSource';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn(), defaults: {} }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('../Components/Layouts/AccountsComp/Voucher/Print', () => function Print() { return null; });
jest.mock('../Components/Layouts/AccountsComp/Voucher/VoucherPrint', () => function VoucherPrint() { return null; });

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const VOUCHER = {
  id: 95885, voucher_Id: 'ADJ-P-113/27', voucher_No: 113, vType: 'ADJ-P', type: 'Job Payble', CompanyId: 1,
  currency: 'PKR', exRate: '1', chequeNo: '', chequeDate: null, createdAt: '2026-10-08T00:00:00Z',
  Voucher_Heads: [
    { id: 1, ChildAccountId: 7, type: 'debit', amount: '11300', accountType: 'partyAccount', narration: 'ADJ' },
    { id: 2, ChildAccountId: 8, type: 'credit', amount: '11300', accountType: 'partyAccount', narration: 'ADJ' },
  ],
};

const open = async (source) => {
  axiosClient.get.mockImplementation((url) => Promise.resolve(url === process.env.NEXT_PUBLIC_CLIMAX_GET_VOUCHER_BY_ID
    ? { data: { status: 'success', result: VOUCHER, source } }
    : { data: { status: 'success', result: [], closingBalance: 0, rights: { add: true, delete: true }, types: [] } }));
  const store = configureStore({ reducer: { vouchers, fiscalYear } });
  await act(async () => {
    render(<Provider store={store}><PageActionsProvider><PageActionBar /><Voucher id='95885' /></PageActionsProvider></Provider>);
  });
  return store;
};

beforeEach(() => jest.clearAllMocks());

test('a Direct Job\'s voucher says so, opens the entry, and is neither saved nor deleted here', async () => {
  await open({ screen: 'Direct Job', label: 'Direct Job DE-12/27', open: { page: 'directJob', id: 44 } });
  expect(await screen.findByText('This voucher was made by Direct Job DE-12/27.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  // Its documents are still its own.
  expect(screen.getByRole('button', { name: /Documents/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Open Direct Job DE-12/27' }));
  expect(Router.push).toHaveBeenCalledWith('/accounts/directJob/44');
});

test('the Voucher screen\'s own voucher is deleted from the toolbar, after asking', async () => {
  axiosClient.post.mockResolvedValue({ data: { status: 'success' } });
  await open(null);
  expect(screen.queryByText(/This voucher was made by/)).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog');
  expect(axiosClient.post).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' })); });
  expect(axiosClient.post).toHaveBeenCalledWith(process.env.NEXT_PUBLIC_CLIMAX_POST_DELETE_BASE_VOUCHER, expect.objectContaining({ id: '95885' }));
  await waitFor(() => expect(Router.push).toHaveBeenCalledWith('/accounts/voucherList'));
});

test('each kind of record opens on its own screen', () => {
  expect(sourceLink({ page: 'paymentReceipt', id: 5 }).path).toBe('/accounts/paymentReceipt/5');
  expect(sourceLink({ page: 'invoice', id: 9 })).toEqual({ tab: { label: 'Invoice details', key: '3-17', id: '9' }, path: '/reports/invoice/9' });
  expect(sourceLink({ page: 'openingBalance', id: 3 }).path).toBe('/accounts/openingBalance/3');
  expect(sourceLink({ page: 'officeVoucher', id: 2 }).path).toBe('/accounts/officeVouchers/2');
  expect(sourceLink(null)).toBeNull();
  expect(sourceLink({ page: 'nowhere', id: 1 })).toBeNull();
});

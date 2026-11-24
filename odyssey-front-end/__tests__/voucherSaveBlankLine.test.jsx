/**
 * The Voucher screen's Save with the blank line at the bottom (2026-11-16,
 * functions/voucherLines). The blank line is never sent - it was refused as
 * "Account not Selected in Row 3", and the narration the save builds read
 * every line's account, so a blank one stopped the save.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import vouchers from '../redux/vouchers/voucherSlice';
import fiscalYear from '../redux/fiscalYear/fiscalYearSlice';
import Voucher from '../Components/Layouts/AccountsComp/Voucher';
import openNotification from 'Components/Shared/Notification';
import { PageActionsProvider, PageActionBar } from 'Components/Shared/PageActions';

// The screen loads its two account lists itself - the bank / cash ones asked
// for by type, every other one without.
jest.mock('apis/axiosClient', () => ({
  get: jest.fn((url, opts) => Promise.resolve({ data: {
    status: 'success', closingBalance: 0,
    result: opts?.headers?.type ? [{ id: 9, code: '120302', title: 'MEEZAN BANK' }] : [{ id: 1, code: '501', title: 'SALARIES' }],
  } })),
  post: jest.fn(() => Promise.resolve({ data: { status: 'success', result: { id: 1 } } })),
}));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('../Components/Layouts/AccountsComp/Voucher/Print', () => function Print() { return null; });
jest.mock('../Components/Layouts/AccountsComp/Voucher/VoucherPrint', () => function VoucherPrint() { return null; });
jest.mock('react-to-print', () => ({ useReactToPrint: () => jest.fn() }));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const setup = async () => {
  const store = configureStore({ reducer: { vouchers, fiscalYear } });
  const set = (field, value) => store.dispatch({ type: 'records/setField', payload: { field, value } });
  set('vType', 'BPV');
  set('cAccounts', [{ id: 1, code: '501', title: 'SALARIES' }]);
  set('settlementAccounts', [{ id: 9, code: '120302', title: 'MEEZAN BANK' }]);
  set('settlementAccount', 9);
  set('settleVoucherHead', { amount: 5000, type: 'credit', accountType: 'payAccount' });
  set('Voucher_Heads', [{ ChildAccountId: 1, type: 'debit', amount: 5000, narration: '' }]);
  await act(async () => {
    render(<Provider store={store}><PageActionsProvider><PageActionBar /><Voucher id='new' /></PageActionsProvider></Provider>);
  });
  return store;
};

test('the blank line is there, and the save goes on without it', async () => {
  const store = await setup();
  // The blank line at the bottom, added by the screen.
  expect(store.getState().vouchers.Voucher_Heads).toHaveLength(2);
  expect(document.querySelectorAll('tbody tr.vo-line-blank')).toHaveLength(1);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });

  // No "Account not Selected in Row 2" - the postings are shown for approval.
  expect(openNotification).not.toHaveBeenCalledWith('Error', expect.stringMatching(/Account not Selected/), 'red');
  const preview = await screen.findByRole('dialog');
  expect(preview).toHaveTextContent('SALARIES');
  expect(preview).toHaveTextContent('MEEZAN BANK');
});

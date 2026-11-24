/**
 * The Voucher screen - a payment with lines on both sides
 * (AccountsComp/Voucher). The CFO's case: salary 100,000 paid by bank with a
 * 20,000 loan instalment held back - salary Dr 100,000, loan Cr 20,000, bank
 * Cr 80,000. A BPV / BRV / CPV / CRV line's Type was locked to the voucher's
 * own side and the bank line was the lines' plain sum.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, fireEvent, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import vouchers from '../redux/vouchers/voucherSlice';
import fiscalYear from '../redux/fiscalYear/fiscalYearSlice';
import Voucher from '../Components/Layouts/AccountsComp/Voucher';
import { PageActionsProvider, PageActionBar } from 'Components/Shared/PageActions';

jest.mock('apis/axiosClient', () => ({
  get: jest.fn(() => Promise.resolve({ data: { status: 'success', result: [], closingBalance: 0 } })),
  post: jest.fn(() => Promise.resolve({ data: { status: 'success', result: { id: 1 } } })),
}));
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

const setup = async () => {
  const store = configureStore({ reducer: { vouchers, fiscalYear } });
  const set = (field, value) => store.dispatch({ type: 'records/setField', payload: { field, value } });
  set('vType', 'BPV');
  set('cAccounts', [{ id: 1, code: '501', title: 'SALARIES' }, { id: 2, code: '120', title: 'STAFF LOAN' }]);
  set('settleVoucherHead', { amount: 0, type: 'credit', accountType: 'payAccount' });
  set('Voucher_Heads', [
    { ChildAccountId: 1, type: 'debit', amount: 0, narration: '' },
    { ChildAccountId: 2, type: 'debit', amount: 0, narration: '' },
  ]);
  let utils;
  await act(async () => {
    // With the toolbar: Save is there now, as on every screen (2026-11-13).
    utils = render(<Provider store={store}><PageActionsProvider><PageActionBar /><Voucher id='new' /></PageActionsProvider></Provider>);
  });
  return { store, ...utils };
};

test('a payment line\'s Type can be changed - it is not locked to debit', async () => {
  const { container } = await setup();
  // The two lines - not the blank one always at the bottom.
  const typeBoxes = [...container.querySelectorAll('tbody tr:not(.vo-line-blank) td:nth-child(2) .ant-select')];
  expect(typeBoxes).toHaveLength(2);
  typeBoxes.forEach((s) => expect(s.classList.contains('ant-select-disabled')).toBe(false));
});

test('salary Dr 100,000, loan Cr 20,000: the bank line is Cr 80,000 and the voucher balances', async () => {
  const { store, container } = await setup();
  // The loan line to the credit side: what the Type box does.
  await act(async () => {
    store.dispatch({
      type: 'records/setField',
      payload: { field: 'Voucher_Heads', value: [
        { ChildAccountId: 1, type: 'debit', amount: 0, narration: '' },
        { ChildAccountId: 2, type: 'credit', amount: 0, narration: '' },
      ] },
    });
  });
  const amounts = () => [...container.querySelectorAll('tbody tr td:nth-child(3) input')];
  await act(async () => { fireEvent.change(amounts()[0], { target: { value: '100000' } }); });
  await act(async () => { fireEvent.change(amounts()[1], { target: { value: '20000' } }); });

  const v = store.getState().vouchers;
  expect(v.settleVoucherHead).toMatchObject({ type: 'credit', amount: 80000 });
  expect(v.debitTotal).toBe(100000);
  expect(v.creditTotal).toBe(100000);
});

/* Debit / Credit / Net Amount on the screen, as Climax works them out (the user's
 * request, 2026-10-26): the lines entered, without the bank line - while the
 * totals the save checks still include it (above). */
test('the panel shows the lines entered and what the bank pays out', async () => {
  const { store, container, getByTestId } = await setup();
  await act(async () => {
    store.dispatch({
      type: 'records/setField',
      payload: { field: 'Voucher_Heads', value: [
        { ChildAccountId: 1, type: 'debit', amount: 0, narration: '' },
        { ChildAccountId: 2, type: 'credit', amount: 0, narration: '' },
      ] },
    });
  });
  const amounts = () => [...container.querySelectorAll('tbody tr td:nth-child(3) input')];
  await act(async () => { fireEvent.change(amounts()[0], { target: { value: '100000' } }); });
  await act(async () => { fireEvent.change(amounts()[1], { target: { value: '20000' } }); });

  expect(getByTestId('voucher-debit').textContent).toBe('100,000.00');
  expect(getByTestId('voucher-credit').textContent).toBe('20,000.00');
  expect(getByTestId('voucher-net-amount').textContent).toBe('80,000.00');
  // In the screen's own boxes - label above, as Closing Balance.
  expect(container.textContent).toContain('Closing Balance');
  expect(container.textContent).toContain('Net Amount');
});

/* Save shows every account the voucher posts to - debit and credit, the bank
 * line included - before it is sent, as Payments & Receipts does on Make
 * Transaction (the user's request, 2026-10-26). */
test("the toolbar has the voucher's actions - Print and Excel wait for it to be saved", async () => {
  const { getByRole } = await setup();
  expect(getByRole('button', { name: 'New Voucher' })).toBeEnabled();
  expect(getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(getByRole('button', { name: 'Print' })).toBeDisabled();
  expect(getByRole('button', { name: 'Export to Excel' })).toBeDisabled();
  expect(getByRole('button', { name: 'Documents' })).toBeDisabled();
  expect(getByRole('button', { name: 'Delete' })).toBeDisabled();
});

test('Save shows the postings for approval; Approve & Save sends them', async () => {
  const axiosClient = require('apis/axiosClient');
  axiosClient.post.mockClear();
  const { store, container, getByText, getByRole, findByText } = await setup();
  await act(async () => {
    // After the screen's own loads (which the mocked server answers empty).
    store.dispatch({ type: 'records/setField', payload: { field: 'cAccounts', value: [{ id: 1, code: '501', title: 'SALARIES' }, { id: 2, code: '120', title: 'STAFF LOAN' }] } });
    store.dispatch({ type: 'records/setField', payload: { field: 'settlementAccounts', value: [{ id: 9, title: 'MEEZAN BANK' }] } });
    store.dispatch({ type: 'records/setField', payload: { field: 'settlementAccount', value: 9 } });
    store.dispatch({
      type: 'records/setField',
      payload: { field: 'Voucher_Heads', value: [
        { ChildAccountId: 1, type: 'debit', amount: 0, narration: '' },
        { ChildAccountId: 2, type: 'credit', amount: 0, narration: '' },
      ] },
    });
  });
  const amounts = () => [...container.querySelectorAll('tbody tr td:nth-child(3) input')];
  await act(async () => { fireEvent.change(amounts()[0], { target: { value: '100000' } }); });
  await act(async () => { fireEvent.change(amounts()[1], { target: { value: '20000' } }); });

  await act(async () => { fireEvent.click(getByRole('button', { name: 'Save' })); });
  expect(await findByText('Proceed with transaction?')).toBeTruthy();
  expect(axiosClient.post).not.toHaveBeenCalled();
  const rows = [...document.querySelectorAll('.ant-modal tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
  expect(rows).toEqual([
    ['partyAccount', 'SALARIES', '100,000.00', '0', 'debit'],
    ['partyAccount', 'STAFF LOAN', '0', '20,000.00', 'credit'],
    ['payAccount', 'MEEZAN BANK', '0', '80,000.00', 'credit'],
  ]);

  await act(async () => { fireEvent.click(getByText('Approve & Save')); });
  expect(axiosClient.post).toHaveBeenCalledTimes(1);
  const [url, sent] = axiosClient.post.mock.calls[0];
  expect(url).toMatch(/\/voucher\/createVoucher$/);
  expect(sent.Voucher_Heads).toHaveLength(3);
});

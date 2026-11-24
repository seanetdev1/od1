/**
 * The Voucher screen - each line its own narration (AccountsComp/Voucher). On
 * a JV or TV, typing on one line wrote the same text to every line (the
 * user's request, 2026-10-14).
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import vouchers from '../redux/vouchers/voucherSlice';
import fiscalYear from '../redux/fiscalYear/fiscalYearSlice';
import Voucher from '../Components/Layouts/AccountsComp/Voucher';

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

const setup = async (vType) => {
  const store = configureStore({ reducer: { vouchers, fiscalYear } });
  const set = (field, value) => store.dispatch({ type: 'records/setField', payload: { field, value } });
  set('vType', vType);
  set('cAccounts', [{ id: 1, code: '501', title: 'SALARIES' }, { id: 2, code: '120', title: 'STAFF LOAN' }]);
  set('settleVoucherHead', { amount: 0, type: 'credit', accountType: 'payAccount' });
  set('Voucher_Heads', [
    { ChildAccountId: 1, type: 'debit', amount: 0, narration: '' },
    { ChildAccountId: 2, type: 'credit', amount: 0, narration: '' },
  ]);
  let utils;
  await act(async () => {
    utils = render(<Provider store={store}><Voucher id='new' /></Provider>);
  });
  return { store, ...utils };
};

// The lines entered - not the blank one always at the bottom (functions/voucherLines).
const lineNarrations = (container) => [...container.querySelectorAll('tbody tr:not(.vo-line-blank) td input.ant-input')];

test.each(['JV', 'TV', 'BPV'])('%s: typing on one line changes that line only', async (vType) => {
  const { store, container } = await setup(vType);
  const boxes = lineNarrations(container);
  expect(boxes).toHaveLength(2);
  await act(async () => { fireEvent.change(boxes[0], { target: { value: 'SALARY FOR SEPTEMBER' } }); });
  await act(async () => { fireEvent.change(lineNarrations(container)[1], { target: { value: 'LOAN INSTALMENT 3 OF 12' } }); });
  expect(store.getState().vouchers.Voucher_Heads.map((h) => h.narration))
    .toEqual(['SALARY FOR SEPTEMBER', 'LOAN INSTALMENT 3 OF 12', '']); // and the blank line at the bottom, untouched - never saved
});

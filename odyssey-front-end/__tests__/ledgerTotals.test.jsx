/**
 * The ledger's grand total - Reports/Ledger/MainTable.
 *
 * Under the table, on screen and on the printed copy: the Debit and Credit
 * columns added up (the period's movement - the opening balance is in the
 * Balance column only) and the closing balance beside them.
 */
import React from 'react';
import { render } from '@testing-library/react';
import MainTable from '../Components/Layouts/Reports/Ledger/MainTable';

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn() }));
jest.mock('Components/Shared/PrintTopHeader', () => function PrintTopHeader() { return null; });
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: () => {} }));
jest.mock('Components/Shared/Notification', () => jest.fn());

// jsdom implements no media queries, and antd's pagination asks for them.
beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

const ledger = [
  { voucherId: 1, voucher: 'SNS-BRV-12/27', date: '2026-07-05T00:00:00.000Z', narration: 'Received', type: 'credit', amount: 400, balance: 600 },
  { voucherId: 2, voucher: 'SNS-JI-40/27', date: '2026-07-09T00:00:00.000Z', narration: 'Invoice', type: 'debit', amount: 150, balance: 750 },
];

const totalRows = () => [...document.querySelectorAll('tr.ledger-total')]
  .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));

test('a Total row under the table: Debit, Credit, and the closing balance', () => {
  render(<MainTable ledger={ledger} opening={1000} closing={750} name='ATLAS FOODS' company={1} currency='PKR' from='01-07-2026' to='30-09-2026' />);
  const rows = totalRows();
  // On screen, and on the copy that prints.
  expect(rows.length).toBe(2);
  rows.forEach((cells) => expect(cells).toEqual(['Total', '150.00', '400.00', '750.00 Dr']));
});

test('a credit closing reads Cr', () => {
  render(<MainTable ledger={[{ ...ledger[0], balance: -400 }]} opening={0} closing={-400} name='X' company={1} currency='PKR' from='01-07-2026' to='30-09-2026' />);
  expect(totalRows()[0]).toEqual(['Total', '0.00', '400.00', '400.00 Cr']);
});

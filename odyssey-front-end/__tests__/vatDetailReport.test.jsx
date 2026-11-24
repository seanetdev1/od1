/**
 * The VAT Detail screen - Reports/VatDetail. Show asks the server for the
 * period (last month to begin with); the table lists every document in the
 * columns picked - the built-in ten, or Configuration's set - with a Total
 * row, and the print and Excel carry the same columns. The print carries the
 * company's logo.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import moment from 'moment';
import axiosClient from 'apis/axiosClient';
import VatDetail from '../Components/Layouts/Reports/VatDetail';

jest.mock('apis/axiosClient', () => ({ get: jest.fn() }));
jest.mock('react-redux', () => ({ useSelector: (f) => f({ company: { value: 1 } }) }));
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: () => {} }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('functions/companyBranding', () => ({
  reportCompanyTitle: () => 'CARGO LINKERS.', reportAddress: () => 'KARACHI',
  companyLogo: () => 'data:image/png;base64,CLLOGO', reportLetterheadId: (id) => id,
}));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const result = {
  from: '2026-09-01', to: '2026-09-30',
  rows: [
    { sr: 1, ntn: '0704059-8', cnic: '', buyer: 'PROLINE (PVT) LTD', district: 'KARACHI,PAKISTAN', buyerType: '', documentType: 'SI', documentNo: 'CL-23869', date: '2026-09-02', hsCode: '', saleType: 'Services', rate: 15, value: 1750, tax: 263, withheld: 0 },
  ],
  totals: { value: 1750, tax: 263, withheld: 0 },
};

// The report's data, and Configuration's columns (`configured`).
const serve = (configured = null) => axiosClient.get.mockImplementation((url) => Promise.resolve({
  data: { status: 'success', result: url.includes('reportColumns') ? configured : result },
}));

const show = async (configured) => {
  serve(configured);
  const utils = render(<VatDetail />);
  await act(async () => { fireEvent.click(screen.getByText('Show')); });
  return utils;
};
const headings = (container) => [...container.querySelectorAll('.vat-detail .ant-table-thead th')].map((th) => th.textContent);
const cells = (container) => [...container.querySelectorAll('.vat-detail .ant-table-tbody tr.ant-table-row td')].map((td) => td.textContent);
const total = (container) => [...container.querySelectorAll('.vat-detail tr.vat-total td')].map((td) => td.textContent);

beforeEach(() => {
  axiosClient.get.mockReset();
  window.sessionStorage.clear();
});

test('Show asks for last month, for the header\'s company', async () => {
  await show();
  const call = axiosClient.get.mock.calls.find(([url]) => url.includes('/misc/vatDetail'));
  const lastMonth = moment().subtract(1, 'month');
  expect(call[1].headers).toMatchObject({
    from: lastMonth.clone().startOf('month').format('YYYY-MM-DD'),
    to: lastMonth.clone().endOf('month').format('YYYY-MM-DD'),
    company: '1',
  });
});

test('opens on the built-in ten columns - the five rarely wanted off', async () => {
  const { container } = await show();
  expect(headings(container)).toEqual(['Sr #', 'NTN', 'Name of Buyer', 'District', 'Document No.', 'Date', 'HS Code', 'Rate', 'Value Excl. Tax', 'Sales Tax']);
  expect(cells(container)).toEqual(['1', '0704059-8', 'PROLINE (PVT) LTD', 'KARACHI,PAKISTAN', 'CL-23869', '02-09-2026', '', '15', '1,750', '263']);
  expect(total(container)).toEqual(['Total', '', '', '', '', '', '', '', '1,750', '263']);
  expect(screen.getByText('Columns (10)')).toBeTruthy();
});

test('opens on Configuration\'s columns, in their order, when it names some', async () => {
  const { container } = await show(['buyer', 'tax', 'cnic']);
  await waitFor(() => expect(headings(container)).toEqual(['Name of Buyer', 'Sales Tax', 'CNIC']));
});

test('Columns: tick one on, and All gives the return\'s fifteen', async () => {
  const { container } = await show();
  fireEvent.click(screen.getByText('Columns (10)'));
  fireEvent.click(await screen.findByText('Sale Type'));
  await waitFor(() => expect(headings(container)).toContain('Sale Type'));
  // Where the return has it - between HS Code and Rate - not at the end.
  expect(headings(container).slice(6, 9)).toEqual(['HS Code', 'Sale Type', 'Rate']);
  expect(screen.getByText('Columns (11)')).toBeTruthy();
  // Kept for the session.
  expect(JSON.parse(window.sessionStorage.getItem('odyssey.vatDetail.columns'))).toContain('saleType');

  fireEvent.click(screen.getByText('All'));
  await waitFor(() => expect(headings(container)).toHaveLength(15));
  fireEvent.click(screen.getByText('Default'));
  await waitFor(() => expect(headings(container)).toHaveLength(10));
});

test('fits the page: fixed widths, a long name cut short with the whole of it on hover', async () => {
  const { container } = await show();
  expect(container.querySelector('.vat-detail table').style.tableLayout).toBe('fixed');
  expect(container.querySelector('.vat-detail .ant-table-tbody [title="PROLINE (PVT) LTD"]')).toBeTruthy();
});

test('the print carries the columns shown and the company\'s logo', async () => {
  const { container } = await show();
  expect(container.querySelectorAll('.vat-print thead th')).toHaveLength(10);
  expect(container.querySelector('.vat-print .logo img').getAttribute('src')).toBe('data:image/png;base64,CLLOGO');
  fireEvent.click(screen.getByText('Columns (10)'));
  fireEvent.click(await screen.findByText('All'));
  await waitFor(() => expect(container.querySelectorAll('.vat-print thead th')).toHaveLength(15));
  expect([...container.querySelectorAll('.vat-print tr.total td')].slice(-3).map((td) => td.textContent)).toEqual(['1,750', '263', '0']);
});

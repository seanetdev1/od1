/**
 * Accounts > Invoices / Bills (2026-11-15 redesign): four lists to choose
 * from - the Old Job Invoice / Old Job Bill choices are gone - the job of a
 * customs invoice shown from what the server works out, approval and party
 * type as labels, the rate beside a foreign currency, and the count.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import axiosClient from 'apis/axiosClient';
import InvoiceAndBills, { INVOICE_TYPES } from '../Components/Layouts/AccountsComp/InvoiceAndBills';

jest.mock('next/router', () => ({ push: jest.fn(() => Promise.resolve()) }));
jest.mock('react-redux', () => ({ useSelector: () => '1', useDispatch: () => jest.fn() }));
jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: (x) => x }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('Components/Shared/InvoiceCharges', () => () => null);
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: () => {} }));
jest.mock('functions/terminology', () => ({ isCustomsMode: () => true }));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});
beforeEach(() => { window.sessionStorage.clear(); axiosClient.get.mockReset(); });

const rows = [
  { id: 1, invoice_No: 'CL-JI-2909/27', jobNo: 'TP-2825/27', party_Name: 'CHENAB LIMITED', partyType: 'client', approved: '0', operation: 'CC', currency: 'PKR', ex_rate: '1', total: '51875' },
  { id: 2, invoice_No: 'CL-JI-2907/27', jobNo: 'TP-2780/27', party_Name: 'CONVENIENCE FOOD', partyType: 'client', approved: '1', operation: 'CC', currency: 'USD', ex_rate: '280.5', total: '1250' },
  // A freight invoice from before the server named the job itself.
  { id: 3, invoice_No: 'SNS-JI-7/27', SE_Job: { jobNo: 'SNS-SE-41/27' }, party_Name: 'MSC', partyType: 'agent', approved: '1', operation: 'SE', currency: 'PKR', ex_rate: '1', total: '100' },
];
const rowOf = (no) => screen.getByText(no).closest('tr');

test('four lists - no Old Job Invoice or Old Job Bill', () => {
  render(<InvoiceAndBills invoiceData={{ result: rows, count: 3 }} />);
  expect(INVOICE_TYPES).toEqual(['Job Invoice', 'Job Bill', 'Agent Invoice', 'Agent Bill']);
  INVOICE_TYPES.forEach((t) => expect(screen.getByLabelText(t)).toBeInTheDocument());
  expect(screen.queryByText('Old Job Invoice')).toBeNull();
  expect(screen.queryByText('Old Job Bill')).toBeNull();
});

test('the job number: the one the server names, else the freight job\'s', () => {
  render(<InvoiceAndBills invoiceData={{ result: rows, count: 3 }} />);
  expect(within(rowOf('CL-JI-2909/27')).getByText('TP-2825/27')).toBeInTheDocument();
  expect(within(rowOf('SNS-JI-7/27')).getByText('SNS-SE-41/27')).toBeInTheDocument();
});

test('approval and party type as labels; the rate only beside a foreign currency', () => {
  render(<InvoiceAndBills invoiceData={{ result: rows, count: 3 }} />);
  expect(within(rowOf('CL-JI-2909/27')).getByText('Unapproved')).toHaveClass('dl-badge', 'tone-amber');
  expect(within(rowOf('CL-JI-2907/27')).getByText('Approved')).toHaveClass('dl-badge', 'tone-green');
  expect(within(rowOf('CL-JI-2909/27')).getByText('Client')).toHaveClass('dl-badge');
  expect(rowOf('CL-JI-2907/27')).toHaveTextContent('USD @ 280.5');
  expect(rowOf('CL-JI-2909/27')).not.toHaveTextContent('@');
  expect(within(rowOf('CL-JI-2909/27')).getByText('51,875.00')).toBeInTheDocument();
});

test('the count, in words for the list chosen, and what the page shows', async () => {
  render(<InvoiceAndBills invoiceData={{ result: rows, count: 23698 }} />);
  expect(screen.getByText('23,698 job invoices')).toBeInTheDocument();
  expect(screen.getByText(/Showing 1.3 of 23,698/)).toBeInTheDocument();
  axiosClient.get.mockResolvedValue({ data: { status: 'success', result: [], count: 1 } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Agent Bill')); });
  const listCall = axiosClient.get.mock.calls.filter((c) => c[1]?.headers?.type).pop();
  expect(listCall[1].headers.type).toBe('Agent Bill');
  expect(listCall[1].params).toMatchObject({ page: 1 });
  expect(screen.getByText('1 agent bill')).toBeInTheDocument();
  expect(screen.getByText('No agent bills')).toBeInTheDocument();
});

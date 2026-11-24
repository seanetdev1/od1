/**
 * Accounts > Invoice / Bills: the print list is filled with CHECKBOXES - one
 * per invoice, and one in the header for the page in view. A click on a box
 * must not open the invoice, which a click anywhere else on the row does.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Router from 'next/router';
import InvoiceAndBills from '../Components/Layouts/AccountsComp/InvoiceAndBills';

jest.mock('next/router', () => ({ push: jest.fn(() => Promise.resolve()) }));
jest.mock('react-redux', () => ({ useSelector: () => '1', useDispatch: () => jest.fn() }));
jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: (x) => x }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('Components/Shared/InvoiceCharges', () => () => null);
jest.mock('Components/Shared/Notification', () => jest.fn());
// The list itself, shown as the ids it was given - not the numbers, which the rows show.
jest.mock('../Components/Layouts/AccountsComp/InvoiceAndBills/PrintList', () => ({ list }) => (
  <div data-testid='print-list'>{list.map((x) => `#${x.id}`).join(',')}</div>
));

const rows = [1, 2, 3].map((id) => ({
  id, invoice_No: `JI-${2621 + id}/27`, party_Name: 'EASTERN SPINNING MILLS LIMITED',
  approved: '1', operation: 'LG', currency: 'PKR', ex_rate: '1', total: '1000', partyType: 'client',
}));

const listed = () => screen.getByTestId('print-list').textContent;
const rowBox = (no) => within(screen.getByText(no).closest('tr')).getByRole('checkbox');

beforeEach(() => {
  Router.push.mockClear();
  window.sessionStorage.clear();
});

test('a row\'s box puts that invoice on the list, and takes it off again', () => {
  render(<InvoiceAndBills invoiceData={{ result: rows, count: 3 }} />);
  fireEvent.click(rowBox('JI-2623/27'));
  expect(listed()).toBe('#2');
  fireEvent.click(rowBox('JI-2623/27'));
  expect(listed()).toBe('');
});

test('ticking a box does not open the invoice', () => {
  render(<InvoiceAndBills invoiceData={{ result: rows, count: 3 }} />);
  fireEvent.click(rowBox('JI-2622/27'));
  expect(Router.push).not.toHaveBeenCalled();
  // The rest of the row still opens it.
  fireEvent.click(screen.getByText('JI-2622/27'));
  expect(Router.push).toHaveBeenCalledWith('/reports/invoice/1');
});

test('the header box takes the whole page on and off', () => {
  render(<InvoiceAndBills invoiceData={{ result: rows, count: 3 }} />);
  const header = within(document.querySelector('thead')).getByRole('checkbox');
  fireEvent.click(rowBox('JI-2622/27'));
  fireEvent.click(header);
  expect(listed()).toBe('#1,#2,#3');   // once each, in page order
  fireEvent.click(header);
  expect(listed()).toBe('');
});

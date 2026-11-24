/**
 * The GST invoice number (CL-24295) - given on approval to an invoice with
 * sales tax on it, which customs clearance invoices are - on the invoice's
 * page (functions/saleTaxInvoice gstNoField) and as a column on Accounts >
 * Invoice / Bills. Searching it is the server's (/invoice/getFilteredInvoices).
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import axiosClient from 'apis/axiosClient';
import InvoiceAndBills from '../Components/Layouts/AccountsComp/InvoiceAndBills';
import { gstNoField } from '../functions/saleTaxInvoice';

jest.mock('next/router', () => ({ push: jest.fn(() => Promise.resolve()) }));
jest.mock('react-redux', () => ({ useSelector: () => '1', useDispatch: () => jest.fn() }));
jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: (x) => x }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('Components/Shared/InvoiceCharges', () => () => null);
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('../Components/Layouts/AccountsComp/InvoiceAndBills/PrintList', () => () => null);
let mockMode = 'customs';
jest.mock('functions/terminology', () => ({ isCustomsMode: () => mockMode === 'customs' }));

const taxed = { type: 'Recievable', CustomsJobId: 7, qty: 1, ex_rate: 1, rate_charge: 2500, tax_apply: true, taxPerc: 15, tax_amount: 375 };
const untaxed = { type: 'Recievable', CustomsJobId: 7, qty: 1, ex_rate: 1, rate_charge: 39940, tax_apply: false };

describe('the invoice page\'s GST Inv #', () => {
  const invoice = (over = {}) => ({ payType: 'Recievable', approved: '0', ...over });

  test('its number, once it has one', () => {
    expect(gstNoField(invoice({ approved: '1', Sales_Tax_Invoice: { taxInvoiceNo: 'CL-24295' } }), [taxed]))
      .toEqual({ text: 'CL-24295', pending: false });
    // Kept through an unapprove, so it still shows.
    expect(gstNoField(invoice({ Sales_Tax_Invoice: { taxInvoiceNo: 'CL-24295' } }), [taxed]).text).toBe('CL-24295');
  });

  test('taxed and not approved yet: given on approval', () => {
    expect(gstNoField(invoice(), [untaxed, taxed])).toEqual({ text: 'On approval', pending: true });
  });

  test('approved with tax but never numbered - a migrated one: a dash', () => {
    expect(gstNoField(invoice({ approved: '1' }), [taxed])).toEqual({ text: '-', pending: false });
  });

  test('nothing taxed, or a bill: not shown', () => {
    expect(gstNoField(invoice(), [untaxed])).toBeNull();
    expect(gstNoField(invoice({ payType: 'Payble' }), [{ ...taxed, type: 'Payble' }])).toBeNull();
    expect(gstNoField(invoice(), undefined)).toBeNull();
  });
});

describe('Invoice / Bills', () => {
  const row = (id, gst) => ({
    id, invoice_No: `CL-JI-${id}/27`, party_Name: 'EASTERN SPINNING MILLS LIMITED', approved: '1',
    operation: 'CC', currency: 'PKR', ex_rate: '1', total: '2875', partyType: 'client',
    Sales_Tax_Invoice: gst ? { taxInvoiceNo: gst } : null,
  });
  const rows = [row(1, 'CL-24295'), row(2, null)];
  const headings = () => [...document.querySelectorAll('thead th')].map((th) => th.textContent);
  const cellsOf = (no) => [...screen.getByText(no).closest('tr').querySelectorAll('td')].map((td) => td.textContent);

  beforeEach(() => { mockMode = 'customs'; axiosClient.get.mockReset(); });

  test('a customs install: the GST number beside the invoice number, blank where there is none', () => {
    render(<InvoiceAndBills invoiceData={{ result: rows, count: 2 }} />);
    expect(headings().slice(1, 5)).toEqual(['#', 'Invoice No.', 'GST Inv #', 'Job No.']);
    expect(cellsOf('CL-JI-1/27').slice(2, 4)).toEqual(['CL-JI-1/27', 'CL-24295']);
    expect(cellsOf('CL-JI-2/27')[3]).toBe('');
    expect(screen.getByPlaceholderText(/GST no/)).toBeTruthy();
  });

  test('another install shows the column only when the invoices carry a number', () => {
    mockMode = 'freight';
    const { unmount } = render(<InvoiceAndBills invoiceData={{ result: [row(2, null)], count: 1 }} />);
    expect(headings()).not.toContain('GST Inv #');
    expect(screen.queryByPlaceholderText(/GST no/)).toBeNull();
    unmount();
    render(<InvoiceAndBills invoiceData={{ result: rows, count: 2 }} />);
    expect(headings()).toContain('GST Inv #');
  });

  test('not on bills - they are never given one', async () => {
    axiosClient.get.mockResolvedValue({ data: { status: 'success', result: [{ ...row(3, null), invoice_No: 'CL-JB-3/27' }], count: 1 } });
    render(<InvoiceAndBills invoiceData={{ result: rows, count: 2 }} />);
    await act(async () => { fireEvent.click(screen.getByLabelText('Job Bill')); });
    expect(screen.getByText('CL-JB-3/27')).toBeTruthy();
    expect(headings()).not.toContain('GST Inv #');
  });

  test('a GST number typed in the box is searched for on the server', async () => {
    jest.useFakeTimers();
    try {
      axiosClient.get.mockResolvedValue({ data: { status: 'success', result: [rows[0]], count: 1 } });
      render(<InvoiceAndBills invoiceData={{ result: rows, count: 2 }} />);
      fireEvent.change(screen.getByPlaceholderText(/GST no/), { target: { value: 'CL-24295' } });
      await act(async () => { jest.advanceTimersByTime(450); });
      expect(axiosClient.get.mock.calls.pop()[1].params).toMatchObject({ search: 'CL-24295', page: 1 });
    } finally {
      jest.useRealTimers();
    }
  });
});

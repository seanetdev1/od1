/**
 * AN INVOICE SEARCHED FOR WHERE IT IS NOT, SAYS WHERE IT IS (2026-11-16).
 *
 * SNS-AI-620/26 - an agent bill paid in full by SNS-ADJ-P-31/27 - showed on
 * its job and was "not found" on Invoices / Bills (looked for under Agent
 * Invoice: Climax numbered agent bills "AI" too) and on a payment to its party
 * (the list there is of what is still owed). The server now says what it
 * found elsewhere, and why; these are the screens saying it.
 */
import React, { useReducer } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { notListedText, notListedLines } from '../functions/invoiceNotListed';
import reducer from '../redux/paymentReciept/paymentRecieptSlice';

const mockGet = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn(() => Promise.resolve()), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-redux', () => ({ useSelector: (fn) => fn({ fiscalYear: { value: 1 }, company: { value: '2' } }), useDispatch: () => jest.fn() }));
jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: (x) => x }));
jest.mock('js-cookie', () => ({ get: () => '2' }));
jest.mock('Components/Shared/InvoiceCharges', () => () => null);
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('../Components/Layouts/AccountsComp/InvoiceAndBills/PrintList', () => () => null);
jest.mock('functions/terminology', () => ({ isCustomsMode: () => false }));

// eslint-disable-next-line import/first
import InvoiceAndBills from '../Components/Layouts/AccountsComp/InvoiceAndBills';
// eslint-disable-next-line import/first
import BillComp from '../Components/Layouts/AccountsComp/PaymentsReceipt/BillComp';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});
beforeEach(() => { mockGet.mockReset(); });

const NO = 'SNS-AI-620/26';
const PAID = {
  id: 42649, invoice_No: NO, party_Name: 'PETER RATHMANN & CO. GMBH', payType: 'Payble', currency: 'USD',
  reason: 'settled', settledBy: ['SNS-ADJ-P-31/27'],
};

describe('the words for each reason', () => {
  const payment = { currency: 'USD', payType: 'Payble' };

  test('paid in full, by which voucher', () => {
    expect(notListedText(PAID, payment)).toBe('SNS-AI-620/26 is already paid in full - by SNS-ADJ-P-31/27.');
    expect(notListedText({ ...PAID, payType: 'Recievable', settledBy: [] }, payment))
      .toBe('SNS-AI-620/26 is already received in full.');
  });

  test('another currency, side, party, or not approved', () => {
    expect(notListedText({ ...PAID, reason: 'otherCurrency' }, { currency: 'PKR', payType: 'Payble' }))
      .toBe('SNS-AI-620/26 is in USD - this payment is in PKR.');
    expect(notListedText({ ...PAID, reason: 'otherSide' }, payment))
      .toBe('SNS-AI-620/26 is a bill (payable) - make a payment for it, not a receipt.');
    expect(notListedText({ ...PAID, payType: 'Recievable', reason: 'otherSide' }, payment))
      .toBe('SNS-AI-620/26 is an invoice (receivable) - make a receipt for it, not a payment.');
    expect(notListedText({ ...PAID, reason: 'otherParty' }, payment))
      .toBe('SNS-AI-620/26 is against PETER RATHMANN & CO. GMBH, not this one.');
    expect(notListedText({ ...PAID, reason: 'unapproved' }, payment)).toBe('SNS-AI-620/26 is not approved yet.');
  });

  test('a reason it does not know, or none: no line', () => {
    expect(notListedLines([{ ...PAID, reason: 'whatever' }, null, PAID], payment)).toHaveLength(1);
    expect(notListedLines(undefined, payment)).toEqual([]);
  });
});

describe('Invoices / Bills', () => {
  const bill = { id: 42649, invoice_No: NO, party_Name: 'PETER RATHMANN & CO. GMBH', approved: '1', operation: 'AE', currency: 'USD', ex_rate: '278.77', total: '496.49', partyType: 'agent' };

  test('searched under Agent Invoice: says it is under Agent Bill, and one click shows it there', async () => {
    jest.useFakeTimers();
    try {
      mockGet.mockImplementation((url, opts) => Promise.resolve({
        data: opts.headers.type === 'Agent Bill'
          ? { status: 'success', result: [bill], count: 1, elsewhere: {} }
          : { status: 'success', result: [], count: 0, elsewhere: { 'Agent Bill': 1 } },
      }));
      render(<InvoiceAndBills invoiceData={{ result: [], count: 0 }} />);
      await act(async () => { fireEvent.click(screen.getByLabelText('Agent Invoice')); });
      fireEvent.change(screen.getByPlaceholderText(/Search invoice no/), { target: { value: NO } });
      await act(async () => { jest.advanceTimersByTime(450); });

      expect(screen.getByText(`No agent invoices match "${NO}"`)).toBeTruthy();
      const link = screen.getByRole('button', { name: /Agent Bill\s*1/ });
      expect(link.closest('.dl-elsewhere').textContent).toContain(`Matching “${NO}” under`);

      await act(async () => { fireEvent.click(link); });
      const last = mockGet.mock.calls[mockGet.mock.calls.length - 1][1];
      expect(last.headers.type).toBe('Agent Bill');
      expect(last.params).toMatchObject({ search: NO, page: 1 });
      expect(screen.getByText(NO)).toBeTruthy();
      // Nowhere else now: the strip goes.
      expect(document.querySelector('.dl-elsewhere')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('no search: no strip, whatever the server sent', () => {
    render(<InvoiceAndBills invoiceData={{ result: [bill], count: 1 }} />);
    expect(document.querySelector('.dl-elsewhere')).toBeNull();
  });
});

describe('Payments & Receipts - a payment to the party', () => {
  const Harness = ({ init }) => {
    const [state, dispatch] = useReducer(reducer, init);
    return <BillComp back={() => {}} companyId={2} state={state} dispatch={dispatch} actionRef={{ current: null }} />;
  };

  test('a search that finds nothing says the bill was paid, and by what', async () => {
    mockGet.mockImplementation((url, opts) => Promise.resolve({
      data: opts?.params?.search
        ? { status: 'success', result: [], count: 0, notListed: [PAID] }
        : { status: 'success', result: [], count: 0 },
    }));
    await act(async () => {
      render(<Harness init={{
        ...reducer(undefined, { type: 'init' }),
        transactionMode: 'Bank', currency: 'USD', exRate: 278.57, payType: 'Payble', selectedAccount: 1273,
        invoices: [], invoicePage: 1, invoicePageSize: 50, invoiceCount: 0,
      }} />);
    });
    expect(screen.getByText('Nothing outstanding for this party')).toBeTruthy();

    const box = screen.getByPlaceholderText('Search invoice, job, HBL, MBL, container or amount');
    fireEvent.change(box, { target: { value: NO } });
    await act(async () => { fireEvent.click(document.querySelector('.ant-input-search-button')); });

    expect(screen.getByText(`No outstanding invoice for this party matches “${NO}”`)).toBeTruthy();
    expect(screen.getByText('SNS-AI-620/26 is already paid in full - by SNS-ADJ-P-31/27.')).toBeTruthy();
  });
});

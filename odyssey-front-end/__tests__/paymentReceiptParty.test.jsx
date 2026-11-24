/**
 * What the party on a payment / receipt is - functions/paymentReceiptParty
 * (2026-11-16). From v1.2.18 every one was saved as 'all' (the party list's
 * filter), printed as "All Receipt" and listed as "All": the type worked out
 * for the party was set into a field the store refused. Read from the picked
 * party now, where it is saved and printed.
 */
import React, { useReducer } from 'react';
import { render, act, screen, fireEvent } from '@testing-library/react';
import reducer from '../redux/paymentReciept/paymentRecieptSlice';
import { partyTypeOf, selectedPartyType } from '../functions/paymentReceiptParty';

const mockGet = jest.fn(() => Promise.resolve({ data: { result: [] } }));
const mockPost = jest.fn(() => Promise.resolve({ data: { status: 'success', result: {} } }));
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-redux', () => ({ useSelector: (fn) => fn({ fiscalYear: { value: 1 } }), useDispatch: () => jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('functions/companyBranding', () => ({
  companyDetails: () => ({ title: 'TEST CO', address: 'KARACHI' }),
  companyLogo: () => null,
}));

// eslint-disable-next-line import/first
import BillComp from '../Components/Layouts/AccountsComp/PaymentsReceipt/BillComp';
// eslint-disable-next-line import/first
import PrintTransaction from '../Components/Layouts/AccountsComp/PaymentsReceipt/PrintTransaction';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

const PARTIES = [
  { id: 3, name: 'GLOBAL FREIGHT AGENCIES', types: 'Overseas Agent' },
  { id: 4, name: 'KARACHI TRANSPORT', types: 'Local Vendor, Transporter' },
  { id: 6, name: 'ACME TRADERS', types: 'Shipper, Consignee' },
];

describe('what a party is', () => {
  test.each([
    ['Overseas Agent', 'agent'],
    ['Shipper, Overseas Agent, Local Vendor', 'agent'],
    ['Local Vendor, Transporter', 'vendor'],
    ['Shipper, Consignee', 'client'],
    ['', 'client'],
  ])('%j reads as %s', (types, type) => {
    expect(partyTypeOf({ types })).toBe(type);
  });

  test('the party picked, not the list it was picked from', () => {
    expect(selectedPartyType({ type: 'all', PRaccounts: PARTIES, selectedAccount: 4 })).toBe('vendor');
  });

  test('not in the list loaded: what the voucher was stored as, or a client', () => {
    expect(selectedPartyType({ type: 'agent', PRaccounts: [], selectedAccount: 3 })).toBe('agent');
    expect(selectedPartyType({ type: 'all', PRaccounts: [], selectedAccount: 3 })).toBe('client');
    expect(selectedPartyType({})).toBe('client');
  });
});

describe('the print names it', () => {
  const state = (over) => ({
    advance: true, totalReceivable: 1000, exRate: 1, currency: 'PKR', payType: 'Recievable',
    invoices: [], PRaccounts: PARTIES, oldVouchers: [], receivingAccounts: [],
    type: 'all', transactionMode: 'Cash', subType: 'Cash', date: '2026-11-16', ...over,
  });

  test('an agent\'s receipt, not "All Receipt"', () => {
    render(<PrintTransaction companyId={1} state={state({ selectedAccount: 3 })} />);
    expect(screen.getByText('Agent Receipt')).toBeTruthy();
    expect(screen.queryByText(/All Receipt/)).toBeNull();
  });

  test('a vendor\'s payment', () => {
    render(<PrintTransaction companyId={1} state={state({ selectedAccount: 4, payType: 'Payble' })} />);
    expect(screen.getByText('Vendor Payment')).toBeTruthy();
  });
});

describe('the save stores it', () => {
  const actionRef = { current: null };
  const Harness = ({ init }) => {
    const [state, dispatch] = useReducer(reducer, init);
    return <BillComp back={() => {}} companyId={1} state={state} dispatch={dispatch} actionRef={actionRef} />;
  };

  test.each([[3, 'agent'], [4, 'vendor'], [6, 'client']])('party %i is saved as %s, not as the list\'s "all"', async (party, type) => {
    mockPost.mockClear();
    render(<Harness init={{
      ...reducer(undefined, { type: 'init' }),
      type: 'all', PRaccounts: PARTIES, selectedAccount: party,
      transactionMode: 'Cash', currency: 'PKR', exRate: 1, receivingAccount: 5,
      advance: true, totalReceivable: 10000,
    }} />);
    act(() => { actionRef.current(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve & Save' })); });
    const made = mockPost.mock.calls.find(([url]) => /\/voucher\/makeTransaction$/.test(url));
    expect(made).toBeTruthy();
    expect(made[1].partyType).toBe(type);
  });
});

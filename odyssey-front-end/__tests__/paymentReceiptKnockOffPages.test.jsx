/**
 * Auto knock-off on Payments & Receipts, past the page on screen -
 * Components/Layouts/AccountsComp/PaymentsReceipt/BillComp.
 *
 * Reported 2026-10-20: an amount bigger than the invoices on the page put the
 * rest on that page's last invoice and stopped, with the party's other pages
 * untouched. The screen now loads the next pages, one at a time, until the
 * amount is settled or there are no more. The rules are pinned in
 * paymentReceiptSelection.test; these drive the screen with a real store.
 */
import React, { useReducer } from 'react';
import { render, waitFor, act } from '@testing-library/react';
import reducer, { setPRField } from '../redux/paymentReciept/paymentRecieptSlice';

const mockGet = jest.fn();
const mockNotify = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: jest.fn() }));
jest.mock('Components/Shared/Notification', () => (...a) => mockNotify(...a));
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-redux', () => ({ useSelector: (fn) => fn({ fiscalYear: { value: 1 } }), useDispatch: () => jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));

// eslint-disable-next-line import/first
import BillComp from '../Components/Layouts/AccountsComp/PaymentsReceipt/BillComp';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

const inv = (id, day) => ({
  id, invoice_No: `JI-${id}`, party_Id: 5, createdAt: `2026-01-${String(day).padStart(2, '0')}`,
  total: '100', roundOff: '0', payType: 'Recievable', recieved: '0', paid: '0',
  currency: 'PKR', ex_rate: '1', receiving: 0, constReceiving: '0',
});
// Pages of two, five invoices - oldest first, as the server pages them.
const PAGES = { 1: [inv(1, 1), inv(2, 2)], 2: [inv(3, 3), inv(4, 4)], 3: [inv(5, 5)] };

let store;
const Harness = ({ init }) => {
  const [state, dispatch] = useReducer(reducer, init);
  store = { state, dispatch };
  return <BillComp back={() => {}} companyId={1} state={state} dispatch={dispatch} actionRef={{ current: null }} />;
};

const invoiceCalls = () => mockGet.mock.calls.filter(([, cfg]) => cfg?.headers?.page);

const open = () => {
  const init = {
    ...reducer(undefined, { type: 'init' }),
    selectedAccount: 5, autoKnockOff: true, knockOffAmount: 0,
    invoices: PAGES[1], invoicePage: 1, invoicePageSize: 2, invoiceCount: 5,
  };
  render(<Harness init={init} />);
};
const typeAmount = (value) => act(() => { store.dispatch(setPRField({ field: 'knockOffAmount', value })); });
const paid = () => Object.fromEntries(
  Object.values(store.state.selectedInvoices).map((e) => [e.id, e.receiving]),
);

beforeEach(() => {
  mockGet.mockReset();
  mockNotify.mockReset();
  mockGet.mockImplementation((url, cfg) => {
    const page = cfg?.headers?.page;
    if (!page) return Promise.resolve({ data: { result: [] } });
    return Promise.resolve({ data: { result: (PAGES[page] || []).map((x) => ({ ...x })), count: 5 } });
  });
});

test('an amount past the page settles invoices on the next page, not the page’s last', async () => {
  open();
  typeAmount(350);
  await waitFor(() => expect(paid()).toEqual({ 1: 100, 2: 100, 3: 100, 4: 50 }));
  // Only as far as the amount needed - page 3 was never asked for.
  expect(invoiceCalls().map(([, cfg]) => cfg.headers.page)).toEqual(['2']);
  // Asked for exactly as the list is: the same party, size and open-only rule.
  expect(invoiceCalls()[0][1].headers).toMatchObject({ id: 5, limit: '2', outstanding: 'true' });
  // The list on screen stays where it was.
  expect(store.state.invoicePage).toBe(1);
  expect(store.state.invoices.map((i) => i.id)).toEqual([1, 2]);
});

test('carries on page after page; more than everything open lands on the newest', async () => {
  open();
  typeAmount(1000);
  await waitFor(() => expect(paid()).toEqual({ 1: 100, 2: 100, 3: 100, 4: 100, 5: 600 }));
  expect(invoiceCalls().map(([, cfg]) => cfg.headers.page)).toEqual(['2', '3']);
});

test('an amount the page covers asks the server for nothing', async () => {
  open();
  typeAmount(150);
  await waitFor(() => expect(paid()).toEqual({ 1: 100, 2: 50 }));
  expect(invoiceCalls()).toHaveLength(0);
});

test('typing digit by digit reads each page once and ends where the full amount does', async () => {
  open();
  for (const v of [3, 35, 350, 3500]) typeAmount(v);
  await waitFor(() => expect(paid()).toEqual({ 1: 100, 2: 100, 3: 100, 4: 100, 5: 3100 }));
  typeAmount(350);
  await waitFor(() => expect(paid()).toEqual({ 1: 100, 2: 100, 3: 100, 4: 50 }));
  expect(invoiceCalls().map(([, cfg]) => cfg.headers.page)).toEqual(['2', '3']);
});

test('a page that fails to load says so, and the page on screen is still paid', async () => {
  mockGet.mockImplementation((url, cfg) => (cfg?.headers?.page
    ? Promise.reject(new Error('offline'))
    : Promise.resolve({ data: { result: [] } })));
  open();
  typeAmount(350);
  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('Error', expect.stringMatching(/next page/), 'red'));
  expect(paid()).toEqual({ 1: 100, 2: 250 });
});

/**
 * An invoice paid over, adjusted back to zero on Payments & Receipts -
 * Components/Layouts/AccountsComp/PaymentsReceipt/BillComp.
 *
 * Reported 2026-10-26: an invoice of 1,120.50 received at 1,121 stood at
 * -0.50, and the Receiving Amount box turned -0.50 into 0.50, so it could not
 * be adjusted into bad debts. The rule is pinned in paymentReceiptSelection.test
 * (allowedAmount); this drives the screen to the journal it posts.
 */
import React, { useReducer } from 'react';
import { render, act, fireEvent, screen } from '@testing-library/react';
import reducer from '../redux/paymentReciept/paymentRecieptSlice';

const mockGet = jest.fn(() => Promise.resolve({ data: { result: [] } }));
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
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

const PARTY = 3; const BAD_DEBTS = 11;
const inv = (id, total, recieved, day) => ({
  id, invoice_No: `JI-${id}`, party_Id: PARTY, createdAt: `2026-01-${String(day).padStart(2, '0')}`,
  total: String(total), roundOff: '0', payType: 'Recievable', recieved: String(recieved), paid: '0',
  currency: 'PKR', ex_rate: '1', receiving: 0, constReceiving: String(recieved),
});
const OVER = inv(1, 1120.5, 1121, 1);
const OPEN = inv(2, 500, 0, 2);
// 566,674.52 received at 566,675: -0.4799999999 open in floating point.
const ODD = inv(3, 566674.52, 566675, 3);

let store;
const actionRef = { current: null };
const Harness = ({ init }) => {
  const [state, dispatch] = useReducer(reducer, init);
  store = { state, dispatch };
  return <BillComp back={() => {}} companyId={1} state={state} dispatch={dispatch} actionRef={actionRef} />;
};

const open = () => render(<Harness init={{
  ...reducer(undefined, { type: 'init' }),
  transactionMode: 'Adjust', currency: 'PKR', exRate: 1,
  selectedAccount: PARTY, receivingAccount: BAD_DEBTS,
  invoices: [OVER, OPEN, ODD], invoicePage: 1, invoicePageSize: 50, invoiceCount: 3,
}} />);

const boxOf = (invoiceNo) => screen.getByText(invoiceNo).closest('tr').querySelector('input.ant-input-number-input');
const type = (invoiceNo, value) => act(() => { fireEvent.change(boxOf(invoiceNo), { target: { value } }); });
const paid = () => Object.fromEntries(Object.values(store.state.selectedInvoices).map((e) => [e.id, e.receiving]));

test('-0.50 against it clears it into the chosen account: the party debited, bad debts credited', () => {
  open();
  type('JI-1', '-0.5');
  expect(paid()).toEqual({ 1: -0.5 });
  expect(store.state.totalReceivable).toBe(-0.5);

  act(() => { actionRef.current(); });
  const lines = store.state.transactions.filter((x) => x.accountName !== 'Total');
  expect(lines).toEqual([
    expect.objectContaining({ accountType: 'partyAccount', partyId: PARTY, debit: 0.5, credit: 0, type: 'debit' }),
    expect.objectContaining({ accountType: 'payAccount', partyId: BAD_DEBTS, debit: 0, credit: 0.5, type: 'credit' }),
  ]);
});

test('no further than zero, and a minus on an invoice still owing is dropped as before', () => {
  open();
  type('JI-1', '-5');
  type('JI-2', '-50');
  expect(paid()).toEqual({ 1: -0.5, 2: 50 });
});

test('select-all leaves it alone - only its own row puts a minus on a receipt', () => {
  open();
  const all = screen.getByTitle('Allocate every invoice on this page in full');
  act(() => { fireEvent.click(all); });
  expect(paid()).toEqual({ 2: 500 });
  expect(screen.getByTitle('Clear every invoice on this page').checked).toBe(true);
});

const rowOf = (invoiceNo) => screen.getByText(invoiceNo).closest('tr');
const balanceCell = (invoiceNo) => rowOf(invoiceNo).querySelectorAll('td')[11];
const tickOf = (invoiceNo) => rowOf(invoiceNo).querySelector('input[type="checkbox"]');

test("-0.48 against 566,674.52 received at 566,675: balance 0, black, ticked (the user's report)", () => {
  open();
  expect(balanceCell('JI-3').textContent).toBe('-0.48');
  expect(balanceCell('JI-3').className).toContain('pr-balance-red');
  type('JI-3', '-0.48');
  expect(paid()).toEqual({ 3: -0.48 });
  expect(balanceCell('JI-3').textContent).toBe('0');
  expect(balanceCell('JI-3').className).toContain('pr-balance-black');
  expect(tickOf('JI-3').checked).toBe(true);
});

test('its own tick puts -0.48 in the box - no float dust, no commas after the point', () => {
  open();
  act(() => { fireEvent.click(tickOf('JI-3')); });
  expect(paid()).toEqual({ 3: -0.48 });
  expect(boxOf('JI-3').value).toBe('-0.48');
  expect(balanceCell('JI-3').textContent).toBe('0');
});

test('-0.47 leaves -0.01 owed back - shown, red, not ticked', () => {
  open();
  type('JI-3', '-0.47');
  expect(balanceCell('JI-3').textContent).toBe('-0.01');
  expect(balanceCell('JI-3').className).toContain('pr-balance-red');
  expect(tickOf('JI-3').checked).toBe(false);
});

/**
 * A payment / receipt OPENED on Payments & Receipts - PaymentsReceipt/BillComp.
 *
 * ACS-BRV-00856/24 is on the list at 1,775,000 and opened at 96,386 (the user,
 * 2026-11-06): the box headed "Total Receivable Amount" holds what the
 * voucher's ticks knock off, and this advance had knocked off two invoices
 * only. It is headed Knocked Off now, with the voucher's own amount and what
 * stays on it as advance beside it; saving it as an edit (which would have cut
 * it to 96,386) is refused, and after Refresh it is settled, not rebuilt.
 */
import React, { useReducer } from 'react';
import { render, act, screen, fireEvent } from '@testing-library/react';
import reducer from '../redux/paymentReciept/paymentRecieptSlice';
import { seedFromSaved } from '../functions/paymentReceiptSelection';

const mockGet = jest.fn(() => Promise.resolve({ data: { result: [] } }));
const mockPost = jest.fn(() => Promise.resolve({ data: { status: 'success', result: { left: 1678614 } } }));
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
const mockNotify = jest.fn();
jest.mock('Components/Shared/Notification', () => (...a) => mockNotify(...a));
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-redux', () => ({ useSelector: (fn) => fn({ fiscalYear: { value: 1 } }), useDispatch: () => jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => 'emp-1' }));

// eslint-disable-next-line import/first
import BillComp from '../Components/Layouts/AccountsComp/PaymentsReceipt/BillComp';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

const PARTY = 5686; const BANK = 12;
const inv = (id, invoiceNo, total, share) => ({
  id, invoice_No: invoiceNo, party_Id: PARTY, createdAt: '2024-04-01', total: String(total), roundOff: '0',
  payType: 'Recievable', recieved: String(share), paid: '0', currency: 'PKR', ex_rate: '1',
  receiving: share, constReceiving: share,
});
const SAVED = [inv(7085, 'ACS-JI-1558/24', 16530, 16530), inv(7087, 'ACS-JI-1559/24', 79856, 79856)];

let store;
const actionRef = { current: null };
const Harness = ({ init }) => {
  const [state, dispatch] = useReducer(reducer, init);
  store = { state, dispatch };
  return <BillComp back={() => {}} companyId={1} state={state} dispatch={dispatch} actionRef={actionRef} />;
};
// As openOldVouchers leaves it: the voucher's own amount, its invoices at
// their shares, nothing else picked.
const openIt = (over = {}) => render(<Harness init={{
  ...reducer(undefined, { type: 'init' }),
  edit: true, voucherId: 21920, voucherAmount: 1775000, totalReceivable: 1775000,
  transactionMode: 'Bank', subType: 'Cheque', checkNo: '12508610', currency: 'PKR', exRate: 1,
  selectedAccount: PARTY, receivingAccount: BANK,
  invoices: SAVED, selectedInvoices: seedFromSaved(SAVED), invoicePage: 1, invoicePageSize: 50, invoiceCount: 2,
  ...over,
}} />);

beforeEach(() => { mockPost.mockClear(); mockNotify.mockClear(); });

test("opened, it shows its own amount - not just what it knocked off", () => {
  openIt();
  expect(screen.getByText('Knocked Off')).toBeTruthy();
  expect(screen.queryByText('Total Receivable Amount')).toBeNull();
  expect(screen.getByText('96,386.00')).toBeTruthy();
  expect(screen.getByTestId('settle-amount').textContent).toBe('1,775,000.00');
  expect(screen.getByText('Stays as Advance:')).toBeTruthy();
  expect(screen.getByTestId('settle-left').textContent).toBe('1,678,614.00');
});

test('saving it as an edit is refused - it would cut the receipt to 96,386', () => {
  openIt();
  act(() => { actionRef.current(); });
  expect(mockNotify).toHaveBeenCalledWith('Failure', expect.stringMatching(/^Press Refresh to settle invoices/), 'red');
  expect(mockPost).not.toHaveBeenCalled();
});

test('after Refresh it is settled: only the ticks are sent, to settleTransaction', async () => {
  openIt({ editing: true });
  await act(async () => { actionRef.current(); });
  expect(mockPost).toHaveBeenCalledTimes(1);
  const [url, body] = mockPost.mock.calls[0];
  expect(url).toMatch(/\/voucher\/settleTransaction$/);
  expect(body).toEqual({
    voucherId: 21920, employeeId: 'emp-1',
    invoices: [{ id: 7085, receiving: 16530 }, { id: 7087, receiving: 79856 }],
  });
  expect(mockNotify).toHaveBeenCalledWith('Success', 'Settled - 1,678,614.00 stays on this voucher as advance', 'green');
});

/* Settling cannot go over (the user, 2026-11-06): ticking takes no more than
 * the voucher has left; the invoice that reaches the end takes the rest. */
test('ticked past what is left, the last invoice takes only the rest', () => {
  const open = (id, no, total) => ({ ...inv(id, no, total, 0), recieved: '0', receiving: 0, constReceiving: 0, Invoice_Transactions: [] });
  const JI685 = open(9685, 'ACS-JI-685/27', 1263520.1);
  const JI645 = open(9645, 'ACS-JI-645/27', 987189.2);
  openIt({ editing: true, invoices: [...SAVED, JI685, JI645], invoiceCount: 4 });
  const tick = (no) => act(() => { fireEvent.click(screen.getByText(no).closest('tr').querySelector('input[type="checkbox"]')); });

  tick('ACS-JI-685/27');
  tick('ACS-JI-645/27');
  const shares = Object.fromEntries(Object.values(store.state.selectedInvoices).map((e) => [e.id, e.receiving]));
  // 1,775,000 less the 96,386 already knocked off, less JI-685's 1,263,520.10.
  expect(shares).toEqual({ 7085: 16530, 7087: 79856, 9685: 1263520.1, 9645: 415093.9 });
  expect(mockNotify).toHaveBeenCalledWith('Settled up to what is left', expect.any(String), 'orange');
  expect(screen.getByText('Stays as Advance:')).toBeTruthy();
  expect(screen.getByTestId('settle-left').textContent).toBe('0');
});

// Its own invoices, paid off, show ticked - they stood unticked, and ticking
// them did nothing (the user's screenshot of ACS-BRV-00660/25, 2026-11-06).
test("the voucher's own paid-off invoices show ticked, opened or settling", () => {
  const ticked = (no) => screen.getByText(no).closest('tr').querySelector('input[type="checkbox"]').checked;
  openIt();
  expect([ticked('ACS-JI-1558/24'), ticked('ACS-JI-1559/24')]).toEqual([true, true]);
});

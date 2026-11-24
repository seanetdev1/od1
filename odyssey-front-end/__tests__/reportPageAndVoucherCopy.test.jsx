/**
 * Two requests of 2026-10-22:
 *  - a report keeps its page when the user switches tabs and comes back
 *    (functions/rememberedPage, on Job Balancing and the other paged reports);
 *  - the voucher number on the Payments & Receipts list can be selected and
 *    copied - clicking it no longer opens the transaction.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: jest.fn() },
  useRouter: () => ({ asPath: '/', query: {}, push: jest.fn() }),
}));

// The report's address - its filters are in it. Outside the app's router the
// hook reads the browser's, so the tests move that.
const goTo = (path) => window.history.pushState({}, '', path);

const mockDispatch = jest.fn();
let mockState = {};
jest.mock('react-redux', () => ({
  useSelector: (fn) => fn({ paymentReciept: mockState, fiscalYear: { value: 1 } }),
  useDispatch: () => mockDispatch,
}));
jest.mock('apis/axiosClient', () => ({
  get: jest.fn(() => Promise.resolve({ data: { status: 'success', result: [], totalPages: 1, total: 0 } })),
  post: jest.fn(() => Promise.resolve({ data: {} })),
}));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: jest.fn() }));

// eslint-disable-next-line import/first
import { useRememberedPage, forgetRememberedPages } from '../functions/rememberedPage';

// Something the list imports needs TextEncoder, which jsdom lacks - so it is
// supplied first and the screen required after.
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;
const PaymentsReceipt = require('../Components/Layouts/AccountsComp/PaymentsReceipt').default;

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

describe('a report keeps its page across a tab switch', () => {
  let api;
  const Report = ({ name = 'jobBalancing' }) => {
    const [page, setPage] = useRememberedPage(name);
    api = { page, setPage };
    return <span data-testid='page'>{page}</span>;
  };
  const shown = () => screen.getByTestId('page').textContent;

  beforeEach(() => {
    forgetRememberedPages();
    goTo('/reports/jobBalancing/report?company=1&from=2026-07-01');
  });

  test('left on page 6, back on page 6 - it starts at 1 the first time', () => {
    const { unmount } = render(<Report />);
    expect(shown()).toBe('1');
    act(() => api.setPage(6));
    unmount(); // switching to another tab
    render(<Report />);
    expect(shown()).toBe('6');
  });

  test('a run with other filters starts at the beginning', () => {
    const { unmount } = render(<Report />);
    act(() => api.setPage(6));
    unmount();
    goTo('/reports/jobBalancing/report?company=1&from=2026-08-01');
    render(<Report />);
    expect(shown()).toBe('1');
  });

  test('each report remembers its own, and an updater works like useState', () => {
    const first = render(<Report name='ledger' />);
    act(() => api.setPage((p) => p + 2));
    expect(shown()).toBe('3');
    first.unmount();
    const other = render(<Report name='trialBalance' />);
    expect(shown()).toBe('1');
    other.unmount();
    render(<Report name='ledger' />);
    expect(shown()).toBe('3');
  });
});

describe('the Payments & Receipts list', () => {
  const voucher = {
    id: 77, voucherNo: 'SNS-BRV-123/27', name: 'WORLD LINK SHIPPING AGENCY', party: 'client', type: 'BRV',
    data: '2026-10-20', currency: 'PKR', amount: 1500, partyId: '9', x: { invoice: [], Invoice_Transactions: [], Voucher_Heads: [] },
  };
  const open = () => {
    mockState = { oldVouchers: [voucher], selectedAccount: undefined, search: '', transactions: [], PRaccounts: [], invoices: [] };
    render(<PaymentsReceipt q={{}} />);
  };
  const opened = () => mockDispatch.mock.calls.some(([a]) => a?.type?.endsWith('clearVoucher'));

  beforeEach(() => mockDispatch.mockClear());

  test('clicking the voucher number does not open the transaction, so it can be copied', () => {
    open();
    const cell = screen.getByText('SNS-BRV-123/27');
    fireEvent.click(cell);
    expect(opened()).toBe(false);
    expect(cell.style.userSelect).toBe('text');
  });

  test('the rest of the row still opens it', () => {
    open();
    fireEvent.click(screen.getByText('WORLD LINK SHIPPING AGENCY'));
    expect(opened()).toBe(true);
  });
});

/* The list's search (the user, 2026-11-06): a search that found nothing left
 * the previous list on screen, and a fetch made while one was loading was
 * dropped - so the list could show an earlier word's results. */
describe('the Payments & Receipts list search', () => {
  const axios = require('apis/axiosClient');
  const row = (id, name) => ({
    id, voucher_Id: `V-${id}`, partyName: name, partyType: 'client', vType: 'BRV', createdAt: '2026-10-20',
    currency: 'PKR', invoice: [], Invoice_Transactions: [], Voucher_Heads: [],
  });
  const answer = (rows) => ({ data: { status: 'success', result: rows, totalPages: 1, total: rows.length } });
  // The list's own fetches carry a page; the party picker's do not.
  const listed = () => mockDispatch.mock.calls.map(([a]) => a?.payload)
    .filter((p) => p?.field === 'oldVouchers').map((p) => p.value.map((v) => v.name));
  const show = (search) => {
    mockState = { oldVouchers: [], selectedAccount: undefined, search, transactions: [], PRaccounts: [], invoices: [] };
    return render(<PaymentsReceipt q={{}} />);
  };

  beforeEach(() => mockDispatch.mockClear());
  afterEach(() => axios.get.mockImplementation(() => Promise.resolve(answer([]))));

  test('nothing found empties the list, and says so', async () => {
    axios.get.mockImplementation(() => Promise.resolve(answer([])));
    await act(async () => { show('zzz'); });
    expect(listed()).toContainEqual([]);
    expect(screen.getByText('Nothing found for "zzz"')).toBeTruthy();
  });

  test('an older answer arriving last does not replace the newer one', async () => {
    const pending = [];
    axios.get.mockImplementation((url, cfg) => (cfg?.params?.page
      ? new Promise((resolve) => pending.push(resolve))
      : Promise.resolve(answer([]))));
    await act(async () => { show('hasnain'); });
    expect(pending.length).toBeGreaterThanOrEqual(2);
    // The newest request answers first, then the older one.
    await act(async () => { pending[pending.length - 1](answer([row(2, 'NEWEST')])); });
    await act(async () => { pending[0](answer([row(1, 'OLDER')])); });
    expect(listed()).toEqual([['NEWEST']]);
  });
});

/* OPENED BY ITS ADDRESS (the user, 2026-11-20: "payment/receipt entries not
 * opening from ledger"). The Ledger sends /accounts/paymentReceipt/<id>; the
 * screen only looked in the list's loaded page, so an older voucher never
 * opened. Not on the page, it is fetched by its id and opened. */
describe('a payment or receipt opened from the Ledger', () => {
  const axios = require('apis/axiosClient');
  const raw = {
    id: 88, voucher_Id: 'SNS-BRV-12/25', partyName: 'OLD PARTY', partyType: 'client', partyId: '9', vType: 'BRV',
    createdAt: '2025-03-01', currency: 'PKR', invoice: [], Invoice_Transactions: [], Voucher_Heads: [],
    createdBy: 'Hasnain', createdOn: '2025-03-01T10:00:00Z',
  };
  const payloads = () => mockDispatch.mock.calls.map(([a]) => a?.payload).filter(Boolean);
  beforeEach(() => mockDispatch.mockClear());
  afterEach(() => axios.get.mockImplementation(() => Promise.resolve({ data: { status: 'success', result: [], totalPages: 1, total: 0 } })));

  test('one not on the loaded page is fetched by its id and opened', async () => {
    axios.get.mockImplementation((url, cfg) => Promise.resolve({ data: {
      status: 'success', result: cfg?.params?.id === 88 ? [raw] : [], totalPages: 1, total: cfg?.params?.id ? 1 : 0,
    } }));
    mockState = { oldVouchers: [], selectedAccount: undefined, search: '', transactions: [], PRaccounts: [], invoices: [] };
    await act(async () => { render(<PaymentsReceipt id='88' q={{}} />); });

    const byId = axios.get.mock.calls.find(([, cfg]) => cfg?.params?.id === 88);
    expect(byId).toBeTruthy();
    expect(payloads()).toContainEqual({ field: 'voucherId', value: 88 });
    // The record itself, for its number, stamps and cheque return.
    expect(payloads()).toContainEqual({ field: 'openedVoucher', value: expect.objectContaining({ voucher_Id: 'SNS-BRV-12/25', createdBy: 'Hasnain' }) });
  });
});

/* Who made it and who last changed it, on an open voucher (the user,
 * 2026-11-20: not shown on Payments & Receipts). */
describe('an open payment or receipt', () => {
  test('shows its created and edited stamps', async () => {
    mockState = {
      oldVouchers: [], selectedAccount: 9, edit: true, voucherId: 88, search: '', transactions: [], PRaccounts: [],
      invoices: [], selectedInvoices: {}, payType: 'Recievable', currency: 'PKR', receivingAccounts: [], adjustAccounts: [],
      openedVoucher: { id: 88, voucher_Id: 'V-88', createdBy: 'Hasnain', createdOn: '2026-11-01T09:30:00Z', editedBy: 'Bilal', editedOn: '2026-11-02T10:00:00Z' },
    };
    await act(async () => { render(<PaymentsReceipt id='88' q={{}} />); });
    const stamp = screen.getByTestId('audit-stamp');
    expect(stamp.textContent).toMatch(/Created by Hasnain on \d\d-11-2026/);
    expect(stamp.textContent).toMatch(/Edited by Bilal on \d\d-11-2026/);
  });
});

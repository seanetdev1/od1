/**
 * Every screen moved onto the unified toolbar (PageActions) on 2026-11-13
 * puts its title there and its own verbs in the toolbar's places - rendered
 * here with the real bar, so a screen that throws, calls the hook below an
 * early return, or registers nothing is caught.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { store } from 'redux/store';
import { PageActionsProvider, PageActionBar } from 'Components/Shared/PageActions';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

jest.mock('apis/axiosClient', () => {
  const ok = () => Promise.resolve({ data: { status: 'success', result: [], data: [], records: [], count: 0, total: 0 } });
  return { __esModule: true, default: { get: jest.fn(ok), post: jest.fn(ok), defaults: { headers: {} } }, get: jest.fn(ok), post: jest.fn(ok) };
});
jest.mock('axios', () => {
  const ok = () => Promise.resolve({ data: { status: 'success', result: [] } });
  const a = { get: jest.fn(ok), post: jest.fn(ok), create: () => a, defaults: { headers: {} }, interceptors: { request: { use: () => {} }, response: { use: () => {} } } };
  return { __esModule: true, default: a, ...a };
});
jest.mock('next/router', () => {
  const router = { push: jest.fn(() => Promise.resolve()), replace: jest.fn(() => Promise.resolve()), query: {}, pathname: '/', isReady: true, events: { on: () => {}, off: () => {} } };
  return { __esModule: true, default: router, ...router, useRouter: () => router };
});
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('next/dynamic', () => () => function Dynamic() { return null; });
// The employee screen imports prettier (unused) - jest cannot load it.
jest.mock('prettier', () => ({ check: () => {} }));
jest.mock('apis/awbl', () => ({
  getAwblList: jest.fn(() => Promise.resolve({ status: 'success', result: { rows: [], count: 0 } })),
  deleteAwbl: jest.fn(),
}));
jest.mock('react-to-print', () => ({ __esModule: true, default: () => null, useReactToPrint: () => jest.fn() }));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const L = (p) => require(`../Components/Layouts/${p}`).default;

const show = async (Screen, props = {}) => {
  await act(async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Provider store={store}>
          <PageActionsProvider>
            <PageActionBar />
            <Screen {...props} />
          </PageActionsProvider>
        </Provider>
      </QueryClientProvider>,
    );
  });
};

const toolbarTitle = () => document.querySelector('.page-header-bar h4')?.textContent;

const SCREENS = [
  // [name, component, props, toolbar title, buttons it offers]
  ['Airports', 'Setup/Airports', { airportsData: { result: [] } }, 'Airports', ['New Airport']],
  ['Final Destinations', 'Setup/Destinations', { destinationsData: { result: [] } }, 'Final Destinations', ['New Destination']],
  ['Ports', 'Setup/portOfDischarge', { portsData: { result: [] } }, 'Ports', ['New Port']],
  ['Commodity', 'Setup/Commodity', { CommodityData: { result: [] } }, 'Commodity', ['New Commodity']],
  ['Vessels', 'Setup/Vessel', {}, 'Vessels', ['New Vessel']],
  ['Voyages', 'Setup/Voyage', { vesselsData: [] }, 'Voyages', ['New Voyage']],
  ['Employees', 'Setup/Employees', {}, 'Employees', ['New Employee']],
  ['Fiscal Years', 'Setup/FiscalYears', {}, 'Fiscal Years', ['New Fiscal Year']],
  ['Vendors', 'Setup/Vendor', { vendorData: { result: [] }, sessionData: { isLoggedIn: true } }, 'Vendors', ['New Vendor']],
  ['Non-GL Parties', 'Setup/Non_Gl_Parties', { clientData: { result: [] }, sessionData: { isLoggedIn: true } }, 'Non-GL Parties', ['New Non-GL Party']],
  ['Parties', 'Setup/Client', { clientData: { result: [] }, sessionData: { isLoggedIn: true } }, 'Parties', []],
  ['AWB Numbers', 'Setup/Awbl', {}, 'AWB Numbers', ['Register AWB', 'Print']],
  ['Office Vouchers', 'AccountsComp/OfficeVouchers', { voucherList: [] }, 'Office Vouchers', ['New Office Voucher']],
  ['Opening Balances', 'AccountsComp/OpeningBalance/List', {}, 'Opening Balances', ['New Opening Balance']],
  ['Opening Invoices', 'AccountsComp/OpeningInvoices/List', {}, 'Opening Invoices', ['New Opening Invoice']],
  ['Vouchers', 'AccountsComp/Voucher/VoucherList', {}, 'Vouchers', ['New Voucher']],
  ['Chart of Accounts', 'AccountsComp/ChartOFAccount', { accountsData: { result: [] } }, 'Chart of Accounts', ['New Account', 'Export to Excel']],
  ['Credit Control', 'AccountsComp/CreditControl', {}, 'Credit Control', []],
  ['Manifest List', 'Manifest', { manifest: [] }, 'Manifest List', ['New Manifest']],
  ['Sea Export BL List', 'JobsLayout/BlList', { partiesData: {}, BlsData: [], type: 'SE' }, 'Sea Export BL List', []],
  ['Tasks', 'Tasks/TasksList', {}, 'Tasks', ['New Task']],
  ['Tracking', 'Tasks/Tracking', {}, 'Tracking', ['New Tracking Task']],
  ['Riders', 'Tasks', {}, 'Riders', []],
  ['Trial Balance', 'Reports/TrialBalance', {}, 'Trial Balance', []],
  ['Ledger', 'Reports/Ledger', {}, 'Ledger', []],
  ['Sales Report', 'Reports/SalesReport', {}, 'Sales Report', []],
  ['Customs Register', 'Reports/CustomsRegister', {}, 'Customs Register', []],
  ['Account Activity', 'Reports/AccountActivity', {}, 'Account Activity', []],
  ['Balance Sheet', 'Reports/BalanceSheet', {}, 'Balance Sheet', []],
  ['Climax Data Reconciliation', 'Reports/ClimaxReconciliation', {}, 'Climax Data Reconciliation', []],
  ['Income Statement', 'Reports/IncomeStatement', {}, 'Income Statement', []],
  ['Invoice Balancing', 'Reports/InvoiceBalancing', {}, 'Invoice Balancing', []],
  ['Job Balancing', 'Reports/JobBalancing', {}, 'Job Balancing', []],
  ['LG VAT', 'Reports/LgVat', { query: {}, result: {} }, 'LG VAT', []],
  ['Configuration', 'Config', {}, 'Configuration', []],
  ['Sea Export Job List', 'JobsLayout/JobsList', { type: 'SE' }, 'Sea Export Job List', ['New Sea Export Job']],
  ['Trial Balance report', 'Reports/TrialBalance/Report', { query: { from: '2026-07-01', to: '2026-11-13' }, result: { status: 'success', result: { rows: [], columns: [] } } }, 'Trial Balance', ['Export to Excel']],
];

// 20 s, not jest's 5: each case loads a whole screen's module tree, and the
// first - Chart of Accounts - loads the shared ones too. It ran past 5 s once
// in a full run with every suite loading at once (2026-11-15).
test.each(SCREENS)('%s puts its title and buttons on the toolbar', async (_, path, props, title, buttons) => {
  await show(L(path), props);
  expect(toolbarTitle()).toBe(title);
  for (const name of buttons) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  }
}, 20000);

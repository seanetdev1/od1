/**
 * The ledger PDF (2026-11-13). The server prints the bare page
 * pages/ledger-print in a headless browser with no login session. It came
 * out inside the whole app - sidebar, header, Logout - with a blank
 * letterhead, no account name and an empty "Printed By": the page was not one
 * of _app's bare pages, and it had no session to find the company or the user
 * in. The server now sends both with the rows.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import MainTable from '../Components/Layouts/Reports/Ledger/MainTable';
import PrintTopHeader from '../Components/Shared/PrintTopHeader';
import axiosClient from 'apis/axiosClient';

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
const mockActions = jest.fn();
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: (a) => mockActions(a) }));
jest.mock('js-cookie', () => ({ get: (k) => ({ username: 'cookie-user', companyId: '1' }[k]) }));
// No company list in the store - as on the bare print page, which has no session.
jest.mock('functions/companyBranding', () => ({
  ...jest.requireActual('functions/companyBranding'),
  allCompanies: () => [],
}));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const LETTERHEAD = { id: 1, title: 'CARGO LINKERS.', address: 'PLOT NO. 230-A, P.E.C.H.S', printLogo: 'data:image/png;base64,AAAA' };
const ledger = [
  { voucherId: 1, voucher: 'CPV-12/27', date: '2026-07-05T00:00:00.000Z', narration: 'Milk', type: 'debit', amount: 250, balance: 250 },
];

test('the printed ledger heads itself with the letterhead it was given, names its account, and who printed it', () => {
  render(<MainTable ledger={ledger} opening={0} closing={250} name='ENTERTAINMENT' company='1' currency='PKR'
    from='01-07-2026' to='13-11-2026' letterhead={LETTERHEAD} printedBy='Bilal' printOnly />);
  expect(screen.getByText('CARGO LINKERS.')).toBeInTheDocument();
  expect(screen.getByText('PLOT NO. 230-A, P.E.C.H.S')).toBeInTheDocument();
  expect(document.querySelector('img').getAttribute('src')).toBe(LETTERHEAD.printLogo);
  expect(document.querySelector('.ledger-print-account')).toHaveTextContent('Ledger: ENTERTAINMENT');
  expect(document.querySelector('.print-footer')).toHaveTextContent('Printed By: Bilal');
  // The bare page claims no toolbar.
  expect(mockActions).toHaveBeenLastCalledWith(null);
});

test('a foreign-currency ledger says which currency', () => {
  render(<MainTable ledger={ledger} opening={0} closing={250} name='AGENT X' company='1' currency='USD'
    from='01-07-2026' to='13-11-2026' letterhead={LETTERHEAD} printOnly />);
  expect(document.querySelector('.ledger-print-account')).toHaveTextContent('Ledger: AGENT X (USD)');
});

test('without a letterhead record the header still reads the company list, as on screen', () => {
  render(<PrintTopHeader company='1' from='01-07-2026' to='13-11-2026' />);
  // No list on this page: no name, and never another company's.
  expect(screen.queryByText('CARGO LINKERS.')).toBeNull();
  expect(screen.getByText('Dated: 01-07-2026')).toBeInTheDocument();
});

test('the PDF button tells the server whose letterhead to print', async () => {
  axiosClient.get.mockResolvedValue({ data: new Blob(['%PDF']) });
  window.URL.createObjectURL = jest.fn(() => 'blob:x');
  window.URL.revokeObjectURL = jest.fn();
  render(<MainTable ledger={ledger} opening={0} closing={250} name='ENTERTAINMENT' company={1} currency='PKR'
    from='01-07-2026' to='13-11-2026' accountId='5858' />);
  const pdf = mockActions.mock.calls.at(-1)[0].extras.find((x) => x.key === 'pdf');
  await pdf.onClick();
  const headers = axiosClient.get.mock.calls.at(-1)[1].headers;
  expect(headers).toMatchObject({ id: '5858', from: '01-07-2026', to: '13-11-2026', company: '1', letterhead: '1' });
});

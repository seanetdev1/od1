/**
 * Config > Ledger Accounts - Components/Layouts/Config/LedgerAccounts.
 * Separate sections for freight, customs clearance and aviation; aviation has
 * its own row now instead of sharing air freight's.
 */
import React from 'react';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import LedgerAccounts from '../Components/Layouts/Config/LedgerAccounts';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('Components/Shared/Notification', () => jest.fn());

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

beforeEach(() => {
  mockGet.mockImplementation((url) => Promise.resolve({
    data: { result: url === '/settings/ledgerAccounts' ? {} : [{ id: 1, title: 'AIRLINE INCOME' }] },
  }));
});

const section = (title) => screen.getByTestId(`ledger-section-${title}`);
const rowsOf = (title) => within(section(title)).getAllByRole('row').slice(1)
  .map((r) => r.querySelector('b')?.textContent);

test('freight, customs and aviation are separate sections', async () => {
  render(<LedgerAccounts />);
  await screen.findByTestId('ledger-section-Freight');
  expect(rowsOf('Freight')).toEqual(['Air freight', 'FCL freight', 'LCL freight']);
  expect(rowsOf('Customs Clearance')).toEqual(['Sea import', 'Sea export', 'Air import', 'Air export', 'Transport']);
  expect(rowsOf('Aviation')).toEqual(['Aviation flights']);
});

test('aviation no longer rides on the air freight row', async () => {
  render(<LedgerAccounts />);
  await screen.findByTestId('ledger-section-Freight');
  expect(within(section('Freight')).queryByText(/aviation/i)).toBeNull();
  // Behind the row's hint now - its aria-label carries the text.
  expect(within(section('Aviation')).getByLabelText(/uses Air freight's accounts/)).toBeTruthy();
});

test('only customs carries a disbursements column', async () => {
  render(<LedgerAccounts />);
  await screen.findByTestId('ledger-section-Freight');
  expect(within(section('Customs Clearance')).getByText(/Disbursements account/i)).toBeTruthy();
  expect(within(section('Freight')).queryByText(/Disbursements account/i)).toBeNull();
  expect(within(section('Aviation')).queryByText(/Disbursements account/i)).toBeNull();
});

describe('only the operation mode this install runs', () => {
  const withMode = (mode) => mockGet.mockImplementation((url) => Promise.resolve({
    data: url === '/settings/operationMode' ? { status: 'success', mode }
      : { result: url === '/settings/ledgerAccounts' ? {} : [] },
  }));
  const titles = () => screen.queryAllByTestId(/^ledger-section-/).map((el) => el.getAttribute('data-testid'));

  test.each([
    ['freight', 'ledger-section-Freight'],
    ['customs', 'ledger-section-Customs Clearance'],
    ['aviation', 'ledger-section-Aviation'],
  ])('%s shows its own section alone', async (mode, testId) => {
    withMode(mode);
    render(<LedgerAccounts />);
    await screen.findByTestId(testId);
    expect(titles()).toEqual([testId]);
  });

  test('a mode it cannot read shows all three rather than nothing', async () => {
    mockGet.mockImplementation((url) => (url === '/settings/operationMode'
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ data: { result: url === '/settings/ledgerAccounts' ? {} : [] } })));
    render(<LedgerAccounts />);
    await screen.findByTestId('ledger-section-Freight');
    expect(titles()).toHaveLength(3);
  });
});

test('an empty customs row says which account it posts to meanwhile', async () => {
  mockGet.mockImplementation((url) => Promise.resolve({
    data: url === '/settings/operationMode' ? { mode: 'customs' }
      : url === '/settings/ledgerAccounts' ? { result: { CUSTOMS_EXPORT: { income: 7 } } }
        : { result: [{ id: 7, title: 'EXPORT CLEARING INCOME' }] },
  }));
  render(<LedgerAccounts />);
  await screen.findByTestId('ledger-section-Customs Clearance');
  // Sea export and air export both fall back to the old export row.
  expect(screen.getAllByText('Now: EXPORT CLEARING INCOME')).toHaveLength(2);
});

/* Sales tax - the tax on a taxed charge posts to its own account at approval
 * (the server's functions/invoiceTaxSplit). One pair for every job type. */
describe('the sales tax accounts', () => {
  const withMode = (mode, mapping = {}) => mockGet.mockImplementation((url) => Promise.resolve({
    data: url === '/settings/operationMode' ? { mode }
      : url === '/settings/ledgerAccounts' ? { result: mapping }
        : { result: [{ id: 7286, title: 'SALES TAX SRB' }, { id: 12, title: 'INPUT TAX' }] },
  }));

  test.each(['freight', 'customs', 'aviation'])('are offered on a %s install', async (mode) => {
    withMode(mode);
    render(<LedgerAccounts />);
    const tax = await screen.findByTestId('ledger-tax');
    expect(within(tax).getByText('Tax on charges')).toBeTruthy();
    // Unset says what happens meanwhile - nothing moves.
    expect(within(tax).getAllByText('Not set: stays with the charge')).toHaveLength(2);
  });

  test('show what is set, and save it with the rest', async () => {
    withMode('customs', { TAX: { income: 7286, expense: 12 } });
    mockPost.mockResolvedValue({ data: { status: 'success', result: { TAX: { income: 7286, expense: 12 } } } });
    render(<LedgerAccounts />);
    const tax = await screen.findByTestId('ledger-tax');
    expect(within(tax).getByText('SALES TAX SRB')).toBeTruthy();
    expect(within(tax).getByText('INPUT TAX')).toBeTruthy();
    fireEvent.click(screen.getByText('Save ledger accounts'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/settings/ledgerAccounts', {
      mapping: { TAX: { income: 7286, expense: 12 } },
    }));
  });
});

/**
 * Config > Document Numbers - Components/Layouts/Config/DocumentNumbers.
 * Per class (jobs, invoices, vouchers): company short name on/off, year
 * before or after the number, and the codes. The preview follows every change,
 * and Save sends the whole setup.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import DocumentNumbers, { previewNumber } from '../Components/Layouts/Config/DocumentNumbers';

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

const settings = {
  companyPrefix: { jobs: true, invoices: true, vouchers: true },
  yearFirst: { jobs: false, invoices: false, vouchers: false },
  codes: {
    jobs: { SE: 'SEJ', SI: 'SIJ', AE: 'AE', AI: 'AI', CC: 'CCJ' },
    invoices: { 'Job Invoice': 'JI', 'Job Bill': 'JB', 'Agent Invoice': 'AI', 'Agent Bill': 'AB' },
    vouchers: { BRV: 'BRV', BPV: 'BPV', CRV: 'CRV', CPV: 'CPV', 'ADJ-R': 'ADJ-R', 'ADJ-P': 'ADJ-P' },
  },
};
const configurable = {
  jobs: [{ key: 'SE', label: 'Sea Export' }, { key: 'SI', label: 'Sea Import' }, { key: 'AE', label: 'Air Export' },
    { key: 'AI', label: 'Air Import' }, { key: 'CC', label: 'Customs Clearance' }],
  invoices: [{ key: 'Job Invoice', label: 'Job Invoice' }, { key: 'Job Bill', label: 'Job Bill' },
    { key: 'Agent Invoice', label: 'Agent Invoice' }, { key: 'Agent Bill', label: 'Agent Bill' }],
  vouchers: [{ key: 'BRV', label: 'Bank Receipt' }, { key: 'BPV', label: 'Bank Payment' },
    { key: 'CRV', label: 'Cash Receipt' }, { key: 'CPV', label: 'Cash Payment' },
    { key: 'ADJ-R', label: 'Adjustment Receipt' }, { key: 'ADJ-P', label: 'Adjustment Payment' }],
};

beforeEach(() => {
  mockGet.mockResolvedValue({ data: { status: 'success', result: settings, classes: ['jobs', 'invoices', 'vouchers'], configurable } });
  mockPost.mockImplementation((url, body) => Promise.resolve({ data: { status: 'success', result: body } }));
});

test('the preview follows the rule the server formats by', () => {
  expect(previewNumber(settings, 'jobs', 'SEJ')).toBe('ABC-SEJ-140/27');
  const flipped = { ...settings, companyPrefix: { ...settings.companyPrefix, jobs: false }, yearFirst: { ...settings.yearFirst, jobs: true } };
  expect(previewNumber(flipped, 'jobs', 'SEJ')).toBe('SEJ-27/140');
});

test('each class is set on its own, and the preview follows', async () => {
  render(<DocumentNumbers />);
  await screen.findByTestId('numbering-jobs');
  expect(screen.getByTestId('preview-vouchers').textContent).toBe('ABC-BPV-140/27');

  // Vouchers only: short name off, year first.
  fireEvent.click(screen.getByLabelText('Vouchers: company short name in front'));
  fireEvent.click(screen.getByLabelText('Vouchers: year before the number'));
  expect(screen.getByTestId('preview-vouchers').textContent).toBe('BPV-27/140');
  expect(screen.getByTestId('preview-jobs').textContent).toBe('ABC-SEJ-140/27');

  // A code, typed in lower case, shows upper case.
  fireEvent.change(within(screen.getByTestId('numbering-vouchers')).getByLabelText('Bank Payment code'), { target: { value: 'bp' } });
  expect(screen.getByTestId('preview-vouchers').textContent).toBe('BP-27/140');
});

test('every code the user asked for can be named', async () => {
  render(<DocumentNumbers />);
  await screen.findByTestId('numbering-jobs');
  for (const label of ['Sea Export', 'Sea Import', 'Air Export', 'Air Import', 'Customs Clearance',
    'Job Invoice', 'Job Bill', 'Agent Invoice', 'Agent Bill',
    'Bank Receipt', 'Bank Payment', 'Cash Receipt', 'Cash Payment', 'Adjustment Receipt', 'Adjustment Payment']) {
    expect(screen.getByLabelText(`${label} code`)).toBeTruthy();
  }
});

test('Save sends the whole setup, and is only offered when something changed', async () => {
  render(<DocumentNumbers />);
  await screen.findByTestId('numbering-jobs');
  expect(screen.getByText('Saved').disabled).toBe(true);

  fireEvent.click(screen.getByLabelText('Invoices & Bills: company short name in front'));
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(mockPost).toHaveBeenCalled());
  const [url, body] = mockPost.mock.calls[0];
  expect(url).toBe('/settings/documentNumbering');
  expect(body.companyPrefix).toEqual({ jobs: true, invoices: false, vouchers: true });
  expect(body.codes.jobs.CC).toBe('CCJ');
  await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
});

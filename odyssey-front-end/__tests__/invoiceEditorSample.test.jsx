/**
 * "+ Charge" on an unapproved invoice - Components/Shared/InvoiceEditor.
 *
 * Reported 2026-10-20: the SAMPLE CHARGE it added showed on the invoice but
 * not on the job's Charges tab - refreshing the tab did not bring it, Save
 * Charges did. The tab reads a cached list (apis/queryClient), which the save
 * here never marked stale. And the line copied the first line's Amount (580)
 * beside a net of 1, which the sheet would have recalculated to 580.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPost = jest.fn();
const mockInvalidate = jest.fn();
jest.mock('apis/axiosClient', () => ({ post: (...a) => mockPost(...a) }));
jest.mock('apis/queryClient', () => ({ __esModule: true, default: { invalidateQueries: (...a) => mockInvalidate(...a) } }));
jest.mock('functions/delay', () => ({ delay: () => Promise.resolve() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('js-cookie', () => ({ get: () => '1' }));

// eslint-disable-next-line import/first
import InvoiceEditor from '../Components/Shared/InvoiceEditor';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

const first = {
  id: 11, SEJobId: 7, InvoiceId: 40, type: 'Recievable', particular: 'OCEAN FREIGHT', charge: 1,
  qty: '1', amount: '580', rate_charge: '1', discount: '5', tax_apply: true, taxPerc: '15', tax_amount: '87',
  net_amount: '580', currency: 'USD', ex_rate: '283', local_amount: '164140', status: '1',
};

const addSample = async () => {
  mockPost.mockResolvedValue({ data: { status: 'success' } });
  const reload = jest.fn();
  render(<InvoiceEditor data={{ resultOne: { approved: '0', Charge_Heads: [first] } }} reload={reload} />);
  fireEvent.click(screen.getByText('Charge'));
  fireEvent.click(screen.getByText('Add +'));
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  return mockPost.mock.calls[0][1].charges.find((c) => c.particular === 'SAMPLE CHARGE');
};

beforeEach(() => { mockPost.mockReset(); mockInvalidate.mockReset(); });

test('the job’s Charges tab is told to fetch again, so the line shows there', async () => {
  await addSample();
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['charges'] });
});

test('the sample line is one of one throughout - not the first line’s 580', async () => {
  const sample = await addSample();
  expect(sample).toMatchObject({
    amount: '1', rate_charge: '1', qty: '1', discount: '0', net_amount: '1', local_amount: '283',
    tax_apply: false, tax_amount: '0', charge: 0,
  });
  // Still the invoice's: its job, invoice, side and currency.
  expect(sample).toMatchObject({ SEJobId: 7, InvoiceId: 40, type: 'Recievable', currency: 'USD' });
  expect(sample.id).toBeUndefined();
});

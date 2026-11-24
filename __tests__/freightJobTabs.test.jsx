/**
 * Freight job tabs that did not save, or did not show what was saved:
 *   - Charges: the Ex.Rate beside the invoicing buttons
 *   - Loading Program
 *   - Delivery Order (its second save)
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('js-cookie', () => ({ get: (k) => (k === 'loginId' ? '7' : undefined) }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('react-redux', () => ({ useSelector: () => '1', useDispatch: () => jest.fn() }));
jest.mock('apis/jobs', () => ({
  getJobValues: async () => ({ result: {} }),
  getJobById: async () => ({ result: { id: 5, jobNo: 'SNS-SI-5/27', exRate: '281.5', SE_Equipments: [] } }),
}));
// What each screen hands its form - shown, with a Save that submits it.
jest.mock('../Components/Layouts/JobsLayout/Jobs/CreateOrEdit', () => function MockCreateOrEdit({ state }) {
  return <span data-testid='rate'>{String(state.exRate)}</span>;
});
const mockForm = () => function MockForm({ onSubmit, handleSubmit, allValues }) {
  return (
    <div>
      <span data-testid='sob'>{allValues?.sobDate ? allValues.sobDate.format('YYYY-MM-DD') : ''}</span>
      <span data-testid='gatepass'>{allValues?.gatePassDate ? allValues.gatePassDate.format('YYYY-MM-DD') : ''}</span>
      <button type='button' onClick={handleSubmit(onSubmit)}>Save</button>
    </div>
  );
};
jest.mock('../Components/Layouts/JobsLayout/Jobs/Loading Program/LoadingForm', () => mockForm());
jest.mock('../Components/Layouts/JobsLayout/Jobs/Delievery Order/LoadingForm', () => mockForm());

/* eslint-disable global-require */
const SeJob = require('../Components/Layouts/JobsLayout/Jobs').default;
const { jobExRate } = require('../Components/Layouts/JobsLayout/Jobs');
const LoadingProgram = require('../Components/Layouts/JobsLayout/Jobs/Loading Program').default;
const DeliveryOrder = require('../Components/Layouts/JobsLayout/Jobs/Delievery Order').default;
/* eslint-enable global-require */

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

describe('the job\'s Ex.Rate on Charges', () => {
  test('is the job\'s own, or the default when it has none', () => {
    expect(jobExRate({ exRate: '281.5' }, 1)).toBe(281.5);
    expect(jobExRate({ exRate: '' }, 1)).toBe(1);
    expect(jobExRate({ exRate: '0' }, 1)).toBe(1);
    expect(jobExRate(null, 1)).toBe(1);
  });

  test('opens on the rate the job was saved with', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeJob id='5' type='SI' />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('rate').textContent).toBe('281.5'));
  });
});

describe('Loading Program', () => {
  test('shows the dates it was saved with, and saves', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: {
      id: 3, berth: 'B-1', sobDate: '2026-10-01T00:00:00.000Z', gatePassDate: '2026-10-03T00:00:00.000Z',
    } } });
    mockPost.mockResolvedValue({ data: { status: 'success', result: [{ id: 3 }] } });
    render(<LoadingProgram state={{}} jobData={{ id: 5 }} />);

    await waitFor(() => expect(screen.getByTestId('sob').textContent).toBe('2026-10-01'));
    expect(screen.getByTestId('gatepass').textContent).toBe('2026-10-03');

    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost.mock.calls[0][1]).toMatchObject({ id: 3, berth: 'B-1', SEJobId: 5, employeeId: '7' });
  });
});

describe('Delivery Order', () => {
  test('the save after the first updates the same order', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: null } });
    mockPost.mockResolvedValue({ data: { status: 'success', result: [{ id: 9, doNo: 'SNS-DO1-26' }] } });
    render(<DeliveryOrder state={{ InvoiceList: [] }} jobData={{ id: 5 }} companyId='1' />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost.mock.calls[0][1]).toMatchObject({ SEJobId: 5, employeeId: '7' });

    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    expect(mockPost.mock.calls[1][1]).toMatchObject({ id: 9, doNo: 'SNS-DO1-26' });
  });
});

/**
 * The home page's job counters: today in place of the year (the user,
 * 2026-11-23) - freight's Jobs and customs' GDs.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import DashboardStats from '../Components/Layouts/Main/DashboardStats';
import CustomsDashboardStats from '../Components/Layouts/Main/CustomsDashboardStats';

const mockGet = jest.fn();
const mockCustoms = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a) }));
jest.mock('apis/customsJobs', () => ({ getCustomsDashboard: (...a) => mockCustoms(...a) }));
jest.mock('react-redux', () => ({ useSelector: (fn) => fn({ company: { value: '1' } }) }));
jest.mock('Components/Shared/SecondaryLoader', () => () => <div>loading</div>);

// The figure under a tile's heading.
const tile = (heading) => screen.getByText(heading).parentElement;

test('freight: Jobs Today, This Week, This Month - no year', async () => {
  mockGet.mockResolvedValue({ data: { status: 'success', result: {
    dayCount: 3, weekCount: 12, monthCount: 41,
    sns: { snsFcl: 1, snsLCL: 2, snsPending: 0 },
    acs: { acsFcl: 0, acsLCL: 0, acsPending: 0 },
    invocies: { projSales: [] },
  } } });
  render(<DashboardStats />);
  await screen.findByText('Jobs Today');
  expect(tile('Jobs Today').textContent).toContain('3');
  expect(tile('Jobs This Week').textContent).toContain('12');
  expect(tile('Jobs This Month').textContent).toContain('41');
  expect(screen.queryByText('Jobs This Year')).toBeNull();
  // The year's sales figure was not part of the ask, and stays.
  expect(screen.getByText('Receivable Sales This Year')).toBeTruthy();
});

test('customs: GDs Today, dated as a single day, then the week and month - no year', async () => {
  mockCustoms.mockResolvedValue({ status: 'success', result: {
    periods: {
      today: { from: '2026-11-23', to: '2026-11-23' },
      week: { from: '2026-11-23', to: '2026-11-29' },
      month: { from: '2026-11-01', to: '2026-11-30' },
    },
    filed: { today: 2, week: 7, month: 30 },
    month: { byDirection: { Import: 20, Export: 10 }, byChannel: {}, assessedValue: 0, totalDuty: 0, reimbursable: 0 },
    incomplete: 0,
  } });
  render(<CustomsDashboardStats />);
  await screen.findByText('GDs Today');
  expect(tile('GDs Today').textContent).toBe('GDs Today223 Nov');
  expect(screen.getByText('GDs Today').getAttribute('title')).toBe('GDs dated 2026-11-23');
  expect(tile('GDs This Week').textContent).toContain('7');
  expect(tile('GDs This Month').textContent).toContain('30');
  expect(screen.queryByText('GDs This Year')).toBeNull();
});

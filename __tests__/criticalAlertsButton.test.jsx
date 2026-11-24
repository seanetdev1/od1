/**
 * The red Critical Alerts button before the bell (the user's layout,
 * 2026-11-23): its count, the popup it opens, and the bell's badge no longer
 * counting critical as well.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { store } from 'redux/store';
import { clearNotifications } from 'redux/notifications/notificationSlice';
import NotificationBell from 'Components/Shared/NotificationBell';

let mockCritical = 3;
const item = (id) => ({ kind: 'invoice', id, invoiceNo: `INV-${id}`, party: 'ACME', payType: 'Recievable', currency: 'PKR', owed: 10, days: 100, since: '2026-08-01T00:00:00.000Z', dueDays: 90 });
jest.mock('apis/axiosClient', () => ({
  get: () => Promise.resolve({ data: { status: 'success', result: {
    lists: ['critical', 'invoicesDue'],
    critical: { count: mockCritical, items: Array.from({ length: mockCritical }, (_, i) => item(i + 1)) },
    invoicesDue: { count: 0, items: [] },
    totals: { jobs: 0, invoices: mockCritical },
  } } }),
}));

beforeEach(() => store.dispatch(clearNotifications()));

const renderBell = async () => {
  render(<Provider store={store}><NotificationBell /></Provider>);
  await act(async () => {}); // the lists arrive
};

test('shows the critical count, and opens the popup on Critical', async () => {
  mockCritical = 3;
  await renderBell();
  const button = screen.getByRole('button', { name: /Critical Alerts\s*3/ });
  // The bell's own badge does not repeat it.
  expect(document.querySelector('.bell-icon .ant-badge-count')).toBeNull();
  fireEvent.click(button);
  expect(await screen.findByText('Business Alerts')).toBeTruthy();
  expect(screen.getByText('INV-1')).toBeTruthy();
  expect(screen.getByText('3 invoices tracked', { exact: false })).toBeTruthy();
});

test('nothing critical: no button', async () => {
  mockCritical = 0;
  await renderBell();
  expect(screen.queryByRole('button', { name: /Critical Alerts/ })).toBeNull();
});

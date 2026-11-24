/**
 * The header bell keeps errors and warnings only (the user, 2026-11-23) -
 * every toast is still shown, but only a red or orange one is kept for the
 * bell. The real helper against the real store.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { notification } from 'antd';
import { store } from 'redux/store';
import { clearNotifications } from 'redux/notifications/notificationSlice';
import openNotification, { keptInBell } from 'Components/Shared/Notification';
import NotificationBell from 'Components/Shared/NotificationBell';

// The bell's lists, as the server sends them to a designation ticked for all four.
jest.mock('apis/axiosClient', () => ({
  get: () => Promise.resolve({ data: { status: 'success', result: {
    lists: ['critical', 'jobCharges', 'invoicesDue', 'jobStatus'],
    critical: { count: 0, items: [] }, jobCharges: { count: 0, items: [] },
    invoicesDue: { count: 0, items: [] }, jobStatus: { count: 0, items: [] },
  } } }),
}));

const kept = () => store.getState().notifications.list.map((x) => x.title);

beforeEach(() => {
  store.dispatch(clearNotifications());
  jest.spyOn(notification, 'open').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('red and orange are kept, whatever their case; green, blue and none are not', () => {
  expect(['red', 'orange', 'Red', 'Orange', ' red '].map(keptInBell)).toEqual([true, true, true, true, true]);
  expect(['green', 'Green', 'blue', '', undefined, null].map(keptInBell)).toEqual([false, false, false, false, false, false]);
});

test('every toast is shown; only the errors and warnings reach the bell, newest first', () => {
  openNotification('Success', 'Saved', 'green');
  openNotification('Error', 'Could not save.', 'red');
  openNotification('Preview', '3 emails would be sent', 'blue');
  openNotification('Note', 'Some lines were not saved.', 'orange');
  openNotification('Please Wait', 'Already Saving', 'Orange');
  expect(notification.open).toHaveBeenCalledTimes(5);
  expect(kept()).toEqual(['Please Wait', 'Note', 'Error']);
});

test('the bell has two tabs and opens on Alerts', async () => {
  render(<Provider store={store}><NotificationBell /></Provider>);
  await act(async () => {}); // the lists arrive
  fireEvent.mouseEnter(document.querySelector('.cur'));
  await screen.findByText('Alerts');
  expect(screen.getByText('Recent')).toBeTruthy();
  // Alerts' own four, starting on Critical.
  expect(screen.getByText('Job Charges')).toBeTruthy();
  expect(screen.getByText('Invoices Due')).toBeTruthy();
  expect(screen.getByText('Job Status')).toBeTruthy();
  expect(screen.getByText('Nothing critical.')).toBeTruthy();
});

/**
 * Configuration > Bell Alerts (the user, 2026-11-23): the days each alert list
 * checks against - "Critical at 120 if I want" - and who sees which list.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BellAlertDays from '../Components/Layouts/Config/BellAlertDays';
import BellAlerts from '../Components/Layouts/Config/BellAlerts';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('Components/Shared/Notification', () => jest.fn());

const DAYS = { critical: 90, due: 45, noCharges: 7, onVessel: 7, unfinished: 7 };
const FIELDS = [
  { key: 'critical', list: 'Critical', label: 'Invoice not settled for more than', after: 'days' },
  { key: 'onVessel', list: 'Critical', label: 'Job with no charges', after: 'days after going On Vessel' },
  { key: 'noCharges', list: 'Job Charges', label: 'Job with no charges', after: 'days after it was created' },
  { key: 'due', list: 'Invoices Due', label: 'Invoice still due after', after: 'days' },
  { key: 'unfinished', list: 'Job Status', label: 'Job not On Vessel', after: 'days or more after it was created' },
];
const answer = (data) => Promise.resolve({ data: { status: 'success', ...data } });
const box = (name) => screen.getByRole('spinbutton', { name });
const saveButton = () => screen.getAllByRole('button', { name: /^(Save|Saved|Saving…)$/ })[0];

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGet.mockImplementation((url) => (url === '/settings/bellAlertDays'
    ? answer({ result: DAYS, fields: FIELDS, defaults: DAYS, max: 3650 })
    : answer({ result: {}, widgets: [], designations: [], defaults: {} })));
});

test('Critical at 120: Save sends all five days', async () => {
  mockPost.mockImplementation((url, body) => answer({ result: body.days }));
  render(<BellAlertDays />);
  const critical = await screen.findByRole('spinbutton', { name: 'Critical: Invoice not settled for more than … days' });
  expect(critical.value).toBe('90');
  fireEvent.change(critical, { target: { value: '120' } });
  fireEvent.blur(critical);
  fireEvent.click(saveButton());
  await waitFor(() => expect(mockPost).toHaveBeenCalled());
  expect(mockPost).toHaveBeenCalledWith('/settings/bellAlertDays', { days: { ...DAYS, critical: 120 } });
});

test('Invoices Due at or past Critical cannot be saved, and says why', async () => {
  render(<BellAlertDays />);
  const due = await screen.findByRole('spinbutton', { name: 'Invoices Due: Invoice still due after … days' });
  fireEvent.change(due, { target: { value: '90' } });
  fireEvent.blur(due);
  expect(await screen.findByText('Invoices Due must be fewer days than Critical.')).toBeTruthy();
  expect(saveButton().disabled).toBe(true);
});

test('the section holds the days and the designation grid', async () => {
  render(<BellAlerts />);
  expect(await screen.findByText('Alert Days')).toBeTruthy();
  expect(screen.getByText('Who Sees Which List')).toBeTruthy();
  expect(mockGet).toHaveBeenCalledWith('/settings/bellAlertLists');
});

/**
 * Config > WhatsApp - the daily update (the user's request, 2026-10-24): off
 * until switched on; the token is write-only; the template to create is shown;
 * Preview shows the message and the report; a test goes to one number.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('react-redux', () => ({ useSelector: (fn) => fn({ company: { companies: [{ id: 1, title: 'SEANET' }] } }) }));

import WhatsApp from 'Components/Layouts/Config/WhatsApp';

const ok = (result) => Promise.resolve({ data: { status: 'success', result } });
const settings = {
  enabled: false, connection: { phoneNumberId: '', businessAccountId: '', apiVersion: 'v22.0' },
  template: { name: 'odyssey_daily_update', language: 'en' }, time: '20:00', timeZone: 'Asia/Karachi',
  defaultCountryCode: '92', recipients: [], sendWhenEmpty: true, companies: [],
};
const template = {
  name: 'odyssey_daily_update', language: 'en', footer: 'Sent by Odyssey',
  body: 'Here is your Odyssey daily update for {{1}}. New bookings entered today: {{2}}. New invoices and bills raised today: {{3}}. Selling: PKR {{4}}. Buying: PKR {{5}}. Profit: PKR {{6}}. The full report, job by job, is attached.',
  variables: ['the date', 'new bookings', 'new invoices and bills', 'selling', 'buying', 'profit'],
};

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGet.mockImplementation((url) => (url === '/whatsapp/settings' ? ok({ settings, hasToken: false, template, state: {} }) : ok([])));
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

test('off until switched on; shows the template to create in WhatsApp Manager', async () => {
  render(<WhatsApp />);
  const sw = await screen.findByRole('switch', { name: 'Daily update' });
  expect(sw.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByText(template.body)).toBeInTheDocument();
  expect(screen.getByText(/\{\{6\}\} profit/)).toBeInTheDocument();
});

test('Save sends the settings, the people and the token - which is never shown again', async () => {
  mockPost.mockImplementation((url, body) => ok({ settings: { ...body.settings, recipients: [{ name: 'CEO', phone: '923001234567' }] }, hasToken: true }));
  render(<WhatsApp />);
  await screen.findByRole('switch', { name: 'Daily update' });

  fireEvent.change(screen.getByPlaceholderText('e.g. 106540352242922'), { target: { value: '106540352242922' } });
  fireEvent.change(screen.getByPlaceholderText('Paste the permanent token'), { target: { value: 'EAAG-secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add a person' }));
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'CEO' } });
  fireEvent.change(screen.getByPlaceholderText('WhatsApp number'), { target: { value: '0300 1234567' } });
  fireEvent.click(screen.getByRole('switch', { name: 'Daily update' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });

  expect(mockPost).toHaveBeenCalledWith('/whatsapp/settings', {
    settings: expect.objectContaining({ enabled: true, connection: expect.objectContaining({ phoneNumberId: '106540352242922' }), recipients: [{ name: 'CEO', phone: '0300 1234567' }] }),
    token: 'EAAG-secret',
  });
  expect(await screen.findByPlaceholderText('Stored - leave blank to keep it')).toHaveValue('');
});

test("Preview shows the message as it will read, and the report", async () => {
  mockPost.mockReturnValue(ok({ date: '2026-10-24', text: 'Here is your Odyssey daily update for 24-10-2026. New bookings entered today: 5.', html: '<p>report</p>', totals: {} }));
  render(<WhatsApp />);
  await screen.findByRole('switch', { name: 'Daily update' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview' })); });
  expect(mockPost).toHaveBeenCalledWith('/whatsapp/run', expect.objectContaining({ mode: 'preview', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  expect(await screen.findByText(/New bookings entered today: 5\./)).toBeInTheDocument();
  expect(screen.getByTitle('Report preview')).toBeInTheDocument();
});

test('a test goes to the one number typed, and the result is shown', async () => {
  mockPost.mockReturnValue(ok({ sent: 0, failed: 1, results: [{ name: 'Test', phone: '923331112223', status: 'failed', error: 'This number is not on the test number\'s allowed list.' }] }));
  render(<WhatsApp />);
  await screen.findByRole('switch', { name: 'Daily update' });
  expect(screen.getByRole('button', { name: 'Send a test' })).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText('0300 1234567'), { target: { value: '0333 1112223' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send a test' })); });
  expect(mockPost).toHaveBeenCalledWith('/whatsapp/run', expect.objectContaining({ mode: 'test', testTo: '0333 1112223' }));
  expect(await screen.findByText(/not on the test number's allowed list/)).toBeInTheDocument();
});

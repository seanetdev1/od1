/**
 * Configuration > Customs > Statuses - Components/Layouts/Config/
 * CustomsStatuses. Each status's name, colour and rules, for jobs and for the
 * Program Book; new ones added, any reordered; built-in ones and ones in use
 * retired (Offered unticked) rather than removed. Saved by its own Save, and
 * every screen open told.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { getCustomsStatuses, saveCustomsStatuses } from 'apis/customsStatuses';
import openNotification from 'Components/Shared/Notification';
import { DEFAULT_STATUSES, resetCustomsStatuses, loadCustomsStatuses } from 'functions/customsStatuses';
import CustomsStatuses from '../Components/Layouts/Config/CustomsStatuses';

jest.mock('apis/customsStatuses', () => ({ getCustomsStatuses: jest.fn(), saveCustomsStatuses: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

beforeEach(() => {
  jest.clearAllMocks();
  resetCustomsStatuses();
  getCustomsStatuses.mockResolvedValue({ status: 'success', result: DEFAULT_STATUSES });
});

const saveButton = () => screen.getByRole('button', { name: /^(Save|Saved|Saving…)$/ });
const name = (kind, n) => screen.getByLabelText(`${kind === 'job' ? 'Job' : 'Program Book'} status ${n} name`);
const open = async () => {
  render(<CustomsStatuses />);
  await waitFor(() => expect(name('job', 1)).toBeTruthy());
};

test('shows both lists as they stand, each status with its rules ticked; nothing to save yet', async () => {
  await open();
  expect([1, 2, 3, 4].map((n) => name('job', n).value)).toEqual(['In Process', 'On Vessel', 'DrayOff', 'Canceled']);
  expect([1, 2, 3].map((n) => name('plan', n).value)).toEqual(['Pending', 'Confirmed', 'Cancelled']);
  expect(screen.getByLabelText('On Vessel: Receivable charges can be approved').checked).toBe(true);
  expect(screen.getByLabelText('In Process: Receivable charges can be approved').checked).toBe(false);
  expect(screen.getByLabelText('Confirmed: Can be moved to the jobs list').checked).toBe(true);
  expect(saveButton().textContent).toBe('Saved');
  expect(saveButton().disabled).toBe(true);
});

test('rename, a rule, a new status, an order and a retirement - all sent on Save, and every screen told', async () => {
  await open();
  fireEvent.change(name('job', 1), { target: { value: 'Under Clearance' } });
  fireEvent.click(screen.getByLabelText('Canceled: Receivable charges can be approved'));
  fireEvent.click(screen.getAllByText('+ Add status')[0]);
  fireEvent.change(name('job', 5), { target: { value: 'Docs Awaited' } });
  fireEvent.click(screen.getByLabelText('Move Docs Awaited up'));
  fireEvent.click(screen.getByLabelText('DrayOff: offered'));
  expect(saveButton().textContent).toBe('Save');

  const result = { job: DEFAULT_STATUSES.job, plan: DEFAULT_STATUSES.plan };
  saveCustomsStatuses.mockResolvedValue({ status: 'success', result });
  await act(async () => { fireEvent.click(saveButton()); });
  const { job, plan } = saveCustomsStatuses.mock.calls[0][0];
  expect(job.map((s) => [s.value, s.label, s.rules, s.hidden])).toEqual([
    ['Incomplete', 'Under Clearance', ['start'], false],
    ['Complete', 'On Vessel', ['billable', 'finished'], false],
    ['DrayOff', 'DrayOff', ['billable', 'finished'], true],
    // A new one has no stored value - the server gives it its name.
    [undefined, 'Docs Awaited', [], false],
    ['Canceled', 'Canceled', ['finished', 'billable'], false],
  ]);
  expect(plan).toHaveLength(3);
  expect(openNotification).toHaveBeenCalledWith('Success', 'Statuses saved.', 'green');
  // The saved list is what every screen reads from now.
  await expect(loadCustomsStatuses()).resolves.toEqual(result);
});

test('one status to start at: picking it takes it from the other, and it is always offered', async () => {
  await open();
  fireEvent.click(screen.getByLabelText('Pending: offered'));
  expect(screen.getByLabelText('Pending: offered').disabled).toBe(true);   // where rows start
  fireEvent.click(screen.getByLabelText('Cancelled: offered'));
  fireEvent.click(screen.getByLabelText('Cancelled: New rows start at this status'));
  expect(screen.getByLabelText('Pending: New rows start at this status').checked).toBe(false);
  expect(screen.getByLabelText('Cancelled: offered').checked).toBe(true);
});

test('a built-in status cannot be removed; one added can', async () => {
  await open();
  expect(screen.getByLabelText('Remove In Process').disabled).toBe(true);
  fireEvent.click(screen.getAllByText('+ Add status')[1]);
  fireEvent.change(name('plan', 4), { target: { value: 'Shut Out' } });
  fireEvent.click(screen.getByLabelText('Remove Shut Out'));
  expect(screen.queryByLabelText('Program Book status 4 name')).toBeNull();
  expect(saveButton().textContent).toBe('Saved');
});

test('the server\'s refusal is shown, and nothing is lost', async () => {
  await open();
  fireEvent.change(name('job', 2), { target: { value: 'In Process' } });
  saveCustomsStatuses.mockRejectedValue({ response: { data: { result: 'Two job statuses are called "In Process".' } } });
  await act(async () => { fireEvent.click(saveButton()); });
  expect(openNotification).toHaveBeenCalledWith('Error', 'Two job statuses are called "In Process".', 'red');
  expect(name('job', 2).value).toBe('In Process');
  expect(screen.getByText('Undo changes')).toBeTruthy();
  fireEvent.click(screen.getByText('Undo changes'));
  expect(name('job', 2).value).toBe('On Vessel');
});

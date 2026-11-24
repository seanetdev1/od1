/**
 * "+ Charge" on an invoice (Components/Shared/InvoiceEditor) - the line is
 * saved, and the screen refreshes if it can. The invoice page handed in no
 * reload, and saving crashed with "reload is not a function" (2026-10-24).
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockPost = jest.fn();
const mockNotify = jest.fn();
jest.mock('apis/axiosClient', () => ({ post: (...a) => mockPost(...a) }));
jest.mock('apis/queryClient', () => ({ invalidateQueries: jest.fn() }));
jest.mock('Components/Shared/Notification', () => (...a) => mockNotify(...a));
jest.mock('functions/delay', () => ({ delay: () => Promise.resolve() }));

import InvoiceEditor from 'Components/Shared/InvoiceEditor';

const data = { resultOne: { approved: '0', Charge_Heads: [{ id: 1, particular: 'FREIGHT', ex_rate: '1', InvoiceId: 9 }] } };

beforeEach(() => {
  mockPost.mockReset();
  mockNotify.mockReset();
  mockPost.mockResolvedValue({ data: { status: 'success' } });
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

const addAndSave = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Charge/ }));
  fireEvent.click(await screen.findByText('Add +'));
  await act(async () => { fireEvent.click(screen.getByText('Save')); });
};

test('saves, and refreshes the screen it is on', async () => {
  const reload = jest.fn();
  render(<InvoiceEditor data={data} reload={reload} />);
  await addAndSave();
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockNotify).toHaveBeenCalledWith('Success', 'Sample Charge Added in Invoice!', 'green');
  expect(reload).toHaveBeenCalledTimes(1);
});

test('saves without a crash on a screen that hands in no reload', async () => {
  render(<InvoiceEditor data={data} />);
  await addAndSave();
  expect(mockNotify).toHaveBeenCalledWith('Success', 'Sample Charge Added in Invoice!', 'green');
});

/* "+ Charge" follows the invoice as it stands - unapproving it enables the
 * button at once, not after a page refresh (the user's report, 2026-10-24). */
test('the button follows the invoice as it is now, not as the page loaded it', () => {
  const loadedApproved = { resultOne: { ...data.resultOne, approved: '1' } };
  const { rerender } = render(<InvoiceEditor data={loadedApproved} invoice={{ approved: '1' }} lines={data.resultOne.Charge_Heads} />);
  expect(screen.getByRole('button', { name: /Charge/ })).toBeDisabled();
  // Unapproved: InvoiceCharges hands in its updated invoice; `data` is unchanged.
  rerender(<InvoiceEditor data={loadedApproved} invoice={{ approved: '0' }} lines={data.resultOne.Charge_Heads} />);
  expect(screen.getByRole('button', { name: /Charge/ })).toBeEnabled();
});

test('it saves the lines as they are now, with the new one', async () => {
  const now = [{ id: 1, particular: 'FREIGHT', ex_rate: '1', InvoiceId: 9 }, { id: 2, particular: 'THC', ex_rate: '1', InvoiceId: 9 }];
  render(<InvoiceEditor data={data} invoice={{ approved: '0' }} lines={now} />);
  await addAndSave();
  const sent = mockPost.mock.calls[0][1].charges;
  expect(sent.map((c) => c.particular)).toEqual(['FREIGHT', 'THC', 'SAMPLE CHARGE']);
});

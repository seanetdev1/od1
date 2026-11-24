/**
 * Config > Bank Accounts: "Make client default" (JI / JB) and "Make agent
 * default" (AI / AB). The server holds the defaults and flags the accounts it
 * sends; this pins what the screen shows for those flags and what it posts.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axiosClient from 'apis/axiosClient';
import BankAccounts from '../Components/Layouts/Config/BankAccounts';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('redux/company/companySlice', () => ({ addCompanies: (x) => x }));
jest.mock('Components/Shared/Notification', () => jest.fn());

const accounts = [
  { id: 2, label: 'Soneri - Main', bankName: 'Soneri', clientDefault: true, agentDefault: false },
  { id: 9, label: 'Habib - USD', bankName: 'Bank Al Habib', clientDefault: false, agentDefault: false },
];

beforeEach(() => {
  axiosClient.post.mockClear();
  axiosClient.get.mockImplementation((url) => Promise.resolve({
    data: url.includes('byCompany')
      ? { status: 'success', result: accounts }
      : { status: 'success', result: [{ id: 1, title: 'AIR CARGO SERVICES' }] },
  }));
  axiosClient.post.mockResolvedValue({ data: { status: 'success' } });
});

test('tags the current client default and offers only what it is not', async () => {
  render(<BankAccounts />);
  await screen.findByText('Soneri - Main');
  expect(screen.getByText('Client default (JI/JB)')).toBeTruthy();
  expect(screen.queryByText('Agent default (AI/AB)')).toBeNull();
  // Soneri already is the client default: only Habib offers it.
  expect(screen.getAllByText('Make client default')).toHaveLength(1);
  expect(screen.getAllByText('Make agent default')).toHaveLength(2);
});

test('posts the account and the kind of default', async () => {
  render(<BankAccounts />);
  await screen.findByText('Habib - USD');
  fireEvent.click(screen.getAllByText('Make agent default')[1]);
  await waitFor(() => expect(axiosClient.post).toHaveBeenCalledWith(
    '/companies/bankAccount/setDefault', { id: 9, kind: 'agent' },
  ));
});

// The user, 2026-11-02: "I can't edit bank accounts".
describe('Edit', () => {
  const box = (label) => screen.getByText(label).parentElement.querySelector('input');

  test('fills the form with the account and saves it in place', async () => {
    render(<BankAccounts />);
    await screen.findByText('Habib - USD');
    fireEvent.click(screen.getAllByText('Edit')[1]);
    expect(screen.getByText('Edit account - Habib - USD')).toBeTruthy();
    expect(box('Bank name').value).toBe('Bank Al Habib');
    fireEvent.change(box('Account no.'), { target: { value: '0042' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(axiosClient.post).toHaveBeenCalledWith('/companies/bankAccount/edit', {
      id: 9, label: 'Habib - USD', bankName: 'Bank Al Habib', accountTitle: '', accountNo: '0042', iban: '', branch: '', swift: '',
    }));
    // Back to adding, with an empty form.
    await screen.findByText('Add account');
    expect(box('Bank name').value).toBe('');
  });

  test('Cancel goes back to adding, and nothing is posted', async () => {
    render(<BankAccounts />);
    await screen.findByText('Soneri - Main');
    fireEvent.click(screen.getAllByText('Edit')[0]);
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Add account')).toBeTruthy();
    expect(screen.getByText('Add bank account')).toBeTruthy();
    expect(axiosClient.post).not.toHaveBeenCalledWith('/companies/bankAccount/edit', expect.anything());
  });
});

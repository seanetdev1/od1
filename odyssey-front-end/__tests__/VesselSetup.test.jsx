/**
 * Setup > Vessels (user's requests, 2026-11-12):
 *   - the list a page at a time from GET /vessel/list, searched on the server;
 *   - Delete, and Make inactive / Make active. A vessel any job uses is not
 *     deleted - the server says so (409, status 'inUse') and the screen offers
 *     to make it inactive instead.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import axiosClient from 'apis/axiosClient';
import Vessel from '../Components/Layouts/Setup/Vessel';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ refetch: jest.fn() }) }));
jest.mock('apis/jobs', () => ({ getJobValues: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('Components/Shared/CompanyVisibility', () => () => null);

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

let vessels;
const listCalls = () => axiosClient.get.mock.calls.filter(([url]) => String(url).endsWith('/vessel/list'));

const rowOf = (name) => screen.getByText(name).closest('tr');
// A button in the confirmation dialog on top (the row has its own Delete).
const press = async (text) => {
  const button = await waitFor(() => {
    const dialogs = screen.getAllByRole('dialog');
    return within(dialogs[dialogs.length - 1]).getByRole('button', { name: text });
  });
  fireEvent.click(button);
};

beforeEach(() => {
  jest.clearAllMocks();
  vessels = [
    { id: 1, name: 'MSC ANNA', code: 11, type: 'Both', active: true },
    { id: 2, name: 'OLD STAR', code: 12, type: 'Both', active: false },
  ];
  axiosClient.get.mockImplementation((url, { params } = {}) => {
    if (String(url).endsWith('/vessel/list')) {
      // A stand-in for the server: "inactive" filters, anything else matches names.
      const s = (params?.search || '').toLowerCase();
      const rows = vessels.filter((v) => !s
        || (s === 'inactive' ? v.active === false : v.name.toLowerCase().includes(s)));
      return Promise.resolve({ data: { status: 'success', total: rows.length + (s ? 0 : 98), result: rows } });
    }
    // No answer on rights = everything offered (functions/myPermissions).
    return Promise.resolve({ data: { status: 'error' } });
  });
});

test('asks the server for the first page, and shows the total and the pages', async () => {
  render(<Vessel />);
  await screen.findByText('MSC ANNA');
  expect(listCalls()[0][1].params).toEqual({ page: 1, pageSize: 25, search: '' });
  expect(screen.getByText('100 vessels')).toBeTruthy();
  expect(screen.getByTitle('4')).toBeTruthy(); // 100 vessels, 25 a page

  fireEvent.click(screen.getByTitle('2'));
  await waitFor(() => expect(listCalls().at(-1)[1].params).toMatchObject({ page: 2 }));
});

test('searches on the server once typing pauses, from page 1', async () => {
  render(<Vessel />);
  await screen.findByText('MSC ANNA');
  const box = screen.getByPlaceholderText(/Search name, carrier/);
  for (const text of ['i', 'in', 'inactive']) fireEvent.change(box, { target: { value: text } });

  await waitFor(() => expect(screen.queryByText('MSC ANNA')).toBeNull());
  expect(screen.getByText('OLD STAR')).toBeTruthy();
  expect(screen.getByText('1 found')).toBeTruthy();
  expect(listCalls()).toHaveLength(2); // the first page, then one search
  expect(listCalls()[1][1].params).toEqual({ page: 1, pageSize: 25, search: 'inactive' });

  fireEvent.change(box, { target: { value: 'nothing like it' } });
  expect(await screen.findByText('No vessel matches the search.')).toBeTruthy();
});

test('shows each vessel as Active or Inactive, with the action that changes it', async () => {
  render(<Vessel />);
  await screen.findByText('MSC ANNA');
  expect(within(rowOf('MSC ANNA')).getByText('Active')).toBeTruthy();
  expect(within(rowOf('MSC ANNA')).getByRole('button', { name: 'Make inactive' })).toBeTruthy();
  expect(within(rowOf('OLD STAR')).getByText('Inactive')).toBeTruthy();
  expect(within(rowOf('OLD STAR')).getByRole('button', { name: 'Make active' })).toBeTruthy();
});

test('deletes an unused vessel, and reloads the page from the server', async () => {
  axiosClient.post.mockImplementation(() => {
    vessels = vessels.filter((v) => v.id !== 1);
    return Promise.resolve({ data: { status: 'success', result: 'MSC ANNA deleted.' } });
  });
  render(<Vessel />);
  await screen.findByText('MSC ANNA');
  fireEvent.click(within(rowOf('MSC ANNA')).getByRole('button', { name: 'Delete' }));
  await press('Delete');

  await waitFor(() => expect(screen.queryByText('MSC ANNA')).toBeNull());
  expect(axiosClient.post.mock.calls[0][0]).toMatch(/\/vessel\/delete$/);
  expect(axiosClient.post.mock.calls[0][1]).toMatchObject({ id: 1 });
  await waitFor(() => expect(listCalls()).toHaveLength(2));
});

test('a vessel in use is not deleted; making it inactive is offered, and does it', async () => {
  axiosClient.post.mockImplementation((url) => {
    if (url.endsWith('/vessel/delete')) {
      return Promise.reject({ response: { status: 409, data: {
        status: 'inUse', jobs: 2, active: true,
        result: 'MSC ANNA is on 2 jobs (SNS-SE-9/27, SNS-SE-8/27), so it cannot be deleted.',
      } } });
    }
    vessels = vessels.map((v) => (v.id === 1 ? { ...v, active: false } : v));
    return Promise.resolve({ data: { status: 'success', result: { ...vessels[0] } } });
  });

  render(<Vessel />);
  await screen.findByText('MSC ANNA');
  fireEvent.click(within(rowOf('MSC ANNA')).getByRole('button', { name: 'Delete' }));
  await press('Delete');

  expect(await screen.findByText(/is on 2 jobs .* so it cannot be deleted\. Inactive, it stays on those jobs/)).toBeTruthy();
  await press('Make inactive');

  await waitFor(() => expect(within(rowOf('MSC ANNA')).getByText('Inactive')).toBeTruthy());
  const setActive = axiosClient.post.mock.calls.find(([url]) => url.endsWith('/vessel/setActive'));
  expect(setActive[1]).toMatchObject({ id: 1, active: false });
});

test('making it active again', async () => {
  axiosClient.post.mockImplementation(() => {
    vessels = vessels.map((v) => (v.id === 2 ? { ...v, active: true } : v));
    return Promise.resolve({ data: { status: 'success', result: { ...vessels[1] } } });
  });
  render(<Vessel />);
  await screen.findByText('OLD STAR');
  fireEvent.click(within(rowOf('OLD STAR')).getByRole('button', { name: 'Make active' }));
  await waitFor(() => expect(within(rowOf('OLD STAR')).getByText('Active')).toBeTruthy());
  expect(axiosClient.post.mock.calls[0][1]).toMatchObject({ id: 2, active: true });
});

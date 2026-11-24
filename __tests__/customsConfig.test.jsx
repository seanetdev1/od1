/**
 * Configuration > Customs - job planning (the Program Book) on or off, and the
 * tab itself only on a customs install.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Customs from '../Components/Layouts/Config/Customs';
import Config from '../Components/Layouts/Config';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockSet = jest.fn();
let mockMode = 'customs';
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('js-cookie', () => ({ get: (k) => (k === 'token' ? 'a.b.c' : undefined), set: (...a) => mockSet(...a) }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('functions/terminology', () => ({ ...jest.requireActual('functions/terminology'), getMode: () => mockMode }));
jest.mock('next/router', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
// Config is Seanet's (a system session) - see functions/systemSession.
jest.mock('jwt-decode', () => () => ({ designation: 'admin', username: 'admin', system: true }));

const saveButton = () => screen.getByRole('button', { name: /^(Save|Saved|Saving…)$/ });

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockSet.mockReset();
});

test('off until turned on; Save sends it and the sidebar is told', async () => {
  mockGet.mockResolvedValue({ data: { status: 'success', result: { enabled: false } } });
  mockPost.mockResolvedValue({ data: { status: 'success', result: { enabled: true } } });
  render(<Customs />);
  const sw = await screen.findByRole('switch', { name: 'Job planning (Program Book)' });
  expect(sw.getAttribute('aria-checked')).toBe('false');
  expect(saveButton().textContent).toBe('Saved');

  fireEvent.click(sw);
  expect(mockPost).not.toHaveBeenCalled();
  fireEvent.click(saveButton());
  await waitFor(() => expect(saveButton().textContent).toBe('Saved'));
  expect(mockPost).toHaveBeenCalledWith('/settings/customsPlanning', { enabled: true });
  expect(mockSet).toHaveBeenCalledWith('customsPlanning', 'true', { expires: 3650 });
});

test('Charges in tabs - off until turned on, and Save sends it', async () => {
  mockGet.mockResolvedValue({ data: { status: 'success', result: { enabled: false } } });
  mockPost.mockResolvedValue({ data: { status: 'success', result: { enabled: true } } });
  render(<Customs />);
  const sw = await screen.findByRole('switch', { name: 'Charges in tabs' });
  expect(sw.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(sw);
  fireEvent.click(saveButton());
  await waitFor(() => expect(saveButton().textContent).toBe('Saved'));
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith('/settings/customsChargeTabs', { enabled: true });
});

test('a refused save stays unsaved', async () => {
  mockGet.mockResolvedValue({ data: { status: 'success', result: { enabled: true } } });
  mockPost.mockRejectedValue({ response: { data: { result: 'Only an admin can change this.' } } });
  render(<Customs />);
  fireEvent.click(await screen.findByRole('switch', { name: 'Job planning (Program Book)' }));
  fireEvent.click(saveButton());
  await waitFor(() => expect(saveButton().textContent).toBe('Save'));
  expect(mockSet).not.toHaveBeenCalled();
});

// The side menu's group headings - Customs is a group of its own.
describe('the Customs section', () => {
  const tabs = () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    render(<Config />);
    return [...document.querySelectorAll('.cfg-nav .ant-menu-item-group-title')].map((t) => t.textContent);
  };

  beforeAll(() => {
    window.matchMedia = window.matchMedia || ((query) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }));
  });

  test('is there on a customs install', () => {
    mockMode = 'customs';
    expect(tabs()).toContain('Customs');
    // Its two sections, under it.
    const items = [...document.querySelectorAll('.cfg-nav .ant-menu-item')].map((t) => t.textContent);
    expect(items).toEqual(expect.arrayContaining(['Customs Jobs', 'Statuses']));
  });

  test.each(['freight', 'aviation'])('is not there on a %s install', (mode) => {
    mockMode = mode;
    expect(tabs()).not.toContain('Customs');
  });
});

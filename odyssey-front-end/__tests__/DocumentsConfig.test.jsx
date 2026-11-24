/**
 * Configuration > Attached Documents (Components/Layouts/Config/Documents) -
 * the user's requests, 2026-11-13: the folder documents are kept in, chosen
 * here (none chosen, none attached) and changeable, and the list of types.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  getDocumentSettings, browseFolders, chooseDocumentsFolder, getDocumentTypes, saveDocumentTypes,
} from 'apis/documents';
import openNotification from 'Components/Shared/Notification';
import Documents from '../Components/Layouts/Config/Documents';

jest.mock('apis/documents', () => ({
  getDocumentSettings: jest.fn(),
  browseFolders: jest.fn(),
  chooseDocumentsFolder: jest.fn(),
  getDocumentTypes: jest.fn(),
  saveDocumentTypes: jest.fn(),
}));
jest.mock('Components/Shared/Notification', () => jest.fn());

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const TYPES = [
  { id: 1, name: 'Invoice', onInvoices: true, offered: true },
  { id: 2, name: 'Bill of Lading', onInvoices: false, offered: true },
];
const FOLDERS = {
  '': { path: null, parent: null, folders: [{ name: '/documents', path: '/documents' }, { name: '/mnt', path: '/mnt' }] },
  '/mnt': { path: '/mnt', parent: null, folders: [{ name: 'data', path: '/mnt/data' }] },
  '/mnt/data': { path: '/mnt/data', parent: '/mnt', folders: [] },
};

beforeEach(() => {
  jest.clearAllMocks();
  getDocumentSettings.mockResolvedValue({ path: null, roots: ['/documents', '/mnt'], documents: 0, folder: null });
  browseFolders.mockImplementation((p) => Promise.resolve(FOLDERS[p || '']));
  getDocumentTypes.mockResolvedValue({ result: TYPES, inUse: { 1: 4 } });
});

test('with no folder chosen it says nothing can be attached, and one is picked by browsing to it', async () => {
  chooseDocumentsFolder.mockResolvedValue({ path: '/mnt/data', missing: 0, total: 0 });
  render(<Documents />);
  expect(await screen.findByText('No folder is chosen yet - nothing can be attached until one is.')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: /\/mnt$/ }));
  fireEvent.click(await screen.findByRole('button', { name: /data/ }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Documents folder' })).toHaveValue('/mnt/data'));
  fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }));
  await waitFor(() => expect(chooseDocumentsFolder).toHaveBeenCalledWith('/mnt/data', false));
  expect(openNotification).toHaveBeenCalledWith('Success', 'Documents are kept in /mnt/data now.', 'green');
});

test('moving to a folder the documents are not in yet says how many - and goes ahead only when told', async () => {
  getDocumentSettings.mockResolvedValue({
    path: '/documents', roots: ['/documents', '/mnt'], documents: 12,
    folder: { exists: true, marked: true, free: 50 * 1024 ** 3, total: 100 * 1024 ** 3 },
  });
  chooseDocumentsFolder
    .mockRejectedValueOnce({ response: { status: 409, data: { status: 'missing', result: '12 of the 12 documents on record are not in /mnt/new.', missing: 12, total: 12, examples: ['2026/11/a.pdf'] } } })
    .mockResolvedValueOnce({ path: '/mnt/new', missing: 12, total: 12 });
  render(<Documents />);
  expect(await screen.findByText('Ready')).toBeInTheDocument();
  expect(screen.getByText('50.0 GB free of 100.0 GB')).toBeInTheDocument();
  // The folder it already uses, ready: nothing to do.
  expect(screen.getByRole('button', { name: 'Use this folder' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Documents folder' }), { target: { value: '/mnt/new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }));
  const alert = await screen.findByText('12 of the 12 documents on record are not in /mnt/new.');
  fireEvent.click(within(alert.closest('.ant-alert')).getByRole('button', { name: 'Use it anyway' }));
  await waitFor(() => expect(chooseDocumentsFolder).toHaveBeenLastCalledWith('/mnt/new', true));
});

test('the folder it already uses, with no marker, can be set up again (CL, 2026-11-17)', async () => {
  getDocumentSettings.mockResolvedValue({
    path: '/documents', roots: ['/documents'], documents: 38,
    folder: { exists: true, marked: false, free: 3838 * 1024 ** 3, total: 3851 * 1024 ** 3 },
  });
  chooseDocumentsFolder
    .mockRejectedValueOnce({ response: { status: 409, data: { status: 'missing', result: '38 of the 38 documents on record are not in /documents.', missing: 38, total: 38, examples: [] } } })
    .mockResolvedValueOnce({ path: '/documents', missing: 38, total: 38 });
  render(<Documents />);
  expect(await screen.findByText(/Not the folder that was set up/)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Documents folder' })).toHaveValue('/documents');
  const use = screen.getByRole('button', { name: 'Use this folder' });
  expect(use).toBeEnabled();
  fireEvent.click(use);
  const alert = await screen.findByText('38 of the 38 documents on record are not in /documents.');
  fireEvent.click(within(alert.closest('.ant-alert')).getByRole('button', { name: 'Use it anyway' }));
  await waitFor(() => expect(chooseDocumentsFolder).toHaveBeenLastCalledWith('/documents', true));
});

test('the types: renamed, marked for invoices, added - and one in use cannot be removed', async () => {
  saveDocumentTypes.mockImplementation((types) => Promise.resolve({ result: types.map((t, i) => ({ id: t.id || 3 + i, ...t })), inUse: { 1: 4 } }));
  render(<Documents />);
  const name = await screen.findByRole('textbox', { name: 'Document type 2 name' });
  expect(screen.getByRole('button', { name: 'Remove Invoice' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove Bill of Lading' })).toBeEnabled();

  fireEvent.change(name, { target: { value: 'B/L' } });
  fireEvent.click(screen.getByRole('checkbox', { name: "B/L: on the job's invoices" }));
  fireEvent.click(screen.getByRole('button', { name: '+ Add type' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Document type 3 name' }), { target: { value: 'Delivery Order' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveDocumentTypes).toHaveBeenCalledWith([
    TYPES[0],
    { id: 2, name: 'B/L', onInvoices: true, offered: true },
    { name: 'Delivery Order', onInvoices: false, offered: true },
  ]));
  expect(await screen.findByRole('button', { name: 'Saved' })).toBeDisabled();
});

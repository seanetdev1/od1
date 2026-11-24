/**
 * Documents attached to a record (Components/Shared/Documents) - the user's
 * requests, 2026-11-13: a paperclip with how many are attached; in its window
 * a type to pick and +paperclip to add; each document with the eye where it
 * can be seen without downloading (a PDF in a new tab, an image here) and
 * download always; an invoice showing its job's invoice scans; 10 MB each.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import {
  listDocuments, uploadDocument, documentUrl, deleteDocument, renameDocument,
} from 'apis/documents';
import { DocumentsPanel, DocumentsButton } from 'Components/Shared/Documents';

jest.mock('apis/documents', () => ({
  listDocuments: jest.fn(),
  uploadDocument: jest.fn(),
  documentUrl: jest.fn(),
  deleteDocument: jest.fn(),
  renameDocument: jest.fn(),
}));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const LIMITS = { maxBytes: 10 * 1024 * 1024, extensions: ['.pdf', '.jpg', '.png', '.docx', '.xlsx'] };
const TYPES = [{ id: 1, name: 'Invoice' }, { id: 2, name: 'Bill of Lading' }];
const DOCS = [
  { id: 3, name: 'GD scan.pdf', size: 245760, view: 'pdf', typeId: 1, type: 'Invoice', uploadedBy: 'Hasnain', uploadedAt: '2026-11-13T09:05:00', from: null },
  { id: 2, name: 'Cheque.jpg', size: 81920, view: 'image', typeId: 2, type: 'Bill of Lading', uploadedBy: 'Hasnain', uploadedAt: '2026-11-12T16:40:00', from: null },
  { id: 1, name: 'Letter.docx', size: 20480, view: 'download', typeId: 2, type: 'Bill of Lading', uploadedBy: 'Abbas', uploadedAt: '2026-11-10T11:00:00', from: null },
];
const serve = ({ docs = DOCS, rights = { add: true, delete: true }, ready = true } = {}) => {
  listDocuments.mockResolvedValue({ status: 'success', result: docs, rights, types: TYPES, limits: LIMITS, ready });
};
const rowOf = (name) => screen.getByRole('button', { name }).closest('li');
const fileInput = () => document.querySelector('.documents-panel input[type=file]');
const choose = (...files) => fireEvent.change(fileInput(), { target: { files } });
const fileOf = (name, size) => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const pickType = async (name) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Document type' }));
  fireEvent.click(await screen.findByText(name, { selector: '.ant-select-item-option-content' }));
};

beforeEach(() => {
  jest.clearAllMocks();
  serve();
});

test('lists the record\'s documents - its type, size, who attached it, when', async () => {
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  const list = await screen.findByRole('list', { name: 'Attached documents' });
  expect(listDocuments).toHaveBeenCalledWith('SE_Job', 42);
  const first = within(list).getAllByRole('listitem')[0];
  expect(first).toHaveTextContent('GD scan.pdf');
  expect(first).toHaveTextContent('Invoice');
  expect(first).toHaveTextContent('240 KB');
  expect(first).toHaveTextContent('Hasnain');
  expect(first).toHaveTextContent('13-11-2026 09:05');
});

test('the eye where it can be seen without downloading, download always', async () => {
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  await screen.findByRole('list', { name: 'Attached documents' });
  const buttons = (name) => within(rowOf(name)).getAllByRole('button').map((b) => b.getAttribute('aria-label')).filter(Boolean);
  expect(buttons('GD scan.pdf')).toEqual(['Rename', 'View', 'Download', 'Remove']);
  expect(buttons('Cheque.jpg')).toEqual(['Rename', 'View', 'Download', 'Remove']);
  expect(buttons('Letter.docx')).toEqual(['Rename', 'Download', 'Remove']);
});

test('a record not yet saved has nothing to attach to, and asks the server nothing', () => {
  render(<DocumentsPanel entity='SE_Job' recordId='new' />);
  expect(screen.getByTestId('documents-unsaved')).toHaveTextContent('Save it first');
  expect(listDocuments).not.toHaveBeenCalled();
});

test('the eye on a PDF opens it in a new tab, in the browser\'s own viewer', async () => {
  const tab = { opener: {}, document: { title: '', body: { textContent: '' } }, location: { href: '' }, close: jest.fn() };
  const opened = jest.spyOn(window, 'open').mockReturnValue(tab);
  documentUrl.mockResolvedValue('http://server:8080/documents/file?t=abc');
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  await screen.findByRole('list', { name: 'Attached documents' });
  fireEvent.click(within(rowOf('GD scan.pdf')).getByRole('button', { name: 'View' }));
  // Opened at once - in the click - and pointed at the file when the link came.
  expect(opened).toHaveBeenCalledWith('', '_blank');
  await waitFor(() => expect(tab.location.href).toBe('http://server:8080/documents/file?t=abc'));
  expect(tab.opener).toBeNull();
  expect(documentUrl).toHaveBeenCalledWith(3, { download: undefined, from: undefined });
  opened.mockRestore();
});

test('the eye on an image opens it here, in Odyssey\'s viewer - not downloaded', async () => {
  documentUrl.mockResolvedValue('http://server:8080/documents/file?t=img');
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Cheque.jpg' }));
  await waitFor(() => expect(document.querySelector('.ant-image-preview-img')).toHaveAttribute('src', 'http://server:8080/documents/file?t=img'));
  expect(click).not.toHaveBeenCalled();
  click.mockRestore();
});

test('a Word file downloads', async () => {
  documentUrl.mockResolvedValue('http://server:8080/documents/file?t=doc&download=1');
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const opened = jest.spyOn(window, 'open');
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Letter.docx' }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(documentUrl).toHaveBeenCalledWith(1, { download: true, from: undefined });
  expect(opened).not.toHaveBeenCalled();
  click.mockRestore();
  opened.mockRestore();
});

test('adding: the type first, then +paperclip', async () => {
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  await screen.findByRole('list', { name: 'Attached documents' });
  const add = screen.getByRole('button', { name: 'Add documents' });
  expect(add).toBeDisabled();
  expect(fileInput()).toBeDisabled();
  expect(screen.getByText('Pick the document type, then + to choose the files.')).toBeInTheDocument();
  await pickType('Bill of Lading');
  expect(add).toBeEnabled();
  expect(fileInput()).toBeEnabled();
});

test('too big, or not a document, is turned away before it is sent', async () => {
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  await screen.findByRole('list', { name: 'Attached documents' });
  await pickType('Invoice');
  choose(fileOf('huge scan.pdf', 12 * 1024 * 1024), fileOf('setup.exe', 100));
  const alerts = await screen.findAllByRole('alert');
  expect(alerts.map((a) => a.textContent).join(' | ')).toMatch(/huge scan\.pdf is 12\.0 MB - the limit is 10\.0 MB.*setup\.exe: \.exe files cannot be attached/);
  expect(uploadDocument).not.toHaveBeenCalled();
});

test('a file sent goes as the type picked and joins the list; one the server refuses says why beside it', async () => {
  let finish;
  uploadDocument.mockImplementationOnce((entity, id, typeId, file, onProgress) => new Promise((resolve) => {
    onProgress(0.5);
    finish = () => resolve({ id: 9, name: file.name, size: 1, view: 'pdf', typeId, type: 'Bill of Lading', uploadedBy: 'Me', uploadedAt: '2026-11-13T10:00:00' });
  }));
  uploadDocument.mockRejectedValueOnce({ response: { status: 409, data: { result: 'This file is already attached here, as "GD scan.pdf".' } } });
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  await screen.findByRole('list', { name: 'Attached documents' });
  await pickType('Bill of Lading');

  choose(fileOf('BL.pdf', 1000), fileOf('again.pdf', 1000));
  await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(2));
  expect(uploadDocument.mock.calls[0].slice(0, 3)).toEqual(['SE_Job', 42, 2]);
  expect(await screen.findByRole('alert')).toHaveTextContent('already attached here, as "GD scan.pdf"');
  expect(screen.getByRole('progressbar')).toBeInTheDocument();

  await act(async () => finish());
  const names = within(screen.getByRole('list', { name: 'Attached documents' })).getAllByRole('listitem').map((li) => li.textContent);
  expect(names[0]).toMatch(/^BL\.pdf.*Bill of Lading/);
  expect(screen.queryByRole('progressbar')).toBeNull();
});

test('without the rights: open and download only - no type, no +, no Rename, no Remove', async () => {
  serve({ rights: { add: false, delete: false } });
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  await screen.findByText('You can open these, but adding them needs the right to edit this record.');
  expect(screen.getByRole('button', { name: 'Add documents' })).toBeDisabled();
  expect(screen.queryAllByRole('button', { name: 'Remove' })).toEqual([]);
  expect(screen.queryAllByRole('button', { name: 'Rename' })).toEqual([]);
  expect(within(rowOf('GD scan.pdf')).getByRole('button', { name: 'View' })).toBeEnabled();
});

test('before Configuration chooses a folder, nothing can be added - and it says where that is done', async () => {
  serve({ docs: [], ready: false });
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  expect(await screen.findByText(/chosen in Configuration > Documents/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add documents' })).toBeDisabled();
});

test('on an invoice, its job\'s invoice scan is there - opened from the invoice, removed only on the job', async () => {
  serve({
    docs: [{ ...DOCS[0], id: 11, from: { entity: 'SE_Job', recordId: '5', label: 'Job SE-101/26' } }],
  });
  const tab = { opener: {}, document: { title: '', body: { textContent: '' } }, location: { href: '' }, close: jest.fn() };
  const opened = jest.spyOn(window, 'open').mockReturnValue(tab);
  documentUrl.mockResolvedValue('http://server:8080/documents/file?t=inv');
  render(<DocumentsPanel entity='Invoice' recordId={77} />);
  await screen.findByRole('list', { name: 'Attached documents' });
  expect(rowOf('GD scan.pdf')).toHaveTextContent('on Job SE-101/26');
  expect(within(rowOf('GD scan.pdf')).queryByRole('button', { name: 'Remove' })).toBeNull();
  expect(within(rowOf('GD scan.pdf')).queryByRole('button', { name: 'Rename' })).toBeNull();
  fireEvent.click(within(rowOf('GD scan.pdf')).getByRole('button', { name: 'View' }));
  await waitFor(() => expect(documentUrl).toHaveBeenCalledWith(11, { download: undefined, from: { entity: 'Invoice', recordId: 77 } }));
  opened.mockRestore();
});

test('a name typed goes with the file - "Invoice JI-123/27" for scan020.pdf - and is cleared after', async () => {
  uploadDocument.mockImplementation((entity, id, typeId, file, onProgress, title) => Promise.resolve({
    id: 50 + file.size, name: title || file.name, title: title || null, fileName: file.name, size: file.size, view: 'pdf', typeId, type: 'Invoice',
  }));
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  await screen.findByRole('list', { name: 'Attached documents' });
  await pickType('Invoice');
  const name = screen.getByRole('textbox', { name: 'Document name' });
  fireEvent.change(name, { target: { value: '  Invoice JI-123/27 ' } });
  choose(fileOf('scan020.pdf', 1000));
  await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1));
  expect(uploadDocument.mock.calls[0][5]).toBe('Invoice JI-123/27');
  await waitFor(() => expect(name).toHaveValue(''));
  // Shown by its name, with the file's own under it.
  const row = (await screen.findByRole('button', { name: 'Invoice JI-123/27' })).closest('li');
  expect(row).toHaveTextContent('scan020.pdf');
});

test('several files under one name are numbered', async () => {
  uploadDocument.mockResolvedValue({ id: 70, name: 'x', size: 1, view: 'pdf' });
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  await screen.findByRole('list', { name: 'Attached documents' });
  await pickType('Invoice');
  fireEvent.change(screen.getByRole('textbox', { name: 'Document name' }), { target: { value: 'Packing list' } });
  choose(fileOf('scan1.pdf', 10), fileOf('scan2.pdf', 11));
  await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(2));
  expect(uploadDocument.mock.calls.map((c) => c[5])).toEqual(['Packing list (1)', 'Packing list (2)']);
});

test('renamed later with the pencil: Enter saves, Escape leaves it as it was', async () => {
  renameDocument.mockResolvedValue({ ...DOCS[0], name: 'Invoice JI-123/27', title: 'Invoice JI-123/27', fileName: 'GD scan.pdf' });
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  await screen.findByRole('list', { name: 'Attached documents' });

  fireEvent.click(within(rowOf('Letter.docx')).getByRole('button', { name: 'Rename' }));
  const other = screen.getByRole('textbox', { name: 'New name for Letter.docx' });
  fireEvent.change(other, { target: { value: 'never saved' } });
  fireEvent.keyDown(other, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'New name for Letter.docx' })).toBeNull();
  expect(renameDocument).not.toHaveBeenCalled();

  fireEvent.click(within(rowOf('GD scan.pdf')).getByRole('button', { name: 'Rename' }));
  const box = screen.getByRole('textbox', { name: 'New name for GD scan.pdf' });
  fireEvent.change(box, { target: { value: 'Invoice JI-123/27' } });
  fireEvent.keyDown(box, { key: 'Enter', code: 'Enter', keyCode: 13, charCode: 13 });
  await waitFor(() => expect(renameDocument).toHaveBeenCalledWith(3, 'Invoice JI-123/27'));
  const row = (await screen.findByRole('button', { name: 'Invoice JI-123/27' })).closest('li');
  expect(row).toHaveTextContent('GD scan.pdf');
});

test('removing one asks first, then takes it off the list', async () => {
  deleteDocument.mockResolvedValue({ status: 'success' });
  render(<DocumentsPanel entity='SE_Job' recordId={42} />);
  await screen.findByRole('list', { name: 'Attached documents' });
  fireEvent.click(within(rowOf('GD scan.pdf')).getByRole('button', { name: 'Remove' }));
  expect(deleteDocument).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith(3));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'GD scan.pdf' })).toBeNull());
});

test('the paperclip shows how many there are, and opens them in a window', async () => {
  render(<DocumentsButton entity='Invoice' recordId={7} title='Documents - Invoice JI-1/26' />);
  const button = await screen.findByRole('button', { name: 'Documents (3)' });
  expect(button).toHaveTextContent('3');
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Documents - Invoice JI-1/26')).toBeInTheDocument();
  expect(await within(dialog).findByRole('list', { name: 'Attached documents' })).toBeInTheDocument();
  expect(listDocuments).toHaveBeenCalledWith('Invoice', 7);
});

test('the paperclip is off until the record is saved', () => {
  render(<DocumentsButton entity='Invoice' recordId={undefined} />);
  expect(screen.getByRole('button', { name: 'Documents' })).toBeDisabled();
  expect(listDocuments).not.toHaveBeenCalled();
});

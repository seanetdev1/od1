/**
 * The B/L's print screen (Ref No's / Stamps tab) with a Word template for its
 * document - "Bill of Lading", or "Air Waybill" for an air job (the user's
 * request, 2026-11-01): Print prints the template, its PDF made while the
 * tab is open, every copy under Copies in one PDF; the built-in layout is a
 * switch away. No template: the screen as it was.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('apis/axiosClient', () => ({
  get: (...a) => mockGet(...a),
  post: (...a) => mockPost(...a),
}));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('functions/companyBranding', () => ({
  getCompany: (id) => (String(id) === '3' ? { id: 3, title: 'SEANET SHIPPING & LOGISTICS' } : null),
}));
// The built-in print itself is BlPrintImage's own test.
jest.mock('../Components/Layouts/JobsLayout/BlComp/BlPrintImage', () => ({
  __esModule: true,
  default: ({ caller, printLabel }) => (caller ? <button type='button'>{`Built-in ${printLabel || 'Print'}`}</button> : null),
  // The real split - which boxes make an attach sheet is part of the screen's rule.
  attachSheetOf: (...a) => jest.requireActual('../Components/Layouts/JobsLayout/BlComp/BlPrintImage').attachSheetOf(...a),
}));
jest.mock('../Components/Layouts/JobsLayout/BlComp/BlPrintModal', () => () => null);

// eslint-disable-next-line import/first
import Stamps from '../Components/Layouts/JobsLayout/BlComp/Stamps';

const values = { hbl: 'SNSL/KHI/0425', jobNo: 'SNS-SE-425/26', operation: 'SE', freightType: '2', stamps: [] };
const state = { tabState: '4', Container_Infos: [], shipperContent: '<p>ABC TEXTILES</p>' };
const TEMPLATE = { id: 21, companyId: 3, docType: 'Bill of Lading', fileName: 'seanet-bl.docx' };

const printScreen = (props = {}) => render(
  <Stamps state={state} control={{}} register={() => ({})} handleSubmit={(f) => f}
    useWatch={({ name }) => (name === 'stamps' ? [] : (props.values || values))}
    fields={[]} append={jest.fn()} remove={jest.fn()} onDelete={jest.fn()} errors={{}}
    data={{ result: { id: 1, companyId: '3', operation: props.type || 'SE' } }} type={props.type || 'SE'} />,
);

let finish;
beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  global.URL.createObjectURL = jest.fn(() => 'blob:bl');
  global.URL.revokeObjectURL = jest.fn();
  window.open = jest.fn(() => ({}));
  mockGet.mockImplementation(async (url, { params }) => ({
    data: { result: /applies$/.test(url) && params.type === 'Bill of Lading' && params.companyId === '3' ? TEMPLATE : null },
  }));
  mockPost.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ data: new Blob(['%PDF']) }); }));
});

test('with a template, Print prints it - made while the tab is open, opened ready', async () => {
  printScreen();
  await screen.findByText('seanet-bl.docx');
  expect(screen.getByRole('button', { name: /Preparing/ })).toBeTruthy();
  // The built-in's own options are for the built-in layout.
  expect(screen.queryByText('Paper')).toBeNull();
  await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
  const [url, body] = mockPost.mock.calls[0];
  expect(url).toMatch(/\/printingTemplates\/render$/);
  expect(body).toMatchObject({ templateId: 21, format: 'pdf', fileName: 'SNSL/KHI/0425 Bill of Lading' });
  // One Non-Negotiable to start with (the user, 2026-11-02).
  expect(body.fields).toMatchObject({ blNo: 'SNSL/KHI/0425', companyName: 'SEANET SHIPPING & LOGISTICS', shipper: 'ABC TEXTILES', copyName: 'NON-NEGOTIABLE' });
  finish();
  const print = await screen.findByRole('button', { name: /printer Print$/ });
  fireEvent.click(print);
  expect(window.open).toHaveBeenCalledWith('blob:bl', '_blank');
});

test('every copy under Copies prints once, as one PDF', async () => {
  printScreen();
  await screen.findByText('seanet-bl.docx');
  await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
  const [originals, nonNegotiable] = screen.getAllByRole('spinbutton');
  expect([originals.value, nonNegotiable.value]).toEqual(['0', '1']);
  fireEvent.change(originals, { target: { value: '1' } });
  fireEvent.change(nonNegotiable, { target: { value: '2' } });
  await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
  const [url, body] = mockPost.mock.calls[1];
  expect(url).toMatch(/\/printingTemplates\/renderMany$/);
  expect(body.items.map((i) => i.fields.copyName)).toEqual(['ORIGINAL', 'NON-NEGOTIABLE', 'NON-NEGOTIABLE']);
  expect(screen.getByText(/3 B\/Ls \(1 Original, 2 Non-Negotiable\)/)).toBeTruthy();
});

test('the built-in layout is a switch away, with its own options', async () => {
  printScreen();
  await screen.findByText('seanet-bl.docx');
  fireEvent.click(screen.getByText('Built-in layout'));
  expect(screen.getByText('Paper')).toBeTruthy();
  expect(screen.getByText('Print what')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Built-in Print' })).toBeTruthy();
  expect(screen.queryByText('seanet-bl.docx')).toBeNull();
});

test('no template: the screen as it was, and nothing is made', async () => {
  mockGet.mockImplementation(async () => ({ data: { result: null } }));
  printScreen();
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  expect(screen.queryByText('Layout')).toBeNull();
  expect(screen.getByText('Paper')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Built-in Print' })).toBeTruthy();
  await new Promise((r) => setTimeout(r, 500));
  expect(mockPost).not.toHaveBeenCalled();
});

test('an air job asks for its Air Waybill template', async () => {
  printScreen({ type: 'AE', values: { ...values, operation: 'AE' } });
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  expect(mockGet.mock.calls[0][1].params).toEqual({ companyId: '3', type: 'Air Waybill' });
});

/* THE ATTACH SHEET WITH A TEMPLATE (the user, 2026-11-20: lost when the Word
 * template came in). The template prints the B/L; what is typed in the
 * Attach sheet boxes prints on the built-in attach sheet, from its own button. */
test('with a template and an Attach sheet box filled, both print - each from its own button', async () => {
  render(
    <Stamps state={{ ...state, marksContentTwo: '<p>CTN 501-900</p>' }} control={{}} register={() => ({})} handleSubmit={(f) => f}
      useWatch={({ name }) => (name === 'stamps' ? [] : values)}
      fields={[]} append={jest.fn()} remove={jest.fn()} onDelete={jest.fn()} errors={{}}
      data={{ result: { id: 1, companyId: '3', operation: 'SE' } }} type='SE' />,
  );
  await screen.findByText('seanet-bl.docx');
  expect(screen.getByText('Print what')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Built-in Print attach sheet' })).toBeTruthy();
  expect(screen.getByText(/1 B\/L \+ 1 attach sheet/)).toBeTruthy();
  await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
  finish();
  expect(await screen.findByRole('button', { name: /printer Print B\/L$/ })).toBeTruthy();

  fireEvent.click(screen.getByText('B/L only'));
  expect(screen.queryByRole('button', { name: 'Built-in Print attach sheet' })).toBeNull();
  fireEvent.click(screen.getByText('Attach sheets only'));
  expect(screen.getByRole('button', { name: 'Built-in Print attach sheet' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /printer Print/ })).toBeNull();
});

test('with a template and nothing in the Attach sheet boxes, no choice to make', async () => {
  printScreen();
  await screen.findByText('seanet-bl.docx');
  expect(screen.queryByText('Print what')).toBeNull();
  expect(screen.queryByRole('button', { name: /attach sheet/ })).toBeNull();
});

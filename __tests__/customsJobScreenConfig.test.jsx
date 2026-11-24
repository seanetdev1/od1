/**
 * Configuration > Customs > Job Screen (Essani, 2026-11-14): the S/R Page #'s
 * name, the switches, and the tabs and sections - saved as one setting.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axiosClient from 'apis/axiosClient';
import CustomsJobScreen from '../Components/Layouts/Config/CustomsJobScreen';
import { SECTION_KEYS } from 'functions/customsJobForm';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

const UNSET = {
  referenceLabel: 'S/R Page #', layout: null, addPorts: false,
  containerSizeList: false, freightForwarding: false, commodities: true,
  uniqueGdNumber: false, uniqueClientInvoice: false, uniqueJobRef: false,
};

const opened = async (result = UNSET) => {
  axiosClient.get.mockImplementation((url) => Promise.resolve({
    data: { status: 'success', result: url === '/settings/customsJobForm' ? result : { enabled: false } },
  }));
  axiosClient.post.mockImplementation((url, body) => Promise.resolve({ data: { status: 'success', result: body } }));
  render(<CustomsJobScreen />);
  await waitFor(() => expect(screen.getByText('Tabs and sections')).toBeInTheDocument());
};
const tabNames = () => screen.getAllByLabelText(/^Tab \d+ name$/).map((i) => i.value);

afterEach(() => jest.clearAllMocks());

test('unset: the built-in tabs, and nothing to save', async () => {
  await opened();
  expect(tabNames()).toEqual(['Job Details', 'Loading Program (CRO)', 'Transport', 'Booking Info', 'Goods Declaration']);
  expect(screen.getByText('Saved')).toBeDisabled();
});

test("Essani's: one tab, a new name for the S/R Page #, no commodities - saved together", async () => {
  await opened();
  fireEvent.click(screen.getByText('Everything on one tab'));
  expect(tabNames()).toEqual(['Job Details']);
  fireEvent.change(screen.getByLabelText('Name of the S/R Page #'), { target: { value: 'File Job Number' } });
  fireEvent.click(screen.getByLabelText('Commodities'));
  fireEvent.click(screen.getByLabelText('Freight Forwarding job type'));
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(axiosClient.post).toHaveBeenCalled());
  const [url, body] = axiosClient.post.mock.calls[0];
  expect(url).toBe('/settings/customsJobForm');
  expect(body).toMatchObject({ referenceLabel: 'File Job Number', commodities: false, freightForwarding: true });
  expect(body.layout.tabs).toEqual([{ key: 'details', title: 'Job Details', sections: SECTION_KEYS }]);
});

test('a section moved to another tab, a tab renamed; an empty tab can go', async () => {
  await opened();
  // Containers from Transport to Job Details.
  fireEvent.mouseDown(screen.getAllByLabelText('Containers tab')[0].closest('.ant-select').querySelector('.ant-select-selector'));
  fireEvent.click(await screen.findByText('Job Details', { selector: '.ant-select-item-option-content' }));
  fireEvent.change(screen.getByLabelText('Tab 3 name'), { target: { value: 'Haulage' } });
  // Booking Info's only section to Goods Declaration - Booking Info is then empty and can go.
  fireEvent.mouseDown(screen.getAllByLabelText('Documents tab')[0].closest('.ant-select').querySelector('.ant-select-selector'));
  const options = await screen.findAllByText('Goods Declaration', { selector: '.ant-select-item-option-content' });
  fireEvent.click(options[options.length - 1]);
  expect(screen.getByText('Empty - not shown on the job.')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Remove tab 4'));
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(axiosClient.post).toHaveBeenCalled());
  const { layout } = axiosClient.post.mock.calls[0][1];
  expect(layout.tabs.map((t) => t.title)).toEqual(['Job Details', 'Loading Program (CRO)', 'Haulage', 'Goods Declaration']);
  expect(layout.tabs[0].sections).toEqual(['jobDetails', 'status', 'containers']);
  expect(layout.tabs[3].sections).toEqual(['goodsDeclaration', 'goods', 'commercialInvoice', 'documents']);
});

test('a tab with no name cannot be saved', async () => {
  await opened();
  fireEvent.change(screen.getByLabelText('Tab 2 name'), { target: { value: '' } });
  expect(screen.getByText('Save')).toBeDisabled();
});

test("the numbers no two jobs may share - the S/R one under the install's name", async () => {
  await opened({ ...UNSET, referenceLabel: 'File Job Number' });
  expect(screen.getByLabelText('File Job Number on one job only')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('GD # on one job only'));
  fireEvent.click(screen.getByLabelText('Client Invoice # on one job only'));
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(axiosClient.post).toHaveBeenCalled());
  expect(axiosClient.post.mock.calls[0][1]).toMatchObject({
    uniqueGdNumber: true, uniqueClientInvoice: true, uniqueJobRef: false,
  });
});

/**
 * A customs job's screen under Configuration > Customs > Job Screen (Essani,
 * 2026-11-14) - and, with nothing set, exactly as before.
 *
 * Renders the real CustomsJobs/CreateOrEdit; the server, the charge sheet and
 * the app's frame are stood in for.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import axiosClient from 'apis/axiosClient';
import { getCustomsJobById } from 'apis/customsJobs';
import { createPort } from 'apis/pickLists';
import CreateOrEdit from '../Components/Layouts/CustomsJobs/CreateOrEdit';

jest.mock('react-redux', () => ({
  useDispatch: () => jest.fn(),
  useStore: () => ({ getState: () => ({}) }),
}));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('js-cookie', () => ({ get: (k) => ({ username: 'tester', loginId: '9', fiscalYearId: '3' }[k]) }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('apis/customsJobs', () => ({
  getCustomsValues: jest.fn(),
  getCustomsJobById: jest.fn(),
  createCustomsJob: jest.fn(), editCustomsJob: jest.fn(), deleteCustomsJob: jest.fn(),
  makeCustomsInvoice: jest.fn(), unlockCustomsJob: jest.fn(),
  getCustomsNotes: jest.fn(), addCustomsNote: jest.fn(),
}));
jest.mock('apis/pickLists', () => ({ createPort: jest.fn(), updatePort: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: () => {} }));
jest.mock('Components/Shared/Documents', () => ({ useDocuments: () => ({ extra: { key: 'docs' }, modal: null, count: 0, saved: 0 }) }));
jest.mock('Components/Shared/useClientCreditGuard', () => () => ({
  modal: null, pick: (v, { allowed }) => allowed(), mark: (o) => o,
}));
jest.mock('Components/Shared/AuditStamp', () => () => null);
// The charge sheet is its own screen, with its own tests.
jest.mock('../Components/Layouts/CustomsJobs/Charges', () => ({
  __esModule: true,
  default: () => <div>the charge sheet</div>,
  CURRENCY_CODES: ['PKR', 'USD'],
}));
jest.mock('functions/myPermissions', () => ({ useMyPermissions: () => () => true }));
// A customs install - the Ports form's "Customs port of loading" box shows.
jest.mock('functions/terminology', () => ({
  ...jest.requireActual('functions/terminology'), isCustomsMode: () => true, getMode: () => 'customs',
}));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

const { getCustomsValues } = jest.requireMock('apis/customsJobs');

const VALUES = {
  party: [{ id: 1, name: 'ACME' }], client: [{ id: 1, name: 'ACME' }], shipper: [], consignee: [],
  commodity: [{ id: 5, name: 'GARMENTS' }], port: [{ id: 'PKKHI', name: 'KARACHI' }], charge: [],
  localVendor: [], chaChb: [], transporter: [], shippingLine: [],
  vocabulary: {
    directions: ['Import', 'Export'], transportModes: ['Sea', 'Air'], gdTypes: [], channels: [],
    statuses: [], dutyPaidBy: [], polSea: [{ id: 'QICT', name: 'QICT' }], polAir: [], terminalSea: [], terminalAir: [],
    cargoTypesSea: ['FCL'], cargoTypesAir: [], incoTerms: [],
  },
};
const JOB = {
  id: 41, jobNo: 'ESS-CC-41/27', direction: 'Export', transportMode: 'Sea', jobType: 'Clearing + Transport',
  jobRef: 'F-881', clientRef: 'CI-77', invoiceNo: 'CI-77', blNo: 'HBL-5521', clientId: 1,
  Customs_Containers: [], Charge_Heads: [], Customs_Duties: [],
};

const ESSANI = {
  referenceLabel: 'File Job Number', commodities: false, freightForwarding: true,
  addPorts: true, containerSizeList: true,
  layout: { tabs: [{ key: 'details', title: 'Job Details', sections: [
    'jobDetails', 'status', 'parties', 'route', 'haulage', 'containers',
    'documents', 'goodsDeclaration', 'goods', 'commercialInvoice',
  ] }] },
};

const serve = (jobForm, job = JOB) => {
  getCustomsValues.mockResolvedValue({ status: 'success', result: VALUES });
  getCustomsJobById.mockResolvedValue({ status: 'success', result: job });
  axiosClient.get.mockImplementation((url) => {
    if (url === '/settings/customsJobForm') {
      return jobForm ? Promise.resolve({ data: { status: 'success', result: jobForm } }) : Promise.reject(new Error('none'));
    }
    return Promise.resolve({ data: { status: 'success', result: { enabled: false } } });
  });
};

// A port heading that opens the Ports form - see portHeading.
const portButton = (name) => [...document.querySelectorAll('.cj-label-link')].find((b) => b.textContent.includes(name));
const tabTitles = () => [...document.querySelectorAll('.ant-tabs-tab-btn')].map((t) => t.textContent);
const labels = () => [...document.querySelectorAll('.cj-label')].map((l) => l.textContent.trim());
const opened = async (jobForm, job) => {
  serve(jobForm, job);
  render(<CreateOrEdit id='41' companyId='1' />);
  await waitFor(() => expect(screen.getByText('Job No.')).toBeInTheDocument());
};

afterEach(() => jest.clearAllMocks());

describe('nothing set - the screen as it was', () => {
  test('the five tabs, then Charges', async () => {
    await opened(null);
    expect(tabTitles()).toEqual(['Job Details', 'Loading Program (CRO)', 'Transport', 'Booking Info', 'Goods Declaration', 'Charges']);
  });

  test('S/R Page #, Client Invoice #, plain port headings, and the Commodity box', async () => {
    await opened(null);
    expect(labels()).toContain('S/R Page # *');
    expect(labels()).toContain('Client Invoice #');
    fireEvent.click(screen.getByText('Loading Program (CRO)'));
    await waitFor(() => expect(labels()).toContain('Port Of Loading'));
    expect(portButton('Port Of Loading')).toBeUndefined();
    fireEvent.click(screen.getByText('Goods Declaration', { selector: '.ant-tabs-tab-btn' }));
    await waitFor(() => expect(labels()).toContain('Commodity'));
  });
});

describe("Essani's settings", () => {
  test('everything on Job Details, then Charges', async () => {
    await opened(ESSANI);
    expect(tabTitles()).toEqual(['Job Details', 'Charges']);
    // Every section on the one tab.
    ['Parties', 'Route', 'Haulage', 'Containers', 'Documents', 'Goods Declaration', 'Goods', 'Commercial invoice']
      .forEach((t) => expect(screen.getAllByText(t, { selector: '.cj-card-title' }).length).toBe(1));
  });

  test('the reference under its install name; Client and Client Invoice # shown once on the one tab', async () => {
    await opened(ESSANI);
    expect(labels()).toContain('File Job Number *');
    expect(labels()).not.toContain('S/R Page # *');
    expect(labels().filter((l) => l === 'Client *')).toHaveLength(1);
    expect(labels().filter((l) => l === 'Client Invoice #')).toHaveLength(1);
  });

  test('no Commodity box', async () => {
    await opened(ESSANI);
    expect(labels()).not.toContain('Commodity');
    expect(labels()).toContain('Goods Description');
  });

  test('a Freight Forwarding job has an HBL # in place of the Client Invoice #', async () => {
    await opened(ESSANI, { ...JOB, jobType: 'Freight Forwarding' });
    expect(labels()).toContain('HBL #');
    expect(labels()).not.toContain('Client Invoice #');
    expect(screen.getByDisplayValue('HBL-5521')).toBeInTheDocument();
  });

  test("a port heading opens Setup > Ports' form, and the job picks the port it adds", async () => {
    await opened(ESSANI);
    fireEvent.click(portButton('Port Of Discharge'));
    await waitFor(() => expect(screen.getByText('Create Port')).toBeInTheDocument());
    // Added as a Port Of Discharge: not ticked as a customs port of loading.
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    createPort.mockResolvedValue({ status: 'success', result: { id: 900, portId: 'AEJEA', portName: 'JEBEL ALI', portCountry: 'UAE' } });
    getCustomsValues.mockResolvedValue({
      status: 'success', result: { ...VALUES, port: [...VALUES.port, { id: 'AEJEA', name: 'JEBEL ALI' }] },
    });
    const form = screen.getByText('Create Port').closest('form') || document.querySelector('.ant-modal form');
    fireEvent.change(within(form).getAllByRole('textbox')[0], { target: { value: 'AEJEA' } });
    fireEvent.change(within(form).getAllByRole('textbox')[1], { target: { value: 'JEBEL ALI' } });
    fireEvent.change(within(form).getAllByRole('textbox')[2], { target: { value: 'UAE' } });
    fireEvent.click(within(form).getByText('Submit'));
    await waitFor(() => expect(createPort).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('JEBEL ALI').length).toBeGreaterThan(0));
  });

  test('Port Of Loading adds a port ticked as a customs port of loading', async () => {
    await opened(ESSANI);
    fireEvent.click(portButton('Port Of Loading'));
    await waitFor(() => expect(screen.getByText('Create Port')).toBeInTheDocument());
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  test("a container's size is picked from the list", async () => {
    await opened(ESSANI);
    fireEvent.click(screen.getByText('+ Add container'));
    expect(screen.getAllByLabelText('Container 1 size')[0].closest('.ant-select')).toBeInTheDocument();
  });
});

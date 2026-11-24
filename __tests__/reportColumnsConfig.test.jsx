/**
 * Config > Reports: where report dates start, Job Balancing's advances, and
 * the columns each report opens with, and their order - the Job Balancing
 * grid, and on a customs install the VAT Detail.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ReportColumns from '../Components/Layouts/Config/ReportColumns';
import { jobBalancingColumns } from 'functions/jobBalancingColumns';

const mockGet = jest.fn();
const mockPost = jest.fn();
let mockMode = 'customs';
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
const mockCookieSet = jest.fn();
jest.mock('js-cookie', () => ({
  get: (k) => (k === 'operationMode' ? mockMode : undefined),
  set: (...a) => mockCookieSet(...a),
}));
// The install's fiscal years, as MainLayout keeps them (Setup > Fiscal Years).
let mockFiscalYears = [];
jest.mock('react-redux', () => ({ useSelector: (pick) => pick({ fiscalYear: { fiscalYears: mockFiscalYears } }) }));
jest.mock('Components/Shared/Notification', () => jest.fn());

const card = (report) => document.querySelector(`[data-report="${report}"]`);
const rows = (report = 'jobBalancingGrid') => [...card(report).querySelectorAll('.ant-checkbox-wrapper')].map((w) => ({
  heading: w.textContent, on: w.querySelector('input').checked,
}));
// Each card asks for its own report's setting.
const saved = (byReport) => (url) => Promise.resolve({
  data: { status: 'success', result: byReport[url.split('/').pop()] ?? null },
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockMode = 'customs';
  mockCookieSet.mockReset();
  mockFiscalYears = [];
});

describe('the Job Balancing grid', () => {
  test('lists the saved columns first, ticked and in order, then the rest - this mode\'s only', async () => {
    mockGet.mockImplementation(saved({ jobBalancingGrid: ['balance', 'invoice_No'] }));
    render(<ReportColumns />);
    await waitFor(() => expect(card('jobBalancingGrid').querySelectorAll('.ant-checkbox-wrapper').length).toBe(jobBalancingColumns('customs').length));
    expect(rows().slice(0, 3)).toEqual([
      { heading: 'Balance', on: true }, { heading: 'Inv. No', on: true }, { heading: '#', on: false },
    ]);
    expect(rows().map((r) => r.heading)).not.toContain('File No');   // freight only
  });

  test('saves the ticked columns in the order they are listed', async () => {
    mockGet.mockImplementation(saved({ jobBalancingGrid: ['balance', 'invoice_No'] }));
    mockPost.mockImplementation((url, { columns }) => Promise.resolve({ data: { status: 'success', result: columns } }));
    render(<ReportColumns />);
    await waitFor(() => expect(within(card('jobBalancingGrid')).getByText('Save (2 columns)')).toBeTruthy());
    const jb = within(card('jobBalancingGrid'));

    fireEvent.click(jb.getByLabelText('Move Inv. No up'));
    fireEvent.click(jb.getByText('Client'));
    fireEvent.click(jb.getByText('Save (3 columns)'));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledWith('/settings/reportColumns/jobBalancingGrid', {
      columns: ['invoice_No', 'balance', 'party_Name'],
    });
  });

  test('Built-in clears the setting - every column again', async () => {
    mockGet.mockImplementation(saved({ jobBalancingGrid: ['balance'] }));
    mockPost.mockResolvedValue({ data: { status: 'success', result: null } });
    render(<ReportColumns />);
    await waitFor(() => expect(within(card('jobBalancingGrid')).getByText('Save (1 columns)')).toBeTruthy());
    fireEvent.click(within(card('jobBalancingGrid')).getByText('Built-in'));
    await waitFor(() => expect(rows().every((r) => r.on)).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/settings/reportColumns/jobBalancingGrid', { columns: [] });
  });
});

describe('the VAT Detail', () => {
  test('opens on the built-in ten, listed in the return\'s order, the five rarely wanted unticked', async () => {
    mockGet.mockImplementation(saved({}));
    render(<ReportColumns />);
    await waitFor(() => expect(card('vatDetail')).toBeTruthy());
    await waitFor(() => expect(rows('vatDetail')).toHaveLength(15));
    expect(rows('vatDetail')).toEqual([
      { heading: 'Sr #', on: true }, { heading: 'NTN', on: true }, { heading: 'CNIC', on: false },
      { heading: 'Name of Buyer', on: true }, { heading: 'District of Buyer', on: true }, { heading: 'Buyer Type', on: false },
      { heading: 'Document Type', on: false }, { heading: 'Document Number', on: true }, { heading: 'Document Date', on: true },
      { heading: 'HS Code', on: true }, { heading: 'Sale Type', on: false }, { heading: 'Rate', on: true },
      { heading: 'Value of Sales Excluding Sales Tax', on: true }, { heading: 'Sales Tax Involved', on: true },
      { heading: 'ST Withheld at Source', on: false },
    ]);
  });

  test('saves its own setting', async () => {
    mockGet.mockImplementation(saved({}));
    mockPost.mockImplementation((url, { columns }) => Promise.resolve({ data: { status: 'success', result: columns } }));
    render(<ReportColumns />);
    await waitFor(() => expect(within(card('vatDetail')).getByText('Save (10 columns)')).toBeTruthy());
    fireEvent.click(within(card('vatDetail')).getByText('CNIC'));
    fireEvent.click(within(card('vatDetail')).getByText('Save (11 columns)'));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0][0]).toBe('/settings/reportColumns/vatDetail');
    expect(mockPost.mock.calls[0][1].columns).toContain('cnic');
    expect(mockPost.mock.calls[0][1].columns).toHaveLength(11);
  });

  test('a saved set opens ticked, in its order', async () => {
    mockGet.mockImplementation(saved({ vatDetail: ['buyer', 'tax', 'cnic'] }));
    render(<ReportColumns />);
    await waitFor(() => expect(within(card('vatDetail')).getByText('Save (3 columns)')).toBeTruthy());
    expect(rows('vatDetail').slice(0, 4)).toEqual([
      { heading: 'Name of Buyer', on: true }, { heading: 'Sales Tax Involved', on: true },
      { heading: 'CNIC', on: true }, { heading: 'Sr #', on: false },
    ]);
  });

  test.each(['freight', 'aviation'])('is not offered in %s mode, which has no VAT Detail', async (mode) => {
    mockMode = mode;
    mockGet.mockImplementation(saved({}));
    render(<ReportColumns />);
    await waitFor(() => expect(card('jobBalancingGrid')).toBeTruthy());
    expect(card('vatDetail')).toBeNull();
    expect(screen.queryByText('VAT Detail')).toBeNull();
  });
});

describe('Job Balancing - Show Advance Transactions by default', () => {
  const sw = () => screen.getByLabelText('Show Advance Transactions by default', { selector: 'button' });
  const section = () => within(document.querySelector('section[aria-label="Job Balancing — Advance Transactions"]'));

  test('on until an admin turns it off; saved as off', async () => {
    mockGet.mockImplementation((url) => Promise.resolve({ data: { status: 'success',
      result: url === '/settings/jobBalancingAdvances' ? { enabled: true } : null } }));
    mockPost.mockImplementation((url, body) => Promise.resolve({ data: { status: 'success', result: body } }));
    render(<ReportColumns />);
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('true'));
    expect(section().getByText('Saved').disabled).toBe(true);
    fireEvent.click(sw());
    fireEvent.click(section().getByText('Save'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/settings/jobBalancingAdvances', { enabled: false }));
    await waitFor(() => expect(section().getByText('Saved')).toBeTruthy());
  });

  test('an install that turned it off opens on off', async () => {
    mockGet.mockImplementation((url) => Promise.resolve({ data: { status: 'success',
      result: url === '/settings/jobBalancingAdvances' ? { enabled: false } : null } }));
    render(<ReportColumns />);
    await waitFor(() => expect(sw().getAttribute('aria-checked')).toBe('false'));
  });
});

describe('Report Dates', () => {
  const section = () => within(document.querySelector('section[aria-label="Report Dates"]'));
  const choose = async (label, option) => {
    fireEvent.mouseDown(section().getByLabelText(label, { selector: 'input' }));
    fireEvent.click(await screen.findByTitle(option));
  };
  const serve = (dates) => mockGet.mockImplementation((url) => Promise.resolve({ data: { status: 'success',
    result: url === '/settings/reportDates' ? dates : null } }));

  beforeAll(() => {
    window.matchMedia = window.matchMedia || ((q) => ({
      matches: false, media: q, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    }));
  });

  test('opens on what the install has, and shows the dates it gives today', async () => {
    serve({ from: 'fiscalStart', to: 'today' });
    mockFiscalYears = [{ startDate: '2026-07-01', endDate: '2027-06-30' }];
    render(<ReportColumns />);
    await waitFor(() => expect(section().getByText('Start of the fiscal year')).toBeTruthy());
    expect(section().getByText('Today')).toBeTruthy();
    expect(section().getByTestId('report-dates-example').textContent).toMatch(/^Today that is 01-07-20\d\d to /);
    expect(section().getByText('Saved').disabled).toBe(true);
  });

  test('to the end of the fiscal year: saved, and remembered in this browser at once', async () => {
    serve({ from: 'fiscalStart', to: 'today' });
    mockFiscalYears = [{ startDate: '2000-01-01', endDate: '2099-12-31' }];   // has today in it
    mockPost.mockImplementation((url, body) => Promise.resolve({ data: { status: 'success', result: body } }));
    render(<ReportColumns />);
    await waitFor(() => expect(section().getByText('Today')).toBeTruthy());
    await choose('To starts on', 'End of the fiscal year');
    expect(section().getByTestId('report-dates-example').textContent).toMatch(/to 31-12-2099\.$/);
    fireEvent.click(section().getByText('Save'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/settings/reportDates', { from: 'fiscalStart', to: 'fiscalEnd' }));
    await waitFor(() => expect(mockCookieSet).toHaveBeenCalled());
    const [name, value] = mockCookieSet.mock.calls[0];
    expect(name).toBe('reportDates');
    expect(JSON.parse(value)).toEqual({ from: 'fiscalStart', to: 'fiscalEnd', fy: { start: '2000-01-01', end: '2099-12-31' } });
    await waitFor(() => expect(section().getByText('Saved')).toBeTruthy());
  });
});

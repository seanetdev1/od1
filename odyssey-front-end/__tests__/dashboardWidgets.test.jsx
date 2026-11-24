/**
 * Which designation sees which widget on the home page (the user's request,
 * 2026-11-23): the home page lays itself out from /home/widgets, and
 * Configuration > Dashboard Widgets ticks the grid.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Main from '../Components/Layouts/Main';
import DashboardWidgets from '../Components/Layouts/Config/DashboardWidgets';

const mockGet = jest.fn();
const mockPost = jest.fn();
let mockMode = 'freight';
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('js-cookie', () => ({ get: () => undefined, set: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('functions/terminology', () => ({
  isAviationMode: () => mockMode === 'aviation',
  isCustomsMode: () => mockMode === 'customs',
}));
// The widgets themselves are tested elsewhere; here only which are drawn.
jest.mock('../Components/Layouts/Main/DashboardStats', () => () => <div data-testid='w-freightCounters' />);
jest.mock('../Components/Layouts/Main/CustomsDashboardStats', () => () => <div data-testid='w-customsCounters' />);
jest.mock('../Components/Layouts/Main/AviationDashboardStats', () => () => <div data-testid='w-aviationCounters' />);
jest.mock('../Components/Layouts/Main/ChartComp', () => ({ type }) => <div data-testid={`w-chart${type}`} />);
jest.mock('../Components/Layouts/Main/AuditLog', () => () => <div data-testid='w-auditLog' />);
jest.mock('../Components/Layouts/Dashboard/Home/Accounts', () => () => <div data-testid='w-pending' />);
jest.mock('../Components/Layouts/Main/UploadBackUp', () => () => null);
jest.mock('../Components/Layouts/Main/ollama', () => () => null);

const drawn = () => screen.queryAllByTestId(/^w-/).map((el) => el.getAttribute('data-testid'));
const widgets = (list) => mockGet.mockResolvedValue({ data: { status: 'success', result: { widgets: list } } });

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockMode = 'freight';
});

describe('the home page', () => {
  test('draws the widgets the server names for this user, and no others', async () => {
    widgets(['jobCounters', 'cashFlow', 'auditLog']);
    render(<Main sessionData={{ isLoggedIn: true }} />);
    await waitFor(() => expect(drawn().length).toBeGreaterThan(0));
    expect(mockGet).toHaveBeenCalledWith('/home/widgets');
    expect(drawn()).toEqual(['w-freightCounters', 'w-chartTwo', 'w-auditLog']);
  });

  test('all five, on a customs install with its own counters', async () => {
    mockMode = 'customs';
    widgets(['jobCounters', 'incomeExpense', 'cashFlow', 'pendingInvoices', 'auditLog']);
    render(<Main sessionData={{ isLoggedIn: true }} />);
    await waitFor(() => expect(drawn()).toEqual(['w-customsCounters', 'w-chartOne', 'w-chartTwo', 'w-pending', 'w-auditLog']));
  });

  test('none set - says so rather than a blank page', async () => {
    widgets([]);
    render(<Main sessionData={{ isLoggedIn: true }} />);
    expect(await screen.findByText(/Nothing is set to show on the dashboard/)).toBeTruthy();
    expect(drawn()).toEqual([]);
  });

  test('a failed ask draws nothing rather than every widget', async () => {
    mockGet.mockRejectedValue(new Error('offline'));
    render(<Main sessionData={{ isLoggedIn: true }} />);
    expect(await screen.findByText(/Nothing is set to show/)).toBeTruthy();
    expect(drawn()).toEqual([]);
  });
});

describe('Configuration > Dashboard Widgets', () => {
  const DESIGNATIONS = ['ceo', 'cfo', 'admin', 'manager', 'accountant', 'gd operator', 'date operator', 'hr', 'rider'];
  const WIDGETS = [
    { key: 'jobCounters', label: 'Job counters' },
    { key: 'incomeExpense', label: 'Income & Expense chart' },
    { key: 'cashFlow', label: 'Cash Flow chart' },
    { key: 'pendingInvoices', label: 'Pending Invoices/Bills' },
    { key: 'auditLog', label: 'Audit Log' },
  ];
  const DEFAULTS = Object.fromEntries(WIDGETS.map((w) => [w.key, ['ceo', 'cfo', 'admin']]));
  const saveButton = () => screen.getByRole('button', { name: /^(Save|Saved|Saving…)$/ });
  const box = (name) => screen.getByRole('checkbox', { name });
  const load = (result = DEFAULTS) => mockGet.mockResolvedValue({
    data: { status: 'success', result, widgets: WIDGETS, designations: DESIGNATIONS, defaults: DEFAULTS },
  });

  test('shows the grid as saved; a tick changes it and Save sends the whole grid', async () => {
    load();
    mockPost.mockImplementation((url, body) => Promise.resolve({ data: { status: 'success', result: body.widgets } }));
    render(<DashboardWidgets />);
    expect((await screen.findByRole('checkbox', { name: 'Job counters - CEO' })).checked).toBe(true);
    expect(box('Job counters - GD Operator').checked).toBe(false);
    expect(saveButton().textContent).toBe('Saved');

    fireEvent.click(box('Job counters - GD Operator'));
    fireEvent.click(box('Audit Log - CEO'));
    expect(saveButton().textContent).toBe('Save');
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton().textContent).toBe('Saved'));
    expect(mockPost).toHaveBeenCalledWith('/settings/dashboardWidgets', {
      widgets: { ...DEFAULTS, jobCounters: ['ceo', 'cfo', 'admin', 'gd operator'], auditLog: ['cfo', 'admin'] },
    });
  });

  test('a designation\'s header box ticks or clears its whole column', async () => {
    load();
    render(<DashboardWidgets />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Accountant: every widget' }));
    for (const w of WIDGETS) expect(box(`${w.label} - Accountant`).checked).toBe(true);
    fireEvent.click(box('CEO: every widget'));
    for (const w of WIDGETS) expect(box(`${w.label} - CEO`).checked).toBe(false);
  });

  test('Back to the default puts CEO, CFO and Admin back on everything, to be saved', async () => {
    load({ ...DEFAULTS, auditLog: [], jobCounters: ['gd operator'] });
    render(<DashboardWidgets />);
    const back = await screen.findByRole('button', { name: 'Back to the default' });
    fireEvent.click(back);
    expect(box('Audit Log - CEO').checked).toBe(true);
    expect(box('Job counters - GD Operator').checked).toBe(false);
    expect(saveButton().textContent).toBe('Save');
  });

  test('a refused save stays unsaved', async () => {
    load();
    mockPost.mockResolvedValue({ data: { status: 'error', result: 'Unknown designation: janitor.' } });
    render(<DashboardWidgets />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Cash Flow chart - HR' }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(saveButton().textContent).toBe('Save');
  });
});

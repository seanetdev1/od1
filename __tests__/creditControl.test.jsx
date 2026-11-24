/**
 * CREDIT CONTROL (the user's request, 2026-10-23) - the screens.
 *
 *  - A job's client box: a party over its limit is marked, a pick of it is
 *    checked on the server, and refused with the way out - ask for approval.
 *  - Accounts > Credit Control: the approvers approve a request until a date.
 *  - Config > Credit Control: off until switched on; Save sends it; Preview
 *    shows the emails a run would send.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('react-redux', () => ({ useSelector: (fn) => fn({ company: { companies: [{ id: 1, title: 'SEANET' }] } }) }));

import { markBlockedOptions, isListedBlocked, forgetCreditBlocks } from 'functions/creditBlocks';
import useClientCreditGuard from 'Components/Shared/useClientCreditGuard';
import CreditControlPage from 'Components/Layouts/AccountsComp/CreditControl';
import CreditControlConfig, { nothingToSend } from 'Components/Layouts/Config/CreditControl';

const blockedState = { active: true, approver: false, blocked: [{ clientId: 5, balancePkr: 10600, limitPkr: 1000 }], requested: [] };
const ok = (result) => Promise.resolve({ data: { status: 'success', result } });

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  forgetCreditBlocks();
  // jsdom has no matchMedia; antd's responsive bits ask for it.
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

describe('the blocked list', () => {
  test('marks a blocked party in the client options, for approvers too', () => {
    const options = [{ id: 5, name: 'ACME (101)' }, { id: 6, name: 'GLOBEX (102)' }];
    expect(markBlockedOptions(options, blockedState).map((o) => o.name)).toEqual(['ACME (101) — over credit limit', 'GLOBEX (102)']);
    expect(markBlockedOptions(options, { ...blockedState, active: false })).toBe(options);
    expect(markBlockedOptions([{ value: 5, label: 'ACME' }], blockedState, { nameKey: 'label', idKey: 'value' })[0].label).toBe('ACME — over credit limit');
  });

  test('knows a blocked party by id, whatever its type', () => {
    expect(isListedBlocked(blockedState, '5')).toBe(true);
    expect(isListedBlocked(blockedState, 6)).toBe(false);
    expect(isListedBlocked({ ...blockedState, active: false }, 5)).toBe(false);
  });
});

describe("a job's client box", () => {
  const calls = { allowed: jest.fn(), refused: jest.fn() };
  let guard;
  const Harness = () => {
    guard = useClientCreditGuard();
    return <>{guard.modal}</>;
  };

  beforeEach(() => { calls.allowed.mockReset(); calls.refused.mockReset(); });

  test('lets any party the list does not have through at once', async () => {
    mockGet.mockReturnValue(ok(blockedState));
    render(<Harness />);
    await waitFor(() => expect(guard.state).toBeTruthy());
    act(() => guard.pick(6, calls));
    expect(calls.allowed).toHaveBeenCalledTimes(1);
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('a blocked party is refused, said why, and approval can be asked for with a note', async () => {
    mockGet.mockReturnValue(ok(blockedState));
    mockPost.mockImplementation((url) => (url === '/creditControl/check'
      ? ok({ block: { clientId: 5, name: 'ACME', code: '101', balancePkr: 10600, limitPkr: 1000 }, approver: false, requested: null })
      : ok({ id: 9 })));
    render(<Harness />);
    await waitFor(() => expect(guard.state).toBeTruthy());

    await act(async () => { guard.pick(5, calls); });
    expect(calls.refused).toHaveBeenCalledTimes(1);
    expect(calls.allowed).not.toHaveBeenCalled();
    expect(await screen.findByText(/cannot be the client on a new job/)).toBeInTheDocument();
    expect(screen.getByText('PKR 10,600.00')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/the shipment that is waiting/), { target: { value: 'Vessel sails Friday' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ask for approval' })); });
    expect(mockPost).toHaveBeenCalledWith('/creditControl/requestUnblock', { clientId: 5, note: 'Vessel sails Friday' });
  });

  test('a party that paid since last night is let through - the server lifted it', async () => {
    mockGet.mockReturnValue(ok(blockedState));
    mockPost.mockReturnValue(ok({ block: null, approver: false }));
    render(<Harness />);
    await waitFor(() => expect(guard.state).toBeTruthy());
    await act(async () => { guard.pick(5, calls); });
    expect(calls.allowed).toHaveBeenCalledTimes(1);
    expect(calls.refused).not.toHaveBeenCalled();
  });

  test('an approver picks a blocked party without being stopped', async () => {
    mockGet.mockReturnValue(ok({ ...blockedState, approver: true }));
    render(<Harness />);
    await waitFor(() => expect(guard.state).toBeTruthy());
    act(() => guard.pick(5, calls));
    expect(calls.allowed).toHaveBeenCalledTimes(1);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('Accounts > Credit Control', () => {
  const overview = {
    settings: { enabled: true, blocking: true, approvalDays: 7, timeZone: 'Asia/Karachi' },
    today: '2026-10-23', pending: 1, omitted: 0,
    flagged: [{ clientId: 5, name: 'ACME', code: '101', creditLimitDays: 30, limitPkr: 1000, balancePkr: 10600, over: true, overdue: 1, oldest: 60, salesRepId: null, blocked: true }],
    blocks: [{ clientId: 5, name: 'ACME', code: '101', balancePkr: 10600, limitPkr: 1000, blockedAt: '2026-10-23T04:00:00Z', holding: true }],
  };
  const request = { id: 9, status: 'pending', note: 'Vessel sails Friday', createdAt: '2026-10-23T05:00:00Z', Client: { id: 5, name: 'ACME', code: '101' }, requestedBy: { name: 'SARA' } };

  test('lists the request, and an approver approves it until a date', async () => {
    mockGet.mockImplementation((url) => (url === '/creditControl/overview' ? ok(overview)
      : url === '/creditControl/requests' ? ok([request]) : ok({ count: 0, rows: [] })));
    mockPost.mockReturnValue(ok({ clientId: 5 }));
    render(<CreditControlPage />);
    expect(await screen.findByText('Vessel sails Friday')).toBeInTheDocument();
    expect(screen.getByText('Requests (1)')).toBeInTheDocument();
    expect(screen.getByText('Blocked (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(dialog.querySelector('.ant-btn-primary')); });
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/creditControl/decide', expect.objectContaining({ id: 9, approve: true, until: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })));
  });

  /* The bills we owe a party count against its invoices; the limit is on the
   * net (2026-10-26). */
  test('flagged shows invoices, our bills and the net; a party opens with its bills, which can be omitted too', async () => {
    const withBills = { ...overview, flagged: [{ ...overview.flagged[0], receivablePkr: 12000, payablePkr: 1400, balancePkr: 10600 }] };
    const partyView = {
      client: { id: 5, name: 'ACME', code: '101', creditLimitDays: 30, creditLimitAmount: 1000 },
      invoices: [{ id: 41, invoiceNo: 'INV-41', jobNo: 'SE-1', date: '2026-08-24', ageDays: 60, currency: 'PKR', balance: 12000, balancePkr: 12000 }],
      bills: [{ id: 77, invoiceNo: 'BILL-77', jobNo: 'SE-1', date: '2026-10-01', ageDays: 22, currency: 'PKR', balance: 1400, balancePkr: 1400 }],
      receivablePkr: 12000, payablePkr: 1400, balancePkr: 10600,
    };
    mockGet.mockImplementation((url) => (url === '/creditControl/overview' ? ok(withBills)
      : url === '/creditControl/requests' ? ok([]) : url === '/creditControl/partyInvoices' ? ok(partyView) : ok({ count: 0, rows: [] })));
    mockPost.mockReturnValue(ok({ omitted: 1 }));
    render(<CreditControlPage />);
    fireEvent.click(await screen.findByText('Flagged (1)'));
    expect(await screen.findByText('Our bills (PKR)')).toBeInTheDocument();
    expect(screen.getByText('Net owed (PKR)')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Invoices' }).pop());
    expect(await screen.findByText('Our open bills to them (1)')).toBeInTheDocument();
    expect(screen.getByTestId('party-net').textContent).toMatch(/Open invoices PKR 12,000(\.00)? − our bills PKR 1,400(\.00)? = net PKR 10,600/);

    // Tick the bill alone, and omit it.
    const billRow = screen.getByText('BILL-77').closest('tr');
    fireEvent.click(billRow.querySelector('input[type="checkbox"]'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Omit 1$/ })); });
    expect(mockPost).toHaveBeenCalledWith('/creditControl/omit', expect.objectContaining({ invoiceIds: [77], omit: true }));
  });

  test('says so when credit control is off', async () => {
    mockGet.mockImplementation((url) => (url === '/creditControl/overview' ? ok({ ...overview, settings: { ...overview.settings, enabled: false } })
      : url === '/creditControl/requests' ? ok([]) : ok({ count: 0, rows: [] })));
    render(<CreditControlPage />);
    expect(await screen.findByText('Credit control is switched off')).toBeInTheDocument();
  });
});

describe('Config > Credit Control', () => {
  const settings = {
    enabled: false, timeZone: 'Asia/Karachi',
    daily: { enabled: true, time: '09:00', overdue: true, overLimit: true },
    block: { enabled: true, approvalDays: 7 },
    weekly: { enabled: true, day: 1, time: '09:00', ageDays: 90 },
    recipients: { management: ['ceo', 'cfo'], extraCc: [], admin: ['admin'], extraAdmin: [] },
    approvers: ['ceo', 'cfo'], includeAgentInvoices: false, companies: [],
  };
  const meta = { settings, designations: ['ceo', 'cfo', 'admin', 'manager'], weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], state: {}, emailReady: false };

  test('off until switched on; Save sends the whole setting', async () => {
    mockGet.mockImplementation((url) => (url === '/creditControl/settings' ? ok(meta) : ok([])));
    mockPost.mockImplementation((url, body) => ok(body.settings));
    render(<CreditControlConfig />);
    const master = await screen.findByRole('switch', { name: 'Credit control' });
    expect(master.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/Email is not set up/)).toBeInTheDocument();

    fireEvent.click(master);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(mockPost).toHaveBeenCalledWith('/creditControl/settings', { settings: { ...settings, enabled: true } });
  });

  test('the ignore limit is a setting like the rest', async () => {
    mockGet.mockImplementation((url) => (url === '/creditControl/settings' ? ok(meta) : ok([])));
    mockPost.mockImplementation((url, body) => ok(body.settings));
    render(<CreditControlConfig />);
    await screen.findByRole('switch', { name: 'Credit control' });
    const box = screen.getByText('Ignore invoices older than (days)').closest('div').parentElement.querySelector('input');
    fireEvent.change(box, { target: { value: '365' } });
    fireEvent.blur(box);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(mockPost).toHaveBeenCalledWith('/creditControl/settings', { settings: expect.objectContaining({ ignoreOlderThanDays: 365 }) });
  });

  test('so is the amount below which a balance is ignored', async () => {
    mockGet.mockImplementation((url) => (url === '/creditControl/settings' ? ok(meta) : ok([])));
    mockPost.mockImplementation((url, body) => ok(body.settings));
    render(<CreditControlConfig />);
    await screen.findByRole('switch', { name: 'Credit control' });
    const box = screen.getByText('Ignore balances below (PKR)').closest('div').parentElement.querySelector('input');
    fireEvent.change(box, { target: { value: '500' } });
    fireEvent.blur(box);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(mockPost).toHaveBeenCalledWith('/creditControl/settings', { settings: expect.objectContaining({ ignoreBelowAmount: 500 }) });
  });

  test('a run with nothing to send says why, rather than showing an empty table', async () => {
    mockGet.mockImplementation((url) => (url === '/creditControl/settings' ? ok(meta) : ok([])));
    mockPost.mockReturnValue(ok({ kind: 'daily', mode: 'preview', emails: 0, checked: 1, parties: 0, overdueInvoices: 0, overLimit: 0, results: [] }));
    render(<CreditControlConfig />);
    await screen.findByRole('switch', { name: 'Credit control' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview' })); });
    expect(await screen.findByText(/1 party has a credit limit, and none has an open invoice past its credit days/)).toBeInTheDocument();
  });

  test('...or that no party has a limit yet', () => {
    expect(nothingToSend({ kind: 'daily', emails: 0, checked: 0 })).toMatch('no party has a credit limit yet');
    expect(nothingToSend({ kind: 'weekly', emails: 0, ageDays: 90 })).toMatch('over 90 days');
    expect(nothingToSend({ kind: 'daily', emails: 2, checked: 5 })).toBeNull();
  });

  test('Preview lists the emails a run would send, and who to', async () => {
    mockGet.mockImplementation((url) => (url === '/creditControl/settings' ? ok(meta) : ok([])));
    mockPost.mockReturnValue(ok({
      kind: 'daily', mode: 'preview', emails: 1, parties: 1, overdueInvoices: 1, overLimit: 1,
      results: [{ to: ['admin@x.pk'], cc: ['ceo@x.pk'], subject: 'Credit control 23-10-2026 - Parties with no sales rep: 1 over the credit limit', parties: 1, invoices: 1, status: 'preview', html: '<p>hi</p>' }],
    }));
    render(<CreditControlConfig />);
    await screen.findByRole('switch', { name: 'Credit control' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview' })); });
    expect(mockPost).toHaveBeenCalledWith('/creditControl/run', { kind: 'daily', mode: 'preview', testTo: '' });
    expect(await screen.findByText(/Parties with no sales rep: 1 over the credit limit/)).toBeInTheDocument();
    expect(screen.getByText('admin@x.pk')).toBeInTheDocument();
  });

  test('View shows the short email, and the PDF report it attaches', async () => {
    mockGet.mockImplementation((url) => (url === '/creditControl/settings' ? ok(meta) : ok([])));
    mockPost.mockReturnValue(ok({
      kind: 'daily', mode: 'preview', emails: 1, parties: 1, overdueInvoices: 1, overLimit: 0,
      results: [{
        to: ['sara@x.pk'], cc: [], subject: 'Credit control 23-10-2026 - SARA: 1 overdue', parties: 1, invoices: 1, status: 'preview',
        html: '<p>short</p>', reportHtml: '<!doctype html><p>INV-1</p>', attachments: ['credit-control-2026-10-23.pdf', 'overdue-invoices-2026-10-23.csv'],
      }],
    }));
    render(<CreditControlConfig />);
    await screen.findByRole('switch', { name: 'Credit control' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview' })); });
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    expect(await screen.findByText(/Attached: credit-control-2026-10-23\.pdf, overdue-invoices-2026-10-23\.csv/)).toBeInTheDocument();
    expect(screen.getByTitle('Email preview')).toHaveAttribute('srcdoc', '<p>short</p>');
    fireEvent.click(screen.getByText('PDF report'));
    expect(screen.getByTitle('Report preview')).toHaveAttribute('srcdoc', '<!doctype html><p>INV-1</p>');
  });
});

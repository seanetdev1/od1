/**
 * NEW JOB ALERTS (the user, 2026-11-23): once a minute, "New job created:
 * TP-123/27 by Admin" to the designations picked in Configuration.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NewJobAlerts, { POLL_MS, alertText, showNewJobs } from '../Components/Shared/NewJobAlerts';
import NewJobAlertsConfig from '../Components/Layouts/Config/NewJobAlerts';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockNotify = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('Components/Shared/Notification', () => (...a) => mockNotify(...a));
const mockDispatch = jest.fn();
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));

const answer = (result) => Promise.resolve({ data: { status: 'success', result } });
const CURSOR = { freight: 10, customs: 0, aviation: 0 };
const titles = () => mockNotify.mock.calls.map((c) => c[0]);

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockNotify.mockReset();
  mockDispatch.mockReset();
});

describe('the minute check', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  const tick = async () => { await act(async () => { jest.advanceTimersByTime(POLL_MS); }); };

  test('the first answer only sets the start; the next minute tells of what was made', async () => {
    mockGet
      .mockReturnValueOnce(answer({ subscribed: true, cursor: CURSOR, jobs: [] }))
      .mockReturnValueOnce(answer({
        subscribed: true,
        cursor: { ...CURSOR, freight: 11 },
        jobs: [{ kind: 'freight', id: 11, jobNo: 'TP-123/27', createdBy: 'Admin' }],
      }));
    render(<NewJobAlerts />);
    await act(async () => {});
    expect(mockGet).toHaveBeenLastCalledWith('/notifications/newJobs', { params: {} });
    expect(mockNotify).not.toHaveBeenCalled();

    await tick();
    expect(mockGet).toHaveBeenLastCalledWith('/notifications/newJobs', { params: CURSOR });
    expect(mockNotify).toHaveBeenCalledWith('New job created: TP-123/27 by Admin', '', 'blue', 10);
    // And a line on the bell's Recent tab (the user: "simple notifications that go in recent").
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'notifications/addNotification',
      payload: expect.objectContaining({ title: 'New job created: TP-123/27 by Admin' }),
    }));
  });

  test('a designation not picked is shown nothing, and starts afresh once picked', async () => {
    mockGet
      .mockReturnValueOnce(answer({ subscribed: false }))
      .mockReturnValueOnce(answer({ subscribed: true, cursor: CURSOR, jobs: [{ jobNo: 'OLD-1', createdBy: 'X' }] }));
    render(<NewJobAlerts />);
    await act(async () => {});
    await tick();
    // Picked since: this answer is the starting point, not news.
    expect(mockGet).toHaveBeenLastCalledWith('/notifications/newJobs', { params: {} });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test('a hidden tab does not ask', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    render(<NewJobAlerts />);
    await act(async () => {});
    await tick();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('the wording', () => {
  test('as the user put it, and without "by" when nobody is recorded', () => {
    expect(alertText({ jobNo: 'TP-123/27', createdBy: 'Admin' })).toBe('New job created: TP-123/27 by Admin');
    expect(alertText({ jobNo: 'TP-124/27', createdBy: '' })).toBe('New job created: TP-124/27');
  });

  test('a burst: the first three on their own, the rest in one', () => {
    showNewJobs(['A', 'B', 'C', 'D', 'E', 'F'].map((jobNo) => ({ jobNo, createdBy: 'Admin' })));
    expect(titles()).toEqual([
      'New job created: A by Admin', 'New job created: B by Admin', 'New job created: C by Admin',
      '3 more new jobs created',
    ]);
    expect(mockNotify.mock.calls[3][1]).toBe('D, E, F');
  });

  test('four at once are each shown', () => {
    showNewJobs(['A', 'B', 'C', 'D'].map((jobNo) => ({ jobNo, createdBy: 'Admin' })));
    expect(titles()).toHaveLength(4);
  });
});

describe('Configuration > New Job Alerts', () => {
  const ALL = ['ceo', 'cfo', 'admin', 'manager', 'accountant', 'gd operator', 'date operator', 'hr', 'rider'];
  const load = (picked) => mockGet.mockResolvedValue({
    data: { status: 'success', result: { designations: picked }, designations: ALL },
  });
  const saveButton = () => screen.getByRole('button', { name: /^(Save|Saved|Saving…)$/ });

  test('nobody until ticked; Save sends the ticks in list order', async () => {
    load([]);
    mockPost.mockImplementation((url, body) => answer(body));
    render(<NewJobAlertsConfig />);
    expect(await screen.findByText('Nobody is told about new jobs.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Manager'));
    fireEvent.click(screen.getByLabelText('CEO'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton().textContent).toBe('Saved'));
    expect(mockPost).toHaveBeenCalledWith('/settings/newJobAlerts', { designations: ['ceo', 'manager'] });
  });

  test('shows what was saved', async () => {
    load(['gd operator']);
    render(<NewJobAlertsConfig />);
    await screen.findByLabelText('GD Operator');
    expect(screen.getByLabelText('GD Operator').checked).toBe(true);
    expect(screen.getByLabelText('CEO').checked).toBe(false);
    expect(saveButton().textContent).toBe('Saved');
  });
});

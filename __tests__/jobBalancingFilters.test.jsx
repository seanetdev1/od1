/**
 * The Job Balancing filters - Components/Layouts/Reports/JobBalancing.
 *
 * "Show All does not work" (2026-10-20, a customs install): coming back to the
 * filters after a report brought every choice back but Show All, so the next
 * Go ran on Exclude 0 Balance again. And the Operation Types showed the four
 * freight types ticked on a customs install - Customs Clearance read as left
 * out while it was included, and unticking a freight type then dropped every
 * customs invoice.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPush = jest.fn();
let mockStored = [];
let mockMode = 'customs';
jest.mock('next/router', () => ({ __esModule: true, default: { push: (...a) => mockPush(...a) } }));
jest.mock('react-redux', () => ({
  useDispatch: () => jest.fn(),
  useSelector: (pick) => pick({ filterValues: mockStored }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ status: 'success', data: { result: { party: { client: [] }, vendor: {}, sr: [{ id: 7, name: 'Ali' }] } } }),
}));
jest.mock('apis/jobs', () => ({ getJobValues: jest.fn() }));
// The install's Show Advance Transactions setting (Config > Reports).
let mockInstallAdvances = true;
jest.mock('apis/axiosClient', () => ({
  get: () => Promise.resolve({ data: { status: 'success', result: { enabled: mockInstallAdvances } } }),
}));
jest.mock('functions/companyBranding', () => ({ reportCompanyOptions: () => [{ value: 'all', label: 'All' }] }));
jest.mock('js-cookie', () => ({ get: (k) => (k === 'operationMode' ? mockMode : undefined) }));

// eslint-disable-next-line global-require
const JobBalancing = () => { const C = require('../Components/Layouts/Reports/JobBalancing').default; return <C />; };
const sent = () => mockPush.mock.calls[mockPush.mock.calls.length - 1][0].query;
const go = () => fireEvent.click(screen.getByText('Go'));
const ticked = () => [...document.querySelectorAll('.ant-checkbox-group .ant-checkbox-wrapper')]
  .filter((w) => w.querySelector('input').checked).map((w) => w.textContent);

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});
beforeEach(() => { mockPush.mockReset(); mockStored = []; mockMode = 'customs'; mockInstallAdvances = true; });

describe('Show All', () => {
  test('is sent to the report', () => {
    render(<JobBalancing />);
    fireEvent.click(screen.getByLabelText('Show All'));
    go();
    expect(sent().options).toBe('showall');
  });

  test('is still chosen on coming back to the filters', () => {
    mockStored = [{ pageName: 'jobBalancing', values: {
      from: '2026-07-01T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z', company: 'all', payType: 'Recievable',
      representator: '', currency: '', jobTypes: [], reportType: 'viewer', options: 'showall',
    } }];
    render(<JobBalancing />);
    expect(screen.getByLabelText('Show All').checked).toBe(true);
    go();
    expect(sent().options).toBe('showall');
  });

  test('a filter saved before it was remembered opens on Exclude 0 Balance', () => {
    mockStored = [{ pageName: 'jobBalancing', values: { company: 'all', payType: 'All', jobTypes: [], reportType: 'grid' } }];
    render(<JobBalancing />);
    expect(screen.getByLabelText('Exclude 0 Balance').checked).toBe(true);
  });
});

describe('Operation Types', () => {
  test('nothing picked is every type, Customs Clearance included - and shows so', () => {
    render(<JobBalancing />);
    expect(ticked()).toEqual(['Sea Export', 'Sea Import', 'Air Export', 'Air Import', 'Customs Clearance']);
    go();
    expect(sent().jobtypes).toEqual([]);
  });

  test('unticking a freight type keeps the customs invoices', () => {
    render(<JobBalancing />);
    fireEvent.click(screen.getByLabelText('Sea Export'));
    go();
    expect(sent().jobtypes).toEqual(['SI', 'AE', 'AI', 'CC']);
  });

  test('a freight install shows its four', () => {
    mockMode = 'freight';
    render(<JobBalancing />);
    expect(ticked()).toEqual(['Sea Export', 'Sea Import', 'Air Export', 'Air Import']);
  });
});

test('a currency and sales rep brought back from the last run are on screen, not hidden', () => {
  mockStored = [{ pageName: 'jobBalancing', values: {
    company: 'all', payType: 'Recievable', representator: 7, currency: 'USD', jobTypes: [], reportType: 'viewer', options: 'exclude0',
  } }];
  render(<JobBalancing />);
  expect(screen.getByText('USD')).toBeTruthy();
  expect(screen.getByText('Ali')).toBeTruthy();
});

describe('Show Advance Transactions', () => {
  const advSwitch = () => screen.getByRole('switch');
  const isOn = () => advSwitch().getAttribute('aria-checked') === 'true';

  test('starts where the install says, and left alone sends nothing - the server applies the setting', async () => {
    mockInstallAdvances = false;   // CL
    render(<JobBalancing />);
    await waitFor(() => expect(isOn()).toBe(false));
    go();
    expect(sent()).not.toHaveProperty('advances');

    mockInstallAdvances = true;    // SNS
    mockPush.mockReset();
    render(<JobBalancing />);
    await waitFor(() => expect(screen.getAllByRole('switch')[1].getAttribute('aria-checked')).toBe('true'));
  });

  test('moved, it is sent for that run', async () => {
    mockInstallAdvances = false;
    render(<JobBalancing />);
    await waitFor(() => expect(isOn()).toBe(false));
    fireEvent.click(advSwitch());
    go();
    expect(sent().advances).toBe('show');
    fireEvent.click(advSwitch());
    go();
    expect(sent().advances).toBe('hide');
  });

  test("a choice made on the last run is kept on coming back; none, and the install's setting shows", async () => {
    mockStored = [{ pageName: 'jobBalancing', values: { company: 'all', payType: 'All', jobTypes: [], reportType: 'viewer', advances: false } }];
    const { unmount } = render(<JobBalancing />);
    await waitFor(() => expect(isOn()).toBe(false));
    go();
    expect(sent().advances).toBe('hide');
    unmount();

    mockStored = [{ pageName: 'jobBalancing', values: { company: 'all', payType: 'All', jobTypes: [], reportType: 'viewer', advances: null } }];
    render(<JobBalancing />);
    await waitFor(() => expect(isOn()).toBe(true));
    go();
    expect(sent()).not.toHaveProperty('advances');
  });

  test('narrowed to some job types it shows off and greyed - the server leaves advances out then', async () => {
    render(<JobBalancing />);
    await waitFor(() => expect(isOn()).toBe(true));
    fireEvent.click(screen.getByLabelText('Sea Export'));
    expect(isOn()).toBe(false);
    expect(advSwitch().disabled).toBe(true);
    expect(screen.getByText(/every operation type ticked/)).toBeTruthy();
  });
});

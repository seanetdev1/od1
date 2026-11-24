/**
 * Accounts > Direct Job E/R - choosing a line's job, and the lines a save
 * sends (asked 2026-11-13).
 *
 * The job box works as a customs job's charge box does: the whole job number
 * typed and left is that job; Enter opens the job list searching for what was
 * typed, and Enter there takes the highlighted job. A multiple-job entry keeps
 * a blank line at the bottom to type into, and a save never sends a blank one.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import directJobReducer from 'redux/directJob/directJobSlice';
import tabsReducer from 'redux/tabs/tabSlice';
import { usePageActions } from 'Components/Shared/PageActions';
import DirectJob from '../Components/Layouts/AccountsComp/directJob';
import { blankLine } from '../functions/directJobLines';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn(() => Promise.resolve()) }));
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('react-to-print', () => ({ useReactToPrint: () => jest.fn() }));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const JOBS_URL = `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/getDirectJobNumbers`;
const CCJ9 = { id: 77, jobNo: 'CL-CCJ-9/27', fileNo: 'F-9', ref1: 'KAPE-1', ref2: '', party1: 'Client A', party2: '' };
const CCJ90 = { id: 78, jobNo: 'CL-CCJ-90/27', fileNo: 'F-90', ref1: 'KAPE-2', ref2: '', party1: 'Client B', party2: '' };

const filledLine = (over) => ({
  ...blankLine(), id: 1, JobId: 50, JobNumber: 'CL-CCJ-5/27', Charge: 5, Quantity: 1, Rate: 1500,
  Amount: 1500, NetAmount: 1500, Description: 'Handling', ...over,
});

const mount = (fields = {}) => {
  const blank = directJobReducer(undefined, { type: '@@init' });
  const store = configureStore({
    reducer: { directJob: directJobReducer, tabs: tabsReducer },
    preloadedState: {
      directJob: { ...blank, directJob_Type: 'expense', directJob_TransMode: 'Cash', directJob_Currency: 'PKR',
        directJob_JobType: 'single', directJob_Account: 5439, ...fields },
    },
  });
  render(<Provider store={store}><DirectJob id='new' /></Provider>);
  return store;
};

const lines = (store) => store.getState().directJob.directJob;
const jobBoxes = () => screen.getAllByRole('textbox', { name: 'Job #' });
const jobRequests = () => axiosClient.get.mock.calls.filter(([url]) => url === JOBS_URL);

beforeEach(() => {
  jest.clearAllMocks();
  axiosClient.get.mockImplementation((url, config) => {
    if (url === JOBS_URL) {
      const { search = '', exact } = config?.params || {};
      const all = [CCJ9, CCJ90];
      const data = exact
        ? all.filter((j) => j.jobNo.toLowerCase() === search.toLowerCase())
        : all.filter((j) => j.jobNo.toLowerCase().includes(search.toLowerCase()));
      return Promise.resolve({ data: { status: 'success', data, columns: [{ key: 'jobNo', label: 'Job #' }, { key: 'party1', label: 'Client' }], pagination: { totalRecords: data.length } } });
    }
    return Promise.resolve({ data: { status: 'success', result: [] } });
  });
  axiosClient.post.mockResolvedValue({ data: { status: 'success', result: { id: 1758 } } });
});

describe('the job box', () => {
  test('the whole job number typed and left is that job, whatever the case', async () => {
    const store = mount();
    const box = jobBoxes()[0];
    fireEvent.change(box, { target: { value: 'cl-ccj-9/27' } });
    await act(async () => { fireEvent.blur(box); });

    expect(jobRequests().at(-1)[1].params).toMatchObject({ search: 'cl-ccj-9/27', exact: 1 });
    await waitFor(() => expect(lines(store)[0]).toMatchObject({ JobId: 77, JobNumber: 'CL-CCJ-9/27', FileNumber: 'F-9' }));
    expect(jobBoxes()[0]).toHaveValue('CL-CCJ-9/27');
  });

  test('a number that is no job says so and puts back what was there', async () => {
    const store = mount({ directJob: [filledLine()] });
    const box = jobBoxes()[1];
    fireEvent.change(box, { target: { value: 'CL-CCJ-9' } });
    await act(async () => { fireEvent.blur(box); });

    await waitFor(() => expect(openNotification).toHaveBeenCalledWith('No such job', expect.stringContaining('"CL-CCJ-9"'), 'orange'));
    expect(lines(store)[0].JobId).toBe(50);
    expect(jobBoxes()[1]).toHaveValue('CL-CCJ-5/27');
  });

  test('leaving the box unchanged looks nothing up', async () => {
    mount({ directJob: [filledLine()] });
    const before = jobRequests().length;
    const box = jobBoxes()[1];
    fireEvent.change(box, { target: { value: 'cl-ccj-5/27' } });
    await act(async () => { fireEvent.blur(box); });
    expect(jobRequests().length).toBe(before);
  });

  test('Enter opens the job list on what was typed, and Enter there takes the highlighted job', async () => {
    const store = mount();
    const box = jobBoxes()[0];
    fireEvent.change(box, { target: { value: 'CCJ-9' } });
    fireEvent.keyDown(box, { key: 'Enter', code: 'Enter', keyCode: 13 });

    const search = await screen.findByRole('textbox', { name: 'Search jobs' });
    expect(search).toHaveValue('CCJ-9');
    // Both jobs contain "CCJ-9"; the list shows them once the search lands.
    expect(await screen.findByText('CL-CCJ-90/27')).toBeInTheDocument();
    expect(jobRequests().at(-1)[1].params).toMatchObject({ search: 'CCJ-9', page: 1 });

    fireEvent.keyDown(search, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', keyCode: 13 });
    // The second, highlighted by the arrow.
    await waitFor(() => expect(lines(store)[0]).toMatchObject({ JobId: 78, JobNumber: 'CL-CCJ-90/27' }));
  });

  test('Enter pressed before a new search has come back takes the first job of that search, not of the last', async () => {
    const store = mount();
    fireEvent.keyDown(jobBoxes()[0], { key: 'Enter', code: 'Enter', keyCode: 13 });
    const search = await screen.findByRole('textbox', { name: 'Search jobs' });
    // Everything listed first - CL-CCJ-9/27 on top.
    expect(await screen.findByText('CL-CCJ-90/27')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '90/27' } });
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', keyCode: 13 });
    await waitFor(() => expect(lines(store)[0]).toMatchObject({ JobId: 78, JobNumber: 'CL-CCJ-90/27' }));
  });

  test('a job clicked in the list goes on the line the list was opened from', async () => {
    const store = mount({ directJob_JobType: 'multiple', directJob: [filledLine(), filledLine({ id: 2, JobNumber: 'CL-CCJ-6/27', JobId: 60 })] });
    // [0] is the header's, disabled on a multiple-job entry; [2] the second line's.
    expect(jobBoxes()[0]).toBeDisabled();
    fireEvent.keyDown(jobBoxes()[2], { key: 'Enter', code: 'Enter', keyCode: 13 });
    fireEvent.click(await screen.findByText('CL-CCJ-9/27'));
    await waitFor(() => expect(lines(store)[1]).toMatchObject({ JobId: 77, JobNumber: 'CL-CCJ-9/27' }));
    expect(lines(store)[0].JobId).toBe(50);
  });
});

describe('the lines', () => {
  test('a multiple-job entry always ends in a blank line, and typing in it adds the next', async () => {
    const store = mount({ directJob_JobType: 'multiple', directJob: [filledLine()] });
    await waitFor(() => expect(lines(store)).toHaveLength(2));

    const descriptions = screen.getAllByPlaceholderText('Description');
    fireEvent.change(descriptions[1], { target: { value: 'Labour' } });
    await waitFor(() => expect(lines(store)).toHaveLength(3));
    expect(lines(store)[2].Description).toBe('');
  });

  test('a single-job entry stays one line', async () => {
    const store = mount({ directJob: [filledLine()] });
    await act(async () => {});
    expect(lines(store)).toHaveLength(1);
  });

  test('a save sends only the lines with something on them', async () => {
    const store = mount({ directJob_JobType: 'multiple', directJob: [filledLine(), blankLine(), filledLine({ id: 2, JobNumber: 'CL-CCJ-6/27', JobId: 60 })] });
    await waitFor(() => expect(lines(store)).toHaveLength(4));
    await act(async () => { await usePageActions.mock.calls.at(-1)[0].save.onClick(); });

    const sent = axiosClient.post.mock.calls.at(-1)[1].direct_Job_Association;
    expect(sent.map((l) => l.Job_No)).toEqual(['CL-CCJ-5/27', 'CL-CCJ-6/27']);
  });

  test('an entry with no filled line is not sent at all', async () => {
    mount();
    await act(async () => { await usePageActions.mock.calls.at(-1)[0].save.onClick(); });
    expect(axiosClient.post).not.toHaveBeenCalled();
    expect(openNotification).toHaveBeenCalledWith('Warning', expect.stringContaining('Nothing to save'), 'orange');
  });
});

/* SEVERAL JOBS AT ONCE (asked 2026-11-17): on a multiple-job entry the job
 * list has ticks, a tick for the whole page and a lines-per-job counter; Add
 * puts that many lines on each ticked job where the list was opened. */
describe('ticking several jobs in the job list', () => {
  const openList = async (index) => {
    fireEvent.keyDown(jobBoxes()[index], { key: 'Enter', code: 'Enter', keyCode: 13 });
    await screen.findByText('CL-CCJ-90/27');
  };

  test('the heading tick takes every job on the page; lines per job gives each that many', async () => {
    const store = mount({ directJob_JobType: 'multiple', directJob: [blankLine()] });
    await openList(1);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick every job on this page' }));
    expect(screen.getByText('2 jobs ticked')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Lines per job' }), { target: { value: '2' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Add 4 lines' }));

    await waitFor(() => expect(lines(store).filter((l) => l.JobId)).toHaveLength(4));
    expect(lines(store).map((l) => l.JobNumber)).toEqual(['CL-CCJ-9/27', 'CL-CCJ-9/27', 'CL-CCJ-90/27', 'CL-CCJ-90/27', '']);
    expect(lines(store).map((l) => l.FileNumber).slice(0, 4)).toEqual(['F-9', 'F-9', 'F-90', 'F-90']);
    // The list closed, and the blank line is still at the bottom to type into.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search jobs' })).toBeNull());
  });

  test('with a job ticked, a click on another row ticks it too, and Enter adds them', async () => {
    const store = mount({ directJob_JobType: 'multiple', directJob: [filledLine()] });
    await waitFor(() => expect(lines(store)).toHaveLength(2));
    await openList(2);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick CL-CCJ-90/27' }));
    fireEvent.click(screen.getByText('CL-CCJ-9/27'));
    expect(screen.getByText('2 jobs ticked')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search jobs' }), { key: 'Enter', code: 'Enter', keyCode: 13 });

    // In the order ticked, after the line already there.
    await waitFor(() => expect(lines(store).map((l) => l.JobNumber)).toEqual(['CL-CCJ-5/27', 'CL-CCJ-90/27', 'CL-CCJ-9/27', '']));
  });

  test('a single-job entry has no ticks - it is one line', async () => {
    mount();
    fireEvent.keyDown(jobBoxes()[0], { key: 'Enter', code: 'Enter', keyCode: 13 });
    await screen.findByText('CL-CCJ-90/27');
    expect(screen.queryByRole('checkbox', { name: 'Tick every job on this page' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Lines per job' })).toBeNull();
  });
});

/* ONE OF EACH CHARGE PER JOB (asked 2026-11-17): picking a charge asks the
 * server - the same answer a Save would get - and a repeat is turned back on
 * the line, the old charge put back. */
describe('a charge already on the job', () => {
  const CHECK_URL = `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/checkDirectJobCharges`;
  const WEBOC = { id: 12, code: 'WBT', name: 'WEBOC TOKEN', short: 'WEBOC', calculationType: 'Per Shipment', currency: 'PKR' };
  const pickWeboc = async () => {
    fireEvent.mouseDown(document.querySelector('.djp-w-charge .ant-select-selector'));
    fireEvent.click(await screen.findByText('(WBT) - WEBOC TOKEN - WEBOC'));
  };

  test('is turned back, the old charge put back, saying where it already is', async () => {
    axiosClient.post.mockImplementation((url) => (url === CHECK_URL
      ? Promise.resolve({ data: { status: 'success', result: {
        repeats: [{ jobId: '50', charge: '12', entries: ['CL-DE-4/27'] }],
        message: 'WEBOC TOKEN is already on CL-CCJ-5/27 as an expense, in CL-DE-4/27.',
      } } })
      : Promise.resolve({ data: { status: 'success', result: { id: 1 } } })));
    const store = mount({ directJob: [filledLine()], directJob_Charges: [WEBOC] });
    await pickWeboc();

    const [, body] = axiosClient.post.mock.calls.find(([url]) => url === CHECK_URL);
    expect(body.direct_Job.Type).toBe('expense');
    expect(body.direct_Job_Association).toEqual([{ Job_Id: 50, Job_No: 'CL-CCJ-5/27', Charge_Name: 12 }]);
    await waitFor(() => expect(lines(store)[0].Charge).toBe(5));
    expect(openNotification).toHaveBeenCalledWith('Charge already on this job', expect.stringContaining('CL-DE-4/27'), 'orange', 10);
  });

  test('when nothing repeats - or the install has the switch off - the charge stays', async () => {
    axiosClient.post.mockImplementation((url) => Promise.resolve({ data: { status: 'success', result: url === CHECK_URL ? { repeats: [], message: null } : { id: 1 } } }));
    const store = mount({ directJob: [filledLine()], directJob_Charges: [WEBOC] });
    await pickWeboc();
    await waitFor(() => expect(axiosClient.post).toHaveBeenCalledWith(CHECK_URL, expect.anything()));
    await act(async () => {});
    expect(lines(store)[0].Charge).toBe(12);
  });
});

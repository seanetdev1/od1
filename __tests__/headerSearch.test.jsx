/**
 * The header's search (the user, 2026-11-23): the "Matches & Linked Records"
 * panel - pills with counts, a section per kind, rows that open the record the
 * way the rest of the app does - and the tabs' section icons.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HeaderSearch, { openResult, rowDetail } from '../Components/Shared/HeaderSearch';
import { sectionIcon, sectionOf } from '../functions/sectionIcons';

const mockGet = jest.fn();
const mockPush = jest.fn(() => Promise.resolve());
const mockDispatch = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a) }));
jest.mock('next/router', () => ({ push: (...a) => mockPush(...a) }));
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));

const RESULT = {
  term: 'ELSP260351',
  jobs: [{
    kind: 'freightJob', id: 7, no: 'SNS-SEJ-572/27', operation: 'SE', tag: 'Sea Export Job',
    party: 'EUR LOGISTICS', load: 'FCL', route: 'PKKHI → FRLEH', date: '2026-11-19T00:00:00.000Z', matchedOn: 'HBL ELSP260351',
  }],
  bls: [{
    kind: 'freightBl', id: 3, no: 'ELSP260351', operation: 'SE', tag: 'Sea B/L', jobNo: 'SNS-SEJ-572/27',
    house: 'ELSP260351', master: 'MEDUP6449193', houseName: 'HBL', masterName: 'MBL',
  }],
  invoices: [], vouchers: [], parties: [],
};

beforeEach(() => {
  mockGet.mockReset();
  mockPush.mockClear();
  mockDispatch.mockClear();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

const typeIn = async (value) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
  await act(async () => { jest.advanceTimersByTime(300); });
  await act(async () => {});
};

describe('the results panel', () => {
  test('counts, pills, sections and rows, as laid out', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: RESULT } });
    render(<HeaderSearch />);
    fireEvent.focus(screen.getByRole('textbox'));
    await typeIn('ELSP260351');
    expect(mockGet).toHaveBeenCalledWith('/search', { params: { q: 'ELSP260351' } });
    expect(screen.getByText('Matches & Linked Records for “ELSP260351”')).toBeTruthy();
    expect(screen.getByText(/Associated Jobs \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Bills of Lading .* \(1\)/)).toBeTruthy();
    expect(screen.getByText('SNS-SEJ-572/27')).toBeTruthy();
    expect(screen.getByText('HBL ELSP260351 · EUR LOGISTICS · FCL · PKKHI → FRLEH')).toBeTruthy();
    expect(screen.getByText('Job: SNS-SEJ-572/27 · HBL: ELSP260351 · MBL: MEDUP6449193')).toBeTruthy();
    expect(screen.getByText('19-11-2026')).toBeTruthy();
    // The kinds with nothing are offered but cannot be picked.
    expect(screen.getByRole('button', { name: /Invoices 0/ }).disabled).toBe(true);
  });

  test('a pill narrows it to its kind', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: RESULT } });
    render(<HeaderSearch />);
    fireEvent.focus(screen.getByRole('textbox'));
    await typeIn('ELSP260351');
    fireEvent.click(screen.getByRole('button', { name: /B\/L & AWB 1/ }));
    expect(screen.queryByText(/Associated Jobs/)).toBeNull();
    expect(screen.getByText(/Bills of Lading/)).toBeTruthy();
  });

  test('Down then Enter opens the second row: the B/L, in its own tab', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: RESULT } });
    render(<HeaderSearch />);
    const box = screen.getByRole('textbox');
    fireEvent.focus(box);
    await typeIn('ELSP260351');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: { label: 'SE BL', key: '4-4', id: '3' } }));
    expect(mockPush).toHaveBeenCalledWith('/seaJobs/export/bl/3');
  });

  test('nothing found says so; one character asks nothing', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: { ...RESULT, jobs: [], bls: [] } } });
    render(<HeaderSearch />);
    fireEvent.focus(screen.getByRole('textbox'));
    await typeIn('Z');
    expect(mockGet).not.toHaveBeenCalled();
    await typeIn('ZZTOP');
    expect(screen.getByText('Nothing found for “ZZTOP”.')).toBeTruthy();
  });
});

describe('where a result opens', () => {
  test('each kind where the rest of the app opens it', () => {
    openResult({ kind: 'freightJob', id: 7, operation: 'AI' }, mockDispatch);
    expect(mockPush).toHaveBeenLastCalledWith('/airJobs/import/7');
    openResult({ kind: 'customsJob', id: 9, jobNo: 'TP-1/27' }, mockDispatch);
    expect(mockDispatch).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { label: 'TP-1/27', key: '11-2', id: 9 } }));
    openResult({ kind: 'invoice', id: 5 }, mockDispatch);
    expect(mockPush).toHaveBeenLastCalledWith('/reports/invoice/5');
    openResult({ kind: 'voucher', id: 2, type: 'Job Payment' }, mockDispatch);
    expect(mockPush).toHaveBeenLastCalledWith('/accounts/paymentReceipt/2');
    openResult({ kind: 'voucher', id: 3, vType: 'OP' }, mockDispatch);
    expect(mockPush).toHaveBeenLastCalledWith('/accounts/openingBalance/3');
    openResult({ kind: 'voucher', id: 4, type: 'Bank Payment Voucher' }, mockDispatch);
    expect(mockPush).toHaveBeenLastCalledWith('/accounts/vouchers/4');
    openResult({ kind: 'party', id: 6 }, mockDispatch);
    expect(mockPush).toHaveBeenLastCalledWith('/setup/client/6');
  });

  test('an invoice row names its party, amount and state', () => {
    expect(rowDetail('invoices', { party: 'ACME', currency: 'USD', amount: 1250.5, unapproved: true }))
      .toBe('ACME · USD 1,250.5 · Unapproved');
  });
});

describe('the tabs\' section icons', () => {
  test('a tab key\'s first part is its section; every section has one', () => {
    expect(sectionOf('4-4')).toBe('4');
    expect(sectionOf('5-1-1')).toBe('5');
    for (const key of ['0-0', '1-1', '2-7', '3-17', '4-4', '5-6', '6-2', '7-6', '9-1', '10-2', '11-2']) {
      expect([key, sectionIcon(key)]).toEqual([key, expect.anything()]);
    }
    expect(sectionIcon('99-1')).toBeNull();
  });
});

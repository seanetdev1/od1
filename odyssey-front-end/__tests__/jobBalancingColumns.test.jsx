/**
 * Job Balancing grid columns - functions/jobBalancingColumns, and the grid's
 * Columns picker on top of Config > Reports.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import {
  jobBalancingColumns, defaultColumnIds, pickerOrder, shownColumnIds, cellValue,
} from 'functions/jobBalancingColumns';

const mockGet = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a) }));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('js-cookie', () => ({ get: (k) => (k === 'operationMode' ? 'freight' : 'tester') }));
jest.mock('react-to-print', () => () => null);
jest.mock('functions/companyBranding', () => ({
  companyLogoBlob: async () => null, companyTitle: () => 'SNS', reportCompanyTitle: () => 'SNS', reportAddress: () => '',
}));
jest.mock('Components/Shared/PrintTopHeader', () => () => null);
jest.mock('../Components/Layouts/Reports/JobBalancing/JobBalancingPrint', () => () => null);
// The grid, as its headings in order - and the rows it was given. Like AG Grid
// with maintainColumnOrder, handed new columns it keeps the ones it has where
// they are and puts a new one last; applyColumnState with applyOrder reorders
// them, and mockGrid.drag is a user dragging one.
const mockGridRows = { current: [] };
const mockGrid = { drag: null };
jest.mock('ag-grid-react', () => {
  const R = require('react');
  return {
    AgGridReact: R.forwardRef(({ columnDefs, rowData, maintainColumnOrder }, ref) => {
      mockGridRows.current = rowData;
      const order = R.useRef([]);
      const [, redraw] = R.useReducer((n) => n + 1, 0);
      const fields = columnDefs.map((c) => c.field);
      const kept = order.current.filter((f) => fields.includes(f));
      order.current = maintainColumnOrder && kept.length ? [...kept, ...fields.filter((f) => !kept.includes(f))] : fields;
      const setOrder = (ids) => { order.current = ids.filter((f) => fields.includes(f)); redraw(); };
      R.useImperativeHandle(ref, () => ({
        columnApi: { applyColumnState: ({ state, applyOrder }) => applyOrder && setOrder(state.map((s) => s.colId)) },
      }));
      mockGrid.drag = (field, to) => {
        const rest = order.current.filter((f) => f !== field);
        rest.splice(to, 0, field);
        setOrder(rest);
      };
      const heading = (f) => columnDefs.find((c) => c.field === f).headerName;
      return <div data-testid='grid'>{order.current.map((f) => <span key={f} data-col={f}>{heading(f)}</span>)}</div>;
    }),
  };
});

describe('the column list', () => {
  const freight = jobBalancingColumns('freight');
  const ids = (cols) => cols.map((c) => c.id);

  test('a mode is offered only the columns it fills', () => {
    const customs = ids(jobBalancingColumns('customs'));
    expect(customs).toEqual(expect.arrayContaining(['invoice_No', 'jobCols.jobNo', 'jobCols.vessel', 'balance']));
    ['SE_Job.Voyage.voyage', 'SE_Job.fileNo', 'customerRef', 'jobCols.shipper'].forEach((id) => expect(customs).not.toContain(id));
    expect(ids(freight)).toEqual(expect.arrayContaining(['SE_Job.Voyage.voyage', 'SE_Job.fileNo', 'customerRef', 'jobCols.shipper']));
  });

  test('customs offers GD Date and Client Invoice #, after the GD number; freight does not', () => {
    const customs = jobBalancingColumns('customs');
    const at = ids(customs).indexOf('jobCols.docSecondary');
    expect(ids(customs).slice(at, at + 3)).toEqual(['jobCols.docSecondary', 'jobCols.gdDate', 'jobCols.clientInvoiceNo']);
    expect(customs.find((c) => c.id === 'jobCols.gdDate').heading).toBe('GD Date');
    expect(customs.find((c) => c.id === 'jobCols.clientInvoiceNo').heading).toBe('Client Invoice #');
    expect(cellValue(customs.find((c) => c.id === 'jobCols.gdDate'), { jobCols: { gdDate: '2026-08-26' } })).toBe('26-Aug-2026');
    expect(ids(freight)).not.toContain('jobCols.gdDate');
    expect(ids(freight)).not.toContain('jobCols.clientInvoiceNo');
  });

  test("customs offers a bill's Vendor Tax Inv #, after Client Invoice #; freight does not", () => {
    const customs = jobBalancingColumns('customs');
    const at = ids(customs).indexOf('jobCols.clientInvoiceNo');
    expect(ids(customs)[at + 1]).toBe('jobCols.vendorTaxInvoiceNo');
    expect(customs[at + 1].heading).toBe('Vendor Tax Inv #');
    expect(cellValue(customs[at + 1], { jobCols: { vendorTaxInvoiceNo: 'STI-4471' } })).toBe('STI-4471');
    expect(ids(jobBalancingColumns('freight'))).not.toContain('jobCols.vendorTaxInvoiceNo');
  });

  test('opens on the configured columns, in their order - or every one', () => {
    expect(defaultColumnIds(freight, ['balance', 'no', 'gone', 'balance'])).toEqual(['balance', 'no']);
    expect(defaultColumnIds(freight, null)).toEqual(ids(freight));
    expect(defaultColumnIds(freight, ['gone'])).toEqual(ids(freight));
  });

  test('the picker lists the defaults first, then the rest as built in', () => {
    const order = pickerOrder(freight, ['balance', 'no']);
    expect(order.slice(0, 3)).toEqual(['balance', 'no', 'invoice_No']);
    expect(order).toHaveLength(freight.length);
  });

  test('the ticked columns show in picker order, and never none', () => {
    expect(shownColumnIds(freight, ['balance', 'no'], ['currency', 'no', 'balance'])).toEqual(['balance', 'no', 'currency']);
    expect(shownColumnIds(freight, ['balance', 'no'], [])).toEqual(['balance', 'no']);
  });

  test('the export carries what the grid shows - # and Paid/Rcvd included', () => {
    const col = (id) => freight.find((c) => c.id === id);
    const receivable = { no: 3, payType: 'Recievable', total: 100, total1: 100, recieved: 40, paid: 0, balance: 60, jobCols: { jobNo: 'SEJ-1', jobDate: '2026-10-01' } };
    const payable = { payType: 'Payble', total: 70, total1: 70, recieved: 0, paid: 20, balance: 50 };
    expect(cellValue(col('no'), receivable)).toBe(3);
    expect(cellValue(col('recieved'), receivable)).toBe(40);
    expect(cellValue(col('recieved'), payable)).toBe(20);
    expect([cellValue(col('total'), payable), cellValue(col('total1'), payable)]).toEqual([0, 70]);
    expect(cellValue(col('jobCols.jobNo'), receivable)).toBe('SEJ-1');
    expect(cellValue(col('jobCols.jobDate'), receivable)).toBe('01-Oct-2026');
    expect(cellValue(col('jobCols.vessel'), receivable)).toBe('');
  });
});

describe('the grid\'s Columns picker', () => {
  // eslint-disable-next-line global-require
  const JobBalancingReport = require('../Components/Layouts/Reports/JobBalancing/JobBalancingReport').default;
  const result = { status: 'success', result: [{
    id: 1, invoice_No: 'JI-1/27', payType: 'Recievable', total: '100', recieved: '40', paid: '0', roundOff: '0',
    createdAt: '2026-10-01', Charge_Heads: [], currency: 'PKR', party_Name: 'ABC TRADERS', companyId: '1',
  }] };
  const query = { report: 'grid', options: 'showall', company: '1', from: '2026-07-01', to: '2026-10-06' };
  const headings = () => [...screen.getByTestId('grid').querySelectorAll('span')].map((s) => s.textContent);

  beforeEach(() => {
    window.sessionStorage.clear();
    mockGet.mockReset();
    mockGridRows.current = [];
  });

  test('opens on the columns Configuration names, in its order', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: ['balance', 'invoice_No', 'party_Name'] } });
    render(<JobBalancingReport result={result} query={query} />);
    await waitFor(() => expect(headings()).toEqual(['Balance', 'Inv. No', 'Client']));
    expect(mockGet).toHaveBeenCalledWith('/settings/reportColumns/jobBalancingGrid');
  });

  test('a user ticks columns on and off, and Default goes back', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: ['balance', 'invoice_No', 'party_Name'] } });
    render(<JobBalancingReport result={result} query={query} />);
    await waitFor(() => expect(headings()).toHaveLength(3));

    fireEvent.click(screen.getByText('Columns (3)'));
    fireEvent.click(screen.getByText('Curr'));
    expect(headings()).toEqual(['Balance', 'Inv. No', 'Client', 'Curr']);
    fireEvent.click(within(document.querySelector('.ant-popover')).getByText('Balance'));
    expect(headings()).toEqual(['Inv. No', 'Client', 'Curr']);

    fireEvent.click(screen.getByText('Default'));
    expect(headings()).toEqual(['Balance', 'Inv. No', 'Client']);
  });

  test('a dragged column stays put when another is ticked on; Default and All put the order back', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: ['balance', 'invoice_No', 'party_Name'] } });
    render(<JobBalancingReport result={result} query={query} />);
    await waitFor(() => expect(headings()).toHaveLength(3));

    act(() => mockGrid.drag('balance', 2));
    fireEvent.click(screen.getByText('Columns (3)'));
    fireEvent.click(screen.getByText('Curr'));
    expect(headings()).toEqual(['Inv. No', 'Client', 'Balance', 'Curr']);

    fireEvent.click(screen.getByText('Default'));
    expect(headings()).toEqual(['Balance', 'Inv. No', 'Client']);

    act(() => mockGrid.drag('balance', 2));
    fireEvent.click(screen.getByText('All'));
    expect(headings().slice(0, 4)).toEqual(['Balance', 'Inv. No', 'Client', '#']);
    expect(headings()).toHaveLength(jobBalancingColumns('freight').length);
  });

  test('the picks last the session', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: ['balance', 'invoice_No'] } });
    const { unmount } = render(<JobBalancingReport result={result} query={query} />);
    await waitFor(() => expect(headings()).toHaveLength(2));
    fireEvent.click(screen.getByText('Columns (2)'));
    fireEvent.click(screen.getByText('Curr'));
    unmount();

    render(<JobBalancingReport result={result} query={query} />);
    await waitFor(() => expect(headings()).toEqual(['Balance', 'Inv. No', 'Curr']));
  });

  test('a rounded invoice owes its rounded total - paid at that, nothing is left', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: null } });
    const rounded = (over) => ({ ...result.result[0], total: '1234.56', roundOff: '+0.44', ...over });
    render(<JobBalancingReport result={{ status: 'success', result: [
      rounded({ id: 1, recieved: '1235' }),
      rounded({ id: 2, recieved: '0' }),
      rounded({ id: 3, payType: 'Payble', paid: '0', recieved: '0' }),
    ] }} query={query} />);
    await waitFor(() => expect(mockGridRows.current).toHaveLength(3));
    const [paid, open, bill] = mockGridRows.current;
    expect([paid.total, paid.recieved, paid.balance]).toEqual([1235, 1235, 0]);
    expect(open.balance).toBeCloseTo(1235);
    // Credit carries the round off once, not twice.
    expect(bill.total1).toBeCloseTo(1235);
  });

  test('Exclude 0 Balance leaves out what is settled to the paisa, and lists by date and time', async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: null } });
    const row = (over) => ({ ...result.result[0], total: '1000', recieved: '0', roundOff: '0', ...over });
    render(<JobBalancingReport result={{ status: 'success', result: [
      // A knock-off's hair of floating point, and a rounded invoice paid in full: settled.
      row({ id: 1, invoice_No: 'JI-HAIR', total: '1234.56', recieved: '1234.5599999999999', createdAt: '2026-08-01T10:00:00Z' }),
      row({ id: 2, invoice_No: 'JI-ROUNDED', total: '1234.56', roundOff: '+0.44', recieved: '1235', createdAt: '2026-08-02T10:00:00Z' }),
      // Still owed - and listed out of order.
      row({ id: 5, invoice_No: 'JI-LATE', recieved: '400', createdAt: '2026-09-01T15:30:00Z' }),
      row({ id: 3, invoice_No: 'JI-HALF', recieved: '999.5', createdAt: '2026-09-01T09:00:00Z' }),
      row({ id: 4, invoice_No: 'JI-SAME', recieved: '100', createdAt: '2026-09-01T09:00:00Z' }),
    ] }} query={{ ...query, options: 'exclude0' }} />);
    await waitFor(() => expect(mockGridRows.current.length).toBeGreaterThan(0));
    expect(mockGridRows.current.map((r) => r.invoice_No)).toEqual(['JI-HALF', 'JI-SAME', 'JI-LATE']);
  });

  /* A payment / receipt's money not knocked off comes as a row shaped like an
   * invoice (the server's functions/jobBalancingAdvances): total 0, the money
   * left as received - so the report's bottom line is the ledger's (the user,
   * 2026-11-06: Hasnain Cargo, 2,835,002.90 here against 163,734.10 in credit). */
  test("an advance's leftover is a row: type Advance, and it comes off the balance", async () => {
    mockGet.mockResolvedValue({ data: { status: 'success', result: null } });
    render(<JobBalancingReport result={{ status: 'success', result: [
      { ...result.result[0], id: 1, invoice_No: 'ACS-JI-645/27', total: '2835002.90', recieved: '0' },
      { id: 'advance-21920-5686', advance: true, voucherId: 21920, invoice_No: 'ACS-BRV-00856/24', payType: 'Recievable',
        total: '0', recieved: '2998737', paid: '0', roundOff: '0', createdAt: '2024-04-01', currency: 'PKR',
        party_Name: 'ABC TRADERS', companyId: '1', SE_Job: null, Charge_Heads: [] },
    ] }} query={query} />);
    await waitFor(() => expect(mockGridRows.current).toHaveLength(2));
    const advance = mockGridRows.current.find((r) => r.advance);
    expect(advance.jobCols.jobType).toBe('Advance');
    expect(advance.balance).toBeCloseTo(-2998737);
    const total = mockGridRows.current.reduce((t, r) => t + Number(r.balance), 0);
    expect(total).toBeCloseTo(-163734.10);
  });

  test('nothing configured, or the setting unreachable: every column, as before', async () => {
    mockGet.mockRejectedValue(new Error('offline'));
    render(<JobBalancingReport result={result} query={query} />);
    await waitFor(() => expect(headings()).toHaveLength(jobBalancingColumns('freight').length));
  });
});

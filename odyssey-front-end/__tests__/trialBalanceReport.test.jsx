/**
 * The trial balance screen - Components/Layouts/Reports/TrialBalance/Report.
 *
 * The server builds the report (routes/misc/trialBalance); the screen only
 * lays out what it is sent. So what is pinned here is the layout: the columns
 * the report type asked for and no others, group rows in bold, ONE grand total
 * on the last page (the Debitors List used to print two), and a refusal shown
 * as the server's own words. And the query the options page opens it with -
 * the days picked, not the moment they were picked.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import moment from 'moment';
import Report from '../Components/Layouts/Reports/TrialBalance/Report';
import { columnGroups, commas, trialBalanceQuery } from '../functions/trialBalanceView';

jest.mock('Components/Shared/PrintTopHeader', () => function PrintTopHeader() { return null; });
jest.mock('Components/Shared/Pagination', () => function Pagination({ noOfPages, setCurrentPage }) {
  return <button type="button" onClick={() => setCurrentPage(noOfPages)}>last page</button>;
});
jest.mock('functions/companyBranding', () => ({
  companyLogoBlob: jest.fn(), reportCompanyTitle: () => '', reportAddress: () => '',
}));

const query = { from: '2026-07-01', to: '2026-10-06', company: '1' };

const six = {
  status: 'success',
  result: {
    reportType: '6- Columns Simplified View',
    columns: ['opDebit', 'opCredit', 'trDebit', 'trCredit', 'clDebit', 'clCredit'],
    rows: [
      { id: 1, code: '1', title: 'ASSETS', level: 1, group: true, opDebit: 150, opCredit: 0, trDebit: 30, trCredit: 10, clDebit: 170, clCredit: 0 },
      { id: 100, code: '1101', title: 'Party A', level: 2, group: false, opDebit: 150, opCredit: 0, trDebit: 30, trCredit: 10, clDebit: 170, clCredit: 0 },
      { id: 4, code: '4', title: 'REVENUE', level: 1, group: true, opDebit: 0, opCredit: 150, trDebit: 10, trCredit: 30, clDebit: 0, clCredit: 170 },
      { id: 400, code: '4101', title: 'SALES', level: 2, group: false, opDebit: 0, opCredit: 150, trDebit: 10, trCredit: 30, clDebit: 0, clCredit: 170 },
    ],
    totals: { opDebit: 150, opCredit: 150, trDebit: 30, trCredit: 30, clDebit: 1234567.5, clCredit: 170 },
    from: '2026-07-01', to: '2026-10-06',
  },
};

const headers = () => [...document.querySelectorAll('thead tr')].map((tr) => [...tr.querySelectorAll('th')].map((th) => th.textContent.trim()));
const bodyRows = () => [...document.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
const grandTotals = () => bodyRows().filter((r) => r[0] === 'Grand Total:');

describe('the trial balance screen', () => {
  test('6-column: Opening, Transactions and Closing, and the server\'s figures as they came', () => {
    render(<Report query={query} result={six} />);
    expect(headers()).toEqual([
      ['', 'Opening', 'Transactions', 'Closing'],
      ['Account Title', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit'],
    ]);
    expect(bodyRows()[1]).toEqual(['Party A', '150.00', '0.00', '30.00', '10.00', '170.00', '0.00']);
    expect(grandTotals()).toEqual([['Grand Total:', '150.00', '150.00', '30.00', '30.00', '1, 234, 567.50', '170.00']]);
  });

  test('a group row is bold, with its figures; an account is indented under it', () => {
    render(<Report query={query} result={six} />);
    const cells = [...document.querySelectorAll('tbody tr')][0].querySelectorAll('td');
    expect(cells[0].querySelector('b').textContent).toBe('ASSETS');
    expect(cells[5].querySelector('b').textContent).toBe('170.00');
    const party = [...document.querySelectorAll('tbody tr')][1].querySelector('td');
    expect(party.querySelector('b')).toBeNull();
    expect(party.style.paddingLeft).toBe('24px');
  });

  test('Exclude Opening: the Opening pair is not there at all', () => {
    const r = { ...six, result: { ...six.result, columns: ['trDebit', 'trCredit', 'clDebit', 'clCredit'] } };
    render(<Report query={query} result={r} />);
    expect(headers()[0]).toEqual(['', 'Transactions', 'Closing']);
    // As many cells in the grand total as in the header - the old one had two over.
    expect(grandTotals()[0]).toHaveLength(5);
  });

  test('Debitors List: one Closing Debit column and one grand total', () => {
    const r = {
      status: 'success',
      result: {
        reportType: 'Debitors List',
        columns: ['clDebit'],
        rows: [
          { id: 1, code: '1', title: 'ASSETS', level: 1, group: true, clDebit: 170 },
          { id: 100, code: '1101', title: 'Party A', level: 2, group: false, clDebit: 170 },
        ],
        totals: { clDebit: 170 },
        from: '2026-07-01', to: '2026-10-06',
      },
    };
    render(<Report query={query} result={r} />);
    expect(headers()).toEqual([['', 'Closing'], ['Account Title', 'Debit']]);
    expect(grandTotals()).toEqual([['Grand Total:', '170.00']]);
  });

  test('the grand total waits for the last page', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: i + 10, code: String(i), title: `Account ${i}`, level: 1, group: false, clDebit: 1, clCredit: 0 }));
    const r = { status: 'success', result: { ...six.result, columns: ['clDebit', 'clCredit'], rows: many, totals: { clDebit: 25, clCredit: 0 } } };
    render(<Report query={query} result={r} />);
    expect(bodyRows()).toHaveLength(20);
    expect(grandTotals()).toHaveLength(0);
    fireEvent.click(screen.getByText('last page'));
    expect(bodyRows()).toHaveLength(6);
    expect(grandTotals()).toEqual([['Grand Total:', '25.00', '0.00']]);
  });

  test('nothing in the period says so', () => {
    render(<Report query={query} result={{ status: 'success', result: { ...six.result, rows: [], totals: {} } }} />);
    expect(screen.getByText('Nothing to show for this period.')).toBeTruthy();
    expect(grandTotals()).toHaveLength(0);
  });

  test('a report the server refused shows its reason', () => {
    render(<Report query={query} result={{ status: 'error', result: 'To is before From.' }} />);
    expect(screen.getByText('To is before From.')).toBeTruthy();
  });
});

describe('trialBalanceView', () => {
  test('columns group with their neighbours', () => {
    expect(columnGroups(['trDebit', 'trCredit', 'clDebit', 'clCredit'])).toEqual([
      { label: 'Transactions', keys: ['trDebit', 'trCredit'] },
      { label: 'Closing', keys: ['clDebit', 'clCredit'] },
    ]);
    expect(columnGroups(['clCredit'])).toEqual([{ label: 'Closing', keys: ['clCredit'] }]);
    expect(columnGroups(undefined)).toEqual([]);
  });

  test('money prints as it always has', () => {
    expect(commas(1234567.5)).toBe('1, 234, 567.50');
    expect(commas(undefined)).toBe('0.00');
  });

  test('the report opens on the days picked, with the zone they were picked in', () => {
    // Picked on the options page as "now, on 1 July": the time of day is not
    // part of the report.
    const from = moment('2026-07-01 14:23', 'YYYY-MM-DD HH:mm').toISOString();
    const to = moment('2026-10-06 09:05', 'YYYY-MM-DD HH:mm').toISOString();
    const q = trialBalanceQuery({ from, to, company: 1, reportType: 'Debitors List', currency: 'PKR', accountid: undefined, options: 'showall' }, moment);
    expect(q).toEqual({
      from: '2026-07-01', to: '2026-10-06', utcoffset: moment('2026-07-01', 'YYYY-MM-DD').utcOffset(),
      company: 1, reportType: 'Debitors List', currency: 'PKR', accountid: null, options: 'showall',
    });
  });
});

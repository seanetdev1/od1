/**
 * Report fixes, v1.2.35:
 *   - Job Balancing prints every row under headings that match its cells;
 *   - report pickers leave out non-GL parties;
 *   - Payments & Receipts lists invoices with their date, oldest first;
 *   - Agent Invoice Balancing works its figures out as numbers in both views.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import JobBalancingPrint from '../Components/Layouts/Reports/JobBalancing/JobBalancingPrint';
import { glOnly, isGlParty } from '../functions/glParties';
import { byInvoiceDate, invoiceDate } from '../functions/invoiceDates';
import { agentBalancingFigures } from '../functions/agentBalancing';

jest.mock('functions/companyBranding', () => ({
  reportCompanyTitle: () => 'AIR CARGO SERVICES (PVT) LIMITED',
  reportLetterheadId: (c) => c,
  companyDetails: () => ({ address: 'PLOT NO. A-230, BLOCK 2, P.E.C.H.S, KARACHI' }),
  companyLogo: () => null,
}));

describe('Job Balancing print - laid out as Climax printed it', () => {
  // Rows shaped as the report hands them over: createdAt already "DD-MMM-YY",
  // jobCols from functions/invoiceJobColumns. Modelled on Air Blue's statement.
  const row = (over = {}) => ({
    id: 1, invoice_No: 'ACS-JI-1386/26', createdAt: '15-Apr-26',
    jobCols: {
      jobNo: 'ACS-AE-1356/26', doDate: '', docPrimary: 'SN-643654', finalDestination: 'CHZRH',
      jobType: 'Air', freightType: 'Collect', containers: '', weight: '4800', volume: '0',
    },
    SE_Job: { Client: { code: '704', name: 'AIR BLUE LTD' } },
    party_Name: 'AIR BLUE LTD', currency: 'PKR', payType: 'Recievable',
    total: 2928105, recieved: 2752419, paid: 0, balance: 175686, age: 169,
    ...over,
  });
  const second = row({
    id: 2, invoice_No: 'ACS-JI-1384/26', createdAt: '23-Apr-26',
    jobCols: { ...row().jobCols, jobNo: 'ACS-AI-8/26', finalDestination: 'PKKHI', freightType: 'Prepaid', weight: '2.61' },
    total: 148485.67, recieved: 139577, balance: 8908.67, age: 161,
  });
  const headings = () => [...document.querySelectorAll('thead th')].map((th) => th.textContent);
  const rowCells = (i) => [...document.querySelectorAll('tbody tr')[i].querySelectorAll('td')].map((td) => td.textContent);

  test('has the Climax columns, in the Climax order', () => {
    render(<JobBalancingPrint records={[row(), second]} />);
    expect(headings()).toEqual([
      'S #', 'Inv No', 'Job No', 'Date', 'DO Date', 'HBL/HAWB', 'Client', 'F.Dest', 'J/Tp', 'F/Tp',
      'Cntrs', 'WT', 'Vol', 'Curr', 'Receivable', 'Adjust', 'Received', 'Balance', 'Age',
    ]);
  });

  test('fills a row the way Climax did', () => {
    render(<JobBalancingPrint records={[row(), second]} />);
    expect(rowCells(0)).toEqual([
      '1', 'ACS-JI-1386/26', 'ACS-AE-1356/26', '15-Apr-2026', '', 'SN-643654', 'AIR BLUE LTD ( 704 )',
      'CHZRH', 'Air', 'CC', '', '4,800.00', '0.00', 'PKR', '2,928,105.00', '0.00', '2,752,419.00', '175,686.00', '169',
    ]);
    expect(rowCells(1)[9]).toBe('PP');
  });

  test('totals the rows it printed, under Curr and the money columns', () => {
    render(<JobBalancingPrint records={[row(), second]} />);
    const total = rowCells(2);
    expect(total[0]).toBe('Total :');
    expect(total.slice(1)).toEqual(['PKR', '3,076,590.67', '0.00', '2,891,996.00', '184,594.67', '']);
  });

  test('repeats the letterhead, the period and the title with the headings', () => {
    render(<JobBalancingPrint records={[row()]} from='01-Jul-2024' to='30-Jun-2027' />);
    const head = document.querySelector('thead').textContent;
    expect(head).toContain('AIR CARGO SERVICES (PVT) LIMITED');
    expect(head).toContain('PLOT NO. A-230');
    expect(head).toMatch(/From = 01-Jul-2024\s+Till = 30-Jun-2027/);
    expect(head).toContain('Job Balancing Reports');
  });

  test('puts Printed On, Printed By and the page number in every page footer', () => {
    render(<JobBalancingPrint records={[row()]} printedBy='Zain "ZQ" Qazi' printedAt='2026-10-01T18:17:06' />);
    const css = document.querySelector('style').textContent;
    expect(css).toContain('"Printed On :  01/10/2026 18:17:06"');
    expect(css).toContain('"Printed By :  Zain \\"ZQ\\" Qazi"');
    expect(css).toContain('"Page " counter(page)');
  });

  test('prints the client code only when the job\'s client is the party invoiced', () => {
    render(<JobBalancingPrint records={[row({ party_Name: 'SOME AGENT' })]} />);
    expect(rowCells(0)[6]).toBe('SOME AGENT');
  });

  test('a payable-only report says Payable and Paid', () => {
    render(<JobBalancingPrint records={[row({ payType: 'Payble', paid: 100, recieved: 0 })]} />);
    expect(headings()).toEqual(expect.arrayContaining(['Payable', 'Paid']));
    expect(headings()).not.toContain('Receivable');
  });

  test('both sides at once keep a column each, and net the balance', () => {
    render(<JobBalancingPrint records={[
      row({ total: 1000, recieved: 400, balance: 600 }),
      row({ id: 2, payType: 'Payble', total: 500, paid: 100, recieved: 0, balance: 400 }),
    ]} />);
    expect(headings()).toEqual(expect.arrayContaining(['Receivable', 'Payable', 'Paid / Rcvd']));
    expect(rowCells(1)).toContain('(400.00)');
    const total = rowCells(2);
    expect(total.slice(-3)).toEqual(['300.00', '200.00', '']);   // 400 - 100 settled, 600 - 400 balance
  });

  test('one Total line per currency, never USD added to PKR', () => {
    render(<JobBalancingPrint records={[row(), row({ id: 2, currency: 'USD', total: 10, recieved: 0, balance: 10 })]} />);
    const totals = [...document.querySelectorAll('tbody tr')].slice(2).map((tr) => tr.querySelectorAll('td')[1].textContent);
    expect(totals).toEqual(['PKR', 'USD']);
  });

  test('leaves Age off when aging is not shown', () => {
    render(<JobBalancingPrint records={[row()]} showAge={false} />);
    expect(headings()).not.toContain('Age');
    expect(rowCells(0)).toHaveLength(headings().length);
  });

  test('an aviation install drops the columns a flight never fills', () => {
    render(<JobBalancingPrint records={[row()]} mode='aviation' docLabel='AWB(s)' />);
    expect(headings()).toEqual([
      'S #', 'Inv No', 'Job No', 'Date', 'AWB(s)', 'Client', 'F.Dest', 'J/Tp',
      'Curr', 'Receivable', 'Adjust', 'Received', 'Balance', 'Age',
    ]);
  });

  test("a customs install prints the GD date, the client invoice and a bill's vendor tax invoice", () => {
    render(<JobBalancingPrint mode='customs' docLabel='BL No' records={[row({
      jobCols: { jobNo: 'CL-TP-1726/27', docPrimary: 'BL-9', jobType: 'Import', gdDate: '2026-08-26', clientInvoiceNo: 'AMA-18792-26', vendorTaxInvoiceNo: 'STI-4471' },
    })]} />);
    expect(headings()).toEqual([
      'S #', 'Inv No', 'Job No', 'Date', 'BL No', 'GD Date', 'Client Inv #', 'Vendor Tax Inv #', 'Client', 'J/Tp',
      'Curr', 'Receivable', 'Adjust', 'Received', 'Balance', 'Age',
    ]);
    expect(rowCells(0).slice(5, 8)).toEqual(['26-Aug-2026', 'AMA-18792-26', 'STI-4471']);
  });
});

describe('report pickers leave out non-GL parties', () => {
  test('a party marked nongl is dropped; an unmarked one is kept', () => {
    expect(glOnly([{ id: 1, nongl: '1' }, { id: 2, nongl: '0' }, { id: 3 }]).map((p) => p.id)).toEqual([2, 3]);
    expect(isGlParty({ nongl: 1 })).toBe(false);
    expect(glOnly(undefined)).toEqual([]);
  });
});

describe('Payments & Receipts invoice dates', () => {
  test('lists oldest first, ties by id', () => {
    const list = [
      { id: 3, createdAt: '2026-09-30' }, { id: 1, createdAt: '2026-01-05' },
      { id: 2, createdAt: '2026-09-30' },
    ];
    expect(byInvoiceDate(list).map((i) => i.id)).toEqual([1, 2, 3]);
  });

  test('shows the date as DD-MM-YYYY, and nothing for none', () => {
    expect(invoiceDate({ createdAt: '2026-10-02T09:00:00' })).toBe('02-10-2026');
    expect(invoiceDate({})).toBe('');
  });
});

describe('Agent Invoice Balancing figures', () => {
  const usd = { payType: 'Recievable', currency: 'USD', ex_rate: '280', total: '100', recieved: '40', paid: '0' };

  test('in USD the invoice\'s own figures, as numbers', () => {
    expect(agentBalancingFigures(usd, 'USD')).toMatchObject({ total: 100, paidRec: 40, balance: 60, debit: 100, credit: 0 });
  });

  test('in PKR everything converted at the same rate - no NaN', () => {
    const f = agentBalancingFigures(usd, 'PKR');
    expect(f).toMatchObject({ total: 28000, recieved: 11200, paidRec: 11200, balance: 16800 });
    expect(Number.isNaN(f.balance)).toBe(false);
  });

  test('a PKR agent bill converts at 1 in the PKR view', () => {
    const bill = { payType: 'Payble', currency: 'PKR', ex_rate: '280', total: '5000', paid: '1000', recieved: '0' };
    expect(agentBalancingFigures(bill, 'PKR')).toMatchObject({ total: 5000, paidRec: 1000, balance: 4000, credit: 5000 });
  });
});

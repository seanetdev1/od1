/**
 * Agent Invoice Balancing's print - Reports/InvoiceBalancing/AgentBalancingPrint.
 * It printed the screen table: the 20 rows of the page on screen, on portrait
 * A4 with the money columns off the paper (the user's report, 2026-10-15).
 */
import React from 'react';
import { render } from '@testing-library/react';
import InvoiceBalancingReport from '../Components/Layouts/Reports/InvoiceBalancing/InvoiceBalancingReport';

const captured = [];
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: () => null }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('react-to-print', () => (props) => { captured.push(props); return null; });
jest.mock('ag-grid-react', () => ({ AgGridReact: () => null }));
jest.mock('Components/Shared/PrintTopHeader', () => () => null);
jest.mock('functions/companyBranding', () => ({
  companyLogoBlob: jest.fn(), companyTitle: () => 'SNS', reportCompanyTitle: () => 'SEA NET SHIPPING',
  reportAddress: () => '', reportLetterheadId: () => 1, companyDetails: () => ({ address: 'KARACHI' }), companyLogo: () => null,
}));

const invoice = (n) => ({
  id: n, invoice_No: `SNS-AI-${n}/27`, createdAt: `2026-09-${String((n % 28) + 1).padStart(2, '0')}T10:00:00Z`,
  payType: 'Recievable', currency: 'USD', ex_rate: '280', roundOff: '0',
  total: '100', paid: '0', recieved: '40', party_Name: 'OVERSEAS AGENT', companyId: '1', Charge_Heads: [],
});
const query = (report) => ({ report, currency: 'USD', from: '2026-09-01', to: '2026-09-30', company: '1' });

test('prints every row - not the 20 on screen - with the total, on landscape A4', () => {
  captured.length = 0;
  render(<InvoiceBalancingReport result={{ status: 'success', result: Array.from({ length: 25 }, (_, i) => invoice(i + 1)) }} query={query('viewer')} />);
  const page = captured[captured.length - 1].content();
  expect(page.querySelectorAll('[data-row]')).toHaveLength(25);
  const total = page.querySelector('[data-total]');
  expect(total.textContent).toContain('USD');
  expect(total.textContent).toContain('2,500.00');   // 25 x 100
  expect(total.textContent).toContain('1,500.00');   // 25 x 60 outstanding
  expect(page.textContent).toContain('Agent Invoice Balancing Report');
  expect(page.querySelector('style').textContent).toMatch(/size: A4 landscape/);
});

test('a CN prints below zero: its Credit, Paid / Rcvd and Balance, and the Credit total (2026-11-16)', () => {
  captured.length = 0;
  const cn = { ...invoice(2), invoice_No: 'SNS-AI-620/26', payType: 'Payble', total: '496.49', paid: '96.49', recieved: '0' };
  render(<InvoiceBalancingReport result={{ status: 'success', result: [invoice(1), cn] }} query={query('viewer')} />);
  const page = captured[captured.length - 1].content();
  const heads = [...page.querySelectorAll('th')].map((th) => th.textContent);
  const cells = (tr) => Object.fromEntries([...tr.querySelectorAll('td')].map((td, i) => [heads[i], td.textContent]));
  const cnRow = cells([...page.querySelectorAll('[data-row]')].find((tr) => tr.textContent.includes('SNS-AI-620/26')));
  expect(cnRow).toMatchObject({ Debit: '0.00', Credit: '(496.49)', 'Paid / Rcvd': '(96.49)', Balance: '(400.00)' });
  expect(page.querySelector('[data-total]').textContent).toContain('(496.49)');

  // And on the screen: the Credit column, minus.
  const screenRow = [...document.querySelectorAll('table tbody tr')].find((tr) => tr.textContent.includes('SNS-AI-620/26'));
  expect([...screenRow.querySelectorAll('td')].map((td) => td.textContent)).toEqual(
    expect.arrayContaining(['-496.49', '-96.49', '-400.00']),
  );
});

test('the grid view prints too', () => {
  captured.length = 0;
  render(<InvoiceBalancingReport result={{ status: 'success', result: [invoice(1)] }} query={query('grid')} />);
  expect(captured.length).toBeGreaterThan(0);
  expect(captured[captured.length - 1].content().querySelectorAll('[data-row]')).toHaveLength(1);
});

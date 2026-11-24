/**
 * Agent Invoice Balancing - the order its rows are listed, printed and
 * exported in (Reports/InvoiceBalancing/InvoiceBalancingReport).
 *
 * Oldest first, by the actual date. The server used to send the invoices in
 * storage order - a migrated book put 2026 invoices ahead of 2022 ones - and
 * both Excel exports write the rows in the order the page holds them.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import InvoiceBalancingReport from '../Components/Layouts/Reports/InvoiceBalancing/InvoiceBalancingReport';

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: () => null }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('react-to-print', () => () => null);
jest.mock('ag-grid-react', () => ({ AgGridReact: () => null }));
jest.mock('Components/Shared/PrintTopHeader', () => () => null);
jest.mock('functions/companyBranding', () => ({
  companyLogoBlob: jest.fn(), companyTitle: () => 'SNS', reportCompanyTitle: () => 'SNS', reportAddress: () => '',
  // The print (AgentBalancingPrint) draws the letterhead.
  reportLetterheadId: () => 1, companyDetails: () => ({ address: '' }), companyLogo: () => null,
}));

const invoice = (id, invoice_No, createdAt) => ({
  id, invoice_No, createdAt, payType: 'Recievable', currency: 'USD', ex_rate: '280', roundOff: '0',
  total: '100', paid: '0', recieved: '0', party_Name: 'OVERSEAS AGENT', companyId: '1', Charge_Heads: [],
});

test('lists oldest first, whatever order the server sent them in', () => {
  const result = {
    status: 'success',
    result: [
      invoice(9, 'SNS-AI-9/27', '2026-09-15T10:00:00Z'),
      invoice(3, 'SNS-AI-3/23', '2022-03-10T10:00:00Z'),
      invoice(5, 'SNS-AI-5/25', '2024-01-02T10:00:00Z'),
      // Same day as the 2022 one: the earlier-raised (lower id) first.
      invoice(2, 'SNS-AI-2/23', '2022-03-10T10:00:00Z'),
    ],
  };
  render(<InvoiceBalancingReport result={result} query={{ report: 'viewer', currency: 'USD', from: '2022-01-01', to: '2026-12-31' }} />);
  // The table is drawn twice - on screen and for the print - in one order.
  const shown = screen.getAllByText(/^SNS-AI-/).map((el) => el.textContent);
  const order = ['SNS-AI-2/23', 'SNS-AI-3/23', 'SNS-AI-5/25', 'SNS-AI-9/27'];
  expect(shown).toEqual([...order, ...order]);
});

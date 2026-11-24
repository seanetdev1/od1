/**
 * A PKR invoice converts at 1 in Payments & Receipts - functions/invoiceRate.
 *
 * SNS-BPV-533/27 paid MSC three PKR bills, 92,606 in all, and posted 92,606.
 * But approving a bill stores the rate of its charges - SNS-JB-551/27 is one
 * USD 115 line at 282.40, PKR 32,476, ex_rate 282.4 - and the voucher print
 * multiplied the PKR amounts by it: Local Amount 9,171,222.40 and a Net
 * Amount of 26,145,893.27.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { invoiceRate } from '../functions/invoiceRate';
import PrintTransaction from '../Components/Layouts/AccountsComp/PaymentsReceipt/PrintTransaction';

jest.mock('functions/companyBranding', () => ({
  companyDetails: () => ({ title: 'SEA NET SHIPPING & LOGISTICS', address: 'PLOT NO. A-230, KARACHI' }),
  companyLogo: () => null,
}));

describe('invoiceRate', () => {
  test('a PKR invoice is 1, whatever rate it carries', () => {
    expect(invoiceRate({ currency: 'PKR', ex_rate: '282.4' })).toBe(1);
    expect(invoiceRate({ currency: 'pkr', ex_rate: 282.3 })).toBe(1);
  });

  test('a foreign invoice converts at its own rate', () => {
    expect(invoiceRate({ currency: 'USD', ex_rate: '282.4' })).toBe(282.4);
  });

  test('a missing or zero rate is 1, not a division by zero', () => {
    expect(invoiceRate({ currency: 'USD', ex_rate: '0' })).toBe(1);
    expect(invoiceRate({ currency: 'USD' })).toBe(1);
    expect(invoiceRate(null)).toBe(1);
  });
});

describe('the payment voucher print - SNS-BPV-533/27', () => {
  const state = {
    payType: 'Payble', type: 'All', currency: 'PKR', exRate: '1',
    transactionMode: 'Bank', subType: 'Cheque', checkNo: '11270215',
    totalReceivable: 92606, bankChargesAmount: 0, taxAmount: 0,
    PRaccounts: [{ id: 5, name: 'MSC PAKISTAN (PVT.) LTD.' }], selectedAccount: 5,
    receivingAccounts: [{ id: 9, title: 'BANK AL-HABIB SNSL' }], receivingAccount: 9,
    oldVouchers: [], invoices: [
      { id: 1, invoice_No: 'SNS-JB-551/27', currency: 'PKR', ex_rate: '282.4', receiving: 32476, roundOff: '0' },
      { id: 2, invoice_No: 'SNS-JB-549/27', currency: 'PKR', ex_rate: '282.3', receiving: 60129.9, roundOff: '0' },
      { id: 3, invoice_No: 'SNS-JB-557/27', currency: 'PKR', ex_rate: '1', receiving: 0.1, roundOff: '0' },
    ],
  };

  test('prints each PKR bill at 1.00, and totals 92,606', () => {
    render(<PrintTransaction companyId='2' state={state} hideTrigger />);
    expect(screen.getAllByText('32,476.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('9,171,222.40')).toBeNull();
    expect(screen.queryByText('282.40')).toBeNull();
    expect(screen.getAllByText('92,606.00').length).toBeGreaterThan(0);
    expect(screen.queryByText(/26,145,893/)).toBeNull();
  });
});

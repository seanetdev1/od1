/**
 * The Net Amount on the payment / receipt print -
 * Components/Layouts/AccountsComp/PaymentsReceipt/PrintTransaction.
 *
 * It is what the bank moved, as the journal posts it (functions/
 * paymentReceiptCosts): the tax and bank charges WE pay off a receipt, on top
 * of a payment - it took them off a payment too - and what the party pays not
 * at all: that goes between the party and its account (2026-10-22).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import PrintTransaction from '../Components/Layouts/AccountsComp/PaymentsReceipt/PrintTransaction';

jest.mock('functions/companyBranding', () => ({
  companyDetails: () => ({ title: 'TEST CO', address: 'KARACHI' }),
  companyLogo: () => null,
}));

const state = (over) => ({
  advance: true, totalReceivable: 100000, exRate: 1, currency: 'PKR',
  invoices: [], PRaccounts: [], oldVouchers: [], receivingAccounts: [],
  type: 'client', transactionMode: 'Cash', date: '2026-10-21',
  taxAmount: 4500, bankChargesAmount: 200,
  ...over,
});
const net = () => screen.getByText('Net Amount :').parentElement.querySelector('b').textContent;

test('a receipt nets the tax and bank charges off what was received', () => {
  render(<PrintTransaction companyId={1} state={state({ payType: 'Recievable' })} />);
  expect(net()).toBe('95,300.00');
});

test('a payment adds them to what was paid out', () => {
  render(<PrintTransaction companyId={1} state={state({ payType: 'Payble' })} />);
  expect(net()).toBe('104,700.00');
});

test('bank charges the party paid do not move the bank, and are marked', () => {
  render(<PrintTransaction companyId={1} state={state({ payType: 'Payble', bankChargesBy: 'party' })} />);
  expect(net()).toBe('104,500.00');
  expect(screen.getByText('Bank Charges (party) :')).toBeTruthy();
});

test('nor does tax the party paid - with both theirs, the bank moves the settled amount', () => {
  render(<PrintTransaction companyId={1} state={state({ payType: 'Payble', taxBy: 'party' })} />);
  expect(net()).toBe('100,200.00');
  expect(screen.getByText('Tax Amount (party) :')).toBeTruthy();
});

test('the user\'s example: 300,000 paid, the party\'s 1,500 tax and 500 charges - 300,000 from the bank', () => {
  render(<PrintTransaction companyId={1} state={state({
    payType: 'Payble', totalReceivable: 300000, taxAmount: 1500, bankChargesAmount: 500, taxBy: 'party', bankChargesBy: 'party',
  })} />);
  expect(net()).toBe('300,000.00');
});

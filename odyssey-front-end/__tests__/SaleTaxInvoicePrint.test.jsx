/**
 * The Sales Tax Invoice form - Components/Shared/SaleTaxInvoicePrint. Pins the
 * fields the user specified: the company's NTN in the letterhead, GD # (not
 * File Job #), "Sales Tax" throughout, the heading underlined, Client Invoice #,
 * No. of Packages, no IGM / EGM lines and no GD Machine # / GD Date / Client
 * Ref line - and every other value filled from the invoice, its customs job
 * and the invoiced party.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import SaleTaxInvoicePrint from '../Components/Shared/SaleTaxInvoicePrint';

jest.mock('functions/companyBranding', () => ({ getCompany: () => null }));

const invoice = {
  invoice_No: 'JI-2377/27',
  createdAt: '2026-09-24T10:00:00Z',
  approved: '1',
  party_Name: 'ALI MURTAZA ASSOCIATES (PVT) LTD',
  Sales_Tax_Invoice: { taxInvoiceNo: 'CL-24294' },
  recipient: { name: 'ALI MURTAZA ASSOCIATES (PVT) LTD', address1: 'KARACHI', strn: '1200620000891', ntn: '0709571-6' },
  customsJob: {
    jobNo: 'TP-1726/27', customFileNo: '50715', gdNumber: '50715', gdDate: '2026-08-26',
    clientRef: 'AMA-REF-26', packages: 2157, pkgUnit: 'CARTONS', invoiceNo: 'AMA-18792-26',
    goodsDescription: 'GARMENTS',
  },
};
const records = [
  { type: 'Recievable', CustomsJobId: 1, qty: 1, ex_rate: 1, rate_charge: 72000, tax_apply: false },
  { type: 'Recievable', CustomsJobId: 1, qty: 1, ex_rate: 1, rate_charge: 2500, tax_apply: true, taxPerc: 15, tax_amount: 375 },
];
const company = { title: 'CARGO LINKERS.', address: 'PLOT NO. A-230, KARACHI', ntn: '5322935-2' };

describe('the Sales Tax Invoice form', () => {
  beforeEach(() => render(<SaleTaxInvoicePrint invoice={invoice} records={records} company={company} />));

  test('the company\'s NTN under its details', () => {
    expect(screen.getByText('NTN # 5322935-2')).toBeTruthy();
  });

  test('"Sales Tax" throughout, and the heading underlined', () => {
    const heading = screen.getByText('SALES TAX INVOICE');
    expect(heading.style.textDecoration).toBe('underline');
    expect(screen.queryByText(/Sale Tax|SALE TAX/)).toBeNull();
    expect(screen.getByText('Sales Tax Registration No. of The Recipient')).toBeTruthy();
    expect(screen.getByText(/Sales Tax @ 15 %/)).toBeTruthy();
    expect(screen.getByText(/Additional Sales Tax/)).toBeTruthy();
  });

  test('GD # where File Job # was', () => {
    expect(screen.queryByText(/File Job/)).toBeNull();
    expect(screen.getByText('GD # :')).toBeTruthy();
    expect(screen.getByText('50715')).toBeTruthy();
  });

  test('Client Invoice # and No. of Packages', () => {
    expect(screen.queryByText(/Comm\. Inv/)).toBeNull();
    expect(screen.getByText('Client Invoice # :')).toBeTruthy();
    expect(screen.getByText('AMA-18792-26')).toBeTruthy();
    expect(screen.getByText('No. of Packages :')).toBeTruthy();
    expect(screen.getByText('2157 CARTONS')).toBeTruthy();
    expect(screen.queryByText(/Clearance of/)).toBeNull();
  });

  test('no GD Machine # / GD Date / Client Ref line, and no IGM / EGM', () => {
    expect(screen.queryByText(/GD Machine|GD Date|Client Ref|IGM|EGM/)).toBeNull();
    expect(screen.queryByText('26-Aug-2026')).toBeNull();
    expect(screen.queryByText('AMA-REF-26')).toBeNull();
  });

  test('the header, recipient and goods are filled in', () => {
    expect(screen.getByText('CL-24294')).toBeTruthy();
    expect(screen.getByText('JI-2377/27')).toBeTruthy();
    expect(screen.getByText('24-Sep-2026')).toBeTruthy();
    expect(screen.getByText('1200620000891')).toBeTruthy();
    expect(screen.getByText('0709571-6')).toBeTruthy();
    expect(screen.getByText('GARMENTS')).toBeTruthy();
  });

  test('only the taxed line is on it', () => {
    expect(screen.getByText('2,500.00')).toBeTruthy();
    expect(screen.getByText('375.00')).toBeTruthy();
    expect(screen.getByText('2,875.00')).toBeTruthy();
  });
});

/* SHIPPER IN M/S - Printing Options addresses the Sales Tax Invoice to the
 * job's shipper, with the shipper's own STRN and NTN, as the normal invoice
 * does. It used to be ignored here: the invoice went to the shipper and its
 * Sales Tax Invoice to the client. */
describe('Shipper in M/S', () => {
  const shipper = {
    name: 'GUANGZHOU TEXTILE CO', address1: 'GUANGZHOU', address2: 'CHINA', strn: '3277876111111', ntn: '9999999-9',
  };
  const withShipper = { ...invoice, customsJob: { ...invoice.customsJob, shipper } };

  test('addresses it to the shipper - name, address, STRN and NTN all the shipper\'s', () => {
    render(<SaleTaxInvoicePrint invoice={withShipper} records={records} company={company} shipperInMs />);
    expect(screen.getByText(/GUANGZHOU TEXTILE CO/)).toBeTruthy();
    expect(screen.getByText('CHINA')).toBeTruthy();
    expect(screen.getByText('3277876111111')).toBeTruthy();
    expect(screen.getByText('9999999-9')).toBeTruthy();
    // Never the client's numbers under the shipper's name.
    expect(screen.queryByText('1200620000891')).toBeNull();
    expect(screen.queryByText('0709571-6')).toBeNull();
    expect(screen.queryByText(/ALI MURTAZA/)).toBeNull();
  });

  test('left off, it stays addressed to the invoiced party', () => {
    render(<SaleTaxInvoicePrint invoice={withShipper} records={records} company={company} />);
    expect(screen.getByText(/ALI MURTAZA ASSOCIATES/)).toBeTruthy();
    expect(screen.queryByText(/GUANGZHOU/)).toBeNull();
  });

  test('a job with no shipper keeps the invoiced party', () => {
    render(<SaleTaxInvoicePrint invoice={invoice} records={records} company={company} shipperInMs />);
    expect(screen.getByText(/ALI MURTAZA ASSOCIATES/)).toBeTruthy();
    expect(screen.getByText('0709571-6')).toBeTruthy();
  });

  test('the invoice page and bulk print reach it through InvoicePrint', () => {
    // eslint-disable-next-line global-require
    const InvoicePrint = require('../Components/Shared/InvoicePrint').default;
    render(<InvoicePrint invoice={withShipper} records={records} company={company} vatInvoice shipperInMs
      calculateTotal={() => 0} />);
    expect(screen.getByText('SALES TAX INVOICE')).toBeTruthy();
    expect(screen.getByText(/GUANGZHOU TEXTILE CO/)).toBeTruthy();
  });
});

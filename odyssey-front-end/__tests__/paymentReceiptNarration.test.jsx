/**
 * The typed narration on the payment / receipt print - functions/
 * paymentReceiptNarration and PaymentsReceipt/PrintTransaction (the user,
 * 2026-11-10: shown as Narration, apart from Remarks). The print never showed
 * it. The server's own text, saved when the box is left empty, is not printed
 * again - it says what Remarks says.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { isAutoNarration, typedNarration } from 'functions/paymentReceiptNarration';
import PrintTransaction from '../Components/Layouts/AccountsComp/PaymentsReceipt/PrintTransaction';

jest.mock('functions/companyBranding', () => ({
  companyDetails: () => ({ title: 'TEST CO', address: 'KARACHI' }),
  companyLogo: () => null,
}));

describe('the server\'s own text is recognised', () => {
  // As routes/voucher makeTransaction builds it - examples off the SNS / CL copies.
  test.each([
    ['Received Cheque 80524361, Date: 2026-11-04, Against, HBL# 147-93691234, Invoice# ACS-JI-605/27, Job# ACS-AE-12/27, For HASNAIN CARGO', 'Cheque'],
    ['Received Cheque IBFT, Date: 2026-11-02, Against, HBL# OOLU2, Invoice# SNS-JI-1/27, Job# SNS-SE-1/27, For X', 'Cheque'],
    ['Received Cheque ON LINE, Date: 2026-11-02, Against, Invoice# SNS-JI-2/27, Job# SNS-SE-2/27, For X', 'Cheque'],
    ['Paid Cash, Against, Invoice# SNS-JB-9/27, Job# SNS-SE-9/27, For OOCL', 'Cash'],
    ['Received Cheque 1, Date: 2026-11-04', 'Cheque'],                       // an advance: no invoices
    // Edited later: the text keeps the cheque it was first saved with (CL BRV-365/27).
    ['Received Cheque 538140, Date: 2026-10-05, Against, Invoice# JI-5491/25, Invoice# JI-5625/25', 'Cheque'],
  ])('%s', (text, subType) => {
    expect(isAutoNarration(text, { subType, checkNo: '731594493' })).toBe(true);
    expect(typedNarration({ voucherNarration: text, subType })).toBe('');
  });
});

describe('a typed narration is kept', () => {
  test.each([
    ['ROYAL JORDANIAN 01-15 OCT 2026', 'Cheque'],
    ['PAID TO SUNIL AGAINST AED 150,000 TO 1FLT AVIATION (IFA)', 'Cheque'],
    ['Paid To Pak Shaheen Container Services (Pvt) Ltd.', 'Cheque'],
    ['Received cash from Ali', 'Cheque'],          // not this voucher's sub type
    ['P.O', 'Cheque'],
  ])('%s', (text, subType) => {
    expect(typedNarration({ voucherNarration: `  ${text} `, subType })).toBe(text);
  });

  test('none, or only spaces, is nothing', () => {
    expect(typedNarration({ voucherNarration: '', subType: 'Cheque' })).toBe('');
    expect(typedNarration({ voucherNarration: '   ', subType: 'Cheque' })).toBe('');
    expect(typedNarration({ subType: 'Cheque' })).toBe('');
  });
});

describe('on the print', () => {
  const state = (over) => ({
    advance: true, totalReceivable: 1000, exRate: 1, currency: 'PKR', payType: 'Payble',
    invoices: [], PRaccounts: [], oldVouchers: [], receivingAccounts: [],
    type: 'vendor', transactionMode: 'Bank', subType: 'Cheque', checkNo: '11265737',
    checkDate: '2026-10-20', date: '2026-10-20', ...over,
  });
  const block = (heading) => screen.getByText(`${heading} :`).closest('div').nextElementSibling.textContent;

  test('a typed narration prints as Narration, and Remarks is still the print\'s own', () => {
    render(<PrintTransaction companyId={1} state={state({ voucherNarration: 'ROYAL JORDANIAN 01-15 OCT 2026' })} />);
    expect(block('Narration')).toBe('ROYAL JORDANIAN 01-15 OCT 2026');
    expect(block('Remarks')).toMatch(/^Paid Cheque # 11265737 Dated 2026-10-20/);
    expect(block('Remarks')).not.toMatch(/ROYAL JORDANIAN/);
  });

  test('the server\'s own text, or none, prints no Narration', () => {
    const { unmount } = render(<PrintTransaction companyId={1} state={state({ voucherNarration: 'Paid Cheque 11265737, Date: 2026-10-20' })} />);
    expect(screen.queryByText('Narration :')).toBeNull();
    expect(screen.getByText('Remarks :')).toBeTruthy();
    unmount();
    render(<PrintTransaction companyId={1} state={state({ voucherNarration: '' })} />);
    expect(screen.queryByText('Narration :')).toBeNull();
  });
});

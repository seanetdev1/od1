/**
 * Essani's invoice print options (the user, 2026-11-14) - each an install
 * setting, so an install that sets none prints as before:
 *   - the S/R Page # under the install's name for it ("File Job Number")
 *   - a Freight Forwarding job's HBL # where the Client Invoice # was
 *   - Container Nos in the Note box (Configuration > Invoices)
 *   - Hide Bank Details (Printing Options; Configuration > Invoices ticks it)
 *   - a disclaimer where the sign line was, when it is hidden
 * The install's settings come with the invoice (invoice.printSettings, the
 * server's attachPrintContext), so the emailed PDF prints the same.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import ExcelJS from 'exceljs';
import InvoicePrint from '../Components/Shared/InvoicePrint';
import { calculateTotal } from '../Components/Shared/invoicePrintDefaults';
import { buildInvoiceWorkbook } from 'functions/invoiceExcel';
import { invoiceTemplateFields } from 'functions/invoiceTemplateFields';

jest.mock('functions/companyBranding', () => ({
  getCompany: () => null,
  bankAccountFields: jest.requireActual('functions/companyBranding').bankAccountFields,
}));

const records = [
  { type: 'Recievable', CustomsJobId: 7, partyType: 'client', particular: 'AGENCY', description: '',
    qty: 1, rate_charge: 5000, currency: 'PKR', amount: 1, discount: 0, tax_amount: 0, local_amount: 5000, ex_rate: 1, pp_cc: 'PP' },
];
const bankAccount = { bankName: 'MEEZAN BANK', accountTitle: 'ESSANI', accountNo: '0101-2020' };

const invoiceOf = (over = {}, job = {}) => ({
  invoice_No: 'ESS-JI-1/27', type: 'Job Invoice', payType: 'Recievable', operation: 'CC',
  createdAt: '2026-11-14T10:00:00Z', ex_rate: '1', roundOff: '0', recieved: '0', paid: '0',
  party_Name: 'ACME', note: 'A note long enough to be printed in the Note box of this invoice.',
  recipient: { name: 'ACME' },
  customsJob: {
    jobNo: 'ESS-CC-1/27', jobDate: '2026-11-14', jobType: 'Clearing', jobRef: 'F-881',
    clientRef: 'CI-77', invoiceNo: 'CI-77', blNo: 'HBL-5521',
    Customs_Containers: [{ containerNo: 'MSKU1234567' }, { containerNo: 'TCLU7654321' }],
    ...job,
  },
  ...over,
});

const printed = (invoice, props = {}) => render(
  <InvoicePrint invoice={invoice} records={records} company={{ title: 'ESSANI' }} bankAccount={bankAccount}
    calculateTotal={calculateTotal} {...props} />,
);

describe('set nothing, and the print is as before', () => {
  test('S/R Page #, Client Invoice #, Note, Bank Details, the sign line', () => {
    printed(invoiceOf());
    expect(screen.getByText('S/R Page #:')).toBeTruthy();
    expect(screen.getByText('Client Invoice #')).toBeTruthy();
    expect(screen.getByText('Note')).toBeTruthy();
    expect(screen.queryByText('Container Nos')).toBeNull();
    expect(screen.getByText('Bank Details')).toBeTruthy();
    expect(document.querySelector('.invoice-sign-line')).toBeTruthy();
  });

  test('the sign line hidden and no disclaimer set: nothing there, as before', () => {
    printed(invoiceOf(), { hideSignLine: true });
    expect(document.querySelector('.invoice-sign-line')).toBeNull();
    expect(document.querySelector('.invoice-sign-disclaimer')).toBeNull();
  });
});

describe("Essani's settings", () => {
  const settings = { referenceLabel: 'File Job Number', containerNosInNote: true, signDisclaimer: 'Computer generated - no signature required.' };

  test('the S/R Page # under its install name', () => {
    printed(invoiceOf({ printSettings: settings }));
    expect(screen.getByText('File Job Number:')).toBeTruthy();
    expect(screen.getByText('F-881')).toBeTruthy();
    expect(screen.queryByText('S/R Page #:')).toBeNull();
  });

  test('the Note box lists the containers instead of the note', () => {
    printed(invoiceOf({ printSettings: settings }));
    expect(screen.getByText('Container Nos')).toBeTruthy();
    expect(document.querySelector('.invoice-container-nos').textContent).toBe('MSKU1234567, TCLU7654321');
    expect(screen.queryByText(/A note long enough/)).toBeNull();
  });

  test('Hide Bank Details leaves the box off', () => {
    printed(invoiceOf({ printSettings: settings }), { hideBankDetails: true });
    expect(screen.queryByText('Bank Details')).toBeNull();
    expect(screen.queryByText(/MEEZAN BANK/)).toBeNull();
  });

  test('the sign line hidden: the disclaimer in its place', () => {
    printed(invoiceOf({ printSettings: settings }), { hideSignLine: true });
    expect(document.querySelector('.invoice-sign-line')).toBeNull();
    expect(document.querySelector('.invoice-sign-disclaimer').textContent).toBe('Computer generated - no signature required.');
  });

  test('the sign line shown: no disclaimer', () => {
    printed(invoiceOf({ printSettings: settings }));
    expect(document.querySelector('.invoice-sign-line')).toBeTruthy();
    expect(document.querySelector('.invoice-sign-disclaimer')).toBeNull();
  });

  test('a Freight Forwarding job prints its HBL # where the Client Invoice # was', () => {
    printed(invoiceOf({ printSettings: settings }, { jobType: 'Freight Forwarding' }));
    expect(screen.getByText('HBL #')).toBeTruthy();
    expect(screen.getByText('HBL-5521')).toBeTruthy();
    expect(screen.queryByText('Client Invoice #')).toBeNull();
  });
});

describe('the Excel and the Word template say the same', () => {
  const cells = (ws) => {
    const out = [];
    ws.eachRow((row) => row.eachCell((c) => { if (c.value) out.push(String(c.value)); }));
    return out;
  };

  test('Excel: the install name, Container Nos, no Bank Details', () => {
    const invoice = invoiceOf({ printSettings: { referenceLabel: 'File Job Number', containerNosInNote: true } });
    const wb = buildInvoiceWorkbook(ExcelJS, { invoice, records, bankAccount, options: { hideBankDetails: true } });
    const all = cells(wb.worksheets[0]);
    expect(all).toContain('File Job Number:');
    expect(all).toContain('Container Nos:');
    expect(all).toContain('MSKU1234567, TCLU7654321');
    expect(all).not.toContain('Bank Details');
  });

  test('Excel unset: as before', () => {
    const wb = buildInvoiceWorkbook(ExcelJS, { invoice: invoiceOf(), records, bankAccount });
    const all = cells(wb.worksheets[0]);
    expect(all).toContain('S/R Page #:');
    expect(all).toContain('Note:');
    expect(all).toContain('Bank Details');
  });

  test('Word template fields', () => {
    const invoice = invoiceOf({ printSettings: { referenceLabel: 'File Job Number', signDisclaimer: 'No signature.' } });
    const fields = invoiceTemplateFields({ invoice, records, bankAccount, options: { hideBankDetails: true } });
    expect(fields.srPageLabel).toBe('File Job Number');
    expect(fields.signDisclaimer).toBe('No signature.');
    expect(fields.showBankDetails).toBe(false);
  });
});

/**
 * SNS-AI-175/27, as a user's screenshot showed it (2026-11-05):
 *
 *   - the charges table one column out: the Amount column read "DN" and every
 *     figure sat a column to the right. The print decided on its Type column
 *     once, on mount - and the invoice screen (InvoiceCharges) mounts it
 *     before the invoice has loaded, with no lines, so the header never got
 *     the column while each CC line still printed its DN.
 *   - INVOICE TO: RIV WORLDWIDE INC over SMART APPAREL's Faisalabad address -
 *     the job client's. The data is right (lines, account and record all
 *     RIV's, checked on a 2026-11-05 copy of SNS); the print has addressed the
 *     invoiced party itself since 1.2.69 (functions/invoiceBillTo). Pinned
 *     here on this invoice.
 */
import React from 'react';
import { render } from '@testing-library/react';
import InvoicePrint from '../Components/Shared/InvoicePrint';
import { calculateTotal } from '../Components/Shared/invoicePrintDefaults';

jest.mock('react-to-print', () => ({ useReactToPrint: () => jest.fn() }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('functions/companyBranding', () => ({
  getCompany: () => null,
  companyBankAccounts: () => [],
  defaultBankAccount: () => null,
  bankAccountFields: () => [],
  companyOptions: () => [],
}));

const RIV = { name: 'RIV WORLDWIDE INC', address1: '20-21 WAGARAW ROAD, BUILDING 30A, FAIRLAWN NJ 07410, USA' };
const SMART = { name: 'SMART APPAREL PVT LTD', address1: 'P-1 GARMEN CITY, DEY PORT ROAD FAISALABAD 3800' };

const invoice = {
  invoice_No: 'SNS-AI-175/27', type: 'Agent Invoice', payType: 'Recievable', operation: 'AE', currency: 'USD',
  createdAt: '2026-10-16T10:00:00Z', ex_rate: '1', roundOff: '0', recieved: '0', paid: '0', approved: '1',
  party_Name: 'RIV WORLDWIDE INC', recipient: RIV,
  SE_Job: { jobNo: 'SNS-AE-156/27', Client: SMART, shipper: SMART, consignee: {}, SE_Equipments: [] },
};
const line = (particular, qty, rate, ppcc = 'CC') => ({
  type: 'Recievable', partyType: 'agent', particular, qty, rate_charge: rate, currency: 'USD', amount: 1,
  discount: 0, tax_amount: 0, net_amount: qty * rate, local_amount: qty * rate, ex_rate: 1, pp_cc: ppcc,
});
const lines = [line('AIR FREIGHT', 3400, 5.66), line('PROFIT SHARE', 1, 102)];

// As InvoiceCharges does it: mounted with no lines, then given the invoice's.
const printLoaded = (records, inv = invoice) => {
  const view = render(<InvoicePrint invoice={inv} records={[]} calculateTotal={calculateTotal} />);
  view.rerender(<InvoicePrint invoice={inv} records={records} calculateTotal={calculateTotal} />);
  return view.container;
};
const headCells = (c) => [...c.querySelectorAll('thead tr')].at(-1).querySelectorAll('td');
const rowOf = (c, particular) => [...c.querySelectorAll('tbody tr')]
  .find((tr) => [...tr.children].some((td) => td.textContent === particular));

test('the Type column is there once the lines arrive, and every line fills the header', () => {
  const c = printLoaded(lines);
  const heads = [...headCells(c)].map((td) => td.textContent.trim());
  expect(heads).toContain('Type');
  for (const p of ['AIR FREIGHT', 'PROFIT SHARE']) {
    expect(rowOf(c, p).children.length).toBe(heads.length);
  }
  // DN under Type, the amount under Amount - not "DN" under Amount.
  const cells = [...rowOf(c, 'AIR FREIGHT').children].map((td) => td.textContent.trim());
  expect(cells[heads.indexOf('Type')]).toBe('DN');
  expect(cells[heads.indexOf('Amount')]).toBe('19,244.00');
});

test('PP and CC lines on one invoice line up alike; a PP line has a blank Type', () => {
  const c = printLoaded([line('AIR FREIGHT', 3400, 5.66), line('HANDLING', 1, 25, 'PP')]);
  const heads = [...headCells(c)].map((td) => td.textContent.trim());
  const pp = rowOf(c, 'HANDLING');
  expect(pp.children.length).toBe(heads.length);
  expect(pp.children[heads.indexOf('Type')].textContent).toBe('');
});

test('no CC line, no Type column', () => {
  const c = printLoaded([line('HANDLING', 1, 25, 'PP')]);
  expect([...headCells(c)].map((td) => td.textContent.trim())).not.toContain('Type');
});

test("INVOICE TO is RIV's own address, not the job client's", () => {
  const c = printLoaded(lines);
  expect(c.textContent).toContain('FAIRLAWN NJ');
  expect(c.textContent).not.toContain('GARMEN CITY');
});

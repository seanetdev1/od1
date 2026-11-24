/**
 * The Direct Job Expense / Revenue print - checked against the voucher Climax
 * printed for CargoLinkers' JER-143/27, which is the template it follows.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { directJobPrintModel } from '../functions/directJobPrint';
import DirectJobPrint from '../Components/Layouts/AccountsComp/directJob/DirectJobPrint';

jest.mock('functions/companyBranding', () => ({
  companyDetails: () => ({ title: 'CARGO LINKERS.', address: 'PLOT NO. A-230, BLOCK 2, P.E.C.H.S, KARACHI' }),
  companyLogo: () => null,
}));

// JER-143/27, as the screen holds it.
const state = (over = {}) => ({
  directJob_EntryNumber: 'JER-143/27',
  directJob_EntryDate: '2026-09-29T00:00:00.000Z',
  directJob_Type: 'expense',
  directJob_Reference: '',
  directJob_CostCenter: 'HEAD OFFICE',
  directJob_Currency: 'PKR',
  directJob_TransMode: 'Cash',
  directJob_SubType: '',
  directJob_ChequeNo: '',
  directJob_ChequeDate: '2026-09-29T00:00:00.000Z',
  directJob_Account: 9,
  directJob_PaidTo: undefined,
  directJob_DrawnAt: '',
  directJob_Operation: 'logistics',
  directJob_JobType: 'single',
  directJob_Remarks: '',
  directJob_CAccounts: [{ id: 9, title: 'CASH IN HAND', code: '1101' }],
  directJob_SettlementAccounts: [],
  directJob_Charges: [{ id: 41, name: 'OTHER CHARGES', short: 'OTH' }],
  directJob: [{
    JobNumber: 'TP-2044/27', FileNumber: '56/27', Charge: 41, Currency: 'PKR',
    Quantity: 1, Rate: 11900, Amount: 11900, Discount: 0, NetAmount: 11900,
    ExRate: 1, LocalAmount: 11900,
    Description: 'Paid to Mudassir Imp for Tracker 7,897+NOC 3,000+Expenses 1,000.',
  }],
  ...over,
});

describe('directJobPrintModel', () => {
  it('reads the entry as the template prints it', () => {
    const m = directJobPrintModel(state());
    expect(m).toMatchObject({
      entryNo: 'JER-143/27', type: 'Expense', costCenter: 'HEAD OFFICE', currency: 'PKR',
      tranMode: 'Cash', account: 'CASH IN HAND', operation: 'Logistics', jobType: 'Single',
      jobNo: 'TP-2044/27',
    });
    expect(m.rows[0]).toMatchObject({ jobNo: 'TP-2044/27', fileNo: '56/27', charge: 'OTHER CHARGES', qty: 1, rate: 11900, net: 11900, local: 11900 });
    expect(m.totals).toEqual({ amount: 11900, discount: 0, net: 11900, local: 11900 });
    expect(m.inWords).toMatch(/^PKR Eleven Thousand Nine Hundred only$/i);
  });

  it('writes the remarks Climax wrote when the entry has none', () => {
    expect(directJobPrintModel(state()).remarks)
      .toBe('Cash Paid Against Invoice : JER-143/27 Against File Job No 56/27 Job #: TP-2044/27');
    expect(directJobPrintModel(state({ directJob_Type: 'revenue', directJob_TransMode: 'Bank' })).remarks)
      .toMatch(/^Bank Received Against Invoice/);
  });

  // 2026-10-21: cash entries printed the screen's default cheque date.
  it('prints no cheque on a cash entry, whatever the screen holds', () => {
    const m = directJobPrintModel(state({ directJob_ChequeNo: '123', directJob_ChequeDate: '2026-09-29T00:00:00.000Z' }));
    expect([m.chequeNo, m.chequeDate]).toEqual(['', null]);
  });

  it('prints the cheque of a bank entry', () => {
    const m = directJobPrintModel(state({ directJob_TransMode: 'Bank', directJob_ChequeNo: '123' }));
    expect([m.chequeNo, m.chequeDate]).toEqual(['123', '2026-09-29T00:00:00.000Z']);
  });

  it('prints the remarks typed on the entry when there are some', () => {
    expect(directJobPrintModel(state({ directJob_Remarks: 'Tracker charges, file 56' })).remarks)
      .toBe('Tracker charges, file 56');
  });

  it('names no single job in the header when the lines are for several', () => {
    const two = state({ directJob: [state().directJob[0], { ...state().directJob[0], JobNumber: 'TP-2045/27' }] });
    expect(directJobPrintModel(two).jobNo).toBe('');
    expect(directJobPrintModel(two).totals.local).toBe(23800);
  });

  it('converts foreign lines to local, and words the local total', () => {
    const usd = state({ directJob: [{ ...state().directJob[0], Currency: 'USD', Rate: 100, Amount: 100, NetAmount: 100, ExRate: 280, LocalAmount: 28000 }] });
    const m = directJobPrintModel(usd);
    expect(m.totals.local).toBe(28000);
    expect(m.inWords).toMatch(/Twenty Eight Thousand/i);
  });
});

describe('the Direct Job print', () => {
  it('lays the entry out like the Climax voucher', () => {
    render(<DirectJobPrint state={state()} companyId='1' printedBy='Hammad' />);
    expect(screen.getByText('CARGO LINKERS.')).toBeTruthy();
    expect(screen.getByText('Job Direct Expense Revenue')).toBeTruthy();
    expect(screen.getByText('JER-143/27')).toBeTruthy();
    expect(screen.getByText('CASH IN HAND')).toBeTruthy();
    expect(screen.getByText('OTHER CHARGES')).toBeTruthy();
    expect(screen.getAllByText('11,900.00').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/Cash Paid Against Invoice : JER-143\/27/)).toBeTruthy();
    expect(screen.getByText('Hammad')).toBeTruthy();
  });
});

/**
 * The voucher print - functions/voucherPrint and Voucher/Print.
 *
 * Each case is something the print got wrong: the cheque date (or today) in
 * the Date box, another line's narration once a voucher had two lines, the
 * same text again under "Pay to", and fields that stayed as they were when the
 * print mounted - before the voucher had loaded.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  voucherDate, chequeDate, voucherNarration, counterparty, voucherTotals, money,
} from 'functions/voucherPrint';
import Print from '../Components/Layouts/AccountsComp/Voucher/Print';

jest.mock('Components/Shared/CompanyLetterhead', () => () => <div>LETTERHEAD</div>);
jest.mock('js-cookie', () => ({ get: jest.fn(() => 'tester') }));

// Saved by the voucher screen: the party lines first, the bank line LAST.
const bpv = {
  voucher_Id: 'SNS-BPV-12/27', vType: 'BPV', chequeNo: '1001',
  createdAt: '2026-09-28T05:00:00.000Z', tranDate: '2026-09-28T05:00:00.000Z', chequeDate: '2026-09-30T05:00:00.000Z',
  Voucher_Heads: [
    { type: 'debit', amount: '1250', accountType: 'partyAccount', narration: 'Freight JB-11', Child_Account: { title: 'MAERSK' } },
    { type: 'debit', amount: '0.5', accountType: 'partyAccount', narration: 'Freight JB-12', Child_Account: { title: 'MSC' } },
    { type: 'credit', amount: '1250.5', accountType: 'payAccount', narration: 'Paid to Maersk and MSC by cheque 1001', Child_Account: { title: 'HBL CURRENT' } },
  ],
};

describe('what the voucher print shows', () => {
  test('the voucher\'s own date, not the cheque\'s - and never today', () => {
    expect(voucherDate(bpv)).toBe('28-09-2026');
    expect(chequeDate(bpv)).toBe('30-09-2026');
    expect(chequeDate({ ...bpv, chequeDate: null })).toBe('');
    expect(voucherDate({})).toBe('');
  });

  test('the bank line\'s narration even when it is the last line', () => {
    expect(voucherNarration(bpv)).toBe('Paid to Maersk and MSC by cheque 1001');
  });

  test('a migrated voucher\'s own narration first', () => {
    expect(voucherNarration({ ...bpv, voucherNarration: 'Payment against JB-11, JB-12' }))
      .toBe('Payment against JB-11, JB-12');
  });

  test('a journal, with no bank line, takes its first line\'s', () => {
    const jv = { vType: 'JV', Voucher_Heads: [{ narration: 'Reclass' }, { narration: 'Reclass' }] };
    expect(voucherNarration(jv)).toBe('Reclass');
  });

  test('"Pay to" names the parties paid, not the narration again', () => {
    expect(counterparty(bpv)).toEqual({ label: 'Pay to', value: 'MAERSK, MSC' });
    expect(counterparty({ ...bpv, payTo: 'Maersk Pakistan' }).value).toBe('Maersk Pakistan');
    expect(counterparty({ ...bpv, vType: 'BRV' }).label).toBe('Received from');
    expect(counterparty({ ...bpv, vType: 'JV' })).toBeNull();
  });

  test('amounts read 1,250.00 - and 0.50 is not 0', () => {
    expect(money(1250)).toBe('1,250.00');
    expect(money('0.5')).toBe('0.50');
    expect(voucherTotals(bpv)).toEqual({ debit: 1250.5, credit: 1250.5 });
  });
});

describe('the printed voucher', () => {
  test('fills in once the voucher arrives - it is mounted before it loads', () => {
    // The voucher screen renders the print with {} and loads the voucher after.
    const { rerender } = render(<Print compLogo='1' voucherData={{}} />);
    rerender(<Print compLogo='1' voucherData={bpv} />);

    expect(screen.getByDisplayValue('28-09-2026')).toBeTruthy();       // Date
    expect(screen.getByDisplayValue('30-09-2026')).toBeTruthy();       // Cheque Date
    expect(screen.getByText('Pay to:')).toBeTruthy();
    expect(screen.getByText('MAERSK, MSC')).toBeTruthy();
    // The narration row, not only the line it came from in the table.
    expect(screen.getByText('Paid to Maersk and MSC by cheque 1001')).toBeTruthy();
    expect(screen.getAllByText('1,250.50')).toHaveLength(3);           // the bank line and both totals
    expect(screen.getByText('0.50')).toBeTruthy();                     // was printed as "0"
    expect(screen.getByText('One Thousand Two Hundred Fifty only')).toBeTruthy();
  });
});

/**
 * Under the invoice print's Total Amount: Received (Paid on a bill), then
 * Adjustment, then Balance - as Climax printed them (ACS-JI-1386/26:
 * 2,928,105.00 / 2,752,419.00 / 0.00 / 175,686.00).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { settlementLines } from 'functions/invoiceSettlementLines';
import InvoicePrint from '../Components/Shared/InvoicePrint';
import { calculateTotal } from '../Components/Shared/invoicePrintDefaults';

jest.mock('functions/companyBranding', () => ({
  getCompany: () => null,
  bankAccountFields: () => [],
}));

describe('the lines', () => {
  test('an invoice: Received, Adjustment, Balance', () => {
    expect(settlementLines({ payType: 'Recievable', recieved: '2752419', paid: '0' }, 2928105)).toEqual([
      { label: 'Received', value: 2752419 },
      { label: 'Adjustment', value: 0 },
      { label: 'Balance', value: 175686 },
    ]);
  });

  test('a bill: Paid', () => {
    expect(settlementLines({ payType: 'Payble', paid: '14844', recieved: '0' }, 26622)[0]).toEqual({ label: 'Paid', value: 14844 });
  });

  test('what adjustment vouchers settled is shown apart from what was received', () => {
    // JI-76/25: 66,470 settled against 65,470, 1,220 of it by an ADJ-R.
    expect(settlementLines({ payType: 'Recievable', recieved: '66470', adjustment: 1220 }, 65470)).toEqual([
      { label: 'Received', value: 65250 },
      { label: 'Adjustment', value: 1220 },
      { label: 'Balance', value: -1000 },
    ]);
  });

  test('nothing settled: the whole total is the balance', () => {
    expect(settlementLines({ payType: 'Recievable' }, 1235).map((l) => l.value)).toEqual([0, 0, 1235]);
  });
});

describe('on the print', () => {
  const freight = {
    invoice_No: 'ACS-JI-1386/26', type: 'Job Invoice', payType: 'Recievable', operation: 'AE', currency: 'PKR',
    createdAt: '2026-04-15T10:00:00Z', ex_rate: '1', roundOff: '0', recieved: '2752419', paid: '0', party_Name: 'AIR BLUE LTD',
    approved: '1', SE_Job: { Client: {}, shipper: {}, consignee: {}, SE_Equipments: [] },
  };
  const records = [
    { type: 'Recievable', partyType: 'client', particular: 'AIR FREIGHT', qty: 1, rate_charge: 10245, currency: 'USD',
      amount: 1, discount: 0, local_amount: 2858355, net_amount: 10245, ex_rate: 279, pp_cc: 'PP' },
    { type: 'Recievable', partyType: 'client', particular: 'SERVICE CHARG', qty: 1, rate_charge: 250, currency: 'USD',
      amount: 1, discount: 0, local_amount: 69750, net_amount: 250, ex_rate: 279, pp_cc: 'PP' },
  ];
  // The totals box's labels - not the table's "Total Amount" column heading.
  const label = (text) => [...document.querySelectorAll('b')].find((b) => b.textContent.trim() === text);
  const labelsAfterTotal = () => {
    const box = label('Total Amount').closest('[class*="col"]');
    return [...box.querySelectorAll('b')].map((b) => b.textContent.trim());
  };
  const valueOf = (text) => label(text).parentElement.querySelector('span').textContent;

  test('a freight invoice: Received, Adjustment and Balance under Total Amount', () => {
    render(<InvoicePrint invoice={freight} records={records} calculateTotal={calculateTotal} />);
    expect(labelsAfterTotal()).toEqual(['Invoice Total (PKR)', 'Round Off', 'Total Amount', 'Received', 'Adjustment', 'Balance']);
    expect(valueOf('Total Amount')).toBe('2,928,105.00');
    expect(valueOf('Received')).toBe('2,752,419.00');
    expect(valueOf('Adjustment')).toBe('0.00');
    expect(valueOf('Balance')).toBe('175,686.00');
  });

  test('Hide Balance leaves the three lines off', () => {
    render(<InvoicePrint invoice={freight} records={records} calculateTotal={calculateTotal} hideBalance />);
    expect(label('Total Amount')).toBeTruthy();
    for (const t of ['Received', 'Adjustment', 'Balance']) expect(label(t)).toBeUndefined();
  });

  test('the sign line prints - unless Hide Sign Line', () => {
    const { unmount } = render(<InvoicePrint invoice={freight} records={records} calculateTotal={calculateTotal} company={{ title: 'AIR CARGO SERVICES' }} />);
    expect(document.querySelector('.invoice-sign-line').textContent).toContain('AIR CARGO SERVICES');
    unmount();
    render(<InvoicePrint invoice={freight} records={records} calculateTotal={calculateTotal} company={{ title: 'AIR CARGO SERVICES' }} hideSignLine />);
    expect(document.querySelector('.invoice-sign-line')).toBeNull();
    expect(screen.queryByText('__________________________')).toBeNull();
  });

  test('a bill says Paid', () => {
    render(<InvoicePrint invoice={{ ...freight, type: 'Job Bill', payType: 'Payble', recieved: '0', paid: '1000000' }}
      records={records.map((r) => ({ ...r, type: 'Payble', partyType: 'vendor' }))} calculateTotal={calculateTotal} />);
    expect(valueOf('Paid')).toBe('1,000,000.00');
    expect(screen.queryByText('Received')).toBeNull();
  });

  test('a rounded customs invoice states its round off and the total it comes to', () => {
    const customs = {
      ...freight, operation: 'CC', roundOff: '+0.44', recieved: '0',
      customsJob: { jobNo: 'TP-1/27', gdNumber: '1' }, SE_Job: null,
    };
    render(<InvoicePrint invoice={customs} calculateTotal={calculateTotal} records={[
      { type: 'Recievable', CustomsJobId: 7, partyType: 'client', particular: 'OTHER CHARGES', qty: 1, rate_charge: 1234.56,
        currency: 'PKR', amount: 1234.56, discount: 0, tax_amount: 0, local_amount: 1234.56, ex_rate: 1 },
    ]} />);
    expect(screen.getByText('Round Off :').closest('tr').textContent).toContain('+0.44');
    expect(screen.getByText('Total Amount :').closest('tr').textContent).toContain('1,235.00');
    // The customs form keeps nothing under its table.
    expect(screen.queryByText(/Received|Balance/)).toBeNull();
  });
});

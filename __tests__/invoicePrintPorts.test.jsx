/**
 * The ports and the vessel on the invoice print (Shared/InvoicePrint) -
 * SNS-JI-566/27 printed "SanshuiCNSJQ", "Karac" and "YM EXPRESS / 097E /".
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { placeName } from 'functions/placeName';
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

describe('a place name for a print', () => {
  const list = [
    { id: 'CNSJQ', name: 'Sanshui (CNSJQ)' },
    { id: 'PKKHI', name: 'Karachi' },
    { id: 'EGPSE', name: 'Port Said (East) (EGPSE)' },
  ];

  test('drops the code the list appends, and only that', () => {
    expect(placeName(list, 'CNSJQ')).toBe('Sanshui');
    expect(placeName(list, 'PKKHI')).toBe('Karachi');
    expect(placeName(list, 'EGPSE')).toBe('Port Said (East)');
  });

  test('a value not in the list prints as it is; nothing prints nothing', () => {
    expect(placeName(list, 'QICT')).toBe('QICT');
    expect(placeName(list, '')).toBe('');
    expect(placeName(list, null)).toBe('');
  });
});

describe('the invoice print', () => {
  const invoice = {
    invoice_No: 'SNS-JI-566/27', type: 'Job Invoice', payType: 'Recievable', operation: 'SE', currency: 'PKR',
    createdAt: '2026-10-01T10:00:00Z', ex_rate: '1', roundOff: '0', recieved: '0', paid: '0', approved: '1', party_Name: 'SOORTY',
    SE_Job: {
      Client: {}, shipper: {}, consignee: {}, SE_Equipments: [],
      pol: 'PKKHI', pod: 'CNSJQ', fd: 'CNSJQ', vessel: { name: 'YM EXPRESS' }, Voyage: { voyage: '097E' },
    },
  };
  const records = [{ type: 'Recievable', partyType: 'client', particular: 'FREIGHT', qty: 1, rate_charge: 100,
    currency: 'PKR', amount: 1, discount: 0, local_amount: 100, net_amount: 100, ex_rate: 1, pp_cc: 'PP' }];
  const under = (heading) => screen.getByText(heading).nextSibling.textContent.trim();

  test('names the ports without their codes, and the sea invoice\'s vessel without an airline', () => {
    render(<InvoicePrint invoice={invoice} records={records} calculateTotal={calculateTotal} />);
    expect(under('Port of Loading')).toBe('Karachi');
    expect(under('Port of Discharge')).toBe('Sanshui');
    expect(under('Destination Port')).toBe('Sanshui');
    expect(under('Vessel / Voyage')).toBe('YM EXPRESS / 097E');
    expect(under('Shipping Line')).toBe('YM EXPRESS / 097E');
  });

  // SNS-JI-612/27: Sihanoukville is in Setup > Ports, not the built-in list.
  test("takes Setup's names, sent with the invoice, over the built-in list - not the code", () => {
    const job = { ...invoice.SE_Job, pol: 'PKKHI', pod: 'KHSIH', fd: 'KHSIH' };
    render(<InvoicePrint invoice={{ ...invoice, SE_Job: job, placeNames: { KHSIH: 'SIHANOUKVILLE', PKKHI: 'KARACHI,PAKISTAN' } }}
      records={records} calculateTotal={calculateTotal} />);
    expect(under('Port of Loading')).toBe('KARACHI,PAKISTAN');
    expect(under('Port of Discharge')).toBe('SIHANOUKVILLE');
    expect(under('Destination Port')).toBe('SIHANOUKVILLE');
  });
});

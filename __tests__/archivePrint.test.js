/**
 * The Archive (old Climax books) on Odyssey's own prints - functions/archivePrint. An old
 * invoice must print the total Climax recorded, through the same helpers the
 * customs invoice print adds up with; a voucher must keep its sides and
 * amounts and say what kind of voucher it is.
 */
import ExcelJS from 'exceljs';
import { archiveInvoicePrint, archiveVoucherPrint } from '../functions/archivePrint';
import { calculateTotal } from '../Components/Shared/invoicePrintDefaults';
import { isSaleTaxLine, saleTaxFigures } from '../functions/saleTaxInvoice';
import { voucherTitle, voucherTotals, counterparty } from '../functions/voucherPrint';
import { buildLedgerWorkbook, buildTrialBalanceWorkbook } from '../functions/archiveExcel';

// JI-099703 in the 2016 book, as the archive sends it: two taxed service
// lines and two pass-through expenses; Net = lines + tax.
const invoice = {
  side: 'invoice',
  id: 99703,
  number: 'JI-099703',
  date: '2024-08-31',
  kind: 'Invoice',
  party: { name: 'AFROZE TEXTILE INDUSTRIES', address: 'KORANGI', ntn: '0712345-6', strn: '' },
  remarks: 'AS PER ANNEXURE',
  total: 2700,
  tax: 250,
  net: 2950,
  gstNo: 'G-123',
  job: {
    id: 100432, jobNo: 'JL-100432', jobDate: '2024-08-29', gdNo: '38136', mbl: 'MBL1', direction: 'Export', mode: 'Sea',
    packages: '718', packageType: 'CARTONS', goodsDescription: 'TOWELS',
    parties: { terminal: 'KICT', shipper: { name: 'AFROZE TEXTILE INDUSTRIES', address: 'KORANGI' } },
  },
  lines: [
    { rowId: 1, charge: 'AGENCY', remarks: '', vehicle: '', qty: 1, rate: 1000, amount: 1000, taxPerc: 15, tax: 150 },
    { rowId: 2, charge: 'DOCUMENTATION', remarks: '', vehicle: '', qty: 1, rate: 666.67, amount: 666.67, taxPerc: 15, tax: 100 },
    { rowId: 3, charge: 'KICT CHARGES', remarks: 'RECEIPT 55', vehicle: 'TKA-123', qty: 1, rate: 700, amount: 700, taxPerc: 0, tax: 0 },
    { rowId: 4, charge: 'TRANSPORT', remarks: '', vehicle: '', qty: 1, rate: 333.33, amount: 333.33, taxPerc: 0, tax: 0 },
  ],
};

describe('an archive invoice on the customs invoice print', () => {
  const { invoice: inv, records } = archiveInvoicePrint(invoice);

  it('is a customs document, approved, in rupees', () => {
    expect(inv).toMatchObject({ operation: 'LG', approved: '1', currency: 'PKR', payType: 'Recievable', type: 'Job Invoice' });
    expect(inv.customsJob).toMatchObject({ jobNo: 'JL-100432', gdNumber: '38136', jobType: 'Export Sea', terminal: 'KICT', packages: '718', pkgUnit: 'CARTONS' });
    expect(inv.recipient).toEqual({ name: 'AFROZE TEXTILE INDUSTRIES', address1: 'KORANGI', ntn: '0712345-6' });
    expect(inv.Sales_Tax_Invoice).toEqual({ taxInvoiceNo: 'G-123' });
  });

  it('splits the taxed lines into Service Charges, as the print does', () => {
    expect(records.filter(isSaleTaxLine).map((r) => r.particular)).toEqual(['AGENCY', 'DOCUMENTATION']);
    const st = saleTaxFigures(records);
    expect(st.serviceCharges).toBe(1666.67);
    expect(st.saleTax).toBe(250);
    expect(st.rate).toBe(15);
  });

  it('prints the net Climax recorded, with no round off', () => {
    const expenses = records.filter((r) => !isSaleTaxLine(r));
    const st = saleTaxFigures(records);
    const printed = Math.round((parseFloat(calculateTotal(expenses, false)) + st.serviceCharges + st.saleTax) * 100) / 100;
    expect(printed).toBe(2950);
    expect(inv.roundOff).toBe(0);
  });

  it('puts the vehicle with the remarks', () => {
    expect(records[2].description).toBe('RECEIPT 55 - TKA-123');
  });

  it('carries a Climax total that differs from its lines as the round off', () => {
    const { invoice: odd } = archiveInvoicePrint({ ...invoice, net: 2950.4 });
    expect(odd.roundOff).toBe(0.4);
  });

  it('prints a bill as payable, its kind as the title', () => {
    const { invoice: bill, records: lines } = archiveInvoicePrint({
      ...invoice, side: 'bill', kind: 'Direct Expense', tax: 0, net: 2700,
      lines: invoice.lines.map((l) => ({ ...l, tax: 0, taxPerc: 0 })),
    });
    expect(bill).toMatchObject({ payType: 'Payble', type: 'Direct Expense' });
    expect(lines.every((l) => l.type === 'Payble' && !isSaleTaxLine(l))).toBe(true);
    expect(calculateTotal(lines, false)).toBe('2700.00');
  });
});

describe('an archive voucher on the voucher print', () => {
  const voucher = {
    tranNo: '161700009619', voucherNo: 'CPV-000807', date: '2016-08-30', type: 'CPV',
    headAccount: { id: 7, name: 'CASH IN HAND' }, chequeNo: '', narration: 'PAID TO MR TAHIR IOU',
    payTo: '', receivedBy: 'TAHIR', refNo: '',
    lines: [
      { accountId: 900, accountName: 'IOU - TAHIR', debit: 785746, credit: 0, narration: 'IOU', costCentre: 'KHI' },
      { accountId: 7, accountName: 'CASH IN HAND', debit: 0, credit: 785746, narration: '', costCentre: 'KHI' },
    ],
  };
  const v = archiveVoucherPrint(voucher);

  it('keeps each line\'s side and amount', () => {
    expect(voucherTotals(v)).toEqual({ debit: 785746, credit: 785746 });
    expect(v.Voucher_Heads.map((h) => h.type)).toEqual(['debit', 'credit']);
  });

  it('marks the cash book as the pay account, so the print names who was paid', () => {
    expect(v.Voucher_Heads[1].accountType).toBe('payAccount');
    expect(counterparty(v)).toEqual({ label: 'Pay to', value: 'TAHIR' });
  });

  it('names a Climax-only type, and leaves Odyssey\'s own titles alone', () => {
    expect(voucherTitle(archiveVoucherPrint({ ...voucher, type: 'DN' }))).toBe('Debit Note');
    expect(voucherTitle(v)).toBe('Cash Payment Voucher');
    expect(voucherTitle({ vType: 'JV' })).toBe('General Voucher');
  });

  it('uses the one cost centre the lines share', () => {
    expect(v.costCenter).toBe('KHI');
    expect(archiveVoucherPrint({ ...voucher, lines: [{ ...voucher.lines[0], costCentre: 'LHE' }, voucher.lines[1]] }).costCenter).toBe('');
  });
});

describe('the archive Excel exports', () => {
  it('lays a ledger out with its opening, lines and closing', () => {
    const ws = buildLedgerWorkbook(ExcelJS, {
      company: 'CARGO LINKERS', address: 'KARACHI', bookLabel: '2016 - Aug 2024',
      ledger: {
        account: { code: '1101', name: 'BANK AL FALAH' }, from: '2016-01-01', to: '2016-12-31', opening: 100,
        rows: [{ date: '2016-02-01', voucherNo: 'BRV-1', type: 'BRV', chequeNo: '', narration: 'X', jobNo: '', debit: 50, credit: 0, balance: 150 }],
        totals: { debit: 50, credit: 0 }, closing: 150,
      },
    }).worksheets[0];
    const values = [];
    ws.eachRow((r) => values.push(r.values.filter((x) => x !== undefined && x !== null && x !== '')));
    expect(values.some((r) => r.includes('Opening balance') && r.includes(100))).toBe(true);
    expect(values.some((r) => r.includes('01-02-2016') && r.includes('BRV-1') && r.includes(150))).toBe(true);
    expect(values[values.length - 1]).toEqual(['Total', 50, 0, 150]);
  });

  it('puts a trial balance\'s figures on their Dr or Cr side', () => {
    const ws = buildTrialBalanceWorkbook(ExcelJS, {
      company: 'CARGO LINKERS', address: '', bookLabel: '2012 - 2015',
      tb: { from: '2015-07-01', to: '2015-12-31', totals: { opening: 0, debit: 10, credit: 10 } },
      rows: [{ code: '1', name: 'ASSETS', level: 1, isGroup: true, opening: -5, debit: 10, credit: 0, closing: 5 }],
    }).worksheets[0];
    const values = [];
    ws.eachRow((r) => values.push(r.values));
    const assets = values.find((r) => r[1] === '1');
    expect(assets.slice(1)).toEqual(['1', 'ASSETS', undefined, 5, 10, undefined, 5, undefined]);
  });
});

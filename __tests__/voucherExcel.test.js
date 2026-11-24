/**
 * A voucher as an Excel sheet - functions/voucherExcel (the user, 2026-11-10:
 * like the invoice's, laid out as the print). Each figure and label is checked
 * against what Voucher/Print shows for the same voucher, read through the same
 * helpers (functions/voucherPrint).
 */
import ExcelJS from 'exceljs';
import {
  buildVoucherWorkbook, voucherExcelName, VOUCHER_COLUMN_WIDTHS,
} from '../functions/voucherExcel';
import { voucherTitle, costCentre } from '../functions/voucherPrint';

const company = {
  title: 'SEA NET SHIPPING & LOGISTICS',
  address: 'PLOT NO. A-230, BLOCK 2, P.E.C.H.S, KARACHI',
  phone: '9221 34395444', email: 'info@seanetpk.com', web: 'www.seanetpk.com', ntn: '8271203-5',
};

// Saved by the voucher screen: the party lines first, the bank line last.
const bpv = {
  voucher_Id: 'SNS-BPV-12/27', vType: 'BPV', chequeNo: '1001', costCenter: 'KHI',
  createdAt: '2026-09-28T05:00:00.000Z', chequeDate: '2026-09-30T05:00:00.000Z',
  Voucher_Heads: [
    { type: 'debit', amount: '1250', accountType: 'partyAccount', narration: 'Freight JB-11', Child_Account: { title: 'MAERSK' } },
    { type: 'debit', amount: '0.5', accountType: 'partyAccount', narration: '', Child_Account: { title: 'MSC' } },
    { type: 'credit', amount: '1250.5', accountType: 'payAccount', narration: 'Paid to Maersk and MSC by cheque 1001', Child_Account: { title: 'HBL CURRENT' } },
  ],
};

const build = (over = {}) => buildVoucherWorkbook(ExcelJS, {
  voucher: bpv, company, logo: null, printedBy: 'bilal', printedAt: new Date(2026, 10, 10, 14, 5), ...over,
}).worksheets[0];

// Every master cell's value - a merged block counts once.
const cells = (ws) => {
  const out = [];
  ws.eachRow((row, r) => row.eachCell((cell) => {
    if (cell.isMerged && cell.master.address !== cell.address) return;
    const v = cell.value;
    const text = v && v.richText ? v.richText.map((t) => t.text).join('') : v;
    if (text !== null && text !== '') out.push({ r, address: cell.address, value: text, cell });
  }));
  return out;
};
const find = (ws, value) => cells(ws).find((c) => c.value === value);
const rightOf = (ws, label) => {
  const at = find(ws, label);
  return cells(ws).find((c) => c.r === at.r && c.cell.col > at.cell.col)?.value;
};

describe('laid out as the print', () => {
  test('A4 portrait, one page wide, on 24 equal columns', () => {
    const ws = build();
    expect(ws.pageSetup).toMatchObject({ paperSize: 9, orientation: 'portrait', fitToWidth: 1 });
    expect(VOUCHER_COLUMN_WIDTHS).toHaveLength(24);
    expect(ws.columns.map((c) => c.width)).toEqual(VOUCHER_COLUMN_WIDTHS);
  });

  test('the letterhead: the company\'s name and lines, in the right two thirds; blank ones left out', () => {
    const ws = build({ company: { ...company, email: '', web: '' } });
    const name = find(ws, company.title);
    expect(name.cell.font).toMatchObject({ bold: true, size: 15 });
    expect(name.cell.address).toBe('I1');
    expect(find(ws, 'Tel: 9221 34395444')).toBeTruthy();
    expect(find(ws, 'NTN # 8271203-5')).toBeTruthy();
    expect(cells(ws).some((c) => /Email|Web/.test(String(c.value)))).toBe(false);
  });

  test('the title the print has, centred between two rules', () => {
    const ws = build();
    const title = find(ws, 'Bank Payment Voucher');
    expect(title.cell.alignment.horizontal).toBe('center');
    expect(voucherTitle({ vType: 'BRV' })).toBe('Bank Recieve Voucher');   // word for word as it prints
    expect(voucherTitle({ vType: 'ADJ-R' })).toBe('Undefined Type');
  });

  test('voucher #, its date (not the cheque\'s), the cheque and its date', () => {
    const ws = build();
    expect(rightOf(ws, 'Voucher #:')).toBe('SNS-BPV-12/27');
    expect(rightOf(ws, 'Date:')).toBe('28-09-2026');
    expect(rightOf(ws, 'Cheque No:')).toBe('1001');
    expect(rightOf(ws, 'Cheque Date:')).toBe('30-09-2026');
  });

  test('Pay to and Narration as the print reads them', () => {
    const ws = build();
    expect(rightOf(ws, 'Pay to:')).toBe('MAERSK, MSC');
    expect(rightOf(ws, 'Narration:')).toBe('Paid to Maersk and MSC by cheque 1001');
    // A journal has no counterparty, so no Pay to row - as on the print.
    const jv = build({ voucher: { ...bpv, vType: 'JV' } });
    expect(find(jv, 'Pay to:')).toBeUndefined();
    expect(find(jv, 'Received from:')).toBeUndefined();
  });
});

describe('the lines', () => {
  const lineRows = (ws) => {
    const head = find(ws, 'Head of Account');
    return cells(ws).filter((c) => c.r > head.r && c.cell.col === 1 && typeof c.value === 'number')
      .map((c) => cells(ws).filter((x) => x.r === c.r).map((x) => x.value));
  };

  test('code, account with its narration under it, cost centre, debit or credit - figures as numbers', () => {
    const ws = build();
    expect(lineRows(ws)).toEqual([
      [1, 'MAERSK\n( Freight JB-11 )', 'KHI', 1250],
      [2, 'MSC', 'KHI', 0.5],
      [3, 'HBL CURRENT\n( Paid to Maersk and MSC by cheque 1001 )', 'KHI', 1250.5],
    ]);
    const first = find(ws, 'MAERSK\n( Freight JB-11 )');
    expect(first.cell.value.richText[1].font.color.argb).toBe('FF808080');   // grey, as printed
    const debit = cells(ws).find((c) => c.value === 1250);
    expect(debit.cell.numFmt).toBe('#,##0.00 ;(#,##0.00)');
    // The credit sits in the Credit column, not the Debit one.
    const credit = cells(ws).find((c) => c.value === 1250.5 && c.r === first.r + 2);
    expect(credit.cell.address).toMatch(/^U/);
  });

  test('the total row and the amount in words', () => {
    const ws = build();
    const total = find(ws, 'Total');
    expect(cells(ws).filter((c) => c.r === total.r).map((c) => c.value)).toEqual(['Total', 1250.5, 1250.5]);
    expect(rightOf(ws, 'Total amount in words :')).toMatch(/^One Thousand Two Hundred Fifty/);
  });

  test('the voucher\'s own cost centre - KHI when it has none', () => {
    expect(costCentre({ costCenter: 'LHE' })).toBe('LHE');
    expect(costCentre({})).toBe('KHI');
    const ws = build({ voucher: { ...bpv, costCenter: 'LHE' } });
    expect(cells(ws).filter((c) => c.value === 'LHE')).toHaveLength(3);
  });
});

test('the four signature lines, and printed on / by', () => {
  const ws = build();
  ['Prepared by', 'Checked by', 'Approved by', 'Received by'].forEach((name) => {
    const at = find(ws, name);
    expect(at.cell.alignment.horizontal).toBe('center');
    // The line is the row above, ruled along the bottom.
    expect(ws.getCell(at.r - 1, at.cell.col).border?.bottom?.style).toBe('thin');
  });
  expect(find(ws, 'Printed on : 10/11/2026 at 14:05')).toBeTruthy();
  expect(find(ws, 'Printed by :bilal')).toBeTruthy();
});

test('a logo goes in, kept in the first third', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const wb = buildVoucherWorkbook(ExcelJS, { voucher: bpv, company, logo: { base64: png, extension: 'png', width: 200, height: 100 } });
  const images = wb.worksheets[0].getImages();
  expect(images).toHaveLength(1);
  expect(images[0].range.tl.nativeCol).toBeLessThan(8);
});

test('the file is named after the voucher', () => {
  expect(voucherExcelName(bpv)).toBe('SNS-BPV-12-27.xlsx');
  expect(voucherExcelName({})).toBe('Voucher.xlsx');
});

test('it writes a real file', async () => {
  const buffer = await buildVoucherWorkbook(ExcelJS, { voucher: bpv, company }).xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buffer);
  expect(back.worksheets[0].name).toBe('SNS-BPV-12-27');
});

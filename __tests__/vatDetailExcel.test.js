/**
 * The VAT Detail as an Excel sheet - functions/vatDetailExcel. Laid out as
 * Climax's own export: the company, "VAT Detail", the period, a grey two-row
 * heading, a bordered row per document, and (where Climax left an empty row)
 * the total.
 */
import ExcelJS from 'exceljs';
import { buildVatDetailWorkbook, VAT_COLUMNS, returnDate, vatDetailFileName } from '../functions/vatDetailExcel';

const report = {
  from: '2026-09-01', to: '2026-09-30',
  rows: [
    { sr: 1, ntn: '', cnic: '', buyer: 'AZTA TEXTILE', district: 'KARACHI CITY', buyerType: '', documentType: 'SI', documentNo: 'CL-24159', date: '2026-09-18', hsCode: '', saleType: 'Services', rate: 15, value: 2500, tax: 375, withheld: 0 },
    { sr: 2, ntn: '0704059-8', cnic: '', buyer: 'PROLINE (PVT) LTD', district: 'KARACHI,PAKISTAN', buyerType: '', documentType: 'SI', documentNo: 'CL-23869', date: '2026-09-02', hsCode: '520512', saleType: 'Services', rate: 15, value: 1750, tax: 263, withheld: 0 },
  ],
  totals: { value: 4250, tax: 638, withheld: 0 },
};

const sheet = () => buildVatDetailWorkbook(ExcelJS, { report, company: 'CARGO LINKERS.', address: 'PLOT NO. A-230, KARACHI' }).worksheets[0];

test('the heading: company, address, title and the period as Climax wrote it', () => {
  const ws = sheet();
  expect(ws.getCell('A1').value).toBe('CARGO LINKERS.');
  expect(ws.getCell('A2').value).toBe('PLOT NO. A-230, KARACHI');
  expect(ws.getCell('A3').value).toBe('VAT Detail');
  expect(ws.getCell('A4').value).toBe('From Date = 01-Sep-2026 Till Date = 30-Sep-2026');
  expect(ws.model.merges).toEqual(expect.arrayContaining(['A1:O1', 'A3:O3', 'A6:A7', 'M6:M7']));
});

test('the fifteen columns, grey, with the reference file\'s widths', () => {
  const ws = sheet();
  expect(VAT_COLUMNS.map((c) => ws.getCell(6, VAT_COLUMNS.indexOf(c) + 1).value)).toEqual([
    'Sr #', 'NTN', 'CNIC', 'Name of Buyer', 'District of Buyer', 'Buyer Type', 'Document Type', 'Document Number',
    'Document Date', 'HS Code', 'Sale Type', 'Rate', 'Value of Sales Excluding Sales Tax', 'Sales Tax Involved', 'ST Withheld at Source',
  ]);
  expect(ws.getCell('A6').fill.fgColor.argb).toBe('FFC0C0C0');
  expect(ws.columns.map((c) => c.width)).toEqual([7.94, 11.11, 11.11, 23.81, 16, 11.11, 15.87, 15.87, 15.87, 11.11, 11.11, 11.11, 23.81, 23.81, 23.81]);
});

test('a row per document: figures as numbers, the date as DD-MM-YYYY', () => {
  const ws = sheet();
  const row = ws.getRow(9).values.slice(1);
  expect(row).toEqual([2, '0704059-8', '', 'PROLINE (PVT) LTD', 'KARACHI,PAKISTAN', '', 'SI', 'CL-23869', '02-09-2026', '520512', 'Services', 15, 1750, 263, 0]);
  expect(ws.getCell('N9').numFmt).toBe('#,##0');
  expect(ws.getCell('N9').border.left.style).toBe('thin');
});

test('the total: the money columns as SUMs, carrying their figures', () => {
  const ws = sheet();
  expect(ws.getCell('A10').value).toBe('Total');
  expect(ws.getCell('M10').value).toEqual({ formula: 'SUM(M8:M9)', result: 4250 });
  expect(ws.getCell('N10').value).toEqual({ formula: 'SUM(N8:N9)', result: 638 });
});

test('the heading repeats on every printed page', () => {
  expect(sheet().pageSetup.printTitlesRow).toBe('6:7');
});

test('it writes, and is named for its period', async () => {
  const buffer = await buildVatDetailWorkbook(ExcelJS, { report }).xlsx.writeBuffer();
  expect(buffer.byteLength).toBeGreaterThan(1000);
  expect(vatDetailFileName(report)).toBe('VAT Detail 01-09-2026 to 30-09-2026.xlsx');
  expect(returnDate('2026-09-18')).toBe('18-09-2026');
});

test('an empty period still makes a sheet, with a nil total', () => {
  const ws = buildVatDetailWorkbook(ExcelJS, { report: { ...report, rows: [], totals: { value: 0, tax: 0, withheld: 0 } } }).worksheets[0];
  expect(ws.getCell('A8').value).toBe('Total');
  expect(ws.getCell('N8').value).toBe(0);
});

describe('the columns picked', () => {
  const picked = ['sr', 'buyer', 'documentNo', 'value', 'tax'];
  const ws = () => buildVatDetailWorkbook(ExcelJS, { report, company: 'CARGO LINKERS.', columns: picked }).worksheets[0];

  test('only those, in that order, the banners across them', () => {
    const s = ws();
    expect([1, 2, 3, 4, 5].map((c) => s.getCell(6, c).value)).toEqual([
      'Sr #', 'Name of Buyer', 'Document Number', 'Value of Sales Excluding Sales Tax', 'Sales Tax Involved',
    ]);
    expect(s.getCell(6, 6).value).toBeNull();
    expect(s.model.merges).toEqual(expect.arrayContaining(['A1:E1', 'A4:E4']));
    expect(s.getRow(9).values.slice(1)).toEqual([2, 'PROLINE (PVT) LTD', 'CL-23869', 1750, 263]);
  });

  test('the total under the money columns, "Total" across those before them', () => {
    const s = ws();
    expect(s.getCell('A10').value).toBe('Total');
    expect(s.model.merges).toEqual(expect.arrayContaining(['A10:C10']));
    expect(s.getCell('D10').value).toEqual({ formula: 'SUM(D8:D9)', result: 4250 });
    expect(s.getCell('E10').value).toEqual({ formula: 'SUM(E8:E9)', result: 638 });
  });
});

describe('the logo', () => {
  // A 2 x 1 PNG.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEIGGEMAB3iA/3D1E8pAAAAAElFTkSuQmCC';

  test('top left, its own shape kept, when the company has one', () => {
    const s = buildVatDetailWorkbook(ExcelJS, { report, logo: { base64: png, extension: 'png', width: 200, height: 100 } }).worksheets[0];
    const [img] = s.getImages();
    expect(img).toBeTruthy();
    expect(img.range.tl.nativeCol).toBe(0);
    expect(img.range.tl.nativeRow).toBe(0);
    expect(img.range.ext).toEqual({ width: 144, height: 72 });
  });

  test('none when it has none', () => {
    expect(buildVatDetailWorkbook(ExcelJS, { report }).worksheets[0].getImages()).toHaveLength(0);
  });
});

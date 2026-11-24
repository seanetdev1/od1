import moment from 'moment';
import { VAT_COLUMNS, vatColumn } from 'functions/vatDetailColumns';

export { VAT_COLUMNS };

/**
 * THE VAT DETAIL AS AN EXCEL SHEET - laid out as Climax exported it.
 *
 * Its own file was the reference: the company and its address centred over
 * the columns, "VAT Detail", the period as "From Date = 01-Sep-2026 Till
 * Date = 30-Sep-2026", a grey two-row heading, one bordered row per document,
 * the same column widths. The company's logo top left, which Climax's lacked.
 * Figures are numbers, so the sheet adds up and can be filtered; the document
 * date is DD-MM-YYYY text, as the return takes it. Below the last document, a
 * total of the money columns - the row Climax left empty.
 *
 * THE COLUMNS ARE THE ONES PICKED on the report (functions/vatDetailColumns),
 * in that order - all fifteen when none are named.
 *
 * Kept apart from the screen so it can be tested: buildVatDetailWorkbook takes
 * the ExcelJS module and returns the workbook.
 */

/** 'YYYY-MM-DD' -> 'DD-MM-YYYY', as the return and Climax write it. */
export const returnDate = (day) => (day ? moment(day, 'YYYY-MM-DD').format('DD-MM-YYYY') : '');

/** One cell's value, as the sheet, the screen and the print all show it. */
export const vatCellValue = (column, row) => {
  if (column.id === 'date') return returnDate(row.date);
  if (column.figure) return row[column.id] === null || row[column.id] === undefined ? null : Number(row[column.id]);
  return row[column.id] ?? '';
};

const THIN = { style: 'thin', color: { argb: 'FF000000' } };
const BOXED = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const letter = (n) => String.fromCharCode(64 + n);   // 1 -> 'A'; never past 15

/**
 * @param {Object}   ExcelJS    the exceljs module
 * @param {Object}   p
 * @param {Object}   p.report   the server's { rows, totals, from, to }
 * @param {string}   p.company  the company's name
 * @param {string}   p.address  its address
 * @param {string[]} p.columns  the column ids to carry, in order (default: all)
 * @param {Object}   p.logo     { base64|buffer, extension, width, height } or null
 */
export function buildVatDetailWorkbook(ExcelJS, { report, company = '', address = '', columns, logo = null }) {
  const cols = (columns && columns.length ? columns : VAT_COLUMNS.map((c) => c.id)).map(vatColumn).filter(Boolean);
  const LAST = letter(cols.length);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('VAT Detail', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: 7 }],
  });
  ws.columns = cols.map((c) => ({ width: c.width }));

  const banner = (r, value, font, height, border) => {
    ws.mergeCells(`A${r}:${LAST}${r}`);
    const cell = ws.getCell(`A${r}`);
    cell.value = value;
    cell.font = { name: 'Arial', ...font };
    cell.alignment = { horizontal: font.left ? 'left' : 'center', vertical: 'middle', wrapText: true };
    if (border) cell.border = BOXED;
    ws.getRow(r).height = height;
  };
  banner(1, company, { size: 14, bold: true, underline: true }, 24, true);
  banner(2, address, { size: 10, underline: true }, 15);
  banner(3, 'VAT Detail', { size: 12, bold: true, underline: true }, 20);
  const from = moment(report?.from, 'YYYY-MM-DD').format('DD-MMM-YYYY');
  const to = moment(report?.to, 'YYYY-MM-DD').format('DD-MMM-YYYY');
  banner(4, `From Date = ${from} Till Date = ${to}`, { size: 10, left: true }, 14.5, true);
  ws.getRow(5).height = 7.3;

  // The logo, top left over the company's name - its own shape kept, within
  // the three banner rows.
  if (logo) {
    const id = wb.addImage(logo.buffer
      ? { buffer: logo.buffer, extension: logo.extension }
      : { base64: logo.base64, extension: logo.extension });
    const maxW = 150;
    const maxH = 72;
    const scale = logo.width && logo.height ? Math.min(maxW / logo.width, maxH / logo.height) : null;
    ws.addImage(id, {
      tl: { col: 0.1, row: 0.1 },
      ext: scale ? { width: Math.round(logo.width * scale), height: Math.round(logo.height * scale) } : { width: maxW, height: maxH },
    });
  }

  // The heading: two rows tall, grey, as Climax's.
  cols.forEach((c, i) => {
    const col = letter(i + 1);
    ws.mergeCells(`${col}6:${col}7`);
    const cell = ws.getCell(`${col}6`);
    cell.value = c.heading;
    cell.font = { name: 'Arial', size: 10, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0C0C0' } };
    cell.border = BOXED;
    ws.getCell(`${col}7`).border = BOXED;
  });
  ws.getRow(6).height = 14;
  ws.getRow(7).height = 16.6;
  // A month runs to two dozen pages; each starts with the heading.
  ws.pageSetup.printTitlesRow = '6:7';

  const rows = report?.rows || [];
  rows.forEach((r) => {
    const row = ws.addRow(cols.map((c) => vatCellValue(c, r)));
    // No set height: a long buyer name wraps, and Excel grows the row to it.
    // Climax fixed every row at one line, so a wrapped name printed over the
    // row below.
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.font = { name: 'Arial', size: 9 };
      cell.border = BOXED;
      cell.alignment = { horizontal: c.figure ? 'right' : c.align || 'left', vertical: 'middle', wrapText: true };
      if (c.money) cell.numFmt = '#,##0';
    });
  });

  // The total of what is listed - the money columns shown, as SUMs, with
  // "Total" across the columns before the first of them.
  const first = 8;
  const last = 7 + rows.length;
  const total = ws.addRow([]);
  total.height = 18;
  const lead = cols.findIndex((c) => c.money);
  if (lead > 1) ws.mergeCells(`A${total.number}:${letter(lead)}${total.number}`);
  if (lead !== 0) {
    total.getCell(1).value = 'Total';
    total.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
  }
  cols.forEach((c, i) => {
    const cell = total.getCell(i + 1);
    cell.font = { name: 'Arial', size: 9, bold: true };
    cell.border = BOXED;
    if (c.money) {
      const col = letter(i + 1);
      cell.value = rows.length
        ? { formula: `SUM(${col}${first}:${col}${last})`, result: Number(report?.totals?.[c.id]) || 0 }
        : 0;
      cell.numFmt = '#,##0';
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
  });

  return wb;
}

/** The file name: VAT Detail and the period. */
export const vatDetailFileName = (report) =>
  `VAT Detail ${returnDate(report?.from)} to ${returnDate(report?.to)}.xlsx`;

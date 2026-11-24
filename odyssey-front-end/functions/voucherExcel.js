import moment from 'moment';
import numToWords from 'functions/numToWords';
import { sheetWriter, parseRange, logoForExcel, saveWorkbook } from 'functions/invoiceExcel';
import {
  voucherDate, chequeDate, voucherNarration, counterparty, voucherTotals, voucherTitle, costCentre,
} from 'functions/voucherPrint';

/**
 * A VOUCHER AS AN EXCEL SHEET, laid out as it PRINTS (Components/Layouts/
 * AccountsComp/Voucher/Print) - the user, 2026-11-10: "like the one we had for
 * invoices, it should look like the print" (functions/invoiceExcel).
 *
 * One A4 page on a grid of 24 equal columns, so the print's own divisions fall
 * on column edges: the letterhead's logo third and its name-and-address two
 * thirds; the title between two rules; Voucher # / Source No # / Date in
 * thirds; Pay to and Narration across; the lines - Code, Head of Account (the
 * line's narration under it, in grey), Cost Center, Debit, Credit - and their
 * Total; the amount in words; the four signature lines in quarters; Printed on
 * and Printed by.
 *
 * Everything in it comes from the helpers the print reads (functions/
 * voucherPrint), so the sheet and the paper cannot say different things.
 * Figures are numbers with a number format, so they add up in Excel.
 *
 * buildVoucherWorkbook takes the ExcelJS module and returns the workbook, so it
 * is tested without a browser; downloadVoucherExcel saves it.
 */

const COLS = 24;
const WIDTH = 4;                                  // each column; 96 across
export const VOUCHER_COLUMN_WIDTHS = Array(COLS).fill(WIDTH);

const MONEY = '#,##0.00 ;(#,##0.00)';
const LINE = 10.5;                                // points per line of 8pt text
const THIN = { style: 'thin', color: { argb: 'FF000000' } };
const GREY = { style: 'thin', color: { argb: 'FF808080' } };
const RULE = { style: 'thin', color: { argb: 'FFDEE2E6' } };   // the print's ruled boxes
const ALL = { top: THIN, left: THIN, bottom: THIN, right: THIN };

// To the paisa, as the print shows it. A line can hold 1.04e-13 (an exchange
// gain/loss on a voucher with none - ACS-BPV-375/27): it printed 0.00 but, kept
// as it is, would add a hair to any sum made of it in Excel.
const num = (x) => {
  const n = parseFloat(x);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

// How many lines a text takes in a block, wrapped. 8pt Arial capitals fit
// about 1.3 to a unit of width (measured on Excel's own PDF of a sheet); 1.2
// keeps a row from coming out short, and lower case fits more.
const CHARS_PER_UNIT = 1.2;
const linesIn = (text, range, r = 1) => {
  const { left, right } = parseRange(range, r);
  const across = Math.max(1, Math.floor((right - left + 1) * WIDTH * CHARS_PER_UNIT));
  return String(text ?? '').split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / across)), 0);
};

export function buildVoucherWorkbook(ExcelJS, {
  voucher, company, logo, printedBy = '', printedAt = new Date(),
}) {
  const v = voucher || {};
  const comp = company || {};
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(String(v.voucher_Id || 'Voucher').replace(/[\\/:*?[\]]+/g, '-').slice(0, 31), {
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.39, right: 0.39, top: 0.39, bottom: 0.39, header: 0, footer: 0 },
    },
  });
  ws.columns = VOUCHER_COLUMN_WIDTHS.map((width) => ({ width }));
  const { row, put, box, next } = sheetWriter(ws);
  const totals = voucherTotals(v);
  const heads = Array.isArray(v.Voucher_Heads) ? v.Voucher_Heads : [];

  // ---- Letterhead: the logo in the first third, the company in the rest -----
  const first = row(22);
  put('I:X', first, comp.title || '', { font: { size: 15 }, bold: true, align: 'center', valign: 'middle' });
  [
    comp.address,
    comp.phone && `Tel: ${comp.phone}`,
    [comp.email && `Email: ${comp.email}`, comp.web && `Web: ${comp.web}`].filter(Boolean).join('   '),
    comp.ntn && `NTN # ${comp.ntn}`,
    comp.strn && `STRN # ${comp.strn}`,
  ].filter(Boolean).forEach((text) => {
    const r = row();
    put('I:X', r, text, { align: 'center', valign: 'middle' });
    ws.getRow(r).height = linesIn(text, 'I:X') * LINE + 1;
  });
  if (logo) {
    const id = wb.addImage(logo.buffer
      ? { buffer: logo.buffer, extension: logo.extension }
      : { base64: logo.base64, extension: logo.extension });
    // Centred in A:H, its own shape kept, no taller than the print's 100px.
    const maxW = 170;
    const maxH = 75;
    const scale = logo.width && logo.height ? Math.min(maxW / logo.width, maxH / logo.height) : null;
    const w = scale ? Math.round(logo.width * scale) : maxW;
    const h = scale ? Math.round(logo.height * scale) : maxH;
    const thirdPx = 8 * WIDTH * 7;                // a width unit is about 7px
    ws.addImage(id, { tl: { col: Math.max(0, (thirdPx - w) / 2 / (WIDTH * 7)), row: 0.1 }, ext: { width: w, height: h } });
    // Room for it under the company's lines, when they are fewer than it is
    // tall (pixels are 3/4 of a point).
    let height = 0;
    for (let r = first; r < next(); r += 1) height += ws.getRow(r).height || 15;
    const need = h * 0.75 + 4;
    if (height < need) row(need - height);
  }
  row(8);

  // ---- The title between two rules ------------------------------------------
  const t1 = row(9);
  const t2 = row(9);
  box(`A${t1}:H${t1}`, t1, { bottom: GREY });
  box(`Q${t1}:X${t1}`, t1, { bottom: GREY });
  put(`I${t1}:P${t2}`, t1, voucherTitle(v), { font: { size: 13 }, bold: true, align: 'center', valign: 'middle' });
  row(8);

  // ---- Voucher #, Source No #, Date / Cheque No, Cheque Date ----------------
  const field = (r, labelCols, label, valueCols, value) => {
    put(labelCols, r, label, { bold: true, valign: 'bottom' });
    put(valueCols, r, value ?? '', { align: 'center', valign: 'bottom' });
    box(`${valueCols.split(':')[0]}${r}:${valueCols.split(':')[1]}${r}`, r, { bottom: RULE });
  };
  const f1 = row(LINE + 8);
  field(f1, 'A:C', 'Voucher #:', 'D:H', v.voucher_Id || '');
  field(f1, 'I:K', 'Source No #:', 'L:P', v.sourceNo || '');
  field(f1, 'Q:S', 'Date:', 'T:X', voucherDate(v));
  row(4);
  const f2 = row(LINE + 8);
  field(f2, 'A:C', 'Cheque No:', 'D:H', v.chequeNo || '');
  field(f2, 'Q:S', 'Cheque Date:', 'T:X', chequeDate(v));
  row(4);

  // ---- Pay to / Received from, Narration - ruled, wrapping -------------------
  const ruled = (label, value) => {
    const r = row();
    put('A:D', r, label, { bold: true, valign: 'bottom' });
    put('E:X', r, value || '', { valign: 'bottom' });
    box(`E${r}:X${r}`, r, { bottom: RULE });
    ws.getRow(r).height = linesIn(value, 'E:X') * LINE + 8;
    row(4);
  };
  const party = counterparty(v);
  if (party) ruled(`${party.label}:`, party.value);
  ruled('Narration:', voucherNarration(v));
  row(10);

  // ---- The lines --------------------------------------------------------------
  const CODE = 'A:B';
  const HEAD = 'C:M';
  const CENTRE = 'N:P';
  const DEBIT = 'Q:T';
  const CREDIT = 'U:X';
  const cell = (range, r, value, style = {}) => {
    put(range, r, value, style);
    box(`${range.split(':')[0]}${r}:${range.split(':')[1]}${r}`, r, ALL);
  };
  const th = row(LINE + 6);
  [[CODE, 'Code'], [HEAD, 'Head of Account'], [CENTRE, 'Cost Center'], [DEBIT, 'Debit'], [CREDIT, 'Credit']]
    .forEach(([range, text]) => cell(range, th, text, { bold: true, valign: 'middle' }));

  heads.forEach((h, i) => {
    const r = row();
    const title = String(h.Child_Account?.title || '');
    const narr = String(h.narration || '').trim();
    cell(CODE, r, i + 1);
    cell(HEAD, r, narr
      ? { richText: [
        { text: title, font: { name: 'Arial', size: 8 } },
        { text: `\n( ${narr} )`, font: { name: 'Arial', size: 8, color: { argb: 'FF808080' } } },
      ] }
      : title);
    cell(CENTRE, r, costCentre(v));
    cell(DEBIT, r, h.type === 'debit' ? num(h.amount) : '', { align: 'right', numFmt: MONEY });
    cell(CREDIT, r, h.type === 'credit' ? num(h.amount) : '', { align: 'right', numFmt: MONEY });
    ws.getRow(r).height = (linesIn(title, HEAD) + (narr ? linesIn(`( ${narr} )`, HEAD) : 0)) * LINE + 4;
  });

  const tr = row(LINE + 6);
  cell('A:P', tr, 'Total', { bold: true, align: 'right', valign: 'middle' });
  cell(DEBIT, tr, num(totals.debit), { bold: true, align: 'right', valign: 'middle', numFmt: MONEY });
  cell(CREDIT, tr, num(totals.credit), { bold: true, align: 'right', valign: 'middle', numFmt: MONEY });
  row(8);

  // ---- The amount in words ----------------------------------------------------
  const words = numToWords(totals.credit);
  const wr = row();
  put('A:F', wr, 'Total amount in words :', { valign: 'bottom' });
  put('G:X', wr, words, { valign: 'bottom' });
  box(`G${wr}:X${wr}`, wr, { bottom: RULE });
  ws.getRow(wr).height = linesIn(words, 'G:X') * LINE + 8;

  // ---- Signatures: a line in each quarter, its name under it -----------------
  row(30);
  row(30);
  const sl = row(LINE + 8);
  const sn = row(LINE + 4);
  [['B:E', 'Prepared by'], ['H:K', 'Checked by'], ['N:Q', 'Approved by'], ['T:W', 'Received by']]
    .forEach(([range, name]) => {
      const [a, b] = range.split(':');
      box(`${a}${sl}:${b}${sl}`, sl, { bottom: THIN });
      put(range, sn, name, { bold: true, align: 'center' });
    });

  // ---- Printed on / by --------------------------------------------------------
  row(20);
  const pr = row(LINE + 4);
  const at = moment(printedAt);
  put('A:L', pr, `Printed on : ${at.format('DD/MM/YYYY')} at ${at.format('HH:mm')}`);
  put('M:X', pr, `Printed by :${printedBy || ''}`, { align: 'right' });

  return wb;
}

/** The file name: the voucher number, with what a file name cannot hold replaced. */
export const voucherExcelName = (voucher) => `${String(voucher?.voucher_Id || 'Voucher').replace(/[\\/:*?"<>|]+/g, '-')}.xlsx`;

/** Builds the sheet and saves it. */
export async function downloadVoucherExcel({ voucher, company, printedBy, printedAt }) {
  const ExcelJS = (await import('exceljs')).default;
  const logo = await logoForExcel(company?.printLogo || company?.logo);
  const wb = buildVoucherWorkbook(ExcelJS, { voucher, company, logo, printedBy, printedAt });
  await saveWorkbook(wb, voucherExcelName(voucher));
}

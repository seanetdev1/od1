import moment from 'moment';
import ports from 'jsonData/ports';
import airports from 'jsonData/airports';
import inWords from 'functions/numToWords';
import { bankAccountFields } from 'functions/companyBranding';
import { calculateTotal } from 'Components/Shared/invoicePrintDefaults';
import { settlementLines } from 'functions/invoiceSettlementLines';
import { isSaleTaxLine, lineFigures, saleTaxFigures } from 'functions/saleTaxInvoice';
import { clientInvoiceNo, containerNumbers } from 'functions/customsJobReference';
import { hasNote } from 'functions/invoiceNote';
import { printCurrency, printsForeign, lineAmount } from './invoicePrintCurrency';

/**
 * AN INVOICE AS AN EXCEL SHEET - laid out as Climax exported one.
 *
 * The reference is Climax's own export of a job invoice (Crystal Reports to
 * Excel): one A4 page drawn on a grid of 35 narrow columns, every box a block
 * of merged cells - letterhead with the logo top left, the title between two
 * rules, the party and job boxes in two halves, the charges under a grey
 * heading, the totals on the right, then Note / In-Words and Bank Details.
 * The column widths below are that file's, so a box is as wide here as there.
 *
 * WHAT GOES IN IT is what the invoice PRINTS (Components/Shared/InvoicePrint),
 * read from the same invoice, lines and Printing Options: the freight boxes
 * (MAWB / MBL, flight / vessel, ports, weights) or, on a customs invoice, the
 * clearance ones (M/S, GD #, Client Invoice #...) - and the same totals,
 * worked out by the same helpers, so the sheet and the paper cannot disagree.
 * Figures are numbers with a number format, not text, so they add up in Excel.
 *
 * Kept apart from the screen so it can be tested: buildInvoiceWorkbook takes
 * the ExcelJS module and returns the workbook; downloadInvoiceExcel saves it.
 */

// A..AI, the reference file's widths - except that none is narrower than 0.5.
// Climax's had F, G, Q, R and AI at 0.07-0.09, which Excel rounds to no
// pixels at all and treats as HIDDEN: a border on a hidden column does not
// print, and R and AI carry the right-hand edge of every box (the reference
// itself prints with no right edge). Each takes the width it needs from its
// neighbour - E, P, AH - so the halves still divide at the start of S, and the
// title stays centred.
export const COLUMN_WIDTHS = [
  4.5, 10.18, 0.32, 4.5, 3.5, 0.5, 0.5, 4.18, 0.32, 6, 3, 3, 9, 1.5, 3, 2, 0.5, 0.5,
  2.68, 4.82, 3, 3.35, 1.15, 1.5, 4.5, 1.5, 6, 3, 3, 3, 4.5, 6.35, 7.15, 1, 0.5,
];

const MONEY = '#,##0.00 ;(#,##0.00)';
const LINE = 10.5;                       // points per line of 8pt text
const THIN = { style: 'thin', color: { argb: 'FF000000' } };
const MEDIUM = { style: 'medium', color: { argb: 'FF000000' } };
const FREIGHT_HEAD = 'FFC0C0C0';         // the reference's grey
const CUSTOMS_HEAD = 'FFF0F0F0';         // the customs print's lighter one

const SEA = ['SE', 'SI'];
const AGENT_TYPES = ['Agent Invoice', 'Agent Bill'];

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(v * 100) / 100;
const present = (x) => x !== null && x !== undefined && String(x).trim() !== '';
const day = (v) => (v && moment(v).isValid() ? moment(v).format('DD-MMM-YYYY') : '');

// "Karachi (PKKHI)" -> "Karachi": the name without its code, as the print has it.
const placeName = (list, id) => {
  if (!present(id)) return '';
  const hit = list.find((p) => p.id == id);   // eslint-disable-line eqeqeq
  return hit ? String(hit.name).replace(/\s*\([^)]*\)\s*$/, '') : '';
};
const port = (id) => placeName(ports.ports, id);
const airport = (id) => placeName(airports, id);

// ---- the grid ---------------------------------------------------------------

const colNo = (letters) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export const parseRange = (range, row) => {
  const [a, b = a] = range.split(':');
  const cell = (ref) => {
    const m = /^([A-Z]+)(\d+)?$/.exec(ref);
    return { col: colNo(m[1]), row: m[2] ? Number(m[2]) : row };
  };
  const s = cell(a);
  const e = cell(b);
  return { top: s.row, left: s.col, bottom: e.row, right: e.col };
};
// Wide enough for how many characters of 8pt Arial - reckoned for CAPITALS,
// which is what charge names and parties are mostly written in: about one
// to a unit of width. Lower case fits more, so a row can come out a little
// tall, never too short to show its text.
const charsAcross = ({ left, right }) => {
  let w = 0;
  for (let c = left; c <= right; c += 1) w += COLUMN_WIDTHS[c - 1] || 0;
  return Math.max(1, Math.floor(w));
};
// How many lines a text takes in a box, wrapped.
const linesIn = (text, r) => String(text ?? '').split('\n')
  .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsAcross(r))), 0);

export function sheetWriter(ws) {
  let at = 1;

  const row = (height) => {
    const n = at;
    at += 1;
    if (height) ws.getRow(n).height = height;
    return n;
  };

  /** A value in a cell or merged block. Ranges are 'A:R' on row `r`, or 'A5:R6'. */
  const put = (range, r, value, style = {}) => {
    const box = parseRange(range, r);
    if (box.right > box.left || box.bottom > box.top) {
      ws.mergeCells(box.top, box.left, box.bottom, box.right);
    }
    const cell = ws.getCell(box.top, box.left);
    cell.value = value;
    cell.style = {
      font: { name: 'Arial', size: 8, ...(style.bold ? { bold: true } : {}), ...(style.font || {}) },
      alignment: { horizontal: style.align || 'left', vertical: style.valign || 'top', wrapText: true },
      ...(style.numFmt ? { numFmt: style.numFmt } : {}),
      ...(style.fill ? { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } } } : {}),
    };
    return box;
  };

  /** A rule round a block - each edge cell gets its own side, as Excel draws
   *  a merged block's border from the cells along its edge. */
  const box = (range, r, sides = { top: THIN, left: THIN, bottom: THIN, right: THIN }) => {
    const b = parseRange(range, r);
    for (let y = b.top; y <= b.bottom; y += 1) {
      for (let x = b.left; x <= b.right; x += 1) {
        const edge = {};
        if (y === b.top && sides.top) edge.top = sides.top;
        if (y === b.bottom && sides.bottom) edge.bottom = sides.bottom;
        if (x === b.left && sides.left) edge.left = sides.left;
        if (x === b.right && sides.right) edge.right = sides.right;
        if (!Object.keys(edge).length) continue;
        const cell = ws.getCell(y, x);
        // A new style object: merged cells share their master's, and a side
        // set through the shared one would land on every cell of the block.
        cell.style = { ...cell.style, border: { ...(cell.style?.border || {}), ...edge } };
      }
    }
  };

  return { row, put, box, next: () => at };
}

// ---- the invoice ------------------------------------------------------------

/**
 * The figures the print works out, the same way (see InvoicePrint).
 */
export function invoiceFigures(invoice, records) {
  const lines = records || [];
  const isCustoms = Boolean(invoice?.customsJob) || invoice?.operation === 'CC' || invoice?.operation === 'LG';
  const isAgent = AGENT_TYPES.includes(invoice?.type);
  const taxSplit = isCustoms && lines.some(isSaleTaxLine);
  const expenseLines = taxSplit ? lines.filter((x) => !isSaleTaxLine(x)) : lines;
  const taxedLines = taxSplit ? lines.filter(isSaleTaxLine) : [];
  const saleTax = taxSplit ? saleTaxFigures(lines) : null;
  // The invoice's own currency, as the print - functions/invoicePrintCurrency.
  const foreign = printsForeign(invoice);
  const expensesTotal = taxSplit ? num(calculateTotal(expenseLines, foreign)) : 0;
  const invoiceTotal = taxSplit
    ? round2(expensesTotal + saleTax.serviceCharges + saleTax.saleTax)
    : num(calculateTotal(lines, foreign));
  const roundOff = num(invoice?.roundOff);
  const totalAmount = round2(invoiceTotal + roundOff);
  return {
    isCustoms, isAgent, foreign, taxSplit, expenseLines, taxedLines, saleTax, expensesTotal,
    invoiceTotal, roundOff, totalAmount,
    settlement: settlementLines(invoice, totalAmount),
    // In-Words and the Currency box: the invoice's own currency.
    currency: printCurrency(invoice),
    isCC: lines.some((x) => x.pp_cc === 'CC'),
    hasLines: lines.length > 0,
  };
}

const grossAmount = (x) => round2((num(x.amount) || 1) * num(x.rate_charge) * num(x.qty));

const freightBands = (invoice, f) => {
  const job = invoice?.SE_Job || {};
  const sea = SEA.includes(invoice?.operation);
  const arriving = ['SI', 'AI'].includes(invoice?.operation);
  const place = sea ? port : airport;
  const equipment = (job.SE_Equipments || []).map((z) => `${z.qty} x ${z.size}`).join(', ');
  const receivable = invoice?.payType === 'Recievable';
  return [
    [
      { cols: 'A:J', label: sea ? 'MBL No.' : 'MAWB No.', value: job.Bl?.mbl },
      { cols: 'K:R', label: sea ? 'Bill of Lading' : 'HAWB No.', value: job.Bl?.hbl },
      { cols: 'S:X', label: 'Job No', value: job.jobNo },
      { cols: 'Y:AI', label: 'Job Date', value: day(job.jobDate) },
    ],
    [
      {
        cols: 'A:J',
        label: sea ? 'Vessel / Voyage' : 'Air Line / Flight No.',
        value: sea
          ? [job.vessel?.name, job.Voyage?.voyage].filter(present).join(' / ')
          : [job.air_line?.name, job.flightNo].filter(present).join(' / '),
      },
      { cols: 'K:R', label: arriving ? 'Arrival Date' : 'Departure Date', value: day(arriving ? job.eta : job.shipDate) },
      { cols: 'S:X', label: 'Invoice No', value: invoice?.invoice_No },
      { cols: 'Y:AI', label: 'Invoice Date', value: day(invoice?.createdAt) },
    ],
    [
      { cols: 'A:J', label: sea ? 'Port of Loading' : 'Airport of Loading', value: place(job.pol) || job.pol },
      { cols: 'K:R', label: sea ? 'Port of Discharge' : 'Airport of Discharge', value: place(job.pod) || job.pod },
      { cols: 'S:AA', label: 'Destination Port', value: port(job.fd) || airport(job.fd) || job.fd },
      { cols: 'AB:AI', label: sea ? 'Shipping Line' : 'Air Line', value: sea ? job.shipping_line?.name : job.air_line?.name },
    ],
    [
      { cols: 'A:D', label: 'Weight', value: num(job.weight), numFmt: '#,##0.000' },
      sea
        ? { cols: 'E:K', label: 'Volume', value: receivable ? num(job.vol) : 0, numFmt: '#,##0.000' }
        : { cols: 'E:K', label: 'Ch.Wt', value: receivable ? num(job.cwtClient) : 0, numFmt: '#,##0.000' },
      { cols: 'L:R', label: 'PCS', value: sea && equipment ? equipment : (job.pcs ?? '') },
      { cols: 'S:AA', label: 'Currency', value: f.currency },
      { cols: 'AB:AI', label: 'Exchange Rate', value: f.hasLines ? num(invoice?.ex_rate) : '', numFmt: '0.000000' },
    ],
  ];
};

const customsBands = (invoice) => {
  const job = invoice?.customsJob || {};
  const packages = [job.packages, job.pkgUnit].filter(present).join(' ');
  return [
    [
      // A Freight Forwarding job's HBL # in its place - as the print.
      job.jobType === 'Freight Forwarding'
        ? { cols: 'A:J', label: 'HBL #', value: job.blNo || '' }
        : { cols: 'A:J', label: 'Client Invoice #', value: clientInvoiceNo(job) },
      { cols: 'K:R', label: 'GST Invoice #', value: invoice?.Sales_Tax_Invoice?.taxInvoiceNo || '' },
      { cols: 'S:X', label: 'Job No', value: job.jobNo || '' },
      { cols: 'Y:AI', label: 'Job Date', value: day(job.jobDate) },
    ],
    [
      { cols: 'A:E', label: 'Terminal / Yard', value: job.terminal || '' },
      { cols: 'F:L', label: 'No. of Packages', value: packages },
      { cols: 'M:R', label: 'Description', value: job.goodsDescription || '' },
      { cols: 'S:X', label: 'Invoice No', value: invoice?.invoice_No },
      { cols: 'Y:AI', label: 'Invoice Date', value: day(invoice?.createdAt) },
    ],
  ];
};

/**
 * The workbook.
 *
 * @param {Object} ExcelJS          the exceljs module
 * @param {Object} p
 * @param {Object} p.invoice        as the invoice page holds it
 * @param {Array}  p.records        its charge lines
 * @param {Object} p.company        the letterhead's Company record
 * @param {Object} p.bankAccount    the account Printing Options picked
 * @param {Object} p.logo           { buffer|base64, extension, width, height } or null
 * @param {Object} p.options        Printing Options: hideLogo, hideRef, hideBalance,
 *                                  hideNote, shipperInMs, hideTax
 */
export function buildInvoiceWorkbook(ExcelJS, { invoice, records, company, bankAccount, logo, options = {} }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Invoice', {
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.39, right: 0.39, top: 0.39, bottom: 0.39, header: 0, footer: 0 },
    },
  });
  ws.columns = COLUMN_WIDTHS.map((width) => ({ width }));
  const { row, put, box } = sheetWriter(ws);
  const comp = company || {};
  const f = invoiceFigures(invoice, records);

  // Letterhead - the company's details centred, the logo top left.
  const r1 = row(20.6);
  put('H:AI', r1, comp.title || '', { font: { size: 15 }, bold: true, align: 'center', valign: 'middle' });
  const contact = [
    comp.address,
    comp.phone && `Tel: ${comp.phone}`,
    [comp.email && `Email: ${comp.email}`, comp.web && `Web: ${comp.web}`].filter(Boolean).join('   '),
    [comp.ntn && `NTN # ${comp.ntn}`, comp.strn && `STRN # ${comp.strn}`].filter(Boolean).join('   '),
  ];
  contact.forEach((text) => put('H:AI', row(10), text || '', { align: 'center', valign: 'middle' }));
  row(12);
  if (logo && !options.hideLogo) {
    const id = wb.addImage(logo.buffer ? { buffer: logo.buffer, extension: logo.extension } : { base64: logo.base64, extension: logo.extension });
    // Inside A1:G6, its own shape kept.
    const maxW = 165;
    const maxH = 92;
    const scale = logo.width && logo.height ? Math.min(maxW / logo.width, maxH / logo.height) : null;
    ws.addImage(id, {
      tl: { col: 0.1, row: 0.15 },
      ext: scale ? { width: Math.round(logo.width * scale), height: Math.round(logo.height * scale) } : { width: maxW, height: maxH },
    });
  }

  // The title between two rules, as the print draws it - CENTRED: M:X spans
  // the same width either side of the page's middle (the start of S, where
  // the boxes below divide), and the two rules are the same length. Climax
  // had it in W:AF, well right of centre.
  const t1 = row(9);
  const t2 = row(9);
  box(`A${t1}:L${t1}`, t1, { bottom: MEDIUM });
  box(`Y${t1}:AI${t1}`, t1, { bottom: MEDIUM });
  const draft = String(invoice?.approved) !== '1';
  put(`M${t1}:X${t2}`, t1, draft
    ? { richText: [
      { text: invoice?.type || 'Invoice', font: { name: 'Arial', size: 14, bold: true } },
      { text: '  DRAFT', font: { name: 'Arial', size: 9, bold: true, color: { argb: 'FFC00000' } } },
    ] }
    : invoice?.type || 'Invoice',
  { font: { size: 14 }, bold: true, align: 'center', valign: 'middle' });
  row(6);

  // A row of boxes: labels above, values under, each half ruled round.
  // `minLines` holds a box open, as the reference's party boxes are.
  const band = (cells, { halves = true, minLines = 1 } = {}) => {
    const lr = row(LINE + 2);
    const vr = row();
    let lines = minLines;
    cells.forEach((c) => {
      put(c.cols, lr, c.label, { bold: true });
      const v = c.value ?? '';
      put(c.cols, vr, v, c.numFmt && typeof v === 'number' ? { numFmt: c.numFmt } : {});
      lines = Math.max(lines, linesIn(typeof v === 'number' ? String(v) : v, parseRange(c.cols, vr)));
    });
    ws.getRow(vr).height = lines * LINE + 6;
    if (halves) {
      box(`A${lr}:R${vr}`, lr);
      box(`S${lr}:AI${vr}`, lr);
    } else {
      box(`A${lr}:AI${vr}`, lr);
    }
  };
  // Label and value side by side; the row grows if a value wraps.
  const inline = (pairs) => {
    const r = row();
    let lines = 1;
    pairs.forEach(([labelCols, label, valueCols, value]) => {
      put(labelCols, r, label, { bold: true });
      put(valueCols, r, value ?? '');
      lines = Math.max(lines, linesIn(value, parseRange(valueCols, r)));
    });
    ws.getRow(r).height = lines * LINE + 3;
    return r;
  };

  if (f.isCustoms) {
    const job = invoice?.customsJob || {};
    const recipient = invoice?.recipient || {};
    const ms = options.shipperInMs && job.shipper?.name ? job.shipper : { ...recipient, name: recipient.name || invoice?.party_Name };
    const msLines = [ms.name, ms.address1, ms.address2, ms.ntn && `NTN # ${ms.ntn}`].filter(present).join('\n');
    const lr = row(LINE + 1);
    put('A:AI', lr, 'M/S', { bold: true });
    const vr = row();
    put('A:AI', vr, msLines);
    ws.getRow(vr).height = linesIn(msLines, parseRange('A:AI', vr)) * LINE + 3;
    box(`A${lr}:AI${vr}`, lr);
    // GD # / Form-E / MBL, then Job Type / S/R Page # - two to a row, so a
    // full GD number has the room it needs.
    [
      [['A:E', 'GD #:', 'F:R', job.gdNumber || job.customFileNo || ''],
        ['S:X', 'Form-E / MBL:', 'Y:AI', [job.formENo, job.mblNo].filter(present).join(' / ')]],
      [['A:E', 'Job Type:', 'F:R', job.jobType || ''],
        options.hideRef ? ['S:X', '', 'Y:AI', ''] : ['S:X', `${invoice?.printSettings?.referenceLabel || 'S/R Page #'}:`, 'Y:AI', job.jobRef || job.regPageNo || '']],
    ].forEach((pairs) => {
      const r = inline(pairs);
      box(`A${r}:R${r}`, r);
      box(`S${r}:AI${r}`, r);
    });
    customsBands(invoice).forEach((cells) => band(cells));
  } else {
    const job = invoice?.SE_Job || {};
    const shipperConsignee = [
      [job.shipper?.name, job.consignee?.name].filter(present).join(' / '),
      job.consignee?.address1,
    ].filter(present).join('\n');
    band([
      { cols: 'A:R', label: 'INVOICE TO', value: [invoice?.party_Name, job.Client?.address1].filter(present).join('\n') },
      { cols: 'S:AI', label: 'Shipper/Consignee', value: shipperConsignee },
    ], { minLines: 4 });
    if (!options.hideRef) {
      const r = inline([
        ['A:E', 'Reference No.', 'F:R', job.customerRef],
        ['S:X', 'Sales Rep', 'Y:AI', job.sales_representator?.name],
      ]);
      box(`A${r}:R${r}`, r);
      box(`S${r}:AI${r}`, r);
    }
    freightBands(invoice, f).forEach((cells) => band(cells));
    if (SEA.includes(invoice?.operation)) {
      const containers = (job.Bl?.Container_Infos || []).map((z) => z.no).filter(present).join(', ');
      const r = inline([['A:E', 'Container #', 'F:AI', containers]]);
      box(`A${r}:AI${r}`, r);
    }
  }
  row(6);

  // The charges.
  const head = f.isCustoms ? CUSTOMS_HEAD : FREIGHT_HEAD;
  // Hide Tax Column, as the print: no Tax column - Description/Remarks takes
  // its room - and a service charge at its value before tax.
  const noTax = f.isCustoms && Boolean(options.hideTax);
  const columns = noTax
    ? [
      { cols: 'A', title: 'Sr.', align: 'center', value: (x, i) => i + 1 },
      { cols: 'B:H', title: 'Charges', value: (x) => x.particular || '' },
      { cols: 'I:S', title: 'Description/Remarks', value: (x) => x.description || '' },
      { cols: 'T:X', title: 'Qty', align: 'center', numFmt: '#,##0.000', value: (x) => num(x.qty) },
      { cols: 'Y:AC', title: 'Rate', align: 'right', numFmt: MONEY, value: (x) => num(x.rate_charge) },
      { cols: 'AD:AI', title: 'Total Amount', align: 'right', numFmt: MONEY, value: (x, i, fig) => (fig ? round2(fig.taxable) : num(x.local_amount)) },
    ]
    : f.isCustoms
    ? [
      { cols: 'A', title: 'Sr.', align: 'center', value: (x, i) => i + 1 },
      { cols: 'B:H', title: 'Charges', value: (x) => x.particular || '' },
      { cols: 'I:P', title: 'Description/Remarks', value: (x) => x.description || '' },
      { cols: 'Q:U', title: 'Qty', align: 'center', numFmt: '#,##0.000', value: (x) => num(x.qty) },
      { cols: 'V:Z', title: 'Rate', align: 'right', numFmt: MONEY, value: (x) => num(x.rate_charge) },
      { cols: 'AA:AC', title: 'Tax', align: 'right', numFmt: MONEY, value: (x, i, fig) => (fig ? fig.tax : num(x.tax_amount)) },
      { cols: 'AD:AI', title: 'Total Amount', align: 'right', numFmt: MONEY, value: (x, i, fig) => (fig ? round2(fig.taxable + fig.tax) : num(x.local_amount)) },
    ]
    : [
      { cols: 'A', title: 'S #', value: (x, i) => i + 1 },
      { cols: f.isCC ? 'B:J' : 'B:L', title: 'Charges', value: (x) => x.particular || '' },
      ...(f.isCC ? [{ cols: 'K:L', title: 'Type', align: 'center', value: (x) => (x.pp_cc === 'CC' ? (x.type === 'Recievable' ? 'DN' : 'CN') : '') }] : []),
      { cols: 'M', title: 'Qty', align: 'center', numFmt: '#,##0.000', value: (x) => num(x.qty) },
      { cols: 'N:S', title: 'Rate', align: 'right', numFmt: MONEY, value: (x) => num(x.rate_charge) },
      { cols: 'T:U', title: 'Curr', align: 'center', value: (x) => x.currency || '' },
      { cols: 'V:Z', title: 'Amount', align: 'right', numFmt: MONEY, value: (x) => grossAmount(x) },
      { cols: 'AA:AB', title: 'Dis', align: 'right', numFmt: MONEY, value: (x) => num(x.discount) },
      { cols: 'AC:AE', title: 'Tax', align: 'right', numFmt: MONEY, value: (x) => num(x.tax_amount) },
      { cols: 'AF:AI', title: 'Total Amount', align: 'right', numFmt: MONEY, value: (x) => round2(lineAmount(x, f.foreign)) },
    ];
  const hr = row(13.74);
  columns.forEach((c) => {
    put(c.cols, hr, c.title, { bold: true, align: 'center', valign: 'middle', fill: head });
    box(c.cols, hr);
  });
  const chargeRow = (x, i, fig) => {
    const r = row(13.74);
    let lines = 1;
    columns.forEach((c) => {
      const v = c.value(x, i, fig);
      put(c.cols, r, v, { align: c.align || 'left', valign: 'middle', ...(c.numFmt ? { numFmt: c.numFmt } : {}) });
      box(c.cols, r);
      if (typeof v === 'string') lines = Math.max(lines, linesIn(v, parseRange(c.cols, r)));
    });
    if (lines > 1) ws.getRow(r).height = lines * LINE + 3;
  };
  // A total inside the table: label across, figure under Total Amount.
  const tableTotal = (label, value) => {
    const r = row(13.74);
    put('A:AC', r, label, { bold: true, align: 'right', valign: 'middle' });
    put('AD:AI', r, value, { bold: true, align: 'right', valign: 'middle', numFmt: MONEY });
    box('A:AC', r);
    box('AD:AI', r);
  };

  f.expenseLines.forEach((x, i) => chargeRow(x, i));
  if (f.isCustoms) {
    if (f.taxSplit) {
      if (f.expenseLines.length) tableTotal('Total Expenses :', f.expensesTotal);
      const r = row(13.74);
      put('A:AI', r, 'Service Charges', { bold: true, valign: 'middle', fill: head });
      box('A:AI', r);
      f.taxedLines.forEach((x, i) => chargeRow(x, i, lineFigures(x)));
      if (!noTax) tableTotal('Total For Sales Tax :', f.saleTax.serviceCharges);
      tableTotal(`Sales Tax @ ${f.saleTax.rate !== null ? `${f.saleTax.rate} %` : '(rates vary by line)'} :`, f.saleTax.saleTax);
      tableTotal('Total Without Tax :', round2(f.invoiceTotal - f.saleTax.saleTax));
      tableTotal('Total With Tax :', f.invoiceTotal);
    } else {
      tableTotal('Total :', f.invoiceTotal);
    }
    // A rounded customs invoice states its round off and what it comes to;
    // nothing else - the customs form has no Received or Balance.
    if (f.roundOff !== 0) {
      tableTotal('Round Off :', f.roundOff);
      tableTotal('Total Amount :', f.totalAmount);
    }
  } else {
    // Total Discount and Tax Amount on the left, the totals down the right.
    const right = [
      ...(f.foreign ? [] : [['Invoice Total (PKR)', f.invoiceTotal]]),
      ['Round Off', f.roundOff],
      ['Total Amount', f.totalAmount],
      ...(options.hideBalance ? [] : f.settlement.map((l) => [l.label, l.value])),
    ];
    const discount = round2((records || []).reduce((s, x) => s + num(x.discount), 0));
    const tax = round2((records || []).reduce((s, x) => s + num(x.tax_amount), 0));
    const first = row(12);
    put('A:C', first, 'Total Discount', { bold: true, valign: 'middle' });
    put('D:H', first, discount, { align: 'right', valign: 'middle', numFmt: MONEY });
    put('L:N', first, 'Tax Amount', { bold: true, valign: 'middle' });
    put('O:T', first, tax, { align: 'right', valign: 'middle', numFmt: MONEY });
    right.forEach(([label, value], i) => {
      const r = i === 0 ? first : row(12);
      put('X:AD', r, label, { bold: true, valign: 'middle' });
      put('AE:AI', r, value, { align: 'right', valign: 'middle', numFmt: MONEY });
    });
    const last = first + right.length - 1;
    box(`A${first}:W${last}`, first);
    box(`X${first}:AI${last}`, first);
  }

  // Note / In-Words. The Note box lists a customs invoice's containers
  // instead where Configuration > Invoices says so - as the print.
  const containerNos = f.isCustoms && invoice?.printSettings?.containerNosInNote
    ? containerNumbers(invoice?.customsJob) : null;
  const lr = row(LINE + 1);
  put('A:R', lr, containerNos !== null ? 'Container Nos:' : 'Note:', { bold: true });
  put('S:AI', lr, 'In-Words', { bold: true });
  const vr = row();
  const noteText = containerNos !== null ? containerNos
    : (!options.hideNote && hasNote(invoice) ? String(invoice.note) : '');
  const words = `${f.currency} ${inWords(f.totalAmount)}`;
  put('A:R', vr, noteText);
  put('S:AI', vr, words);
  ws.getRow(vr).height = Math.max(3, linesIn(noteText, parseRange('A:R', vr)), linesIn(words, parseRange('S:AI', vr))) * LINE + 3;
  box(`A${lr}:R${vr}`, lr);
  box(`S${lr}:AI${vr}`, lr);

  // Bank Details - the account Printing Options picked, a line per field.
  // None at all with Hide Bank Details ticked.
  if (!options.hideBankDetails) {
    const fields = bankAccountFields(bankAccount);
    const br = row(LINE + 1);
    put('A:R', br, 'Bank Details', { bold: true });
    let lastBank = br;
    fields.forEach(([label, value]) => {
      lastBank = row(LINE + 1);
      put('A:E', lastBank, label, { bold: true });
      put('F:R', lastBank, `: ${value}`);
    });
    box(`A${br}:R${lastBank}`, br);
  }

  return wb;
}

// ---- the logo -----------------------------------------------------------------

const decodeBase64 = (b64) => {
  if (typeof atob === 'function') {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(b64, 'base64'));
};

// A PNG states its size in its first 24 bytes.
const pngSize = (bytes) => (bytes.length > 24 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ? {
    width: ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0,
    height: ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0,
  }
  : {});

/**
 * The logo as the workbook takes it, from a data URL or a link. null when
 * there is none or it cannot be read - a logo is cosmetic, and never the
 * reason an export fails.
 */
export async function logoForExcel(src) {
  if (!src) return null;
  try {
    const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(src);
    if (m) {
      const bytes = decodeBase64(m[2]);
      return { base64: m[2], extension: m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase(), ...pngSize(bytes) };
    }
    const res = await fetch(src);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    const extension = /png/.test(type) ? 'png' : /jpe?g/.test(type) ? 'jpeg' : /gif/.test(type) ? 'gif' : null;
    if (!extension) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { buffer: bytes.buffer, extension, ...pngSize(bytes) };
  } catch (_) {
    return null;
  }
}

/** The file name: the invoice number, with what a file name cannot hold replaced. */
export const invoiceExcelName = (invoice) => `${String(invoice?.invoice_No || 'Invoice').replace(/[\\/:*?"<>|]+/g, '-')}.xlsx`;

/** Builds the sheet and saves it. */
export async function downloadInvoiceExcel(params) {
  const ExcelJS = (await import('exceljs')).default;
  const comp = params.company || {};
  const logo = params.options?.hideLogo ? null : await logoForExcel(comp.printLogo || comp.logo);
  const wb = buildInvoiceWorkbook(ExcelJS, { ...params, logo });
  await saveWorkbook(wb, invoiceExcelName(params.invoice));
}

/** Hands a workbook to the browser as a download - the voucher's sheet too. */
export async function saveWorkbook(wb, fileName) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
}

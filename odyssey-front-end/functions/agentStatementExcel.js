import moment from 'moment';

/**
 * THE INTERNATIONAL REPORT AS AN EXCEL SHEET - laid out as the accounts team's
 * own workbook ("International Report Recd & Pay as on 28-09-26.xlsx", its
 * REPORT sheet), so the sheet can sit beside theirs:
 *
 *   the company over the three columns, AGENT PAYABLE STATEMENT, "As on" and
 *   the date; Agent | Amount | Remarks; the agents we owe, most owed first;
 *   TOTAL. Then the typed-in section under its own heading (theirs was another
 *   company's agents), and its TOTAL. Then the company again, AGENT RECEIVABLE
 *   REPORT, "Current Receivable" | As on | date; the agents owing us, largest
 *   first; TOTAL.
 *
 * Amounts are numbers, each agent's currencies added as they stand, with no
 * currency named - negative what we owe, in red brackets as the workbook's
 * format shows them - and each TOTAL a SUM, so a line added by hand adds up. Remarks is left empty for the team to write in: the report
 * keeps none of its own.
 *
 * Kept apart from the screen so it can be tested: buildAgentStatementWorkbook
 * takes the ExcelJS module and returns the workbook.
 */

const DAY = 'YYYY-MM-DD';
/** The workbook's own number format: negatives red, in brackets. */
export const AMOUNT_FORMAT = '#,##0.00 ;[Red](#,##0.00)';

/** 'YYYY-MM-DD' -> 'DD-MM-YYYY'. */
export const asOnText = (day) => (day ? moment(day, DAY).format('DD-MM-YYYY') : '');

/** The cut-off, when the report has one - "Invoices from 01-07-2026" - and ''
 *  when it is every document. Said wherever the As on date is, so a printed
 *  or exported copy cannot pass for the whole book (the user's request,
 *  2026-10-09; the server leaves out what is dated before it). */
export const cutOffText = (report) => (report?.from ? `Invoices from ${asOnText(report.from)}` : '');

/**
 * The name over the report: the company picked, or - for all of them - every
 * company's name, as the workbook's "SEA NET SHIPPING & LOGISTICS / AIR CARGO
 * SERVICES" names both of its own.
 */
export function statementTitle(companies, company) {
  const name = (c) => c?.title || c?.short || '';
  const one = (companies || []).find((c) => String(c.id) === String(company));
  if (one) return name(one);
  return (companies || []).map(name).filter(Boolean).join(' / ');
}

/** The typed-in section's heading when it was given none. */
export const MANUAL_HEADING = 'OTHER AGENTS';

const sum = (lines) => Math.round(lines.reduce((t, l) => t + (Number(l.amount) || 0), 0) * 100) / 100;

/**
 * The report's sections, in order - what the screen, the print and the sheet
 * all lay out. The typed-in one only when it has lines, its lines in the order
 * they were typed.
 */
export function statementSections(report, manual) {
  const sections = [{
    key: 'payables', heading: 'AGENT PAYABLE STATEMENT',
    lines: report?.payables || [], total: Number(report?.totals?.payable) || 0,
  }];
  const typed = (manual?.lines || []).filter((l) => l && l.agent);
  if (typed.length) {
    sections.push({
      key: 'manual', heading: (manual.title || '').trim() || MANUAL_HEADING, lines: typed, total: sum(typed),
    });
  }
  sections.push({
    key: 'receivables', heading: 'AGENT RECEIVABLE REPORT',
    lines: report?.receivables || [], total: Number(report?.totals?.receivable) || 0,
  });
  return sections;
}

const THIN = { style: 'thin', color: { argb: 'FF000000' } };
const BOXED = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEAD_FONT = { name: 'Calibri', size: 11, bold: true };
const LINE_FONT = { name: 'Tahoma', size: 8 };

/**
 * @param {Object} ExcelJS        the exceljs module
 * @param {Object} p
 * @param {Object} p.report       the server's { asOn, payables, receivables, totals }
 * @param {Object} p.manual       the typed-in section { title, lines: [{ agent, amount }] }
 * @param {string} p.title        the name over the report (statementTitle)
 */
export function buildAgentStatementWorkbook(ExcelJS, { report, manual = null, title = '' }) {
  const wb = new ExcelJS.Workbook();
  const asOn = moment(report?.asOn, DAY);
  // Named as the workbook names its sheets - 'REPORT 28-9-26'.
  const ws = wb.addWorksheet(`REPORT ${asOn.format('D-M-YY')}`, {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [{ width: 53.5 }, { width: 15.33 }, { width: 60.33 }];
  // A real date, so Excel shows it as the workbook did (28-Sep-26). Midnight
  // UTC: ExcelJS counts days in UTC.
  const asOnDate = new Date(Date.UTC(asOn.year(), asOn.month(), asOn.date()));

  let r = 0;
  const banner = (value) => {
    r += 1;
    ws.mergeCells(`A${r}:C${r}`);
    const cell = ws.getCell(`A${r}`);
    cell.value = value;
    cell.font = HEAD_FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BOXED;
    ws.getRow(r).height = 15;
  };
  const head = (cells, aligns = []) => {
    r += 1;
    cells.forEach((v, i) => {
      if (v === null) return;
      const cell = ws.getRow(r).getCell(i + 1);
      cell.value = v;
      cell.font = HEAD_FONT;
      cell.border = BOXED;
      cell.alignment = { horizontal: aligns[i], vertical: 'middle', wrapText: !aligns[i] };
      if (v instanceof Date) cell.numFmt = 'd-mmm-yy';
    });
    ws.getRow(r).height = 15;
  };
  const blank = () => { r += 1; };

  const section = (s) => {
    head(['Agent', 'Amount', 'Remarks'], [undefined, 'center', 'center']);
    const first = r + 1;
    s.lines.forEach((l) => {
      r += 1;
      const row = ws.getRow(r);
      row.getCell(1).value = l.agent;
      row.getCell(2).value = Number(l.amount) || 0;
      row.getCell(2).numFmt = AMOUNT_FORMAT;
      [1, 2, 3].forEach((c) => {
        row.getCell(c).font = LINE_FONT;
        row.getCell(c).border = BOXED;
      });
    });
    r += 1;
    const total = ws.getRow(r);
    total.getCell(1).value = 'TOTAL';
    total.getCell(1).font = HEAD_FONT;
    total.getCell(2).value = s.lines.length
      ? { formula: `SUM(B${first}:B${r - 1})`, result: s.total }
      : 0;
    total.getCell(2).font = { ...LINE_FONT, bold: true };
    total.getCell(2).numFmt = AMOUNT_FORMAT;
    [1, 2, 3].forEach((c) => { total.getCell(c).border = BOXED; });
    total.height = 15;
  };

  const [payables, ...rest] = statementSections(report, manual);
  const receivables = rest.pop();
  const typed = rest[0];

  banner(title);
  banner(payables.heading);
  head([cutOffText(report) || null, 'As on', asOnDate], [undefined, 'center', 'center']);
  blank();
  section(payables);

  if (typed) {
    blank();
    banner(typed.heading);
    section(typed);
  }

  blank();
  blank();
  banner(title);
  banner(receivables.heading);
  head([['Current Receivable', cutOffText(report)].filter(Boolean).join(' - '), 'As on', asOnDate], [undefined, 'center', 'center']);
  blank();
  section(receivables);

  return wb;
}

/** The file name, as the team names theirs. */
export const agentStatementFileName = (report) =>
  `International Report Recd & Pay as on ${moment(report?.asOn, DAY).format('DD-MM-YY')}.xlsx`;

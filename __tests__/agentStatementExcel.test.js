/**
 * The International Report as an Excel sheet - functions/agentStatementExcel.
 * Laid out as the accounts team's own workbook (its REPORT sheet): the
 * company, AGENT PAYABLE STATEMENT, As on and the date; Agent | Amount |
 * Remarks; the payables and their TOTAL; the typed-in section under its own
 * heading; then the company again, AGENT RECEIVABLE REPORT, Current
 * Receivable | As on | date; the receivables and their TOTAL. Remarks empty.
 */
import ExcelJS from 'exceljs';
import {
  buildAgentStatementWorkbook, agentStatementFileName, statementTitle, statementSections,
  AMOUNT_FORMAT, MANUAL_HEADING, cutOffText,
} from '../functions/agentStatementExcel';

const report = {
  asOn: '2026-09-28',
  payables: [
    { accountId: 7, agent: 'GREEN WORLDWIDE SHIPPING, LLC', amount: -52783 },
    { accountId: 9, agent: 'SKYWAYS SLS CARGO SERVICES LLC', amount: -40630 },
  ],
  receivables: [
    { accountId: 3, agent: 'MILESTONE TEXTILES', amount: 156762 },
    { accountId: 4, agent: 'RIV WORLDWIDE', amount: 1250.5 },
  ],
  totals: { payable: -93413, receivable: 158012.5 },
};
const manual = {
  title: 'INTERNATIONAL FREIGHT & AVIATION SERVICES (PVT) LTD',
  lines: [{ agent: 'SKYGATE SERVICES FZCO', amount: -122551 }, { agent: 'ZEAL GLOBAL', amount: 20000 }],
};
const TITLE = 'SEA NET SHIPPING & LOGISTICS / AIR CARGO SERVICES';

const sheet = (m = manual) => buildAgentStatementWorkbook(ExcelJS, { report, manual: m, title: TITLE }).worksheets[0];
const col = (ws, letter) => {
  const out = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => { out[r] = row.getCell(letter).value; });
  return out;
};

test('the payables: the company, the heading, As on the date, then the agents most owed first', () => {
  const ws = sheet();
  expect(ws.name).toBe('REPORT 28-9-26');
  expect(ws.getCell('A1').value).toBe(TITLE);
  expect(ws.getCell('A2').value).toBe('AGENT PAYABLE STATEMENT');
  expect(ws.model.merges).toEqual(expect.arrayContaining(['A1:C1', 'A2:C2']));
  expect(ws.getCell('B3').value).toBe('As on');
  expect(ws.getCell('C3').value).toEqual(new Date(Date.UTC(2026, 8, 28)));
  expect(ws.getCell('C3').numFmt).toBe('d-mmm-yy');
  expect(ws.getRow(5).values.slice(1)).toEqual(['Agent', 'Amount', 'Remarks']);
  expect(ws.getRow(6).values.slice(1)).toEqual(['GREEN WORLDWIDE SHIPPING, LLC', -52783]);
  expect(ws.getCell('B6').numFmt).toBe(AMOUNT_FORMAT);
  expect(ws.getCell('A8').value).toBe('TOTAL');
  expect(ws.getCell('B8').value).toEqual({ formula: 'SUM(B6:B7)', result: -93413 });
});

test('Remarks is left empty, boxed, for the team to write in', () => {
  const ws = sheet();
  expect(ws.getCell('C6').value).toBe(null);
  expect(ws.getCell('C6').border.left.style).toBe('thin');
  expect(ws.columns.map((c) => c.width)).toEqual([53.5, 15.33, 60.33]);
});

test('the typed-in section under its own heading, in the order typed, with its total', () => {
  const ws = sheet();
  expect(ws.getCell('A10').value).toBe(manual.title);
  expect(ws.getRow(11).values.slice(1)).toEqual(['Agent', 'Amount', 'Remarks']);
  expect(ws.getRow(12).values.slice(1)).toEqual(['SKYGATE SERVICES FZCO', -122551]);
  expect(ws.getRow(13).values.slice(1)).toEqual(['ZEAL GLOBAL', 20000]);
  expect(ws.getCell('B14').value).toEqual({ formula: 'SUM(B12:B13)', result: -102551 });
});

test('the receivables after it: the company again, Current Receivable, largest first', () => {
  const ws = sheet();
  const a = col(ws, 'A');
  const at = a.indexOf('AGENT RECEIVABLE REPORT');
  expect(a[at - 1]).toBe(TITLE);
  expect(ws.getRow(at + 1).values.slice(1)).toEqual(['Current Receivable', 'As on', new Date(Date.UTC(2026, 8, 28))]);
  expect(a[at + 3]).toBe('Agent');
  expect(a.slice(at + 4, at + 7)).toEqual(['MILESTONE TEXTILES', 'RIV WORLDWIDE', 'TOTAL']);
  expect(ws.getCell(`B${at + 6}`).value).toEqual({ formula: `SUM(B${at + 4}:B${at + 5})`, result: 158012.5 });
});

test('no typed-in lines: no section for them', () => {
  const ws = sheet({ title: 'IFA', lines: [] });
  expect(col(ws, 'A')).not.toContain('IFA');
  expect(col(ws, 'A').filter((v) => v === 'TOTAL')).toHaveLength(2);
});

test('an empty section still totals, to 0', () => {
  const ws = buildAgentStatementWorkbook(ExcelJS, { report: { ...report, payables: [], totals: { payable: 0, receivable: 158012.5 } }, title: TITLE }).worksheets[0];
  expect(ws.getCell('A6').value).toBe('TOTAL');
  expect(ws.getCell('B6').value).toBe(0);
});

test('it writes, and is named as the team names its file', async () => {
  const buffer = await buildAgentStatementWorkbook(ExcelJS, { report, manual, title: TITLE }).xlsx.writeBuffer();
  expect(buffer.byteLength).toBeGreaterThan(1000);
  expect(agentStatementFileName(report)).toBe('International Report Recd & Pay as on 28-09-26.xlsx');
});

describe('the name over the report', () => {
  const companies = [{ id: 1, title: 'SEA NET SHIPPING & LOGISTICS' }, { id: 3, title: '', short: 'AIR CARGO SERVICES' }];
  test('the company picked', () => {
    expect(statementTitle(companies, '3')).toBe('AIR CARGO SERVICES');
  });
  test('all of them, as the workbook names both', () => {
    expect(statementTitle(companies, 'all')).toBe(TITLE);
  });
});

test('the typed-in section takes a heading when given none, and skips blank lines', () => {
  const [, typed] = statementSections(report, { title: '  ', lines: [{ agent: 'FITS AIR', amount: 9495.7 }, { agent: '', amount: 5 }] });
  expect(typed).toMatchObject({ key: 'manual', heading: MANUAL_HEADING, total: 9495.7 });
  expect(typed.lines).toHaveLength(1);
});


/* The cut-off (the user's request, 2026-10-09): when the report leaves out
   what is dated before a day, the sheet says so beside each As on - so it
   cannot pass for the whole book. */
test('a cut-off is named beside each As on; none, nothing is', () => {
  expect(cutOffText({ ...report, from: '2026-07-01' })).toBe('Invoices from 01-07-2026');
  expect(cutOffText(report)).toBe('');
  const cut = buildAgentStatementWorkbook(ExcelJS, { report: { ...report, from: '2026-07-01' }, manual, title: TITLE }).worksheets[0];
  expect(cut.getCell('A3').value).toBe('Invoices from 01-07-2026');
  expect(col(cut, 'A')).toContain('Current Receivable - Invoices from 01-07-2026');
  expect(sheet().getCell('A3').value).toBeNull();
});

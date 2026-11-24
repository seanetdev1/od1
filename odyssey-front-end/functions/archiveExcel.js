// The Archive's ledger and trial balance as Excel workbooks.
// ExcelJS is passed in (loaded on demand by the screen), so this stays pure
// and testable.

const NUM = '#,##0.00;[Red]-#,##0.00';
const dmy = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

function letterhead(ws, { company, address, title, lines, width }) {
  const put = (text, opts = {}) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, width);
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(1).font = { bold: Boolean(opts.bold), size: opts.size || 10, underline: Boolean(opts.underline) };
  };
  if (company) put(company, { bold: true, size: 14, underline: true });
  if (address) put(address);
  put(title, { bold: true, size: 12, underline: true });
  (lines || []).forEach((l) => put(l));
  ws.addRow([]);
}

function header(ws, titles) {
  const row = ws.addRow(titles);
  row.eachCell((c) => {
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  return row;
}

const money = (row, cols) => cols.forEach((i) => { row.getCell(i).numFmt = NUM; });

/** A ledger: opening, every line with its running balance, totals, closing. */
export function buildLedgerWorkbook(ExcelJS, { company, address, bookLabel, ledger }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ledger');
  ws.columns = [{ width: 12 }, { width: 14 }, { width: 6 }, { width: 12 }, { width: 60 }, { width: 12 },
    { width: 15 }, { width: 15 }, { width: 17 }];
  const a = ledger.account;
  letterhead(ws, {
    company,
    address,
    title: 'Ledger',
    width: 9,
    lines: [
      `${a.code ? `${a.code} - ` : ''}${a.name}`,
      `${ledger.from ? `From ${dmy(ledger.from)}` : 'From the start of the book'}  ${ledger.to ? `To ${dmy(ledger.to)}` : 'to its end'}`,
      `Archive: ${bookLabel}`,
    ],
  });
  header(ws, ['Date', 'Voucher', 'Type', 'Cheque', 'Narration', 'Job', 'Debit', 'Credit', 'Balance']);
  const opening = ws.addRow(['', '', '', '', 'Opening balance', '', null, null, ledger.opening]);
  opening.font = { italic: true };
  money(opening, [9]);
  ledger.rows.forEach((r) => {
    const row = ws.addRow([dmy(r.date), r.voucherNo, r.type, r.chequeNo, r.narration, r.jobNo,
      r.debit || null, r.credit || null, r.balance]);
    money(row, [7, 8, 9]);
  });
  const total = ws.addRow(['', '', '', '', 'Total', '', ledger.totals.debit, ledger.totals.credit, ledger.closing]);
  total.font = { bold: true };
  money(total, [7, 8, 9]);
  return wb;
}

/** A trial balance: the chart as a tree, each figure in its own column. */
export function buildTrialBalanceWorkbook(ExcelJS, { company, address, bookLabel, tb, rows }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Trial Balance');
  ws.columns = [{ width: 12 }, { width: 50 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];
  letterhead(ws, {
    company,
    address,
    title: 'Trial Balance',
    width: 8,
    lines: [`From ${dmy(tb.from)} To ${dmy(tb.to)}`, `Archive: ${bookLabel}`],
  });
  header(ws, ['Code', 'Account', 'Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr']);
  const dr = (v) => (v > 0 ? v : null);
  const cr = (v) => (v < 0 ? -v : null);
  rows.forEach((r) => {
    const row = ws.addRow([r.code, `${'    '.repeat(Math.max(0, r.level - 1))}${r.name}`,
      dr(r.opening), cr(r.opening), r.debit || null, r.credit || null, dr(r.closing), cr(r.closing)]);
    if (r.isGroup) row.font = { bold: true };
    money(row, [3, 4, 5, 6, 7, 8]);
  });
  const t = tb.totals;
  const closing = (t.opening || 0) + (t.debit || 0) - (t.credit || 0);
  const total = ws.addRow(['', 'Total (every account)', dr(t.opening), cr(t.opening), t.debit, t.credit, dr(closing), cr(closing)]);
  total.font = { bold: true };
  money(total, [3, 4, 5, 6, 7, 8]);
  return wb;
}

export const archiveFileName = (kind, bookKey, extra) => `${kind} - ${bookKey}${extra ? ` - ${extra}` : ''}.xlsx`;

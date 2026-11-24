/**
 * A CSV file of rows, downloaded - what react-csv's CSVLink did as a link on
 * the page, for a button on the toolbar instead (PageActions), which calls a
 * function rather than rendering a link.
 *
 * Rows are arrays (the first usually the headings), as the manifest builds
 * them. Every value is quoted, so a comma or quote inside one stays in its
 * cell; a leading BOM so Excel reads the file as UTF-8.
 */
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export const toCsv = (rows) => (rows || [])
  .map((row) => (Array.isArray(row) ? row : Object.values(row || {})).map(cell).join(','))
  .join('\r\n');

export function downloadCsv(filename, rows) {
  const blob = new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import moment from 'moment';
import { usesColumn, docHeadings } from './invoiceJobColumns';

/**
 * The columns of the Job Balancing GRID - which ones it can show, which it
 * opens with, and what each puts in the Excel export.
 *
 * The id is the grid's field, and what Config > Reports stores
 * (/settings/reportColumns/jobBalancingGrid) as the columns the report opens
 * with, in order. A user then ticks columns on and off for themselves (kept
 * for the browser session) and can drag them about; the Excel export is the
 * grid as it stands - the same columns, in the same order.
 *
 * WHY ONE LIST. The grid and its export each kept their own: the export's
 * rows were keyed by hand, and two keys did not match their columns, so # and
 * Paid/Rcvd always exported blank.
 */
export const JOB_BALANCING_GRID = 'jobBalancingGrid';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const fmtDate = (v) => (v && moment(v).isValid() ? moment(v).format('DD-MMM-YYYY') : '');
const read = (row, id) => id.split('.').reduce((o, k) => (o == null ? o : o[k]), row);

// kind: 'invoice' (opens the invoice), 'date', 'money'; text when absent.
// value: the cell's value when it is not simply the field.
const CATALOGUE = (docs) => [
  { id: 'no', heading: '#' },
  { id: 'invoice_No', heading: 'Inv. No', kind: 'invoice' },
  { id: 'createdAt', heading: 'Invoice Date' },
  { id: 'jobCols.jobNo', heading: 'Job. No' },
  { id: 'jobCols.jobDate', heading: 'Job Date', kind: 'date' },
  { id: 'jobCols.docPrimary', heading: docs.primary },
  { id: 'jobCols.docSecondary', heading: docs.secondary },
  { id: 'jobCols.gdDate', heading: 'GD Date', kind: 'date' },
  { id: 'jobCols.clientInvoiceNo', heading: 'Client Invoice #' },
  { id: 'jobCols.vendorTaxInvoiceNo', heading: 'Vendor Tax Inv #' },
  { id: 'jobCols.sailDate', heading: 'Sailing Date', kind: 'date' },
  { id: 'jobCols.arrivalDate', heading: 'Arrival Date', kind: 'date' },
  { id: 'SE_Job.Voyage.voyage', heading: 'Voyage/Flight' },
  { id: 'party_Name', heading: 'Client' },
  { id: 'jobCols.clientCode', heading: 'Client Code' },
  { id: 'jobCols.shipper', heading: 'Shipper' },
  { id: 'jobCols.consignee', heading: 'Consignee' },
  { id: 'jobCols.salesRep', heading: 'Sales Representator' },
  { id: 'jobCols.shippingLine', heading: 'Shipping Line' },
  { id: 'jobCols.vessel', heading: 'Vessel' },
  { id: 'jobCols.finalDestination', heading: 'F. Dest' },
  { id: 'jobCols.jobType', heading: 'J/Tp' },
  { id: 'ppcc', heading: 'F/Tp' },
  { id: 'containers', heading: 'Containers' },
  { id: 'jobCols.weight', heading: 'Weight' },
  { id: 'jobCols.volume', heading: 'Vol' },
  { id: 'currency', heading: 'Curr' },
  { id: 'SE_Job.fileNo', heading: 'File No' },
  { id: 'total', heading: 'Debit', kind: 'money', value: (x) => (x.payType !== 'Payble' ? num(x.total) : 0) },
  { id: 'total1', heading: 'Credit', kind: 'money', value: (x) => (x.payType === 'Payble' ? num(x.total1) : 0) },
  { id: 'recieved', heading: 'Paid/Rcvd', kind: 'money', value: (x) => num(x.payType === 'Payble' ? x.paid : x.recieved) },
  { id: 'balance', heading: 'Balance', kind: 'money', value: (x) => num(x.balance) },
  { id: 'age', heading: 'Age' },
  { id: 'company', heading: 'Company Name' },
  { id: 'customerRef', heading: 'Customer Ref #' },
];

/**
 * The columns this install's mode can show, in the built-in order. A column
 * the mode never fills is not offered at all: jobCols.* by the shared mapping,
 * and the fields read straight off a freight job (voyage, file number,
 * customer ref) on freight only.
 */
export function jobBalancingColumns(mode) {
  return CATALOGUE(docHeadings(mode)).filter((c) => {
    if (c.id.startsWith('jobCols.')) return usesColumn(mode, c.id.slice('jobCols.'.length));
    if (c.id.startsWith('SE_Job.') || c.id === 'customerRef') return mode === 'freight';
    return true;
  });
}

const known = (columns, ids) => {
  const have = new Set(columns.map((c) => c.id));
  return [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => have.has(id));
};

/**
 * The columns the grid opens with: the configured ones, in their order -
 * those this mode has. None configured (or none this mode has): every one.
 */
export function defaultColumnIds(columns, configured) {
  const ids = known(columns, configured);
  return ids.length ? ids : columns.map((c) => c.id);
}

/**
 * Every column, in the order the column picker lists them and the grid shows
 * a ticked one: the defaults first, in their order, then the rest as built in.
 */
export function pickerOrder(columns, defaults) {
  const first = known(columns, defaults);
  return [...first, ...columns.map((c) => c.id).filter((id) => !first.includes(id))];
}

/** The ticked columns, in picker order. Never none - that is a blank grid. */
export function shownColumnIds(columns, defaults, ticked) {
  const on = new Set(known(columns, ticked));
  const ids = pickerOrder(columns, defaults).filter((id) => on.has(id));
  return ids.length ? ids : defaultColumnIds(columns, defaults);
}

/** What one cell holds in the Excel export - what the grid shows in it. */
export function cellValue(column, row) {
  if (column.value) return column.value(row);
  const v = read(row, column.id);
  if (column.kind === 'date') return fmtDate(v);
  return v ?? '';
}

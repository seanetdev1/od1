import { defaultColumnIds, pickerOrder } from 'functions/jobBalancingColumns';

/**
 * THE VAT DETAIL'S COLUMNS - one list for its screen, its print and its Excel
 * export, which all show the columns picked.
 *
 * The fifteen of Climax's VAT Detail, in its order. Five are OFF until picked:
 * CNIC, Buyer Type and ST Withheld are never filled, and Document Type (SI)
 * and Sale Type (Services) are the same on every row - shown by default they
 * only pushed the figures off the page. Configuration > Reports sets
 * which columns the report opens with; the report's Columns button changes
 * them for the session, and its All puts every one back for the full return.
 *
 * `screen` is the on-screen width in pixels (none for the column that takes
 * what is left); `print` its share of the landscape page.
 */
export const VAT_DETAIL = 'vatDetail';

// `short` is the screen's heading where the return's is too long for a column.
export const VAT_COLUMNS = [
  { id: 'sr', heading: 'Sr #', width: 7.94, screen: 56, print: 3.5, align: 'center' },
  { id: 'ntn', heading: 'NTN', width: 11.11, screen: 100, print: 7 },
  { id: 'cnic', heading: 'CNIC', width: 11.11, screen: 100, print: 5, off: true },
  { id: 'buyer', heading: 'Name of Buyer', width: 23.81, print: 15, ellipsis: true },
  // Wider than Climax's 11.11, which split "KARACHI,PAKISTAN" over two lines.
  { id: 'district', heading: 'District of Buyer', short: 'District', width: 16, screen: 140, print: 10.5, ellipsis: true },
  { id: 'buyerType', heading: 'Buyer Type', width: 11.11, screen: 90, print: 4.5, off: true },
  { id: 'documentType', heading: 'Document Type', short: 'Doc. Type', width: 15.87, screen: 80, print: 5.5, off: true },
  { id: 'documentNo', heading: 'Document Number', short: 'Document No.', width: 15.87, screen: 110, print: 7 },
  { id: 'date', heading: 'Document Date', short: 'Date', width: 15.87, screen: 100, print: 7 },
  { id: 'hsCode', heading: 'HS Code', width: 11.11, screen: 90, print: 5 },
  { id: 'saleType', heading: 'Sale Type', width: 11.11, screen: 90, print: 5.5, off: true },
  { id: 'rate', heading: 'Rate', width: 11.11, screen: 60, print: 3.5, figure: true },
  { id: 'value', heading: 'Value of Sales Excluding Sales Tax', short: 'Value Excl. Tax', width: 23.81, screen: 130, print: 8.5, figure: true, money: true },
  { id: 'tax', heading: 'Sales Tax Involved', short: 'Sales Tax', width: 23.81, screen: 110, print: 7, figure: true, money: true },
  { id: 'withheld', heading: 'ST Withheld at Source', short: 'ST Withheld', width: 23.81, screen: 110, print: 6, figure: true, money: true, off: true },
];

/** The columns the report opens with when Configuration names none. */
export const VAT_BUILT_IN_COLUMNS = VAT_COLUMNS.filter((c) => !c.off).map((c) => c.id);

const ids = new Set(VAT_COLUMNS.map((c) => c.id));

/** The columns the report opens with: Configuration's, else the built-in ten. */
export const vatDefaultColumns = (configured) => {
  const named = (Array.isArray(configured) ? configured : []).filter((id) => ids.has(String(id)));
  return defaultColumnIds(VAT_COLUMNS, named.length ? named : VAT_BUILT_IN_COLUMNS);
};

const RETURN_ORDER = VAT_COLUMNS.map((c) => c.id);
const inReturnOrder = (list) => list.every((id, i) => i === 0 || RETURN_ORDER.indexOf(list[i - 1]) < RETURN_ORDER.indexOf(id));

/**
 * Every column, in the order the picker lists them and the report shows them.
 *
 * THE RETURN'S ORDER, unless an admin has put the defaults in another: then
 * the defaults first, in theirs, and the rest after (the Job Balancing rule).
 * So ticking CNIC puts it after NTN, where the return has it - not at the end,
 * which with All left the figures stranded in the middle of the table.
 */
export const vatPickerOrder = (defaults) => (inReturnOrder(defaults) ? RETURN_ORDER : pickerOrder(VAT_COLUMNS, defaults));

/** The ticked columns, in picker order - never none. */
export const vatShownColumns = (defaults, ticked) => {
  const on = new Set((Array.isArray(ticked) ? ticked : []).map(String));
  const ids = vatPickerOrder(defaults).filter((id) => on.has(id));
  return ids.length ? ids : defaults;
};

export const vatColumn = (id) => VAT_COLUMNS.find((c) => c.id === id);

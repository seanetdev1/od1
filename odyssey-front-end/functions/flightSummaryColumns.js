// Which columns the Flight Summary shows, and which the user has put away.
//
// The report is fourteen columns wide in Per Flight and seven in Flight
// Counts, and most offices read four or five of them. Rather than guess which,
// the column list is data and the user hides what they do not want - see the
// Columns modal in the report.
//
// KEPT OUT OF THE COMPONENT so the rules can be tested without rendering a
// table: which columns a view has, what a group's colSpan becomes when half of
// it is hidden, and what happens to a stored preference when a column is later
// renamed or dropped. The cells themselves stay in the component - they are
// JSX, and a column definition that carries markup stops being data.
//
// THE IDENTITY COLUMN OF EACH VIEW IS LOCKED. A table of figures whose rows
// cannot be told apart is not a smaller report, it is an unreadable one, so
// Flight (Per Flight) and Aircraft (Flight Counts) cannot be hidden. They are
// shown in the modal, ticked and disabled, rather than left out of it - a
// column missing from the list reads as a bug in the list.

/** Per Flight. `group` names the tier-1 heading the column sits under. */
export const FLIGHT_COLUMNS = [
  { key: 'date',         label: 'Date' },
  { key: 'flightNo',     label: 'Flight', locked: true },
  { key: 'aircraft',     label: 'Aircraft' },
  { key: 'sector',       label: 'Sector' },
  // `dp` is the decimal places, and it is the column's property rather than
  // the screen's: it drives both the figure on the page and the number format
  // in the exported workbook, so the two cannot print the same figure
  // differently. PFM is a planned round figure; a kilo is not measured to a
  // hundredth of itself on a plan.
  { key: 'pfm',          label: 'PFM',      group: 'plan',  num: true, dp: 0 },
  { key: 'manifest',     label: 'Manifest', group: 'plan',  num: true, dp: 2 },
  { key: 'gamUplift',    label: 'Uplift',   group: 'gam',   num: true, dp: 2 },
  { key: 'gamOffload',   label: 'Offload',  group: 'gam',   num: true, dp: 2 },
  { key: 'ifaUplift',    label: 'Uplift',   group: 'ifa',   num: true, dp: 2 },
  { key: 'ifaOffload',   label: 'Offload',  group: 'ifa',   num: true, dp: 2 },
  { key: 'otherUplift',  label: 'Uplift',   group: 'other', num: true, dp: 2 },
  { key: 'otherOffload', label: 'Offload',  group: 'other', num: true, dp: 2 },
  { key: 'totalUplift',  label: 'Uplift',   group: 'total', num: true, dp: 2 },
  { key: 'totalOffload', label: 'Offload',  group: 'total', num: true, dp: 2 },
];

/** Flight Counts. One row per aircraft, so no groups - a flat header. */
export const COUNT_COLUMNS = [
  { key: 'aircraft', label: 'Aircraft', locked: true },
  // Every figure here is a whole thing - a count of flights, or a payload
  // nobody plans to a fraction of a kilo. dp: 0 throughout, which is also what
  // stops the workbook printing "3.00 flights".
  { key: 'pla',      label: 'PLA',       num: true, dp: 0 },
  { key: 'ttlFlt',   label: 'TTL Flt',   num: true, dp: 0 },
  { key: 'opFlt',    label: 'Op-Flt',    num: true, dp: 0 },
  { key: 'xxld',     label: 'XXLD-Flt',  num: true, dp: 0 },
  { key: 'notOp',    label: 'Not-Op',    num: true, dp: 0 },
  { key: 'ttlWgt',   label: 'TTL Wgt',   num: true, dp: 0 },
];

// The tier-1 headings, in order. `label` is resolved by the component: the GAM
// heading is the airline's own name when the period names exactly one GAM
// carrier, which only the server can decide (see gamLabelFor).
export const GROUPS = [
  { key: 'plan',  cls: 'num grp-plan' },
  { key: 'gam',   cls: 'num grp grp-gam' },
  { key: 'ifa',   cls: 'num grp grp-ifa' },
  { key: 'other', cls: 'num grp grp-other' },
  { key: 'total', cls: 'num grp grp-total' },
];

export const columnsFor = (view) => (view === 'counts' ? COUNT_COLUMNS : FLIGHT_COLUMNS);

/**
 * The columns actually rendered.
 *
 * A locked column is never hidden, whatever the stored preference says. The
 * two views share the key `aircraft` deliberately: it is the same field, and
 * the one view where hiding it would leave anonymous rows is the one that
 * locks it.
 */
export const visibleColumns = (view, hidden = []) => {
  const putAway = new Set(hidden || []);
  return columnsFor(view).filter((c) => c.locked || !putAway.has(c.key));
};

/** How many of THIS view's columns are hidden - what the trigger button says. */
export const hiddenCount = (view, hidden = []) =>
  columnsFor(view).length - visibleColumns(view, hidden).length;

/**
 * The tier-1 header of the Per Flight table, sized to what is left.
 *
 * A group whose columns are all hidden disappears rather than spanning zero -
 * a `<th colSpan={0}>` is rendered by the browser as a full column, which puts
 * every heading after it one place out. The lead columns (Date, Flight,
 * Aircraft, Sector) have no group and are returned as `lead`, the width of the
 * blank cell that sits above them.
 */
export const groupSpans = (cols) => {
  const lead = cols.filter((c) => !c.group).length;
  const spans = GROUPS
    .map((g) => ({ ...g, span: cols.filter((c) => c.group === g.key).length }))
    .filter((g) => g.span > 0);
  return { lead, spans };
};

/* -------------------------------------------------------------------------
 * Remembering the choice.
 *
 * localStorage, so it survives a reload and follows the person rather than the
 * report. Deliberately NOT saved to the server: it is a preference about one
 * browser's screen width, not a company setting, and two people sharing a
 * login should not be rearranging each other's columns mid-shift.
 *
 * Every read is defensive. The value can be absent, stale JSON from an older
 * shape, or unreadable entirely - a private window, or site data blocked -
 * and none of those is a reason for a report to fail to open. An unknown key
 * in the stored list is kept rather than dropped: a column renamed in one
 * release and renamed back in the next should not silently un-hide.
 * ---------------------------------------------------------------------- */
export const STORAGE_KEY = 'odyssey.flightSummary.hiddenColumns';

export const readHidden = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
  } catch (e) {
    return [];
  }
};

export const writeHidden = (hidden) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden || []));
  } catch (e) {
    // Storage full, or blocked. The choice still applies for this session -
    // it simply will not be there next time, which is better than a report
    // that throws while someone is reading it.
  }
};

/* -------------------------------------------------------------------------
 * The workbook.
 *
 * WHAT A CELL HOLDS, as opposed to what it looks like. The screen renders a
 * figure through <Num>, which greys a nought and prints an em dash for a
 * missing value; a spreadsheet wants the number itself, so that Excel can sum
 * a column the office selects. These accessors are the single answer to "what
 * is in this cell", and the screen reads them too - a report and its export
 * that each fetch their own figures are two reports.
 *
 * A missing figure is `null`, never 0 and never '—': an empty cell reads as
 * "not recorded" in Excel, while a nought would be added into any total drawn
 * underneath it.
 * ---------------------------------------------------------------------- */

// Per Flight. `r` is a row of `rows` from the server.
export const FLIGHT_VALUES = {
  // The status marker travels with the flight number, because the workbook has
  // no colour to tint the row with and a row of noughts with nothing saying
  // why is the thing the tag exists to prevent.
  flightNo: (r) => [r.flightNo || '', r.xxld ? '(XXLD)' : r.notOp ? '(NOT-OP)' : '']
    .filter(Boolean).join(' '),
  date:         (r) => r.date || '',
  aircraft:     (r) => r.aircraft || '',
  sector:       (r) => r.sector || '',
  pfm:          (r) => r.pfm,
  manifest:     (r) => r.manifest,
  gamUplift:    (r) => r.uplift.GAM,
  gamOffload:   (r) => r.offload.GAM,
  ifaUplift:    (r) => r.uplift.IFA,
  ifaOffload:   (r) => r.offload.IFA,
  otherUplift:  (r) => r.uplift.Other,
  otherOffload: (r) => r.offload.Other,
  totalUplift:  (r) => r.totalUplift,
  totalOffload: (r) => r.totalOffload,
};

// The totals row. A column with no entry here prints nothing rather than a
// nought - a total of the flight numbers is not a thing.
export const FLIGHT_TOTALS = {
  pfm:          (t) => t.pfm,
  manifest:     (t) => t.manifest,
  gamUplift:    (t) => t.uplift.GAM,
  gamOffload:   (t) => t.offload.GAM,
  ifaUplift:    (t) => t.uplift.IFA,
  ifaOffload:   (t) => t.offload.IFA,
  otherUplift:  (t) => t.uplift.Other,
  otherOffload: (t) => t.offload.Other,
  totalUplift:  (t) => t.totalUplift,
  totalOffload: (t) => t.totalOffload,
};

// Flight Counts. `r` is a row of `byAircraft`.
export const COUNT_VALUES = {
  aircraft: (r) => r.aircraft,
  // An averaged PLA is marked on screen with a star and explained on hover.
  // Neither survives a spreadsheet, so the workbook says it in words - and
  // still in a cell of its own rather than appended to the number, which would
  // turn the column into text and stop it summing.
  pla:    (r) => r.pla,
  ttlFlt: (r) => r.ttlFlt,
  opFlt:  (r) => r.opFlt,
  xxld:   (r) => r.xxld,
  notOp:  (r) => r.notOp,
  ttlWgt: (r) => r.totalUplift,
};

export const COUNT_TOTALS = {
  // No PLA total: available payloads are capacities of different aircraft on
  // different days, and adding them up describes no flight.
  ttlFlt: (t) => t.flights,
  opFlt:  (t) => t.flights - t.xxld - t.notOp,
  xxld:   (t) => t.xxld,
  notOp:  (t) => t.notOp,
  ttlWgt: (t) => t.totalUplift,
};

/** Excel number format for a column. Text columns get none. */
export const numFormatFor = (col) =>
  (col.num ? (col.dp === 0 ? '#,##0' : '#,##0.00') : undefined);

/**
 * The whole sheet, as plain arrays - header, body, totals.
 *
 * Built here rather than inside the export function so the shape can be
 * tested without exceljs and without a browser: the failure this guards
 * against is a totals row that does not line up with its header once a column
 * has been put away, which is invisible until someone reads the workbook.
 *
 * `label` for a Per Flight column is qualified by its group, because five of
 * them are called Uplift or Offload and a flat spreadsheet header has no tier
 * above it to say which is which.
 */
export const sheetMatrix = (view, cols, rows, totals, groupLabels = {}) => {
  const counts = view === 'counts';
  const values = counts ? COUNT_VALUES : FLIGHT_VALUES;
  const totalsBy = counts ? COUNT_TOTALS : FLIGHT_TOTALS;

  const header = cols.map((c) => (
    c.group && groupLabels[c.group] ? `${groupLabels[c.group]} ${c.label}` : c.label
  ));

  const body = (rows || []).map((r) => cols.map((c) => {
    const v = values[c.key] ? values[c.key](r) : null;
    return v === undefined ? null : v;
  }));

  // The label goes in the first column, so the row reads as a row rather than
  // as figures floating under nothing.
  const foot = totals
    ? cols.map((c, i) => {
      if (totalsBy[c.key]) return totalsBy[c.key](totals);
      return i === 0 ? 'Total' : null;
    })
    : null;

  return { header, body, foot };
};

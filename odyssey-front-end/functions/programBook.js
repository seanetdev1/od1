import moment from 'moment';
import { planStates, stateOf, isMoved } from 'functions/customsPlanStatus';
import { DEFAULT_STATUSES, startOf } from 'functions/customsStatuses';

const DEFAULT_PLAN = DEFAULT_STATUSES.plan;

/**
 * THE PROGRAM BOOK'S GRID - what the screen keeps, what it sends, what it shows.
 *
 * No React, so it is tested on its own (__tests__/programBook.test.js).
 *
 * A row is a plan as the server sent it, or a new one, plus a `key` the grid
 * can hold on to before the server has given it an id. What is SAVED is only
 * what changed: a new row with something on it, or a saved one whose fields
 * differ from the copy the server sent (`original`). Each goes with its
 * `rowNo` - the number the grid shows - so a refusal can say which row.
 */

/** The fields a row edits - the sheet's columns, as the server's planValues takes them.
 *  Gate-In Time and Cut-Off are text, as typed (the user's rule, 2026-10-10).
 *  The containers are the row's section (containerList); the old Container No
 *  and Veh Detail cells are worked out from it on the server. */
export const PLAN_FIELDS = [
  'status', 'shipperId', 'invoiceNo', 'qty', 'size', 'pol', 'pod', 'shippingLineId',
  'transporterId', 'gateInTime', 'vessel', 'cutOff', 'bookingNo', 'currentStatus',
  'gdNumber', 'remarks', 'containerList',
];

const norm = (v) => (v === null || v === undefined ? '' : String(v).trim());

/* ---- a plan's containers - the row's expandable section -------------------
 * A line per container: its transporter, size, number and vehicle (the user's
 * request, 2026-10-10). As the server's asContainerList. */

/** Four letters, then seven digits - MSCU1234567. */
export const CONTAINER_NO = /^[A-Z]{4}\d{7}$/;
/** As typed, closed up: "mscu 123456-7" is MSCU1234567. */
export const asContainerNo = (v) => String(v ?? '').toUpperCase().replace(/[\s-]+/g, '');
/** Blank, or a well-formed number. */
export const containerNoOk = (v) => !asContainerNo(v) || CONTAINER_NO.test(asContainerNo(v));

/** A new line for a plan: its Transport and Size to start with. */
export const blankContainer = (plan) => ({
  transporterId: plan?.transporterId ?? null, size: plan?.size || '', containerNo: '', vehicleDetail: '',
});

const lineHasSomething = (c) => Boolean(c && (c.transporterId || norm(c.size) || norm(c.containerNo) || norm(c.vehicleDetail)));

/** The lines worth keeping, as the server will store them. */
export const cleanContainers = (list) => (Array.isArray(list) ? list : [])
  .filter(lineHasSomething)
  .map((c) => ({
    transporterId: c.transporterId ?? null,
    size: norm(c.size).toUpperCase() || null,
    containerNo: asContainerNo(c.containerNo) || null,
    vehicleDetail: norm(c.vehicleDetail) || null,
  }));

/** The numbers on a row that are not four letters and seven digits. */
export const badContainerNos = (row) => (Array.isArray(row?.containerList) ? row.containerList : [])
  .map((c) => c?.containerNo)
  .filter((n) => !containerNoOk(n));

/* An older plan kept its containers in two free-text cells - numbers in one,
   trucks in the other. Read into lines the way the server's containerRows
   reads them: a number each, trucks paired in order when there is one each. */
const legacyContainers = (plan) => {
  const numbers = String(plan?.containers ?? '').toUpperCase()
    .replace(/\b([A-Z]{4})\s+(\d{6,7})\b/g, '$1$2')
    .split(/[\s,;/]+/).map((x) => x.trim()).filter(Boolean);
  const trucks = String(plan?.vehicleDetail ?? '').split(/[,;/\n]+/).map((x) => x.trim()).filter(Boolean);
  if (!numbers.length) {
    return trucks.length ? [{ ...blankContainer(plan), transporterId: null, vehicleDetail: trucks.join(', ') }] : [];
  }
  const paired = trucks.length === numbers.length;
  return numbers.map((n, i) => ({
    transporterId: null,
    size: plan?.size || '',
    containerNo: n,
    vehicleDetail: paired ? trucks[i] : (i === 0 ? trucks.join(', ') : ''),
  }));
};

const parseList = (v) => {
  if (Array.isArray(v)) return v;
  try { const list = JSON.parse(v || '[]'); return Array.isArray(list) ? list : []; } catch (_) { return []; }
};

/** A plan from the server, as a grid row - its containers as lines. */
export const fromServer = (plan) => {
  const listed = parseList(plan.containerList);
  return {
    ...plan,
    key: `p-${plan.id}`,
    containerList: (listed.length ? listed : legacyContainers(plan)).map((c) => ({ ...blankContainer(), ...c })),
  };
};

/* A field as compared: the containers by their kept lines. */
const fieldKey = (row, f) => (f === 'containerList' ? JSON.stringify(cleanContainers(row[f])) : norm(row[f]));

/**
 * A new, empty row, at the status new rows start at (Configuration > Customs;
 * Pending unless changed). `seq` only has to be unique while the grid is open.
 */
export const newRow = (seq, list = DEFAULT_PLAN) => ({
  key: `new-${seq}`,
  ...Object.fromEntries(PLAN_FIELDS.map((f) => [f, null])),
  containerList: [],
  status: startOf(list),
});

/** Nothing typed on it - its status alone is not something (as the server's isBlankPlan). */
export const isBlankRow = (row) => PLAN_FIELDS.every((f) => f === 'status' || ['', '[]'].includes(fieldKey(row, f)));

/** Whether a saved row differs from the copy the server sent. */
export const rowChanged = (row, original) => (
  !original || PLAN_FIELDS.some((f) => fieldKey(row, f) !== fieldKey(original, f))
);

/**
 * The rows to send on Save: new ones with something on them, and saved ones
 * that changed - never a moved one, which the server would refuse.
 *
 * @param rows       every row in the book, in its order
 * @param originals  Map of key -> the row as the server sent it
 */
export const rowsToSave = (rows, originals) => rows
  .map((row, i) => ({ row, rowNo: i + 1 }))
  .filter(({ row }) => !isMoved(row) && (row.id
    ? rowChanged(row, originals.get(row.key))
    : !isBlankRow(row)))
  .map(({ row, rowNo }) => ({
    ...(row.id ? { id: row.id } : {}),
    ...Object.fromEntries(PLAN_FIELDS.map((f) => [f, f === 'containerList' ? cleanContainers(row[f]) : (row[f] ?? null)])),
    rowNo,
  }));

/**
 * THE TIME FILTER - by the date a row was ENTERED in the book (the user's
 * choice: every plan has one, where a gate-in or cut-off may be weeks away).
 */
export const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'fortnight', label: 'This fortnight' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom' },
];

/**
 * The days a period covers, `{ from, to }` as moments, both inclusive - or
 * null for All, and for a Custom range with neither end picked.
 *
 * A week runs Monday to Sunday. A FORTNIGHT is the half of the month today is
 * in - the 1st to the 15th, or the 16th to the month's end. Custom is the
 * range picked, either end open.
 */
export const periodRange = (period, custom = null, now = moment()) => {
  const day = moment(now);
  switch (period) {
    case 'today': return { from: day.clone().startOf('day'), to: day.clone().endOf('day') };
    case 'week': return { from: day.clone().startOf('isoWeek'), to: day.clone().endOf('isoWeek') };
    case 'fortnight': return day.date() <= 15
      ? { from: day.clone().startOf('month'), to: day.clone().date(15).endOf('day') }
      : { from: day.clone().date(16).startOf('day'), to: day.clone().endOf('month') };
    case 'month': return { from: day.clone().startOf('month'), to: day.clone().endOf('month') };
    case 'custom': {
      const [a, b] = custom || [];
      if (!a && !b) return null;
      return { from: a ? moment(a).startOf('day') : null, to: b ? moment(b).endOf('day') : null };
    }
    default: return null;
  }
};

/** Whether a row was entered within `range`. A row not saved yet always is. */
export const inPeriod = (row, range) => {
  if (!range || !row.id) return true;
  const at = moment(row.createdAt);
  if (!at.isValid()) return false;
  return (!range.from || !at.isBefore(range.from)) && (!range.to || !at.isAfter(range.to));
};

/**
 * How many plans each status filter would show - over every row in the
 * period, not only the ones the status filter lets through.
 */
export const stateCounts = (rows, { list = DEFAULT_PLAN, range = null } = {}) => {
  const counts = Object.fromEntries(planStates(list).map((s) => [s, 0]));
  for (const r of rows) {
    if (r.id && inPeriod(r, range)) counts[stateOf(r, list)] = (counts[stateOf(r, list)] || 0) + 1;
  }
  return counts;
};

/**
 * The rows the grid shows, each with its book number (`rowNo`), which does not
 * change with the filter - the sheet's S NO stays on its row.
 *
 * `states` empty means every state. A new row is always shown: hiding the row
 * somebody just added, because it is Pending and Pending is filtered out,
 * would look like Add Row did nothing. `search` matches any of the text a
 * person would have in hand, case-insensitive; `nameOf` turns a party id into
 * its name for that. `range` is the time filter's (periodRange) - the date
 * entered; null is every date. `list` is the plan statuses.
 */
export const visibleRows = (rows, {
  states, search = '', nameOf = () => '', range = null, list = DEFAULT_PLAN,
}) => {
  const q = norm(search).toLowerCase();
  return rows
    .map((row, i) => ({ row, rowNo: i + 1 }))
    .filter(({ row }) => inPeriod(row, range))
    .filter(({ row }) => !row.id || !states?.size || states.has(stateOf(row, list)))
    .filter(({ row }) => !q || !row.id || [
      row.invoiceNo, row.bookingNo, row.vessel, row.gdNumber, row.remarks,
      row.currentStatus, row.Customs_Job?.jobNo,
      nameOf(row.shipperId), nameOf(row.shippingLineId), nameOf(row.transporterId),
      ...(row.containerList || []).flatMap((c) => [c.containerNo, c.vehicleDetail, nameOf(c.transporterId)]),
    ].some((v) => norm(v).toLowerCase().includes(q)));
};

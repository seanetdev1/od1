/**
 * THE PROGRAM BOOK - a customs install's planned jobs (Customs_Plan).
 *
 * The rules, apart from the route so they can be tested without a database:
 * what a plan's status is, which plans may be moved to the jobs list, what a
 * row from the screen may write, and what job a plan becomes.
 *
 * The status rule is MIRRORED by the frontend's functions/customsPlanStatus,
 * because the screen decides which rows can be ticked for a move and the
 * server decides whether the move happens. Two different rules would offer a
 * row the server then refuses - change one, change the other; both are tested
 * on the same cases.
 */

const {
  DEFAULT_STATUSES, resolveStatus, startOf, hasRule, labelOf, valuesWith,
} = require('./customsStatuses');

// THE STATUSES are Configuration > Customs' (functions/customsStatuses): the
// route reads them and passes the plan list in. Left out, the built-in three
// apply - Pending (new rows), Confirmed (moved), Cancelled (closed).
const DEFAULT_PLAN_STATUSES = DEFAULT_STATUSES.plan;
const PENDING = 'Pending';
const CONFIRMED = 'Confirmed';
const CANCELLED = 'Cancelled';
// Not a stored status: a plan that has a job. See stateOf.
const MOVED = 'Moved';

/** The built-in JOB STATUS list, in the order the dropdown offers it. */
const PLAN_STATUSES = [PENDING, CONFIRMED, CANCELLED];
/** What the list can be filtered by: the statuses, and the moved ones. */
const PLAN_STATES = [...PLAN_STATUSES, MOVED];
const planStates = (list = DEFAULT_PLAN_STATUSES) => [...list.map((s) => s.value), MOVED];

/**
 * A stored status as it should be read. Blank is where new rows start.
 * An unrecognised value is returned as itself rather than relabelled: it came
 * from the database, and hiding it would hide whatever put it there.
 */
const statusOf = (plan, list = DEFAULT_PLAN_STATUSES) => String(plan?.status ?? '').trim() || startOf(list);

const isMoved = (plan) => Boolean(plan?.CustomsJobId);

/** Which list a plan is filed under: Moved once it has a job, else its status. */
const stateOf = (plan, list = DEFAULT_PLAN_STATUSES) => (isMoved(plan) ? MOVED : statusOf(plan, list));

/**
 * Why this plan may NOT be moved to the jobs list - or null if it may.
 *
 * Only a plan at a status whose rules allow it is moved (Confirmed, unless
 * configured otherwise), and only once: the move gives it a job number, and a
 * plan moved twice would be one shipment on two jobs. `jobNo` names the job it
 * already became, when the caller knows it.
 */
const moveRefusal = (plan, jobNo = null, list = DEFAULT_PLAN_STATUSES) => {
  if (!plan) return 'That plan no longer exists.';
  if (isMoved(plan)) return `it is already on the jobs list${jobNo ? ` as ${jobNo}` : ''}.`;
  const status = statusOf(plan, list);
  if (hasRule(list, status, 'movable')) return null;
  const label = labelOf(list, status);
  if (hasRule(list, status, 'faded')) return `it is ${label} - a closed plan is not moved.`;
  const movable = valuesWith(list, 'movable').map((v) => labelOf(list, v));
  return `it is ${label} - set its Job Status to ${movable.join(' or ')} first.`;
};

/** A plan as a person would name it in a message: its shipper and invoice. */
const describePlan = (plan) => {
  const shipper = plan?.shipper?.name || null;
  const invoice = String(plan?.invoiceNo || '').trim();
  const parts = [shipper, invoice && `invoice ${invoice}`].filter(Boolean);
  return parts.length ? parts.join(', ') : `plan ${plan?.id ?? ''}`.trim();
};

// ---- a row from the screen ---------------------------------------------------

class PlanError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/* GATE-IN TIME AND CUT-OFF ARE TEXT, as typed - "12-OCT 1800", "TBA", "after
   customs" (the user's rule, 2026-10-10). They were a date-time picker, which
   the program as it is actually written could not be put into. */
const TEXT_FIELDS = [
  'invoiceNo', 'size', 'pol', 'pod', 'containers', 'gateInTime', 'vessel', 'cutOff',
  'bookingNo', 'currentStatus', 'gdNumber', 'remarks', 'vehicleDetail',
];
// Typed in capitals on every document they come off.
const UPPER_FIELDS = ['size', 'containers'];

/* A CONTAINER NUMBER is four letters then seven digits - MSCU1234567, the
   owner code, the equipment category and the serial with its check digit
   (ISO 6346), as painted on the box (the user's rule, 2026-10-10). Spaces and
   dashes typed inside one are closed up, so "MSCU 123456-7" is the same box. */
const CONTAINER_NO = /^[A-Z]{4}\d{7}$/;
const asContainerNo = (v) => String(v ?? '').toUpperCase().replace(/[\s-]+/g, '');
const isContainerNo = (v) => CONTAINER_NO.test(asContainerNo(v));

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

const asId = (v) => {
  const s = String(v ?? '').trim();
  return /^[0-9]+$/.test(s) ? Number(s) : null;
};

// By stored value or by name; blank is where new rows start.
const asStatus = (v, list = DEFAULT_PLAN_STATUSES) => {
  const match = resolveStatus(list, v);
  if (match === undefined) {
    throw new PlanError(`"${String(v).trim()}" is not a job status - use ${list.map((s) => s.label).join(', ')}.`);
  }
  return match || startOf(list);
};

/**
 * THE PLAN'S CONTAINERS - the row's expandable section: a line per container,
 * with its transporter, size, number and vehicle (the user's request,
 * 2026-10-10). Kept on the plan as JSON (containerList); the old free-text
 * Container No and Veh Detail cells are worked out from it, for search and
 * for anything that still reads them.
 *
 * A line with nothing on it is dropped. A number that is not four letters and
 * seven digits is refused, naming it.
 */
const MAX_PLAN_CONTAINERS = 50;
const asContainerList = (v) => {
  let list = v;
  if (typeof v === 'string') {
    try { list = JSON.parse(v); } catch (_) { list = []; }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list) {
    const line = {
      transporterId: asId(c?.transporterId),
      size: clean(c?.size) ? clean(c.size).toUpperCase() : null,
      containerNo: clean(asContainerNo(c?.containerNo)),
      vehicleDetail: clean(c?.vehicleDetail),
    };
    if (!line.transporterId && !line.size && !line.containerNo && !line.vehicleDetail) continue;
    if (line.containerNo && !CONTAINER_NO.test(line.containerNo)) {
      throw new PlanError(`Container No "${c.containerNo}" must be 4 letters then 7 digits, e.g. MSCU1234567.`);
    }
    out.push(line);
  }
  if (out.length > MAX_PLAN_CONTAINERS) {
    throw new PlanError(`At most ${MAX_PLAN_CONTAINERS} containers on one plan.`);
  }
  return out;
};

/** A stored plan's containers, as a list - [] for none, or for an older plan
 *  kept in the free-text cells only. */
const planContainers = (plan) => {
  try { return asContainerList(plan?.containerList); } catch (_) { return []; }
};

const asQty = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new PlanError(`Qty must be a whole number of containers, not "${v}".`);
  return n;
};

/**
 * What a row from the screen may write - a whitelist, as jobValues is on the
 * job. Throws PlanError for a value no plan can hold.
 */
const planValues = (row, list = DEFAULT_PLAN_STATUSES) => {
  const values = {
    status: asStatus(row?.status, list),
    shipperId: asId(row?.shipperId),
    shippingLineId: asId(row?.shippingLineId),
    // TRANSPORT - who hauls it (the user's request, 2026-10-10); the job's
    // Transporter once it is moved.
    transporterId: asId(row?.transporterId),
    qty: asQty(row?.qty),
  };
  for (const f of TEXT_FIELDS) {
    const v = clean(row?.[f]);
    values[f] = v && UPPER_FIELDS.includes(f) ? v.toUpperCase() : v;
  }
  // The section, when the screen sent one - a list, or the JSON the server
  // gave out. Null is not "emptied": a plan read back and resent as it came
  // carries containerList: null when it was only ever kept in the two old
  // cells, and those must not be wiped. The two old cells follow the list.
  const sentList = Array.isArray(row?.containerList)
    || (typeof row?.containerList === 'string' && row.containerList.trim() !== '');
  if (sentList) {
    const list = asContainerList(row.containerList);
    values.containerList = list.length ? JSON.stringify(list) : null;
    values.containers = list.map((c) => c.containerNo).filter(Boolean).join(', ') || null;
    values.vehicleDetail = list.map((c) => c.vehicleDetail).filter(Boolean).join(', ') || null;
  }
  return values;
};

/** A row with nothing typed on it - an Add Row nobody filled. Status alone is not something. */
const isBlankPlan = (row) => !(
  asId(row?.shipperId) || asId(row?.shippingLineId) || asId(row?.transporterId)
  || (row?.qty !== null && row?.qty !== undefined && String(row.qty).trim() !== '')
  || TEXT_FIELDS.some((f) => clean(row?.[f]))
  || (Array.isArray(row?.containerList) && row.containerList.some((c) => c && Object.values(c).some((x) => clean(x))))
);

// ---- the job a plan becomes ---------------------------------------------------

/**
 * The container numbers in a CONTAINER NO cell, one each.
 *
 * Separated by commas, semicolons, slashes or new lines - and by spaces, once a
 * number typed as "MSKU 1234567" (owner code, space, serial: how they are
 * painted on the box) has been closed up, so the space inside one number is
 * not read as the gap between two.
 */
const containerNumbers = (text) => String(text ?? '')
  .toUpperCase()
  .replace(/\b([A-Z]{4})\s+(\d{6,7})\b/g, '$1$2')
  .split(/[\s,;/]+/)
  .map((x) => x.trim())
  .filter(Boolean);

/**
 * The trucks in a VEH DETAIL cell. NOT split on spaces: a plate is "JW 1234".
 */
const vehicleNumbers = (text) => String(text ?? '')
  .split(/[,;/\n]+/)
  .map((x) => x.trim())
  .filter(Boolean);

// A Qty of 400 is a typing mistake, not 400 containers to list.
const MAX_CONTAINER_ROWS = 50;

/**
 * The job's container rows: one per container number, each with the plan's
 * size - and, when Qty says more containers than there are numbers yet, a row
 * for each of the rest with its size and no number, to be filled on the job.
 *
 * Trucks are matched to containers in order when there is one for each, or
 * put on the only container there is. Any other VEH DETAIL - two trucks for
 * three boxes, a driver's name - cannot be placed on a container, so it is
 * returned as `vehicleLeftOver` for the job's remarks rather than dropped.
 */
const containerRows = (plan) => {
  // The section's lines, each as entered - padded to Qty with the plan's size.
  const listed = planContainers(plan);
  if (listed.length) {
    const size = clean(plan?.size);
    const count = Math.min(Math.max(listed.length, Number(plan?.qty) || 0), MAX_CONTAINER_ROWS);
    const rows = [];
    for (let i = 0; i < count; i++) {
      const c = listed[i] || {};
      rows.push({
        containerNo: c.containerNo || '',
        sizeType: c.size || (size ? size.toUpperCase() : null),
        truckNo: c.vehicleDetail || null,
        transporterId: c.transporterId || null,
        sortOrder: i,
      });
    }
    return { rows, numbers: listed.map((c) => c.containerNo).filter(Boolean), vehicleLeftOver: null };
  }
  const numbers = containerNumbers(plan?.containers);
  const trucks = vehicleNumbers(plan?.vehicleDetail);
  const size = clean(plan?.size);
  const count = Math.min(Math.max(numbers.length, Number(plan?.qty) || 0), MAX_CONTAINER_ROWS);
  const pairTrucks = count > 0 && trucks.length === count;
  const onlyOne = count === 1 && trucks.length > 0;
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      containerNo: numbers[i] || '',
      sizeType: size ? size.toUpperCase() : null,
      truckNo: pairTrucks ? trucks[i] : (onlyOne ? clean(plan.vehicleDetail) : null),
      sortOrder: i,
    });
  }
  const placed = pairTrucks || onlyOne;
  return { rows, numbers, vehicleLeftOver: !placed && trucks.length ? clean(plan.vehicleDetail) : null };
};

/**
 * The Customs_Job a plan becomes, less its number, company and fiscal year -
 * the route draws those when it creates it.
 *
 * An EXPORT BY SEA: a program book is a shipping program - gate-in, cut-off,
 * vessel, booking. The shipper is the client too, as on almost every export;
 * the job can say otherwise once it exists. Job Type and S/R Page # are left
 * for the job screen, which asks for them on its first save.
 *
 * `today` is passed in ('YYYY-MM-DD') for the job date, so this stays pure;
 * `jobStatus` is where new jobs start (Configuration > Customs) - In Process
 * unless configured otherwise.
 */
const jobFromPlan = (plan, { today, jobStatus = 'Incomplete' }) => {
  const { rows, numbers, vehicleLeftOver } = containerRows(plan);
  const remarks = [clean(plan?.remarks), vehicleLeftOver && `Vehicle: ${vehicleLeftOver}`]
    .filter(Boolean).join('\n') || null;
  const invoiceNo = clean(plan?.invoiceNo);
  const size = clean(plan?.size);
  return {
    values: {
      direction: 'Export',
      transportMode: 'Sea',
      clientId: plan?.shipperId || null,
      shipperId: plan?.shipperId || null,
      // One number in both columns, as the job screen writes it.
      invoiceNo,
      clientRef: invoiceNo,
      pol: clean(plan?.pol),
      pod: clean(plan?.pod),
      // The job screen mirrors Port Of Discharge into Final Destination until
      // somebody changes it; a moved plan starts the same way.
      pofd: clean(plan?.pod),
      shippingLineId: plan?.shippingLineId || null,
      // The plan's Transport, else the first container's transporter.
      transporterId: plan?.transporterId || rows.find((r) => r.transporterId)?.transporterId || null,
      vesselOrFlight: clean(plan?.vessel),
      carrierBookingNo: clean(plan?.bookingNo),
      gateInTime: clean(plan?.gateInTime),
      cutOff: clean(plan?.cutOff),
      currentStatus: clean(plan?.currentStatus),
      gdNumber: clean(plan?.gdNumber),
      containers: numbers.length ? numbers.join(', ') : null,
      containerType: size ? size.toUpperCase() : null,
      cargoType: rows.length ? 'FCL' : null,
      remarks,
      jobDate: today,
      status: jobStatus,
    },
    containers: rows,
  };
};

module.exports = {
  PENDING, CONFIRMED, CANCELLED, MOVED, PLAN_STATUSES, PLAN_STATES, planStates,
  statusOf, isMoved, stateOf, moveRefusal, describePlan,
  PlanError, planValues, isBlankPlan,
  containerNumbers, vehicleNumbers, containerRows, jobFromPlan, MAX_CONTAINER_ROWS,
  CONTAINER_NO, asContainerNo, isContainerNo, asContainerList, planContainers, MAX_PLAN_CONTAINERS,
};

import { PAYABLE } from './customsPricing';
import { DEFAULT_STATUSES, labelOf, valuesWith } from './customsStatuses';

/**
 * What a customs job's status is CALLED on screen.
 *
 * The stored values stay 'Incomplete' / 'Complete' - the Climax migration
 * writes them - so names are labels, not a data change. Configuration >
 * Customs sets them now (functions/customsStatuses); pass its job list. Left
 * out, the built-in names: CargoLinkers call those stages "In Process" and
 * "On Vessel", and DrayOff is a stage of its own - a file that ends at the
 * container drop.
 */
const DEFAULT_JOB = DEFAULT_STATUSES.job;

/** The built-in statuses in the order a file moves through them, as stored. */
export const STATUS_ORDER = DEFAULT_JOB.map((s) => s.value);

export const customsStatusLabel = (status, list = DEFAULT_JOB) => labelOf(list, status);

export default customsStatusLabel;

/**
 * Whether a charge has to wait before it can be approved: every receivable,
 * until the job is at a status whose rules allow it - On Vessel (stored
 * 'Complete') or DrayOff unless Configuration > Customs says otherwise. The
 * server holds the same rule. Payables are never held.
 */
export const ON_VESSEL = 'Complete';
export const BILLABLE_STATUSES = valuesWith(DEFAULT_JOB, 'billable');
export const receivableWaitsForVessel = (charge, jobStatus, list = DEFAULT_JOB) =>
  Boolean(charge) && charge.type !== PAYABLE && !valuesWith(list, 'billable').includes(jobStatus);

/** "On Vessel or DrayOff" - the statuses a receivable can be approved at, by name. */
export const billableLabels = (list = DEFAULT_JOB) =>
  valuesWith(list, 'billable').map((v) => labelOf(list, v)).join(' or ');

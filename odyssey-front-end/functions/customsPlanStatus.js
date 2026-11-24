import {
  DEFAULT_STATUSES, startOf, hasRule, labelOf, valuesWith,
} from 'functions/customsStatuses';

/**
 * The life of a planned customs job - one row of the Program Book.
 *
 * Its Job Status is one of the plan statuses Configuration > Customs lists
 * (functions/customsStatuses), and what a status allows is its rules: which
 * one a new row starts at, which may be MOVED to the jobs list, which the book
 * shows on opening, which are closed. Pass the list in; left out, the built-in
 * three apply:
 *
 *   Pending    written down; the client has not confirmed the shipment.
 *   Confirmed  going ahead - the only one that may be moved.
 *   Cancelled  not going ahead. Kept, not deleted, so the book shows it.
 *   Moved      not stored - a plan with a job. Frozen from then on: the job
 *              is the record, and the book shows the job's own status.
 *
 * MIRRORS the server's functions/customsPlan, which refuses the move. The
 * screen uses this to decide which rows can be ticked; the two must agree or
 * the screen offers a move the server refuses. Both are tested on the same
 * cases (__tests__/customsPlanStatus.test.js here).
 */

const DEFAULT_PLAN = DEFAULT_STATUSES.plan;

export const PENDING = 'Pending';
export const CONFIRMED = 'Confirmed';
export const CANCELLED = 'Cancelled';
export const MOVED = 'Moved';

/** The built-in JOB STATUS list, in the order the dropdown offers it. */
export const PLAN_STATUSES = DEFAULT_PLAN.map((s) => s.value);
/** What the book can be filtered by: the statuses, and the moved plans. */
export const PLAN_STATES = [...PLAN_STATUSES, MOVED];
export const planStates = (list = DEFAULT_PLAN) => [...list.map((s) => s.value), MOVED];

export const statusOf = (plan, list = DEFAULT_PLAN) => String(plan?.status ?? '').trim() || startOf(list);
export const isMoved = (plan) => Boolean(plan?.CustomsJobId);
export const stateOf = (plan, list = DEFAULT_PLAN) => (isMoved(plan) ? MOVED : statusOf(plan, list));

/** Why this plan may not be moved to the jobs list - or null if it may. */
export const moveRefusal = (plan, jobNo = null, list = DEFAULT_PLAN) => {
  if (!plan) return 'That plan no longer exists.';
  if (isMoved(plan)) return `it is already on the jobs list${jobNo ? ` as ${jobNo}` : ''}.`;
  const status = statusOf(plan, list);
  if (hasRule(list, status, 'movable')) return null;
  const label = labelOf(list, status);
  if (hasRule(list, status, 'faded')) return `it is ${label} - a closed plan is not moved.`;
  const movable = valuesWith(list, 'movable').map((v) => labelOf(list, v));
  return `it is ${label} - set its Job Status to ${movable.join(' or ')} first.`;
};

/** The built-in colours; the configured ones come with their statuses. */
export const STATE_COLORS = {
  ...Object.fromEntries(DEFAULT_PLAN.map((s) => [s.value, s.color])), [MOVED]: 'blue',
};

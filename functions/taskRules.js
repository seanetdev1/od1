/**
 * The task vocabulary, and the rules that go with it.
 *
 * Status was a free STRING enforced only by a dropdown - the API accepted
 * anything. One typo ("Done " with a trailing space, "done", "Complete") and
 * the task silently vanished from every active list, with no error anywhere,
 * because the filter matches exact strings. That is a data-quality bug that
 * looks like a disappearing task.
 *
 * Kept out of the model as a plain list rather than a Postgres ENUM: an ENUM
 * needs a migration to change, and these will change. Validation happens at the
 * API boundary where a bad value can be reported to the caller.
 *
 * No model imports - so it can be unit tested without a database.
 */

/** The only statuses a task may hold. Order is the intended workflow. */
const STATUSES = ['Backlog', 'In-progress', 'In-Review', 'Done'];

/** Statuses that still need doing. Everything not here is finished. */
const ACTIVE_STATUSES = ['Backlog', 'In-progress', 'In-Review'];

/** Terminal statuses - reaching one is what triggers a recurrence. */
const DONE_STATUSES = ['Done'];

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const RECURRENCES = ['none', 'daily', 'weekly', 'monthly', 'quarterly'];

/**
 * Accept a status only if it is one of ours, case-insensitively, and return
 * the canonical spelling. Returns null for anything else.
 *
 * Case-insensitive on purpose: "done" from an API client is unambiguous, and
 * silently dropping the task from every list is a worse answer than accepting
 * it and storing "Done".
 */
function normaliseStatus(value) {
  if (value === undefined || value === null || value === '') return null;
  const wanted = String(value).trim().toLowerCase();
  return STATUSES.find((s) => s.toLowerCase() === wanted) || null;
}

function normalisePriority(value) {
  if (value === undefined || value === null || value === '') return null;
  const wanted = String(value).trim().toLowerCase();
  return PRIORITIES.find((p) => p.toLowerCase() === wanted) || null;
}

function normaliseRecurrence(value) {
  if (value === undefined || value === null || value === '') return 'none';
  const wanted = String(value).trim().toLowerCase();
  return RECURRENCES.find((r) => r === wanted) || null;
}

const isActive = (status) => status == null || ACTIVE_STATUSES.includes(status);
const isDone = (status) => DONE_STATUSES.includes(status);

/**
 * The same date one interval later.
 *
 * Uses UTC date arithmetic rather than adding milliseconds: adding 30 days to
 * a monthly task drifts off the day of the month, and adding 7*24h across a
 * daylight-saving boundary lands an hour out. Month-end is clamped, so the
 * 31st of a month recurring monthly lands on the 30th, not the 1st.
 */
function nextOccurrence(from, recurrence) {
  if (!from || !recurrence || recurrence === 'none') return null;
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return null;

  const addMonths = (date, n) => {
    const day = date.getUTCDate();
    const target = new Date(Date.UTC(
      date.getUTCFullYear(), date.getUTCMonth() + n, 1,
      date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()
    ));
    // Clamp: 31 Jan + 1 month is 28/29 Feb, not 3 March.
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return target;
  };

  switch (recurrence) {
    case 'daily':     d.setUTCDate(d.getUTCDate() + 1); return d;
    case 'weekly':    d.setUTCDate(d.getUTCDate() + 7); return d;
    case 'monthly':   return addMonths(d, 1);
    case 'quarterly': return addMonths(d, 3);
    default:          return null;
  }
}

module.exports = {
  STATUSES, ACTIVE_STATUSES, DONE_STATUSES, PRIORITIES, RECURRENCES,
  normaliseStatus, normalisePriority, normaliseRecurrence,
  isActive, isDone, nextOccurrence,
};

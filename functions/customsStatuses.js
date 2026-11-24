import { useEffect, useState } from 'react';
import { getCustomsStatuses } from 'apis/customsStatuses';

/**
 * THE STATUSES a customs job and a Program Book plan can be at, and the RULES
 * each follows - as Configuration > Customs sets them. The server's
 * functions/customsStatuses is the rule; this is the copy the screens label,
 * colour and offer by, and it MUST agree with it - the server refuses what this
 * would offer otherwise.
 *
 * A status is `{ value, label, color, rules, hidden }`: `value` is stored on
 * the row and never changes, `label` is what it is called, `hidden` means
 * retired - kept on the rows that have it, no longer offered.
 *
 *   jobs   start     a new job is at this status
 *          billable  its receivable charges can be approved
 *          finished  not counted as an open file
 *   plans  start     a new row is at this status
 *          movable   may be moved to the jobs list
 *          shown     shown when the book opens
 *          faded     closed - faded in the book
 *
 * The defaults are what the screens did before there was a setting, so they
 * are right until it loads, and on a server that does not have it yet.
 */

export const DEFAULT_STATUSES = {
  job: [
    { value: 'Incomplete', label: 'In Process', color: 'blue', rules: ['start'], hidden: false },
    { value: 'Complete', label: 'On Vessel', color: 'green', rules: ['billable', 'finished'], hidden: false },
    { value: 'DrayOff', label: 'DrayOff', color: 'purple', rules: ['billable', 'finished'], hidden: false },
    { value: 'Canceled', label: 'Canceled', color: 'red', rules: ['finished'], hidden: false },
  ],
  plan: [
    { value: 'Pending', label: 'Pending', color: 'gold', rules: ['start', 'shown'], hidden: false },
    { value: 'Confirmed', label: 'Confirmed', color: 'green', rules: ['movable', 'shown'], hidden: false },
    { value: 'Cancelled', label: 'Cancelled', color: 'red', rules: ['faded'], hidden: false },
  ],
};

export const STATUS_RULES = {
  job: [
    { id: 'start', label: 'New jobs start at this status', one: true },
    { id: 'billable', label: 'Receivable charges can be approved' },
    { id: 'finished', label: 'Finished - not counted as an open file' },
  ],
  plan: [
    { id: 'start', label: 'New rows start at this status', one: true },
    { id: 'movable', label: 'Can be moved to the jobs list' },
    { id: 'shown', label: 'Shown when the book opens' },
    { id: 'faded', label: 'Closed - faded in the book' },
  ],
};

export const STATUS_COLORS = [
  'blue', 'green', 'purple', 'red', 'gold', 'orange', 'cyan', 'magenta', 'volcano', 'geekblue', 'lime', 'default',
];

/** The statuses the code itself writes - renamed, never removed. */
export const BUILT_IN_STATUSES = {
  job: DEFAULT_STATUSES.job.map((s) => s.value),
  plan: DEFAULT_STATUSES.plan.map((s) => s.value),
};

const usable = (list) => Array.isArray(list) && list.length > 0;
/** The server's answer as both lists - the defaults for one it did not send. */
export const asStatuses = (result) => ({
  job: usable(result?.job) ? result.job : DEFAULT_STATUSES.job,
  plan: usable(result?.plan) ? result.plan : DEFAULT_STATUSES.plan,
});

// ---- reading a list -----------------------------------------------------------

export const entryOf = (list, value) => (list || []).find((s) => s.value === value) || null;
export const labelOf = (list, value) => entryOf(list, value)?.label || value || '';
export const colorOf = (list, value) => entryOf(list, value)?.color || 'default';
export const hasRule = (list, value, rule) => Boolean(entryOf(list, value)?.rules?.includes(rule));
export const valuesWith = (list, rule) => (list || []).filter((s) => s.rules?.includes(rule)).map((s) => s.value);
export const startOf = (list) => ((list || []).find((s) => s.rules?.includes('start')) || (list || [])[0])?.value || null;

/**
 * What a dropdown offers: every status still offered, and the one the row is
 * at even when it has been retired - so it shows, rather than an empty box.
 */
export const offeredStatuses = (list, current) => (list || [])
  .filter((s) => !s.hidden || s.value === current)
  .map((s) => ({ value: s.value, label: s.label }));

// ---- loaded once, shared ------------------------------------------------------

let cache = null;
let pending = null;
const listeners = new Set();

const publish = (value) => {
  cache = value;
  listeners.forEach((l) => l(value));
};

/** The setting, from the server once per page load (`force` asks again). */
export const loadCustomsStatuses = (force = false) => {
  if (cache && !force) return Promise.resolve(cache);
  if (pending && !force) return pending;
  pending = getCustomsStatuses()
    .then((res) => {
      if (res?.status !== 'success') throw new Error(res?.result);
      const value = asStatuses(res.result);
      publish(value);
      return value;
    })
    // Not loaded: the defaults for now; the next screen to open asks again.
    .catch(() => cache || DEFAULT_STATUSES)
    .finally(() => { pending = null; });
  return pending;
};

/** After Configuration saves: every screen open shows the new statuses. */
export const setCustomsStatuses = (result) => publish(asStatuses(result));

/** For tests: forget what was loaded. */
export const resetCustomsStatuses = () => {
  cache = null;
  pending = null;
};

/** `{ job, plan }` - the defaults until the setting has loaded. */
export const useCustomsStatuses = () => {
  const [value, setValue] = useState(() => cache || DEFAULT_STATUSES);
  useEffect(() => {
    let alive = true;
    const listener = (v) => { if (alive) setValue(v); };
    listeners.add(listener);
    loadCustomsStatuses().then(listener);
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, []);
  return value;
};

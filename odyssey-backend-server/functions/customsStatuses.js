/**
 * THE STATUSES a customs job and a Program Book plan can be at, and the RULES
 * each one carries - as Configuration > Customs sets them (AppSetting
 * `customsStatuses`). Pure, so it is tested without a database.
 *
 * A STATUS is what is stored on the row (`value`), what it is called on
 * screen (`label`), its colour, whether it is still offered (`hidden` keeps a
 * retired one on the rows that have it without offering it again), and the
 * rules it follows. The rules are the behaviour the code used to tie to
 * particular words:
 *
 *   jobs   start     a new job is at this status (one only)
 *          billable  its receivable charges can be approved - On Vessel and
 *                    DrayOff were the stages a client is billed at
 *          finished  not counted as an open file on the dashboard
 *   plans  start     a new row is at this status (one only)
 *          movable   may be moved to the jobs list - Confirmed was
 *          shown     shown when the book opens
 *          faded     closed - faded in the book, as Cancelled was
 *
 * The defaults are exactly what the code did before, so an install that never
 * opens the setting works as it did.
 *
 * THE VALUE NEVER CHANGES once a status exists: renaming changes the label
 * only, so 24,000 jobs stored as 'Complete' stay On Vessel whatever it is
 * called. A new status is stored under the name it was first given. The
 * statuses the code itself writes (the Climax migration, Cancel Job, the plan
 * model's default) are BUILT IN: they can be renamed, recoloured, given other
 * rules or hidden, never removed. Neither is a status still on a row.
 *
 * MIRRORED by the frontend's functions/customsStatuses - the screen offers and
 * labels with the same rules the server enforces.
 */

const JOB_RULES = [
  { id: 'start', label: 'New jobs start at this status', one: true },
  { id: 'billable', label: 'Receivable charges can be approved' },
  { id: 'finished', label: 'Finished - not counted as an open file' },
];
const PLAN_RULES = [
  { id: 'start', label: 'New rows start at this status', one: true },
  { id: 'movable', label: 'Can be moved to the jobs list' },
  { id: 'shown', label: 'Shown when the book opens' },
  { id: 'faded', label: 'Closed - faded in the book' },
];
const RULES = { job: JOB_RULES, plan: PLAN_RULES };

/** The tag colours a status can have - antd's presets, and grey. */
const COLORS = [
  'blue', 'green', 'purple', 'red', 'gold', 'orange', 'cyan', 'magenta', 'volcano', 'geekblue', 'lime', 'default',
];

const DEFAULT_STATUSES = {
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
const BUILT_IN = {
  job: DEFAULT_STATUSES.job.map((s) => s.value),
  plan: DEFAULT_STATUSES.plan.map((s) => s.value),
};
const KINDS = ['job', 'plan'];
const MAX_STATUSES = 20;
const MAX_LABEL = 40;

class StatusError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const ruleIds = (kind) => RULES[kind].map((r) => r.id);
const copy = (list) => list.map((s) => ({ ...s, rules: [...s.rules] }));
const lc = (v) => String(v ?? '').trim().toLowerCase();
const inRuleOrder = (kind, rules) => ruleIds(kind).filter((r) => rules.includes(r));

/**
 * One list as stored, made whole - the READ side, so it never throws: unknown
 * rules and colours dropped, every built-in status present, exactly one start
 * (and it offered).
 */
function normalizeList(kind, list) {
  const defaults = DEFAULT_STATUSES[kind];
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const value = String(s?.value ?? '').trim();
    if (!value || seen.has(lc(value))) continue;
    seen.add(lc(value));
    const fallback = defaults.find((d) => d.value === value);
    out.push({
      value,
      label: String(s?.label ?? '').trim().slice(0, MAX_LABEL) || fallback?.label || value,
      color: COLORS.includes(s?.color) ? s.color : (fallback?.color || 'default'),
      rules: inRuleOrder(kind, Array.isArray(s?.rules) ? s.rules : []),
      hidden: Boolean(s?.hidden),
    });
  }
  for (const d of defaults) {
    if (!seen.has(lc(d.value))) out.push({ ...d, rules: [...d.rules] });
  }
  const said = out.findIndex((s) => s.rules.includes('start'));
  const at = said >= 0 ? said : out.findIndex((s) => s.value === defaults.find((d) => d.rules.includes('start')).value);
  out.forEach((s, i) => {
    s.rules = s.rules.filter((r) => r !== 'start');
    if (i === at) {
      s.rules = inRuleOrder(kind, ['start', ...s.rules]);
      s.hidden = false;
    }
  });
  return out;
}

/** The setting as stored (a JSON string, or nothing yet) -> both lists, whole. */
function normalizeStatuses(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  }
  return Object.fromEntries(KINDS.map((k) => [k, normalizeList(k, parsed?.[k] ?? copy(DEFAULT_STATUSES[k]))]));
}

/**
 * One list as an admin SENT it - the WRITE side, which refuses what would
 * break the books rather than repairing it quietly.
 *
 * @param previous  the list as it stands, normalized - whose values are kept
 * @param inUse     Map value -> how many rows carry it
 */
function validateList(kind, list, previous, inUse = new Map()) {
  const noun = kind === 'job' ? 'job' : 'Program Book';
  const rows = kind === 'job' ? 'job' : 'plan';
  if (!Array.isArray(list) || !list.length) throw new StatusError(`The ${noun} statuses are missing.`);
  if (list.length > MAX_STATUSES) throw new StatusError(`At most ${MAX_STATUSES} ${noun} statuses.`);

  const known = new Map(previous.map((s) => [lc(s.value), s.value]));
  const labels = new Set();
  const out = list.map((s, i) => {
    const label = String(s?.label ?? '').trim();
    if (!label) throw new StatusError(`${noun === 'job' ? 'Job' : 'Program Book'} status ${i + 1} needs a name.`);
    if (label.length > MAX_LABEL) throw new StatusError(`"${label}" is too long - ${MAX_LABEL} characters at most.`);
    if (labels.has(lc(label))) throw new StatusError(`Two ${noun} statuses are called "${label}".`);
    labels.add(lc(label));
    return {
      value: known.get(lc(s?.value)) || null,
      label,
      color: COLORS.includes(s?.color) ? s.color : 'default',
      rules: inRuleOrder(kind, Array.isArray(s?.rules) ? s.rules : []),
      hidden: Boolean(s?.hidden),
    };
  });

  // A name that is another status's stored value would read as that status
  // wherever a status is matched by its text.
  for (const s of out) {
    const other = out.find((o) => o !== s && o.value && lc(o.value) === lc(s.label));
    if (other) throw new StatusError(`"${s.label}" is how ${other.label} is stored - give it another name.`);
  }

  // New statuses are stored under the name they are given now, kept unique.
  const values = new Set(out.filter((s) => s.value).map((s) => lc(s.value)));
  for (const s of out) {
    if (s.value) continue;
    let value = s.label;
    for (let n = 2; values.has(lc(value)); n += 1) value = `${s.label} ${n}`;
    s.value = value;
    values.add(lc(value));
  }

  for (const p of previous) {
    if (values.has(lc(p.value))) continue;
    if (BUILT_IN[kind].includes(p.value)) {
      throw new StatusError(`${p.label} is built in and cannot be removed - untick Offered to stop it being picked.`);
    }
    const n = inUse.get(p.value) || 0;
    if (n) throw new StatusError(`${p.label} is on ${n} ${rows}${n === 1 ? '' : 's'} - untick Offered instead of removing it.`);
  }

  const starts = out.filter((s) => s.rules.includes('start'));
  if (starts.length !== 1) {
    throw new StatusError(`Pick one status new ${kind === 'job' ? 'jobs' : 'Program Book rows'} start at.`);
  }
  if (starts[0].hidden) throw new StatusError(`${starts[0].label} is where new ${rows}s start, so it must be offered.`);
  if (kind === 'job' && !out.some((s) => s.rules.includes('billable'))) {
    throw new StatusError('At least one job status must allow receivable charges to be approved.');
  }
  if (kind === 'plan' && !out.some((s) => s.rules.includes('movable'))) {
    throw new StatusError('At least one Program Book status must allow a plan to be moved to the jobs list.');
  }
  return out;
}

// ---- reading a list -----------------------------------------------------------

const entryOf = (list, value) => (list || []).find((s) => s.value === value) || null;
const labelOf = (list, value) => entryOf(list, value)?.label || value || '';
const hasRule = (list, value, rule) => Boolean(entryOf(list, value)?.rules.includes(rule));
const valuesWith = (list, rule) => (list || []).filter((s) => s.rules.includes(rule)).map((s) => s.value);
const startOf = (list) => ((list || []).find((s) => s.rules.includes('start')) || (list || [])[0])?.value || null;

/**
 * A status as text from a request -> its stored value: by value, then by
 * label, then by an old spelling (`aliases`, keyed lowercase). null when
 * blank, undefined when it names no status in the list.
 */
const resolveStatus = (list, text, aliases = {}) => {
  const v = lc(text);
  if (!v) return null;
  const byValue = (list || []).find((s) => lc(s.value) === v);
  if (byValue) return byValue.value;
  const byLabel = (list || []).find((s) => lc(s.label) === v);
  if (byLabel) return byLabel.value;
  const alias = aliases[v];
  if (alias && entryOf(list, alias)) return alias;
  return undefined;
};

module.exports = {
  JOB_RULES, PLAN_RULES, RULES, COLORS, DEFAULT_STATUSES, BUILT_IN, MAX_STATUSES, MAX_LABEL,
  StatusError, normalizeList, normalizeStatuses, validateList,
  entryOf, labelOf, hasRule, valuesWith, startOf, resolveStatus,
};

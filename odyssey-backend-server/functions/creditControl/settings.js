/* CREDIT CONTROL - its settings (Config > Credit Control).
 *
 * What the user asked for (2026-10-23), every part of it switchable:
 *
 *  - DAILY, at 9am: each party with a Credit Limit (Days) - its open invoices
 *    older than that, emailed to the party's sales rep with management on CC,
 *    every day until they are paid. Each party with a Credit Limit (Amount) -
 *    its open invoices in rupees against it; over, it is flagged, emailed and
 *    BLOCKED from being picked as the client on a new job.
 *  - WEEKLY, Monday at 9am: each sales rep's parties with invoices over 90
 *    days, as an ageing list.
 *  - Management = the CEO and CFO users' emails. A party with no sales rep is
 *    emailed to the admin, to set one.
 *  - A blocked party is let through by an approver (CEO / CFO), on request;
 *    an approver can pick it anyway. An approver can also OMIT an invoice -
 *    the backlog is reminded about until they do.
 *
 * Off until switched on: an install that never opens the screen sends nothing
 * and blocks nothing.
 *
 * Stored as one JSON value in AppSettings. Read through `readSettings`, which
 * lays what is stored over the defaults - a setting added later reads as its
 * default on an install that saved before it existed.
 */
// Required when used, so the rules here can be tested without a database.
const appSetting = () => require('../../models').AppSetting;

const KEY = 'creditControl';

// As Setup > Employees offers them.
const DESIGNATIONS = ['ceo', 'cfo', 'admin', 'manager', 'accountant', 'gd operator', 'date operator', 'hr', 'rider'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULTS = Object.freeze({
  enabled: false,
  timeZone: 'Asia/Karachi',
  daily: { enabled: true, time: '09:00', overdue: true, overLimit: true },
  block: { enabled: true, approvalDays: 7 },
  weekly: { enabled: true, day: 1, time: '09:00', ageDays: 90 },
  recipients: {
    management: ['ceo', 'cfo'],
    extraCc: [],
    admin: ['admin'],
    extraAdmin: [],
  },
  approvers: ['ceo', 'cfo'],
  includeAgentInvoices: false,
  // Invoices older than this many days are left out of everything - the
  // emails, the limits, the blocks, the screens (the user's request,
  // 2026-10-23). 0 = none left out.
  ignoreOlderThanDays: 0,
  // An invoice with less than this left on it, in rupees (a foreign one at its
  // own rate, as the limit is), is left out of everything the same way (the
  // user's request, 2026-10-26). 0 = none left out.
  ignoreBelowAmount: 0,
  companies: [],
});

class SettingsError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** What is stored, laid over the defaults - one level of nesting deep. */
const withDefaults = (stored) => {
  const out = clone(DEFAULTS);
  if (!isObject(stored)) return out;
  for (const [k, v] of Object.entries(stored)) {
    if (!(k in out)) continue;
    out[k] = isObject(out[k]) && isObject(v) ? { ...out[k], ...v } : v;
  }
  return out;
};

const validTimeZone = (tz) => {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch (_) { return false; }
};

const bool = (v, label) => {
  if (typeof v !== 'boolean') throw new SettingsError(`${label} must be on or off.`);
  return v;
};
const whole = (v, label, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new SettingsError(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
};
const amount = (v, label, max) => {
  const n = Number(v);
  if (v === '' || v === null || !Number.isFinite(n) || n < 0 || n > max) throw new SettingsError(`${label} must be an amount from 0 to ${max}.`);
  return Math.round(n * 100) / 100;
};
const time = (v, label) => {
  const s = String(v ?? '').trim();
  if (!TIME.test(s)) throw new SettingsError(`${label} must be a time like 09:00.`);
  return s;
};
const designations = (v, label, { required = false } = {}) => {
  const list = [...new Set((Array.isArray(v) ? v : []).map((d) => String(d).trim().toLowerCase()).filter(Boolean))];
  const unknown = list.filter((d) => !DESIGNATIONS.includes(d));
  if (unknown.length) throw new SettingsError(`${label}: not a designation - ${unknown.join(', ')}.`);
  if (required && !list.length) throw new SettingsError(`${label} needs at least one designation.`);
  return list;
};
const emails = (v, label) => {
  const list = [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[;,\s]+/))
    .map((e) => String(e).trim()).filter(Boolean))];
  const bad = list.filter((e) => !EMAIL.test(e));
  if (bad.length) throw new SettingsError(`${label}: not an email address - ${bad.join(', ')}.`);
  return list;
};

/** A whole settings object, checked - what the screen sent, over the defaults. */
const validate = (input) => {
  const s = withDefaults(input);
  if (!validTimeZone(s.timeZone)) throw new SettingsError(`Not a time zone: ${s.timeZone}.`);
  const out = build(s);
  // Ignoring everything the weekly report is for would leave it empty every week.
  if (out.weekly.enabled && out.ignoreOlderThanDays > 0 && out.ignoreOlderThanDays <= out.weekly.ageDays) {
    throw new SettingsError(`Invoices older than ${out.ignoreOlderThanDays} days are ignored, so a weekly report of those over ${out.weekly.ageDays} days would always be empty. Ignore older ones, or lower the weekly report's age.`);
  }
  return out;
};

const build = (s) => {
  return {
    enabled: bool(s.enabled, 'Credit control'),
    timeZone: String(s.timeZone),
    daily: {
      enabled: bool(s.daily.enabled, 'The daily check'),
      time: time(s.daily.time, 'The daily check\'s time'),
      overdue: bool(s.daily.overdue, 'Overdue invoices'),
      overLimit: bool(s.daily.overLimit, 'Over the credit limit'),
    },
    block: {
      enabled: bool(s.block.enabled, 'Blocking'),
      approvalDays: whole(s.block.approvalDays, 'An approval\'s days', 1, 365),
    },
    weekly: {
      enabled: bool(s.weekly.enabled, 'The weekly report'),
      day: whole(s.weekly.day, 'The weekly report\'s day', 0, 6),
      time: time(s.weekly.time, 'The weekly report\'s time'),
      ageDays: whole(s.weekly.ageDays, 'The weekly report\'s age', 1, 3650),
    },
    recipients: {
      management: designations(s.recipients.management, 'Management (CC)'),
      extraCc: emails(s.recipients.extraCc, 'More CC addresses'),
      admin: designations(s.recipients.admin, 'No sales rep - send to'),
      extraAdmin: emails(s.recipients.extraAdmin, 'More no-sales-rep addresses'),
    },
    approvers: designations(s.approvers, 'Approvers', { required: true }),
    includeAgentInvoices: bool(s.includeAgentInvoices, 'Agent invoices'),
    ignoreOlderThanDays: whole(s.ignoreOlderThanDays, 'Ignore invoices older than', 0, 36500),
    ignoreBelowAmount: amount(s.ignoreBelowAmount, 'Ignore balances below', 100000000),
    companies: [...new Set((Array.isArray(s.companies) ? s.companies : []).map(String).filter(Boolean))],
  };
};

const readSettings = async () => {
  try {
    const row = await appSetting().findOne({ where: { key: KEY } });
    return withDefaults(row?.value ? JSON.parse(row.value) : null);
  } catch (_) {
    // A blip or a hand-edited value reads as the defaults - which are OFF.
    return withDefaults(null);
  }
};

const writeSettings = async (input) => {
  const value = validate(input);
  const existing = await appSetting().findOne({ where: { key: KEY } });
  if (existing) await existing.update({ value: JSON.stringify(value) });
  else await appSetting().create({ key: KEY, value: JSON.stringify(value) });
  return value;
};

/** Does this designation approve - unblock, omit, pick a blocked party? */
const isApproverDesignation = (settings, designation) =>
  (settings?.approvers || []).includes(String(designation || '').trim().toLowerCase());

module.exports = {
  KEY, DEFAULTS, DESIGNATIONS, WEEKDAYS, SettingsError,
  withDefaults, validate, readSettings, writeSettings, isApproverDesignation,
};

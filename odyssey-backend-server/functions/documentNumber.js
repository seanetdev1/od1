/**
 * How this installation numbers its documents - jobs, invoices and vouchers.
 *
 * A number is up to four parts:
 *
 *     [company]-code-seq/year          SNS-SEJ-140/27
 *     [company]-code-year/seq          SNS-SEJ-27/140
 *
 * and Config > Document Numbers decides, separately for JOBS, INVOICES and
 * VOUCHERS:
 *
 *   companyPrefix  whether the company's short code leads (SNS-SEJ-140/27)
 *                  or is left off (SEJ-140/27)
 *   yearFirst      whether the year comes before the sequence or after it
 *   codes          the document code for each kind the customer asked to
 *                  name themselves: SE / SI / AE / AI / CC jobs, the four
 *                  invoice types, and bank / cash / adjustment receipts and
 *                  payments
 *
 * Every other kind (aviation flights, PFMs, opening invoices, journal and
 * invoice vouchers...) keeps its fixed code but still follows its class's
 * prefix and order.
 *
 * DEFAULTS TO WHAT THE APP ALREADY DID. An install that never opens the screen
 * numbers exactly as before: prefix on everywhere, each code as it was, and the
 * order the older single setting (documentNumberFormat) said.
 *
 * THE SEQUENCE NEVER RESTARTS BECAUSE OF A SETTING. The user's rule: changing
 * a code, the prefix or the order must never restart numbering or issue a
 * number twice. So the "last number issued" is never found by matching the
 * text those settings control. It is read from the NUMERIC sequence column
 * (jobId, invoice_Id, voucher_No, pfmId), scoped by the columns that say what
 * kind of document it is (operation, type, vType) - and the number's text is
 * consulted only for its year, in either order. See lastInYear.
 *
 * It still restarts at 1 each fiscal year, as it always has.
 *
 * WITHOUT THE COMPANY PREFIX, THE SEQUENCE IS SHARED BY EVERY COMPANY. Two
 * companies each at their own 140 would both issue "SEJ-141/27" - the same
 * number for two different jobs. So with the prefix off, the next number
 * follows the highest any company has issued; with it on, each company runs
 * its own. Switching either way can only move the next number up, never back
 * onto one already issued.
 *
 * NOT RETROSPECTIVE: a number already printed is on a client's paper and in
 * their ledger. Every setting here changes what the NEXT document is called.
 */

const Sequelize = require('sequelize');
const { AppSetting } = require('../models');

const KEY = 'documentNumbering';
// The single setting this replaces - seq/year or year/seq for everything.
// Still read, so an install that chose year-first before keeps it.
const LEGACY_FORMAT_KEY = 'documentNumberFormat';

const CLASSES = ['jobs', 'invoices', 'vouchers'];

/* The codes a customer may choose, and what each was before it could be
 * chosen - which is therefore the default. `key` is what the code is looked
 * up by: the job's operation, the invoice's type, the voucher's vType. Those
 * columns never change; only what is printed does, which is what keeps the
 * sequence intact when a code is renamed. */
const CONFIGURABLE = {
  jobs: [
    { key: 'SE', label: 'Sea Export', code: 'SEJ' },
    { key: 'SI', label: 'Sea Import', code: 'SIJ' },
    { key: 'AE', label: 'Air Export', code: 'AE' },
    { key: 'AI', label: 'Air Import', code: 'AI' },
    { key: 'CC', label: 'Customs Clearance', code: 'CCJ' },
  ],
  invoices: [
    { key: 'Job Invoice', label: 'Job Invoice', code: 'JI' },
    { key: 'Job Bill', label: 'Job Bill', code: 'JB' },
    { key: 'Agent Invoice', label: 'Agent Invoice', code: 'AI' },
    { key: 'Agent Bill', label: 'Agent Bill', code: 'AB' },
  ],
  vouchers: [
    { key: 'BRV', label: 'Bank Receipt', code: 'BRV' },
    { key: 'BPV', label: 'Bank Payment', code: 'BPV' },
    { key: 'CRV', label: 'Cash Receipt', code: 'CRV' },
    { key: 'CPV', label: 'Cash Payment', code: 'CPV' },
    { key: 'ADJ-R', label: 'Adjustment Receipt', code: 'ADJ-R' },
    { key: 'ADJ-P', label: 'Adjustment Payment', code: 'ADJ-P' },
  ],
};

/* Codes that are NOT configurable but print in the same class. A configured
 * code may not take one: an Agent Invoice coded "OI" would read exactly like
 * an opening invoice. */
const FIXED = {
  jobs: ['AVJ', 'PFM'],
  invoices: ['OI', 'OB'],
  vouchers: ['SI', 'PI', 'JV', 'TV', 'OI', 'OB', 'OP', 'SV', 'DN', 'CN'],
};

// Letters and digits, optionally in hyphenated groups (ADJ-R), 1 to 8 long.
const CODE_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const CODE_MAX = 8;

const defaultCodes = () => Object.fromEntries(
  CLASSES.map((k) => [k, Object.fromEntries(CONFIGURABLE[k].map((c) => [c.key, c.code]))]),
);
const perClass = (value) => Object.fromEntries(CLASSES.map((k) => [k, value]));

/** What an install that has never saved the setting numbers by. */
const defaults = (legacyFormat) => ({
  companyPrefix: perClass(true),
  yearFirst: perClass(legacyFormat === 'year/seq'),
  codes: defaultCodes(),
});

/**
 * A stored (or submitted) value, made whole: anything missing takes its
 * default, anything unrecognised is dropped. Never throws.
 */
const normalise = (raw, legacyFormat) => {
  const base = defaults(legacyFormat);
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { companyPrefix: {}, yearFirst: {}, codes: {} };
  for (const k of CLASSES) {
    const p = src.companyPrefix?.[k];
    const y = src.yearFirst?.[k];
    out.companyPrefix[k] = typeof p === 'boolean' ? p : base.companyPrefix[k];
    out.yearFirst[k] = typeof y === 'boolean' ? y : base.yearFirst[k];
    out.codes[k] = {};
    for (const c of CONFIGURABLE[k]) {
      const v = String(src.codes?.[k]?.[c.key] ?? '').trim().toUpperCase();
      out.codes[k][c.key] = v && v.length <= CODE_MAX && CODE_RE.test(v) ? v : base.codes[k][c.key];
    }
  }
  return out;
};

/**
 * Check a submitted setting. Returns { settings } or { error }.
 *
 * Stricter than normalise, which quietly repairs: a bad code typed on the
 * screen is refused with a reason rather than silently reverted.
 */
const validate = (input, legacyFormat) => {
  const src = input && typeof input === 'object' ? input : {};
  for (const k of CLASSES) {
    const seen = new Map(FIXED[k].map((c) => [c, 'a built-in code']));
    for (const c of CONFIGURABLE[k]) {
      const raw = src.codes?.[k]?.[c.key];
      if (raw === undefined) continue;
      const v = String(raw).trim().toUpperCase();
      if (!v) return { error: `${c.label} needs a code.` };
      if (v.length > CODE_MAX) return { error: `${c.label}: "${v}" is longer than ${CODE_MAX} characters.` };
      if (!CODE_RE.test(v)) return { error: `${c.label}: "${v}" - use letters and digits only (a hyphen between them is fine).` };
      // Two kinds printing the same code would issue identical-looking
      // numbers for different documents.
      if (seen.has(v)) return { error: `${c.label}: "${v}" is already used by ${seen.get(v)}.` };
      seen.set(v, c.label);
    }
  }
  return { settings: normalise(src, legacyFormat) };
};

/* Cached: read on every job, invoice and voucher creation. Dropped by the
 * settings route when an administrator saves. A miss is one indexed read. */
let _cached = null;
const resetNumbering = () => { _cached = null; };

/**
 * The install's numbering settings. Never throws - a document is being
 * numbered when this is called, and an unreadable preference is not a reason
 * to refuse one. A failed read falls back to the defaults and is NOT cached.
 */
const readNumbering = async () => {
  if (_cached) return _cached;
  try {
    const rows = await AppSetting.findAll({ where: { key: [KEY, LEGACY_FORMAT_KEY] } });
    const get = (k) => rows.find((r) => r.key === k)?.value;
    let stored = null;
    try { stored = get(KEY) ? JSON.parse(get(KEY)) : null; } catch (_) { stored = null; }
    _cached = normalise(stored, String(get(LEGACY_FORMAT_KEY) || '').trim());
  } catch (_) {
    return defaults();
  }
  return _cached;
};

/** The code a document prints: the configured one, or its fixed code. */
const codeFor = (settings, klass, key, fixedCode) =>
  settings?.codes?.[klass]?.[key] || fixedCode || key;

/**
 * A whole number, laid out as the class is configured.
 *
 *   formatNumber(s, { klass: 'jobs', company: 'SNS', code: 'SEJ', seq: 140, suffix: '27' })
 *     -> 'SNS-SEJ-140/27' | 'SEJ-140/27' | 'SNS-SEJ-27/140' | 'SEJ-27/140'
 */
const formatNumber = (settings, { klass, company, code, seq, suffix }) => {
  const s = settings || defaults();
  const head = s.companyPrefix[klass] && company ? `${company}-${code}` : code;
  return `${head}-${s.yearFirst[klass] ? `${suffix}/${seq}` : `${seq}/${suffix}`}`;
};

/** Whether this class runs a sequence per company (prefix on) or shared. */
const perCompany = (settings, klass) => Boolean((settings || defaults()).companyPrefix[klass]);

/**
 * The row carrying the highest sequence already issued in a fiscal year.
 *
 * NOTHING HERE READS THE CODE OR THE COMPANY OUT OF THE TEXT - that is what
 * makes renaming a code, or switching the prefix, safe. The kind of document
 * comes from `where` (operation / type / vType columns), the company from its
 * column, and the sequence from its numeric column. The text is asked only
 * whether the sequence is written in it against this year:
 *
 *     ...-0*140/27   or   ...-27/0*140
 *
 * Matching the sequence itself, not just "/27", is what tells year-first
 * SNS-SEJ-27/26 (FY27, #26) from SNS-SEJ-27/26 (FY26, #27): the row's own
 * sequence column settles which it is. `0*` allows migrated zero-padding.
 *
 * @param Model      the Sequelize model
 * @param seqCol     numeric sequence column - 'jobId', 'invoice_Id' ...
 * @param noCol      the formatted number column - 'jobNo', 'invoice_No' ...
 * @param suffix     fiscal year suffix, '27'
 * @param where      what kind of document - { operation: 'SE' }
 * @param company    { column, id } - applied only when `scoped`
 * @param scoped     true to count this company's documents only
 */
const lastInYear = async (Model, {
  seqCol, noCol, suffix, where = {}, company, scoped,
  attributes, include, transaction,
}) => {
  const year = String(suffix ?? '').replace(/\D/g, '');
  if (!year) throw new Error('A fiscal year suffix is required to number a document.');
  const alias = Model.name;
  const no = `"${alias}"."${noCol}"`;
  const seq = `"${alias}"."${seqCol}"`;
  const inYear = Sequelize.literal(
    `(${no} ~ ('-0*' || ${seq} || '/${year}$') OR ${no} ~ ('-${year}/0*' || ${seq} || '$'))`,
  );
  return Model.findOne({
    where: {
      ...where,
      ...(scoped && company ? { [company.column]: company.id } : {}),
      [seqCol]: { [Sequelize.Op.ne]: null },
      [Sequelize.Op.and]: [inYear],
    },
    order: [[seqCol, 'DESC']],
    attributes: attributes || ['id', seqCol],
    ...(include ? { include } : {}),
    transaction,
  });
};

/** The next sequence after a row lastInYear returned, or 1. */
const nextAfter = (row, seqCol) => {
  const n = parseInt(row?.[seqCol] ?? row?.dataValues?.[seqCol], 10);
  return Number.isFinite(n) ? n + 1 : 1;
};

/** What the configuration screen shows as each class's example. */
const example = (settings, klass) => {
  const code = klass === 'jobs' ? codeFor(settings, 'jobs', 'SE')
    : klass === 'invoices' ? codeFor(settings, 'invoices', 'Job Invoice')
      : codeFor(settings, 'vouchers', 'BPV');
  return formatNumber(settings, { klass, company: 'ABC', code, seq: 140, suffix: '27' });
};

module.exports = {
  KEY,
  LEGACY_FORMAT_KEY,
  CLASSES,
  CONFIGURABLE,
  FIXED,
  defaults,
  normalise,
  validate,
  readNumbering,
  resetNumbering,
  codeFor,
  formatNumber,
  perCompany,
  lastInYear,
  nextAfter,
  example,
};

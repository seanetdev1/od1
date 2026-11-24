/**
 * The trial balance, built on the server - routes/misc/trialBalance.
 *
 * WHY HERE. The report used to receive every voucher line of every account
 * and add them up in the browser - on CargoLinkers that is over two hundred
 * thousand lines for one report. The database now adds them up per account
 * (one row per account that has entries) and this turns those sums into the
 * rows the screen shows, for the report type asked for. The response is the
 * report, not its raw material.
 *
 * WHAT THE FIGURES ARE.
 *   Opening      the account's balance at the start of From - EVERY entry
 *                before it, not only the ones in the period. (The old query
 *                only fetched vouchers entered inside the period, so Opening
 *                was always empty and Closing was the period's movement.)
 *   Transactions the debits and credits dated From..To.
 *   Closing      Opening + debits - credits: the balance at the end of To.
 * Opening and Closing are a net balance on one side; Transactions are gross.
 * Dated by the LINE (Voucher_Heads.createdAt), as the ledger is - so a
 * back-dated invoice falls on its invoice date in both.
 *
 * EVERY ACCOUNT CARRIES ITS WHOLE HISTORY - income and expense too. They do
 * not start again at a financial year: the books carry no year-end closing,
 * and the user's call (2026-10-06) is that the trial balance shows them as
 * the ledger does.
 *
 * GROUPS ARE ROLL-UPS. A group's figures are its listed accounts' figures
 * added up, every level down - a column's debit and credit summed separately,
 * so a group of debtors with a few in credit shows both sides, and the grand
 * total equals the sum of the top groups. Accounts with nothing to show in
 * the chosen columns are left out, and so is a group left empty by that.
 *
 * THE FOUR REPORT TYPES differ only in which figures they show, and an account
 * is listed when one of those figures is not zero:
 *   6-column   Opening, Transactions, Closing  ("Exclude Opening" hides the
 *              Opening pair; Closing is still the true balance)
 *   2-column   Closing
 *   Debitors   accounts whose closing balance is a debit
 *   Creditors  accounts whose closing balance is a credit
 * The grand total adds up the accounts listed, nothing else.
 *
 * MONEY IN CENTS. The database sums exactly; the arithmetic here is on whole
 * cents so the columns add up to the penny, and figures leave as rupees.
 *
 * Kept free of model imports so the arithmetic can be tested without a
 * database. The route reads the accounts and the sums.
 */

const moment = require('moment');

const REPORT_TYPES = {
  SIX: '6- Columns Simplified View',
  TWO: '2- Columns Simplified View',
  DEBTORS: 'Debitors List',
  CREDITORS: 'Creditors List',
};

const FIGURES = ['opDebit', 'opCredit', 'trDebit', 'trCredit', 'clDebit', 'clCredit'];

// Pakistan - where every install is. Used only when the screen did not say
// which zone its dates were picked in.
const DEFAULT_UTC_OFFSET = 300;

const DAY = 'YYYY-MM-DD';

/** The screen's UTC offset in minutes, or Pakistan's when absent or nonsense. */
function utcOffsetOf(value) {
  const n = Number(value);
  return value !== undefined && value !== null && value !== '' && Number.isInteger(n) && Math.abs(n) <= 14 * 60
    ? n
    : DEFAULT_UTC_OFFSET;
}

/**
 * A From / To as the calendar day it means, 'YYYY-MM-DD'.
 *
 * The screen sends the day. An older link carries an ISO instant instead
 * (the moment the date was picked, time of day and all), which is read as the
 * day it was in the reader's zone - so 1 July 00:00 in Karachi stays 1 July,
 * not the 30 June it is in UTC. null when it is neither.
 */
function reportDay(value, utcOffset = DEFAULT_UTC_OFFSET) {
  const s = String(value ?? '').trim();
  if (!s || s === 'undefined' || s === 'null') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return moment(s, DAY, true).isValid() ? s : null;
  }
  const m = moment(s, moment.ISO_8601, true);
  return m.isValid() ? m.utcOffset(utcOffset).format(DAY) : null;
}

/** The instant a day begins, in the reader's zone. */
function dayStart(day, utcOffset = DEFAULT_UTC_OFFSET) {
  return moment.utc(day, DAY, true).subtract(utcOffset, 'minutes').toDate();
}

/** The instant the day after `day` begins - the end of `day`, exclusive. */
function dayEnd(day, utcOffset = DEFAULT_UTC_OFFSET) {
  return moment.utc(day, DAY, true).add(1, 'day').subtract(utcOffset, 'minutes').toDate();
}

// A stored amount that is not a plain number counts as nothing rather than
// failing the whole report. None are today - the Voucher_Heads hooks
// normalise every write - but one bad row should cost one line, not the page.
const AMOUNT = (column) => `CASE WHEN ${column} ~ '^\\s*-?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?\\s*$' THEN CAST(${column} AS numeric) ELSE 0 END`;

/**
 * The query for each account's sums up to the end of To, in one pass: its net
 * before From, and its debits and credits within From..To. One row per
 * account with entries.
 *
 * Rupees use each line's rupee value (defaultAmount), across every voucher.
 * A foreign currency uses the line's own amount, and only that currency's
 * vouchers - as the ledger does.
 *
 * Replacements: :from, :toEnd (instants), :company, :currency.
 */
function accountSumsSql({ pkr = true, company = null } = {}) {
  const amount = AMOUNT(pkr ? 'vh."defaultAmount"' : 'vh.amount');
  return `
    SELECT h."ChildAccountId" AS id,
      COALESCE(SUM(h.signed) FILTER (WHERE h."createdAt" < :from), 0) AS "opening",
      COALESCE(SUM(h.amt) FILTER (WHERE h."createdAt" >= :from AND h.type = 'debit'), 0) AS "trDebit",
      COALESCE(SUM(h.amt) FILTER (WHERE h."createdAt" >= :from AND h.type = 'credit'), 0) AS "trCredit"
    FROM (
      SELECT vh."ChildAccountId", vh."createdAt", vh.type,
        ${amount} AS amt,
        CASE vh.type WHEN 'debit' THEN ${amount} WHEN 'credit' THEN -(${amount}) ELSE 0 END AS signed
      FROM "Voucher_Heads" vh
      JOIN "Vouchers" v ON v.id = vh."VoucherId"
      WHERE vh."createdAt" < :toEnd
        ${company ? 'AND v."CompanyId" = :company' : ''}
        ${pkr ? '' : 'AND v.currency = :currency'}
    ) h
    GROUP BY h."ChildAccountId"
  `;
}

/** The figures a report type shows, in column order. */
function columnsFor(reportType, options) {
  switch (reportType) {
    case REPORT_TYPES.TWO: return ['clDebit', 'clCredit'];
    case REPORT_TYPES.DEBTORS: return ['clDebit'];
    case REPORT_TYPES.CREDITORS: return ['clCredit'];
    default:
      return options === 'excludeOpening'
        ? ['trDebit', 'trCredit', 'clDebit', 'clCredit']
        : [...FIGURES];
  }
}

const isReportType = (t) => Object.values(REPORT_TYPES).includes(t);

const toCents = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

const zero = () => ({ opDebit: 0, opCredit: 0, trDebit: 0, trCredit: 0, clDebit: 0, clCredit: 0 });

/** One account's six figures, in cents, from its opening net and movement. */
function figures(openingNet, trDebit, trCredit) {
  const closingNet = openingNet + trDebit - trCredit;
  return {
    opDebit: Math.max(openingNet, 0),
    opCredit: Math.max(-openingNet, 0),
    trDebit,
    trCredit,
    clDebit: Math.max(closingNet, 0),
    clCredit: Math.max(-closingNet, 0),
  };
}

const add = (into, f) => { FIGURES.forEach((k) => { into[k] += f[k]; }); return into; };

// Account codes sort as numbers where they are numbers: 1102 before 11010.
const byCode = (a, b) => String(a.code ?? '').localeCompare(String(b.code ?? ''), undefined, { numeric: true })
  || String(a.title ?? '').localeCompare(String(b.title ?? ''));

const leafRow = (account, level, f) => ({ id: account.id, code: account.code ?? '', title: account.title, level, group: false, ...f });

/**
 * The report.
 *
 * @param {Object}   p
 * @param {Array}    p.accounts    every Child_Account: { id, title, code, ChildAccountId }
 * @param {Array}    p.sums        per account with entries up to To:
 *                                 { id, opening, trDebit, trCredit } - opening NET
 *                                 (debit positive), the other two gross; strings or
 *                                 numbers, in rupees
 * @param {string}   p.reportType  one of REPORT_TYPES (anything else: 6-column)
 * @param {string}   p.options     'showall' | 'excludeOpening'
 * @param {*}        p.accountId   the account picked to report on, if any - the
 *                                 report is that account and everything under it
 * @returns {{ reportType: string, columns: string[], rows: Object[], totals: Object }}
 */
function buildTrialBalance({ accounts = [], sums = [], reportType, options, accountId } = {}) {
  const type = isReportType(reportType) ? reportType : REPORT_TYPES.SIX;
  const columns = columnsFor(type, options);

  const byId = new Map(accounts.map((a) => [String(a.id), a]));
  const children = new Map();
  accounts.forEach((a) => {
    const parent = a.ChildAccountId != null && byId.has(String(a.ChildAccountId)) ? String(a.ChildAccountId) : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(a);
  });
  children.forEach((list) => list.sort(byCode));

  const own = new Map(sums.map((s) => [
    String(s.id),
    figures(toCents(s.opening), toCents(s.trDebit), toCents(s.trCredit)),
  ]));

  const shows = (f) => columns.some((k) => f[k] !== 0);

  // Depth first. A row is kept when it shows a figure; a group when anything
  // under it is kept, carrying the sum of what is. `visited` guards against a
  // chart with a loop in it.
  const visited = new Set();
  const walk = (account, level) => {
    const id = String(account.id);
    if (visited.has(id)) return null;
    visited.add(id);

    const kids = children.get(id) || [];
    const ownFigures = own.get(id);

    if (kids.length === 0) {
      const f = ownFigures || zero();
      return shows(f) ? { rows: [leafRow(account, level, f)], total: f } : null;
    }

    const rows = [];
    const total = zero();
    // A group that was posted to directly - none are, today - lists those
    // entries as a line of its own first, so they are neither lost nor
    // mistaken for the group's total.
    if (ownFigures && shows(ownFigures)) {
      rows.push(leafRow(account, level + 1, ownFigures));
      add(total, ownFigures);
    }
    kids.forEach((k) => {
      const sub = walk(k, level + 1);
      if (sub) { rows.push(...sub.rows); add(total, sub.total); }
    });
    if (rows.length === 0) return null;
    return { rows: [{ id: account.id, code: account.code ?? '', title: account.title, level, group: true, ...total }, ...rows], total };
  };

  const picked = accountId != null && accountId !== '' && accountId !== 'null' && accountId !== 'undefined'
    ? byId.get(String(accountId))
    : null;
  const tops = picked ? [picked] : (children.get(null) || []);

  const rows = [];
  const totals = zero();
  tops.forEach((t) => {
    const sub = walk(t, 1);
    if (sub) { rows.push(...sub.rows); add(totals, sub.total); }
  });

  // Only the figures this report shows go back - a 2-column report has no use
  // for four of the six.
  const shown = (f) => Object.fromEntries(columns.map((k) => [k, f[k] / 100]));
  return {
    reportType: type,
    columns,
    rows: rows.map(({ id, code, title, level, group, ...f }) => ({ id, code, title, level, group, ...shown(f) })),
    totals: shown(totals),
  };
}

module.exports = {
  REPORT_TYPES,
  FIGURES,
  DEFAULT_UTC_OFFSET,
  utcOffsetOf,
  reportDay,
  dayStart,
  dayEnd,
  accountSumsSql,
  columnsFor,
  buildTrialBalance,
};

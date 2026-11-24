import Cookies from 'js-cookie';
import moment from 'moment';

/**
 * WHERE A REPORT'S FROM AND TO START - Configuration > Reports (the user,
 * 2026-11-11). They opened on the start of the fiscal year to today; some
 * clients need the start of the fiscal year to the end of the year. Which end
 * was not said, so both are offered, and From may start on 1 January too.
 *
 * Ten reports read it - Job Balancing, Invoice Balancing, Account Activity,
 * Trial Balance, Income Statement (both periods), Ledger, Ageing, Job P&L,
 * LG VAT and the Audit Log. Each wrote out the same "1 July of this fiscal
 * year" by hand - at the current time of day, so a report run at 3 pm left out
 * what was entered before 3 pm on 1 July. Reports that open on a month or a
 * preset (VAT Detail, Sales, Flight Summary, the registers) are left as they
 * are.
 *
 * KEPT IN A COOKIE, as the operation mode is: five of the ten keep their
 * dates in the store, whose starting values are worked out the moment the app
 * loads - before any request could answer. MainLayout reads the setting when
 * the app opens and remembers it here with the fiscal year that has today in
 * it (Setup > Fiscal Years); the Reports tab remembers it again when an admin
 * changes it. So a change reaches everyone the next time they open Odyssey.
 * Only where the boxes START: a user still picks any dates for a run.
 */
export const REPORT_DATES_COOKIE = 'reportDates';

export const FROM_CHOICES = [
  { value: 'fiscalStart', label: 'Start of the fiscal year' },
  { value: 'yearStart', label: 'Start of the calendar year (1 January)' },
];
export const TO_CHOICES = [
  { value: 'today', label: 'Today' },
  { value: 'fiscalEnd', label: 'End of the fiscal year' },
  { value: 'yearEnd', label: 'End of the calendar year (31 December)' },
];
export const DEFAULT_REPORT_DATES = { from: 'fiscalStart', to: 'today' };

const pick = (choices, v, fallback) => (choices.some((c) => c.value === v) ? v : fallback);
export const normalizeReportDates = (s) => ({
  from: pick(FROM_CHOICES, s?.from, DEFAULT_REPORT_DATES.from),
  to: pick(TO_CHOICES, s?.to, DEFAULT_REPORT_DATES.to),
});

const DAY = 'YYYY-MM-DD';
const dayOf = (v) => {
  if (!v) return '';
  const m = moment(v);
  return m.isValid() ? m.format(DAY) : '';
};

/**
 * The fiscal year that has today in it, as two days: the install's own
 * (Setup > Fiscal Years - stored as midnight in Pakistan, so read in the
 * reader's time zone) when one covers today, else 1 July to 30 June, as every
 * report had it.
 */
export const currentFiscalYear = (fiscalYears = [], now = moment()) => {
  const today = moment(now).format(DAY);
  const hit = (Array.isArray(fiscalYears) ? fiscalYears : [])
    .map((y) => ({ start: dayOf(y?.startDate), end: dayOf(y?.endDate) }))
    .find((y) => y.start && y.end && y.start <= today && today <= y.end);
  if (hit) return hit;
  const first = moment(now).month() < 6 ? moment(now).year() - 1 : moment(now).year();
  return { start: `${first}-07-01`, end: `${first + 1}-06-30` };
};

/** Remembers the install's choice, and the fiscal year it is read against. */
export const rememberReportDates = (setting, fiscalYears) => {
  const fy = Array.isArray(fiscalYears) && fiscalYears.length ? { fy: currentFiscalYear(fiscalYears) } : {};
  Cookies.set(REPORT_DATES_COOKIE, JSON.stringify({ ...normalizeReportDates(setting), ...fy }), { expires: 3650 });
};

const remembered = () => {
  try {
    return JSON.parse(Cookies.get(REPORT_DATES_COOKIE) || '{}') || {};
  } catch (_) {
    return {};
  }
};

/**
 * Where From and To start, as moments. The remembered fiscal year is used
 * only while today is still in it - a year later it falls back to the July
 * rule until the app has been opened again.
 */
export const reportDateRange = (now = moment(), stored = remembered()) => {
  const { from, to } = normalizeReportDates(stored);
  const today = moment(now).format(DAY);
  const fy = stored?.fy?.start && stored?.fy?.end && stored.fy.start <= today && today <= stored.fy.end
    ? stored.fy
    : currentFiscalYear([], now);
  return {
    from: from === 'yearStart' ? moment(now).startOf('year') : moment(fy.start, DAY).startOf('day'),
    to: to === 'fiscalEnd' ? moment(fy.end, DAY).endOf('day')
      : to === 'yearEnd' ? moment(now).endOf('year')
        : moment(now),            // today, as it always was: now
  };
};

/** The two as the reports store them. */
export const reportFrom = () => reportDateRange().from.toISOString();
export const reportTo = () => reportDateRange().to.toISOString();

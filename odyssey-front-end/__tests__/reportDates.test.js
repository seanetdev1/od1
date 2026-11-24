/**
 * Where a report's From and To start - functions/reportDates (the user,
 * 2026-11-11: some clients need the start of the fiscal year to the end of
 * the year, not to today). Read by ten report screens.
 */
import moment from 'moment';
import Cookies from 'js-cookie';
import {
  currentFiscalYear, reportDateRange, normalizeReportDates, rememberReportDates, reportFrom, reportTo,
  REPORT_DATES_COOKIE,
} from 'functions/reportDates';

const NOW = moment('2026-11-11T15:30:00');           // a weekday afternoon in the fiscal year 2026-27
const days = ({ from, to }) => [from.format('YYYY-MM-DD HH:mm'), to.format('YYYY-MM-DD HH:mm')];
const FY = { fy: { start: '2026-07-01', end: '2027-06-30' } };

afterEach(() => Cookies.remove(REPORT_DATES_COOKIE));

describe('the fiscal year that has today in it', () => {
  test('the install\'s own, from Setup > Fiscal Years', () => {
    const years = [
      { startDate: '2025-07-01', endDate: '2026-06-30' },
      { startDate: '2026-07-01', endDate: '2027-06-30' },
    ];
    expect(currentFiscalYear(years, NOW)).toEqual({ start: '2026-07-01', end: '2027-06-30' });
  });

  test('a calendar fiscal year, if that is what an install keeps', () => {
    expect(currentFiscalYear([{ startDate: '2026-01-01', endDate: '2026-12-31' }], NOW))
      .toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  test('none covering today: 1 July to 30 June, as every report had it - either side of July', () => {
    expect(currentFiscalYear([], NOW)).toEqual({ start: '2026-07-01', end: '2027-06-30' });
    expect(currentFiscalYear([], moment('2026-03-15'))).toEqual({ start: '2025-07-01', end: '2026-06-30' });
    expect(currentFiscalYear([{ startDate: '2024-07-01', endDate: '2025-06-30' }], NOW))
      .toEqual({ start: '2026-07-01', end: '2027-06-30' });
  });
});

describe('where From and To start', () => {
  test('as it always was: the start of the fiscal year to now - from the START of 1 July', () => {
    // It was 1 July at the current time of day: run at 3:30 pm, it left out
    // what was entered before 3:30 pm on 1 July.
    expect(days(reportDateRange(NOW, { ...FY }))).toEqual(['2026-07-01 00:00', '2026-11-11 15:30']);
  });

  test('to the end of the fiscal year - the clients\' request', () => {
    expect(days(reportDateRange(NOW, { from: 'fiscalStart', to: 'fiscalEnd', ...FY })))
      .toEqual(['2026-07-01 00:00', '2027-06-30 23:59']);
  });

  test('to the end of the calendar year', () => {
    expect(days(reportDateRange(NOW, { from: 'fiscalStart', to: 'yearEnd', ...FY })))
      .toEqual(['2026-07-01 00:00', '2026-12-31 23:59']);
  });

  test('the calendar year, 1 January to 31 December', () => {
    expect(days(reportDateRange(NOW, { from: 'yearStart', to: 'yearEnd', ...FY })))
      .toEqual(['2026-01-01 00:00', '2026-12-31 23:59']);
  });

  test('a remembered fiscal year that today has left is not used - the July rule until the app is opened again', () => {
    const stale = { from: 'fiscalStart', to: 'fiscalEnd', fy: { start: '2025-07-01', end: '2026-06-30' } };
    expect(days(reportDateRange(NOW, stale))).toEqual(['2026-07-01 00:00', '2027-06-30 23:59']);
  });

  test('nothing remembered, or something unknown: as it always was', () => {
    expect(days(reportDateRange(NOW, {}))).toEqual(['2026-07-01 00:00', '2026-11-11 15:30']);
    expect(normalizeReportDates({ from: 'lastWeek', to: 42 })).toEqual({ from: 'fiscalStart', to: 'today' });
  });
});

describe('remembered in the browser, read by the reports', () => {
  test('with the fiscal year it is read against', () => {
    rememberReportDates({ from: 'fiscalStart', to: 'fiscalEnd' }, [{ startDate: '2000-01-01', endDate: '2099-12-31' }]);
    expect(JSON.parse(Cookies.get(REPORT_DATES_COOKIE)))
      .toEqual({ from: 'fiscalStart', to: 'fiscalEnd', fy: { start: '2000-01-01', end: '2099-12-31' } });
    expect(moment(reportFrom()).format('YYYY-MM-DD')).toBe('2000-01-01');
    expect(moment(reportTo()).format('YYYY-MM-DD HH:mm')).toBe('2099-12-31 23:59');
  });

  test('a damaged cookie reads as nothing remembered', () => {
    Cookies.set(REPORT_DATES_COOKIE, '{not json');
    expect(moment(reportTo()).format('YYYY-MM-DD')).toBe(moment().format('YYYY-MM-DD'));
  });
});

import moment from 'moment';

/**
 * TYPED DATES IN THE SHAPES PEOPLE TYPE THEM (the user, 2026-11-14: "date not
 * typing in multiple places" - the customs job and the invoice page).
 *
 * antd's date box takes a typed date only in its display format, exactly: the
 * customs job's 15-11-2026, the invoice page's 15/Nov/26. Erase the date and
 * type 15/11/2026, 15-11-26 or 5-11-2026 and the box silently goes back to
 * the date it had - it reads as "will not take a date". Every date box in the
 * app has it (67 of them), so it is fixed once, under all of them:
 * makeLenient wraps the date library's own parse (rc-picker's moment config,
 * which every antd DatePicker and RangePicker shares) so that, when the
 * display format does not match, these day-first shapes are tried in turn.
 *
 * Only a picker of whole days: a month, year or time picker is left exactly
 * as it was. The display format is tried first, so what already worked is
 * unchanged. Day first, as dates are written here - 05/11/2026 is the 5th of
 * November - and ISO, for a date pasted from elsewhere.
 *
 * No React - unit tested.
 */
export const TYPED_DATE_FORMATS = [
  'DD-MM-YYYY', 'D-M-YYYY', 'DD/MM/YYYY', 'D/M/YYYY', 'DD.MM.YYYY', 'D.M.YYYY', 'DD MM YYYY', 'DDMMYYYY',
  'DD-MM-YY', 'D-M-YY', 'DD/MM/YY', 'D/M/YY', 'DD.MM.YY', 'D.M.YY', 'DDMMYY',
  'DD-MMM-YYYY', 'D-MMM-YYYY', 'DD/MMM/YYYY', 'D/MMM/YYYY', 'DD MMM YYYY', 'D MMM YYYY',
  'DD-MMM-YY', 'D-MMM-YY', 'DD/MMM/YY', 'D/MMM/YY', 'DD MMM YY', 'D MMM YY',
  'YYYY-MM-DD',
];

/** A format for a whole day: day, month and year, and no time of day. */
export const isDayFormat = (format) => {
  if (typeof format !== 'string') return false;
  // Literal text in [brackets] is not a token.
  const tokens = format.replace(/\[[^\]]*\]/g, '');
  return /D/.test(tokens) && /M/.test(tokens) && /Y/.test(tokens) && !/[Hhms]/.test(tokens);
};

/* A TWO-DIGIT YEAR OF 19 OR 20 IS A FOUR-DIGIT YEAR BEING TYPED. The box
 * reads its text after every key, and the moment a date reads it puts the
 * text in its own format - so 15-11-20, on the way to 15-11-2026, was read as
 * 2020, shown as 15-11-2020, and the 26 then went on the end of that: the box
 * kept 15 November 2020 (seen in a browser, 2026-11-14). So "...20" and
 * "...19" are left unread until the year is finished; 2019 and 2020 are typed
 * in full, as any year can be. */
const twoDigitYear = (f) => /YY/.test(f) && !/YYYY/.test(f);
const yearUnderway = (typed) => /(19|20)$/.test(typed);

/** The typed text as a date, by the shapes above - or null. */
export function lenientParse(text, formats, locale) {
  const list = Array.isArray(formats) ? formats : [formats];
  if (!list.some(isDayFormat)) return null;
  const typed = String(text ?? '').trim();
  if (!typed) return null;
  for (const f of TYPED_DATE_FORMATS) {
    if (twoDigitYear(f) && yearUnderway(typed)) continue;
    const m = moment(typed, f, locale, true);
    if (m.isValid()) return m;
  }
  return null;
}

/**
 * Teach a picker's moment config the shapes above - once; a second call does
 * nothing. Its own parse first, so a date typed in the display format is
 * read exactly as before.
 */
export function makeLenient(generateConfig) {
  const loc = generateConfig?.locale;
  if (!loc || typeof loc.parse !== 'function' || loc.parse.lenient) return;
  const base = loc.parse;
  const parse = (locale, text, formats) => base(locale, text, formats) || lenientParse(text, formats, locale);
  parse.lenient = true;
  loc.parse = parse;
}

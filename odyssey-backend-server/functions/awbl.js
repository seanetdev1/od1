// IATA air waybill numbering for the FREIGHT AWB stock (Setup > AWB Numbers).
//
// The arithmetic is the aviation register's - functions/awb.js - so there is
// one check-digit rule in the codebase rather than two copies that could drift:
// an 11-digit number is a 3-digit airline prefix, a 7-digit running serial and
// a check digit that is the serial modulo 7.
//
// What differs is only where the prefix comes from. Aviation reads it off the
// carrier, so its message on a bad prefix points at Setup > Carriers. Here the
// user TYPES it, next to the airline party it belongs to, so the message has to
// be about what they typed.

const awb = require('./awb');

const {
  PREFIX_LENGTH,
  SERIAL_LENGTH,
  MAX_SERIAL,
  checkDigitFor,
  padSerial,
  buildNumber,
  generateSeries,
} = awb;

/* ----------------------------- special formats ------------------------------
 * Some airlines' master AWBs are not IATA numbers. DHL's are the case in hand
 * (2026-10-21): besides its standard 155- stock, SNS has flown DHL on
 * 2102811410 and 1737890254 - 10-digit DHL waybills - and on SN-035-1873. The
 * register refused all three, so they could not be put on an air-export job,
 * which only takes a registered MAWB (routes/jobRoutes/sea).
 *
 * A SPECIAL number is the exception: registered as printed, no airline code,
 * serial or check digit. One spelling per number, as for the rest of the
 * register - separators out, letters upper-cased - so "sn-035-1873" and
 * "SN 035 1873" are the one AWB. It has no prefix, serial or check digit, and
 * an empty check digit is how it is told apart (isSpecial): no column changed,
 * so nothing has to be migrated first.
 *
 * At most 11 characters - the column's width, and the length of an IATA
 * number. An all-digit 11 is refused as special either way: a valid IATA
 * number would go in without its airline code and check digit (and clash
 * with the same number registered properly), and an invalid one is an IATA
 * number with a typo that Special would otherwise wave through.
 */
const SPECIAL_MAX = PREFIX_LENGTH + SERIAL_LENGTH + 1;

const normalizeSpecial = (value) =>
  String(value ?? '').trim().replace(/[\s./‐-―-]/g, '').toUpperCase();

/** One special number. @returns {{ok: true, awbNumber}} or {{ok: false, error}} */
const parseSpecial = (value) => {
  const shown = String(value ?? '').trim();
  const awbNumber = normalizeSpecial(value);
  if (!awbNumber) return { ok: false, error: 'Enter the AWB number.' };
  if (!/^[A-Z0-9]+$/.test(awbNumber)) {
    return { ok: false, error: `${shown}: letters and digits only (spaces, dashes, dots and slashes are dropped).` };
  }
  if (awbNumber.length > SPECIAL_MAX) {
    return { ok: false, error: `${shown}: at most ${SPECIAL_MAX} letters and digits - this has ${awbNumber.length}.` };
  }
  if (/^\d{11}$/.test(awbNumber)) {
    // Eleven digits is the IATA shape. A valid one belongs in the ordinary
    // register; an invalid one is almost always an IATA number with a slip in
    // it, and Special must not become the way round the check digit.
    const iata = awb.validateAwbNumber(awbNumber);
    return {
      ok: false,
      error: iata.ok
        ? `${awb.formatNumber(awbNumber)} is a standard IATA number - register it without Special format, ` +
          'so it is stored with its airline code and check digit.'
        : `${awb.formatNumber(awbNumber)} has the 11 digits of an IATA number but its last digit should be ` +
          `${checkDigitFor(awbNumber.slice(PREFIX_LENGTH, PREFIX_LENGTH + SERIAL_LENGTH))} - check it against ` +
          'the document and register it without Special format.',
    };
  }
  return { ok: true, awbNumber };
};

/**
 * Several special numbers - one per line, or separated by commas or
 * semicolons, the way they come off an airline's allocation sheet. All or
 * nothing: one bad entry refuses the lot, naming it, before anything is
 * written. A number listed twice is registered once.
 *
 * @returns {{ok: true, numbers: string[]}} or {{ok: false, error}}
 */
const parseSpecialList = (text, { max = 1000 } = {}) => {
  const entries = (Array.isArray(text) ? text : String(text ?? '').split(/[\n\r,;]+/))
    .map((x) => String(x).trim())
    .filter(Boolean);
  if (!entries.length) return { ok: false, error: 'Enter at least one AWB number.' };
  if (entries.length > max) return { ok: false, error: `At most ${max} numbers at a time - this has ${entries.length}.` };

  const numbers = [];
  const errors = [];
  for (const entry of entries) {
    const parsed = parseSpecial(entry);
    if (!parsed.ok) errors.push(parsed.error);
    else if (!numbers.includes(parsed.awbNumber)) numbers.push(parsed.awbNumber);
  }
  if (errors.length) {
    const more = errors.length > 5 ? ` (and ${errors.length - 5} more)` : '';
    return { ok: false, error: `Nothing was registered. ${errors.slice(0, 5).join(' ')}${more}` };
  }
  return { ok: true, numbers };
};

/** A register row for a special number - see above. */
const specialRow = (awbNumber) => ({ prefix: '', serial: '', checkDigit: '', awbNumber });

/** Registered in a special format: it has no check digit. */
const isSpecial = (row) => !String(row?.checkDigit ?? '');

/** 214-10000001 for an IATA number; a special one as it is stored. */
const formatNumber = (awbNumber) =>
  (/^\d{11}$/.test(String(awbNumber ?? '')) ? awb.formatNumber(awbNumber) : String(awbNumber ?? ''));

/**
 * The spellings a MAWB typed on a BL might be stored under: the digits of an
 * IATA number, or a special number's own spelling. "155-05444526" is
 * 15505444526; "SN-035-1873" is SN0351873, where its digits alone would be a
 * different, unregistered number.
 */
const storedSpellings = (mbl) => {
  const special = normalizeSpecial(mbl);
  const digits = String(mbl ?? '').replace(/\D/g, '');
  return [...new Set([digits, special].filter(Boolean))];
};

/**
 * Validates the 3-digit airline prefix and the 8 digits the user typed
 * (7-digit serial followed by its check digit).
 *
 * @returns {{ok: true, prefix, serial}} or {{ok: false, error}}
 */
const parseEntry = (prefix, code) => {
  if (!awb.isDigits(awb.digitsOnly(prefix), PREFIX_LENGTH)) {
    return { ok: false, error: 'Airline prefix must be exactly 3 digits.' };
  }
  return awb.parseEntry(prefix, code);
};

module.exports = {
  PREFIX_LENGTH,
  SERIAL_LENGTH,
  MAX_SERIAL,
  checkDigitFor,
  padSerial,
  buildNumber,
  formatNumber,
  parseEntry,
  generateSeries,
  SPECIAL_MAX,
  normalizeSpecial,
  parseSpecial,
  parseSpecialList,
  specialRow,
  isSpecial,
  storedSpellings,
};

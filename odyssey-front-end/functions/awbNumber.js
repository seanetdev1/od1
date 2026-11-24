// IATA air waybill numbering, for the screen.
//
// MIRRORS functions/awb.js on the backend, which is what actually gets stored
// - if the two ever disagree, the backend is right and this is the bug. It
// exists so Setup > AWB Stock can show exactly which numbers a series will
// produce BEFORE the user commits to registering two hundred of them.
//
// An AWB number is 11 digits: a 3-digit carrier prefix, a 7-digit running
// serial, and a check digit which is the serial modulo 7. That is why the last
// digit only ever runs 0-6, and why a series steps 1,2,3,4,5,6,0,1,2 - the
// serial keeps counting normally while the check digit wraps.
export const PREFIX_LENGTH = 3;
export const SERIAL_LENGTH = 7;
export const MAX_SERIAL = 9999999;

export const digitsOnly = (value) => String(value ?? '').replace(/[^0-9]/g, '');

export const checkDigitFor = (serial) => String(Number(serial) % 7);

export const padSerial = (serial) => String(serial).padStart(SERIAL_LENGTH, '0');

export const buildNumber = (prefix, serial) =>
  `${prefix}${padSerial(serial)}${checkDigitFor(serial)}`;

/** 21410000001 -> 214-10000001, the form the number is written in. */
export const formatNumber = (awbNumber) => {
  const digits = digitsOnly(awbNumber);
  if (digits.length !== PREFIX_LENGTH + SERIAL_LENGTH + 1) return String(awbNumber ?? '');
  return `${digits.slice(0, PREFIX_LENGTH)}-${digits.slice(PREFIX_LENGTH)}`;
};

/* ---------------------- a typed AWB, checked on its own ---------------------
 * IATA FORMAT ONLY. Nothing here consults the register: this is for a DIRECT
 * consignment, whose air waybill belongs to another airline and by definition
 * is not our stock. What CAN still be checked is that the number is a
 * well-formed air waybill at all, and that is worth doing, because the check
 * digit exists for exactly this purpose - it catches almost every single-digit
 * slip and digit transposition made copying a number off someone else's
 * paperwork. Left unchecked, a transposed digit surfaces weeks later when the
 * manifest will not reconcile against the other carrier's.
 *
 * TWO LENGTHS ARE ACCEPTED:
 *
 *   11 digits   prefix + serial + check digit - the full number as printed on
 *               the document. What a direct AWB should normally be typed as,
 *               since the prefix belongs to whoever issued it and cannot be
 *               read off our own carrier master.
 *    8 digits   serial + check digit, no prefix. Accepted because that is what
 *               the rest of this module stores for a registered AWB, so a
 *               number entered that way is not wrong - just missing an airline
 *               code we have no way to supply.
 *
 * Separators are ignored, so 214-10000001, 214 1000000 1 and 21410000001 are
 * the same number.
 *
 * The PREFIX is checked for shape only - three digits. IATA assigns the actual
 * codes, and without that list to check against, claiming to validate it would
 * be a stronger promise than the code can keep.
 *
 * Returns { ok:true, digits, prefix, serial, checkDigit } or { ok:false, error }.
 * `digits` is the canonical form to store: separators stripped.
 */
/* --------------------------- one spelling per number ------------------------
 * An AWB number gets typed three ways by three people - 9812 1234, 9812-1234,
 * 98121234 - and they are the same air waybill. Stored as typed, they are not:
 *
 *   - functions/aviationPendingLoads groups a shipment's legs by this exact
 *     string, so one offloaded AWB entered two ways reads as two AWBs, each
 *     still owing its own cargo.
 *   - /relatedCharges matches the other legs of a split shipment the same way,
 *     so the charges that belong on one invoice never find each other.
 *
 * So the SERVER decides the spelling: separators out, digits kept, on every
 * write. Doing it here rather than only in the grid means it also covers a
 * direct AWB posted by a stale tab, the migration, and anything else that ever
 * writes a consignment.
 *
 * SEPARATORS ONLY. Spaces, hyphens (including the unicode dashes a paste from
 * Word brings), dots and slashes are removed; anything else is left exactly as
 * it is. Stripping every non-digit would quietly turn a number nobody
 * recognises into a plausible-looking wrong one - 'AWB123' is a data-entry
 * problem to be looked at, not something to silently rewrite as '123'.
 *
 * Returns null for a value with nothing left in it, matching what the column
 * holds for a consignment with no AWB.
 */
export const normalizeAwb = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const stripped = raw.replace(/[\s./‐-―-]/g, '');
  return stripped || null;
};

export const validateAwbNumber = (value) => {
  const raw = String(value ?? '').trim();
  const digits = digitsOnly(raw);

  // Order matters. "Nothing was typed" and "what was typed is not a number"
  // are different faults, and testing the DIGITS for emptiness first reported
  // the wrong one for both: 'banana' has no digits either.
  if (!raw) {
    return { ok: false, error: 'Enter the air waybill number.' };
  }
  if (/[^0-9\s-]/.test(raw)) {
    return { ok: false, error: 'An AWB number is digits only (a dash between the prefix and the serial is fine).' };
  }
  if (!digits) {
    return { ok: false, error: 'Enter the air waybill number.' };
  }
  if (digits.length !== PREFIX_LENGTH + SERIAL_LENGTH + 1 && digits.length !== SERIAL_LENGTH + 1) {
    return {
      ok: false,
      error:
        `An AWB number is 11 digits - a 3-digit airline prefix, a 7-digit serial and a check digit ` +
        `(e.g. 214-10000001). This has ${digits.length}.`,
    };
  }

  const hasPrefix = digits.length === PREFIX_LENGTH + SERIAL_LENGTH + 1;
  const prefix = hasPrefix ? digits.slice(0, PREFIX_LENGTH) : '';
  const body = hasPrefix ? digits.slice(PREFIX_LENGTH) : digits;
  const serial = body.slice(0, SERIAL_LENGTH);
  const typedCheck = body.slice(SERIAL_LENGTH);
  const expected = checkDigitFor(serial);

  if (typedCheck !== expected) {
    // Worded for whoever has to fix it: the digit is calculated, not chosen,
    // so exactly one value is correct and the message says which.
    return {
      ok: false,
      error:
        `The last digit should be ${expected}, not ${typedCheck}. It is calculated, not free choice: ` +
        `${serial} divided by 7 leaves ${expected}. Check the AWB - either a digit in the serial is ` +
        `wrong, or the last one is.`,
    };
  }

  return { ok: true, digits, prefix, serial, checkDigit: expected };
};

/**
 * What a registration will actually produce, or why it will not.
 *
 * Returns `{ error }` for something the backend would reject anyway, so the
 * user is told while the form is still in front of them rather than after a
 * round trip. Returns `{ head, last, total, truncated }` otherwise: the first
 * few numbers and the final one, because "200 numbers from 214-10000001" does
 * not tell anyone where the block ends.
 */
export const previewSeries = (prefix, code, series, count) => {
  const cleanPrefix = digitsOnly(prefix);
  const cleanCode = digitsOnly(code);

  if (cleanPrefix.length !== PREFIX_LENGTH) {
    return { error: 'This carrier has no 3-digit AWB prefix. Set it in Setup > Carriers first.' };
  }
  if (cleanCode.length !== SERIAL_LENGTH + 1) return null;   // still typing

  const serialPart = cleanCode.slice(0, SERIAL_LENGTH);
  const typedCheck = cleanCode.slice(SERIAL_LENGTH);
  const expected = checkDigitFor(serialPart);
  if (typedCheck !== expected) {
    return {
      error:
        `The last digit should be ${expected}, not ${typedCheck} — it is calculated from the serial, ` +
        `not chosen. ${cleanPrefix}-${serialPart}${expected} is the only valid number for this serial.`,
    };
  }

  const start = Number(serialPart);
  const total = series ? Math.max(1, Math.floor(count) || 1) : 1;
  const last = Math.min(start + total - 1, MAX_SERIAL);

  const head = [];
  for (let s = start; s <= Math.min(start + 3, last); s++) head.push(formatNumber(buildNumber(cleanPrefix, s)));

  return {
    head,
    last: formatNumber(buildNumber(cleanPrefix, last)),
    total: last - start + 1,
    truncated: start + total - 1 > MAX_SERIAL,
  };
};

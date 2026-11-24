/**
 * Special-format AWBs for Setup > AWB Numbers - the airlines whose master AWBs
 * are not IATA numbers (DHL's 10-digit waybills, SN-035-1873 and the like).
 *
 * Mirrors the server's functions/awbl (parseSpecial / parseSpecialList) so the
 * register's preview shows exactly what will be stored; the server still
 * decides. One spelling per number: separators out, letters upper-cased, at
 * most 11 characters. An all-digit 11 is IATA's shape and goes through the
 * ordinary register, check digit and all.
 */
export const SPECIAL_MAX = 11;

export const normalizeSpecial = (value) =>
  String(value ?? '').trim().replace(/[\s./‐-―-]/g, '').toUpperCase();

const problemWith = (entry, number) => {
  if (!/^[A-Z0-9]+$/.test(number)) return `${entry}: letters and digits only.`;
  if (number.length > SPECIAL_MAX) return `${entry}: at most ${SPECIAL_MAX} letters and digits - this has ${number.length}.`;
  if (/^\d{11}$/.test(number)) return `${entry}: 11 digits is an IATA number - register it without Special format.`;
  return null;
};

/** The numbers a pasted list will register, and what is wrong with any. */
export const previewSpecial = (text) => {
  const entries = String(text ?? '').split(/[\n\r,;]+/).map((x) => x.trim()).filter(Boolean);
  const numbers = [];
  const errors = [];
  for (const entry of entries) {
    const number = normalizeSpecial(entry);
    const problem = problemWith(entry, number);
    if (problem) errors.push(problem);
    else if (!numbers.includes(number)) numbers.push(number);
  }
  return { numbers, errors };
};

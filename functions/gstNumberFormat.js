/**
 * The shape of a GST (sales tax) invoice number - Configuration > Invoices,
 * AppSetting `gstNumberFormat`. Asked for by Essani (the user, 2026-11-14):
 * four digits, and the format editable.
 *
 * A PATTERN, not a regular expression to match against: a number has to be
 * MADE from it, and a regular expression only says whether one fits. The run
 * of digits is written regex-style or as hashes, whichever reads better:
 *
 *   {CODE}-#          CL-24295         the default - as numbers always were
 *   {CODE}-####       ESS-0001         four digits, zero-filled
 *   {CODE}-\d{4}      ESS-0001         the same, regex-style
 *   GST/\d{6}         GST/000001       no company code
 *
 * {CODE} is the company's short code. The digits are the sequence, filled with
 * noughts to the width given and never cut: number 12345 under #### prints in
 * full. The sequence itself does not change with the format - it is a number
 * of its own (Sales_Tax_Invoice.seq) and carries on from the highest one the
 * company has, whatever the numbers before it looked like.
 *
 * No database - unit tested.
 */

const KEY = 'gstNumberFormat';
const DEFAULT_GST_FORMAT = '{CODE}-#';
const MAX_LENGTH = 40;
const MAX_WIDTH = 10;

class GstFormatError extends Error {}

/** `\d{4}` and `\d+` in hashes, so one reading serves both spellings. */
const asHashes = (pattern) => String(pattern)
  .replace(/\\d\{(\d{1,2})\}/g, (_, n) => '#'.repeat(Math.max(1, Number(n))))
  .replace(/\\d\+?/g, '#');

/** { before, width, after } - the parts around the one run of digits. */
function parseGstFormat(pattern) {
  const text = String(pattern ?? '').trim();
  if (!text) throw new GstFormatError('Enter a format, e.g. {CODE}-####.');
  if (text.length > MAX_LENGTH) throw new GstFormatError(`A format is at most ${MAX_LENGTH} characters.`);
  if (/[\u0000-\u001f]/.test(text)) throw new GstFormatError('A format is one line of text.');
  const hashes = asHashes(text);
  const unknown = (hashes.match(/\{[^}]*\}/g) || []).find((t) => t !== '{CODE}');
  if (unknown) throw new GstFormatError(`${unknown} is not known - the format can use {CODE}.`);
  const runs = hashes.match(/#+/g) || [];
  if (runs.length !== 1) {
    throw new GstFormatError('Put the number in once - as #### or \\d{4}, one # per digit.');
  }
  const width = runs[0].length;
  if (width > MAX_WIDTH) throw new GstFormatError(`At most ${MAX_WIDTH} digits.`);
  const at = hashes.indexOf(runs[0]);
  return { before: hashes.slice(0, at), width, after: hashes.slice(at + width) };
}

/** Throws a GstFormatError naming what is wrong; returns the trimmed format. */
function validateGstFormat(pattern) {
  parseGstFormat(pattern);
  return String(pattern).trim();
}

/** The number, from the format, the company's code and the sequence. */
function formatGstNumber(pattern, { code, seq }) {
  let parts;
  try {
    parts = parseGstFormat(pattern || DEFAULT_GST_FORMAT);
  } catch (e) {
    parts = parseGstFormat(DEFAULT_GST_FORMAT);
  }
  const fill = (s) => s.split('{CODE}').join(String(code ?? ''));
  return `${fill(parts.before)}${String(seq).padStart(parts.width, '0')}${fill(parts.after)}`;
}

async function readGstFormat(db, transaction) {
  const row = await db.AppSetting.findOne({ where: { key: KEY }, transaction });
  const value = row?.value;
  try {
    return value ? validateGstFormat(value) : DEFAULT_GST_FORMAT;
  } catch (e) {
    return DEFAULT_GST_FORMAT;
  }
}

module.exports = {
  KEY, DEFAULT_GST_FORMAT, GstFormatError,
  parseGstFormat, validateGstFormat, formatGstNumber, readGstFormat,
};

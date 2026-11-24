// What a search screen sends, made safe to bind. Pure - no database.

const moment = require('moment');

/** "%text%" for LIKE, with the user's own % _ [ taken literally. Null for blank. */
function likeContains(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  return `%${s.replace(/[[%_]/g, (ch) => `[${ch}]`)}%`;
}

/** 'YYYY-MM-DD' -> that day as a Date at midnight UTC, or null. */
function day(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const m = moment.utc(s, 'YYYY-MM-DD', true);
  return m.isValid() ? m.toDate() : null;
}

/** A positive integer id, or null. */
function id(value) {
  const s = String(value ?? '').trim();
  return /^\d{1,10}$/.test(s) && Number(s) > 0 ? Number(s) : null;
}

/** page (1-based) and size, clamped. */
function paging(query = {}, { size = 50, max = 200 } = {}) {
  const page = Math.max(1, Math.min(100000, parseInt(query.page, 10) || 1));
  const pageSize = Math.max(1, Math.min(max, parseInt(query.pageSize, 10) || size));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** A Climax voucher's internal number (tranfile.trannumb) - digits only. */
function tranNumber(value) {
  const s = String(value ?? '').trim();
  return /^\d{1,15}$/.test(s) ? s : null;
}

module.exports = { likeContains, day, id, paging, tranNumber };

/**
 * The highest DE / DR sequence already issued in a fiscal year, read back out
 * of the entry numbers - Direct_Jobs has no numeric sequence column.
 *
 * WHAT THIS REPLACES. The next number used to come from
 * `findOne({ where: { Type }, order: [['Entry_No', 'DESC']] })`: the
 * alphabetically LAST entry number, of any year and any document code. So:
 *
 *   - "CL-DE-9/27" sorts after "CL-DE-10/27", and from the tenth entry of a
 *     year every new entry was numbered 10 again;
 *   - "CL-JER-132/27" - a migrated legacy entry - sorts after every "CL-DE-",
 *     so the first entry after a migration took its number from a JER;
 *   - createDirectJob looked for Type 'revenue' whatever it was creating.
 *
 * Now: only this code, only this fiscal year, compared as numbers. Which
 * company's entries count is decided by the caller's query (the prefix
 * setting - see directJobEntryNo in routes/voucher); here the company prefix
 * is simply allowed to be there or not, so switching it in Config > Document
 * Numbers does not restart the sequence.
 *
 * WHICH HALF IS THE SEQUENCE. Numbers may be written seq/year (CL-DE-5/27) or
 * year/seq (CL-DE-27/5) - see functions/documentNumber - and "CL-DE-27/26" is
 * both FY26's 27th entry and FY27's 26th. Reading it the configured way is
 * always trusted; reading it the OTHER way (an install that switched order
 * mid-year) only counts an entry made on or after the fiscal year began, so
 * last year's 27th cannot open this year at 27.
 *
 * Pure, so it can be tested without a database.
 *
 * @param rows      [{ Entry_No, createdAt }]
 * @param code      'DE' | 'DR'
 * @param suffix    the fiscal year suffix, '27'
 * @param yearFirst the configured order for vouchers - true is year/seq
 * @param yearStart the fiscal year's first day, or null
 * @returns the highest sequence, 0 if none
 */
const lastDirectJobSeq = (rows, { code, suffix, yearFirst, yearStart }) => {
  const year = String(suffix);
  const start = yearStart ? new Date(yearStart).getTime() : null;
  const escaped = String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // CODE-a/b at the end, the code either leading or after a company prefix.
  const shape = new RegExp(`(?:^|-)${escaped}-(\\d+)/(\\d+)$`);
  let last = 0;

  for (const row of rows || []) {
    const m = String(row?.Entry_No || '').match(shape);
    if (!m) continue;
    const [, a, b] = m;

    const madeThisYear = start === null || new Date(row.createdAt).getTime() >= start;
    const readings = [];
    if (b === year) readings.push({ seq: Number(a), yearFirst: false });
    if (a === year) readings.push({ seq: Number(b), yearFirst: true });

    for (const r of readings) {
      if (r.yearFirst === Boolean(yearFirst) || madeThisYear) last = Math.max(last, r.seq);
    }
  }
  return last;
};

module.exports = { lastDirectJobSeq };

/* SEARCH ON THE DIRECT JOB LIST - every value the list shows, on the server.
 *
 * The list (Accounts > Direct Job E/R) shows, per entry: Entry #, Job #,
 * Account, Currency, Reference #, the Bank/Cash/Adjustment, Single/Multiple
 * and Revenue/Expense tags, Entry Date, Operation, Cheque #, Cheque Date,
 * Amount, Voucher # and Created By. A search matches an entry when it matches
 * ANY of those - the way the screen shows them, not the way they are stored:
 *
 *   - Adjust is shown as "Adjustment", and found by it;
 *   - Account is the account's title, not the stored id;
 *   - Job #, Voucher #, Created By: any line of the entry. The screen shows the
 *     first line's; a multiple entry covers several jobs and is found by each.
 *     Created By is the person only - a Climax voucher's is its add log,
 *     "NAME # IP:port", and the screen shows the NAME;
 *   - Amount is the lines' total, as the screen adds it up. Commas are
 *     ignored on both sides, so 1,500 and 1500 both find 1,500.00;
 *   - Entry Date / Cheque Date as the screen prints them, DD-Mon-YYYY, on the
 *     Pakistan calendar day: the browser shows them in local time, and the
 *     stored values are UTC - a voucher at 21:00Z on the 7th shows as the 8th.
 *     The entry date is the voucher's tranDate (stored as TEXT), or the
 *     entry's createdAt when it has no lines - functions/directJobEntry
 *     entryDateOf in the front end.
 *
 * Not searched: Cost Center, which the screen prints as the constant "KHI" on
 * every entry - a match on it would be a match on everything.
 *
 * Several words: each must match somewhere ("saim oct-2026" = made by Saim, in
 * October 2026). Matching is case-insensitive "contains"; % and _ typed in
 * the box are literal characters, not wildcards.
 *
 * Every condition is on Direct_Jobs or an uncorrelated subquery Postgres runs
 * once (hashed), so the count and the page cost the same whether or not the
 * lines table has an index on Direct_Job_Id.
 */
const { Op, literal } = require('sequelize');

// Where the screen's users are. Asia/Karachi has no DST.
const TIME_ZONE = 'Asia/Karachi';
const MAX_WORDS = 8;

const E = '"Direct_Job"';
const ISO_DAY = `'^[0-9]{4}-[0-9]{2}-[0-9]{2}'`;
const shownDay = (ts) => `to_char((${ts}) AT TIME ZONE '${TIME_ZONE}', 'DD-Mon-YYYY')`;

// Typed % and _ are characters, not wildcards (backslash is ILIKE's escape).
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const words = (search) =>
  (typeof search === 'string' ? search : '')
    .trim().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);

/** The Sequelize `where` for a search box's text; {} when it is empty. */
function directJobSearchWhere(search, sequelize) {
  const list = words(search);
  if (!list.length) return {};

  return {
    [Op.and]: list.map((word) => {
      const p = sequelize.escape(`%${escapeLike(word)}%`);
      const asText = (col) => `${E}."${col}"::text ILIKE ${p}`;
      const either = [
        asText('Entry_No'),
        asText('Reference_No'),
        asText('Cheque_No'),
        asText('Currency'),
        asText('Operation'),
        asText('Type'),
        asText('Job_Type'),
        `(CASE WHEN ${E}."Tran_Mode" = 'Adjust' THEN 'Adjustment' ELSE ${E}."Tran_Mode"::text END) ILIKE ${p}`,
        `${shownDay(`${E}."Cheque_Date"`)} ILIKE ${p}`,
        `${E}."Account_No" IN (SELECT id FROM "Child_Accounts" WHERE title ILIKE ${p})`,
        `${E}."id" IN (SELECT "Direct_Job_Id" FROM "Direct_Job_Association" WHERE "Job_No" ILIKE ${p})`,
        `${E}."id" IN (SELECT a."Direct_Job_Id" FROM "Direct_Job_Association" a
            JOIN "Vouchers" v ON v.id = a."Voucher_Id"
           WHERE v."voucher_Id" ILIKE ${p}
              -- The person, as shown: a Climax voucher's createdBy is its add
              -- log, "DIRECTOR 1 # 192.168.50.213:51582" (FE auditStamp personOf).
              OR btrim(split_part(v."createdBy", '#', 1)) ILIKE ${p}
              OR (CASE WHEN v."tranDate" ~ ${ISO_DAY} THEN ${shownDay('v."tranDate"::timestamptz')} END) ILIKE ${p})`,
        // No lines, so no voucher: the screen falls back to createdAt.
        `(${shownDay(`${E}."createdAt"`)} ILIKE ${p}
          AND ${E}."id" NOT IN (SELECT "Direct_Job_Id" FROM "Direct_Job_Association"))`,
      ];

      // The total, only when the word could be a number (digits, commas, a point).
      const digits = word.replace(/,/g, '');
      if (/^-?[0-9]*\.?[0-9]*$/.test(digits) && /[0-9]/.test(digits)) {
        const n = sequelize.escape(`%${digits}%`);
        either.push(`${E}."id" IN (SELECT "Direct_Job_Id" FROM "Direct_Job_Association"
          GROUP BY 1 HAVING round(sum("Amount"), 2)::text ILIKE ${n})`);
      }

      return { [Op.or]: either.map((sql) => literal(`(${sql})`)) };
    }),
  };
}

module.exports = { directJobSearchWhere, words, escapeLike, TIME_ZONE };

/**
 * THE SEARCH BOX on the Payments & Receipts list - what a typed text finds.
 *
 * Everything the list shows (the user, 2026-11-06: "check the search field"):
 * voucher no, name, type and currency as before, and now the CHEQUE NUMBER,
 * the AMOUNT and the DATE as the list prints it.
 *
 *   - A date was handed to `new Date()`: 05-11-2026 is read month first (10
 *     May), and was matched to that exact instant, so no date ever found
 *     anything - and "BRV 1", "ACS 2" or "429" were taken for dates too. A
 *     date is now DD-MM-YYYY (the list's own shape), DD/MM/YYYY or
 *     YYYY-MM-DD, read strictly, and finds the whole day - the office's day,
 *     UTC+5, as the screen shows it.
 *   - An amount ("1775000" or "1,775,000") finds a voucher whose party or bank
 *     line is that amount.
 *   - An INVOICE NUMBER finds the payments and receipts that settled it
 *     (2026-11-16): SNS-AI-620/26, paid by SNS-ADJ-P-31/27, was searched for
 *     here and found nothing, and read as missing. Through Invoice_Transactions,
 *     the knock-off's own record - every migrated payment has them too.
 *
 * No model imports - unit tested.
 */
const moment = require('moment');

// Pakistan has kept UTC+5 without daylight saving since 2009 (see legacyTime).
const OFFICE_OFFSET_MINUTES = 300;
const DAY_FORMATS = ['DD-MM-YYYY', 'D-M-YYYY', 'DD/MM/YYYY', 'D/M/YYYY', 'YYYY-MM-DD'];

/** The office day a search names, as [from, to) instants - or null. */
function searchedDay(text) {
  const m = moment.utc(String(text || '').trim(), DAY_FORMATS, true);
  if (!m.isValid()) return null;
  const from = new Date(m.startOf('day').valueOf() - OFFICE_OFFSET_MINUTES * 60000);
  return { from, to: new Date(from.getTime() + 24 * 3600000) };
}

/** The amount a search could be - commas allowed - or null. */
function searchedAmount(text) {
  const s = String(text || '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The where-condition for a search, or {} for none.
 * @param tools { Op, Sequelize, sequelize } - Sequelize's, passed in
 */
function payRecSearchWhere(search, { Op, Sequelize, sequelize }) {
  const text = String(search || '').trim();
  if (!text) return {};
  const like = { [Op.iLike]: `%${text}%` };
  const either = [
    { voucher_Id: like },
    { partyName: like },
    { type: like },
    { currency: like },
    { chequeNo: like },
    {
      id: {
        [Op.in]: Sequelize.literal(`(SELECT t."VoucherId" FROM "Invoice_Transactions" t
          JOIN "Invoices" i ON i."id" = t."InvoiceId"
          WHERE i."invoice_No" ILIKE ${sequelize.escape(`%${text}%`)})`),
      },
    },
  ];
  if (/^\d+$/.test(text)) {
    either.push(Sequelize.where(Sequelize.cast(Sequelize.col('Vouchers.voucher_No'), 'TEXT'), like));
  }
  const amount = searchedAmount(text);
  if (amount !== null) {
    either.push({
      id: {
        [Op.in]: Sequelize.literal(`(SELECT h."VoucherId" FROM "Voucher_Heads" h
          WHERE h."accountType" IN ('partyAccount', 'payAccount')
            AND ROUND(CAST(h.amount AS numeric), 2) = ${sequelize.escape(amount)})`),
      },
    });
  }
  const day = searchedDay(text);
  if (day) either.push({ createdAt: { [Op.gte]: day.from, [Op.lt]: day.to } });
  return { [Op.or]: either };
}

module.exports = { searchedDay, searchedAmount, payRecSearchWhere, OFFICE_OFFSET_MINUTES };

/**
 * WHAT ONE DECLARATION ACTUALLY EARNED, per charge head.
 *
 * The charge sheet answers "what have we billed"; this answers "what have we
 * been paid, what is still owed, and what is left after cost" - one row per
 * charge, revenue against cost, realized against unrealized.
 *
 * TWO SOURCES, AND THE SECOND IS THE POINT.
 *
 *   1. Charge_Head rows on the job. What the charge sheet shows.
 *   2. Direct Job E / R lines attached to the same job. Money booked straight
 *      to the ledger against the file - a cartage bill paid in cash, a client
 *      reimbursement - WITHOUT ever becoming a charge on the sheet.
 *
 * A file with a 5,000 payable typed on the sheet and a 1,500 expense entered
 * through Direct Job showed a 5,000 cost and a profit that was 1,500 too high,
 * because nothing on the job screen had ever looked at source 2. The summary is
 * the one place both have to meet.
 *
 * REALIZED MEANS SETTLED, not invoiced:
 *
 *   - a charge on an invoice that has been paid or received against is
 *     realized IN PROPORTION to how much of that invoice has been settled;
 *   - a charge on an unsettled invoice, or on none at all, is unrealized;
 *   - a DIRECT JOB line is always realized. It is not an invoice waiting to be
 *     paid - it is a voucher that already moved money.
 *
 * WHY PRO-RATA. Settlement is recorded against the INVOICE, not the line: an
 * invoice carries several charges and a part payment says nothing about which
 * of them it was for. Apportioning by each line's share of its invoice is the
 * only division the data supports. The alternative, which the freight summary
 * does, is to credit every line with the whole payment - so an invoice of five
 * charges settled in full reports five times its own value as realized.
 *
 * Kept free of model imports: this is the arithmetic somebody will check
 * against a printed statement, and standing up Sequelize to test it would mean
 * it never got tested.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* Currency amounts arrived at by summing, so "fully settled" is a comparison
 * with a tolerance - the same reason functions/invoiceSettlement keeps one. A
 * half-cent of float drift must not leave a paid invoice fractionally
 * unrealized forever. */
const TOLERANCE = 0.005;

const RECEIVABLE = 'Recievable';   // the app's own spelling - see customsCharge
const PAYABLE = 'Payble';

const blank = (chargeId, name) => ({
  charge: chargeId,
  name: name || null,
  realizedRevenue: 0,
  unrealizedRevenue: 0,
  totalRevenue: 0,
  realizedCost: 0,
  unrealizedCost: 0,
  totalCost: 0,
  realizedNet: 0,
  unrealizedNet: 0,
  totalNet: 0,
  // Where the money came from, so a row that looks wrong can be traced to the
  // screen that produced it rather than guessed at.
  fromCharges: 0,
  fromDirect: 0,
});

/**
 * How much of an invoice has been settled, as a FRACTION of it.
 *
 * `recieved` on a receivable, `paid` on a payable - the running totals the
 * payment screens maintain and the migration back-fills. Clamped to 0..1: an
 * over-payment is a real thing in this book (rounding, a client paying an old
 * balance with a new invoice) and must not make a line report more revenue
 * than it ever billed.
 */
const settledFractionOf = (invoice, receivable) => {
  if (!invoice) return 0;
  const total = num(invoice.total);
  const settled = num(receivable ? invoice.recieved : invoice.paid);
  if (settled <= TOLERANCE) return 0;
  // No total to divide by, yet money against it: treat as fully settled rather
  // than dividing by zero and reporting nothing.
  if (total <= TOLERANCE) return 1;
  if (settled >= total - TOLERANCE) return 1;
  return settled / total;
};

/**
 * @param {Object}  input
 * @param {Array}   input.charges       Charge_Head rows, each with `.Invoice`.
 * @param {Array}   input.directLines   Direct_Job_Association rows, each with
 *                                      `.DirectJob` carrying Type.
 * @param {Object}  [input.names]       charge id -> printable name.
 * @returns {{rows: Array, totals: Object}}
 */
function summariseCharges({ charges = [], directLines = [], names = {} } = {}) {
  const grouped = new Map();

  const rowFor = (chargeId) => {
    const key = String(chargeId ?? '');
    if (!grouped.has(key)) grouped.set(key, blank(key, names[key]));
    return grouped.get(key);
  };

  for (const c of charges || []) {
    if (!c) continue;
    const row = rowFor(c.charge);
    row.fromCharges += 1;

    /* The LOCAL amount, not the face amount. A charge raised in USD is money
     * in the books only once converted, and a summary mixing the two would
     * add dollars to rupees and print the sum. */
    const amount = num(c.local_amount);
    if (!amount) continue;

    const receivable = c.type !== PAYABLE;
    const fraction = settledFractionOf(c.Invoice, receivable);
    const realized = amount * fraction;
    const unrealized = amount - realized;

    if (receivable) {
      row.realizedRevenue += realized;
      row.unrealizedRevenue += unrealized;
    } else {
      row.realizedCost += realized;
      row.unrealizedCost += unrealized;
    }
  }

  for (const line of directLines || []) {
    if (!line) continue;
    const row = rowFor(line.Charge_Name);
    row.fromDirect += 1;

    /* THE LOCAL AMOUNT AGAIN, and a direct job line stores its rate and its
     * ex-rate separately rather than a converted column, so it is multiplied
     * here. An entry in PKR carries an ex-rate of 1 and is unaffected. */
    const amount = num(line.Amount) * (num(line.Ex_Rate) || 1);
    if (!amount) continue;

    // 'revenue' and 'expense' - Direct_Job.Type's own vocabulary, which is not
    // the charge sheet's Recievable/Payble. Both reach the same two columns.
    if (line.DirectJob?.Type === 'revenue') row.realizedRevenue += amount;
    else row.realizedCost += amount;
  }

  const rows = [...grouped.values()];
  for (const row of rows) {
    row.totalRevenue = row.realizedRevenue + row.unrealizedRevenue;
    row.totalCost = row.realizedCost + row.unrealizedCost;
    row.realizedNet = row.realizedRevenue - row.realizedCost;
    row.unrealizedNet = row.unrealizedRevenue - row.unrealizedCost;
    row.totalNet = row.totalRevenue - row.totalCost;
  }

  // Named charges first and alphabetically, so the sheet reads the same way
  // twice running. An id with no master behind it sorts last rather than
  // under an empty string at the top.
  rows.sort((a, b) => {
    if (!a.name !== !b.name) return a.name ? -1 : 1;
    return String(a.name || a.charge).localeCompare(String(b.name || b.charge));
  });

  const totals = rows.reduce((t, r) => {
    for (const k of [
      'realizedRevenue', 'unrealizedRevenue', 'totalRevenue',
      'realizedCost', 'unrealizedCost', 'totalCost',
      'realizedNet', 'unrealizedNet', 'totalNet',
    ]) t[k] += r[k];
    return t;
  }, {
    realizedRevenue: 0, unrealizedRevenue: 0, totalRevenue: 0,
    realizedCost: 0, unrealizedCost: 0, totalCost: 0,
    realizedNet: 0, unrealizedNet: 0, totalNet: 0,
  });

  return { rows, totals };
}

/**
 * One Direct Job line, as the charge sheet needs it to COPY the line across.
 *
 * The summary rows are totals per charge head, and a total cannot be turned
 * back into a charge line: it has no quantity, no currency and no description.
 * So the lines themselves go out beside the rows, and a summary row ticked on
 * the screen copies the lines filed under its head.
 *
 * `amount` is the line TOTAL - rate x quantity less the discount - which is
 * what the Direct Job screen stores and the voucher posts (see lineAmount in
 * the frontend's functions/directJobEntry). `type` keeps Direct_Job.Type's own
 * vocabulary; the screen maps it to a side of the sheet.
 */
const directLineDetail = (line) => ({
  id: line?.id ?? null,
  charge: line?.Charge_Name ?? null,
  type: line?.DirectJob?.Type === 'revenue' ? 'revenue' : 'expense',
  entryNo: line?.DirectJob?.Entry_No || null,
  description: line?.Description || '',
  basis: line?.Basis || null,
  quantity: num(line?.Quantity),
  currency: line?.Currency || null,
  exRate: num(line?.Ex_Rate) || 1,
  amount: num(line?.Amount),
});

/**
 * The Direct Job entries behind a file's lines, once each, in the order first
 * met: { id, entryNo, type }. The summary names them and each name opens its
 * entry (asked 2026-11-17) - the bare numbers it sent before could not.
 * An entry with no number (never saved through the screen) is left out, as
 * it was from the plain list.
 */
const directEntryRefs = (lines) => {
  const seen = new Map();
  for (const l of lines || []) {
    const e = l?.DirectJob;
    if (!e || e.id == null || !e.Entry_No || seen.has(e.id)) continue;
    seen.set(e.id, { id: e.id, entryNo: e.Entry_No, type: e.Type === 'revenue' ? 'revenue' : 'expense' });
  }
  return [...seen.values()];
};

module.exports = {
  summariseCharges, settledFractionOf, directLineDetail, directEntryRefs, TOLERANCE, RECEIVABLE, PAYABLE,
};

/**
 * How much of an invoice is still owed, as stored on the invoice itself.
 *
 * NOT functions/invoiceSettlement.js. That one derives settlement figures for
 * a MIGRATED invoice by summing legacy GL_InvAdjustments rows, and writes the
 * paid/recieved columns. This one READS those columns on an ordinary invoice
 * and answers "is anything still outstanding". Different inputs, different
 * question, deliberately separate files.
 *
 * WHY THE SQL LIVES HERE TOO
 *
 * The dashboard needs this rule twice: once as SQL, to filter to the invoices
 * still outstanding, and once as JavaScript, to show the figure on each row it
 * got back. Two expressions of one rule in two languages is the classic place
 * for a silent disagreement - the list says a document is outstanding and the
 * row next to it shows 0.00. Keeping both halves in one file is what makes
 * them checkable against each other.
 *
 * THE RULE
 *
 *   a bill        ('Payble')     is settled by `paid`
 *   anything else ('Recievable') is settled by `recieved`
 *   outstanding = total - settled
 *
 * 'Payble' and 'Recievable' ARE THE APP'S OWN MISSPELLINGS, and they are what
 * the column contains. Matching 'Payable' or 'Receivable' here would read the
 * wrong column - reporting settled invoices as outstanding and outstanding
 * ones as settled. There is at least one place in routes/invoice that gets
 * this wrong already (it tests for "Receivable", which never matches, so every
 * row falls to the payable branch); this file exists partly so the dashboard
 * does not join it.
 *
 * total, paid and recieved are STRING columns holding numbers, hence the casts
 * on both sides.
 */

// The spelling the database actually holds for a bill.
const PAYABLE = 'Payble';

// Money that never arrived reads as 0, whether it is null, '' or junk.
const num = (x) => Number(x) || 0;

/** What has been settled against this invoice. */
const settledOf = (inv) =>
  (inv?.payType === PAYABLE ? num(inv?.paid) : num(inv?.recieved));

/** What is still owed. Negative when an invoice has been over-settled. */
const outstandingOf = (inv) => num(inv?.total) - settledOf(inv);

/**
 * Is there enough left owing to be worth listing?
 *
 * Not `!== 0`. Rounding leaves fractions of a rupee behind on invoices that
 * are settled in every sense that matters, and a dashboard panel listing
 * fully-paid documents forever is worse than one that misses a 1-paisa
 * remainder.
 */
const EPSILON = 0.01;
const isOutstanding = (inv) => outstandingOf(inv) > EPSILON;

/* ---------------------------------------------------------------------------
 * The same rule in SQL.
 *
 * Written against the "Invoice" alias, which is what Sequelize names the main
 * table in an Invoice.findAll - including inside the subquery it generates
 * when a limit meets a hasMany include.
 *
 * NULLIF turns the empty string into NULL so COALESCE can catch it: ''::numeric
 * is an error in Postgres, and an invoice with a blank total is ordinary. This
 * is the idiom routes/ledgerMigration already uses on these same columns.
 * ------------------------------------------------------------------------ */
const SQL_TOTAL = `COALESCE(NULLIF("Invoice"."total", '')::numeric, 0)`;

const SQL_SETTLED =
  `COALESCE(NULLIF(CASE WHEN "Invoice"."payType" = '${PAYABLE}' ` +
  `THEN "Invoice"."paid" ELSE "Invoice"."recieved" END, '')::numeric, 0)`;

const SQL_OUTSTANDING_AMOUNT = `${SQL_TOTAL} - ${SQL_SETTLED}`;

const SQL_IS_OUTSTANDING = `${SQL_OUTSTANDING_AMOUNT} > ${EPSILON}`;

module.exports = {
  PAYABLE,
  EPSILON,
  num,
  settledOf,
  outstandingOf,
  isOutstanding,
  SQL_TOTAL,
  SQL_SETTLED,
  SQL_OUTSTANDING_AMOUNT,
  SQL_IS_OUTSTANDING,
};

/**
 * The default chart of accounts for a fresh install.
 *
 * Lives in functions/ rather than scripts/ deliberately: build/seal-tree.js
 * ships only index.js, package.json, routes, models, functions and config, so
 * anything under scripts/ does not exist inside the Docker image. A fresh
 * install deployed with compose could not otherwise create a chart of accounts
 * at all - and without one, clients have no ledger accounts and no invoice can
 * be raised.
 *
 * WHY THESE PARTICULAR NAMES
 *
 * They are not a suggested layout. The application looks several of them up by
 * exact string, and three are misspelled in the application itself:
 *
 *   ASSETS, LAIBILITY, EXPENSE   /accounts/balanceSheet    ("LAIBILITY")
 *   CAPITAL, Capitals, Drawings  /accounts/balanceSheet
 *   REVENUE                      profit & loss
 *   AIR/FCL/LCL FREIGHT INCOME   /invoice - the income and expense accounts a
 *   AIR/FCL FREIGHT EXPENSE      job invoice posts to, chosen by job subType
 *   LCL FREIGHT EXP              (EXP, not EXPENSE - also matched exactly)
 *   CONTRA ACCOUNT OPENINIG      opening balances ("OPENINIG")
 *   ACCOUNT RECEIVABLE           where a client's ledger account is created
 *   ACCOUNT PAYABLE              where a vendor's is
 *
 * Correcting a spelling here would not fail loudly - the balance sheet would
 * come back empty, or a job invoice would post with no income account.
 *
 * subCategory matters too: functions/ledgerMapping classifies a voucher line
 * from it (Customer/Vendor -> partyAccount, Bank/Cash -> payAccount).
 *
 * The chart is global. Child_Account has no CompanyId - accounts are shared and
 * the voucher carries the company - so this is seeded once per database, not
 * once per company.
 *
 * NOT run automatically at boot. An install that migrates from Climax gets its
 * chart from the legacy system, and /accounts/importAccount creates those rows
 * with explicit ids taken from the legacy data - seeding first would occupy
 * those ids and make the import collide. Seeding is therefore always an
 * explicit action.
 */

const db = require('../models');

// [title, subCategory, [children]]
const CHART = [
  ['ASSETS', 'General', [
    ['CURRENT ASSETS', 'General', [
      ['ACCOUNT RECEIVABLE', 'Customer', []],
      ['CASH & BANK', 'General', [
        ['CASH IN HAND', 'Cash', []],
        ['BANK ACCOUNTS', 'Bank', []],
      ]],
      ['ADVANCES & DEPOSITS', 'General', []],
      // Customs clearance. Duty, sales tax, income tax, port and terminal
      // charges that the agent pays on the client's behalf and recharges at
      // cost. An ASSET, not revenue: the money is recoverable from the client
      // and never belonged to the agency. On a goods declaration this is
      // routinely an order of magnitude larger than the agency fee, so booking
      // it as income overstates turnover and misstates the sales-tax position.
      //
      // Charges reach this account by carrying Charges.reimbursable, migrated
      // from the legacy Gen_Charges.IsReimbursment.
      ['DISBURSEMENTS RECOVERABLE', 'General', []],
    ]],
    ['FIXED ASSETS', 'General', []],
    ['CONTRA ACCOUNT OPENINIG', 'General', []],
  ]],

  ['LAIBILITY', 'General', [
    ['CURRENT LAIBILITY', 'General', [
      ['ACCOUNT PAYABLE', 'Vendor', []],
      ['ACCRUED EXPENSES', 'General', []],
      ['TAX PAYABLE', 'General', []],
    ]],
  ]],

  ['CAPITAL', 'General', [
    ['Capitals', 'General', []],
    ['RETAINED EARNINGS', 'General', []],
  ]],

  ['REVENUE', 'General', [
    ['FREIGHT INCOME', 'General', [
      ['AIR FREIGHT INCOME', 'General', []],
      ['FCL FREIGHT INCOME', 'General', []],
      ['LCL FREIGHT INCOME', 'General', []],
    ]],
    // Customs clearance revenue - the agency fee and the other services the
    // agent actually sells. Split by direction because import and export
    // clearance are different services with different cost structures, and
    // because they are reported separately.
    //
    // This is the AGENCY's own income only. Anything recharged at cost belongs
    // in DISBURSEMENTS RECOVERABLE above.
    ['CLEARING & FORWARDING INCOME', 'General', [
      ['CLEARANCE INCOME - IMPORT', 'General', []],
      ['CLEARANCE INCOME - EXPORT', 'General', []],
    ]],
    ['OTHER INCOME', 'General', [
      ['EX-CHANGE RATE GAIN / LOSS', 'General', []],
    ]],
  ]],

  ['EXPENSE', 'General', [
    ['FREIGHT EXPENSE', 'General', [
      ['AIR FREIGHT EXPENSE', 'General', []],
      ['FCL FREIGHT EXPENSE', 'General', []],
      ['LCL FREIGHT EXP', 'General', []],
    ]],
    ['CLEARING & FORWARDING EXPENSE', 'General', [
      ['CLEARANCE EXPENSE - IMPORT', 'General', []],
      ['CLEARANCE EXPENSE - EXPORT', 'General', []],
      // Expense splits by cargo type as well as direction: yard, handling and
      // cartage differ between a container and a groupage consignment. A job
      // with no cargo type recorded keeps posting to the two above.
      ['CLEARANCE EXPENSE - LCL', 'General', []],
      ['CLEARANCE EXPENSE - FCL', 'General', []],
    ]],
    ['OPERATING EXPENSES', 'General', []],
    ['Drawings', 'General', []],
  ]],
];

/** Depth-first, parents always before their children. */
function flatten(nodes = CHART, parentTitle = null, out = [], depth = 0) {
  for (const [title, subCategory, children] of nodes) {
    out.push({ title, subCategory, parentTitle, depth });
    flatten(children, title, out, depth + 1);
  }
  return out;
}

/**
 * Create whatever is missing. Matches on title, so it is safe to re-run and
 * safe on a database where some of these accounts were added by hand.
 *
 * @param {object} opts
 * @param {boolean} opts.apply  false (default) reports without writing.
 */
async function seedChartOfAccounts({ apply = false } = {}) {
  const { Child_Account, sequelize } = db;
  await db.syncPromise;

  const wanted = flatten();
  const existing = await Child_Account.findAll({
    attributes: ['id', 'title'],
    raw: true,
  });
  const byTitle = new Map(existing.map((a) => [a.title, a]));

  const missing = wanted.filter((w) => !byTitle.has(w.title));

  if (!apply || !missing.length) {
    return {
      applied: false,
      existingCount: existing.length,
      created: 0,
      missing: missing.map((m) => m.title),
    };
  }

  // One transaction: a half-built chart is worse than none, because the titles
  // that did land would make the next run think the work was already done.
  await sequelize.transaction(async (t) => {
    for (const w of wanted) {
      if (byTitle.has(w.title)) continue;
      const parent = w.parentTitle ? byTitle.get(w.parentTitle) : null;
      if (w.parentTitle && !parent) {
        throw new Error(`Parent "${w.parentTitle}" was not created before "${w.title}".`);
      }
      const created = await Child_Account.create({
        title: w.title,
        subCategory: w.subCategory,
        editable: '0',
        ChildAccountId: parent ? parent.id : null,
      }, { transaction: t });
      byTitle.set(w.title, { id: created.id, title: w.title });
    }
  });

  return {
    applied: true,
    existingCount: existing.length,
    created: missing.length,
    missing: [],
  };
}

module.exports = { seedChartOfAccounts, flatten, CHART };

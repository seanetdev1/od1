/**
 * The seeded chart of accounts must contain every title the code looks up.
 *
 * Several account titles are matched by exact string in the application, and
 * three of them are misspelled there ("LAIBILITY", "CONTRA ACCOUNT OPENINIG",
 * and "LCL FREIGHT EXP" rather than EXPENSE). Correcting a spelling in the seed
 * would not fail anything loudly - the balance sheet would just come back
 * empty, or a job invoice would post with no income account - so the contract
 * is pinned here.
 */
// The chart lives in functions/, not scripts/ - the sealed Docker image does
// not ship scripts/, so putting it there would mean a compose deploy could
// never seed one.
//
// It does NOT run queries until seedChartOfAccounts() is called, but merely
// requiring it runs `const db = require('../models')`, and requiring THAT boots
// Sequelize and fires sync() in the background. In a unit project with no
// database teardown that connection outlives the test environment and fails the
// run after every test has already passed:
//
//   ReferenceError: You are trying to `require` a file after the Jest
//   environment has been torn down
//
// Only flatten() is used here, and it is pure, so the models stub costs
// nothing.
jest.mock('../../models', () => ({}));

const { flatten } = require('../../functions/chartOfAccounts');

const flat = flatten();
const titles = flat.map((n) => n.title);

describe('seeded chart of accounts', () => {
  // Every title below is looked up by exact string somewhere in routes/.
  const REQUIRED = [
    'ASSETS',                    // /accounts/balanceSheet
    'LAIBILITY',                 // /accounts/balanceSheet - misspelled in the app
    'EXPENSE',                   // /accounts/balanceSheet
    'CAPITAL',
    'REVENUE',
    'Capitals',                  // /accounts/balanceSheet
    'Drawings',                  // /accounts/balanceSheet
    'CONTRA ACCOUNT OPENINIG',   // opening balances - misspelled in the app
    'ACCOUNT RECEIVABLE',        // client ledger accounts hang off this
    'ACCOUNT PAYABLE',           // vendor ledger accounts hang off this
    'AIR FREIGHT INCOME',        // /invoice, chosen by job subType
    'AIR FREIGHT EXPENSE',
    'FCL FREIGHT INCOME',
    'FCL FREIGHT EXPENSE',
    'LCL FREIGHT INCOME',
    'LCL FREIGHT EXP',           // EXP, not EXPENSE
  ];

  it.each(REQUIRED)('includes "%s"', (title) => {
    expect(titles).toContain(title);
  });

  it('has no duplicate titles', () => {
    // The seed matches existing accounts by title, so a duplicate would make it
    // create one and then treat the other as already present.
    const dupes = titles.filter((t, i) => titles.indexOf(t) !== i);
    expect(dupes).toEqual([]);
  });

  it('lists every parent before its children', () => {
    // The seed inserts in order and resolves each parent's id as it goes, so a
    // child appearing first would throw half way through.
    const seen = new Set();
    const outOfOrder = [];
    for (const node of flat) {
      if (node.parentTitle && !seen.has(node.parentTitle)) {
        outOfOrder.push(`${node.title} before ${node.parentTitle}`);
      }
      seen.add(node.title);
    }
    expect(outOfOrder).toEqual([]);
  });

  it('classifies the party and payment accounts so voucher lines resolve', () => {
    // functions/ledgerMapping.resolveAccountType reads subCategory:
    // Customer/Vendor -> partyAccount, Bank/Cash -> payAccount.
    const { resolveAccountType } = require('../../functions/ledgerMapping');
    const byTitle = new Map(flat.map((n) => [n.title, n]));
    const typeOf = (title) =>
      resolveAccountType({ AccountName: title, GL_COASubCategory: { SubCategory: byTitle.get(title).subCategory } });

    expect(typeOf('ACCOUNT RECEIVABLE')).toBe('partyAccount');
    expect(typeOf('ACCOUNT PAYABLE')).toBe('partyAccount');
    expect(typeOf('CASH IN HAND')).toBe('payAccount');
    expect(typeOf('BANK ACCOUNTS')).toBe('payAccount');
  });

  it('puts the payable account under a parent the ledger reads as payable', () => {
    // ledgerMapping.isPayableAccount tests the PARENT's name for PAYABLE /
    // LIABILITIES / the LAIBILITY misspelling. If ACCOUNT PAYABLE sat under a
    // parent named something else, every vendor voucher would be filed as a
    // client one.
    const { isPayableAccount } = require('../../functions/ledgerMapping');
    const byTitle = new Map(flat.map((n) => [n.title, n]));
    const parentOf = (title) => byTitle.get(title).parentTitle;

    expect(isPayableAccount({ GL_COA: { GL_COA: { AccountName: parentOf('ACCOUNT PAYABLE') } } })).toBe(true);
    expect(isPayableAccount({ GL_COA: { GL_COA: { AccountName: parentOf('ACCOUNT RECEIVABLE') } } })).toBe(false);
  });
});

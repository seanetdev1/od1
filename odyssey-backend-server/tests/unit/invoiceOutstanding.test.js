const {
  PAYABLE, EPSILON, num, settledOf, outstandingOf, isOutstanding,
  SQL_TOTAL, SQL_SETTLED, SQL_OUTSTANDING_AMOUNT, SQL_IS_OUTSTANDING,
} = require('../../functions/invoiceOutstanding');

/**
 * How much of an invoice is still owed.
 *
 * The dashboard's Pending Invoices/Bills panel filters on this in SQL and
 * displays it in JavaScript, so the two halves are tested together - a
 * disagreement would put a document in the list with 0.00 owing beside it.
 *
 * Not to be confused with functions/invoiceSettlement.js, which derives these
 * columns for a migrated invoice. This reads them.
 */

const bill = (over = {}) => ({ payType: 'Payble', total: '1000', paid: '0', recieved: '0', ...over });
const invoice = (over = {}) => ({ payType: 'Recievable', total: '1000', paid: '0', recieved: '0', ...over });

describe('which column holds the money', () => {
  test('a bill is settled by `paid`', () => {
    expect(settledOf(bill({ paid: '400', recieved: '999' }))).toBe(400);
  });

  test('a receivable is settled by `recieved`', () => {
    expect(settledOf(invoice({ paid: '999', recieved: '400' }))).toBe(400);
  });

  // THE MISSPELLINGS ARE LOAD-BEARING. 'Payble' and 'Recievable' are what the
  // column actually contains; matching the correct spelling reads the wrong
  // column, which reports settled invoices as outstanding and vice versa.
  test('the payable spelling is the app’s own misspelling', () => {
    expect(PAYABLE).toBe('Payble');
    // Spelled correctly, it is NOT recognised as a bill - it falls to the
    // receivable branch. Pinned so nobody "fixes" the spelling in one place.
    expect(settledOf({ payType: 'Payable', paid: '400', recieved: '0', total: '1000' })).toBe(0);
  });

  test('an unknown or missing payType is treated as a receivable', () => {
    expect(settledOf({ payType: null, paid: '400', recieved: '250', total: '1000' })).toBe(250);
    expect(settledOf({ paid: '400', recieved: '250', total: '1000' })).toBe(250);
  });
});

describe('reading the string columns', () => {
  // total/paid/recieved are STRING columns holding numbers.
  test('numeric strings are read as numbers', () => {
    expect(outstandingOf(invoice({ total: '1000', recieved: '250.50' }))).toBeCloseTo(749.5);
  });

  test('empty, null and junk all read as zero', () => {
    for (const blank of ['', null, undefined, 'n/a']) {
      expect(num(blank)).toBe(0);
      expect(outstandingOf(invoice({ total: '1000', recieved: blank }))).toBe(1000);
    }
    expect(outstandingOf(invoice({ total: '', recieved: '0' }))).toBe(0);
  });

  test('survives a missing invoice entirely', () => {
    expect(settledOf(null)).toBe(0);
    expect(outstandingOf(undefined)).toBe(0);
  });
});

describe('what counts as outstanding', () => {
  test('nothing paid is fully outstanding', () => {
    expect(isOutstanding(invoice())).toBe(true);
    expect(outstandingOf(invoice())).toBe(1000);
  });

  test('partly paid is still outstanding', () => {
    expect(isOutstanding(invoice({ recieved: '400' }))).toBe(true);
    expect(outstandingOf(invoice({ recieved: '400' }))).toBe(600);
  });

  test('fully paid is not', () => {
    expect(isOutstanding(invoice({ recieved: '1000' }))).toBe(false);
    expect(isOutstanding(bill({ paid: '1000' }))).toBe(false);
  });

  // A rounding remainder must not keep a settled document on the dashboard
  // forever.
  test('a sub-paisa remainder does not keep it listed', () => {
    expect(isOutstanding(invoice({ recieved: '999.995' }))).toBe(false);
    expect(EPSILON).toBe(0.01);
  });

  test('a remainder above the threshold does', () => {
    expect(isOutstanding(invoice({ recieved: '999.98' }))).toBe(true);
  });

  test('an over-settled invoice is not outstanding, and reads negative', () => {
    expect(isOutstanding(invoice({ recieved: '1200' }))).toBe(false);
    expect(outstandingOf(invoice({ recieved: '1200' }))).toBe(-200);
  });
});

describe('the SQL half says the same thing as the JavaScript half', () => {
  // Not executed here - there is no database in a unit test - but the two
  // forms must at least be built from the same constants, which is where a
  // drift would start.
  test('the SQL branches on the same misspelling', () => {
    expect(SQL_SETTLED).toContain(`= '${PAYABLE}'`);
    expect(SQL_SETTLED).toContain('"paid"');
    expect(SQL_SETTLED).toContain('"recieved"');
  });

  test('the SQL uses the same epsilon', () => {
    expect(SQL_IS_OUTSTANDING).toContain(`> ${EPSILON}`);
  });

  test('outstanding is total minus settled, in that order', () => {
    expect(SQL_OUTSTANDING_AMOUNT).toBe(`${SQL_TOTAL} - ${SQL_SETTLED}`);
  });

  // ''::numeric is an error in Postgres, and a blank total is ordinary - so
  // every cast has to be guarded or the whole panel 500s.
  test('every numeric cast is guarded against the empty string', () => {
    for (const fragment of [SQL_TOTAL, SQL_SETTLED]) {
      expect(fragment).toContain('NULLIF');
      expect(fragment).toContain('COALESCE');
      expect(fragment).toContain('::numeric');
    }
    // As many NULLIFs as casts.
    const casts = (SQL_OUTSTANDING_AMOUNT.match(/::numeric/g) || []).length;
    const guards = (SQL_OUTSTANDING_AMOUNT.match(/NULLIF/g) || []).length;
    expect(guards).toBe(casts);
  });

  // Sequelize names the main table "Invoice" in an Invoice.findAll, including
  // inside the subquery it generates when a limit meets a hasMany include.
  test('the SQL is written against the alias Sequelize actually uses', () => {
    expect(SQL_TOTAL).toContain('"Invoice"."total"');
    expect(SQL_SETTLED).toContain('"Invoice"."payType"');
  });
});

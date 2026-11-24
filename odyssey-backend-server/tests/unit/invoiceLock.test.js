/**
 * What an invoice freezes - functions/invoiceLock.
 *
 * One rule, three callers: aviation AWBs, customs charge sheets, and the
 * declaration lock that decides whether a whole job is read-only. It is worth
 * its own tests because every branch of it is a decision about whether an
 * ISSUED accounting document may be rewritten, and because it has to err the
 * safe way when it cannot tell.
 */
const { isInvoiceLocked } = require('../../functions/invoiceLock');

describe('a charge on no invoice', () => {
  test('is not frozen', () => {
    expect(isInvoiceLocked({ InvoiceId: null })).toBe(false);
    expect(isInvoiceLocked({})).toBe(false);
    expect(isInvoiceLocked(null)).toBe(false);
  });
});

describe('a charge on an APPROVED invoice', () => {
  test('is frozen - the document has been issued', () => {
    expect(isInvoiceLocked({ InvoiceId: 7 }, { approved: '1' })).toBe(true);
  });

  test('reads the invoice off the charge when one is not passed', () => {
    expect(isInvoiceLocked({ InvoiceId: 7, Invoice: { approved: '1' } })).toBe(true);
  });

  test('approved is compared as a STRING - the column holds "1", not 1', () => {
    expect(isInvoiceLocked({ InvoiceId: 7 }, { approved: 1 })).toBe(true);
  });
});

describe('a charge on an UNAPPROVED invoice', () => {
  test('is NOT frozen - which is the whole point of unapproving', () => {
    // Unapproving destroys the voucher and takes the invoice back out of the
    // ledger, so there is no issued figure left to contradict.
    expect(isInvoiceLocked({ InvoiceId: 7 }, { approved: '0' })).toBe(false);
  });

  test('as a number as well as a string', () => {
    expect(isInvoiceLocked({ InvoiceId: 7 }, { approved: 0 })).toBe(false);
    expect(isInvoiceLocked({ InvoiceId: 7 }, { approved: '' })).toBe(false);
  });

  test('but a NULL approved on a loaded invoice freezes it', () => {
    /* Not a real state - Invoice.approved defaults to "0" and every row in the
       book holds "1" or "0" - so a null here is a column that could not be
       read rather than an invoice nobody approved. It falls in with the
       cannot-tell case below and errs towards frozen, which is the only
       direction it is safe to err in. */
    expect(isInvoiceLocked({ InvoiceId: 7 }, { approved: null })).toBe(true);
  });
});

describe('when it cannot tell', () => {
  test('an invoice that could not be loaded FREEZES the charge', () => {
    /* The safe way round. Guessing "unapproved" from a missing include would
       open an issued document for editing, and the screens do not all carry
       the invoice row. */
    expect(isInvoiceLocked({ InvoiceId: 7 })).toBe(true);
    expect(isInvoiceLocked({ InvoiceId: 7 }, null)).toBe(true);
    expect(isInvoiceLocked({ InvoiceId: 7, Invoice: null })).toBe(true);
  });

  test('but an absent invoice ID still means no invoice', () => {
    // No link at all is knowledge, not ignorance.
    expect(isInvoiceLocked({ InvoiceId: undefined }, null)).toBe(false);
  });
});

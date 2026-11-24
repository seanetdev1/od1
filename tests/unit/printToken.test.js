// functions/printToken.js reads PRINT_TOKEN_SECRET (falling back to
// JWT_SECRET) once, at require time - neither is guaranteed to be set in a
// pure unit-test process (dotenv is only loaded when index.js is required,
// which unit tests deliberately never do), so we set it ourselves before the
// first require below to mirror how it's configured in every real
// environment (.env sets PRINT_TOKEN_SECRET).
process.env.PRINT_TOKEN_SECRET = 'unit-test-print-secret';

const jwt = require('jsonwebtoken');
const { signPrintToken, verifyPrintToken } = require('../../functions/printToken');

describe('printToken', () => {
  it('signs a token that verifies successfully for the same invoiceId', () => {
    const token = signPrintToken('inv-123');
    const decoded = verifyPrintToken(token, 'inv-123');
    expect(decoded.invoiceId).toBe('inv-123');
    expect(decoded.purpose).toBe('invoice-print');
  });

  it('coerces invoiceId to a string on both sign and verify (numeric vs string match)', () => {
    const token = signPrintToken(123);
    expect(() => verifyPrintToken(token, '123')).not.toThrow();
    expect(() => verifyPrintToken(token, 123)).not.toThrow();
  });

  it('throws when the invoiceId does not match the token', () => {
    const token = signPrintToken('inv-123');
    expect(() => verifyPrintToken(token, 'inv-999')).toThrow(
      'Print token does not match this invoice.'
    );
  });

  it('throws for a token signed with a different purpose', () => {
    const token = jwt.sign(
      { invoiceId: 'inv-123', purpose: 'something-else' },
      process.env.PRINT_TOKEN_SECRET,
      { expiresIn: '5m' }
    );
    expect(() => verifyPrintToken(token, 'inv-123')).toThrow(
      'Print token does not match this invoice.'
    );
  });

  it('throws for an expired token', () => {
    const expired = jwt.sign(
      { invoiceId: 'inv-123', purpose: 'invoice-print' },
      process.env.PRINT_TOKEN_SECRET,
      { expiresIn: -10 }
    );
    expect(() => verifyPrintToken(expired, 'inv-123')).toThrow();
  });

  it('throws for a token signed with the wrong secret', () => {
    const token = jwt.sign(
      { invoiceId: 'inv-123', purpose: 'invoice-print' },
      'a-completely-different-secret',
      { expiresIn: '5m' }
    );
    expect(() => verifyPrintToken(token, 'inv-123')).toThrow();
  });

  it('throws for a garbage token string', () => {
    expect(() => verifyPrintToken('not-a-real-token', 'inv-123')).toThrow();
  });
});

/**
 * LEDGER PRINT TOKENS.
 *
 * A ledger has no single id to pin a token to - it is an account, a range, a
 * currency and a company - so those ride INSIDE the token and the endpoint
 * reads them from there rather than from the request. These tests pin that,
 * because the alternative is a session-less page that will read whatever
 * ledger its query string names.
 */
describe('ledger print tokens', () => {
  const { signLedgerPrintToken, verifyLedgerPrintToken } = require('../../functions/printToken');

  const params = {
    id: 42, from: '01-01-2026', to: '31-01-2026', currency: 'PKR', company: 1,
  };

  it('round-trips the ledger it was issued for, as strings', () => {
    const out = verifyLedgerPrintToken(signLedgerPrintToken(params));
    expect(out).toEqual({
      id: '42', from: '01-01-2026', to: '31-01-2026', currency: 'PKR', company: '1',
    });
  });

  it('carries the parameters IN the token, not alongside it', () => {
    // The whole point: a caller cannot swap the account after signing.
    const decoded = jwt.verify(signLedgerPrintToken(params), process.env.PRINT_TOKEN_SECRET);
    expect(decoded.purpose).toBe('ledger-print');
    expect(decoded.params.id).toBe('42');
  });

  it('refuses an INVOICE print token', () => {
    // Both are signed with the same secret, so `purpose` is the only thing
    // stopping one being presented as the other.
    const invoiceToken = signPrintToken('inv-1');
    expect(() => verifyLedgerPrintToken(invoiceToken)).toThrow(/not a ledger print token/i);
  });

  it('refuses a ledger token where an invoice one is expected', () => {
    const ledgerToken = signLedgerPrintToken(params);
    expect(() => verifyPrintToken(ledgerToken, 'inv-1')).toThrow();
  });

  it('refuses a token signed with another secret', () => {
    const forged = jwt.sign(
      { purpose: 'ledger-print', params: { ...params, id: '999' } },
      'some-other-secret',
    );
    expect(() => verifyLedgerPrintToken(forged)).toThrow();
  });

  it('refuses a token with no params', () => {
    const empty = jwt.sign({ purpose: 'ledger-print' }, process.env.PRINT_TOKEN_SECRET);
    expect(() => verifyLedgerPrintToken(empty)).toThrow(/not a ledger print token/i);
  });

  it('expires', () => {
    const expired = jwt.sign(
      { purpose: 'ledger-print', params },
      process.env.PRINT_TOKEN_SECRET,
      { expiresIn: -10 },
    );
    expect(() => verifyLedgerPrintToken(expired)).toThrow(/jwt expired/i);
  });
});

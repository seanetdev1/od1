const jwt = require('jsonwebtoken');

// PRINT_TOKEN_SECRET keeps this fully separate from the login JWT_SECRET
// (recommended, so a leaked print token can never double as a login session
// token). Resolved centrally in functions/secrets.js, which falls back to
// JWT_SECRET when PRINT_TOKEN_SECRET is unset.
const { PRINT_TOKEN_SECRET } = require('./secrets');

function signPrintToken(invoiceId) {
  return jwt.sign(
    { invoiceId: String(invoiceId), purpose: 'invoice-print' },
    PRINT_TOKEN_SECRET,
    { expiresIn: '5m' }
  );
}

function verifyPrintToken(token, invoiceId) {
  const decoded = jwt.verify(token, PRINT_TOKEN_SECRET);
  if (decoded.purpose !== 'invoice-print' || String(decoded.invoiceId) !== String(invoiceId)) {
    throw new Error('Print token does not match this invoice.');
  }
  return decoded;
}

/* ----------------------------- report prints -------------------------------
 * The same short-lived, purpose-scoped idea as an invoice print token, for a
 * report that has no single id to pin it to.
 *
 * THE PARAMETERS LIVE INSIDE THE TOKEN, and that is the point. A ledger is
 * identified by an account, a date range, a currency and a company; if the
 * print page took those from the query string it would be an unauthenticated
 * endpoint that reads ANY account's ledger for anyone who can guess a URL.
 * Signing them means a token opens exactly the ledger it was issued for and
 * nothing else, so the page stays as safe as the invoice one it is modelled on.
 */
const LEDGER_PURPOSE = 'ledger-print';

/* `print` is how the page is PRINTED, apart from which ledger: whose
 * letterhead heads it and who printed it. The print page has no session, so
 * it cannot find either for itself - the ledger PDF printed a blank letterhead
 * and an empty "Printed By" (2026-11-13). Kept out of `params`, which is the
 * ledger the token opens and nothing else. */
function signLedgerPrintToken({ id, from, to, currency, company }, { letterhead, printedBy } = {}) {
  return jwt.sign(
    {
      purpose: LEDGER_PURPOSE,
      params: {
        id: String(id ?? ''),
        from: String(from ?? ''),
        to: String(to ?? ''),
        currency: String(currency ?? ''),
        company: String(company ?? ''),
      },
      print: {
        letterhead: String(letterhead ?? ''),
        printedBy: String(printedBy ?? ''),
      },
    },
    PRINT_TOKEN_SECRET,
    { expiresIn: '5m' }
  );
}

/** The ledger the token opens, and how to print it. Throws if it is not one of ours. */
function readLedgerPrintToken(token) {
  const decoded = jwt.verify(token, PRINT_TOKEN_SECRET);
  if (decoded.purpose !== LEDGER_PURPOSE || !decoded.params) {
    throw new Error('Not a ledger print token.');
  }
  return { params: decoded.params, print: decoded.print || {} };
}

/** The parameters the token was issued for. Throws if it is not one of ours. */
function verifyLedgerPrintToken(token) {
  return readLedgerPrintToken(token).params;
}

/* ------------------------------ documents ----------------------------------
 * An attached document opened in a browser tab (a PDF) or an <img> (a scan in
 * Odyssey's image viewer) - neither sends the login header, so the screen asks
 * GET /documents/:id/link, which checks the user may see it and hands back a
 * URL carrying one of these: that document only, for a few minutes. Ten, not
 * five - a PDF tab reloaded a little later should still open.
 */
const DOCUMENT_PURPOSE = 'document-view';

function signDocumentToken(documentId) {
  return jwt.sign({ purpose: DOCUMENT_PURPOSE, documentId: String(documentId) }, PRINT_TOKEN_SECRET, { expiresIn: '10m' });
}

/** The document id the token opens. Throws if it is not one of ours, or has expired. */
function verifyDocumentToken(token) {
  const decoded = jwt.verify(String(token || ''), PRINT_TOKEN_SECRET);
  if (decoded.purpose !== DOCUMENT_PURPOSE || !decoded.documentId) throw new Error('Not a document token.');
  return decoded.documentId;
}

module.exports = {
  signPrintToken, verifyPrintToken, signLedgerPrintToken, verifyLedgerPrintToken, readLedgerPrintToken,
  signDocumentToken, verifyDocumentToken,
};

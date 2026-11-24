/**
 * The ledger print endpoint, and the one thing about it that is easy to get
 * wrong: it has to be reachable WITHOUT a login session.
 *
 * It is loaded by a headless browser that has no session cookie, so it is gated
 * by its own short-lived token instead - exactly as /invoice/getPrintData is.
 * That exemption lives in a list in index.js (PUBLIC_PATHS), and a route added
 * without an entry there fails in a way that names the wrong culprit: verify()
 * rejects it, the bare print page turns any failed request into "this link is
 * invalid or has expired", and the PDF renderer reports a rejected token. The
 * one thing it is not, at that point, is a token problem.
 *
 * So the assertion that matters is not "does it work" but "how far does an
 * unauthenticated request GET" - past the session check, as far as the token
 * check. Everything else here is secondary.
 */
process.env.FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'http://localhost:3003';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'smtp.invalid';
process.env.SMTP_USER = process.env.SMTP_USER || 'test@example.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'test-password';

const request = require('supertest');
const app = require('../../index');
const { signLedgerPrintToken } = require('../../functions/printToken');

describe('Ledger print data - routes/accounts/getLedgerPrintData', () => {
  const params = {
    id: '1', from: '01-01-2026', to: '31-12-2026', currency: 'PKR', company: '1',
  };

  it('is reachable with NO login session at all', async () => {
    // The regression this file exists for. Without its PUBLIC_PATHS entry the
    // session middleware answers first, and the reply is about a session rather
    // than about the print token - which is what sent a missing exemption off
    // being investigated as an expired token.
    const res = await request(app)
      .get('/accounts/getLedgerPrintData')
      .set('printtoken', signLedgerPrintToken(params));

    expect(res.status).not.toBe(401);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.result)).toBe(true);
  });

  it('reads its parameters from the TOKEN, not the request', async () => {
    // A URL cannot be edited into another account's ledger: whatever the caller
    // sends alongside, the endpoint answers for what was signed.
    const res = await request(app)
      .get('/accounts/getLedgerPrintData')
      .set('printtoken', signLedgerPrintToken(params))
      .set('id', '999999')
      .set('company', '999999');

    expect(res.status).toBe(200);
    expect(res.body.params).toEqual(params);
  });

  it('refuses a request with no print token', async () => {
    const res = await request(app).get('/accounts/getLedgerPrintData');
    expect(res.status).toBe(401);
    // ITS OWN refusal, not the session middleware's - if this ever reads
    // "Session expired" the PUBLIC_PATHS entry has been lost.
    expect(String(res.body.result || '')).toMatch(/print link/i);
  });

  it('refuses a token that is not a ledger print token', async () => {
    const { signPrintToken } = require('../../functions/printToken');
    const res = await request(app)
      .get('/accounts/getLedgerPrintData')
      .set('printtoken', signPrintToken('inv-1'));

    expect(res.status).toBe(401);
    expect(String(res.body.result || '')).toMatch(/print link/i);
  });

  it('refuses a forged token', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ purpose: 'ledger-print', params }, 'not-the-secret');
    const res = await request(app)
      .get('/accounts/getLedgerPrintData')
      .set('printtoken', forged);

    expect(res.status).toBe(401);
  });
});

/* THE LETTERHEAD AND WHO PRINTED IT (2026-11-13). The print page has no
 * session, so it could not find the company record or the user's name - the
 * PDF printed a blank letterhead and an empty "Printed By". They come with the
 * rows now, from the token; the ledger the token opens is unchanged. */
describe('Ledger print data - the letterhead and the printer', () => {
  const { anyCompany } = require('../helpers/company');
  let company;
  beforeAll(async () => { company = await anyCompany(); });

  const fetchWith = (params, print) => request(app)
    .get('/accounts/getLedgerPrintData')
    .set('printtoken', signLedgerPrintToken(params, print));

  it("sends the ledger's company as the letterhead, and who printed it", async () => {
    const params = { id: '1', from: '01-01-2026', to: '31-12-2026', currency: 'PKR', company: String(company.id) };
    const res = await fetchWith(params, { printedBy: 'Saim' });
    expect(res.status).toBe(200);
    expect(res.body.letterhead).toMatchObject({ id: company.id, title: company.title });
    expect(res.body.printedBy).toBe('Saim');
    // The ledger the token opens is still exactly what was signed.
    expect(res.body.params).toEqual(params);
  });

  it('a token that carries no printing details still opens, printed by nobody', async () => {
    const params = { id: '1', from: '01-01-2026', to: '31-12-2026', currency: 'PKR', company: String(company.id) };
    const res = await fetchWith(params, undefined);
    expect(res.status).toBe(200);
    expect(res.body.letterhead).toMatchObject({ id: company.id });
    expect(res.body.printedBy).toBe('');
  });
});

/**
 * Agent Receivable & Payable Statement - see functions/agentStatement.
 *
 *   GET  /misc/agentStatement          headers: ason (YYYY-MM-DD, default
 *                                      today), from (YYYY-MM-DD, the cut-off;
 *                                      none = every invoice), company ('all'
 *                                      or an id)
 *   GET  /misc/agentStatement/manual   the typed-in section
 *   POST /misc/agentStatement/manual   { title, lines: [{ agent, amount }] }
 *
 * WHICH ACCOUNTS ARE AGENTS: every party account that has ever been the party
 * on an agent document - an Agent Invoice / Bill, or an opening raised for an
 * agent. Those name the party by its ledger account: on the SNS book every one
 * does. Only migrated customs invoices carry a client id there, and the
 * two kinds of id overlap - matching a client id too would let some local
 * customer whose account shares the number onto the list. A disabled party
 * (Setup > Parties, not active) is left off, balance or not.
 *
 * WHAT IS COUNTED: that account's APPROVED agent invoices and bills in
 * currencies other than rupees, dated up to the end of the As on day - what is
 * still owed on each, as Agent Invoice Balancing counts it - each currency's
 * balance added as it stands, nothing converted (functions/agentStatement).
 *
 * THE CUT-OFF (from): an invoice or bill dated before it is left out, whatever
 * is still owed on it - the user's request, 2026-10-09, so that what is owed on
 * old documents nobody will settle (a migrated book's, say) can be set aside.
 * Optional; without it the report is every document to the As on day.
 */
const routes = require('express').Router();
const moment = require('moment');
const db = require('../../models');
const { buildAgentStatement } = require('../../functions/agentStatement');

const AGENT_TYPES = ['Agent Invoice', 'Old Agent Invoice', 'Agent Bill', 'Old Agent Bill'];
const MANUAL_KEY = 'agentStatementManual';

const asOnOf = (v) => {
  const m = moment(String(v || ''), 'YYYY-MM-DD', true);
  return (m.isValid() ? m : moment()).format('YYYY-MM-DD');
};
const companyOf = (v) => {
  const s = String(v ?? '').trim();
  return /^\d+$/.test(s) ? s : null;   // anything else is every company
};

routes.get('/agentStatement', async (req, res) => {
  try {
    const asOn = asOnOf(req.headers.ason);
    const before = moment(asOn, 'YYYY-MM-DD').add(1, 'day').format('YYYY-MM-DD');
    const fromDay = moment(String(req.headers.from || ''), 'YYYY-MM-DD', true);
    const from = fromDay.isValid() ? fromDay.format('YYYY-MM-DD') : null;
    if (from && from > asOn) {
      return res.status(400).json({ status: 'error', result: 'The cut-off date is after the As on date.' });
    }
    const company = companyOf(req.headers.company);
    const companyWhere = company ? 'AND i."companyId"::text = :company' : '';

    /* WHAT IS COUNTED: each agent's invoices and bills - what is still owed on
       each, as Agent Invoice Balancing and Job Balancing count it (the
       document's total less what was received or paid against it), for
       documents dated up to the end of the As on day. The user's rule
       (2026-10-09): this report is about invoices and bills, like those two.
       It read the agent's ledger before, which also held advances and
       payments made on our behalf that no invoice was knocked off by -
       GRAVITAS showed 181,032.55 here against 85,136.07 there. */
    const rows = await db.sequelize.query(`
      WITH agent_parties AS (
        SELECT DISTINCT i."party_Id" AS pid FROM "Invoices" i
        WHERE i.type IN (:types) OR LOWER(i."partyType") = 'agent'
      ),
      agent_accounts AS (
        SELECT a.id AS acct FROM "Child_Accounts" a JOIN agent_parties p ON p.pid = a.id::text
        -- Not a DISABLED party's: one whose parties are all switched off in
        -- Setup > Parties. An account with no party record still counts.
        WHERE NOT (
          EXISTS (SELECT 1 FROM "Client_Associations" ca WHERE ca."ChildAccountId" = a.id)
          AND NOT EXISTS (
            SELECT 1 FROM "Client_Associations" ca JOIN "Clients" c ON c.id = ca."ClientId"
            WHERE ca."ChildAccountId" = a.id AND c.active IS NOT FALSE
          )
        )
      )
      SELECT aa.acct,
             COALESCE(
               (SELECT c.name FROM "Client_Associations" ca2 JOIN "Clients" c ON c.id = ca2."ClientId"
                 WHERE ca2."ChildAccountId" = aa.acct ORDER BY c.id LIMIT 1),
               (SELECT a.title FROM "Child_Accounts" a WHERE a.id = aa.acct)
             ) AS name,
             UPPER(TRIM(i.currency)) AS currency,
             -- Still owed: what they owe us positive, what we owe them negative.
             SUM(CASE WHEN i."payType" = 'Recievable'
                      THEN COALESCE(NULLIF(i.total::text, '')::numeric, 0) - COALESCE(NULLIF(i.recieved::text, '')::numeric, 0)
                      ELSE -(COALESCE(NULLIF(i.total::text, '')::numeric, 0) - COALESCE(NULLIF(i.paid::text, '')::numeric, 0))
                 END) AS fc
      FROM agent_accounts aa
      JOIN "Invoices" i ON i."party_Id" = aa.acct::text
      WHERE (i.type IN (:types) OR LOWER(i."partyType") = 'agent')
        -- Approved only (the user's rule): one not yet approved is not issued.
        AND i.approved::text IN ('1', 'true')
        AND i.currency IS NOT NULL AND UPPER(TRIM(i.currency)) NOT IN ('PKR', '')
        AND i."createdAt" < :before
        ${from ? 'AND i."createdAt" >= :from' : ''}
        ${companyWhere}
      GROUP BY aa.acct, UPPER(TRIM(i.currency))
    `, {
      replacements: { types: AGENT_TYPES, before, from, company },
      type: db.Sequelize.QueryTypes.SELECT,
    });

    const statement = buildAgentStatement(rows);
    res.json({
      status: 'success',
      result: { asOn, from, company: company || 'all', ...statement },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/* THE TYPED-IN SECTION - agents kept outside these books (on the sheet,
   another install's), with a heading of the user's own. Kept between runs, as
   the workbook carried it from one date to the next. */
routes.get('/agentStatement/manual', async (req, res) => {
  try {
    const row = await db.AppSetting.findOne({ where: { key: MANUAL_KEY } });
    let value = { title: '', lines: [] };
    try { value = { ...value, ...JSON.parse(row?.value || '{}') }; } catch (_) { /* unreadable: empty */ }
    res.json({ status: 'success', result: value });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/agentStatement/manual', async (req, res) => {
  try {
    const title = String(req.body?.title ?? '').trim().slice(0, 150);
    const given = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (given.length > 100) {
      return res.status(400).json({ status: 'error', result: 'At most 100 lines.' });
    }
    const lines = [];
    for (const [i, l] of given.entries()) {
      const agent = String(l?.agent ?? '').trim().slice(0, 150);
      const raw = String(l?.amount ?? '').replace(/,/g, '').trim();
      if (!agent && !raw) continue;                 // an empty row
      const amount = Number(raw);
      if (!agent || raw === '' || !Number.isFinite(amount)) {
        return res.status(400).json({ status: 'error', result: `Line ${i + 1} needs an agent and an amount.` });
      }
      lines.push({ agent, amount: Math.round(amount * 100) / 100 });
    }
    const value = JSON.stringify({ title, lines });
    const existing = await db.AppSetting.findOne({ where: { key: MANUAL_KEY } });
    if (existing) await existing.update({ value });
    else await db.AppSetting.create({ key: MANUAL_KEY, value });
    res.json({ status: 'success', result: { title, lines } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

module.exports = routes;

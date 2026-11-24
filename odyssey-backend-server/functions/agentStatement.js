/**
 * THE AGENT RECEIVABLE & PAYABLE STATEMENT - what each overseas agent owes us,
 * and what we owe each, as on a date.
 *
 * Built to the accounts team's own workbook ("International Report Recd & Pay
 * as on ..."), which they assembled from Climax's agent invoice balancing:
 * agents we owe under AGENT PAYABLE STATEMENT, most owed first; agents owing
 * us under AGENT RECEIVABLE REPORT, largest first; each with its total.
 *
 * EACH AGENT'S FIGURE IS ITS INVOICES AND BILLS - what is still owed on each
 * approved one, as Agent Invoice Balancing and Job Balancing count it. The
 * user's rule (2026-10-09), replacing the agent's LEDGER, which this read at
 * first: the ledger also holds advances, and payments made on our behalf,
 * that no invoice was knocked off by (GRAVITAS: 181,032.55 by ledger, 85,136.07
 * by its invoices - the same gap was in Climax). On the 28-09-26 sheet, 106 of
 * the 122 agents found here match by invoices, 94 by ledger.
 *
 * THE CURRENCIES ADDED AS THEY STAND, nothing converted: USD 1,000 and GBP 200
 * make 1,200. The user's choice (2026-10-09) - the team wants an
 * approximation, and it is how their workbook's PIVOT adds Climax's balances
 * (Denholm Good Logistics' GBP 21,501 shows there as -21,501). It used to
 * convert through rupees at a USD rate. Rupee invoices are left out - this is
 * the international statement, and an agent that is also a local client
 * would otherwise carry its local trade into it.
 *
 * Signs as the workbook: a debit balance (they owe us) is positive, a credit
 * balance (we owe them) negative.
 */
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(v * 100) / 100;
/** Half a cent - what shows as 0.00 is no balance. */
const SETTLED_BELOW = 0.005;

/**
 * @param rows  [{ acct, name, fc }] - an agent account's net postings in one
 *              foreign currency, in that currency
 */
function buildAgentStatement(rows) {
  const agents = new Map();
  for (const r of rows || []) {
    const a = agents.get(r.acct) || { accountId: r.acct, agent: r.name, sum: 0 };
    a.agent = a.agent || r.name;
    a.sum += num(r.fc);
    agents.set(r.acct, a);
  }

  const lines = [...agents.values()]
    .map(({ sum, ...a }) => ({ ...a, amount: round2(sum) }))
    .filter((a) => Math.abs(a.amount) >= SETTLED_BELOW);
  const byName = (a, b) => String(a.agent || '').localeCompare(String(b.agent || ''));
  const payables = lines.filter((a) => a.amount < 0).sort((a, b) => (a.amount - b.amount) || byName(a, b));
  const receivables = lines.filter((a) => a.amount > 0).sort((a, b) => (b.amount - a.amount) || byName(a, b));
  const total = (list) => round2(list.reduce((t, a) => t + a.amount, 0));

  return {
    payables,
    receivables,
    totals: { payable: total(payables), receivable: total(receivables) },
  };
}

module.exports = { buildAgentStatement, SETTLED_BELOW };

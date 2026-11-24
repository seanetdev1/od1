/**
 * ADVANCE MONEY NOT KNOCKED OFF, as rows of Job Balancing - the user's
 * request, 2026-11-06, so the report's bottom line is the party's ledger.
 *
 * Job Balancing lists invoices: what each still owes. A payment or receipt
 * whose money is not knocked off against any invoice - an advance, or what is
 * left of one - is on the party's ledger account but on no invoice, so the
 * two never agreed. Hasnain Cargo: invoices 2,835,002.90 outstanding, ledger
 * 163,734.10 in credit - two 2024 advances with 2,998,737 left on them.
 *
 * Each payment or receipt with money left over comes back as one row shaped
 * like an invoice, so every view, export and total of the report takes it as
 * it takes an invoice:
 *
 *   total 0, and what is left on it as received (a receipt: the party has
 *   paid that much more than its invoices) or paid (a payment: we have) -
 *   its balance is minus what is left, and it comes off the outstanding.
 *
 *   advance: true, voucherId - the row opens the voucher, not an invoice.
 *
 * WHICH: Payments & Receipts' own vouchers (Job Reciept / Job Payment, as its
 * list shows them), dated up to the report's To date - money on account then,
 * whenever it came in. Per party account on the voucher; a voucher for one
 * party counts all its knock-offs, one for several matches them by the
 * invoice's party. An overseas agent's are left out: agent invoices are not
 * in this report either (Invoice Balancing has them).
 */
const { toCents } = require('./invoiceOwed');

const LEFT_BELOW = 0.01;

async function unappliedAdvances(sequelize, { upTo, companies, currency, payType, accounts } = {}) {
  const replacements = { upTo };
  const where = [];
  if (Array.isArray(companies) && companies.length) {
    where.push('AND v."CompanyId"::text IN (:companies)');
    replacements.companies = companies.map(String);
  }
  if (currency) {
    where.push(`AND upper(coalesce(v.currency, 'PKR')) = :currency`);
    replacements.currency = String(currency).toUpperCase();
  }
  let onlyAccounts = '';
  if (Array.isArray(accounts)) {
    if (!accounts.length) return [];
    onlyAccounts = 'WHERE heads.acc::text IN (:accounts)';
    replacements.accounts = accounts.map(String);
  }

  const [rows] = await sequelize.query(`
    WITH v AS (
      SELECT v.id, v."voucher_Id", v."createdAt", v.currency, v."exRate", v."CompanyId", v."partyName"
      FROM "Vouchers" v
      WHERE v.type IN ('Job Reciept', 'Job Payment')
        AND v."vType" NOT IN ('OP', 'SI', 'PI', 'OI', 'OB')
        AND v."createdAt" <= :upTo
        ${where.join('\n        ')}
    ),
    heads AS (
      SELECT h."VoucherId", h."ChildAccountId" AS acc,
             SUM(CASE WHEN h.type = 'credit' THEN h.amount::numeric ELSE -h.amount::numeric END) AS amount
      FROM "Voucher_Heads" h JOIN v ON v.id = h."VoucherId"
      WHERE h."accountType" = 'partyAccount'
      GROUP BY 1, 2
    ),
    n AS (SELECT "VoucherId", count(*) AS accounts FROM heads GROUP BY 1),
    k AS (
      SELECT it."VoucherId", i."party_Id"::text AS party,
             SUM(CASE WHEN i."payType" = 'Recievable' THEN it.amount::numeric ELSE -it.amount::numeric END) AS applied
      FROM "Invoice_Transactions" it JOIN "Invoices" i ON i.id = it."InvoiceId"
      WHERE it."VoucherId" IN (SELECT "VoucherId" FROM heads)
      GROUP BY 1, 2
    ),
    -- What a voucher knocked off in all. JOINED, with k itself for the
    -- per-party figure, rather than summed by a sub-select per line: that
    -- re-read the whole of k for every line - on SNS's copy ~127 of the
    -- report's ~135 seconds (2026-11-20). The same figures: one party account
    -- on the voucher takes everything it knocked off, several each take their
    -- own party's.
    ka AS (SELECT "VoucherId", SUM(applied) AS applied FROM k GROUP BY 1)
    SELECT v.id AS "voucherId", v."voucher_Id", v."createdAt", v.currency, v."exRate", v."CompanyId", v."partyName",
           heads.acc, heads.amount,
           COALESCE(CASE WHEN n.accounts = 1 THEN ka.applied ELSE kp.applied END, 0) AS applied,
           c.name AS "clientName", c.types
    FROM heads
    JOIN v ON v.id = heads."VoucherId"
    JOIN n ON n."VoucherId" = heads."VoucherId"
    LEFT JOIN ka ON ka."VoucherId" = heads."VoucherId"
    LEFT JOIN k kp ON kp."VoucherId" = heads."VoucherId" AND kp.party = heads.acc::text
    LEFT JOIN LATERAL (
      SELECT cl.name, cl.types FROM "Client_Associations" ca JOIN "Clients" cl ON cl.id = ca."ClientId"
      WHERE ca."ChildAccountId" = heads.acc ORDER BY cl.id LIMIT 1
    ) c ON true
    ${onlyAccounts}
    ORDER BY v."createdAt", v.id`, { replacements });

  return advanceRows(rows, payType);
}

/** The query's rows as Job Balancing rows - see the header. No database: unit tested. */
function advanceRows(rows = [], payType) {
  const out = [];
  for (const r of rows) {
    if (String(r.types || '').includes('Overseas Agent')) continue;
    const left = toCents(Number(r.amount || 0) - Number(r.applied || 0));
    if (Math.abs(left) < LEFT_BELOW) continue;
    const side = left > 0 ? 'Recievable' : 'Payble';
    if (payType && payType !== 'All' && payType !== side) continue;
    out.push({
      id: `advance-${r.voucherId}-${r.acc}`,
      advance: true,
      voucherId: r.voucherId,
      invoice_No: r.voucher_Id,
      payType: side,
      currency: r.currency || 'PKR',
      ex_rate: String(r.exRate || 1),
      roundOff: '0',
      total: '0',
      recieved: side === 'Recievable' ? String(left) : '0',
      paid: side === 'Payble' ? String(-left) : '0',
      createdAt: r.createdAt,
      party_Name: r.clientName || r.partyName || '',
      companyId: r.CompanyId,
      vendorTaxInvoiceNo: null,
      SE_Job: null,
      Charge_Heads: [],
    });
  }
  return out;
}

module.exports = { unappliedAdvances, advanceRows };

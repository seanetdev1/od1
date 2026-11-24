/* CREDIT CONTROL - the rules, with no database (unit tested).
 *
 * WHICH INVOICES: approved receivables - what Job Balancing lists (the user:
 * "open invoice balances only") - and the open bills we owe the same parties,
 * read the same way, for the net the amount limit is checked against. Agent invoices and bills are left out as
 * Job Balancing leaves them out, unless Config says otherwise. An invoice is
 * OPEN while more than PAID_TOLERANCE of it is unpaid, in its own currency:
 * settlements are written back rounded, and 0.43 left on a paid invoice is
 * dust, not a debt (functions/partyMerge).
 *
 * WHOSE: an invoice names its party's ledger ACCOUNT in party_Id - except a
 * migrated customs one, which names the Clients id, with the party's name
 * beside it (the two id ranges overlap, so the name must match too). The same
 * rule Job Balancing's party filter uses.
 *
 * HOW OLD: days from the invoice's date to today, in the install's time zone
 * - as the Ageing report ages it.
 *
 * IN RUPEES (the amount limit): a PKR invoice at 1 whatever its ex_rate says,
 * a foreign one at its own rate - functions/invoiceRate in the frontend. The
 * emails show each invoice in its own currency.
 */
const { localDate, daysBetween } = require('./clock');

const PAID_TOLERANCE = 1;
const LOCAL_CURRENCY = 'PKR';
const AGENT_TYPES = ['Agent Invoice', 'Old Agent Invoice', 'Agent Bill', 'Old Agent Bill'];

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const rateToLocal = (inv) => {
  const currency = String(inv?.currency ?? '').trim().toUpperCase();
  if (!currency || currency === LOCAL_CURRENCY) return 1;
  const rate = num(inv?.ex_rate);
  return rate > 0 ? rate : 1;
};

/** What is still owed on an invoice, in its own currency - with its round off. */
const outstanding = (inv) => num(inv?.total) + num(inv?.roundOff) - num(inv?.paid) - num(inv?.recieved);

/**
 * An invoice as credit control reads it, or null when it is paid.
 * `today` is the zone's 'YYYY-MM-DD'.
 */
const openInvoice = (inv, { today, timeZone }) => {
  const balance = outstanding(inv);
  if (balance <= PAID_TOLERANCE) return null;
  const date = localDate(inv.createdAt, timeZone);
  return {
    id: inv.id,
    invoiceNo: inv.invoice_No,
    type: inv.type,
    jobNo: inv.jobNo || null,
    companyId: inv.companyId,
    currency: String(inv.currency || '').trim().toUpperCase() || LOCAL_CURRENCY,
    amount: num(inv.total) + num(inv.roundOff),
    balance: round2(balance),
    balancePkr: round2(balance * rateToLocal(inv)),
    date,
    ageDays: daysBetween(date, today),
  };
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The party an invoice belongs to - a Clients id, or null.
 * `accountClient`: Map(String(ChildAccountId) -> ClientId).
 * `clientsById`:   Map(Number(id) -> { name }).
 */
const partyOf = (inv, accountClient, clientsById) => {
  const key = String(inv?.party_Id ?? '').trim();
  if (!key) return null;
  if (accountClient.has(key)) return accountClient.get(key);
  const asClient = clientsById.get(Number(key));
  if (asClient && inv.party_Name && String(asClient.name).trim() === String(inv.party_Name).trim()) return asClient.id;
  return null;
};

/** Inside the age credit control looks at? `ignoreOlderThanDays` 0 = every age. */
const withinAge = (inv, ignoreOlderThanDays) => !(ignoreOlderThanDays > 0 && inv.ageDays > ignoreOlderThanDays);

/** Enough left on it to chase? Below `ignoreBelowAmount` rupees, not; 0 = every balance. */
const aboveIgnoreAmount = (inv, ignoreBelowAmount) => !(ignoreBelowAmount > 0 && inv.balancePkr < ignoreBelowAmount);

const hasLimit = (v) => v !== null && v !== undefined && v !== '';

const sumPkr = (list) => round2(list.reduce((t, i) => t + i.balancePkr, 0));
const oldestFirst = (a, b) => b.ageDays - a.ageDays;

/**
 * A party's position, in rupees: its open invoices, the open bills we owe it,
 * and the NET - what the credit limit is checked against (the user's choice,
 * 2026-10-26). A party whose bills cover its invoices owes nothing on net.
 */
const position = (invoices, bills) => {
  const receivablePkr = sumPkr(invoices);
  const payablePkr = sumPkr(bills);
  return { receivablePkr, payablePkr, balancePkr: round2(receivablePkr - payablePkr) };
};

/**
 * THE DAILY CHECK, one entry per party with a limit:
 *   overdue    - its open invoices older than its Credit Limit (Days) - the
 *                limit "exceeded", so older, not as old. Listed whatever its
 *                bills: they are still unpaid (the user's choice)
 *   bills      - the open bills we owe it, oldest first
 *   receivablePkr / payablePkr - the two, in rupees
 *   balancePkr - the NET: invoices less bills
 *   over       - the net is more than its Credit Limit (Amount)
 * A party with neither limit is not here. Nor is one with nothing to report.
 */
const evaluateDaily = ({ clients, invoicesByClient, billsByClient = new Map() }) => {
  const out = [];
  for (const client of clients) {
    const days = hasLimit(client.creditLimitDays) ? Number(client.creditLimitDays) : null;
    const limit = hasLimit(client.creditLimitAmount) ? Number(client.creditLimitAmount) : null;
    if (days === null && limit === null) continue;
    const open = invoicesByClient.get(client.id) || [];
    const bills = [...(billsByClient.get(client.id) || [])].sort(oldestFirst);
    const overdue = days === null ? [] : open
      .filter((i) => i.ageDays > days)
      .map((i) => ({ ...i, daysOver: i.ageDays - days }))
      .sort(oldestFirst);
    const pos = position(open, bills);
    const over = limit !== null && pos.balancePkr > limit;
    if (!overdue.length && !over) continue;
    out.push({ client, overdue, bills, ...pos, limitPkr: limit, over });
  }
  return out;
};

/**
 * THE WEEKLY REPORT: each party's open invoices older than `ageDays` - with
 * every open bill we owe it, whatever its age, and the net of all its open
 * invoices less those bills (the user's choice, 2026-10-26).
 */
const evaluateWeekly = ({ clients, invoicesByClient, billsByClient = new Map(), ageDays }) => {
  const out = [];
  for (const client of clients) {
    const open = invoicesByClient.get(client.id) || [];
    const old = open.filter((i) => i.ageDays > ageDays).sort(oldestFirst);
    if (!old.length) continue;
    const bills = [...(billsByClient.get(client.id) || [])].sort(oldestFirst);
    out.push({ client, invoices: old, bills, ...position(open, bills) });
  }
  return out;
};

const isActiveEmployee = (e) => !['0', 'false'].includes(String(e?.active ?? '').trim().toLowerCase());
const emailOf = (e) => String(e?.email || '').trim();

const uniq = (list) => {
  const seen = new Set();
  return list.filter((a) => {
    const k = String(a).toLowerCase();
    if (!a || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * WHO EACH EMAIL GOES TO. The entries, grouped by the party's sales rep:
 *
 *   rep with an email      To the rep, CC management.
 *   rep without one        To management, saying so - the rep cannot be
 *                          reached, and management still needs to know.
 *   no rep on the party    To the admin, to set one (the user's rule), CC
 *                          management - their parties are on no rep's email,
 *                          so this is the only place management sees them.
 *
 * `reps`: Map(repId -> employee). `management` / `admins`: addresses.
 * A group with nobody to send to is returned with `to: []` - the run logs it.
 */
const recipientsFor = (entries, { reps, management, admins }) => {
  const groups = new Map();
  for (const entry of entries) {
    const repId = entry.client.salesRepresentatorId || null;
    const rep = repId ? reps.get(String(repId)) : null;
    const key = rep ? `rep:${rep.id}` : 'none';
    if (!groups.has(key)) groups.set(key, { rep: rep || null, entries: [] });
    groups.get(key).entries.push(entry);
  }

  return [...groups.values()].map(({ rep, entries: list }) => {
    if (rep) {
      const own = isActiveEmployee(rep) ? emailOf(rep) : '';
      if (own) {
        return { kind: 'rep', rep, entries: list, to: [own], cc: uniq(management).filter((a) => a.toLowerCase() !== own.toLowerCase()), problem: null };
      }
      return {
        kind: 'rep', rep, entries: list, to: uniq(management), cc: [],
        problem: `${rep.name} has no email address in Setup > Employees${isActiveEmployee(rep) ? '' : ' (and is inactive)'}, so this went to management instead.`,
      };
    }
    const to = uniq(admins.length ? admins : management);
    return {
      kind: 'noRep', rep: null, entries: list, to,
      cc: admins.length ? uniq(management).filter((a) => !to.map((x) => x.toLowerCase()).includes(a.toLowerCase())) : [],
      problem: admins.length ? null : 'No admin has an email address, so this went to management instead.',
    };
  });
};

module.exports = {
  PAID_TOLERANCE, LOCAL_CURRENCY, AGENT_TYPES,
  num, rateToLocal, outstanding, openInvoice, partyOf, withinAge, aboveIgnoreAmount, position,
  evaluateDaily, evaluateWeekly, recipientsFor, isActiveEmployee, emailOf, uniq,
};

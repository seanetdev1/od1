// Archive accounts: the chart, one account's ledger, and the trial balance.
//
// THE OPENING BALANCE is worked out as Climax's own TrialBalance procedure
// works it out: the balance the book was OPENED with - acctfild.debtbaln and
// crdtbaln, NOT acctfild.openbaln, which is 0 on every account in every book -
// plus every line dated before the period. A book that was started part-way
// through the business (the 2016 one opened with part of the 2012 book's
// balances) therefore shows exactly what Climax showed, not a balance carried
// from the book before it.
//
// THE CHART is a tree written into each account: `relation` is the path of
// ancestors' autonumbs, ",0000001,0000002,". A group account (genrdetl 1)
// ends its path with itself; a ledger account (genrdetl 2) carries its
// parent's path. maincatg: 1 assets, 2 liabilities, 3 capital, 4 income,
// 5 expenses.

const { query, param } = require('./db');
const { likeContains, day } = require('./inputs');
const { wallDate, money } = require('./values');

const CATEGORIES = { 1: 'Assets', 2: 'Liabilities', 3: 'Capital', 4: 'Income', 5: 'Expenses' };
const GROUP = 1;
const LEDGER = 2;
// A ledger longer than this is refused with a word to narrow the dates - a
// cash account over nine years is several hundred thousand lines.
const LEDGER_LINE_LIMIT = 20000;

async function searchAccounts(book, q = {}) {
  const rows = await query(book, `
    SELECT TOP 40 a.autonumb id, a.acctcode code, a.acctname name, a.maincatg category, p.acctname parent
    FROM acctfile a
    LEFT JOIN acctfile p ON p.autonumb = a.prntcode
    WHERE a.genrdetl = ${LEDGER}
      AND (@q IS NULL OR a.acctname LIKE @q OR a.acctcode LIKE @q)
    ORDER BY a.acctname`, { q: param.str(likeContains(q.q)) });
  return rows.map((r) => ({
    id: Number(r.id),
    code: r.code || '',
    name: r.name || '',
    category: CATEGORIES[r.category] || '',
    parent: r.parent || '',
  }));
}

/** The book's span and its Climax years - what the screens offer as dates. */
async function bookSummary(book) {
  const [years, span, jobCount] = await Promise.all([
    query(book, `SELECT yearcode code, fromdate fromDate, tilldate toDate FROM yearfile ORDER BY fromdate`),
    // Typed-in years like 7202 exist; the span stops at the last real day -
    // within a year of the end of the book's last Climax year.
    query(book, `
      WITH lim AS (SELECT DATEADD(year, 1, MAX(tilldate)) lastReal FROM yearfile)
      SELECT MIN(m.trandate) firstDate,
             MAX(CASE WHEN lim.lastReal IS NULL OR m.trandate <= lim.lastReal THEN m.trandate END) lastDate,
             COUNT(*) vouchers
      FROM tranfile m CROSS JOIN lim`),
    query(book, `SELECT COUNT(*) jobs FROM LSJobsMaster`),
  ]);
  const s = span[0] || {};
  const j = jobCount[0] || {};
  return {
    firstDate: wallDate(s.firstDate),
    lastDate: wallDate(s.lastDate),
    vouchers: s.vouchers || 0,
    jobs: j.jobs || 0,
    years: years
      .filter((y) => y.fromDate && y.toDate)
      .map((y) => ({ code: String(y.code || '').trim(), from: wallDate(y.fromDate), to: wallDate(y.toDate) })),
  };
}

async function ledger(book, q = {}) {
  const accountId = Number(q.account);
  if (!Number.isInteger(accountId) || accountId <= 0) return { error: 'Pick an account.' };
  const from = day(q.from);
  const to = day(q.to);
  const p = { acct: param.int(accountId), from: param.date(from), to: param.date(to) };

  const accounts = await query(book, `
    SELECT a.autonumb id, a.acctcode code, a.acctname name, a.maincatg category, a.genrdetl kind, p.acctname parent
    FROM acctfile a LEFT JOIN acctfile p ON p.autonumb = a.prntcode
    WHERE a.autonumb = @acct`, { acct: p.acct });
  if (!accounts.length) return { error: 'There is no such account in this book.' };
  const account = accounts[0];

  const [opening, count] = await Promise.all([
    query(book, `
      SELECT
        (SELECT SUM(ISNULL(debtbaln, 0) - ISNULL(crdtbaln, 0)) FROM acctfild WHERE autonumb = @acct) stored,
        (SELECT SUM(ISNULL(l.debtamnt, 0) - ISNULL(l.crdtamnt, 0))
           FROM tranfil1 l JOIN tranfile m ON m.trannumb = l.trannumb
          WHERE l.acctcode = @acct AND @from IS NOT NULL AND m.trandate < @from
            AND ISNULL(m.IsVoid, 0) = 0) before`, p),
    query(book, `
      SELECT COUNT(*) n
      FROM tranfil1 l JOIN tranfile m ON m.trannumb = l.trannumb
      WHERE l.acctcode = @acct AND ISNULL(m.IsVoid, 0) = 0
        AND (@from IS NULL OR m.trandate >= @from)
        AND (@to IS NULL OR m.trandate < DATEADD(day, 1, @to))`, p),
  ]);
  if ((count[0]?.n || 0) > LEDGER_LINE_LIMIT) {
    return {
      error: `This account has ${count[0].n.toLocaleString('en-US')} entries in that period - more than the `
        + `${LEDGER_LINE_LIMIT.toLocaleString('en-US')} one ledger shows. Narrow the dates.`,
    };
  }

  const lines = await query(book, `
    SELECT m.trannumb tranNo, m.voucnumb voucherNo, m.trandate tranDate, m.trantype vType, m.cheknumb chequeNo,
           l.serlnumb sno, l.remarks1 lineNarration, CAST(m.naration AS nvarchar(1000)) narration,
           ISNULL(NULLIF(l.JobNumbr, ''), l.jobnumber) jobNo, l.debtamnt debit, l.crdtamnt credit
    FROM tranfil1 l JOIN tranfile m ON m.trannumb = l.trannumb
    WHERE l.acctcode = @acct AND ISNULL(m.IsVoid, 0) = 0
      AND (@from IS NULL OR m.trandate >= @from)
      AND (@to IS NULL OR m.trandate < DATEADD(day, 1, @to))
    ORDER BY m.trandate, m.trannumb, l.serlnumb`, p);

  const openingBalance = money((Number(opening[0]?.stored) || 0) + (Number(opening[0]?.before) || 0));
  let running = openingBalance;
  const rows = lines.map((l) => {
    const debit = money(l.debit);
    const credit = money(l.credit);
    running = money(running + debit - credit);
    return {
      tranNo: l.tranNo,
      voucherNo: l.voucherNo || '',
      date: wallDate(l.tranDate),
      type: l.vType || '',
      chequeNo: l.chequeNo || '',
      narration: (l.lineNarration || l.narration || '').trim(),
      jobNo: (l.jobNo || '').trim(),
      debit,
      credit,
      balance: running,
    };
  });

  return {
    account: {
      id: Number(account.id),
      code: account.code || '',
      name: account.name || '',
      category: CATEGORIES[account.category] || '',
      parent: account.parent || '',
      isGroup: Number(account.kind) === GROUP,
    },
    from: wallDate(from),
    to: wallDate(to),
    opening: openingBalance,
    totals: {
      debit: money(rows.reduce((t, r) => t + r.debit, 0)),
      credit: money(rows.reduce((t, r) => t + r.credit, 0)),
    },
    closing: rows.length ? rows[rows.length - 1].balance : openingBalance,
    rows,
  };
}

/**
 * Roll ledger accounts up into their groups and lay the chart out as a tree:
 * each group followed by its children, children in account-code order. Pure.
 *
 * `accounts`: { id, code, name, parentId, kind, category, opening, debit,
 * credit } - each account's OWN figures; a group's row adds its children's.
 */
function rollUp(accounts) {
  const byId = new Map(accounts.map((a) => [a.id, { ...a, children: [] }]));
  const roots = [];
  byId.forEach((a) => {
    const parent = a.parentId && a.parentId !== a.id ? byId.get(a.parentId) : null;
    (parent ? parent.children : roots).push(a);
  });
  const byCode = (x, y) => String(x.code).localeCompare(String(y.code), 'en', { numeric: true });

  const out = [];
  const walk = (node, depth, seen) => {
    if (seen.has(node.id)) return { opening: 0, debit: 0, credit: 0 }; // a cycle in the chart
    seen.add(node.id);
    const row = {
      id: node.id, code: node.code, name: node.name, level: depth,
      isGroup: node.kind === GROUP, category: CATEGORIES[node.category] || '',
    };
    out.push(row);
    // A group's own figures count too: Climax lets an entry be posted to one.
    let sums = { opening: node.opening || 0, debit: node.debit || 0, credit: node.credit || 0 };
    node.children.sort(byCode).forEach((c) => {
      const s = walk(c, depth + 1, seen);
      sums = { opening: sums.opening + s.opening, debit: sums.debit + s.debit, credit: sums.credit + s.credit };
    });
    row.opening = money(sums.opening);
    row.debit = money(sums.debit);
    row.credit = money(sums.credit);
    row.closing = money(sums.opening + sums.debit - sums.credit);
    return sums;
  };
  roots.sort(byCode).forEach((r) => walk(r, 1, new Set()));
  return out;
}

async function trialBalance(book, q = {}) {
  const from = day(q.from);
  const to = day(q.to);
  if (!from || !to) return { error: 'A From and To date are required.' };
  if (to < from) return { error: 'To is before From.' };

  const rows = await query(book, `
    SELECT a.autonumb id, a.acctcode code, a.acctname name, a.prntcode parentId, a.acctlevl level,
           a.genrdetl kind, a.maincatg category,
           ISNULL(f.stored, 0) + ISNULL(t.before, 0) opening, ISNULL(t.dr, 0) debit, ISNULL(t.cr, 0) credit
    FROM acctfile a
    LEFT JOIN (SELECT autonumb, SUM(ISNULL(debtbaln, 0) - ISNULL(crdtbaln, 0)) stored
                 FROM acctfild GROUP BY autonumb) f ON f.autonumb = a.autonumb
    LEFT JOIN (SELECT l.acctcode,
                      SUM(CASE WHEN m.trandate < @from THEN ISNULL(l.debtamnt, 0) - ISNULL(l.crdtamnt, 0) ELSE 0 END) before,
                      SUM(CASE WHEN m.trandate >= @from THEN ISNULL(l.debtamnt, 0) ELSE 0 END) dr,
                      SUM(CASE WHEN m.trandate >= @from THEN ISNULL(l.crdtamnt, 0) ELSE 0 END) cr
                 FROM tranfil1 l JOIN tranfile m ON m.trannumb = l.trannumb
                WHERE m.trandate < DATEADD(day, 1, @to)
                GROUP BY l.acctcode) t ON t.acctcode = a.autonumb`, {
    from: param.date(from),
    to: param.date(to),
  });

  const tree = rollUp(rows.map((r) => ({
    id: Number(r.id),
    code: r.code || '',
    name: r.name || '',
    parentId: r.parentId == null ? null : Number(r.parentId),
    kind: Number(r.kind),
    category: Number(r.category),
    opening: Number(r.opening) || 0,
    debit: Number(r.debit) || 0,
    credit: Number(r.credit) || 0,
  })));

  // Every account's own figures - a group's included, as its row adds them in.
  const sum = (k) => money(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0));
  return {
    from: wallDate(from),
    to: wallDate(to),
    rows: tree,
    totals: { opening: sum('opening'), debit: sum('debit'), credit: sum('credit') },
  };
}

module.exports = { searchAccounts, bookSummary, ledger, trialBalance, rollUp, CATEGORIES };

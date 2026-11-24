/**
 * WHICH KIND OF PARTY a party is - for the three party permissions (the
 * user's request, 2026-10-10), as Setup > Parties creates them:
 *
 *   nonGl     a name-only party - no ledger account
 *   customer  its ledger is on the receivable side
 *   vendor    its ledger is on the payable side
 *
 * The side is the ledger's place in the chart. Configuration > Party Accounts
 * names the parent a new customer's and a new vendor's ledger is created under
 * (every layer of it, the install's and each company's); a ledger under one of
 * those, or anywhere under the same top-level account, is that side. That is
 * not the account CODE - the top level is 1/2 on one install's chart and 1/3 on
 * another's - nor its title alone, which the charts spell as they please
 * ("LAIBILITY"). The title is the fallback, for a chart with no Party Accounts
 * set: a liabilities or creditors root is payable, anything else receivable.
 *
 * A party with more than one ledger takes its first.
 */

const PAYABLE_TITLE = /liab|laib|payable|creditor/i;

let cache = { at: 0, sides: null };
const TTL_MS = 30 * 1000;

/* The receivable and payable parents, every layer, and the root each sits under. */
async function sides(db) {
  if (cache.sides && Date.now() - cache.at < TTL_MS) return cache.sides;
  const rows = await db.AppSetting.findAll({
    where: { key: { [db.Sequelize.Op.like]: 'partyAccounts%' } }, attributes: ['value'], raw: true,
  });
  const receivable = new Set();
  const payable = new Set();
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value || '{}') || {};
      if (v.receivable) receivable.add(Number(v.receivable));
      if (v.payable) payable.add(Number(v.payable));
    } catch (_) { /* a malformed layer names nothing */ }
  }
  const ids = [...receivable, ...payable];
  const roots = new Map();
  if (ids.length) {
    const up = await db.sequelize.query(`
      WITH RECURSIVE up AS (
        SELECT id AS start, id, "ChildAccountId" AS p FROM "Child_Accounts" WHERE id IN (:ids)
        UNION ALL
        SELECT up.start, c.id, c."ChildAccountId" FROM "Child_Accounts" c JOIN up ON c.id = up.p
      )
      SELECT start, id FROM up WHERE p IS NULL
    `, { replacements: { ids }, type: db.Sequelize.QueryTypes.SELECT });
    for (const r of up) roots.set(Number(r.start), Number(r.id));
  }
  const s = {
    receivable, payable,
    receivableRoots: new Set([...receivable].map((id) => roots.get(id)).filter(Boolean)),
    payableRoots: new Set([...payable].map((id) => roots.get(id)).filter(Boolean)),
  };
  cache = { at: Date.now(), sides: s };
  return s;
}

/**
 * The side of one ledger chain - its ids from the account up, and its root's
 * title. 'vendor' or 'customer'.
 */
function sideOf(chain, rootId, rootTitle, s) {
  if (chain.some((id) => s.payable.has(id))) return 'vendor';
  if (chain.some((id) => s.receivable.has(id))) return 'customer';
  if (s.payableRoots.has(rootId)) return 'vendor';
  if (s.receivableRoots.has(rootId)) return 'customer';
  return PAYABLE_TITLE.test(rootTitle || '') ? 'vendor' : 'customer';
}

const chainQuery = (where) => `
  WITH RECURSIVE up AS (
    SELECT ${where.select} AS start, ${where.owner} AS owner, a.id, a."ChildAccountId" AS p, a.title, 0 AS depth
    FROM ${where.from}
    UNION ALL
    SELECT up.start, up.owner, c.id, c."ChildAccountId", c.title, up.depth + 1
    FROM "Child_Accounts" c JOIN up ON c.id = up.p
    WHERE up.depth < 12
  )
  SELECT start, owner, id, p, title, depth FROM up ORDER BY start, depth
`;

/* Each chain - one ledger, from its account up to its root - by `start`. */
const chains = (rows) => {
  const byStart = new Map();
  for (const r of rows) {
    const k = Number(r.start);
    if (!byStart.has(k)) byStart.set(k, { owner: Number(r.owner), rows: [] });
    byStart.get(k).rows.push(r);
  }
  return byStart;
};

const sideOfChain = (rows, s) => {
  const root = rows.find((r) => r.p == null) || rows[rows.length - 1];
  return sideOf(rows.map((r) => Number(r.id)), Number(root?.id), root?.title, s);
};

/** The side a ledger under this account would be on - for a party being given one. */
async function sideOfAccount(db, accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id)) return null;
  const s = await sides(db);
  const rows = await db.sequelize.query(
    chainQuery({ select: 'a.id', owner: 'a.id', from: `"Child_Accounts" a WHERE a.id = ${id}` }),
    { type: db.Sequelize.QueryTypes.SELECT },
  );
  return rows.length ? sideOfChain(rows, s) : null;
}

/**
 * Every party's kind, or those given - Map of client id -> 'nonGl' | 'customer' | 'vendor'.
 * One query for the lot. A party with more than one ledger takes its first.
 */
async function partyKinds(db, clientIds = null) {
  const s = await sides(db);
  const only = Array.isArray(clientIds)
    ? clientIds.map(Number).filter(Number.isInteger)
    : null;
  if (only && !only.length) return new Map();
  const filter = only ? `AND ca."ClientId" IN (${only.join(',')})` : '';
  const rows = await db.sequelize.query(chainQuery({
    select: 'ca.id',
    owner: 'ca."ClientId"',
    from: `"Client_Associations" ca JOIN "Child_Accounts" a ON a.id = ca."ChildAccountId" WHERE ca."ChildAccountId" IS NOT NULL ${filter}`,
  }), { type: db.Sequelize.QueryTypes.SELECT });
  const kinds = new Map();
  // Links in id order: a party's first ledger is met first.
  for (const [, chain] of [...chains(rows)].sort((x, y) => x[0] - y[0])) {
    if (!kinds.has(chain.owner)) kinds.set(chain.owner, sideOfChain(chain.rows, s));
  }
  const parties = await db.Clients.findAll({
    where: only ? { id: only } : {}, attributes: ['id'], raw: true,
  });
  for (const c of parties) {
    if (!kinds.has(Number(c.id))) kinds.set(Number(c.id), 'nonGl');
  }
  return kinds;
}

/** The permission module a kind of party is governed by. */
const MODULE_OF_KIND = { nonGl: 'nonGlParties', customer: 'customers', vendor: 'vendors' };

module.exports = {
  partyKinds, sideOfAccount, MODULE_OF_KIND, _resetCache() { cache = { at: 0, sides: null }; },
};

/**
 * Chart-of-accounts migration, second attempt.
 *
 * /accounts/importAccount is left in place and untouched. This is a separate
 * route because the shape of the problem is different, not just the code:
 *
 *   GET  /accounts/migration/coa/plan   what would happen, and what is wrong
 *   POST /accounts/migration/coa/apply  do it
 *
 * The plan step is the point. The old import told you nothing until it had
 * already written rows, and when it failed it failed part-way with no
 * transaction - so you were left with a half-imported chart and no way to
 * tell which half. Here nothing is written until the caller has seen the
 * collisions, orphans and cycles and decided.
 *
 * The planning itself is in functions/coaMigrationPlan.js, with no database
 * access, so the rules can be tested directly. This file is the part that
 * talks to Postgres.
 *
 * Both endpoints take the legacy rows in the request body rather than fetching
 * them: the backend has no business knowing where the legacy server lives, and
 * the frontend already holds that address for every other stage.
 */

const routes = require('express').Router();
const db = require('../../models');
const { Child_Account } = require('../../functions/Associations/accountAssociations');
const { requireSystem } = require('../../functions/systemAccess');
const { planImport } = require('../../functions/coaMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

/**
 * What is already in the target, and which of it we put there.
 *
 * "Migrated by us" cannot be read from a climaxId column - Child_Account has
 * none, because the legacy id IS the primary key. So a previous run is
 * recognised by the row matching the legacy row: same id, same title. That is
 * deliberately strict. An id that matches with a different title is not our
 * import, it is a collision, and the caller needs to know.
 */
async function readExisting(legacyRows) {
  const rows = await Child_Account.findAll({ attributes: ['id', 'title'], raw: true });
  const existingIds = rows.map((r) => r.id);

  const titleById = new Map(rows.map((r) => [String(r.id), r.title]));
  const migratedIds = [];
  for (const row of (Array.isArray(legacyRows) ? legacyRows : [])) {
    if (row === null || row === undefined || row.Id === null || row.Id === undefined) continue;
    const key = String(row.Id);
    const have = titleById.get(key);
    if (have === undefined) continue;
    const wanted = String(row.AccountName || '').replace(/\s+/g, ' ').trim();
    if (have === wanted) migratedIds.push(row.Id);
  }
  return { existingIds, migratedIds };
}

function summarise(plan) {
  const p = plan.problems;
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      // Blocking.
      collisions: p.collisions,
      cycles: p.cycles,
      // Reported, not blocking.
      orphans: p.orphans,
      duplicateIds: p.duplicateIds,
      missingTitle: p.missingTitle,
      missingId: p.missingId,
    },
    guidance:
      p.collisions.length
        ? 'Ids already belong to accounts this import did not create - most likely a seeded '
          + 'chart of accounts. A migrating install must NOT be seeded first: the legacy data '
          + 'owns those ids. Clear Child_Accounts and re-run, or import into an empty database.'
        : p.cycles.length
        ? 'Accounts in the legacy chart reference each other in a loop and cannot be ordered. '
          + 'They are excluded; fix them in the source or accept losing them.'
        : plan.stats.toCreate === 0
        ? 'Nothing to do - every account in the source is already present.'
        : 'Safe to apply.',
  };
}

/** Dry run. Reads nothing but the target's ids, writes nothing. */
routes.post('/migration/coa/plan', SYSTEM, async (req, res) => {
  try {
    const legacyRows = Array.isArray(req.body) ? req.body : req.body?.accounts;
    if (!Array.isArray(legacyRows)) {
      return res.status(400).json({
        status: 'error',
        result: 'Send the legacy GL_COA rows as the body, or as { accounts: [...] }.',
      });
    }

    const { existingIds, migratedIds } = await readExisting(legacyRows);
    const plan = planImport(legacyRows, existingIds, { migratedIds });
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[coa migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Apply it.
 *
 * One transaction for the whole chart. A chart of accounts is not useful in
 * pieces - half a tree means every report built on it is wrong in a way that
 * looks like a data problem rather than a failed import.
 */
routes.post('/migration/coa/apply', SYSTEM, async (req, res) => {
  try {
    const legacyRows = Array.isArray(req.body) ? req.body : req.body?.accounts;
    if (!Array.isArray(legacyRows)) {
      return res.status(400).json({
        status: 'error',
        result: 'Send the legacy GL_COA rows as the body, or as { accounts: [...] }.',
      });
    }

    const { existingIds, migratedIds } = await readExisting(legacyRows);
    const plan = planImport(legacyRows, existingIds, { migratedIds });

    if (!plan.canApply) {
      // Refuse rather than write what it can. Importing "most of" a chart of
      // accounts is the failure mode this whole rewrite exists to prevent.
      return res.status(409).json({ status: 'error', result: summarise(plan) });
    }

    if (!plan.ordered.length) {
      return res.json({
        status: 'success',
        result: { ...summarise(plan), created: 0, message: 'Nothing to import.' },
      });
    }

    await db.sequelize.transaction(async (t) => {
      // In dependency order, in chunks. bulkCreate keeps the array order, so
      // parents land before their children within and across chunks.
      const CHUNK = 500;
      for (let i = 0; i < plan.ordered.length; i += CHUNK) {
        await Child_Account.bulkCreate(plan.ordered.slice(i, i + CHUNK), { transaction: t });
      }
    });

    // Prove it landed rather than trusting that no error means success - the
    // lesson from every stage of the job migration.
    const after = await Child_Account.count();

    res.json({
      status: 'success',
      result: {
        ...summarise(plan),
        created: plan.ordered.length,
        accountsInTarget: after,
      },
    });
  } catch (error) {
    console.error('[coa migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Verify after the fact: does the tree actually hold together?
 *
 * A dangling parent cannot normally exist - ChildAccountId has a foreign key -
 * so that check is a backstop for an install whose constraint was never
 * created. What it is really for is the things no constraint covers: accounts
 * in a loop, accounts with no sub-category (which makes ledgerMapping classify
 * their voucher lines wrongly), and how the tree is actually shaped. Row counts
 * see none of that - the same blind spot that let 21,539 charge lines import
 * with a null invoice while every count looked right.
 */
routes.get('/migration/coa/verify', SYSTEM, async (req, res) => {
  try {
    const rows = await Child_Account.findAll({
      attributes: ['id', 'title', 'ChildAccountId', 'subCategory'],
      raw: true,
    });
    const ids = new Set(rows.map((r) => String(r.id)));

    const dangling = rows
      .filter((r) => r.ChildAccountId !== null && !ids.has(String(r.ChildAccountId)))
      .map((r) => ({ id: r.id, title: r.title, missingParent: r.ChildAccountId }));

    const noSubCategory = rows.filter((r) => !r.subCategory).length;
    const roots = rows.filter((r) => r.ChildAccountId === null).length;

    // Depth of the deepest branch, and any account that cannot reach a root.
    const parentOf = new Map(rows.map((r) => [String(r.id), r.ChildAccountId]));
    let unreachable = 0;
    let deepest = 0;
    for (const r of rows) {
      let depth = 0;
      let cursor = r.ChildAccountId;
      const seen = new Set([String(r.id)]);
      while (cursor !== null && cursor !== undefined) {
        const key = String(cursor);
        if (seen.has(key)) { unreachable += 1; break; }   // loop
        if (!parentOf.has(key)) { break; }                 // dangling, counted above
        seen.add(key);
        cursor = parentOf.get(key);
        depth += 1;
        if (depth > 50) { unreachable += 1; break; }
      }
      if (depth > deepest) deepest = depth;
    }

    res.json({
      status: 'success',
      result: {
        accounts: rows.length,
        roots,
        deepestBranch: deepest,
        danglingParents: dangling.length,
        dangling: dangling.slice(0, 50),
        accountsWithoutSubCategory: noSubCategory,
        inLoops: unreachable,
        healthy: dangling.length === 0 && unreachable === 0 && noSubCategory === 0,
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

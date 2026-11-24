/**
 * Parties migration - plan, apply, verify.
 *
 * /clientRoutes/bulkCreate is left in place and untouched.
 *
 *   POST /clientRoutes/migration/parties/plan    what would happen
 *   POST /clientRoutes/migration/parties/apply   one transaction
 *   GET  /clientRoutes/migration/parties/verify  can these clients be invoiced
 *
 * The verify step is the one that earns its place here. A party import can put
 * every row in and still leave the install unable to raise a single invoice,
 * because what matters is not the client row - it is the Client_Associations
 * row joining it to a ledger account. Counting clients tells you nothing about
 * that, which is how the old import could report success on data that could
 * not be used.
 */

const routes = require('express').Router();
const db = require('../../models');
const { Clients, Client_Associations } = require('../../functions/Associations/clientAssociation');
const { Child_Account } = require('../../functions/Associations/accountAssociations');
const { Employees } = require('../../functions/Associations/employeeAssociations');
const { requireSystem } = require('../../functions/systemAccess');
const { planParties } = require('../../functions/partyMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

/** Everything the planner needs from the database, read once. */
async function readContext() {
  const [clients, accounts, employees] = await Promise.all([
    Clients.findAll({ attributes: ['climaxId'], raw: true }),
    Child_Account.findAll({ attributes: ['id'], raw: true }),
    Employees.findAll({ attributes: ['id', 'climaxId'], raw: true }),
  ]);

  return {
    existingClimaxIds: clients.map((c) => c.climaxId).filter((x) => x !== null),
    accountIds: accounts.map((a) => a.id),
    employeeByClimaxId: new Map(
      employees.filter((e) => e.climaxId !== null).map((e) => [String(e.climaxId), e.id])
    ),
  };
}

function summarise(plan) {
  const p = plan.problems;
  const noLedger = p.noLedgerAccount.length;
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      noLedgerAccount: noLedger,
      // The first few by name, so the operator can recognise whether these are
      // notify parties (fine) or real customers (not fine).
      noLedgerAccountSample: p.noLedgerAccount.slice(0, 25),
      // The subset worth acting on: a party whose TYPE normally carries a
      // ledger account but has none. On CargoLinkers that is 1 party out of
      // 11,752 without an account - which is the number the operator actually
      // needs, and which a flat total buries.
      ledgerTypeWithoutAccount: p.ledgerTypeWithoutAccount.length,
      ledgerTypeWithoutAccountSample: p.ledgerTypeWithoutAccount.slice(0, 25),
      unresolvedAccount: p.unresolvedAccount.length,
      unresolvedAccountSample: p.unresolvedAccount.slice(0, 25),
      duplicateClimaxIds: p.duplicateClimaxIds,
      missingName: p.missingName,
      missingId: p.missingId,
      unresolvedSalesRep: p.unresolvedSalesRep,
    },
    guidance:
      p.unresolvedAccount.length
        ? 'Some parties reference a ledger account that is not in this chart of accounts. '
          + 'Run the Chart of Accounts stage first - if it has already run, the two exports '
          + 'are from different databases. These parties will import but cannot be invoiced.'
        : p.ledgerTypeWithoutAccount.length
        ? `${p.ledgerTypeWithoutAccount.length} party/parties are of a type that normally `
          + 'carries a ledger account but have none. They will import and then cannot be '
          + `invoiced. The other ${noLedger - p.ledgerTypeWithoutAccount.length} without an `
          + 'account are operational parties (shippers, consignees, notify) and are expected.'
        : noLedger
        ? `${noLedger} parties have no ledger account, and all of them are types that do not `
          + 'normally carry one - shippers, consignees, notify parties. That is expected: they '
          + 'are names on a document, not customers. Nothing to do.'
        : 'Every party resolves to a ledger account.',
  };
}

routes.post('/migration/parties/plan', SYSTEM, async (req, res) => {
  try {
    const parties = Array.isArray(req.body) ? req.body : req.body?.parties;
    if (!Array.isArray(parties)) {
      return res.status(400).json({
        status: 'error',
        result: 'Send the legacy Gen_Parties rows as the body, or as { parties: [...] }.',
      });
    }
    const plan = planParties(parties, await readContext());
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[party migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/migration/parties/apply', SYSTEM, async (req, res) => {
  try {
    const parties = Array.isArray(req.body) ? req.body : req.body?.parties;
    if (!Array.isArray(parties)) {
      return res.status(400).json({
        status: 'error',
        result: 'Send the legacy Gen_Parties rows as the body, or as { parties: [...] }.',
      });
    }

    const plan = planParties(parties, await readContext());

    if (!plan.toCreate.length) {
      return res.json({
        status: 'success',
        result: { ...summarise(plan), created: 0, associationsCreated: 0, message: 'Nothing to import.' },
      });
    }

    let associationsCreated = 0;

    await db.sequelize.transaction(async (t) => {
      const CHUNK = 500;
      const created = [];
      for (let i = 0; i < plan.toCreate.length; i += CHUNK) {
        const batch = await Clients.bulkCreate(plan.toCreate.slice(i, i + CHUNK), {
          transaction: t, returning: true,
        });
        created.push(...batch);
      }

      // Join clients to their ledger accounts by legacy id. Done from the rows
      // we just created rather than by re-querying, so a party that shares a
      // name with an existing client cannot pick up the wrong association.
      const idByClimaxId = new Map(created.map((c) => [String(c.climaxId), c.id]));
      const rows = plan.associations
        .map((a) => ({
          ClientId: idByClimaxId.get(String(a.climaxId)),
          ChildAccountId: a.ChildAccountId,
        }))
        .filter((a) => a.ClientId);

      for (let i = 0; i < rows.length; i += CHUNK) {
        await Client_Associations.bulkCreate(rows.slice(i, i + CHUNK), { transaction: t });
      }
      associationsCreated = rows.length;
    });

    res.json({
      status: 'success',
      result: {
        ...summarise(plan),
        created: plan.toCreate.length,
        associationsCreated,
        clientsInTarget: await Clients.count(),
      },
    });
  } catch (error) {
    console.error('[party migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Can these clients actually be used?
 *
 * A client row on its own is inert. Invoicing needs the Client_Associations
 * row joining it to a ledger account, and a count of clients cannot see
 * whether that exists - the same blind spot that let charge lines import with
 * a null invoice while every count looked right.
 */
routes.get('/migration/parties/verify', SYSTEM, async (req, res) => {
  try {
    const [clients, associations, accountRows] = await Promise.all([
      Clients.findAll({ attributes: ['id', 'name', 'climaxId', 'nongl'], raw: true }),
      Client_Associations.findAll({ attributes: ['ClientId', 'ChildAccountId'], raw: true }),
      Child_Account.findAll({ attributes: ['id'], raw: true }),
    ]);

    const accountIds = new Set(accountRows.map((a) => String(a.id)));
    const linked = new Set(associations.map((a) => String(a.ClientId)));

    const migrated = clients.filter((c) => c.climaxId !== null);

    // Marked as a ledger client but with nothing joining it to an account.
    // These look fine in every list and fail the moment someone invoices them.
    const glWithoutAccount = migrated
      .filter((c) => c.nongl === '0' && !linked.has(String(c.id)))
      .map((c) => ({ id: c.id, name: c.name, climaxId: c.climaxId }));

    // An association pointing at an account that is gone.
    const brokenAssociations = associations
      .filter((a) => a.ChildAccountId !== null && !accountIds.has(String(a.ChildAccountId)))
      .length;

    const duplicateClimaxIds = (() => {
      const seen = new Set(); const dupes = new Set();
      for (const c of migrated) {
        const k = String(c.climaxId);
        if (seen.has(k)) dupes.add(c.climaxId); else seen.add(k);
      }
      return [...dupes];
    })();

    res.json({
      status: 'success',
      result: {
        clients: clients.length,
        migrated: migrated.length,
        withLedgerAccount: migrated.filter((c) => linked.has(String(c.id))).length,
        nonGl: migrated.filter((c) => c.nongl === '1').length,
        glWithoutAccount: glWithoutAccount.length,
        glWithoutAccountSample: glWithoutAccount.slice(0, 25),
        brokenAssociations,
        duplicateClimaxIds,
        healthy:
          glWithoutAccount.length === 0 &&
          brokenAssociations === 0 &&
          duplicateClimaxIds.length === 0,
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

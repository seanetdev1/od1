const routes = require('express').Router();
const db = require('../../models');

const { requireSystem } = require('../../functions/systemAccess');
// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

/**
 * Verification surface for the staged migration.
 *
 * The old migration ran Job -> Charge_Heads -> Invoice -> Voucher -> Voucher_Heads
 * in one call, so there was no point at which you could ask "did that land?".
 * A failure part-way through looked the same as success. Each stage now stops
 * and checks its own table before the next one starts, and this is what it
 * checks against.
 *
 * `withClimaxId` is the important number, not `rows`: it counts what the
 * migration actually created, so a re-run or a partially-populated database
 * doesn't read as a success. Tables without a climaxId column report null.
 */

// table key -> model name. Keyed by the stage ids the frontend uses.
const TARGETS = {
  companies:      'Company',
  employees:      'Employees',
  commodities:    'Commodity',
  vessels:        'Vessel',
  voyages:        'Voyage',
  airports:       'Airports',
  ports:          'Ports',
  destinations:   'Destinations',
  accounts:       'Child_Account',
  charges:        'Charges',
  parties:        'Clients',
  jobs:           'SE_Job',
  // The customs-clearance module's own job table. NOT counted under `jobs`:
  // a clearing job lands in Customs_Jobs, and verifying the lgJobs stage
  // against the SE_Job count would compare it with a table it never writes -
  // which passes no matter what happened.
  customsJobs:    'Customs_Job',
  customsDuty:    'Customs_Duty',
  // Written by the same stage as the jobs and the duty. Missing here, the
  // 6,164 containers it creates were counted by nothing and reconciled
  // against nothing.
  customsContainers: 'Customs_Container',
  bls:            'Bl',
  chargeHeads:    'Charge_Head',
  containers:     'Container_Info',
  equipment:      'SE_Equipments',
  stamps:         'Stamps',
  // The other two things that hang off a B/L. Without these the B/L children
  // stage can only be counted on a quarter of what it writes.
  dimensions:     'Dimensions',
  loadingPrograms:'Loading_Program',
  items:          'Item_Details',
  invoices:       'Invoice',
  vouchers:       'Vouchers',
  voucherHeads:   'Voucher_Heads',
  // Direct Job E/R - the customs stage that follows the ledger.
  directJobs:     'Direct_Job',
  directJobLines: 'Direct_Job_Association',
  // GST invoice numbers - the customs stage after the clearing invoices.
  salesTaxInvoices: 'Sales_Tax_Invoice',
  bankAccounts:   'BankAccount',
};

async function countFor(modelName) {
  const model = db[modelName];
  if (!model) return { model: modelName, rows: null, withClimaxId: null, error: 'model not found' };

  const out = { model: modelName, rows: 0, withClimaxId: null };
  try {
    out.rows = await model.count();
    if (model.rawAttributes && model.rawAttributes.climaxId) {
      out.withClimaxId = await model.count({
        where: { climaxId: { [db.Sequelize.Op.ne]: null } },
      });
    }
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

/** Counts for every table the migration touches. */
routes.get('/counts', SYSTEM, async (req, res) => {
  try {
    const result = {};
    for (const [key, modelName] of Object.entries(TARGETS)) {
      result[key] = await countFor(modelName);
    }
    res.json({ status: 'success', result });
  } catch (error) {
    console.error('migration/counts failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/** Counts for one stage, so a stage can verify itself without a full sweep. */
routes.get('/counts/:key', SYSTEM, async (req, res) => {
  const modelName = TARGETS[req.params.key];
  if (!modelName) {
    return res.status(404).json({ status: 'error', result: `Unknown migration target "${req.params.key}"` });
  }
  try {
    res.json({ status: 'success', result: await countFor(modelName) });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Linkage health - the thing counts alone cannot tell you.
 *
 * A stage can insert exactly the right number of rows and still be wrong if the
 * foreign keys did not resolve. This is how the invoice/job ordering bug hid:
 * charges were created with InvoiceId undefined because invoices had not been
 * imported yet, and every count still looked perfect.
 */
routes.get('/linkage', SYSTEM, async (req, res) => {
  try {
    const { Op } = db.Sequelize;
    const orphan = async (model, field) => {
      if (!db[model] || !db[model].rawAttributes[field]) return null;
      return db[model].count({ where: { [field]: null } });
    };

    res.json({
      status: 'success',
      result: {
        chargeHeadsWithoutInvoice: await orphan('Charge_Head', 'InvoiceId'),
        // A charge line has THREE possible parents - SEJobId for freight,
        // CustomsJobId for a clearing job, AviationConsignmentId for an AWB -
        // and it is detached only when it has none of them.
        //
        // This counted SEJobId alone, which is null on every customs line by
        // design. So the clearing charge-lines stage, which declares this key
        // in its `linkage`, reported all 143,368 of its own rows as unlinked
        // the moment it succeeded. /chargeHeadMigration/verify already got
        // this right; this endpoint did not, and it is the one the stage
        // warning is built from.
        chargeHeadsWithoutJob:     await (async () => {
          const model = db.Charge_Head;
          if (!model) return null;
          const parents = ['SEJobId', 'CustomsJobId', 'AviationConsignmentId']
            .filter((f) => model.rawAttributes[f]);
          if (!parents.length) return null;
          return model.count({
            where: Object.fromEntries(parents.map((f) => [f, null])),
          });
        })(),
        jobsWithoutCompany:        await orphan('SE_Job', 'companyId'),
        jobsWithoutClient:         await orphan('SE_Job', 'ClientId'),
        jobsWithoutSalesRep:       await orphan('SE_Job', 'salesRepresentatorId'),
        invoicesWithoutVoucher:    await orphan('Invoice', 'VoucherId'),
        voucherHeadsWithoutVoucher:await orphan('Voucher_Heads', 'VoucherId'),
        voucherHeadsWithoutAccount:await orphan('Voucher_Heads', 'ChildAccountId'),
        blsWithoutJob:             await orphan('Bl', 'SEJobId'),
        // Not a null column - a missing JOIN. A client marked as a ledger
        // client with no Client_Associations row looks correct in every list
        // and fails the moment somebody invoices it, so it cannot be found by
        // counting nulls the way the others here are.
        clientsWithoutLedgerAccount: await (async () => {
          if (!db.Clients || !db.Client_Associations) return null;
          const linked = await db.Client_Associations.findAll({
            attributes: ['ClientId'], raw: true,
          });
          const have = new Set(linked.map((l) => String(l.ClientId)));
          const clients = await db.Clients.findAll({
            attributes: ['id'], where: { nongl: '0' }, raw: true,
          });
          return clients.filter((c) => !have.has(String(c.id))).length;
        })(),
        note:
          'Non-zero is not always wrong - a job legitimately has no sales rep, ' +
          'a charge may not be invoiced yet. Compare against the legacy counts ' +
          'for the same relationship before treating it as a failure.',
      },
    });
  } catch (error) {
    console.error('migration/linkage failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Source vs target reconciliation - the only thing that can actually support a
 * claim of "everything came across".
 *
 * Counting what Odyssey holds proves it received something. It says nothing
 * about whether that is all of it. This fetches the legacy row counts from the
 * Climax read API and pairs them with the migrated counts (climaxId IS NOT
 * NULL, so rows created in Odyssey are excluded) table by table.
 *
 * `legacyUrl` is passed by the caller because the backend has no reason to know
 * where the legacy server lives outside a migration - it is a one-time tool,
 * not a permanent integration.
 */
routes.get('/reconcile', SYSTEM, async (req, res) => {
  const legacyUrl = String(req.query.legacyUrl || '').replace(/\/+$/, '');
  if (!legacyUrl) {
    return res.status(400).json({
      status: 'error',
      result: 'Pass ?legacyUrl=http://host:8081 - the Climax read API to compare against.',
    });
  }

  let source;
  try {
    const r = await fetch(`${legacyUrl}/counts`, { signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`legacy /counts returned HTTP ${r.status}`);
    const body = await r.json();
    source = body?.result;
    if (!source) throw new Error('legacy /counts returned no result');
  } catch (err) {
    return res.status(502).json({
      status: 'error',
      result: `Could not read legacy counts from ${legacyUrl}: ${err.message}`,
    });
  }

  try {
    const rows = [];
    for (const [key, src] of Object.entries(source)) {
      const modelName = TARGETS[key];
      const target = modelName ? await countFor(modelName) : null;

      // Compare against migrated rows, not total rows: a database that already
      // had data would otherwise look complete when it is not.
      const migrated = target ? (target.withClimaxId ?? target.rows) : null;
      const expected = src.total;

      let status = 'unknown';
      if (target && typeof migrated === 'number') {
        if (migrated === expected) status = 'match';
        else if (migrated === 0 && expected > 0) status = 'missing';
        else if (migrated < expected) status = 'short';
        else status = 'excess';   // more than the source had - duplicates
      }

      rows.push({
        table: key,
        model: modelName || null,
        legacy: expected,
        legacyParts: src.parts,
        migrated,
        totalRows: target ? target.rows : null,
        difference: typeof migrated === 'number' ? migrated - expected : null,
        status,
      });
    }

    const summary = rows.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      status: 'success',
      result: {
        rows,
        summary,
        complete: rows.every((r) => r.status === 'match'),
        note:
          '"excess" means more migrated rows than the legacy table holds, which ' +
          'means duplicates - re-running a stage that is not idempotent. "short" ' +
          'means rows were lost or skipped. Only "match" everywhere is complete.',
      },
    });
  } catch (error) {
    console.error('migration/reconcile failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Drop the migration lookup cache.
 *
 * functions/migrationCache.js holds its indexes for the life of the process, so
 * a stage that ran before the table it depends on was populated would keep
 * resolving against a stale, empty map for the rest of the run. That is how
 * every Charge_Head ended up with a null InvoiceId even though invoices had
 * been imported: the job stage cached 'no invoices' and never looked again.
 *
 * The engine calls this at the start of every stage - within a stage the tables
 * a receiver reads do not change, between stages they do.
 */
routes.post('/cache/reset', SYSTEM, (req, res) => {
  require('../../functions/migrationCache').reset();
  res.json({ status: 'success', result: 'migration lookup cache cleared' });
});

module.exports = routes;

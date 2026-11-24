/**
 * Job migration - the job records only. Plan, apply, verify.
 *
 * /seaJob/UploadSEJobs, /UploadSIJobs, /UploadAEJobs and /UploadAIJobs are
 * left untouched, and they still import the nested B/Ls, equipment, stamps and
 * charge lines. This stage deliberately does not: it imports job rows, and
 * B/Ls, equipment and charge lines get their own stages.
 *
 *   POST /jobMigration/plan    what would happen, writes nothing
 *   POST /jobMigration/apply   one batch, one transaction
 *   GET  /jobMigration/verify  what a row count cannot see
 *
 * All four legacy job tables land in SE_Job, separated by `operation`.
 */

const routes = require('express').Router();
const db = require('../../models');
const { SE_Job, Clients, Commodity, Vessel, Voyage, Company, Employees } = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planJobs, OPERATIONS } = require('../../functions/jobMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

// Jobs are wide rows (66 columns), so batches are smaller than the location
// stage's. ~200 jobs is a comfortable single INSERT.
const MAX_BATCH = 500;

/** The env-driven user that owns migrated rows. */
const MIGRATION_USER_ID = process.env.MIGRATION_USER_ID || null;

/**
 * Every lookup the mapper needs, in six queries rather than twelve per job.
 *
 * Built per request. On a large import this is the difference between a
 * handful of queries and one per foreign key per row.
 */
async function buildResolvers() {
  const byLegacyId = (rows) => new Map(
    rows.filter((x) => x.climaxId !== null && x.climaxId !== undefined)
      .map((x) => [String(x.climaxId), x.id]),
  );

  const [clients, commodities, vessels, companies, employees, voyages] = await Promise.all([
    Clients.findAll({ attributes: ['id', 'climaxId'], raw: true }),
    Commodity.findAll({ attributes: ['id', 'climaxId'], raw: true }),
    Vessel.findAll({ attributes: ['id', 'climaxId'], raw: true }),
    Company.findAll({ attributes: ['id', 'climaxId'], raw: true }),
    Employees.findAll({ attributes: ['id', 'climaxId'], raw: true }),
    Voyage.findAll({ attributes: ['id', 'VesselId', 'voyage'], raw: true }),
  ]);

  // Keyed by Odyssey vessel id + voyage number: the legacy voyage number is
  // only unique within a vessel.
  const voyageMap = new Map();
  for (const v of voyages) {
    const k = `${v.VesselId}|${String(v.voyage ?? '').trim()}`;
    if (!voyageMap.has(k)) voyageMap.set(k, v.id);
  }

  // The legacy lookups (cost centres, terminals, inco terms, airports, UN
  // locations) are NOT taken here. They live in the legacy database and total
  // 8.9 MB, so attaching them to every batch re-sent 259 MB of identical data
  // across a run - enough to time a batch out, and a timed-out batch looks
  // exactly like a job type that never imported. The client resolves them once
  // and each job arrives carrying only the scalars it needs, on `_resolved`.
  return {
    clients: byLegacyId(clients),
    commodities: byLegacyId(commodities),
    vessels: byLegacyId(vessels),
    companies: byLegacyId(companies),
    employees: byLegacyId(employees),
    voyages: voyageMap,
    createdById: MIGRATION_USER_ID,
  };
}

function readBatch(body) {
  const operation = body?.operation;
  if (!OPERATIONS.includes(operation)) return null;
  if (!Array.isArray(body?.jobs)) return null;
  return { operation, jobs: body.jobs };
}

function summarise(plan) {
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    unresolved: plan.unresolved,
    problems: {
      missingId: plan.problems.missingId,
      missingJobNo: plan.problems.missingJobNo.slice(0, 25),
      missingJobNoCount: plan.problems.missingJobNo.length,
      duplicateClimaxIds: plan.problems.duplicateClimaxIds.slice(0, 25),
    },
  };
}

async function planFor(body) {
  const batch = readBatch(body);
  if (!batch) return null;
  const existing = await SE_Job.findAll({
    attributes: ['climaxId'],
    where: {
      operation: batch.operation,
      climaxId: { [db.Sequelize.Op.ne]: null },
    },
    raw: true,
  });

  return planJobs(batch.jobs, batch.operation, {
    existingClimaxIds: existing.map((j) => j.climaxId),
    resolvers: await buildResolvers(),
  });
}

const BAD_BODY = {
  status: 'error',
  result: 'Send { operation: "SE"|"SI"|"AE"|"AI", jobs: [...] }, where each job carries its '
    + 'resolved legacy lookups on `_resolved` (see jobShape.js on the client).',
};

routes.post('/plan', SYSTEM, async (req, res) => {
  try {
    const plan = await planFor(req.body);
    if (!plan) return res.status(400).json(BAD_BODY);
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[job migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/apply', SYSTEM, async (req, res) => {
  try {
    const batch = readBatch(req.body);
    if (!batch) return res.status(400).json(BAD_BODY);

    if (batch.jobs.length > MAX_BATCH) {
      return res.status(413).json({
        status: 'error',
        result: `Batch of ${batch.jobs.length} jobs exceeds the ${MAX_BATCH}-row limit.`,
      });
    }

    const plan = await planFor(req.body);
    if (!plan.toCreate.length) {
      return res.json({ status: 'success', result: { ...summarise(plan), created: 0 } });
    }

    // One transaction for the batch. The old receiver used one per job, which
    // is also correct but costs a round trip per row.
    await db.sequelize.transaction(async (t) => {
      await SE_Job.bulkCreate(plan.toCreate, {
        transaction: t,
        // These rows carry their own createdAt/updatedAt from the legacy
        // system, and the model's fiscal-year hook does not apply to history.
        silent: true,
        fiscalYearCheck: false,
      });
    });

    res.json({
      status: 'success',
      result: { ...summarise(plan), created: plan.toCreate.length },
    });
  } catch (error) {
    console.error('[job migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make.
 *
 * A job table can hold exactly the right number of rows and still be unusable:
 * every job list is scoped by company, so a job with no companyId is invisible
 * on every screen while being present in every count.
 */
routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const rows = await SE_Job.findAll({
      attributes: ['id', 'jobNo', 'operation', 'companyId', 'climaxId', 'ClientId', 'commodityId'],
      raw: true,
    });

    const byOperation = {};
    for (const op of OPERATIONS) {
      const of = rows.filter((r) => r.operation === op);
      byOperation[op] = of.length;
    }

    const withoutCompany = rows.filter((r) => !r.companyId);
    const withoutClient = rows.filter((r) => !r.ClientId);
    const withoutClimaxId = rows.filter((r) => r.climaxId === null);
    const withoutJobNo = rows.filter((r) => !r.jobNo || !String(r.jobNo).trim());

    const seen = new Map();
    for (const r of rows) {
      if (r.climaxId === null) continue;
      const k = `${r.operation}|${r.climaxId}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);

    res.json({
      status: 'success',
      result: {
        jobs: rows.length,
        byOperation,
        migrated: rows.length - withoutClimaxId.length,
        handCreated: withoutClimaxId.length,

        // Every job list is scoped by company - this is the one that makes a
        // job invisible rather than merely incomplete.
        withoutCompany: withoutCompany.length,
        withoutCompanySample: withoutCompany.slice(0, 25).map((r) => r.jobNo),

        withoutClient: withoutClient.length,
        withoutJobNo: withoutJobNo.length,

        // Same legacy job imported twice under one operation.
        duplicateClimaxIds: duplicates.slice(0, 25),
        duplicateClimaxIdCount: duplicates.length,

        healthy: withoutCompany.length === 0 && duplicates.length === 0
          && withoutJobNo.length === 0,
        note:
          'withoutCompany is the important one: every job list is scoped by company, so those '
          + 'jobs are present in this count and invisible on every screen. B/Ls, equipment and '
          + 'charge lines are NOT imported by this stage and are not checked here.',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

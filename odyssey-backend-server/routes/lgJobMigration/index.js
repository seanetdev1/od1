/**
 * Receiver for the customs-clearance job migration: legacy LOG jobs.
 *
 * plan / apply / verify, matching every other rewritten migration stage:
 *
 *   POST /lgJobMigration/plan    what WOULD happen. Writes nothing.
 *   POST /lgJobMigration/apply   does it, in one transaction per batch.
 *   GET  /lgJobMigration/verify  what is actually in the system afterwards.
 *
 * The mapping itself lives in functions/lgJobMigrationPlan.js, with no database
 * in it, so it can be tested. This file supplies the resolvers and does the
 * writing.
 *
 * TARGET IS Customs_Job, NOT SE_Job. The old importLGJobs wrote a clearing job
 * into the freight table with a forced SE/SI/AE/AI operation; in customs mode
 * those screens do not exist, so every one of those jobs would be invisible.
 * See the header of the plan module.
 */
const routes = require('express').Router();
const db = require('../../models');
const { Clients, Commodity, Company } = require('../../models');
const { Customs_Job, Customs_Duty, Customs_Container } = require('../../functions/Associations/customsAssociations');
const { requireSystem } = require('../../functions/systemAccess');
const { planLgJobs } = require('../../functions/lgJobMigrationPlan');
// This installation's cost centre code - see functions/lgJobMigrationPlan.js
// resolveCostCenter for why a single legacy cost centre maps to it.
const { readCostCenter } = require('../settings');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;
const Op = db.Sequelize.Op;

// Matches the client's BATCH. A LOG job plus its duty lines is a wide payload,
// so these are smaller than the location stage's batches.
const MAX_BATCH = 500;

/**
 * Every lookup the mapper needs, in three queries rather than five per job.
 *
 * Built per request. On a large import this is the difference between a handful
 * of queries and one per foreign key per row.
 *
 * The legacy lookups that live only in the legacy database - packing codes,
 * currencies - are NOT taken here: the client resolves them once and sends each
 * job carrying the scalars it needs, for the same reason the freight jobs stage
 * stopped attaching them to every batch.
 */
async function buildResolvers() {
  const byLegacyId = (rows) => new Map(
    rows.filter((x) => x.climaxId !== null && x.climaxId !== undefined)
      .map((x) => [String(x.climaxId), x.id]),
  );

  const [clients, commodities, companies] = await Promise.all([
    Clients.findAll({ attributes: ['id', 'climaxId'], raw: true }),
    Commodity.findAll({ attributes: ['id', 'climaxId'], raw: true }),
    Company.findAll({ attributes: ['id', 'climaxId'], raw: true }),
  ]);

  return {
    clients: byLegacyId(clients),
    commodities: byLegacyId(commodities),
    companies: byLegacyId(companies),
  };
}

function readBatch(body) {
  if (!Array.isArray(body?.jobs)) return null;
  return {
    jobs: body.jobs,
    // Duty rows for THIS batch's jobs only. An array, possibly empty: a batch
    // of files whose GDs are not assessed yet legitimately has none.
    duty: Array.isArray(body?.duty) ? body.duty : [],
    // Container rows for THIS batch's jobs, same treatment as duty.
    containers: Array.isArray(body?.containers) ? body.containers : [],
    // Per-job scalars the client resolved from the legacy lookups, keyed the
    // way the mapper reads them.
    packing: new Map(Object.entries(body?.packing || {})),
    currency: new Map(Object.entries(body?.currency || {})),
    // Terminal, cargo type and Incoterms. Small lookups that live only in the
    // legacy database, resolved once by the client and sent as { id: value } -
    // the same shape and for the same reason as packing and currency above.
    terminals: new Map(Object.entries(body?.terminals || {})),
    cargoTypes: new Map(Object.entries(body?.cargoTypes || {})),
    incoTerms: new Map(Object.entries(body?.incoTerms || {})),
    cancelReasons: new Map(Object.entries(body?.cancelReasons || {})),
    costCenters: new Map(Object.entries(body?.costCenters || {})),
    containerTypes: new Map(Object.entries(body?.containerTypes || {})),
    deliveryTypes: new Map(Object.entries(body?.deliveryTypes || {})),
  };
}

function summarise(plan) {
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    unresolved: plan.unresolved,
    unknownCodes: plan.unknownCodes,
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

  const existing = await Customs_Job.findAll({
    attributes: ['climaxId'],
    where: { climaxId: { [Op.ne]: null } },
    raw: true,
  });

  const resolvers = await buildResolvers();
  return planLgJobs(batch.jobs, batch.duty, {
    containers: batch.containers,
    existingClimaxIds: existing.map((j) => j.climaxId),
    resolvers: {
      ...resolvers,
      packing: batch.packing,
      currency: batch.currency,
      terminals: batch.terminals,
      cargoTypes: batch.cargoTypes,
      incoTerms: batch.incoTerms,
      cancelReasons: batch.cancelReasons,
      costCenters: batch.costCenters,
      installCostCenter: await readCostCenter(),
      containerTypes: batch.containerTypes,
      deliveryTypes: batch.deliveryTypes,
    },
  });
}

const BAD_BODY = {
  status: 'error',
  result: 'Send { jobs: [...], duty: [...], packing: {code:name}, currency: {id:code} } - '
    + 'see functions/migration/lgJobs.js on the client.',
};

routes.post('/plan', SYSTEM, async (req, res) => {
  try {
    if (Array.isArray(req.body?.jobs) && req.body.jobs.length > MAX_BATCH) {
      return res.status(400).json({
        status: 'error',
        result: `Batch too large: ${req.body.jobs.length}. Send at most ${MAX_BATCH} jobs.`,
      });
    }
    const plan = await planFor(req.body);
    if (!plan) return res.status(400).json(BAD_BODY);
    res.json({ status: 'success', result: { ...summarise(plan), created: 0 } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/apply', SYSTEM, async (req, res) => {
  try {
    if (Array.isArray(req.body?.jobs) && req.body.jobs.length > MAX_BATCH) {
      return res.status(400).json({
        status: 'error',
        result: `Batch too large: ${req.body.jobs.length}. Send at most ${MAX_BATCH} jobs.`,
      });
    }
    const plan = await planFor(req.body);
    if (!plan) return res.status(400).json(BAD_BODY);

    let created = 0;
    let dutyCreated = 0;
    let containersCreated = 0;

    // ONE TRANSACTION FOR THE BATCH. A job and its duty lines are one record as
    // far as anyone reading the screen is concerned - a job that landed without
    // its duty is worse than a job that did not land, because a row count sees
    // the first as a success.
    await db.sequelize.transaction(async (t) => {
      for (const { job, duty, containers } of plan.toCreate) {
        const row = await Customs_Job.create(job, { transaction: t });
        created += 1;
        if (duty.length) {
          await Customs_Duty.bulkCreate(
            duty.map((d) => ({ ...d, CustomsJobId: row.id })),
            { transaction: t },
          );
          dutyCreated += duty.length;
        }
        if (containers && containers.length) {
          await Customs_Container.bulkCreate(
            containers.map((c) => ({ ...c, CustomsJobId: row.id })),
            { transaction: t },
          );
          containersCreated += containers.length;
        }
      }
    });

    res.json({
      status: 'success',
      result: { ...summarise(plan), created, dutyCreated, containersCreated },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * What is actually in the system.
 *
 * Counting what Odyssey holds proves it received something; it says nothing
 * about whether that is all of it - which is what the reconciliation against
 * the legacy row counts is for. What this CAN see is the damage a row count
 * cannot: jobs with no company (invisible on every list), jobs imported twice,
 * and jobs whose GD carries no duty at all.
 */
routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const [jobs, migrated, withoutCompany, withoutGd, dutyLines] = await Promise.all([
      Customs_Job.count(),
      Customs_Job.count({ where: { climaxId: { [Op.ne]: null } } }),
      Customs_Job.count({ where: { [Op.or]: [{ companyId: null }, { companyId: '' }] } }),
      Customs_Job.count({ where: { climaxId: { [Op.ne]: null }, gdNumber: null } }),
      Customs_Duty.count(),
    ]);

    // Jobs carrying no duty at all. Not necessarily wrong - a file whose GD is
    // not assessed yet has none - but it is the number that separates "the
    // duty did not come across" from "there was none".
    const withDuty = await Customs_Duty.aggregate('CustomsJobId', 'count', {
      distinct: true,
    });

    const sample = await Customs_Job.findAll({
      attributes: ['jobNo'],
      where: { [Op.or]: [{ companyId: null }, { companyId: '' }] },
      limit: 10,
      raw: true,
    });

    // Legacy ids imported more than once. A unique index would be the real
    // guarantee; this is the report that says whether one is needed yet.
    const dupes = await Customs_Job.findAll({
      attributes: ['climaxId'],
      where: { climaxId: { [Op.ne]: null } },
      group: ['climaxId'],
      having: db.Sequelize.literal('COUNT(*) > 1'),
      raw: true,
    });

    res.json({
      status: 'success',
      result: {
        jobs,
        migrated,
        handCreated: jobs - migrated,
        dutyLines,
        jobsWithDuty: Number(withDuty) || 0,
        jobsWithoutDuty: migrated - (Number(withDuty) || 0),
        withoutCompany,
        withoutCompanySample: sample.map((j) => j.jobNo),
        withoutGdNumber: withoutGd,
        duplicateClimaxIdCount: dupes.length,
        duplicateClimaxIds: dupes.slice(0, 25).map((d) => d.climaxId),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

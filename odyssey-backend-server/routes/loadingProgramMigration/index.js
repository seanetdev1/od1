/**
 * Loading program migration - plan, apply, verify.
 *
 * Nothing in any receiver has ever created a Loading_Program, so this is not
 * replacing an old path - there is no old path.
 *
 *   POST /loadingProgramMigration/plan    what would happen, writes nothing
 *   POST /loadingProgramMigration/apply   one batch, one transaction
 *   GET  /loadingProgramMigration/verify  what a row count cannot see
 *
 * Sea export only, one per job. Depends on the Jobs stage.
 */

const routes = require('express').Router();
const db = require('../../models');
const { SE_Job, Loading_Program } = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planLoadingPrograms, OPERATIONS } = require('../../functions/loadingProgramMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;
const MAX_BATCH = 1000;

const toMap = (rows, key, value) => new Map(
  (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r[key] !== null && r[key] !== undefined)
    .map((r) => [String(r[key]), r[value]]),
);

function readBatch(body) {
  const operation = body?.operation || 'SE';
  if (!OPERATIONS.includes(operation)) return null;
  if (!Array.isArray(body?.rows)) return null;
  return {
    operation,
    rows: body.rows,
    localCustoms: toMap(body.localCustoms, 'Id', 'LocalCustomName'),
    wharfs: toMap(body.wharfs, 'Id', 'WharfName'),
    lov: toMap(body.lov, 'Id', 'LOVText'),
    locations: toMap(body.locations, 'Id', 'LocationName'),
  };
}

async function jobMap(operation) {
  const rows = await SE_Job.findAll({
    attributes: ['id', 'climaxId'],
    where: { operation, climaxId: { [db.Sequelize.Op.ne]: null } },
    raw: true,
  });
  return new Map(rows.map((j) => [String(j.climaxId), j.id]));
}

/** Jobs that already have a loading program, so a re-run skips them. */
async function jobsDone() {
  const rows = await Loading_Program.findAll({
    attributes: ['SEJobId'],
    where: { SEJobId: { [db.Sequelize.Op.ne]: null } },
    group: ['SEJobId'],
    raw: true,
  });
  return rows.map((r) => r.SEJobId);
}

async function planFor(body) {
  const batch = readBatch(body);
  if (!batch) return null;

  return planLoadingPrograms(batch.rows, batch.operation, {
    jobIdByLegacyId: await jobMap(batch.operation),
    jobsDone: await jobsDone(),
    localCustoms: batch.localCustoms,
    wharfs: batch.wharfs,
    lov: batch.lov,
    locations: batch.locations,
  });
}

function summarise(plan) {
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    undecoded: plan.undecoded,
    problems: {
      missingId: plan.problems.missingId,
      missingJobRef: plan.problems.missingJobRef,
      orphaned: plan.problems.orphaned.slice(0, 25),
      duplicateJobs: plan.problems.duplicateJobs.slice(0, 25),
    },
  };
}

const BAD_BODY = {
  status: 'error',
  result: 'Send { operation: "SE", rows: [...] } plus the lookups (localCustoms, wharfs, lov, '
    + 'locations). Loading programs exist only for sea export.',
};

routes.post('/plan', SYSTEM, async (req, res) => {
  try {
    const plan = await planFor(req.body);
    if (!plan) return res.status(400).json(BAD_BODY);
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[loading program migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/apply', SYSTEM, async (req, res) => {
  try {
    const batch = readBatch(req.body);
    if (!batch) return res.status(400).json(BAD_BODY);

    if (batch.rows.length > MAX_BATCH) {
      return res.status(413).json({
        status: 'error',
        result: `Batch of ${batch.rows.length} rows exceeds the ${MAX_BATCH}-row limit.`,
      });
    }

    const plan = await planFor(req.body);
    if (!plan.toCreate.length) {
      return res.json({ status: 'success', result: { ...summarise(plan), created: 0 } });
    }

    await db.sequelize.transaction(async (t) => {
      await Loading_Program.bulkCreate(plan.toCreate, { transaction: t });
    });

    res.json({
      status: 'success',
      result: { ...summarise(plan), created: plan.toCreate.length },
    });
  } catch (error) {
    console.error('[loading program migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make.
 *
 * A loading program with no job is unreachable - it opens only from its job -
 * and one whose lookups did not decode shows blank labels on a screen that
 * otherwise looks complete.
 */
routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const [programs, jobs] = await Promise.all([
      Loading_Program.findAll({
        attributes: [
          'id', 'SEJobId', 'localCustom', 'wharf', 'status', 'loadingFlag',
          'containerPickup', 'instruction',
        ],
        raw: true,
      }),
      SE_Job.findAll({ attributes: ['id', 'operation'], raw: true }),
    ]);

    const jobIds = new Set(jobs.map((j) => String(j.id)));
    const blank = (v) => v === null || v === undefined || String(v).trim() === '';

    const detached = programs.filter((p) => !p.SEJobId || !jobIds.has(String(p.SEJobId)));
    const seJobs = jobs.filter((j) => j.operation === 'SE');

    // More than one per job: the job screen loads only one, so the rest are
    // invisible.
    const perJob = new Map();
    for (const p of programs) {
      if (!p.SEJobId) continue;
      const k = String(p.SEJobId);
      perJob.set(k, (perJob.get(k) || 0) + 1);
    }
    const jobsWithMultiple = [...perJob.entries()].filter(([, n]) => n > 1).length;

    res.json({
      status: 'success',
      result: {
        loadingPrograms: programs.length,
        seJobs: seJobs.length,
        jobsWithProgram: perJob.size,

        detached: detached.length,
        jobsWithMultiple,

        // Blank labels on an otherwise complete screen.
        withoutLocalCustom: programs.filter((p) => blank(p.localCustom)).length,
        withoutWharf: programs.filter((p) => blank(p.wharf)).length,
        withoutStatus: programs.filter((p) => blank(p.status)).length,
        withoutInstruction: programs.filter((p) => blank(p.instruction)).length,

        healthy: detached.length === 0 && jobsWithMultiple === 0,
        note:
          'A loading program opens only from its job, so a detached one is unreachable. The '
          + 'withoutX counts are decoded lookups that came back empty - they leave a blank label '
          + 'on a screen that otherwise looks complete. loadingTerms is intentionally never '
          + 'populated: the legacy column is a flag, not the terms text.',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

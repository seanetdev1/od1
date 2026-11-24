/**
 * Job equipment migration - plan, apply, verify.
 *
 * The /seaJob/Upload*Jobs receivers are untouched and still create equipment
 * as a side effect of importing a job.
 *
 *   POST /jobEquipmentMigration/plan    what would happen, writes nothing
 *   POST /jobEquipmentMigration/apply   one operation, one batch, one transaction
 *   GET  /jobEquipmentMigration/verify  what a row count cannot see
 *
 * Depends on the Jobs stage: equipment attaches through SE_Job.climaxId,
 * scoped by operation. Sea only - air jobs have no equipment.
 */

const routes = require('express').Router();
const db = require('../../models');
const { SE_Job, SE_Equipments } = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planJobEquipment, OPERATIONS } = require('../../functions/jobEquipmentMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;
const MAX_BATCH = 2000;

function readBatch(body) {
  const { operation } = body || {};
  if (!OPERATIONS.includes(operation)) return null;
  if (!Array.isArray(body.rows)) return null;
  return {
    operation,
    rows: body.rows,
    sizeTypes: Array.isArray(body.sizeTypes) ? body.sizeTypes : [],
  };
}

/** legacy job id -> Odyssey SE_Job id, for this operation only. */
async function jobMap(operation) {
  const rows = await SE_Job.findAll({
    attributes: ['id', 'climaxId'],
    where: { operation, climaxId: { [db.Sequelize.Op.ne]: null } },
    raw: true,
  });
  return new Map(rows.map((j) => [String(j.climaxId), j.id]));
}

/** Jobs that already carry equipment, so a re-run skips them. */
async function jobsDone() {
  const rows = await SE_Equipments.findAll({
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

  return planJobEquipment(batch.rows, batch.operation, {
    jobIdByLegacyId: await jobMap(batch.operation),
    jobsDone: await jobsDone(),
    sizeTypes: new Map(
      batch.sizeTypes
        .filter((s) => s && s.EquipCode !== null && s.EquipCode !== undefined)
        .map((s) => [String(s.EquipCode).trim(), s]),
    ),
  });
}

function summarise(plan) {
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      missingId: plan.problems.missingId,
      missingJobRef: plan.problems.missingJobRef,
      orphaned: plan.problems.orphaned.slice(0, 25),
      unknownSizeType: [...new Set(plan.problems.unknownSizeType)].slice(0, 25),
      missingSize: plan.problems.missingSize,
    },
  };
}

const BAD_BODY = {
  status: 'error',
  result: 'Send { operation: "SE"|"SI", rows: [...], sizeTypes: [...] }. Only sea jobs carry '
    + 'equipment; air jobs have none.',
};

routes.post('/plan', SYSTEM, async (req, res) => {
  try {
    const plan = await planFor(req.body);
    if (!plan) return res.status(400).json(BAD_BODY);
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[job equipment migration] plan failed:', error);
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
      await SE_Equipments.bulkCreate(plan.toCreate, { transaction: t });
    });

    res.json({
      status: 'success',
      result: { ...summarise(plan), created: plan.toCreate.length },
    });
  } catch (error) {
    console.error('[job equipment migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make.
 *
 * Equipment with no job belongs to nothing and is invisible on every screen
 * while still counting as imported, and equipment with no TEU silently skews
 * the TEU totals a job list shows.
 */
routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const [equipment, jobs] = await Promise.all([
      SE_Equipments.findAll({
        attributes: ['id', 'SEJobId', 'size', 'qty', 'gross', 'teu', 'climaxId'], raw: true,
      }),
      SE_Job.findAll({ attributes: ['id', 'operation'], raw: true }),
    ]);

    const jobIds = new Set(jobs.map((j) => String(j.id)));
    const blank = (v) => v === null || v === undefined || String(v).trim() === '';

    const detached = equipment.filter((e) => !e.SEJobId || !jobIds.has(String(e.SEJobId)));
    const withoutClimaxId = equipment.filter((e) => e.climaxId === null);
    const withoutTeu = equipment.filter((e) => blank(e.teu));
    const withoutGross = equipment.filter((e) => blank(e.gross));
    const withoutSize = equipment.filter((e) => blank(e.size));

    const seaJobs = jobs.filter((j) => j.operation === 'SE' || j.operation === 'SI');
    const jobsWithEquipment = new Set(
      equipment.filter((e) => e.SEJobId).map((e) => String(e.SEJobId)),
    ).size;

    const seen = new Map();
    for (const e of equipment) {
      if (e.climaxId === null) continue;
      const k = String(e.climaxId);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => Number(k));

    res.json({
      status: 'success',
      result: {
        equipment: equipment.length,
        seaJobs: seaJobs.length,
        jobsWithEquipment,

        detached: detached.length,
        detachedSample: detached.slice(0, 25).map((e) => e.size),

        // The old import never set this, so rows it created cannot be matched
        // on a re-run - only counted.
        withoutClimaxId: withoutClimaxId.length,

        // TEU comes only from the size-type lookup, so a size code the lookup
        // does not explain leaves it blank and skews any TEU total.
        withoutTeu: withoutTeu.length,
        withoutGross: withoutGross.length,
        withoutSize: withoutSize.length,

        duplicateClimaxIds: duplicates.slice(0, 25),
        duplicateClimaxIdCount: duplicates.length,

        healthy: detached.length === 0 && duplicates.length === 0 && withoutSize.length === 0,
        note:
          'Equipment with no SEJobId belongs to nothing and is invisible on every screen while '
          + 'still counting as imported. withoutTeu matters because TEU comes only from the '
          + 'size-type lookup, so it silently skews any TEU total the job list shows. Containers '
          + 'on a B/L are a different table (Container_Info) and are not checked here.',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

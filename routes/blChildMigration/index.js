/**
 * B/L children migration - containers, stamps, dimensions and AWB rate lines.
 *
 * The /seaJob/Upload*Jobs receivers and /seaJob/fixAEBL are untouched and still
 * create these as a side effect of importing a job.
 *
 *   POST /blChildMigration/plan    what would happen, writes nothing
 *   POST /blChildMigration/apply   one kind, one operation, one transaction
 *   GET  /blChildMigration/verify  what a row count cannot see
 *
 * Depends on the B/L stage: everything here attaches to a Bl through
 * Bl.climaxId, scoped by operation.
 */

const routes = require('express').Router();
const db = require('../../models');
const {
  Bl, Container_Info, Item_Details, Stamps, Dimensions,
} = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planBlChildren, KINDS, PARENT_KEY } = require('../../functions/blChildMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

const MAX_BATCH = 2000;

const MODELS = {
  containers: Container_Info,
  stamps: Stamps,
  dimensions: Dimensions,
  items: Item_Details,
};

function readBatch(body) {
  const { kind, operation } = body || {};
  if (!KINDS.includes(kind)) return null;
  if (!PARENT_KEY[kind] || !PARENT_KEY[kind][operation]) return null;
  if (!Array.isArray(body.rows)) return null;
  return {
    kind,
    operation,
    rows: body.rows,
    packing: Array.isArray(body.packing) ? body.packing : [],
    stamps: Array.isArray(body.stamps) ? body.stamps : [],
  };
}

/**
 * legacy parent id -> Odyssey Bl.id.
 *
 * For everything except air-import dimensions the parent IS the B/L, so this
 * is Bl.climaxId. Air-import dimensions point at their JOB, so they are
 * resolved through the waybill that job carries - which is 1:1.
 */
async function parentMap(kind, operation) {
  const bls = await Bl.findAll({
    attributes: ['id', 'climaxId', 'SEJobId'],
    where: { operation, climaxId: { [db.Sequelize.Op.ne]: null } },
    raw: true,
  });

  if (!(kind === 'dimensions' && operation === 'AI')) {
    return new Map(bls.map((b) => [String(b.climaxId), b.id]));
  }

  const jobs = await db.SE_Job.findAll({
    attributes: ['id', 'climaxId'],
    where: { operation: 'AI', climaxId: { [db.Sequelize.Op.ne]: null } },
    raw: true,
  });
  // legacy job id -> Odyssey job id -> that job's waybill.
  const blByJobId = new Map(bls.filter((b) => b.SEJobId).map((b) => [String(b.SEJobId), b.id]));
  const out = new Map();
  for (const j of jobs) {
    const blId = blByJobId.get(String(j.id));
    if (blId !== undefined) out.set(String(j.climaxId), blId);
  }
  return out;
}

/** Bl.ids that already carry children of this kind, so a re-run skips them. */
async function parentsDone(kind) {
  const rows = await MODELS[kind].findAll({
    attributes: ['BlId'],
    where: { BlId: { [db.Sequelize.Op.ne]: null } },
    group: ['BlId'],
    raw: true,
  });
  return rows.map((r) => r.BlId);
}

const toMap = (rows, key, value) => new Map(
  (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r[key] !== null && r[key] !== undefined)
    .map((r) => [String(r[key]), value ? r[value] : r]),
);

async function planFor(body) {
  const batch = readBatch(body);
  if (!batch) return null;

  return planBlChildren(batch.kind, batch.rows, batch.operation, {
    blIdByParentId: await parentMap(batch.kind, batch.operation),
    parentsDone: await parentsDone(batch.kind),
    packing: toMap(batch.packing, 'PackCode', 'PackName'),
    stamps: toMap(batch.stamps, 'Id'),
  });
}

function summarise(plan) {
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      missingParentRef: plan.problems.missingParentRef,
      orphaned: plan.problems.orphaned.slice(0, 25),
      emptyBlocks: plan.problems.emptyBlocks,
    },
  };
}

const BAD_BODY = {
  status: 'error',
  result: 'Send { kind: "containers"|"stamps"|"dimensions"|"items", operation: "SE"|"SI"|"AE"|"AI", '
    + 'rows: [...] }. Not every kind exists for every operation - containers are sea only, '
    + 'dimensions and items are air only.',
};

routes.post('/plan', SYSTEM, async (req, res) => {
  try {
    const plan = await planFor(req.body);
    if (!plan) return res.status(400).json(BAD_BODY);
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[bl child migration] plan failed:', error);
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
      await MODELS[batch.kind].bulkCreate(plan.toCreate, { transaction: t });
    });

    res.json({
      status: 'success',
      result: { ...summarise(plan), created: plan.toCreate.length },
    });
  } catch (error) {
    console.error('[bl child migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make.
 *
 * A child row with no BlId belongs to nothing and is invisible on every B/L
 * screen while still counting as imported.
 */
routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const [containers, stamps, dimensions, items, bls] = await Promise.all([
      Container_Info.findAll({ attributes: ['id', 'BlId', 'no', 'climaxId'], raw: true }),
      Stamps.findAll({ attributes: ['id', 'BlId', 'climaxId'], raw: true }),
      Dimensions.findAll({ attributes: ['id', 'BlId'], raw: true }),
      Item_Details.findAll({ attributes: ['id', 'BlId'], raw: true }),
      Bl.findAll({ attributes: ['id', 'operation'], raw: true }),
    ]);

    const blIds = new Set(bls.map((b) => String(b.id)));
    const detached = (rows) => rows.filter(
      (r) => !r.BlId || !blIds.has(String(r.BlId)),
    ).length;
    const parents = (rows) => new Set(rows.filter((r) => r.BlId).map((r) => String(r.BlId))).size;

    const seaBls = bls.filter((b) => b.operation === 'SE' || b.operation === 'SI').length;
    const airBls = bls.filter((b) => b.operation === 'AE' || b.operation === 'AI').length;

    res.json({
      status: 'success',
      result: {
        bls: bls.length,

        containers: containers.length,
        containersDetached: detached(containers),
        // The old import never set this, so a high number here means those
        // rows came from the old path and cannot be told apart on a re-run.
        containersWithoutClimaxId: containers.filter((r) => r.climaxId === null).length,
        seaBlsWithContainers: parents(containers),
        seaBls,

        stamps: stamps.length,
        stampsDetached: detached(stamps),
        stampsWithoutClimaxId: stamps.filter((r) => r.climaxId === null).length,

        dimensions: dimensions.length,
        dimensionsDetached: detached(dimensions),

        items: items.length,
        itemsDetached: detached(items),
        airBlsWithItems: parents(items),
        airBls,

        healthy:
          detached(containers) === 0 && detached(stamps) === 0
          && detached(dimensions) === 0 && detached(items) === 0,
        note:
          'A child row with no BlId belongs to nothing and is invisible on every B/L screen '
          + 'while still counting as imported. containersWithoutClimaxId and '
          + 'stampsWithoutClimaxId count rows the old import created without a legacy id - '
          + 'those cannot be matched on a re-run, only counted.',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

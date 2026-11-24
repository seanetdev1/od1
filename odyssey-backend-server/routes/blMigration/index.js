/**
 * B/L and air-waybill migration - the B/L records only. Plan, apply, verify.
 *
 * The /seaJob/Upload*Jobs receivers are untouched and still create B/Ls,
 * containers, stamps and dimensions from a nested job payload. This stage
 * imports B/L rows only; containers, item details, stamps and dimensions get
 * their own stages.
 *
 *   POST /blMigration/plan           what would happen, writes nothing
 *   POST /blMigration/apply          one batch, one transaction
 *   POST /blMigration/registerMawbs  the air MAWBs into the AWB stock, once
 *                                    every batch is in - see below
 *   GET  /blMigration/verify         what a row count cannot see
 *
 * All four legacy B/L tables land in Bl, separated by `operation`. A B/L is
 * attached to its Odyssey job through that job's legacy id, so this stage
 * depends on the Jobs stage having run.
 */

const routes = require('express').Router();
const db = require('../../models');
const { Bl, SE_Job } = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planBls, OPERATIONS } = require('../../functions/blMigrationPlan');
const { registerMigratedMawbs } = require('../../functions/awblMigration');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

// B/Ls carry several TEXT columns (addresses, goods descriptions), so rows are
// larger than a job's. 250 keeps a batch comfortable.
const MAX_BATCH = 250;

function readBatch(body) {
  const operation = body?.operation;
  if (!OPERATIONS.includes(operation)) return null;
  if (!Array.isArray(body?.bls)) return null;
  return {
    operation,
    bls: body.bls,
    details: Array.isArray(body.details) ? body.details : [],
    jobFields: Array.isArray(body.jobFields) ? body.jobFields : [],
  };
}

/**
 * legacy job id -> Odyssey SE_Job id, for this operation only.
 *
 * Scoped by operation because a legacy job id is only unique within its own
 * job table - SE job 100 and AE job 100 are different jobs.
 */
async function jobMap(operation) {
  const rows = await SE_Job.findAll({
    attributes: ['id', 'climaxId'],
    where: { operation, climaxId: { [db.Sequelize.Op.ne]: null } },
    raw: true,
  });
  return new Map(rows.map((j) => [String(j.climaxId), j.id]));
}

/** The detail row for each sea B/L, keyed by the B/L id it belongs to. */
function detailMap(operation, details) {
  const key = operation === 'SE' ? 'SEBLId' : 'SIBLId';
  const map = new Map();
  for (const d of details) {
    if (!d || d[key] === null || d[key] === undefined) continue;
    // First wins: a B/L with two detail rows is a legacy data problem, and
    // picking one deterministically beats picking one at random.
    if (!map.has(String(d[key]))) map.set(String(d[key]), d);
  }
  return map;
}

/** The handful of job columns a B/L reads, keyed by legacy job id. */
function jobFieldsMap(jobFields) {
  const map = new Map();
  for (const j of jobFields) {
    if (!j || j.Id === null || j.Id === undefined) continue;
    map.set(String(j.Id), j);
  }
  return map;
}

async function planFor(body) {
  const batch = readBatch(body);
  if (!batch) return null;

  const existing = await Bl.findAll({
    attributes: ['climaxId'],
    where: { operation: batch.operation, climaxId: { [db.Sequelize.Op.ne]: null } },
    raw: true,
  });

  return planBls(batch.bls, batch.operation, {
    existingClimaxIds: existing.map((b) => b.climaxId),
    jobIdByLegacyId: await jobMap(batch.operation),
    detailByBlId: detailMap(batch.operation, batch.details),
    jobFieldsByLegacyId: jobFieldsMap(batch.jobFields),
  });
}

function summarise(plan) {
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      missingId: plan.problems.missingId,
      duplicateClimaxIds: plan.problems.duplicateClimaxIds.slice(0, 25),
      orphaned: plan.problems.orphaned.slice(0, 25),
      missingHbl: plan.problems.missingHbl.slice(0, 25),
      missingDetail: plan.problems.missingDetail.slice(0, 25),
      duplicateJobBls: plan.problems.duplicateJobBls.slice(0, 25),
    },
  };
}

const BAD_BODY = {
  status: 'error',
  result: 'Send { operation: "SE"|"SI"|"AE"|"AI", bls: [...], details: [...], jobFields: [...] }. '
    + 'details is the sea B/L detail table (ignored for air); jobFields carries the projected '
    + 'job columns a B/L reads.',
};

routes.post('/plan', SYSTEM, async (req, res) => {
  try {
    const plan = await planFor(req.body);
    if (!plan) return res.status(400).json(BAD_BODY);
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[bl migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/apply', SYSTEM, async (req, res) => {
  try {
    const batch = readBatch(req.body);
    if (!batch) return res.status(400).json(BAD_BODY);

    if (batch.bls.length > MAX_BATCH) {
      return res.status(413).json({
        status: 'error',
        result: `Batch of ${batch.bls.length} B/Ls exceeds the ${MAX_BATCH}-row limit.`,
      });
    }

    const plan = await planFor(req.body);
    if (!plan.toCreate.length) {
      return res.json({ status: 'success', result: { ...summarise(plan), created: 0 } });
    }

    await db.sequelize.transaction(async (t) => {
      await Bl.bulkCreate(plan.toCreate, { transaction: t, silent: true });
    });

    res.json({
      status: 'success',
      result: { ...summarise(plan), created: plan.toCreate.length },
    });
  } catch (error) {
    console.error('[bl migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Registers the MAWB typed on every air BL in the AWB stock, as used by its
 * job. See functions/awblMigration for what is registered and what is left for
 * operations to correct.
 *
 * Its own call rather than part of /apply: the rule that a number on two jobs
 * is registered to NEITHER needs every air BL in the database at once, and a
 * batch only ever sees its own 250. Safe to call again - it only adds what is
 * missing. `dryRun: true` reports without writing.
 */
routes.post('/registerMawbs', SYSTEM, async (req, res) => {
  try {
    const { counts, released, outcomes } = await registerMigratedMawbs(db, {
      dryRun: Boolean(req.body?.dryRun),
    });
    // A sample of what needs a person, so the report can name some jobs.
    const needsCorrection = outcomes
      .filter((o) => !['registered', 'claimed', 'already'].includes(o.outcome))
      .slice(0, 25)
      .map((o) => ({ jobNo: o.row.jobNo, mbl: o.row.mbl, outcome: o.outcome, detail: o.detail }));
    res.json({ status: 'success', result: { counts, released, needsCorrection } });
  } catch (error) {
    console.error('[bl migration] MAWB registration failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make.
 *
 * A B/L table can be exactly the right size and still be useless: a B/L with
 * no job is unreachable because every B/L opens from its job, and a B/L with
 * no printable content prints blank while counting as imported.
 */
routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const rows = await Bl.findAll({
      attributes: [
        'id', 'operation', 'hbl', 'mbl', 'climaxId', 'SEJobId',
        'issuePlace', 'shipperContent', 'consigneeContent',
      ],
      raw: true,
    });

    const byOperation = {};
    for (const op of OPERATIONS) byOperation[op] = rows.filter((r) => r.operation === op).length;

    const blank = (v) => v === null || v === undefined || String(v).trim() === '';

    const withoutJob = rows.filter((r) => !r.SEJobId);
    const withoutHbl = rows.filter((r) => blank(r.hbl));
    const withoutClimaxId = rows.filter((r) => r.climaxId === null);
    // The field the old import dropped on every single row.
    const withoutIssuePlace = rows.filter((r) => blank(r.issuePlace));
    // A B/L whose shipper and consignee are both blank prints empty.
    const withoutParties = rows.filter(
      (r) => blank(r.shipperContent) && blank(r.consigneeContent),
    );

    const seen = new Map();
    for (const r of rows) {
      if (r.climaxId === null) continue;
      const k = `${r.operation}|${r.climaxId}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);

    // More than one B/L on a job: the job screen shows one of them.
    const perJob = new Map();
    for (const r of rows) {
      if (!r.SEJobId) continue;
      const k = String(r.SEJobId);
      perJob.set(k, (perJob.get(k) || 0) + 1);
    }
    const jobsWithMultipleBls = [...perJob.entries()].filter(([, n]) => n > 1).length;

    // Air BLs whose typed MAWB is not in the AWB stock against their own job.
    // Those still save, but only until someone changes the MAWB - see the
    // register check in routes/jobRoutes/sea.js.
    const [[unregistered]] = await db.sequelize.query(`
      SELECT count(*)::int AS n
        FROM "Bls" b JOIN "SE_Jobs" j ON j.id = b."SEJobId"
       WHERE j.operation IN ('AE','AI')
         AND b.mbl IS NOT NULL AND btrim(b.mbl) <> ''
         AND NOT EXISTS (
               SELECT 1 FROM "Awbls" a
                WHERE a."SEJobId" = j.id
                  AND a."awbNumber" = regexp_replace(b.mbl, '[^0-9]', '', 'g'))
    `);

    res.json({
      status: 'success',
      result: {
        bls: rows.length,
        byOperation,
        migrated: rows.length - withoutClimaxId.length,
        handCreated: withoutClimaxId.length,

        // Every B/L screen opens from its job, so this one is fatal to reach.
        withoutJob: withoutJob.length,
        withoutJobSample: withoutJob.slice(0, 25).map((r) => r.hbl),

        withoutHbl: withoutHbl.length,
        // Blank on every row the old import wrote - it dropped the field.
        withoutIssuePlace: withoutIssuePlace.length,
        withoutParties: withoutParties.length,

        duplicateClimaxIds: duplicates.slice(0, 25),
        duplicateClimaxIdCount: duplicates.length,
        jobsWithMultipleBls,
        airMawbsUnregistered: unregistered.n,

        healthy: withoutJob.length === 0 && duplicates.length === 0,
        note:
          'withoutIssuePlace counts B/Ls with no place of issue. The old import wrote that '
          + 'field as IssuePlace, which the model does not declare, so Sequelize dropped it '
          + 'silently on every B/L it ever created - expect this to be high until they are '
          + 're-imported. Containers, stamps and dimensions are NOT imported by this stage '
          + 'and are not checked here.',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

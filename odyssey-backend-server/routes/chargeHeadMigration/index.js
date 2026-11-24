/**
 * Job charge-line migration - Charge_Head. Plan, apply, verify.
 *
 * UploadChargesRecv / UploadChargesPayb inside the job receivers are untouched.
 *
 *   POST /chargeHeadMigration/plan    what would happen, writes nothing
 *   POST /chargeHeadMigration/apply   one kind, one batch, one transaction
 *   GET  /chargeHeadMigration/verify  what a row count cannot see
 *
 * 103,112 lines across eight legacy tables. Depends on the Jobs stage; the
 * invoice link is left to the ledger stage - see the planner's header.
 */

const routes = require('express').Router();
const db = require('../../models');
const { SE_Job, Charge_Head, Charges, Clients } = require('../../models');
// Customs_Job.hasMany(Charge_Head) is declared in incoiceAssociations, next to
// the SE_Job link. Required here so the include below works even when nothing
// else on this request path has pulled it in.
const { Customs_Job } = require('../../functions/Associations/customsAssociations');
const { Aviation_Consignment } = require('../../functions/Associations/aviationAssociations');
require('../../functions/Associations/incoiceAssociations');
const { requireSystem } = require('../../functions/systemAccess');
const { planChargeHeads, KINDS } = require('../../functions/chargeHeadMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;
const MAX_BATCH = 5000;

function readBatch(body) {
  const kind = body?.kind;
  if (!KINDS[kind]) return null;
  if (!Array.isArray(body?.rows)) return null;
  const idSet = (arr) => new Set(
    (Array.isArray(arr) ? arr : []).map((x) => String(x)),
  );
  return {
    kind,
    rows: body.rows,
    currencies: Array.isArray(body.currencies) ? body.currencies : [],
    // Which invoice document each line sits on, from the legacy junction
    // tables. Sent with the batch because it lives in the legacy database.
    jobInvoiceIds: idSet(body.jobInvoiceIds),
    jobBillIds: idSet(body.jobBillIds),
    agentIds: idSet(body.agentIds),
  };
}

/**
 * Everything the mapper needs, in three queries rather than two per line.
 *
 * The old path ran a Charges.findOne and a Clients.findOne per charge line -
 * about 206,000 queries for 103,000 lines.
 */
/**
 * Which table holds the parent this kind attaches to, and how it is scoped.
 *
 * Freight lines hang off SE_Job, which holds all four operations in one table -
 * so a lookup must be filtered by operation or a sea-export line could attach
 * to an air-import job that happens to share a legacy id.
 *
 * Customs lines hang off Customs_Job, which holds clearing jobs only. There is
 * no operation column and nothing to disambiguate: a Log_Job id means one job.
 */
function parentFor(kind) {
  const spec = KINDS[kind];
  return spec.targetKey === 'CustomsJobId'
    ? { model: Customs_Job, where: {}, key: 'CustomsJobId' }
    : { model: SE_Job, where: { operation: spec.operation }, key: 'SEJobId' };
}

async function buildContext(kind, currencies) {
  const parent = parentFor(kind);

  const [jobs, charges, parties] = await Promise.all([
    parent.model.findAll({
      attributes: ['id', 'climaxId'],
      where: { ...parent.where, climaxId: { [db.Sequelize.Op.ne]: null } },
      raw: true,
    }),
    Charges.findAll({ attributes: ['id', 'name', 'calculationType', 'climaxId', 'code'], raw: true }),
    // types: an overseas agent's line is an agent document - see documentFor.
    Clients.findAll({ attributes: ['id', 'name', 'climaxId', 'types'], raw: true }),
  ]);

  // Charges resolve on climaxId, falling back to `code` - which held the
  // legacy id before the charge master gained a climaxId column, so a
  // catalogue imported by the old path still matches.
  const chargeMap = new Map();
  for (const c of charges) {
    if (c.climaxId !== null && c.climaxId !== undefined) chargeMap.set(String(c.climaxId), c);
  }
  for (const c of charges) {
    const k = String(c.code);
    if (c.code !== null && c.code !== undefined && !chargeMap.has(k)) chargeMap.set(k, c);
  }

  return {
    jobIdByLegacyId: new Map(jobs.map((j) => [String(j.climaxId), j.id])),
    charges: chargeMap,
    parties: new Map(
      parties.filter((p) => p.climaxId !== null && p.climaxId !== undefined)
        .map((p) => [String(p.climaxId), p]),
    ),
    currencies: new Map(
      currencies.filter((c) => c && c.Id !== null && c.Id !== undefined)
        .map((c) => [String(c.Id), c.CurrencyCode]),
    ),
  };
}

async function planFor(body) {
  const batch = readBatch(body);
  if (!batch) return null;

  // Scoped by OPERATION as well as type, because a legacy charge-line id is
  // only unique within its own source table. Sea-export payable line 100 and
  // air-export payable line 100 are different lines that both store type
  // 'Payble', so scoping on type alone makes the second one look already
  // imported - which silently dropped ~38,000 lines, almost exactly the
  // overlap between the sea and air id ranges.
  //
  // Charge_Head has no operation column, so it is resolved through the job:
  // operation + payable/receivable identifies exactly one source table.
  const spec = KINDS[batch.kind];
  const parent = parentFor(batch.kind);
  const existing = await Charge_Head.findAll({
    attributes: ['climaxId'],
    where: {
      type: spec.type,
      climaxId: { [db.Sequelize.Op.ne]: null },
    },
    // Joined to the PARENT, so a customs line is only ever compared against
    // other customs lines. Without this the two Log_Job_Charges tables would be
    // scoped against freight jobs, match nothing, and re-import on every run.
    include: [{
      model: parent.model,
      attributes: [],
      ...(Object.keys(parent.where).length ? { where: parent.where } : {}),
      required: true,
    }],
    raw: true,
  });

  return planChargeHeads(batch.rows, batch.kind, {
    existingClimaxIds: existing.map((c) => c.climaxId),
    jobInvoiceIds: batch.jobInvoiceIds,
    jobBillIds: batch.jobBillIds,
    agentIds: batch.agentIds,
    ...(await buildContext(batch.kind, batch.currencies)),
  });
}

function summarise(plan) {
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    unresolved: plan.unresolved,
    documents: plan.documents,
    problems: {
      missingId: plan.problems.missingId,
      missingJobRef: plan.problems.missingJobRef,
      duplicateClimaxIds: plan.problems.duplicateClimaxIds.slice(0, 25),
      orphaned: plan.problems.orphaned.slice(0, 25),
    },
  };
}

const BAD_BODY = {
  status: 'error',
  result: `Send { kind: <one of ${Object.keys(KINDS).join(' | ')}>, rows: [...], currencies: [...] }.`,
};

routes.post('/plan', SYSTEM, async (req, res) => {
  try {
    const plan = await planFor(req.body);
    if (!plan) return res.status(400).json(BAD_BODY);
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[charge head migration] plan failed:', error);
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
      const CHUNK = 1000;
      for (let i = 0; i < plan.toCreate.length; i += CHUNK) {
        await Charge_Head.bulkCreate(plan.toCreate.slice(i, i + CHUNK), { transaction: t });
      }
    });

    res.json({
      status: 'success',
      result: { ...summarise(plan), created: plan.toCreate.length },
    });
  } catch (error) {
    console.error('[charge head migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make.
 *
 * A charge line with no job is money floating free of the shipment that earned
 * it; one with no charge or no party is money nobody can attribute. None of
 * that shows in a count.
 */
routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const rows = await Charge_Head.findAll({
      attributes: [
        'id', 'type', 'SEJobId', 'CustomsJobId', 'AviationConsignmentId',
        'InvoiceId', 'charge', 'partyId',
        'climaxId', 'amount', 'net_amount', 'currency',
      ],
      raw: true,
    });

    const [jobs, customsJobs, consignments] = await Promise.all([
      SE_Job.findAll({ attributes: ['id'], raw: true }),
      Customs_Job.findAll({ attributes: ['id'], raw: true }),
      Aviation_Consignment.findAll({ attributes: ['id'], raw: true }),
    ]);
    const jobIds = new Set(jobs.map((j) => String(j.id)));
    const customsJobIds = new Set(customsJobs.map((j) => String(j.id)));
    const consignmentIds = new Set(consignments.map((c) => String(c.id)));

    const byType = {};
    for (const r of rows) byType[r.type || '(none)'] = (byType[r.type || '(none)'] || 0) + 1;

    /* A line is attached if ANY of its three parents resolves.
     *
     * Checking SEJobId alone reported every customs charge line as detached -
     * 143,368 of them on a clearing agent's database, where no line has an
     * SEJobId at all. CustomsJobId was added for that and AVIATION WAS LEFT
     * OUT, so the same sentence was still true one parent along: an aviation
     * charge hangs off its CONSIGNMENT, has neither job id, and was counted as
     * money with no shipment behind it on every aviation install. */
    const attached = (r) =>
      (r.SEJobId && jobIds.has(String(r.SEJobId)))
      || (r.CustomsJobId && customsJobIds.has(String(r.CustomsJobId)))
      || (r.AviationConsignmentId && consignmentIds.has(String(r.AviationConsignmentId)));
    const detached = rows.filter((r) => !attached(r));
    const withoutCharge = rows.filter((r) => !r.charge);
    const withoutParty = rows.filter((r) => !r.partyId);
    const withoutInvoice = rows.filter((r) => !r.InvoiceId);
    const withoutClimaxId = rows.filter((r) => r.climaxId === null);
    // The old import's signature: every line's amount hardcoded to 1.
    const amountIsOne = rows.filter((r) => String(r.amount) === '1').length;

    const seen = new Map();
    for (const r of rows) {
      if (r.climaxId === null) continue;
      const k = `${r.type}|${r.climaxId}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);

    const net = rows.reduce((n, r) => n + (Number(r.net_amount) || 0), 0);

    res.json({
      status: 'success',
      result: {
        chargeLines: rows.length,
        byType,
        migrated: rows.length - withoutClimaxId.length,
        handCreated: withoutClimaxId.length,

        // Money with no shipment behind it.
        detached: detached.length,
        withoutCharge: withoutCharge.length,
        withoutParty: withoutParty.length,

        // Expected to be everything until the ledger stage runs - this stage
        // deliberately does not resolve the invoice link.
        withoutInvoice: withoutInvoice.length,

        // If this is large, those rows came from the old path, which wrote a
        // literal 1 into every line's amount.
        amountIsOne,

        duplicateClimaxIds: duplicates.slice(0, 25),
        duplicateClimaxIdCount: duplicates.length,

        netAmountTotal: Math.round(net * 100) / 100,

        healthy: detached.length === 0 && duplicates.length === 0,
        note:
          'withoutInvoice is expected to equal the migrated count until the ledger stage runs - '
          + 'this stage attaches lines to jobs, not to invoices. amountIsOne counts lines whose '
          + 'amount is literally 1, which is what the old import wrote into every line it ever '
          + 'created. netAmountTotal is there to be reconciled against the legacy total; a row '
          + 'count cannot tell you the money came across intact.',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

/**
 * Direct Job E/R migration for a customs install - plan, apply, verify.
 *
 *   POST /directJobMigration/plan    what would happen, writes nothing
 *   POST /directJobMigration/apply   one batch, one transaction
 *   GET  /directJobMigration/verify  what a row count cannot see
 *
 * Legacy GL_JobDirectExpRev (+ _Charges) into Direct_Jobs and
 * Direct_Job_Association. The mapping and every rule about what is kept and
 * what is skipped is in functions/directJobMigrationPlan.js.
 *
 * Runs AFTER the ledger stage: each line is linked to the voucher that stage
 * imported (Vouchers.climaxId), and nothing is posted here.
 */

const routes = require('express').Router();
const db = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planDirectJobs } = require('../../functions/directJobMigrationPlan');
const { readOperationMode } = require('../settings');

const { Op } = db.Sequelize;
// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

// An entry and its lines arrive together; 300 entries is roughly 4,000 lines.
const MAX_BATCH = 300;

const key = (v) => (v === null || v === undefined ? '' : String(v));
const ids = (rows, field) => [...new Set(rows.map((r) => r[field]).filter((v) => v !== null && v !== undefined && v !== ''))];

// The legacy currency table spells one code wrong.
const CURRENCY_FIX = { GPB: 'GBP' };

function readBatch(body) {
  if (!Array.isArray(body?.headers) || !Array.isArray(body?.lines)) return null;
  return {
    headers: body.headers,
    lines: body.lines,
    currencies: Array.isArray(body.currencies) ? body.currencies : [],
  };
}

/** Everything the planner resolves against, read for this batch only. */
async function contextFor({ headers, lines, currencies }, transaction) {
  const companies = await db.Company.findAll({ attributes: ['id', 'short', 'climaxId'], raw: true, transaction });

  const jobs = await db.Customs_Job.findAll({
    attributes: ['id', 'jobNo', 'climaxId'],
    where: { climaxId: { [Op.in]: ids(lines, 'dLGJobId').map(String) } },
    raw: true, transaction,
  });
  const charges = await db.Charges.findAll({
    attributes: ['id', 'climaxId'],
    where: { climaxId: { [Op.in]: ids(lines, 'ChargesId').map(String) } },
    raw: true, transaction,
  });
  const vouchers = await db.Vouchers.findAll({
    attributes: ['id', 'climaxId'],
    where: { climaxId: { [Op.in]: ids(headers, 'VoucherId').map(String) } },
    raw: true, transaction,
  });
  // The accounts stage keeps the legacy GL_COA id as Child_Accounts.id.
  const accounts = await db.Child_Account.findAll({
    attributes: ['id'],
    where: { id: { [Op.in]: ids(headers, 'SettlementAccountId').map(Number) } },
    raw: true, transaction,
  });

  // Paid To is a ledger account in Odyssey (Direct_Job.belongsTo
  // Child_Account), the party's own - found through its association.
  const parties = await db.Clients.findAll({
    attributes: ['id', 'climaxId'],
    where: { climaxId: { [Op.in]: ids(headers, 'PartyId').map(String) } },
    raw: true, transaction,
  });
  const associations = parties.length
    ? await db.Client_Associations.findAll({
        attributes: ['ClientId', 'ChildAccountId'],
        where: { ClientId: { [Op.in]: parties.map((p) => p.id) } },
        raw: true, transaction,
      })
    : [];
  const accountByClient = new Map();
  for (const a of associations) {
    if (a.ChildAccountId && !accountByClient.has(key(a.ClientId))) accountByClient.set(key(a.ClientId), a.ChildAccountId);
  }

  const companyShortByLegacyId = new Map(companies.filter((c) => c.climaxId !== null).map((c) => [key(c.climaxId), c.short]));
  const candidates = headers
    .map((h) => {
      const short = companyShortByLegacyId.get(key(h.SubCompanyId));
      return short && h.TranNumber ? `${short}-${String(h.TranNumber).trim()}` : null;
    })
    .filter(Boolean);
  const existing = candidates.length
    ? await db.Direct_Job.findAll({ attributes: ['Entry_No'], where: { Entry_No: { [Op.in]: candidates } }, raw: true, transaction })
    : [];

  return {
    companyShortByLegacyId,
    currencyByLegacyId: new Map(currencies.map((c) => {
      const code = String(c.CurrencyCode || '').trim().toUpperCase();
      return [key(c.Id), CURRENCY_FIX[code] || code];
    })),
    jobByLegacyId: new Map(jobs.map((j) => [key(j.climaxId), { id: j.id, jobNo: j.jobNo }])),
    chargeByLegacyId: new Map(charges.map((c) => [key(c.climaxId), c.id])),
    voucherByLegacyId: new Map(vouchers.map((v) => [key(v.climaxId), v.id])),
    accountIds: new Set(accounts.map((a) => a.id)),
    partyAccountByLegacyId: new Map(parties
      .filter((p) => accountByClient.has(key(p.id)))
      .map((p) => [key(p.climaxId), accountByClient.get(key(p.id))])),
    existingEntryNos: new Set(existing.map((e) => e.Entry_No)),
  };
}

function summarise(plan) {
  const sample = (list) => list.slice(0, 25);
  const p = plan.problems;
  return {
    stats: plan.stats,
    problems: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { count: v.length, sample: sample(v) }])),
  };
}

// Customs only: the lines attach through CustomsJobId, and on any other
// install there are no clearing jobs to attach them to.
async function refuseUnlessCustoms(res) {
  const mode = await readOperationMode();
  if (mode === 'customs') return false;
  res.status(409).json({
    status: 'error',
    result: `Direct Job E/R migration is for a customs install; this one is in ${mode || 'no'} mode.`,
  });
  return true;
}

// 'adjustment' is a value added to an existing Postgres enum, which the boot
// sync never does. Checked before writing so the stage says what to run
// rather than failing on the first Adjust entry.
async function hasAdjustmentSubType(transaction) {
  const [rows] = await db.sequelize.query(`
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'enum_Direct_Jobs_SubType' AND e.enumlabel = 'adjustment'`, { transaction });
  return rows.length > 0;
}

const BAD_BODY = {
  status: 'error',
  result: 'Send { headers: [...], lines: [...], currencies: [...] } - a page of '
    + 'GL_JobDirectExpRev with its GL_JobDirectExpRev_Charges, as /jobs/getDirectExpRev returns it.',
};

routes.post('/plan', SYSTEM, async (req, res) => {
  try {
    if (await refuseUnlessCustoms(res)) return;
    const batch = readBatch(req.body);
    if (!batch) return res.status(400).json(BAD_BODY);
    const plan = planDirectJobs(batch.headers, batch.lines, await contextFor(batch));
    res.json({ status: 'success', result: { ...summarise(plan), created: 0 } });
  } catch (error) {
    console.error('[direct job migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/apply', SYSTEM, async (req, res) => {
  try {
    if (await refuseUnlessCustoms(res)) return;
    const batch = readBatch(req.body);
    if (!batch) return res.status(400).json(BAD_BODY);
    if (batch.headers.length > MAX_BATCH) {
      return res.status(413).json({
        status: 'error',
        result: `Batch of ${batch.headers.length} entries exceeds the ${MAX_BATCH}-entry limit.`,
      });
    }

    let plan;
    await db.sequelize.transaction(async (t) => {
      plan = planDirectJobs(batch.headers, batch.lines, await contextFor(batch, t));
      if (!plan.toCreate.length) return;

      if (plan.toCreate.some((c) => c.entry.SubType === 'adjustment') && !(await hasAdjustmentSubType(t))) {
        const err = new Error(
          'The Direct Job sub-type "adjustment" is not in this database yet. Run '
          + 'cl-deploy/direct-job-adjustment-subtype.sql against it, then run this stage again.',
        );
        err.status = 409;
        throw err;
      }

      // silent: the legacy dates are kept rather than stamped with today.
      const created = await db.Direct_Job.bulkCreate(plan.toCreate.map((c) => c.entry), {
        transaction: t, silent: true, returning: true,
      });
      const idByEntryNo = new Map(created.map((e) => [e.Entry_No, e.id]));

      const lines = [];
      for (const c of plan.toCreate) {
        const entryId = idByEntryNo.get(c.entry.Entry_No);
        for (const l of c.lines) {
          lines.push({ ...l, Direct_Job_Id: entryId, createdAt: c.entry.createdAt, updatedAt: c.entry.updatedAt });
        }
      }
      for (let i = 0; i < lines.length; i += 1000) {
        await db.Direct_Job_Association.bulkCreate(lines.slice(i, i + 1000), { transaction: t, silent: true });
      }
    });

    res.json({
      status: 'success',
      result: { ...summarise(plan), created: plan.toCreate.length, createdLines: plan.stats.entryLines },
    });
  } catch (error) {
    console.error('[direct job migration] apply failed:', error);
    res.status(error.status || 500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make: lines attached to no job, and entries
 * whose lines no longer add up to the voucher they point at - which would
 * mean the document and the books disagree.
 */
routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const [[counts]] = await db.sequelize.query(`
      SELECT (SELECT count(*)::int FROM "Direct_Jobs") AS entries,
             (SELECT count(*)::int FROM "Direct_Jobs" WHERE "Entry_No" LIKE '%-JER-%') AS migrated,
             (SELECT count(*)::int FROM "Direct_Job_Association") AS lines,
             (SELECT count(*)::int FROM "Direct_Job_Association"
               WHERE "Job_Id" IS NULL AND "CustomsJobId" IS NULL AND "AviationJobId" IS NULL) AS "linesWithoutJob"`);

    const [mismatched] = await db.sequelize.query(`
      WITH e AS (
        SELECT a."Voucher_Id" AS v, min(d."Entry_No") AS "entryNo",
               sum(a."Amount" * COALESCE(NULLIF(a."Ex_Rate", 0), 1)) AS lines
          FROM "Direct_Job_Association" a JOIN "Direct_Jobs" d ON d.id = a."Direct_Job_Id"
         WHERE d."Entry_No" LIKE '%-JER-%'
         GROUP BY a."Voucher_Id"),
      h AS (
        SELECT "VoucherId" AS v,
               sum(CASE WHEN type = 'debit' THEN COALESCE(NULLIF(btrim(amount), ''), '0')::numeric ELSE 0 END) AS debit
          FROM "Voucher_Heads" WHERE "VoucherId" IN (SELECT v FROM e)
         GROUP BY "VoucherId")
      SELECT e."entryNo", round(e.lines, 2) AS lines, round(h.debit, 2) AS voucher
        FROM e JOIN h USING (v)
       WHERE abs(e.lines - h.debit) > 1
       ORDER BY e."entryNo"`);

    res.json({
      status: 'success',
      result: {
        ...counts,
        notMatchingVoucher: mismatched.length,
        notMatchingVoucherSample: mismatched.slice(0, 25),
        healthy: mismatched.length === 0,
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

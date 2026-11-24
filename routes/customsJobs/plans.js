// THE PROGRAM BOOK - planned customs jobs (Customs_Plan).
//
// Mounted under /customsJob/plans by ./index.js. A plan is one row of the
// client's shipping program, kept WITHOUT a job number; the confirmed ones are
// moved to the jobs list, where each becomes a Customs_Job and is numbered.
//
//   GET  /get      the company's book, every plan, with its job if moved
//   POST /save     the rows the screen changed or added, all or nothing
//   POST /delete   plans nobody wants any more - never a moved one
//   POST /move     confirmed plans -> numbered jobs, all or nothing
//
// The rules - status, what may be moved, what a row may write, what job a
// plan becomes - are functions/customsPlan, where they are tested.
//
// A MOVED PLAN IS FROZEN. Its job is the record from then on, and every write
// here refuses it, naming the job, rather than half-applying a change the job
// would never see.
//
// BEHIND A SWITCH: Configuration > Customs > Job planning. Off, every route
// here refuses; the plans are kept for when it is turned back on.
const routes = require('express').Router();
const moment = require('moment');
const db = require('../../models');
const {
  Customs_Job, Customs_Container, Customs_Plan,
} = require('../../functions/Associations/customsAssociations');
const { Clients } = require('../../functions/Associations/clientAssociation');
const { readCustomsPlanning, readCustomsStatuses } = require('../settings');
const { startOf } = require('../../functions/customsStatuses');
const { companyShort, isCompanyId, realCompanyId } = require('../../functions/companyCodes');
const { resolveSelectedFiscalYear } = require('../../functions/Associations/fiscalYearAssociations');
const {
  readNumbering, lastInYear, nextAfter, perCompany, formatNumber, codeFor,
} = require('../../functions/documentNumber');
const { createHistory } = require('../../functions/history');
// A client over its credit limit cannot be put on a job - functions/creditControl.
const { blockOnPick } = require('../../functions/creditControl/blocks');
const {
  stateOf, moveRefusal, describePlan, PlanError, planValues, isBlankPlan, jobFromPlan, planStates,
} = require('../../functions/customsPlan');

const OFF = 'Job planning is turned off. An admin can turn it on in Configuration > Customs.';
const NO_COMPANY = 'Pick your company at the top of the screen first - a plan belongs to a company, '
  + 'as the job it becomes does.';

const asId = (v) => {
  const s = String(v ?? '').trim();
  return /^[0-9]+$/.test(s) ? Number(s) : null;
};
const asIds = (list) => [...new Set((Array.isArray(list) ? list : []).map(asId).filter(Boolean))];

/** A refusal that is about the data's state, not the request's shape. */
const conflict = (message) => Object.assign(new PlanError(message), { status: 409 });

const fail = (res, error) => {
  if (error instanceof PlanError) {
    return res.status(error.status || 400).json({ status: 'error', result: error.message });
  }
  console.error(error);
  return res.status(500).json({ status: 'error', result: error?.message || String(error) });
};

routes.use(async (req, res, next) => {
  try {
    if (await readCustomsPlanning()) return next();
    return res.status(403).json({ status: 'error', result: OFF });
  } catch (e) {
    return fail(res, e);
  }
});

const partyAttrs = ['id', 'name', 'code'];
const planInclude = [
  { model: Clients, as: 'shipper', attributes: partyAttrs, required: false },
  { model: Clients, as: 'shippingLine', attributes: partyAttrs, required: false },
  // The job a moved plan became. Its presence is what freezes the plan; its
  // status is what the book shows for it from then on.
  { model: Customs_Job, attributes: ['id', 'jobNo', 'canceled', 'status'], required: false },
];

/**
 * The company's book, in the order it was written - the sheet's S NO order.
 * Every plan comes back; the screen filters by state, and counts come from all
 * of them so each filter says how many it would show.
 */
routes.get('/get', async (req, res) => {
  try {
    if (!isCompanyId(req.headers.companyid)) {
      return res.json({ status: 'success', result: [], counts: {}, noCompany: true });
    }
    const rows = await Customs_Plan.findAll({
      where: { companyId: String(req.headers.companyid).trim() },
      include: planInclude,
      order: [['id', 'ASC']],
    });
    const list = (await readCustomsStatuses()).plan;
    const counts = Object.fromEntries(planStates(list).map((s) => [s, 0]));
    for (const r of rows) counts[stateOf(r, list)] = (counts[stateOf(r, list)] || 0) + 1;
    return res.json({ status: 'success', result: rows, counts });
  } catch (e) {
    return fail(res, e);
  }
});

/** The moved plans among `plans`, refused by the job each became. */
const frozenRefusal = async (plans, verb, transaction) => {
  const moved = plans.filter((p) => p.CustomsJobId);
  if (!moved.length) return null;
  const jobs = await Customs_Job.findAll({
    where: { id: moved.map((p) => p.CustomsJobId) }, attributes: ['id', 'jobNo'], transaction,
  });
  const jobNo = (p) => jobs.find((j) => j.id === p.CustomsJobId)?.jobNo || 'a job';
  return conflict(
    `${moved.map((p) => jobNo(p)).join(', ')} ${moved.length === 1 ? 'is' : 'are'} on the jobs list now, `
    + `so ${moved.length === 1 ? 'its plan' : 'their plans'} cannot be ${verb} - change the job instead.`,
  );
};

/**
 * Save the rows the screen sends: an `id` updates that plan, none creates one.
 * A row with nothing on it is an Add Row nobody filled, and is skipped.
 *
 * ALL OR NOTHING, and every row is checked before any is written - a book
 * half-saved is worse than one refused, because the screen can no longer say
 * which of its rows are on the server. A refusal names the row by the number
 * the screen shows (`rowNo`).
 */
routes.post('/save', async (req, res) => {
  try {
    const companyId = await realCompanyId(req.body.companyId);
    if (!companyId) throw new PlanError(NO_COMPANY);
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const statuses = (await readCustomsStatuses()).plan;

    const prepared = rows.map((row, i) => {
      const label = `Row ${row?.rowNo ?? i + 1}`;
      try {
        return { id: asId(row?.id), blank: isBlankPlan(row), values: planValues(row, statuses), label };
      } catch (e) {
        if (e instanceof PlanError) throw new PlanError(`${label}: ${e.message}`);
        throw e;
      }
    }).filter((r) => r.id || !r.blank);

    const ids = prepared.filter((r) => r.id).map((r) => r.id);
    const result = await db.sequelize.transaction(async (transaction) => {
      const existing = ids.length
        ? await Customs_Plan.findAll({ where: { id: ids }, transaction, lock: transaction.LOCK.UPDATE })
        : [];
      const missing = prepared.filter((r) => r.id && !existing.some((p) => p.id === r.id
        && String(p.companyId) === companyId));
      if (missing.length) {
        throw conflict(`${missing.map((r) => r.label).join(', ')} ${missing.length === 1 ? 'is' : 'are'} `
          + 'no longer in this company\'s book - reload it and try again.');
      }
      const frozen = await frozenRefusal(existing, 'changed', transaction);
      if (frozen) throw frozen;

      let created = 0;
      let updated = 0;
      for (const r of prepared) {
        if (r.id) {
          await existing.find((p) => p.id === r.id).update(r.values, { transaction });
          updated += 1;
        } else {
          await Customs_Plan.create({ ...r.values, companyId }, { transaction });
          created += 1;
        }
      }
      return { created, updated };
    });
    return res.json({ status: 'success', result });
  } catch (e) {
    return fail(res, e);
  }
});

/** Delete plans. Never a moved one - it is the record of where its job came from. */
routes.post('/delete', async (req, res) => {
  try {
    const companyId = await realCompanyId(req.body.companyId);
    if (!companyId) throw new PlanError(NO_COMPANY);
    const ids = asIds(req.body.ids);
    if (!ids.length) throw new PlanError('Tick the plans to delete.');
    const plans = await Customs_Plan.findAll({ where: { id: ids, companyId } });
    if (plans.length !== ids.length) {
      throw conflict('Some of those plans are no longer in this company\'s book - reload it and try again.');
    }
    const frozen = await frozenRefusal(plans, 'deleted');
    if (frozen) throw frozen;
    await Customs_Plan.destroy({ where: { id: ids, companyId } });
    return res.json({ status: 'success', result: { deleted: ids.length } });
  } catch (e) {
    return fail(res, e);
  }
});

/**
 * Move confirmed plans to the jobs list: each becomes a Customs_Job, numbered
 * as /customsJob/create numbers one, with its container rows, and the plan
 * points at it from then on.
 *
 * ALL OR NOTHING. Every ticked plan is checked first, and one that may not be
 * moved - not confirmed, cancelled, already moved - refuses the whole move,
 * naming each, so the user is never left working out which of a batch went.
 * The plans are locked for the transaction, so two people pressing Move on the
 * same rows cannot make two jobs of one shipment.
 *
 * Numbered in the book's order (S NO), so jobs taken together read in the
 * order they were planned.
 */
routes.post('/move', async (req, res) => {
  try {
    const companyId = await realCompanyId(req.body.companyId);
    if (!companyId) throw new PlanError(NO_COMPANY);
    const ids = asIds(req.body.ids);
    if (!ids.length) throw new PlanError('Tick the confirmed plans to move to the jobs list.');

    // No year picked, or a locked one, is the user's to fix - not a server fault.
    const fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId)
      .catch((e) => { throw new PlanError(e.message); });
    const company = await companyShort(companyId);
    const numbering = await readNumbering();
    const today = moment().format('YYYY-MM-DD');
    const statuses = await readCustomsStatuses();
    const jobStatus = startOf(statuses.job);

    // A moved plan's shipper is its job's CLIENT - and a client over its
    // credit limit is not put on a new job without approval. Checked before
    // anything moves, so the whole batch is refused, as the other refusals are.
    const shipperIds = [...new Set((await Customs_Plan.findAll({
      where: { id: ids, companyId }, attributes: ['shipperId'], raw: true,
    })).map((p) => p.shipperId).filter(Boolean))];
    const overLimit = [];
    for (const clientId of shipperIds) {
      const block = await blockOnPick({ clientId, req });
      if (block) overLimit.push(block.name);
    }
    if (overLimit.length) {
      throw conflict(`Nothing was moved. Over the credit limit, so not a client on a new job until approved: ${overLimit.join(', ')}. Ask for approval by picking the party as the client on a job.`);
    }

    const moved = await db.sequelize.transaction(async (transaction) => {
      const plans = await Customs_Plan.findAll({
        where: { id: ids, companyId }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE,
      });
      if (plans.length !== ids.length) {
        throw conflict('Some of the ticked plans are no longer in this company\'s book - reload it and try again.');
      }
      // Names for the messages: the shipper, and the job a moved plan became.
      const shippers = await Clients.findAll({
        where: { id: plans.map((p) => p.shipperId).filter(Boolean) }, attributes: partyAttrs, transaction,
      });
      const jobs = await Customs_Job.findAll({
        where: { id: plans.map((p) => p.CustomsJobId).filter(Boolean) }, attributes: ['id', 'jobNo'], transaction,
      });
      const refusals = plans.map((p) => {
        const why = moveRefusal(p, jobs.find((j) => j.id === p.CustomsJobId)?.jobNo, statuses.plan);
        if (!why) return null;
        const named = { ...p.get(), shipper: shippers.find((s) => s.id === p.shipperId) };
        return `${describePlan(named)}: ${why}`;
      }).filter(Boolean);
      if (refusals.length) throw conflict(`Nothing was moved. ${refusals.join(' ')}`);

      const out = [];
      for (const plan of plans) {
        const last = await lastInYear(Customs_Job, {
          seqCol: 'jobId',
          noCol: 'jobNo',
          suffix: fiscalYear.suffix,
          company: { column: 'companyId', id: companyId },
          scoped: perCompany(numbering, 'jobs'),
          transaction,
        });
        const jobId = nextAfter(last, 'jobId');
        const { values, containers } = jobFromPlan(plan, { today, jobStatus });
        const job = await Customs_Job.create({
          ...values,
          jobId,
          jobNo: formatNumber(numbering, {
            klass: 'jobs', company, code: codeFor(numbering, 'jobs', 'CC'), seq: jobId, suffix: fiscalYear.suffix,
          }),
          companyId,
          FiscalYearId: fiscalYear.id,
        }, { transaction });
        if (containers.length) {
          await Customs_Container.bulkCreate(
            containers.map((c) => ({ ...c, CustomsJobId: job.id })), { transaction },
          );
        }
        await plan.update({ CustomsJobId: job.id, movedAt: new Date() }, { transaction });
        out.push({ planId: plan.id, jobId: job.id, jobNo: job.jobNo });
      }
      return out;
    });

    for (const x of moved) createHistory(req.body.employeeId, 'Customs Job', 'Create', x.jobNo);
    return res.json({ status: 'success', result: moved });
  } catch (e) {
    return fail(res, e);
  }
});

module.exports = routes;

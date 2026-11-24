/* WHEN A CUSTOMS JOB'S STATUS CHANGED - writes models/Customs_Job_Status.
 *
 * Hooked on the model, not the routes: the job's status is set by bulk
 * Customs_Job.update calls in five places (save, unlocked save, reopen,
 * cancel...) and a create, and a route added later should not have to
 * remember. After any save that sets `status`, each job it touched gets a row
 * if its status is not the one last recorded for it.
 *
 * Best effort: a failure to log is reported and swallowed - the job's own save
 * has happened and must not be undone by its history.
 */
const { getRequestUserId } = require('./fiscalYearContext');

async function whoSaved(db, transaction) {
  const id = getRequestUserId && getRequestUserId();
  if (!id) return null;
  const p = await db.Employees.findByPk(id, { attributes: ['name', 'username'], raw: true, transaction });
  return (p && (p.name || p.username)) || null;
}

async function record(db, jobs, transaction) {
  if (!jobs.length) return;
  const Log = db.Customs_Job_Status;
  const by = await whoSaved(db, transaction);
  const now = new Date();
  for (const job of jobs) {
    if (!job.status) continue;
    const last = await Log.findOne({
      where: { CustomsJobId: job.id }, order: [['changedOn', 'DESC'], ['id', 'DESC']],
      attributes: ['status'], raw: true, transaction,
    });
    if (last && last.status === job.status) continue;
    await Log.create({ CustomsJobId: job.id, status: job.status, changedOn: now, changedBy: by }, { transaction });
  }
}

const safely = (fn) => async (...args) => {
  try { await fn(...args); } catch (err) { console.error('[customsStatusLog] not recorded:', err.message); }
};

function registerCustomsStatusLog(db) {
  const Job = db.Customs_Job;
  if (!Job || !db.Customs_Job_Status) return;

  Job.addHook('afterCreate', safely(async (job, options) => {
    await record(db, [{ id: job.id, status: job.status }], options.transaction);
  }));

  Job.addHook('afterUpdate', safely(async (job, options) => {
    if (!(options.fields || []).includes('status')) return;
    await record(db, [{ id: job.id, status: job.status }], options.transaction);
  }));

  Job.addHook('afterBulkUpdate', safely(async (options) => {
    if (!options.attributes || !('status' in options.attributes)) return;
    const jobs = await Job.findAll({ where: options.where, attributes: ['id', 'status'], raw: true, transaction: options.transaction });
    await record(db, jobs, options.transaction);
  }));
}

module.exports = { registerCustomsStatusLog };

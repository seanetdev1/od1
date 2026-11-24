/* A job that runs once a day at a set time - claimed so it runs ONCE.
 *
 * `npm start` runs a worker per core and each one ticks, so a run is CLAIMED
 * first: in one transaction, under a Postgres advisory TRANSACTION lock (a
 * session lock taken through a pool is released on whatever connection the
 * pool hands out next), the day is written to the job's state row - and only
 * the caller that wrote it runs. Claimed before the run, not after, so a run
 * that fails half way is not repeated every minute.
 *
 * The same scheme as functions/creditControl/scheduler, for jobs after it.
 */
const db = require('../models');
const { partsIn } = require('./creditControl/clock');

const readState = async (stateKey, transaction) => {
  const row = await db.AppSetting.findOne({ where: { key: stateKey }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  let state = {};
  try { state = row?.value ? JSON.parse(row.value) : {}; } catch (_) { state = {}; }
  return { row, state };
};

const writeState = async (stateKey, row, state, transaction) => {
  const value = JSON.stringify(state);
  if (row) await row.update({ value }, { transaction });
  else await db.AppSetting.create({ key: stateKey, value }, { transaction });
};

/** Take `kind`'s run for `date`. True for the one caller that took it. */
const claimRun = ({ stateKey, lockKey, kind, date }) => db.sequelize.transaction(async (transaction) => {
  const [[{ locked }]] = await db.sequelize.query(`SELECT pg_try_advisory_xact_lock(${Number(lockKey)}) AS locked`, { transaction });
  if (!locked) return false;
  const { row, state } = await readState(stateKey, transaction);
  if (state[kind] === date) return false;
  await writeState(stateKey, row, { ...state, [kind]: date }, transaction);
  return true;
});

/** Switched on, or its time moved, after today's time: today's counts as done. */
const markPassed = ({ stateKey, kind, time, timeZone, now = new Date() }) => db.sequelize.transaction(async (transaction) => {
  const local = partsIn(now, timeZone);
  if (local.time < time) return;
  const { row, state } = await readState(stateKey, transaction);
  await writeState(stateKey, row, { ...state, [kind]: local.date }, transaction);
});

const readRunState = async (stateKey) => (await readState(stateKey)).state;

/** A short log in AppSettings, newest first. */
const readRunLog = async (logKey) => {
  try {
    const row = await db.AppSetting.findOne({ where: { key: logKey } });
    const list = row?.value ? JSON.parse(row.value) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
};
const appendRunLog = async (logKey, entry, size = 40) => {
  const value = JSON.stringify([entry, ...(await readRunLog(logKey))].slice(0, size));
  const row = await db.AppSetting.findOne({ where: { key: logKey } });
  if (row) await row.update({ value });
  else await db.AppSetting.create({ key: logKey, value });
};

module.exports = { claimRun, markPassed, readRunState, readRunLog, appendRunLog };

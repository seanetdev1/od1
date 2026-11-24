/* CREDIT CONTROL - when the runs happen: the daily check at its time, the
 * weekly report on its day at its time, in the install's time zone (Config >
 * Credit Control; 9am and Monday 9am by default).
 *
 * A tick every minute asks "is a run due and not done today?". Due means the
 * time has come TODAY - a server that was down at 9 runs at 10 when it comes
 * back, but a day it was down altogether is not made up.
 *
 * ONCE, ACROSS WORKERS AND RESTARTS. `npm start` runs a worker per core, and
 * each one ticks. A run is CLAIMED first: in one transaction, under a Postgres
 * advisory lock that is released with it, the day is written to
 * creditControlState - and only the worker that wrote it runs. The lock is a
 * transaction lock on purpose: a session lock (pg_try_advisory_lock) taken
 * through a connection pool is released on whatever connection the pool hands
 * out next, which may not be the one that holds it.
 *
 * Claimed before the run, not after: a run that fails half way is logged and
 * not repeated every minute until the end of the day, sending the half it did
 * send over and over.
 */
const db = require('../../models');
const { readSettings } = require('./settings');
const { partsIn } = require('./clock');

const STATE_KEY = 'creditControlState';
const LOCK_KEY = 4915041; // see functions/taskEscalation for its neighbour
const TICK_MS = 60 * 1000;

let timer = null;

const readState = async (transaction) => {
  const row = await db.AppSetting.findOne({ where: { key: STATE_KEY }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  let state = {};
  try { state = row?.value ? JSON.parse(row.value) : {}; } catch (_) { state = {}; }
  return { row, state };
};

const writeState = async (row, state, transaction) => {
  const value = JSON.stringify(state);
  if (row) await row.update({ value }, { transaction });
  else await db.AppSetting.create({ key: STATE_KEY, value }, { transaction });
};

/** Mark `kind`'s run for `date` as taken. True for the one caller that took it. */
async function claim(kind, date) {
  return db.sequelize.transaction(async (transaction) => {
    const [[{ locked }]] = await db.sequelize.query(`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`, { transaction });
    if (!locked) return false;
    const { row, state } = await readState(transaction);
    if (state[kind] === date) return false;
    await writeState(row, { ...state, [kind]: date }, transaction);
    return true;
  });
}

/**
 * Turning credit control on (or moving a time) after today's time has passed
 * must not fire at once: the first run is the next one due. Called by the
 * settings save.
 */
async function markPassedRuns(settings, now = new Date()) {
  const local = partsIn(now, settings.timeZone);
  await db.sequelize.transaction(async (transaction) => {
    const { row, state } = await readState(transaction);
    const next = { ...state };
    if (local.time >= settings.daily.time) next.daily = local.date;
    if (local.weekday === settings.weekly.day && local.time >= settings.weekly.time) next.weekly = local.date;
    await writeState(row, next, transaction);
  });
}

const readRunState = async () => (await readState()).state;

/** One minute's question. Exported for tests and for a by-hand nudge. */
async function tick(now = new Date(), { run = require('./runner') } = {}) {
  const settings = await readSettings();
  if (!settings.enabled) return { daily: false, weekly: false };
  const local = partsIn(now, settings.timeZone);
  const out = { daily: false, weekly: false };

  if (settings.daily.enabled && local.time >= settings.daily.time && await claim('daily', local.date)) {
    out.daily = true;
    await run.runDaily({ mode: 'send', now, settings, trigger: 'schedule' })
      .catch((err) => run.appendLog({ kind: 'daily', mode: 'send', trigger: 'schedule', at: new Date().toISOString(), date: local.date, error: err.message }).catch(() => {}));
  }
  if (settings.weekly.enabled && local.weekday === settings.weekly.day && local.time >= settings.weekly.time && await claim('weekly', local.date)) {
    out.weekly = true;
    await run.runWeekly({ mode: 'send', now, settings, trigger: 'schedule' })
      .catch((err) => run.appendLog({ kind: 'weekly', mode: 'send', trigger: 'schedule', at: new Date().toISOString(), date: local.date, error: err.message }).catch(() => {}));
  }
  return out;
}

/** Start ticking. Safe from every worker - see the claim above. Never throws. */
function start({ intervalMs = TICK_MS } = {}) {
  if (timer) return timer;
  if (process.env.ODYSSEY_CREDIT_CONTROL === 'off') {
    console.log('[credit] credit control runs disabled (ODYSSEY_CREDIT_CONTROL=off)');
    return null;
  }
  const safeTick = () => tick().catch((err) => console.error('[credit] tick failed:', err.message));
  timer = setInterval(safeTick, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { tick, claim, markPassedRuns, readRunState, start, stop, STATE_KEY };

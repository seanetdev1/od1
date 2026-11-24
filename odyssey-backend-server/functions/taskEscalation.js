/**
 * Make the deadlines mean something.
 *
 * Storing a soft and a hard deadline and never acting on either is how a field
 * stops being filled in: it costs the manager effort and produces nothing. This
 * sweep gives each one a consequence.
 *
 *   soft deadline passed  -> nudge the assignee
 *   hard deadline passed  -> tell the assignee AND whoever assigned it
 *
 * Notified once, not once per sweep: Tasks.softNotifiedAt / hardNotifiedAt are
 * stamped when the notification is created, and the query skips anything
 * already stamped. Without that a task a week overdue would generate a
 * notification every ten minutes until someone closed it, and people would
 * learn to ignore the notification bell entirely.
 *
 * FIRING EXACTLY ONCE ACROSS WORKERS
 *
 * `npm start` forks one worker per core and every one of them loads this file.
 * A plain setInterval would run the sweep seven times concurrently, and seven
 * transactions would each read the same un-stamped rows before any of them
 * committed - seven identical notifications per overdue task. That is the same
 * shape of bug that produced seven admin accounts on first boot.
 *
 * A Postgres advisory lock serialises it: whichever worker gets the lock does
 * the sweep, the rest return immediately. It is released in a finally, and by
 * Postgres anyway if the connection drops mid-sweep.
 */

const { Op } = require('sequelize');
const db = require('../models');

// Unique to this job. Different from the seeding lock in functions/seedAdmin.
const SWEEP_LOCK_KEY = 4915038;

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;   // ten minutes

let timer = null;

/** Notify one person about a task. Best effort - never throws into the sweep. */
async function notify({ Notifications, recipientId, subType, message, taskId, transaction }) {
  if (!recipientId) return false;
  await Notifications.create({
    type: 'Task',
    subType,
    notification: message,
    recordId: String(taskId),
    recipientId,
    opened: '0',
  }, { transaction });
  return true;
}

/**
 * One pass. Exported separately from the timer so a test can run it directly
 * and so it can be triggered by hand from a route.
 *
 * @returns {{ ran: boolean, soft: number, hard: number }}
 */
async function sweep({ now = new Date() } = {}) {
  const { sequelize, Tasks, Employees } = db;
  const { Notifications } = require('./Associations/NotificationAssociation');
  const { ACTIVE_STATUSES } = require('./taskRules');

  const [[{ locked }]] = await sequelize.query(
    `SELECT pg_try_advisory_lock(${SWEEP_LOCK_KEY}) AS locked`
  );
  if (!locked) return { ran: false, soft: 0, hard: 0 };

  let soft = 0;
  let hard = 0;

  try {
    const stillOpen = {
      [Op.or]: [{ status: { [Op.in]: ACTIVE_STATUSES } }, { status: null }],
    };

    // --- hard deadline first ------------------------------------------------
    // Deliberately before the soft pass: a task that blew through both since
    // the last sweep should escalate, not merely nudge. The soft query then
    // skips it because the hard pass stamped softNotifiedAt too.
    const overdue = await Tasks.findAll({
      where: {
        ...stillOpen,
        hardDeadline: { [Op.ne]: null, [Op.lt]: now },
        hardNotifiedAt: null,
      },
      limit: 500,
    });

    for (const task of overdue) {
      await sequelize.transaction(async (t) => {
        const label = `"${task.title}" passed its hard deadline`;
        if (await notify({ Notifications, recipientId: task.EmployeeId, subType: 'overdue', message: label, taskId: task.id, transaction: t })) hard++;

        // And the person who assigned it. assignedBy holds a username, not an
        // id - the column predates this feature - so it has to be looked up.
        if (task.assignedBy) {
          const assigner = await Employees.findOne({
            where: { username: task.assignedBy }, attributes: ['id'], transaction: t,
          });
          if (assigner && String(assigner.id) !== String(task.EmployeeId)) {
            await notify({
              Notifications, recipientId: assigner.id, subType: 'overdue',
              message: `${label} (assigned to someone on your team)`,
              taskId: task.id, transaction: t,
            });
          }
        }

        // Stamp both: an overdue task does not also need a soft nudge.
        await task.update(
          { hardNotifiedAt: now, softNotifiedAt: task.softNotifiedAt || now },
          { transaction: t }
        );
      });
    }

    // --- soft deadline ------------------------------------------------------
    const due = await Tasks.findAll({
      where: {
        ...stillOpen,
        softDeadline: { [Op.ne]: null, [Op.lt]: now },
        softNotifiedAt: null,
      },
      limit: 500,
    });

    for (const task of due) {
      await sequelize.transaction(async (t) => {
        if (await notify({
          Notifications, recipientId: task.EmployeeId, subType: 'due',
          message: `"${task.title}" has passed its soft deadline`,
          taskId: task.id, transaction: t,
        })) soft++;
        await task.update({ softNotifiedAt: now }, { transaction: t });
      });
    }

    if (soft || hard) {
      console.log(`[tasks] escalation: ${hard} overdue, ${soft} due`);
    }
    return { ran: true, soft, hard };
  } finally {
    await sequelize.query(`SELECT pg_advisory_unlock(${SWEEP_LOCK_KEY})`);
  }
}

/**
 * Start the periodic sweep. Safe to call from every worker - the lock decides
 * which one actually does the work.
 *
 * Never throws: a failing sweep must not take the server down, and it will be
 * retried on the next tick anyway.
 */
function start({ intervalMs = Number(process.env.ODYSSEY_TASK_SWEEP_MS) || DEFAULT_INTERVAL_MS } = {}) {
  if (timer) return timer;
  if (process.env.ODYSSEY_TASK_SWEEP === 'off') {
    console.log('[tasks] deadline escalation disabled (ODYSSEY_TASK_SWEEP=off)');
    return null;
  }

  const tick = () => sweep().catch((err) =>
    console.error('[tasks] escalation sweep failed:', err.message)
  );

  timer = setInterval(tick, intervalMs);
  // Do not hold the process open for a background job.
  if (timer.unref) timer.unref();

  // A first pass shortly after boot rather than immediately: let the schema
  // sync and the licence client settle first.
  setTimeout(tick, 30 * 1000).unref?.();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { sweep, start, stop, SWEEP_LOCK_KEY, DEFAULT_INTERVAL_MS };

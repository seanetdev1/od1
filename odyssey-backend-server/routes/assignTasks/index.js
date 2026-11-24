const { Employees } = require("../../functions/Associations/employeeAssociations");
const { AssignTask } = require("../../models");
const { Tasks, Sub_Tasks, Task_Attachments, Task_Logs } = require("../../functions/Associations/taskAssociation");
const rules = require("../../functions/taskRules");
const { Notifications } = require("../../functions/Associations/NotificationAssociation");
const { sequelize } = require("../../models");
const requireDesignation = require("../../functions/requireDesignation");
const attachments = require("../../functions/attachmentStore");
const routes = require('express').Router();
const Sequelize = require('sequelize');
const { Op } = Sequelize;

/**
 * Who can create, reassign or delete a task.
 *
 * Nothing here was gated before: any authenticated user could create a task,
 * reassign someone else's, or change its status. Managers and above only.
 * Reading your OWN tasks stays open to everyone - that is the point of the
 * feature.
 */
const MANAGER = requireDesignation(['manager', 'CEO', 'CFO', 'admin']);

/** Designations that do not get a task list on their dashboard. */
const EXCLUDED_FROM_DASHBOARD = ['ceo', 'cfo', 'admin'];

// The vocabulary lives in functions/taskRules.js so the API and the recurrence
// logic cannot disagree about what "Done" means.
const { ACTIVE_STATUSES } = rules;

/**
 * Write one history row.
 *
 * Best effort in the sense that it shares the caller's transaction and is
 * therefore rolled back with it - but a failure to log must not lose the
 * change itself, so it is not allowed to throw.
 */
async function log({ taskId, action, field, from, to, actor, note, transaction }) {
  try {
    await Task_Logs.create({
      TaskId: taskId,
      action,
      field: field || null,
      fromValue: from === undefined || from === null ? null : String(from),
      toValue: to === undefined || to === null ? null : String(to),
      // Name captured now: the employee may be renamed or removed later and
      // the history should still read correctly.
      actorName: actor?.username || null,
      actorId: actor?.id || null,
      note: note || null,
    }, { transaction });
  } catch (err) {
    console.error('[tasks] could not write history row:', err.message);
  }
}

/**
 * Tell someone they have been assigned a task.
 *
 * Best-effort: a task that saved but whose notification failed is a smaller
 * problem than a task that would not save because the notification did. The
 * caller passes its transaction so the notification is rolled back with the
 * task if the task itself fails.
 */
async function notifyAssignee({ task, assigneeId, actor, transaction }) {
  if (!assigneeId) return;
  try {
    await Notifications.create({
      type: 'Task',
      subType: 'assigned',
      notification: `${actor || 'A manager'} assigned you: ${task.title}`,
      recordId: String(task.id),
      recipientId: assigneeId,
      opened: '0',
      createdById: actor && actor.id ? actor.id : null,
    }, { transaction });
  } catch (err) {
    console.error('[tasks] could not create assignment notification:', err.message);
  }
}

/**
 * Create the next instance of a recurring task.
 *
 * Deadlines move forward by one interval from the ORIGINAL dates, not from
 * today - a monthly task completed three days late should still be due on the
 * same day next month, otherwise the schedule drifts a little further every
 * cycle until a "monthly" task lands anywhere in the month.
 *
 * Returns the new task, or null when there is nothing to create.
 */
async function createNextOccurrence(task, actor, transaction) {
  const recurrence = rules.normaliseRecurrence(task.recurrence);
  if (!recurrence || recurrence === 'none') return null;

  const nextSoft = rules.nextOccurrence(task.softDeadline, recurrence);
  const nextHard = rules.nextOccurrence(task.hardDeadline, recurrence);

  // A recurring task with no deadline at all has nothing to advance, and would
  // otherwise clone itself forever the moment anyone closed it.
  if (!nextSoft && !nextHard) return null;

  // Stop when the series has run out.
  const until = task.recurrenceUntil ? new Date(task.recurrenceUntil) : null;
  const anchorDate = nextHard || nextSoft;
  if (until && anchorDate > until) return null;

  const next = await Tasks.create({
    title: task.title,
    description: task.description,
    category: task.category,
    status: 'Backlog',
    priority: task.priority,
    softDeadline: nextSoft,
    hardDeadline: nextHard,
    requestedBy: task.requestedBy,
    assignedBy: task.assignedBy,
    EmployeeId: task.EmployeeId,
    recurrence,
    recurrenceUntil: task.recurrenceUntil,
    parentTaskId: task.id,
  }, { transaction });

  // Subtasks come along, reset to not-done - they are the checklist for the
  // new occurrence, not a record of the old one.
  const subTasks = await Sub_Tasks.findAll({ where: { TaskId: task.id }, transaction });
  if (subTasks.length) {
    await Sub_Tasks.bulkCreate(
      subTasks.map((x) => ({ title: x.title, status: '0', TaskId: next.id })),
      { transaction }
    );
  }

  await log({
    taskId: next.id, action: 'recurrence', from: task.id, to: next.id,
    actor, transaction, note: `generated from the previous ${recurrence} occurrence`,
  });
  await log({
    taskId: task.id, action: 'recurrence', to: next.id,
    actor, transaction, note: 'next occurrence created',
  });

  await notifyAssignee({ task: next, assigneeId: next.EmployeeId, actor: actor && actor.username, transaction });
  return next;
}

/** Normalise a date coming from a form: '' and 'null' are not dates. */
function asDate(value) {
  if (value === undefined || value === null || value === '' || value === 'null') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Old Zahida Work
routes.post('/createTask', MANAGER, async (req, res) =>{
    try {
        const result = await AssignTask.create(req.body).catch((x)=>console.log(x))
        res.json({status:"success", result: result})
    }
    catch (error) {
        res.status(500).json({status:'error', result:error});
    }
})

/**
 * Create a task, its subtasks and its attachments, and notify the assignee.
 *
 * All in one transaction: a task whose attachments did not save, or whose
 * assignee was never told, is worse than a create that failed cleanly and can
 * be retried. Files are written to disk first and unlinked if the transaction
 * rolls back - the reverse order would leave rows pointing at nothing.
 */
routes.post('/create', MANAGER, async (req, res) =>{
    const written = [];
    try {
        const body = req.body || {};
        if (!body.title || !String(body.title).trim()) {
            return res.status(400).json({ status: 'error', result: 'A task needs a title.' });
        }

        // Reject an unknown status rather than storing it. A free string meant
        // one typo ("done", "Complete") dropped the task out of every active
        // list silently - it looked like the task had vanished.
        const status = body.status === undefined ? 'Backlog' : rules.normaliseStatus(body.status);
        if (status === null) {
            return res.status(400).json({
                status: 'error',
                result: `Unknown status "${body.status}". Use one of: ${rules.STATUSES.join(', ')}.`,
            });
        }

        const priority = body.priority === undefined || body.priority === null || body.priority === ''
            ? null : rules.normalisePriority(body.priority);
        if (body.priority && priority === null) {
            return res.status(400).json({
                status: 'error',
                result: `Unknown priority "${body.priority}". Use one of: ${rules.PRIORITIES.join(', ')}.`,
            });
        }

        const recurrence = rules.normaliseRecurrence(body.recurrence);
        if (recurrence === null) {
            return res.status(400).json({
                status: 'error',
                result: `Unknown recurrence "${body.recurrence}". Use one of: ${rules.RECURRENCES.join(', ')}.`,
            });
        }

        const incoming = Array.isArray(body.attachments) ? body.attachments : [];
        for (const file of incoming) {
            written.push(await attachments.save(file));
        }

        const result = await sequelize.transaction(async (t) => {
            const task = await Tasks.create({
                title: body.title,
                description: body.description || null,
                category: body.category || null,
                status,
                priority,
                recurrence,
                recurrenceUntil: asDate(body.recurrenceUntil),
                parentTaskId: body.parentTaskId || null,
                softDeadline: asDate(body.softDeadline),
                hardDeadline: asDate(body.hardDeadline),
                requestedBy: body.requestedBy || null,
                assignedBy: req.user && req.user.username ? req.user.username : body.assignedBy || null,
                EmployeeId: body.EmployeeId || body.assignedTo || null,
            }, { transaction: t });

            const subTasks = Array.isArray(body.subTasks) ? body.subTasks : [];
            if (subTasks.length) {
                await Sub_Tasks.bulkCreate(
                    subTasks.map((x) => ({ ...x, TaskId: task.id })),
                    { transaction: t }
                );
            }

            if (written.length) {
                await Task_Attachments.bulkCreate(
                    written.map((f) => ({
                        ...f,
                        TaskId: task.id,
                        uploadedBy: req.user ? req.user.username : null,
                    })),
                    { transaction: t }
                );
            }

            await log({
                taskId: task.id, action: 'created', to: task.title,
                actor: req.user, transaction: t,
                note: recurrence && recurrence !== 'none' ? `repeats ${recurrence}` : null,
            });

            await notifyAssignee({
                task,
                assigneeId: task.EmployeeId,
                actor: req.user && req.user.username,
                transaction: t,
            });

            return task;
        });

        res.json({ status:"success", result });
    }
    catch (error) {
        // The transaction rolled back, so remove the files it would have
        // referenced rather than leaving them orphaned on the volume.
        for (const f of written) await attachments.remove(f.storedName);
        console.error('[tasks] create failed:', error);
        res.status(500).json({status:'error', result: error.message || error});
    }
});

routes.post('/edit', MANAGER, async (req, res) =>{
    try {
        const task = req.body.task;
        if (!task || !task.id) {
            return res.status(400).json({ status: 'error', result: 'No task id given.' });
        }

        const before = await Tasks.findByPk(task.id);
        if (!before) return res.status(404).json({ status: 'error', result: 'Task not found.' });

        await sequelize.transaction(async (t) => {
            await Tasks.update({
                title: task.title,
                description: task.description,
                category: task.category,
                status: task.status,
                priority: task.priority,
                softDeadline: asDate(task.softDeadline),
                hardDeadline: asDate(task.hardDeadline),
                requestedBy: task.requestedBy,
                EmployeeId: task.EmployeeId ?? task.assignedTo ?? before.EmployeeId,
            }, { where: { id: task.id }, transaction: t });

            if (Array.isArray(req.body.deleteList) && req.body.deleteList.length) {
                await Sub_Tasks.destroy({ where: { id: req.body.deleteList }, transaction: t });
            }

            // for...of, not forEach: forEach ignores the promises and the
            // handler used to respond before these had run.
            for (const x of (task.subTasks || [])) {
                await Sub_Tasks.upsert({ ...x, TaskId: task.id }, { transaction: t });
            }

            // Record what actually changed, field by field, so the history
            // answers "what did this look like before" and not just "edited".
            for (const field of ['title', 'description', 'priority', 'category', 'status']) {
                if (task[field] !== undefined && String(task[field] ?? '') !== String(before[field] ?? '')) {
                    await log({
                        taskId: task.id, action: 'edited', field,
                        from: before[field], to: task[field], actor: req.user, transaction: t,
                    });
                }
            }
            for (const field of ['softDeadline', 'hardDeadline']) {
                const now = asDate(task[field]);
                const was = before[field];
                if (String(now ?? '') !== String(was ?? '')) {
                    await log({
                        taskId: task.id, action: 'edited', field,
                        from: was, to: now, actor: req.user, transaction: t,
                    });
                }
            }

            // Reassigned to someone new - tell them.
            const newAssignee = task.EmployeeId ?? task.assignedTo;
            if (newAssignee && String(newAssignee) !== String(before.EmployeeId)) {
                await log({
                    taskId: task.id, action: 'reassigned', field: 'EmployeeId',
                    from: before.EmployeeId, to: newAssignee, actor: req.user, transaction: t,
                });
                await notifyAssignee({
                    task: { id: task.id, title: task.title || before.title },
                    assigneeId: newAssignee,
                    actor: req.user && req.user.username,
                    transaction: t,
                });
            }
        });

        res.json({ status:"success" });
    }
    catch (error) {
        console.error('[tasks] edit failed:', error);
        res.status(500).json({status:'error', result: error.message || error});
    }
});

/**
 * Change a task's status.
 *
 * Open to the assignee as well as managers - the person doing the work is the
 * one who knows it is done. Anyone else gets 403.
 */
routes.post('/changeTaskStatus', async (req, res) =>{
    try {
        const task = await Tasks.findByPk(req.body.id);
        if (!task) return res.status(404).json({ status: 'error', result: 'Task not found.' });

        const designation = (req.user?.designation || '').toLowerCase();
        const isManager = ['manager', 'ceo', 'cfo', 'admin'].includes(designation);
        const isAssignee = req.user && String(task.EmployeeId) === String(req.user.id);

        if (!isManager && !isAssignee) {
            return res.status(403).json({
                status: 'error',
                result: 'Only the assignee or a manager can change this task.',
            });
        }

        const next = rules.normaliseStatus(req.body.status);
        if (next === null) {
            return res.status(400).json({
                status: 'error',
                result: `Unknown status "${req.body.status}". Use one of: ${rules.STATUSES.join(', ')}.`,
            });
        }

        const previous = task.status;
        let recurred = null;

        await sequelize.transaction(async (t) => {
            await Tasks.update({ status: next }, { where: { id: task.id }, transaction: t });
            await log({
                taskId: task.id, action: 'status', field: 'status',
                from: previous, to: next, actor: req.user, transaction: t,
            });

            // Completing a recurring task creates the next one, rather than a
            // scheduler generating a year of them up front - a list full of
            // future work nobody can start yet is noise, not planning.
            if (rules.isDone(next) && !rules.isDone(previous)) {
                recurred = await createNextOccurrence(task, req.user, t);
            }
        });

        res.json({ status:"success", result: recurred ? { nextTaskId: recurred.id } : undefined });
    }
    catch (error) {
        res.status(500).json({status:'error', result: error.message || error});
    }
});

/** Every task. Managers only - this is the oversight view. */
routes.get('/getAllTasks', MANAGER, async (req, res) =>{
    try {
        const result = await Tasks.findAll({
            include:[
                { model: Sub_Tasks },
                { model: Task_Attachments, attributes: ['id', 'originalName', 'mimeType', 'size'] },
                { model: Employees, attributes: ['id', 'name'] },
            ],
            order: [['hardDeadline', 'ASC NULLS LAST'], ['createdAt', 'DESC']],
        });
        res.json({ status:"success", result });
    }
    catch (error) {
        res.status(500).json({status:'error', result: error.message || error});
    }
});

/**
 * The signed-in user's own tasks.
 *
 * Reads the id from the verified token, NOT from a header. It used to take
 * `req.headers.id`, which the client sets - so any user could read anyone
 * else's tasks by changing one value.
 */
routes.get('/getAssignedTasks', async (req, res) =>{
    try {
        const where = { EmployeeId: req.user.id };
        if (String(req.query.activeOnly) === '1') {
            where.status = { [Op.or]: [{ [Op.in]: ACTIVE_STATUSES }, { [Op.is]: null }] };
        }

        const result = await Tasks.findAll({
            include:[
                { model: Sub_Tasks },
                { model: Task_Attachments, attributes: ['id', 'originalName', 'mimeType', 'size'] },
            ],
            where,
            // Soonest hard deadline first; tasks without one sort last.
            order: [['hardDeadline', 'ASC NULLS LAST'], ['softDeadline', 'ASC NULLS LAST'], ['createdAt', 'DESC']],
        });
        res.json({ status:"success", result });
    }
    catch (error) {
        res.status(500).json({status:'error', result: error.message || error});
    }
});

/**
 * What the dashboard widget asks for: this user's active tasks, or an explicit
 * signal that they should not be shown a list at all.
 *
 * The exclusion is decided here rather than in the UI so it cannot be bypassed
 * by calling the API directly, and so the rule lives in one place.
 */
routes.get('/dashboard', async (req, res) => {
    try {
        const designation = (req.user?.designation || '').toLowerCase();
        if (EXCLUDED_FROM_DASHBOARD.includes(designation)) {
            return res.json({ status: 'success', result: { show: false, tasks: [] } });
        }

        const tasks = await Tasks.findAll({
            where: {
                EmployeeId: req.user.id,
                [Op.or]: [{ status: { [Op.in]: ACTIVE_STATUSES } }, { status: null }],
            },
            include: [{ model: Sub_Tasks, attributes: ['id', 'title', 'status'] }],
            order: [['hardDeadline', 'ASC NULLS LAST'], ['softDeadline', 'ASC NULLS LAST']],
            limit: 50,
        });

        res.json({ status: 'success', result: { show: true, tasks } });
    } catch (error) {
        res.status(500).json({ status: 'error', result: error.message || error });
    }
});

routes.post('/toggleSubTask', async (req, res) =>{
    try {
        const sub = await Sub_Tasks.findByPk(req.body.id, { include: [{ model: Tasks }] });
        if (!sub) return res.status(404).json({ status: 'error', result: 'Subtask not found.' });

        const designation = (req.user?.designation || '').toLowerCase();
        const isManager = ['manager', 'ceo', 'cfo', 'admin'].includes(designation);
        const isAssignee = req.user && String(sub.Task?.EmployeeId) === String(req.user.id);
        if (!isManager && !isAssignee) {
            return res.status(403).json({ status: 'error', result: 'Not your task.' });
        }

        const result = await Sub_Tasks.update({status:req.body.status}, { where:{ id:req.body.id }} );
        res.json({ status:"success", result });
    }
    catch (error) {
        res.status(500).json({status:'error', result: error.message || error});
    }
});

routes.get('/getEmployeeTask', async (req, res) =>{
    try {
        // Own records only, from the token - this also used to trust a header.
        const result = await AssignTask.findAll({where : {EmployeeId : req.user.id},
            include: [{
                model: Employees,
                as: 'assignedBy',
                attributes: ['name']
            }]
        })
        res.json({result: result})
    }
    catch (error) {
        res.status(500).json({status:'error', result: error.message || error});
    }
})

/**
 * Who a task can be assigned to.
 *
 * The task screen used /employeeRoutes/getEmployees to fill its "Assign To"
 * dropdown, and that route is CEO/CFO/admin only - so a manager could open the
 * page and create tasks but got a 403 loading the list of people to assign
 * them to. The page fell over on open.
 *
 * Widening getEmployees was the wrong fix: it returns whole employee records,
 * including CNIC, address and bank details, and a manager has no business
 * reading those to pick a name from a list. This returns the three fields the
 * dropdown actually shows, to exactly the designations that may assign work.
 */
routes.get('/assignees', MANAGER, async (req, res) => {
    try {
        const result = await Employees.findAll({
            where: { active: '1' },
            attributes: ['id', 'name', 'designation'],
            order: [['name', 'ASC']],
        });
        res.json({ status: 'success', result });
    } catch (error) {
        res.status(500).json({ status: 'error', result: error.message || error });
    }
});

/**
 * A task's history, oldest first.
 *
 * Visible to the assignee and to managers - the same rule as the task itself.
 */
routes.get('/:id/history', async (req, res) => {
    try {
        const access = await canAccessTask(req, req.params.id);
        if (!access.ok) return res.status(access.code).json({ status: 'error', result: access.message });

        const result = await Task_Logs.findAll({
            where: { TaskId: req.params.id },
            order: [['createdAt', 'ASC']],
        });
        res.json({ status: 'success', result });
    } catch (error) {
        res.status(500).json({ status: 'error', result: error.message || error });
    }
});

/**
 * Run the deadline sweep by hand.
 *
 * It runs on a timer anyway; this exists so the behaviour can be demonstrated
 * and tested without waiting ten minutes. Admin only - it writes notifications.
 */
routes.post('/runEscalation', requireDesignation(['admin']), async (req, res) => {
    try {
        const result = await require('../../functions/taskEscalation').sweep();
        res.json({ status: 'success', result });
    } catch (error) {
        res.status(500).json({ status: 'error', result: error.message || error });
    }
});

/* ------------------------------------------------------------------ *
 * Attachments
 * ------------------------------------------------------------------ */

/** Can this user see this task at all? */
async function canAccessTask(req, taskId) {
    const task = await Tasks.findByPk(taskId);
    if (!task) return { ok: false, code: 404, message: 'Task not found.' };
    const designation = (req.user?.designation || '').toLowerCase();
    const isManager = ['manager', 'ceo', 'cfo', 'admin'].includes(designation);
    const isAssignee = req.user && String(task.EmployeeId) === String(req.user.id);
    if (!isManager && !isAssignee) return { ok: false, code: 403, message: 'Not your task.' };
    return { ok: true, task };
}

/** Add files to an existing task. */
routes.post('/:id/attachments', async (req, res) => {
    const written = [];
    try {
        const access = await canAccessTask(req, req.params.id);
        if (!access.ok) return res.status(access.code).json({ status: 'error', result: access.message });

        const incoming = Array.isArray(req.body.attachments) ? req.body.attachments : [];
        if (!incoming.length) {
            return res.status(400).json({ status: 'error', result: 'No files given.' });
        }

        for (const file of incoming) written.push(await attachments.save(file));

        const rows = await Task_Attachments.bulkCreate(
            written.map((f) => ({ ...f, TaskId: req.params.id, uploadedBy: req.user?.username || null }))
        );
        res.json({ status: 'success', result: rows });
    } catch (error) {
        for (const f of written) await attachments.remove(f.storedName);
        res.status(400).json({ status: 'error', result: error.message || error });
    }
});

/** Download one. */
routes.get('/attachments/:attachmentId', async (req, res) => {
    try {
        const row = await Task_Attachments.findByPk(req.params.attachmentId);
        if (!row) return res.status(404).json({ status: 'error', result: 'Attachment not found.' });

        const access = await canAccessTask(req, row.TaskId);
        if (!access.ok) return res.status(access.code).json({ status: 'error', result: access.message });

        const buf = await attachments.read(row.storedName);
        res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
        // The name is sanitised on the way in, so it cannot break out of this
        // header - but encode it anyway for non-ASCII filenames.
        res.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(row.originalName)}`
        );
        res.send(buf);
    } catch (error) {
        // A row whose file is gone from disk - say so plainly rather than 500.
        if (error.code === 'ENOENT') {
            return res.status(410).json({
                status: 'error',
                result: 'The file for this attachment is missing from storage.',
            });
        }
        res.status(500).json({ status: 'error', result: error.message || error });
    }
});

/** Remove one. Managers only - an assignee should not be able to destroy evidence. */
routes.post('/attachments/:attachmentId/delete', MANAGER, async (req, res) => {
    try {
        const row = await Task_Attachments.findByPk(req.params.attachmentId);
        if (!row) return res.status(404).json({ status: 'error', result: 'Attachment not found.' });

        await row.destroy();
        await attachments.remove(row.storedName);
        res.json({ status: 'success' });
    } catch (error) {
        res.status(500).json({ status: 'error', result: error.message || error });
    }
});

/** Delete a task and everything hanging off it, including files on disk. */
routes.post('/delete', MANAGER, async (req, res) => {
    try {
        const task = await Tasks.findByPk(req.body.id, { include: [{ model: Task_Attachments }] });
        if (!task) return res.status(404).json({ status: 'error', result: 'Task not found.' });

        const files = (task.Task_Attachments || []).map((a) => a.storedName);
        await sequelize.transaction(async (t) => {
            await Sub_Tasks.destroy({ where: { TaskId: task.id }, transaction: t });
            await Task_Attachments.destroy({ where: { TaskId: task.id }, transaction: t });
            await Tasks.destroy({ where: { id: task.id }, transaction: t });
        });

        // Only after the rows are definitely gone: an unlinked file whose row
        // survived would be a broken download forever.
        for (const name of files) await attachments.remove(name);
        res.json({ status: 'success' });
    } catch (error) {
        res.status(500).json({ status: 'error', result: error.message || error });
    }
});

module.exports = routes

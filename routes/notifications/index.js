const {Notifications } = require('../../functions/Associations/NotificationAssociation')
const { Employees } = require("../../functions/Associations/employeeAssociations");
const routes = require('express').Router();
const Sequelize = require('sequelize');
const { Op } = Sequelize;

/**
 * Notifications are either broadcast or addressed.
 *
 * recipientId null  - everyone sees it. This is what every notification was
 *                     until tasks needed to tell ONE person something, and it
 *                     is how the accounts feed still works.
 * recipientId set   - only that employee sees it.
 *
 * Read state is still a single `opened` column on the row, which is correct
 * for an addressed notification and wrong for a broadcast one: marking a
 * broadcast read marks it read for everybody. Left as it was rather than
 * changed underneath the existing accounts feed - see the note on
 * /updateNotification below.
 */

routes.post('/sendNotification', async(req, res) => {
   try {
    const result =  await Notifications.create(req.body.data)
    res.json({ status: "success", result:result})
   }
   catch (err) {
    res.status(500).json({status:"error", result:err.message})
   }
})

/**
 * The signed-in user's feed: everything addressed to them, plus broadcasts.
 *
 * This used to return the newest 20 rows to everyone with no filtering at all,
 * so an addressed notification would have been visible to the whole company.
 */
routes.get('/getAllNotifications', async(req, res) => {
    try {
        const result =  await Notifications.findAll({
            where: {
                [Op.or]: [
                    { recipientId: null },
                    { recipientId: req.user.id },
                ],
            },
            include: [{model: Employees, as : "createdBy", attributes : ['name']}],
            limit:20,
            order:[["createdAt", "DESC"]],
        })
        res.json({ status: "success", result:result})
    }
    catch (err) {
        res.status(500).json({status:"error", result:err.message})
    }
})

/** Unread count for this user, for a badge. */
routes.get('/unreadCount', async (req, res) => {
    try {
        const count = await Notifications.count({
            where: {
                opened: { [Op.or]: [{ [Op.ne]: '1' }, { [Op.is]: null }] },
                [Op.or]: [{ recipientId: null }, { recipientId: req.user.id }],
            },
        });
        res.json({ status: 'success', result: { count } });
    } catch (err) {
        res.status(500).json({ status: 'error', result: err.message });
    }
});

/**
 * NEW JOB ALERTS - asked once a minute by every open screen (functions/
 * newJobAlerts has the rules). ?freight=&customs=&aviation= is where the
 * screen got to; none sent = a first ask, which only sets the starting point.
 *   { subscribed: false }                      this designation is not picked
 *   { subscribed: true, cursor, jobs: [...] }  jobs since, and the next cursor
 */
routes.get('/newJobs', async (req, res) => {
    try {
        const db = require('../../models');
        const alerts = require('../../functions/newJobAlerts');
        const { grantsFor } = require('../../functions/permissions/grants');
        const grants = await grantsFor(req.user.id);
        if (!alerts.subscribed(grants.designation, await alerts.readSetting())) {
            return res.json({ status: 'success', result: { subscribed: false } });
        }
        const cursor = alerts.readCursor(req.query);
        if (!cursor) {
            return res.json({ status: 'success', result: { subscribed: true, cursor: await alerts.startingPoint(db), jobs: [] } });
        }
        const me = await Employees.findByPk(req.user.id, { attributes: ['name', 'username'], raw: true });
        const result = await alerts.jobsSince(db, cursor, {
            // null = every company (no restriction set) - functions/companyAccess.
            companies: req.allowedCompanies || null,
            me: me?.name || me?.username || '',
        });
        res.json({ status: 'success', result: { subscribed: true, ...result } });
    } catch (err) {
        res.status(500).json({ status: 'error', result: err.message });
    }
});

/**
 * THE BELL'S ALERTS - Critical, Job Charges, Invoices Due, worked out now for
 * this user (functions/bellAlerts has the rules). Each list: { count, items }.
 */
routes.get('/alerts', async (req, res) => {
    try {
        const { alertsFor } = require('../../functions/bellAlerts');
        res.json({ status: 'success', result: await alertsFor(req) });
    } catch (err) {
        res.status(500).json({ status: 'error', result: err.message });
    }
});

/**
 * Mark one notification read, by id.
 *
 * /updateNotification below marks read by subType, which updates every row
 * sharing that subType - across all users. That is why this exists; prefer it.
 */
routes.post('/markRead', async (req, res) => {
    try {
        const row = await Notifications.findByPk(req.body.id);
        if (!row) return res.status(404).json({ status: 'error', result: 'Notification not found.' });
        if (row.recipientId && String(row.recipientId) !== String(req.user.id)) {
            return res.status(403).json({ status: 'error', result: 'Not your notification.' });
        }
        await row.update({ opened: '1' });
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ status: 'error', result: err.message });
    }
});

/**
 * Mark read by subType.
 *
 * Kept for the existing accounts feed, which calls it. Note that it updates
 * every row with that subType regardless of who it belongs to - it is scoped
 * here to this user's own rows and broadcasts so it can no longer mark another
 * employee's notifications read.
 */
routes.post('/updateNotification', async(req, res) => {
    try {
     const result =  await Notifications.update(
        { opened : req.body.data.opened },
        { where : {
            subType : req.body.data.subType,
            [Op.or]: [{ recipientId: null }, { recipientId: req.user.id }],
        }}
     )
     res.json({ status: "success", result:result})
    }
    catch (err) {
     res.status(500).json({status:"error", result:err.message})
    }
 })

module.exports = routes

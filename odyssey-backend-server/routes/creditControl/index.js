/* CREDIT CONTROL - functions/creditControl has the rules; this is who may do
 * what with them.
 *
 *   any signed-in user  which parties are blocked; check one on a pick; ask
 *                       for one to be unblocked
 *   an approver         (Config: CEO / CFO by default) the requests, the
 *                       blocked and flagged parties, unblocking, omitting
 *                       invoices
 *   System (Config)     the settings, running a check by hand, the run log
 */
const routes = require('express').Router();
const db = require('../../models');
const { requireSystem, isSystem } = require('../../functions/systemAccess');
const { createHistory } = require('../../functions/history');
const settingsFns = require('../../functions/creditControl/settings');
const { localDate, addDays } = require('../../functions/creditControl/clock');
const { evaluateDaily, position } = require('../../functions/creditControl/rules');
const { loadOpenBalances, clientsWithLimits, employeesOf, addressesOf } = require('../../functions/creditControl/data');
const { isApprover, blocking, holds, blockOnPick } = require('../../functions/creditControl/blocks');
const { runDaily, runWeekly, readLog } = require('../../functions/creditControl/runner');
const { markPassedRuns, readRunState } = require('../../functions/creditControl/scheduler');
const { esc, ddmmyyyy, money } = require('../../functions/creditControl/mail');

const { readSettings, writeSettings, SettingsError, DESIGNATIONS, WEEKDAYS } = settingsFns;

const fail = (res, error) => {
  const status = error?.status || 500;
  if (status === 500) console.error(error);
  return res.status(status).json({ status: 'error', result: error?.message || String(error) });
};

class Refused extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** Approvers, and System - who set this up and may need to see it work. */
const approverOnly = async (req, res, next) => {
  try {
    const settings = await readSettings();
    if (isApprover(req, settings) || isSystem(req)) { req.creditSettings = settings; return next(); }
    return res.status(403).json({ status: 'error', result: `Only ${settings.approvers.map((d) => d.toUpperCase()).join(' / ')} can do this.` });
  } catch (e) {
    return fail(res, e);
  }
};

const asId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** An approval's end: the date given (end of that day), or the configured days on. */
const approvalEnd = (until, settings, now = new Date()) => {
  const today = localDate(now, settings.timeZone);
  const day = until && /^\d{4}-\d{2}-\d{2}$/.test(String(until)) ? String(until) : addDays(today, settings.block.approvalDays);
  if (day < today) throw new Refused('An approval cannot end before today.');
  // The end of that day in the install's zone - Asia/Karachi has no DST, and
  // any other zone is near enough for "until the end of the day".
  const offsetMs = new Date(new Date().toLocaleString('en-US', { timeZone: settings.timeZone })).getTime() - new Date(new Date().toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return new Date(Date.parse(`${day}T23:59:59.000Z`) - offsetMs);
};

const notify = async ({ recipientId, subType, message, recordId }) => {
  if (!recipientId) return;
  const { Notifications } = require('../../functions/Associations/NotificationAssociation');
  await Notifications.create({ type: 'Credit', subType, notification: message, recordId: String(recordId), recipientId, opened: '0' }).catch(() => {});
};

/** Best effort: an approval request or decision by email, when mail is set up. */
const mailTo = async (addresses, subject, html) => {
  if (!addresses.length) return;
  try {
    const { readEmailConfig, isComplete } = require('../../functions/emailConfig');
    const cfg = await readEmailConfig();
    if (!isComplete(cfg)) return;
    await require('../../functions/mailer').sendMail({
      fromName: cfg.fromName || 'Odyssey', fromEmail: cfg.fromEmail || cfg.user, to: addresses.join(', '), subject, html,
    });
  } catch (e) {
    console.error('[credit] email failed:', e.message);
  }
};

const clientLabel = (c) => `${c?.name || 'Party'}${c?.code ? ` (${c.code})` : ''}`;

// ------------------------------------------------------------ any signed-in user

/** The parties a job may not take as its client right now - for the pickers. */
routes.get('/blocked', async (req, res) => {
  try {
    const settings = await readSettings();
    const approver = isApprover(req, settings);
    if (!blocking(settings)) return res.json({ status: 'success', result: { active: false, approver, blocked: [], requested: [] } });
    const now = new Date();
    const rows = await db.Credit_Block.findAll({ where: { active: true }, raw: true });
    const blocked = rows.filter((b) => holds(b, now))
      .map((b) => ({ clientId: b.ClientId, balancePkr: Number(b.balancePkr), limitPkr: Number(b.limitPkr), blockedAt: b.blockedAt }));
    const mine = req.user?.id ? await db.Credit_Unblock_Request.findAll({
      where: { requestedById: req.user.id, status: 'pending' }, attributes: ['ClientId'], raw: true,
    }) : [];
    res.json({ status: 'success', result: { active: true, approver, blocked, requested: [...new Set(mine.map((r) => r.ClientId))] } });
  } catch (e) { fail(res, e); }
});

/** Picking a party as a job's client - checked now, not on last night's figures. */
routes.post('/check', async (req, res) => {
  try {
    const clientId = asId(req.body?.clientId);
    if (!clientId) throw new Refused('Which party?');
    const settings = await readSettings();
    const block = await blockOnPick({ clientId, req, settings });
    const pending = block && req.user?.id ? await db.Credit_Unblock_Request.findOne({
      where: { ClientId: clientId, requestedById: req.user.id, status: 'pending' }, attributes: ['id', 'createdAt'],
    }) : null;
    res.json({ status: 'success', result: { block, approver: isApprover(req, settings), requested: pending ? { id: pending.id, at: pending.createdAt } : null } });
  } catch (e) { fail(res, e); }
});

/** Ask for a blocked party to be let onto jobs. */
routes.post('/requestUnblock', async (req, res) => {
  try {
    const clientId = asId(req.body?.clientId);
    if (!clientId) throw new Refused('Which party?');
    const note = String(req.body?.note || '').trim().slice(0, 2000);
    const settings = await readSettings();
    const block = await blockOnPick({ clientId, req, settings });
    if (!block) return res.json({ status: 'success', result: { notBlocked: true } });

    const existing = await db.Credit_Unblock_Request.findOne({ where: { ClientId: clientId, requestedById: req.user?.id || null, status: 'pending' } });
    if (existing) {
      if (note) await existing.update({ note: [existing.note, note].filter(Boolean).join('\n') });
      return res.json({ status: 'success', result: { id: existing.id, already: true } });
    }
    const request = await db.Credit_Unblock_Request.create({ ClientId: clientId, requestedById: req.user?.id || null, note: note || null });

    const who = req.user?.id ? await db.Employees.findByPk(req.user.id, { attributes: ['name'] }) : null;
    const text = `${who?.name || 'Someone'} asks to use ${clientLabel(block)} on a job - it owes PKR ${money(block.balancePkr)} against a limit of PKR ${money(block.limitPkr)}.${note ? ` "${note}"` : ''}`;
    const approvers = await employeesOf(settings.approvers);
    for (const a of approvers) await notify({ recipientId: a.id, subType: 'unblockRequest', message: text, recordId: request.id });
    await mailTo(addressesOf(approvers), `Credit approval asked: ${clientLabel(block)}`,
      `<div style="font-family:Arial,sans-serif;font-size:13px"><p>${esc(text)}</p><p>Approve or reject it in Odyssey: <b>Accounts &gt; Credit Control</b>.</p></div>`);
    createHistory(req.user?.id || req.body?.employeeId, 'Credit Control', 'Unblock asked', block.name);
    res.json({ status: 'success', result: { id: request.id } });
  } catch (e) { fail(res, e); }
});

// ------------------------------------------------------------------ approvers

/** Everything the Credit Control screen opens with. */
routes.get('/overview', approverOnly, async (req, res) => {
  try {
    const settings = req.creditSettings;
    const now = new Date();
    const clients = await clientsWithLimits();
    const { invoicesByClient, billsByClient } = await loadOpenBalances({ settings, clientIds: clients.map((c) => c.id), now });
    const evaluated = evaluateDaily({ clients, invoicesByClient, billsByClient });
    const blocks = await db.Credit_Block.findAll({
      include: [{ model: db.Clients, attributes: ['id', 'name', 'code', 'creditLimitAmount'] }, { model: db.Employees, as: 'approvedBy', attributes: ['name'] }],
      order: [['updatedAt', 'DESC']],
    });
    const blockOf = new Map(blocks.map((b) => [b.ClientId, b]));
    const pending = await db.Credit_Unblock_Request.count({ where: { status: 'pending' } });
    const omitted = await db.Credit_Omission.count();
    res.json({
      status: 'success',
      result: {
        settings: { enabled: settings.enabled, blocking: blocking(settings), approvalDays: settings.block.approvalDays, timeZone: settings.timeZone },
        today: localDate(now, settings.timeZone),
        pending, omitted,
        flagged: evaluated.map((e) => {
          const b = blockOf.get(e.client.id);
          return {
            clientId: e.client.id, name: e.client.name, code: e.client.code,
            creditLimitDays: e.client.creditLimitDays, limitPkr: e.limitPkr, over: e.over,
            // balancePkr is the NET the limit is checked against.
            receivablePkr: e.receivablePkr, payablePkr: e.payablePkr, balancePkr: e.balancePkr,
            overdue: e.overdue.length, oldest: e.overdue[0]?.ageDays ?? null,
            salesRepId: e.client.salesRepresentatorId || null,
            blocked: Boolean(b?.active), approvedUntil: b?.active ? b.approvedUntil : null,
          };
        }),
        blocks: blocks.filter((b) => b.active).map((b) => ({
          clientId: b.ClientId, name: b.Client?.name, code: b.Client?.code, balancePkr: Number(b.balancePkr), limitPkr: Number(b.limitPkr),
          blockedAt: b.blockedAt, checkedAt: b.checkedAt, approvedUntil: b.approvedUntil, approvedBy: b.approvedBy?.name || null,
          holding: holds(b, now),
        })),
      },
    });
  } catch (e) { fail(res, e); }
});

routes.get('/requests', approverOnly, async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
    const rows = await db.Credit_Unblock_Request.findAll({
      where: status ? { status } : {},
      include: [
        { model: db.Clients, attributes: ['id', 'name', 'code', 'creditLimitAmount'] },
        { model: db.Employees, as: 'requestedBy', attributes: ['id', 'name'] },
        { model: db.Employees, as: 'decidedBy', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: 200,
    });
    res.json({ status: 'success', result: rows });
  } catch (e) { fail(res, e); }
});

/** Let a blocked party onto jobs until a date - the `request` decided, if any. */
async function allow({ req, clientId, until, note, request = null }) {
  const settings = req.creditSettings;
  const now = new Date();
  const end = approvalEnd(until, settings, now);
  const block = await db.Credit_Block.findOne({ where: { ClientId: clientId } });
  if (!block?.active) throw new Refused('This party is not blocked.', 409);
  await block.update({ approvedUntil: end, approvedById: req.user?.id || null });
  const client = await db.Clients.findByPk(clientId, { attributes: ['name', 'code'] });

  // Every open request for the party is answered by this.
  const open = await db.Credit_Unblock_Request.findAll({ where: { ClientId: clientId, status: 'pending' } });
  for (const r of open) {
    await r.update({ status: 'approved', decidedById: req.user?.id || null, decidedAt: now, decisionNote: note || null, approvedUntil: end });
    if (r.requestedById) {
      const message = `${clientLabel(client)} can be used on jobs until ${ddmmyyyy(localDate(end, settings.timeZone))}.${note ? ` "${note}"` : ''}`;
      await notify({ recipientId: r.requestedById, subType: 'unblockApproved', message, recordId: r.id });
      const asker = await db.Employees.findByPk(r.requestedById, { attributes: ['email'] });
      await mailTo(asker?.email ? [asker.email] : [], `Approved: ${clientLabel(client)}`, `<div style="font-family:Arial,sans-serif;font-size:13px"><p>${esc(message)}</p></div>`);
    }
  }
  createHistory(req.user?.id || req.body?.employeeId, 'Credit Control', 'Unblocked', client?.name);
  return { clientId, approvedUntil: end, request: request?.id || null };
}

routes.post('/decide', approverOnly, async (req, res) => {
  try {
    const id = asId(req.body?.id);
    const request = id ? await db.Credit_Unblock_Request.findByPk(id) : null;
    if (!request) throw new Refused('No such request.', 404);
    if (request.status !== 'pending') throw new Refused(`This request was already ${request.status}.`, 409);
    const note = String(req.body?.note || '').trim().slice(0, 2000) || null;

    if (req.body?.approve === true) {
      const block = await db.Credit_Block.findOne({ where: { ClientId: request.ClientId } });
      if (!block?.active) {
        // Paid since it was asked - nothing to unblock.
        await request.update({ status: 'approved', decidedById: req.user?.id || null, decidedAt: new Date(), decisionNote: note || 'No longer blocked.' });
        return res.json({ status: 'success', result: { clientId: request.ClientId, notBlocked: true } });
      }
      return res.json({ status: 'success', result: await allow({ req, clientId: request.ClientId, until: req.body?.until, note, request }) });
    }
    if (req.body?.approve !== false) throw new Refused('Approve or reject?');
    await request.update({ status: 'rejected', decidedById: req.user?.id || null, decidedAt: new Date(), decisionNote: note });
    const client = await db.Clients.findByPk(request.ClientId, { attributes: ['name', 'code'] });
    if (request.requestedById) {
      const message = `Your request to use ${clientLabel(client)} on jobs was rejected.${note ? ` "${note}"` : ''}`;
      await notify({ recipientId: request.requestedById, subType: 'unblockRejected', message, recordId: request.id });
      const asker = await db.Employees.findByPk(request.requestedById, { attributes: ['email'] });
      await mailTo(asker?.email ? [asker.email] : [], `Rejected: ${clientLabel(client)}`, `<div style="font-family:Arial,sans-serif;font-size:13px"><p>${esc(message)}</p></div>`);
    }
    createHistory(req.user?.id || req.body?.employeeId, 'Credit Control', 'Unblock rejected', client?.name);
    res.json({ status: 'success', result: { id: request.id, status: 'rejected' } });
  } catch (e) { fail(res, e); }
});

/** An approver unblocking a party themselves - no request needed. */
routes.post('/allow', approverOnly, async (req, res) => {
  try {
    const clientId = asId(req.body?.clientId);
    if (!clientId) throw new Refused('Which party?');
    res.json({ status: 'success', result: await allow({ req, clientId, until: req.body?.until, note: String(req.body?.note || '').trim() || null }) });
  } catch (e) { fail(res, e); }
});

/** End an approval early - the party is blocked again while it is over. */
routes.post('/reblock', approverOnly, async (req, res) => {
  try {
    const clientId = asId(req.body?.clientId);
    const block = clientId ? await db.Credit_Block.findOne({ where: { ClientId: clientId } }) : null;
    if (!block?.active) throw new Refused('This party is not blocked.', 409);
    await block.update({ approvedUntil: null, approvedById: null });
    const client = await db.Clients.findByPk(clientId, { attributes: ['name'] });
    createHistory(req.user?.id || req.body?.employeeId, 'Credit Control', 'Blocked again', client?.name);
    res.json({ status: 'success', result: { clientId } });
  } catch (e) { fail(res, e); }
});

/** One party's open invoices and the open bills we owe it, omitted ones marked - to omit from. */
routes.get('/partyInvoices', approverOnly, async (req, res) => {
  try {
    const clientId = asId(req.query.clientId);
    if (!clientId) throw new Refused('Which party?');
    const { clients, invoicesByClient, billsByClient } = await loadOpenBalances({ settings: req.creditSettings, clientIds: [clientId], withOmitted: true });
    const client = clients.get(clientId) || await db.Clients.findByPk(clientId, { attributes: ['id', 'name', 'code', 'creditLimitDays', 'creditLimitAmount'], raw: true });
    const oldestFirst = (a, b) => b.ageDays - a.ageDays;
    const invoices = (invoicesByClient.get(clientId) || []).sort(oldestFirst);
    const bills = (billsByClient.get(clientId) || []).sort(oldestFirst);
    // What counts: the omitted ones are listed, not added.
    const counted = (list) => list.filter((i) => !i.omitted);
    res.json({ status: 'success', result: { client, invoices, bills, ...position(counted(invoices), counted(bills)) } });
  } catch (e) { fail(res, e); }
});

/** Take invoices out of credit control, or put them back. */
routes.post('/omit', approverOnly, async (req, res) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds : []).map(asId).filter(Boolean))];
    if (!ids.length) throw new Refused('Which invoices?');
    if (ids.length > 5000) throw new Refused('At most 5,000 invoices at a time - use "Omit everything dated before" for the backlog.');
    const reason = String(req.body?.reason || '').trim().slice(0, 1000) || null;
    if (req.body?.omit === false) {
      const n = await db.Credit_Omission.destroy({ where: { InvoiceId: ids } });
      createHistory(req.user?.id || req.body?.employeeId, 'Credit Control', 'Invoices put back', `${n} invoice(s)`);
      return res.json({ status: 'success', result: { restored: n } });
    }
    const have = new Set((await db.Credit_Omission.findAll({ where: { InvoiceId: ids }, attributes: ['InvoiceId'], raw: true })).map((o) => o.InvoiceId));
    const fresh = ids.filter((id) => !have.has(id));
    if (fresh.length) await db.Credit_Omission.bulkCreate(fresh.map((InvoiceId) => ({ InvoiceId, omittedById: req.user?.id || null, reason })));
    createHistory(req.user?.id || req.body?.employeeId, 'Credit Control', 'Invoices omitted', `${fresh.length} invoice(s)`);
    res.json({ status: 'success', result: { omitted: fresh.length } });
  } catch (e) { fail(res, e); }
});

/**
 * The BACKLOG in one go: every open receivable dated before `date` - all
 * parties, or one - omitted. `preview: true` only counts them. The open bills
 * dated before it too: they count against the invoices since 2026-10-26, and
 * a backlog of bills left in would put every party's net in its favour.
 */
routes.post('/omitBefore', approverOnly, async (req, res) => {
  try {
    const date = String(req.body?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Refused('A date, please.');
    const clientId = req.body?.clientId ? asId(req.body.clientId) : null;
    const { invoicesByClient, billsByClient } = await loadOpenBalances({ settings: req.creditSettings, clientIds: clientId ? [clientId] : null });
    const before = (byClient) => [...byClient.values()].flat().filter((i) => i.date < date).map((i) => i.id);
    const invoiceIds = before(invoicesByClient);
    const billIds = before(billsByClient);
    const ids = [...invoiceIds, ...billIds];
    if (req.body?.preview) return res.json({ status: 'success', result: { count: ids.length, invoices: invoiceIds.length, bills: billIds.length } });
    const reason = String(req.body?.reason || '').trim().slice(0, 1000) || `Backlog - dated before ${ddmmyyyy(date)}`;
    for (let i = 0; i < ids.length; i += 1000) {
      await db.Credit_Omission.bulkCreate(ids.slice(i, i + 1000).map((InvoiceId) => ({ InvoiceId, omittedById: req.user?.id || null, reason })), { ignoreDuplicates: true });
    }
    createHistory(req.user?.id || req.body?.employeeId, 'Credit Control', 'Backlog omitted', `${invoiceIds.length} invoice(s) and ${billIds.length} bill(s) before ${date}`);
    res.json({ status: 'success', result: { omitted: ids.length, invoices: invoiceIds.length, bills: billIds.length } });
  } catch (e) { fail(res, e); }
});

/** What has been omitted - newest first. */
routes.get('/omitted', approverOnly, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const { rows, count } = await db.Credit_Omission.findAndCountAll({
      include: [
        { model: db.Invoice, attributes: ['id', 'invoice_No', 'currency', 'total', 'party_Name', 'createdAt'] },
        { model: db.Employees, as: 'omittedBy', attributes: ['name'] },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit,
    });
    res.json({ status: 'success', result: { count, rows } });
  } catch (e) { fail(res, e); }
});

// --------------------------------------------------------------- System (Config)

routes.get('/settings', requireSystem, async (req, res) => {
  try {
    const { readEmailConfig, isComplete } = require('../../functions/emailConfig');
    const [settings, state, cfg] = await Promise.all([readSettings(), readRunState(), readEmailConfig()]);
    res.json({ status: 'success', result: { settings, designations: DESIGNATIONS, weekdays: WEEKDAYS, state, emailReady: isComplete(cfg) } });
  } catch (e) { fail(res, e); }
});

routes.post('/settings', requireSystem, async (req, res) => {
  try {
    const before = await readSettings();
    const settings = await writeSettings(req.body?.settings);
    // Switched on, or a time moved, after today's time: the first run is the
    // next one due, not one this minute.
    const moved = !before.enabled
      || before.daily.time !== settings.daily.time || before.weekly.time !== settings.weekly.time
      || before.weekly.day !== settings.weekly.day || before.timeZone !== settings.timeZone;
    if (settings.enabled && moved) await markPassedRuns(settings);
    createHistory(req.user?.id || req.body?.employeeId, 'Config', 'Credit Control', settings.enabled ? 'On' : 'Off');
    res.json({ status: 'success', result: settings });
  } catch (e) {
    if (e instanceof SettingsError) return res.status(400).json({ status: 'error', result: e.message });
    fail(res, e);
  }
});

/** Run a check by hand: preview it, send it all to one address, or send it. */
routes.post('/run', requireSystem, async (req, res) => {
  try {
    const kind = req.body?.kind === 'weekly' ? 'weekly' : req.body?.kind === 'daily' ? 'daily' : null;
    const mode = ['preview', 'test', 'send'].includes(req.body?.mode) ? req.body.mode : null;
    if (!kind || !mode) throw new Refused('Which run, and how?');
    const testTo = String(req.body?.testTo || '').trim();
    if (mode === 'test' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo)) throw new Refused('An email address to send the test to.');
    const run = kind === 'daily' ? runDaily : runWeekly;
    const result = await run({ mode, testTo, trigger: 'manual' });
    if (mode !== 'preview') createHistory(req.user?.id || req.body?.employeeId, 'Credit Control', `Ran ${kind} (${mode})`, `${result.sent} sent`);
    res.json({ status: 'success', result });
  } catch (e) { fail(res, e); }
});

routes.get('/log', requireSystem, async (req, res) => {
  try {
    res.json({ status: 'success', result: await readLog() });
  } catch (e) { fail(res, e); }
});

module.exports = routes;
module.exports.approvalEnd = approvalEnd;

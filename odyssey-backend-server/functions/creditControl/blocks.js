/* CREDIT CONTROL - blocking a party that is over its Credit Limit (Amount).
 *
 * The user's rule (2026-10-23): over the limit, the party cannot be picked as
 * the CLIENT on a job ("only the client field for now") without approval. Not
 * the shipper or consignee, and not its invoices.
 *
 *  - The DAILY CHECK sets the block and clears it again once the party is back
 *    under (syncBlocks).
 *  - An APPROVER (CEO / CFO by default) lets it through until a date - on a
 *    user's request or on their own - and can pick a blocked party anyway.
 *  - Picking it RECHECKS the party there and then (blockOnPick): a party that
 *    paid this morning is not held to last night's figures, and its block goes.
 *
 * Nothing is blocked while credit control or blocking is switched off.
 */
const db = require('../../models');
const { readSettings, isApproverDesignation } = require('./settings');
const { loadOpenBalances } = require('./data');
const { position } = require('./rules');

class CreditBlocked extends Error {
  constructor(details) {
    super(`${details.name} is over its credit limit - it owes PKR ${fmt(details.balancePkr)} against a limit of PKR ${fmt(details.limitPkr)}. `
      + 'It cannot be the client on a new job until that is approved - pick it again to ask for approval.');
    this.status = 409;
    this.creditBlock = details;
  }
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isApprover = (req, settings) => isApproverDesignation(settings, req?.user?.designation);

/** Blocking is in force at all. */
const blocking = (settings) => Boolean(settings?.enabled && settings?.block?.enabled);

/** Is this block stopping a pick right now? */
const holds = (block, now = new Date()) => Boolean(block?.active)
  && !(block.approvedUntil && new Date(block.approvedUntil) > now);

/** One party's NET balance - open invoices less the bills we owe it - in rupees against its amount limit, now. */
async function liveBalance(clientId, settings, now = new Date()) {
  const client = await db.Clients.findByPk(clientId, { attributes: ['id', 'name', 'code', 'creditLimitAmount'] });
  if (!client) return null;
  const limit = client.creditLimitAmount == null ? null : Number(client.creditLimitAmount);
  if (limit === null) return { client, limitPkr: null, balancePkr: 0, over: false };
  const { invoicesByClient, billsByClient } = await loadOpenBalances({ settings, clientIds: [client.id], now });
  // The daily check's own arithmetic, so a pick and the 9am run never disagree.
  const { balancePkr } = position(invoicesByClient.get(client.id) || [], billsByClient.get(client.id) || []);
  return { client, limitPkr: limit, balancePkr, over: balancePkr > limit };
}

/**
 * Picking `clientId` as a job's client: null when it may be, or why not -
 * { clientId, name, code, balancePkr, limitPkr }.
 */
async function blockOnPick({ clientId, req, settings, now = new Date() }) {
  if (!clientId) return null;
  settings = settings || await readSettings();
  if (!blocking(settings) || isApprover(req, settings)) return null;
  const block = await db.Credit_Block.findOne({ where: { ClientId: clientId } });
  if (!holds(block, now)) return null;

  const live = await liveBalance(clientId, settings, now);
  if (!live || !live.over) {
    await block.update({ active: false, liftedAt: now, liftReason: live?.limitPkr == null ? 'No credit limit set' : 'Back under its limit', approvedUntil: null, checkedAt: now });
    return null;
  }
  await block.update({ balancePkr: live.balancePkr, limitPkr: live.limitPkr, checkedAt: now });
  return { clientId: live.client.id, name: live.client.name, code: live.client.code, balancePkr: live.balancePkr, limitPkr: live.limitPkr };
}

/**
 * A job save naming `clientId`: refused (throws CreditBlocked) when it is a
 * blocked party the job did not already have - a job saved before the block
 * keeps saving.
 */
async function assertClientAllowed(req, { clientId, previousClientId = null }) {
  if (!clientId || String(clientId) === String(previousClientId ?? '')) return;
  const why = await blockOnPick({ clientId: Number(clientId), req });
  if (why) throw new CreditBlocked(why);
}

/**
 * After the daily check: block every party over its limit, and lift the block
 * on every party that is not (back under, or no limit any more). An approval
 * still running is kept. Returns { blocked, lifted, blocks: Map(ClientId -> row) }.
 */
async function syncBlocks(evaluated, { now = new Date() } = {}) {
  const { Credit_Block } = db;
  const over = new Map(evaluated.filter((e) => e.over).map((e) => [e.client.id, e]));
  const existing = await Credit_Block.findAll();
  const byClient = new Map(existing.map((b) => [b.ClientId, b]));
  let blocked = 0;
  let lifted = 0;

  for (const [clientId, e] of over) {
    const b = byClient.get(clientId);
    const figures = { balancePkr: e.balancePkr, limitPkr: e.limitPkr, checkedAt: now };
    if (!b) {
      byClient.set(clientId, await Credit_Block.create({ ClientId: clientId, active: true, blockedAt: now, ...figures }));
      blocked += 1;
    } else if (!b.active) {
      await b.update({ active: true, blockedAt: now, approvedUntil: null, approvedById: null, liftedAt: null, liftReason: null, ...figures });
      blocked += 1;
    } else {
      await b.update(figures);
    }
  }
  for (const b of existing) {
    if (b.active && !over.has(b.ClientId)) {
      await b.update({ active: false, liftedAt: now, liftReason: 'Back under its limit', approvedUntil: null, checkedAt: now });
      lifted += 1;
    }
  }
  return { blocked, lifted, blocks: byClient };
}

module.exports = { CreditBlocked, isApprover, blocking, holds, liveBalance, blockOnPick, assertClientAllowed, syncBlocks };

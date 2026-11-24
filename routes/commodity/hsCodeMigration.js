/**
 * Receiver for the HS tariff master - legacy Gen_UnCommodity.
 *
 *   POST /commodity/migration/hs/plan     what WOULD happen. Writes nothing.
 *   POST /commodity/migration/hs/apply    does it, in one transaction.
 *   GET  /commodity/migration/hs/verify   what is actually in the system.
 *
 * Separate from commodityMigration.js because the SOURCE is a different table
 * with a different key: Gen_UnCommodity has no Id, so these rows carry no
 * climaxId and idempotency runs on the HS code. Folding that into a stage that
 * matches on climaxId would give it two contradictory notions of "already
 * imported".
 *
 * Both stages write the same Commodity table, which is intentional - the
 * commodity picker is one list, and on a customs install the tariff codes are
 * the part of it that matters.
 *
 * The mapping is in functions/hsCodeMigrationPlan.js, with no database in it.
 */
const routes = require('express').Router();
const db = require('../../models');
const { Commodity } = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planHsCodes, hsKey } = require('../../functions/hsCodeMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;
const CHUNK = 500;

/**
 * The HS codes already present, however they got there.
 *
 * Read from `hs` rather than climaxId - see the plan module's header. Rows the
 * commodity stage created from Gen_Commodity are included, so a tariff code
 * that already arrived that way is not duplicated.
 */
async function readExistingHs() {
  const rows = await Commodity.findAll({ attributes: ['hs'], raw: true });
  return rows.map((r) => r.hs).filter(Boolean);
}

function readBody(req) {
  if (Array.isArray(req.body)) return req.body;
  return req.body?.commodities || req.body?.Commodities || null;
}

function summarise(plan) {
  const p = plan.problems;
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      missingCode: p.missingCode,
      duplicateCodes: p.duplicateCodes.slice(0, 25),
      duplicateCodeCount: p.duplicateCodes.length,
      missingDescriptionSample: p.missingDescription.slice(0, 25),
    },
    guidance:
      plan.stats.toCreate === 0
        ? 'Nothing to do - every tariff code in the source is already present.'
        : `${plan.stats.toCreate} tariff code(s) will be added to the commodity list.`,
  };
}

routes.post('/migration/hs/plan', SYSTEM, async (req, res) => {
  try {
    const rows = readBody(req);
    if (!Array.isArray(rows)) {
      return res.status(400).json({
        status: 'error',
        result: 'Send the legacy Gen_UnCommodity rows as the body, or as { commodities: [...] }.',
      });
    }
    const plan = planHsCodes(rows, { existingHs: await readExistingHs() });
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[hs migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/migration/hs/apply', SYSTEM, async (req, res) => {
  try {
    const rows = readBody(req);
    if (!Array.isArray(rows)) {
      return res.status(400).json({
        status: 'error',
        result: 'Send the legacy Gen_UnCommodity rows as the body, or as { commodities: [...] }.',
      });
    }

    const plan = planHsCodes(rows, { existingHs: await readExistingHs() });

    if (!plan.toCreate.length) {
      return res.json({
        status: 'success',
        result: { ...summarise(plan), created: 0, message: 'Nothing to import.' },
      });
    }

    await db.sequelize.transaction(async (t) => {
      for (let i = 0; i < plan.toCreate.length; i += CHUNK) {
        await Commodity.bulkCreate(plan.toCreate.slice(i, i + CHUNK), { transaction: t });
      }
    });

    // Prove it landed rather than trusting that no error means success.
    const after = await Commodity.count();

    res.json({
      status: 'success',
      result: { ...summarise(plan), created: plan.toCreate.length, commoditiesInTarget: after },
    });
  } catch (error) {
    console.error('[hs migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * What is actually there afterwards.
 *
 * A row count cannot tell a tariff code from a general commodity, so this
 * reports how many commodities carry an HS code and whether any code is
 * duplicated - which is the one way this stage can go wrong on a re-run.
 */
routes.get('/migration/hs/verify', SYSTEM, async (req, res) => {
  try {
    const rows = await Commodity.findAll({ attributes: ['id', 'name', 'hs'], raw: true });
    const withHs = rows.filter((r) => r.hs && String(r.hs).trim());

    const counts = new Map();
    for (const r of withHs) {
      const k = hsKey(r.hs);
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    const duplicates = [...counts.entries()].filter(([, n]) => n > 1);

    res.json({
      status: 'success',
      result: {
        commodities: rows.length,
        withHsCode: withHs.length,
        withoutHsCode: rows.length - withHs.length,
        duplicateHsCodes: duplicates.length,
        duplicateSample: duplicates.slice(0, 20).map(([k, n]) => ({ hs: k, count: n })),
        healthy: duplicates.length === 0,
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

/**
 * Commodity master migration - plan, apply, verify.
 *
 * /commodity/uploadCommodities is left untouched.
 *
 *   POST /commodity/migration/plan    what would happen
 *   POST /commodity/migration/apply   chunked, one transaction, idempotent
 *   GET  /commodity/migration/verify  what a row count cannot see
 *
 * 10,649 rows, so this is the one stage where the shape of the write matters
 * on its own: the old import issued one INSERT per row with no transaction, so
 * a failure part way through left thousands of committed rows and no way to
 * tell how far it had got.
 */

const routes = require('express').Router();
const db = require('../../models');
const { Commodity } = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planCommodities, isReadableHazmat, HAZMAT_YES } = require('../../functions/commodityMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

// 10,649 rows at once is a large single statement; 500 keeps each round trip
// modest while still being ~21 statements instead of ~10,649.
const CHUNK = 500;

async function readContext(body) {
  const rows = await Commodity.findAll({
    attributes: ['climaxId', 'isHazmat'], where: { climaxId: { [db.Sequelize.Op.ne]: null } }, raw: true,
  });

  return {
    existingClimaxIds: rows.map((r) => r.climaxId),
    importedHazmatFlags: rows.map((r) => ({ climaxId: r.climaxId, isHazmat: r.isHazmat })),
    // Optional: supplied by the stage when the legacy server exposes it.
    cargoTypes: readCargoTypes(body),
  };
}

function readRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.Commodities)) return body.Commodities;
  if (Array.isArray(body?.commodities)) return body.commodities;
  return null;
}

function readCargoTypes(body) {
  if (Array.isArray(body?.CargoTypes)) return body.CargoTypes;
  if (Array.isArray(body?.cargoTypes)) return body.cargoTypes;
  return [];
}

function summarise(plan) {
  const p = plan.problems;
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      missingId: p.missingId,
      missingName: p.missingName.slice(0, 25),
      missingNameCount: p.missingName.length,
      duplicateClimaxIds: p.duplicateClimaxIds.slice(0, 25),
      missingHsCode: p.missingHsCode,
      undecodedCargoType: p.undecodedCargoType,
      inactive: p.inactive,
    },
    guidance: [
      plan.stats.toCreate === 0 && plan.stats.alreadyImported > 0
        ? `All ${plan.stats.alreadyImported} commodities are already imported.`
        : `${plan.stats.toCreate} commodity/commodities to import.`,
      plan.stats.toRepair
        ? `${plan.stats.toRepair} already-imported commodity/commodities have a hazmat flag the `
          + 'screens cannot read - the old import stored it as a boolean, and every screen tests '
          + 'it with == 1, so a hazardous commodity shows as non-hazardous. They will be corrected '
          + 'in place.'
        : null,
      plan.stats.hazmat
        ? `${plan.stats.hazmat} of the incoming commodities are flagged hazardous.`
        : null,
      !plan.stats.cargoTypeLookupAvailable
        ? 'The cargo-type lookup was not supplied, so every commodity falls back to GL exactly as '
          + 'the old import did. Restart the legacy server to pick up /jobs/getCommodityCargoTypes '
          + 'if you want them decoded.'
        : plan.stats.undecodedCargoType
          ? `${plan.stats.undecodedCargoType} carry a cargo-type id the lookup does not explain and `
            + 'fall back to GL.'
          : null,
      plan.stats.missingHsCode
        ? `${plan.stats.missingHsCode} have no HS code in the source.`
        : null,
      plan.stats.inactive
        ? `${plan.stats.inactive} are retired in the legacy system.`
        : null,
    ].filter(Boolean).join(' '),
  };
}

routes.post('/migration/plan', SYSTEM, async (req, res) => {
  try {
    const rows = readRows(req.body);
    if (!rows) {
      return res.status(400).json({
        status: 'error',
        result: 'Send the legacy Gen_Commodity rows as the body, or as { Commodities: [...] }.',
      });
    }
    const plan = planCommodities(rows, await readContext(req.body));
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[commodity migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/migration/apply', SYSTEM, async (req, res) => {
  try {
    const rows = readRows(req.body);
    if (!rows) {
      return res.status(400).json({
        status: 'error',
        result: 'Send the legacy Gen_Commodity rows as the body, or as { Commodities: [...] }.',
      });
    }

    const plan = planCommodities(rows, await readContext(req.body));
    if (!plan.toCreate.length && !plan.toRepair.length) {
      return res.json({ status: 'success', result: { ...summarise(plan), created: 0, repaired: 0 } });
    }

    // One transaction across every chunk: either the whole commodity master
    // lands or none of it does. The old import could not say which.
    await db.sequelize.transaction(async (t) => {
      for (let i = 0; i < plan.toCreate.length; i += CHUNK) {
        await Commodity.bulkCreate(plan.toCreate.slice(i, i + CHUNK), { transaction: t });
      }
      for (const r of plan.toRepair) {
        await Commodity.update(
          { isHazmat: r.isHazmat }, { where: { climaxId: r.climaxId }, transaction: t },
        );
      }
    });

    res.json({
      status: 'success',
      result: {
        ...summarise(plan),
        created: plan.toCreate.length,
        repaired: plan.toRepair.length,
        commoditiesInTarget: await Commodity.count(),
      },
    });
  } catch (error) {
    console.error('[commodity migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make.
 *
 * A commodity master can be exactly the right size and still be wrong: the
 * hazmat flag can be stored in a form no screen can read, and two commodities
 * can share a legacy id so a job line resolves to whichever comes back first.
 */
routes.get('/migration/verify', SYSTEM, async (req, res) => {
  try {
    const rows = await Commodity.findAll({
      attributes: ['id', 'name', 'climaxId', 'isHazmat', 'cargoType', 'active'], raw: true,
    });

    const withoutClimaxId = rows.filter((r) => r.climaxId === null);

    const seenIds = new Map();
    for (const r of rows) {
      if (r.climaxId === null) continue;
      const k = String(r.climaxId);
      seenIds.set(k, (seenIds.get(k) || 0) + 1);
    }
    const duplicateClimaxIds = [...seenIds.entries()]
      .filter(([, n]) => n > 1).map(([k]) => Number(k));

    // The old import's signature defect: a boolean in a string column, which
    // every screen reads as "not hazardous".
    const unreadableHazmat = rows.filter((r) => !isReadableHazmat(r.isHazmat));

    res.json({
      status: 'success',
      result: {
        commodities: rows.length,
        migrated: rows.length - withoutClimaxId.length,
        // Created by hand, or imported before climaxId was recorded. Reachable
        // from the UI, unreachable from an imported job.
        withoutClimaxId: withoutClimaxId.length,
        withoutClimaxIdSample: withoutClimaxId.slice(0, 25).map((r) => r.name),
        hazmat: rows.filter((r) => String(r.isHazmat) === HAZMAT_YES).length,
        unreadableHazmat: unreadableHazmat.length,
        unreadableHazmatSample: unreadableHazmat.slice(0, 25)
          .map((r) => ({ name: r.name, isHazmat: r.isHazmat })),
        inactive: rows.filter((r) => String(r.active) === '0').length,
        duplicateClimaxIds,
        healthy: duplicateClimaxIds.length === 0 && unreadableHazmat.length === 0,
        note:
          'unreadableHazmat counts commodities whose hazmat flag is stored in a form the screens '
          + 'test with == 1 and cannot match, so they render as non-hazardous whatever the source '
          + 'said. Re-running this stage corrects them.',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

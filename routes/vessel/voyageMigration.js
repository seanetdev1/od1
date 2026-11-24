/**
 * Vessel and voyage migration - plan, apply, verify.
 *
 * /vessel/uploadVoyages is left untouched.
 *
 *   POST /vessel/migration/plan    what would happen, writes nothing
 *   POST /vessel/migration/apply   vessels then voyages, one transaction
 *   GET  /vessel/migration/verify  what a row count cannot see
 *
 * Order matters inside apply: a voyage needs its Odyssey vessel id, and that
 * only exists once the vessel row does. Both happen in one transaction, so a
 * failure cannot leave vessels without their voyages - which is what made the
 * old stage's lack of idempotency so expensive to recover from.
 *
 * This stage exists mainly to serve the Jobs stage: a job resolves its voyage
 * by Odyssey vessel id plus voyage number, so verify checks that key rather
 * than just counting rows.
 */

const routes = require('express').Router();
const db = require('../../models');
const { Vessel, Voyage, SE_Job } = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const {
  planVessels, planVoyages, voyageKey,
} = require('../../functions/voyageMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;
const CHUNK = 500;

function readRows(body) {
  const vessels = Array.isArray(body?.Vessel) ? body.Vessel
    : Array.isArray(body?.vessels) ? body.vessels : null;
  const voyages = Array.isArray(body?.Voyage) ? body.Voyage
    : Array.isArray(body?.voyages) ? body.voyages : null;
  if (!vessels && !voyages) return null;
  return { vessels: vessels || [], voyages: voyages || [] };
}

/** legacy vessel id -> Odyssey vessel id, for everything already imported. */
async function vesselMap(transaction) {
  const rows = await Vessel.findAll({
    attributes: ['id', 'climaxId'],
    where: { climaxId: { [db.Sequelize.Op.ne]: null } },
    raw: true, transaction,
  });
  return new Map(rows.map((v) => [String(v.climaxId), v.id]));
}

async function existingVoyages(transaction) {
  const rows = await Voyage.findAll({
    attributes: ['climaxId', 'VesselId', 'voyage'], raw: true, transaction,
  });
  return {
    climaxIds: rows.map((v) => v.climaxId).filter((x) => x !== null && x !== undefined),
    keys: rows.map((v) => voyageKey(v.VesselId, v.voyage)),
  };
}

function summarise(vesselPlan, voyagePlan) {
  return {
    canApply: vesselPlan.canApply && voyagePlan.canApply,
    vessels: {
      stats: vesselPlan.stats,
      problems: {
        missingId: vesselPlan.problems.missingId,
        missingName: vesselPlan.problems.missingName.slice(0, 25),
        duplicateNames: vesselPlan.problems.duplicateNames.slice(0, 25),
      },
    },
    voyages: {
      stats: voyagePlan.stats,
      problems: {
        missingId: voyagePlan.problems.missingId,
        missingVoyageNo: voyagePlan.problems.missingVoyageNo.slice(0, 25),
        orphaned: voyagePlan.problems.orphaned.slice(0, 25),
        ambiguousKeys: voyagePlan.problems.ambiguousKeys.slice(0, 25),
      },
    },
    guidance: [
      `${vesselPlan.stats.toCreate} vessel(s) and ${voyagePlan.stats.toCreate} voyage(s) to import.`,
      voyagePlan.stats.paddedVoyageNo
        ? `${voyagePlan.stats.paddedVoyageNo} voyage number(s) are space-padded in the source and `
          + 'are trimmed. Jobs match a voyage on its trimmed number, so a padded one stored as-is '
          + 'can never be resolved.'
        : null,
      voyagePlan.stats.orphaned
        ? `${voyagePlan.stats.orphaned} voyage(s) belong to a vessel that is not in Odyssey and `
          + 'are skipped - they cannot be attached to anything.'
        : null,
      voyagePlan.stats.ambiguous
        ? `${voyagePlan.stats.ambiguous} voyage(s) share a vessel and number with another. A job `
          + 'resolving that pair gets whichever comes back first, which is not deterministic.'
        : null,
      voyagePlan.stats.guessedType
        ? `${voyagePlan.stats.guessedType} voyage(s) have a type id that is neither Import nor `
          + 'Export and default to Both. There is no lookup table in the legacy schema to check '
          + 'that against.'
        : null,
    ].filter(Boolean).join(' '),
  };
}

/** Plan both halves. `mapAfterVessels` reflects vessels this run would create. */
async function planBoth(rows, { transaction, includePending } = {}) {
  const knownVessels = await vesselMap(transaction);

  const vesselPlan = planVessels(rows.vessels, {
    existingClimaxIds: [...knownVessels.keys()],
  });

  // For a dry run the new vessels do not exist yet, so their voyages would all
  // look orphaned. Give the voyage planner a placeholder id for them so the
  // preview reports what apply would really do.
  const forVoyages = new Map(knownVessels);
  if (includePending) {
    for (const v of vesselPlan.toCreate) forVoyages.set(String(v.climaxId), `pending:${v.climaxId}`);
  }

  const existing = await existingVoyages(transaction);
  const voyagePlan = planVoyages(rows.voyages, {
    existingClimaxIds: existing.climaxIds,
    existingVoyageKeys: existing.keys,
    vesselIdByClimaxId: forVoyages,
  });

  return { vesselPlan, voyagePlan };
}

routes.post('/migration/plan', SYSTEM, async (req, res) => {
  try {
    const rows = readRows(req.body);
    if (!rows) {
      return res.status(400).json({
        status: 'error',
        result: 'Send { Vessel: [...], Voyage: [...] } as the legacy export provides them.',
      });
    }
    const { vesselPlan, voyagePlan } = await planBoth(rows, { includePending: true });
    res.json({ status: 'success', result: summarise(vesselPlan, voyagePlan) });
  } catch (error) {
    console.error('[voyage migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/migration/apply', SYSTEM, async (req, res) => {
  try {
    const rows = readRows(req.body);
    if (!rows) {
      return res.status(400).json({
        status: 'error',
        result: 'Send { Vessel: [...], Voyage: [...] } as the legacy export provides them.',
      });
    }

    let created = { vessels: 0, voyages: 0 };
    let summary;

    // Vessels and their voyages commit together. The old stage had neither a
    // transaction nor an idempotency check, so a partial run left duplicates
    // behind on every retry.
    await db.sequelize.transaction(async (t) => {
      const knownVessels = await vesselMap(t);
      const vesselPlan = planVessels(rows.vessels, {
        existingClimaxIds: [...knownVessels.keys()],
      });

      for (let i = 0; i < vesselPlan.toCreate.length; i += CHUNK) {
        await Vessel.bulkCreate(vesselPlan.toCreate.slice(i, i + CHUNK), { transaction: t });
      }
      created.vessels = vesselPlan.toCreate.length;

      // Re-read so the voyages can point at the vessels just inserted.
      const afterVessels = await vesselMap(t);
      const existing = await existingVoyages(t);

      const voyagePlan = planVoyages(rows.voyages, {
        existingClimaxIds: existing.climaxIds,
        existingVoyageKeys: existing.keys,
        vesselIdByClimaxId: afterVessels,
      });

      for (let i = 0; i < voyagePlan.toCreate.length; i += CHUNK) {
        await Voyage.bulkCreate(voyagePlan.toCreate.slice(i, i + CHUNK), { transaction: t });
      }
      created.voyages = voyagePlan.toCreate.length;

      summary = summarise(vesselPlan, voyagePlan);
    });

    res.json({ status: 'success', result: { ...summary, created } });
  } catch (error) {
    console.error('[voyage migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make.
 *
 * The number of voyages says nothing about whether a job can find one. What
 * matters is the key the Jobs stage matches on - vessel id plus trimmed voyage
 * number - so that is what is checked here.
 */
routes.get('/migration/verify', SYSTEM, async (req, res) => {
  try {
    const [vessels, voyages] = await Promise.all([
      Vessel.findAll({ attributes: ['id', 'name', 'code', 'climaxId'], raw: true }),
      Voyage.findAll({ attributes: ['id', 'voyage', 'VesselId', 'climaxId', 'type'], raw: true }),
    ]);

    const vesselIds = new Set(vessels.map((v) => String(v.id)));

    const orphanVoyages = voyages.filter(
      (v) => v.VesselId === null || v.VesselId === undefined || !vesselIds.has(String(v.VesselId)),
    );
    const paddedVoyageNo = voyages.filter(
      (v) => typeof v.voyage === 'string' && v.voyage !== v.voyage.trim(),
    );

    // The exact key the Jobs stage resolves on.
    const byKey = new Map();
    for (const v of voyages) {
      const k = voyageKey(v.VesselId, v.voyage);
      byKey.set(k, (byKey.get(k) || 0) + 1);
    }
    const ambiguous = [...byKey.entries()].filter(([, n]) => n > 1).map(([k]) => k);

    const dupVessel = new Map();
    for (const v of vessels) {
      if (v.climaxId === null) continue;
      const k = String(v.climaxId);
      dupVessel.set(k, (dupVessel.get(k) || 0) + 1);
    }
    const duplicateVessels = [...dupVessel.entries()].filter(([, n]) => n > 1).map(([k]) => Number(k));

    // How many jobs already in the system point at no voyage. Informational:
    // plenty of jobs legitimately have none, and air jobs never do.
    const seaJobsWithoutVoyage = await SE_Job.count({
      where: { operation: { [db.Sequelize.Op.in]: ['SE', 'SI'] }, VoyageId: null },
    });

    res.json({
      status: 'success',
      result: {
        vessels: vessels.length,
        voyages: voyages.length,
        migratedVessels: vessels.filter((v) => v.climaxId !== null).length,
        migratedVoyages: voyages.filter((v) => v.climaxId !== null).length,
        vesselsWithoutVoyages: vessels.filter(
          (v) => !voyages.some((y) => String(y.VesselId) === String(v.id)),
        ).length,

        // A voyage pointing at no vessel cannot be reached from a job at all.
        orphanVoyages: orphanVoyages.length,
        orphanVoyageSample: orphanVoyages.slice(0, 25).map((v) => v.voyage),

        // Padding makes the Jobs stage's lookup miss silently.
        paddedVoyageNo: paddedVoyageNo.length,

        // Same vessel and number twice: a job gets whichever comes back first.
        ambiguousVoyageKeys: ambiguous.slice(0, 25),
        ambiguousVoyageKeyCount: ambiguous.length,

        // The old stage had no idempotency, so a second run duplicated
        // everything - this is how that shows up afterwards.
        duplicateVesselClimaxIds: duplicateVessels.slice(0, 25),
        duplicateVesselCount: duplicateVessels.length,

        seaJobsWithoutVoyage,

        healthy:
          orphanVoyages.length === 0 && paddedVoyageNo.length === 0
          && ambiguous.length === 0 && duplicateVessels.length === 0,
        note:
          'Jobs resolve a voyage by vessel id plus trimmed voyage number. paddedVoyageNo and '
          + 'ambiguousVoyageKeys both break that lookup while leaving the row counts correct. '
          + 'seaJobsWithoutVoyage is informational - many jobs legitimately have no voyage.',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

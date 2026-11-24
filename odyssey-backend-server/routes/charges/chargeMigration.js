/**
 * Charge master migration - plan, apply, verify.
 *
 * /charges/bulkCreate is left untouched.
 *
 *   POST /charges/migration/plan    what would happen
 *   POST /charges/migration/apply   one transaction, idempotent
 *   GET  /charges/migration/verify  can job charge lines still resolve
 *
 * The charge master is small - a few hundred rows - so the risk here is not
 * volume, it is that every job charge line resolves a charge through it. A
 * charge that is missing, duplicated, or imported under the wrong code turns
 * into thousands of job lines that cannot name what they are for.
 */

const routes = require('express').Router();
const db = require('../../models');
const { Charges } = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planCharges } = require('../../functions/chargeMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

async function readContext() {
  const rows = await Charges.findAll({ attributes: ['id', 'climaxId', 'code'], raw: true });

  // Charges the old importer created: it put the legacy id in `code` and had
  // no climaxId column to drop it into. Keyed by code so the plan can adopt
  // them instead of importing a second copy of every charge.
  const adoptableByCode = new Map();
  for (const r of rows) {
    if (r.climaxId === null && r.code !== null && r.code !== undefined) {
      // A code shared by two rows cannot be adopted unambiguously - leave both
      // alone and let the collision report speak for them.
      const key = String(r.code);
      adoptableByCode.set(key, adoptableByCode.has(key) ? null : r.id);
    }
  }
  for (const [k, v] of [...adoptableByCode]) if (v === null) adoptableByCode.delete(k);

  return {
    existingClimaxIds: rows.map((r) => r.climaxId).filter((x) => x !== null),
    existingCodes: rows.map((r) => r.code).filter((x) => x !== null && x !== undefined),
    adoptableByCode,
  };
}

function readRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.charges)) return body.charges;
  return null;
}

function summarise(plan) {
  const p = plan.problems;
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      missingId: p.missingId,
      missingName: p.missingName,
      duplicateClimaxIds: p.duplicateClimaxIds,
      codeCollisions: p.codeCollisions.slice(0, 25),
      codeCollisionCount: p.codeCollisions.length,
      missingCurrency: p.missingCurrency.length,
      undecodablePayableParty: p.undecodablePayableParty,
      inactive: p.inactive,
    },
    guidance:
      plan.stats.toCreate === 0 && plan.stats.alreadyImported > 0
        ? `Nothing to do - all ${plan.stats.alreadyImported} charges are already imported.`
        : [
            `${plan.stats.toCreate} charge(s) to import.`,
            plan.stats.toAdopt
              ? `${plan.stats.toAdopt} were already imported by the old importer, which could not `
                + 'record the legacy id. They are adopted in place - the legacy id is filled in '
                + 'on the existing row - rather than imported a second time.'
              : null,
            p.codeCollisions.length
              ? `${p.codeCollisions.length} would take a code an existing charge already holds. `
                + 'They import, but the pair is indistinguishable in a picker and neither can be '
                + 'saved from Setup > Charges until one is changed.'
              : null,
            plan.stats.undecodablePayableParty
              ? `${plan.stats.undecodablePayableParty} carry a default payable/receivable party `
                + 'id that this export cannot decode - the party-type lookup is not part of it - '
                + `so they import as ${'Local-Agent'}/Client like every other charge. Set them in `
                + 'Setup > Charges if the distinction matters.'
              : null,
            plan.stats.mnemonicsDropped
              ? `${plan.stats.mnemonicsDropped} have a mnemonic legacy code (OFT, STOR) that has `
                + 'no column in Odyssey - `code` is a number here. Their name and short name '
                + 'still come across.'
              : null,
            plan.stats.inactive
              ? `${plan.stats.inactive} are retired in the legacy system and come across `
                + 'inactive, so they stay out of the pickers.'
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
        result: 'Send the legacy Gen_Charges rows as the body, or as { charges: [...] }.',
      });
    }
    const plan = planCharges(rows, await readContext());
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[charge migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/migration/apply', SYSTEM, async (req, res) => {
  try {
    const rows = readRows(req.body);
    if (!rows) {
      return res.status(400).json({
        status: 'error',
        result: 'Send the legacy Gen_Charges rows as the body, or as { charges: [...] }.',
      });
    }

    const plan = planCharges(rows, await readContext());
    if (!plan.toCreate.length && !plan.toAdopt.length) {
      return res.json({ status: 'success', result: { ...summarise(plan), created: 0, adopted: 0 } });
    }

    // One transaction: a failure part-way leaves no half-imported catalogue,
    // which is what the old bulkCreate did.
    await db.sequelize.transaction(async (t) => {
      const CHUNK = 500;
      for (let i = 0; i < plan.toCreate.length; i += CHUNK) {
        await Charges.bulkCreate(plan.toCreate.slice(i, i + CHUNK), { transaction: t });
      }
      for (const a of plan.toAdopt) {
        await Charges.update(
          { climaxId: a.climaxId }, { where: { id: a.rowId }, transaction: t },
        );
      }
    });

    res.json({
      status: 'success',
      result: {
        ...summarise(plan),
        created: plan.toCreate.length,
        adopted: plan.toAdopt.length,
        chargesInTarget: await Charges.count(),
      },
    });
  } catch (error) {
    console.error('[charge migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Can a job charge line still find its charge?
 *
 * Charge lines resolve through the legacy id, so a charge without a climaxId
 * is unreachable from an imported job however correct it looks on the Charges
 * screen. That is not something a row count shows.
 */
routes.get('/migration/verify', SYSTEM, async (req, res) => {
  try {
    const rows = await Charges.findAll({
      attributes: ['id', 'code', 'name', 'climaxId', 'status', 'currency'], raw: true,
    });

    const withoutClimaxId = rows.filter((r) => r.climaxId === null);

    const seenIds = new Map();
    const seenCodes = new Map();
    for (const r of rows) {
      if (r.climaxId !== null) {
        const k = String(r.climaxId);
        seenIds.set(k, (seenIds.get(k) || 0) + 1);
      }
      // code is an integer column; 0 is not a code Odyssey issues, but compare
      // against null/undefined rather than falsiness so it is never dropped.
      if (r.code !== null && r.code !== undefined) {
        const c = String(r.code);
        seenCodes.set(c, (seenCodes.get(c) || 0) + 1);
      }
    }

    // Two charges with the same legacy id make the job lookup ambiguous -
    // whichever comes back first wins, and it is not deterministic.
    const duplicateClimaxIds = [...seenIds.entries()].filter(([, n]) => n > 1).map(([k]) => Number(k));
    const duplicateCodes = [...seenCodes.entries()].filter(([, n]) => n > 1).map(([k]) => k);

    res.json({
      status: 'success',
      result: {
        charges: rows.length,
        migrated: rows.length - withoutClimaxId.length,
        // Created by hand, or imported before climaxId existed. Reachable from
        // the UI, unreachable from an imported job.
        withoutClimaxId: withoutClimaxId.length,
        withoutClimaxIdSample: withoutClimaxId.slice(0, 25).map((r) => ({ code: r.code, name: r.name })),
        // status is a BOOLEAN column - false, not '0'.
        inactive: rows.filter((r) => r.status === false).length,
        duplicateClimaxIds,
        duplicateCodes: duplicateCodes.slice(0, 25),
        healthy: duplicateClimaxIds.length === 0,
        note:
          'withoutClimaxId is only a problem for charges that imported jobs need to resolve. '
          + 'Charges created by hand after the migration will always show here.',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

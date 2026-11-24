/**
 * Location migration - airports, sea ports and destinations.
 *
 * /seaJob/UploadAirPorts is left untouched.
 *
 *   POST /locations/migration/apply   one kind, one batch, one transaction
 *   GET  /locations/migration/verify  what a row count cannot see
 *
 * There is no separate /plan here, deliberately: the legacy export is ~47.7 MB
 * and yields ~207,000 rows, so previewing it would mean sending it twice. Pass
 * `dryRun: true` to this endpoint to plan a batch without writing it - the
 * same code path, so the preview cannot drift from what apply does.
 *
 * A batch is atomic; the run is not. See functions/locationMigrationPlan.js.
 */

const routes = require('express').Router();
const db = require('../../models');
const { Airports, Ports, Destinations } = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planLocationBatch, keysOf, KINDS } = require('../../functions/locationMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

const MODELS = { airports: Airports, ports: Ports, destinations: Destinations };

// A batch this size keeps each request well under the body limit and each
// statement reasonable. ~207,000 rows is ~207 requests.
const MAX_BATCH = 2000;

routes.post('/migration/apply', SYSTEM, async (req, res) => {
  try {
    const kind = Object.keys(KINDS).find((k) => Array.isArray(req.body?.[k]));
    if (!kind) {
      return res.status(400).json({
        status: 'error',
        result: 'Expected one array: { airports: [...] }, { ports: [...] } or { destinations: [...] }.',
      });
    }

    const rows = req.body[kind];
    if (rows.length > MAX_BATCH) {
      return res.status(413).json({
        status: 'error',
        result: `Batch of ${rows.length} ${kind} exceeds the ${MAX_BATCH}-row limit. Send smaller batches.`,
      });
    }

    const model = MODELS[kind];
    const key = KINDS[kind].key;

    // One query for what is already there, rather than one per row. Scoped to
    // the keys in this batch so it stays small even when the table does not.
    const batchKeys = keysOf(kind, rows);
    const existing = batchKeys.length
      ? (await model.findAll({
          attributes: [key],
          where: { [key]: { [db.Sequelize.Op.in]: batchKeys } },
          raw: true,
        })).map((r) => r[key])
      : [];

    const plan = planLocationBatch(kind, rows, existing);

    if (req.body.dryRun) {
      return res.json({
        status: 'success',
        result: { ...plan.stats, kind, dryRun: true, created: 0, rejectedSample: plan.rejected.slice(0, 10) },
      });
    }

    if (plan.toCreate.length) {
      await db.sequelize.transaction(async (t) => {
        await model.bulkCreate(plan.toCreate, { transaction: t });
      });
    }

    res.json({
      status: 'success',
      result: {
        ...plan.stats,
        kind,
        created: plan.toCreate.length,
        // Sampled, not listed: a bad batch could otherwise return thousands.
        rejectedSample: plan.rejected.slice(0, 10),
      },
    });
  } catch (error) {
    console.error('[location migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make.
 *
 * These three tables can hold exactly the right number of rows and still be
 * wrong: a blank city renders as an empty cell, a padded name breaks
 * exact-match search and sits next to its twin in a picker, and a duplicated
 * port id makes a job's port lookup non-deterministic.
 */
routes.get('/migration/verify', SYSTEM, async (req, res) => {
  try {
    const [airports, ports, destinations] = await Promise.all([
      Airports.findAll({ attributes: ['airportCode', 'airportName', 'city', 'country'], raw: true }),
      Ports.findAll({ attributes: ['portId', 'portName', 'portCountry'], raw: true }),
      Destinations.findAll({ attributes: ['name'], raw: true }),
    ]);

    const blank = (v) => v === null || v === undefined || String(v).trim() === '';
    const padded = (v) => typeof v === 'string' && v !== v.trim();

    const dupes = (values) => {
      const seen = new Map();
      for (const v of values) {
        const k = String(v ?? '').toUpperCase();
        if (!k) continue;
        seen.set(k, (seen.get(k) || 0) + 1);
      }
      return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    };

    // 'UNKNOWN' is what shaping falls back to when a UN code resolves to
    // nothing at all. It is honest but it is not a place, so it is counted
    // separately from a genuinely blank cell.
    const unknown = (v) => String(v ?? '').toUpperCase() === 'UNKNOWN';

    const airportsBlank = airports.filter((a) => blank(a.city) || blank(a.country));
    const portsBlank = ports.filter((p) => blank(p.portCountry));
    const paddedRows = [
      ...airports.filter((a) => padded(a.airportName) || padded(a.city) || padded(a.country)),
      ...ports.filter((p) => padded(p.portName) || padded(p.portCountry)),
      ...destinations.filter((d) => padded(d.name)),
    ];

    const duplicatePortIds = dupes(ports.map((p) => p.portId));
    const duplicateDestinations = dupes(destinations.map((d) => d.name));

    res.json({
      status: 'success',
      result: {
        airports: airports.length,
        ports: ports.length,
        destinations: destinations.length,

        // A blank city or country passes every row count and renders as an
        // empty cell that no one can search or correct in bulk.
        airportsWithBlankCityOrCountry: airportsBlank.length,
        airportsWithBlankSample: airportsBlank.slice(0, 25).map((a) => a.airportCode),
        portsWithBlankCountry: portsBlank.length,

        airportsWithUnknownCity: airports.filter((a) => unknown(a.city) || unknown(a.country)).length,
        portsWithUnknownCountry: ports.filter((p) => unknown(p.portCountry)).length,

        // Padding is invisible on screen and breaks exact-match search.
        paddedValues: paddedRows.length,

        // Ports.portId has no unique index, so duplicates are possible and
        // make a job's port lookup non-deterministic.
        duplicatePortIds: duplicatePortIds.slice(0, 25),
        duplicatePortIdCount: duplicatePortIds.length,
        duplicateDestinationCount: duplicateDestinations.length,

        healthy:
          airportsBlank.length === 0 && portsBlank.length === 0
          && paddedRows.length === 0 && duplicatePortIds.length === 0,
        note:
          'Blank and padded values are invisible to a row count: a blank city renders as an empty '
          + 'cell, and a padded name sits next to its twin in a picker while failing exact-match '
          + 'search. UNKNOWN is the deliberate fallback when a UN code resolves to nothing.',
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

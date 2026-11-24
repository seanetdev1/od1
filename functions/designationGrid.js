/* A SETTING THAT SAYS WHICH DESIGNATION SEES WHICH THING - rows (dashboard
 * widgets, the bell's alert lists...) against the designations Setup >
 * Employees offers, kept as one JSON value in AppSettings:
 * { rowKey: [designations] }.
 *
 * Shared by functions/dashboardWidgets and functions/bellAlerts (2026-11-23).
 * A row added later reads as its default on an install that saved before it
 * existed; designations this list does not know are dropped.
 */
// Required when used, so the rules here can be tested without a database.
const appSetting = () => require('../models').AppSetting;
const { DESIGNATIONS } = require('./creditControl/settings');

class SettingsError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

const norm = (d) => String(d ?? '').trim().toLowerCase();
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * @param key                  the AppSettings key
 * @param rows                 [{ key, label, hint }] in display order
 * @param defaultDesignations  who sees each row until the grid is saved
 * @param noun / plural        for the refusals: 'widget' / 'widgets'
 */
function designationGrid({ key, rows, defaultDesignations, noun = 'row', plural = 'rows' }) {
  const ROW_KEYS = Object.freeze(rows.map((r) => r.key));
  const DEFAULTS = Object.freeze(Object.fromEntries(ROW_KEYS.map((k) => [k, [...defaultDesignations]])));

  /** What is stored, over the defaults: known designations only, in list order. */
  function withDefaults(stored) {
    const out = {};
    for (const k of ROW_KEYS) {
      const picked = isObject(stored) && Array.isArray(stored[k]) ? stored[k].map(norm) : DEFAULTS[k];
      out[k] = DESIGNATIONS.filter((d) => picked.includes(d));
    }
    return out;
  }

  /** A grid sent by the screen, checked. Throws SettingsError; returns it tidied. */
  function validate(grid) {
    if (!isObject(grid)) throw new SettingsError(`Send the ${plural} as { ${noun}: [designations] }.`);
    const unknownRows = Object.keys(grid).filter((k) => !ROW_KEYS.includes(k));
    if (unknownRows.length) throw new SettingsError(`Unknown ${noun}: ${unknownRows.join(', ')}.`);
    for (const [k, list] of Object.entries(grid)) {
      if (!Array.isArray(list)) throw new SettingsError(`${k} must be a list of designations.`);
      const unknown = list.map(norm).filter((d) => !DESIGNATIONS.includes(d));
      if (unknown.length) throw new SettingsError(`Unknown designation: ${[...new Set(unknown)].join(', ')}.`);
    }
    return withDefaults(grid);
  }

  async function readGrid() {
    const row = await appSetting().findOne({ where: { key } });
    let stored = null;
    try { stored = row?.value ? JSON.parse(row.value) : null; } catch (_) { stored = null; }
    return withDefaults(stored);
  }

  async function writeGrid(grid) {
    const clean = validate(grid);
    const value = JSON.stringify(clean);
    const existing = await appSetting().findOne({ where: { key } });
    if (existing) await existing.update({ value });
    else await appSetting().create({ key, value });
    return clean;
  }

  /** The rows a designation is ticked for, in display order. No database. */
  function rowsFor(designation, grid) {
    const d = norm(designation);
    if (!d) return [];
    return ROW_KEYS.filter((k) => (grid[k] || []).includes(d));
  }

  return { KEY: key, ROWS: rows, ROW_KEYS, DEFAULTS, withDefaults, validate, readGrid, writeGrid, rowsFor };
}

module.exports = { designationGrid, SettingsError, DESIGNATIONS };

/**
 * Plan an HS tariff import before writing anything.
 *
 * WHAT THIS IS, AND WHY IT IS NOT THE COMMODITY STAGE
 *
 * Climax has two commodity tables and a clearing job is wired to the OTHER one:
 *
 *   Gen_Commodity     10,275 rows, 43 columns. The general commodity master.
 *                     What the `commodities` stage imports. Log_Job has no
 *                     CommodityId column, so no clearing job references it.
 *
 *   Gen_UnCommodity    6,607 rows, 2 columns - HsCode and HsDescription. The
 *                     customs TARIFF master, and the table Log_Job actually
 *                     declares a foreign key onto (Log_Job.HSCCode).
 *
 * On CargoLinkers not one of the 15,364 jobs populates HSCCode, so nothing
 * historical points here either. It is imported regardless, because an HS code
 * is what a goods declaration is built on: the agent needs the tariff list to
 * classify goods on a NEW declaration, and a general commodity list cannot do
 * that job.
 *
 * NO LEGACY ID. Gen_UnCommodity has no Id column - HsCode IS the primary key.
 * So `climaxId` stays null and idempotency is keyed on the HS code itself,
 * which is the natural key and is unique across all 6,607 rows. That is the
 * one structural difference from every other stage here.
 *
 * No database access, so the mapping and the de-duplication can be tested.
 */

/** Trim and collapse whitespace; null when there is nothing left. */
function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

/**
 * Normalised form of an HS code, for matching only.
 *
 * Tariff codes get written with dots and spaces ("0101.20", "0101 20") and the
 * same code must not import twice because one copy carries punctuation. The
 * STORED value keeps its original formatting; only the comparison is stripped.
 */
function hsKey(value) {
  const s = cleanText(value);
  return s ? s.replace(/[^0-9A-Za-z]/g, '').toLowerCase() : null;
}

/**
 * Map one Gen_UnCommodity row onto Commodity columns.
 *
 * The description becomes the NAME, because that is what every picker in the
 * app displays. The code goes to `hs`, which is the field the commodity form
 * already has for exactly this.
 */
function mapHsCode(row) {
  const code = cleanText(row.HsCode);
  const description = cleanText(row.HsDescription);
  return {
    // A tariff line with no description is still a usable code, so fall back to
    // the code rather than dropping the row - `name` is NOT NULL.
    name: description || code,
    hs: code,
    // Odyssey offers exactly two cargo types and the tariff master says
    // nothing about either, so this takes the same default the commodity
    // stage uses rather than inventing a classification.
    cargoType: 'GL',
    commodityGroup: '',
    isHazmat: '0',
    packageGroup: '',
    hazmatCode: '',
    hazmatClass: '',
    chemicalName: '',
    unoCode: '',
    active: '1',
    // Gen_UnCommodity has no Id. See the header.
    climaxId: null,
  };
}

/**
 * @param {Array}    legacyRows        Gen_UnCommodity rows
 * @param {object}   ctx
 * @param {Iterable} ctx.existingHs    `hs` values already in Commodity
 */
function planHsCodes(legacyRows, ctx = {}) {
  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const present = new Set([...(ctx.existingHs || [])].map(hsKey).filter(Boolean));

  const problems = {
    missingCode: 0,
    duplicateCodes: [],
    missingDescription: [],
  };

  const seen = new Set();
  const toCreate = [];
  let alreadyImported = 0;

  for (const row of rows) {
    if (!row) { problems.missingCode += 1; continue; }

    const key = hsKey(row.HsCode);
    if (!key) { problems.missingCode += 1; continue; }

    // Duplicate within this batch.
    if (seen.has(key)) { problems.duplicateCodes.push(row.HsCode); continue; }
    seen.add(key);

    // Already in the target - a re-run, or the code was entered by hand.
    if (present.has(key)) { alreadyImported += 1; continue; }

    const mapped = mapHsCode(row);
    if (!cleanText(row.HsDescription)) problems.missingDescription.push(row.HsCode);

    toCreate.push(mapped);
  }

  return {
    toCreate,
    problems,
    stats: {
      source: rows.length,
      toCreate: toCreate.length,
      alreadyImported,
      // Named separately from `problems.missingCode` because a tariff line with
      // a code and no text is importable; one with no code is not.
      withoutDescription: problems.missingDescription.length,
    },
    // Nothing here is fatal. A tariff list is reference data - a duplicate or a
    // blank description is worth reporting, not worth refusing the import over.
    canApply: true,
  };
}

module.exports = { planHsCodes, mapHsCode, hsKey, cleanText };

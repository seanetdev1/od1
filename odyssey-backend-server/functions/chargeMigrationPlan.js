/**
 * Plan a charge-master import.
 *
 * WHY `code` HOLDS THE LEGACY ID AND NOT ChargesCode
 *
 * It looks wrong, and it was the first thing this rewrite tried to "fix". It
 * is correct, for two independent reasons:
 *
 *   1. Charges.code is an INTEGER column, and /charges/create assigns codes
 *      for hand-created charges with `Charges.max("code") + 1`. On a text
 *      column max() is lexicographic - "9" sorts above "100" - so widening it
 *      would silently start handing out duplicate codes.
 *
 *   2. Legacy ChargesCode is not a stable business code anyway. Older charges
 *      carry a mnemonic (OFT, STOR, RPR); everything from Id 205 on is just a
 *      stringified sequence number ("192", "193", ...). The legacy system
 *      drifted to a numeric code exactly like Odyssey's.
 *
 * The legacy id is unique, an integer, and above every hand-assigned code, so
 * it satisfies both constraints. The mnemonic that 182 of the 400 charges
 * carry has no column to live in - see MNEMONIC below.
 *
 * WHAT THE OLD IMPORT (importCharges -> /charges/bulkCreate, both untouched)
 * ACTUALLY GOT WRONG
 *
 *   climaxId: x.Id       Set by the frontend on every row and silently dropped,
 *                        because the column did not exist. Without it there is
 *                        no way to tell a re-run from a first run, so a second
 *                        run duplicated the entire charge master, and nothing
 *                        recorded which legacy charge a row came from.
 *
 *   bulkCreate           No transaction. A failure part-way left a half-imported
 *                        charge master behind.
 *
 *   GL_Currencies        Read as x.GL_Currencies.CurrencyCode with no guard, so
 *                        a single charge with no currency threw the whole import.
 *
 *   IsInActive           Ignored. Harmless on this dataset - all 400 rows are
 *                        active - but it is one export away from mattering.
 *
 * WHAT IS HARDCODED, AND WHY THAT IS NOT A BUG
 *
 *   fixAmount            Gen_Charges has no fixed-amount column. There is
 *                        nothing to migrate; 0 is the honest value.
 *
 *   taxPerc              Not on Gen_Charges either - but NOT nothing: a taxable
 *                        charge is linked to a tax authority, whose rate the
 *                        legacy server sends as TaxPercentage (15 for SALES TAX
 *                        SRB on CargoLinkers, where every taxed clearance line
 *                        was charged at exactly that). Hardcoding '0' here left
 *                        SERVICES CHARGES taxable at 0%, so new customs lines
 *                        picked up no tax until someone typed 15 into
 *                        Setup > Charges by hand.
 *
 *   defaultPaybleParty   DefaultPayablePartyId / DefaultReceivablePartyId are
 *   defaultRecivableParty foreign keys into a party-type lookup that is not in
 *                        the export and not in the legacy schema backup, so the
 *                        ids cannot be decoded. Mapping 1 -> 'Client' on a hunch
 *                        would stamp 208 of 400 charges with a value that looks
 *                        migrated and is unverified - worse than a default that
 *                        is openly a default. They keep the old import's
 *                        constants and the plan reports how many carry a source
 *                        value nobody could read, so it can be revisited with
 *                        the lookup table in hand.
 *
 * MNEMONIC: ChargesCode's mnemonic form (OFT, DET, STOR) is the thing staff
 * recognise, and there is no column for it - `short` already carries ShortName,
 * which is what the Charges screen shows. It is reported, not silently dropped,
 * so adding a column stays a deliberate decision rather than an accident.
 *
 * No database access here - this module is pure so it can be unit-tested
 * against real exports without a database.
 */

/** The seven party types the Charges screen offers. Anything else is unstorable. */
const PARTY_TYPES = [
  'Client', 'Local-Agent', 'Overseas-Agent', 'Transport-Agent',
  'Forwarding-Agent', 'Custom-Agent', 'Shipping-Line',
];

const DEFAULT_PAYABLE = 'Local-Agent';
const DEFAULT_RECEIVABLE = 'Client';

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

/** A legacy id is usable as a code only if it is a whole number. */
function toLegacyId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** True when ChargesCode is a mnemonic rather than a restated sequence number. */
function isMnemonic(chargesCode) {
  const c = cleanText(chargesCode);
  return Boolean(c) && !/^\d+$/.test(c);
}

/** The charge's sales tax rate as Setup > Charges stores it - see the header. */
function taxPercOf(row) {
  const n = Number(row && row.TaxPercentage);
  return row && row.IsTaxable && Number.isFinite(n) && n > 0 ? String(n) : '0';
}

/** Map one legacy Gen_Charges row onto Charges columns. */
function mapCharge(row) {
  const id = toLegacyId(row.Id);

  return {
    // Integer column, and above every hand-assigned code - see the header.
    code: id,
    name: cleanText(row.ChargesName),
    // NOT NULL. ShortName is populated on all 400 rows, but fall back rather
    // than fail the row if an export ever arrives without it.
    short: cleanText(row.ShortName)
      || cleanText(row.InvoicePrintingName)
      || cleanText(row.ChargesName),
    // Guarded: one charge with no currency used to throw the whole import.
    currency: cleanText(row.GL_Currencies && row.GL_Currencies.CurrencyCode) || 'PKR',
    calculationType: Number(row.PerUnitFixedId) === 1 ? 'Per Unit' : 'Per Shipment',
    defaultPaybleParty: DEFAULT_PAYABLE,
    defaultRecivableParty: DEFAULT_RECEIVABLE,
    taxApply: row.IsTaxable ? 'Yes' : 'No',
    taxPerc: taxPercOf(row),
    fixAmount: 0,
    // BOOLEAN column - a '0' string would be coerced, but only by accident.
    // Retired charges import inactive rather than being dropped, because
    // historical charge lines still point at them.
    status: !row.IsInActive,
    // Pass-through disbursement rather than revenue - duty, sales tax, port
    // and terminal charges a clearing agent pays for the client and recharges
    // at cost. Climax has always carried this; the first version of this
    // mapping dropped it, which put every recharged duty into an income
    // account. See models/Charges.js.
    reimbursable: !!row.IsReimbursment,
    climaxId: id,
  };
}

/**
 * @param {Array} legacyRows              legacy Gen_Charges rows
 * @param {object} ctx
 * @param {Iterable} ctx.existingClimaxIds  charges already imported by this stage
 * @param {Iterable} ctx.existingCodes      codes already in use, migrated or not
 * @param {Map} ctx.adoptableByCode         code -> row id, for rows with no climaxId
 */
function planCharges(legacyRows, ctx = {}) {
  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const imported = new Set([...(ctx.existingClimaxIds || [])].map(String));
  const usedCodes = new Set([...(ctx.existingCodes || [])].map(String));
  // Charges the OLD importer left behind: it wrote the legacy id into `code`
  // and dropped climaxId, because the column did not exist yet. On a system
  // that already ran it - Seanet's - every one of those looks unimported here,
  // so a re-run would duplicate the entire catalogue and collide on every
  // code. They are adopted instead: same row, climaxId backfilled.
  const adoptableByCode = ctx.adoptableByCode instanceof Map
    ? ctx.adoptableByCode
    : new Map(Object.entries(ctx.adoptableByCode || {}));

  const problems = {
    missingId: 0,
    missingName: [],
    duplicateClimaxIds: [],
    codeCollisions: [],
    missingCurrency: [],
    undecodablePayableParty: 0,
    inactive: 0,
  };

  const seenIds = new Set();
  const toCreate = [];
  const toAdopt = [];
  let skipped = 0;
  let mnemonicsDropped = 0;

  for (const row of rows) {
    // Id is the whole identity of the row here: it becomes both climaxId and
    // code, so a row without a usable one cannot be imported at all.
    if (!row || toLegacyId(row.Id) === null) { problems.missingId += 1; continue; }

    const id = toLegacyId(row.Id);
    const key = String(id);

    if (seenIds.has(key)) { problems.duplicateClimaxIds.push(id); continue; }
    seenIds.add(key);

    if (imported.has(key)) { skipped += 1; continue; }

    // Left by the old importer under this exact code - claim it rather than
    // creating a second copy of the same charge.
    if (adoptableByCode.has(key)) {
      toAdopt.push({ rowId: adoptableByCode.get(key), climaxId: id });
      continue;
    }

    const mapped = mapCharge(row);
    if (!mapped.name) { problems.missingName.push(id); continue; }

    if (!row.GL_Currencies || !row.GL_Currencies.CurrencyCode) {
      problems.missingCurrency.push(id);
    }
    if (row.DefaultPayablePartyId !== null && row.DefaultPayablePartyId !== undefined) {
      problems.undecodablePayableParty += 1;
    }
    if (row.IsInActive) problems.inactive += 1;
    if (isMnemonic(row.ChargesCode)) mnemonicsDropped += 1;

    // A charge created by hand before the migration can already hold a code
    // that a legacy id is about to claim. The old import could produce this
    // silently; here it is surfaced. Not fatal - `code` has no unique
    // constraint - but two charges sharing a code are indistinguishable in a
    // picker and /charges/edit refuses to save either of them.
    if (usedCodes.has(key)) problems.codeCollisions.push(id);

    toCreate.push(mapped);
  }

  return {
    toCreate,
    toAdopt,
    problems,
    stats: {
      source: rows.length,
      toCreate: toCreate.length,
      toAdopt: toAdopt.length,
      alreadyImported: skipped,
      inactive: problems.inactive,
      undecodablePayableParty: problems.undecodablePayableParty,
      codeCollisions: problems.codeCollisions.length,
      mnemonicsDropped,
    },
    // Collisions and unreadable party ids are reported, not fatal: they are a
    // nuisance on individual charges rather than a broken link, and refusing
    // the whole charge master over a handful would be the worse failure.
    canApply: true,
  };
}

module.exports = {
  planCharges, mapCharge, cleanText, toLegacyId, isMnemonic,
  PARTY_TYPES, DEFAULT_PAYABLE, DEFAULT_RECEIVABLE,
};

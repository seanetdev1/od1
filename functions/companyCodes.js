/**
 * Company short codes, both directions.
 *
 * Voucher and invoice numbers carry the company code as a prefix
 * ("SNS-PV-1043/25"). These were hardcoded at seven call sites as
 *     CompanyId == 1 ? "SNS" : CompanyId == 2 ? "CLS" : "ACS"
 * which stamps our three company codes onto every voucher a leased install
 * prints. Company.short is exactly this value, set per install and populated
 * from Gen_SubCompanies.ShortName by the migration.
 *
 * Extracted from routes/voucher so the ledger importer can use the same
 * resolution rather than keeping a second copy of it.
 *
 * Cached because voucher creation is a hot path and the mapping does not
 * change while the process is running.
 */

const db = require('../models');

const _shortByCompanyId = new Map();
let _companiesPromise = null;

/** Company id -> short code, e.g. 1 -> "SNS". Falls back to "GEN". */
async function companyShort(companyId) {
  if (companyId == null) return 'GEN';
  const key = String(companyId);
  if (_shortByCompanyId.has(key)) return _shortByCompanyId.get(key);
  let short = 'GEN';
  try {
    const c = await db.Company.findByPk(companyId, { attributes: ['short'] });
    if (c && c.short) short = String(c.short).trim().toUpperCase();
  } catch (err) {
    console.error('[companyCodes] could not read company short code:', err.message);
  }
  _shortByCompanyId.set(key, short);
  return short;
}

/**
 * Reverse: which company does an existing voucher/invoice number belong to?
 * Used by the legacy import, where the number is all we have.
 *
 * The company list is fetched once per process rather than once per number -
 * the import calls this for every voucher and every invoice, which was a query
 * per record against a table with three rows in it.
 */
async function companyIdFromNumber(number) {
  if (!number) return null;
  if (!_companiesPromise) {
    _companiesPromise = db.Company.findAll({ attributes: ['id', 'short'] });
  }
  const companies = await _companiesPromise;
  const text = String(number).toUpperCase();
  const hit = companies.find((c) => c.short && text.includes(String(c.short).toUpperCase()));
  return hit ? hit.id : null;
}

/** Drop the caches - call if companies are re-imported mid-session. */
function reset() {
  _shortByCompanyId.clear();
  _companiesPromise = null;
}

/* THE COMPANY A JOB LIST OR A JOB SAVE IS FOR - strict.
 *
 * Every job list is filtered by the company picked in the header, and used to
 * drop the filter when none came: a user with no company picked saw every
 * company's jobs, and saved theirs under none - hidden from everyone working
 * in a company, search included (15 customs jobs on CargoLinkers, 2026-10-05).
 * Now no company means no jobs listed and no job saved. */

/** A company id in form: digits, not '', 'NaN', 'undefined' or 'null'. */
const isCompanyId = (value) => /^\d+$/.test(String(value ?? '').trim());

/** The id as a string if it names a company that exists, else null. */
async function realCompanyId(value) {
  if (!isCompanyId(value)) return null;
  const row = await db.Company.findByPk(Number(String(value).trim()), { attributes: ['id'] });
  return row ? String(row.id) : null;
}

const NO_COMPANY = 'Pick your company at the top of the screen, then save again. '
  + 'Saved without one, the job would be hidden from everyone working in a company.';

module.exports = { companyShort, companyIdFromNumber, reset, isCompanyId, realCompanyId, NO_COMPANY };

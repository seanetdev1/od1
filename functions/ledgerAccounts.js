/**
 * FINDING THE LEDGER ACCOUNT a document posts to.
 *
 * functions/ledgerBuckets says which BUCKET a job belongs to and what the
 * seeded account for each side of it is called. This says how that becomes an
 * actual row in the chart of accounts, which is a different question with a
 * different answer per install: the configured id from Config > Ledger
 * Accounts first, the seeded title only as a fallback.
 *
 * WHY IT IS SHARED. Invoice approval already resolved accounts this way;
 * Direct Job E / R matched by title and nothing else, so an install whose
 * chart does not happen to contain a literal "CLEARANCE INCOME - EXPORT"
 * could approve an invoice against the account it had chosen on the settings
 * screen and then be told, on the very next entry, to go and create an account
 * by that name. Same job, same money, two different rules - and the settings
 * screen silently did not apply to half of it.
 *
 * The lookup differs between the callers in one respect only: an invoice needs
 * the account's parent and a voucher head does not, so the caller passes its
 * own `findOptions`. Everything about WHICH account is decided here.
 */

const { titleFor, FALLBACK_BUCKET } = require('./ledgerBuckets');
const { getScopeCompany } = require('./fiscalYearContext');

const LEDGER_KEY = 'ledgerAccounts';

/**
 * The configured account ids, keyed by bucket then side.
 *
 * Read fresh each time rather than cached: this is the setting an admin
 * changes to fix a posting failure, and a cache would mean the fix does not
 * take effect until the server is restarted. One indexed row.
 *
 * NEVER THROWS. A missing row, or one somebody has hand-edited into invalid
 * JSON, means "nothing is configured" - and the titles still resolve. Taking
 * the posting down over an unreadable preference would be worse than ignoring
 * it.
 */
const readOne = async (AppSetting, key, transaction) => {
  try {
    const row = await AppSetting.findOne({
      where: { key },
      ...(transaction ? { transaction } : {}),
    });
    return (row?.value ? JSON.parse(row.value) : {}) || {};
  } catch (_) {
    return {};
  }
};

/**
 * PER COMPANY: where Seanet has given a company its own mapping - an install
 * whose companies keep separate charts of accounts (functions/
 * companySeparation) cannot post them all to one set of accounts - it is
 * stored under 'ledgerAccounts:<companyId>' and laid over the install's own,
 * side by side: a side the company has not mapped posts where the install's
 * mapping says. `companyId` defaults to the company the current request works
 * in.
 */
const companyKey = (companyId) => `${LEDGER_KEY}:${companyId}`;

const readLedgerAccounts = async (AppSetting, transaction, companyId = getScopeCompany()) => {
  const base = await readOne(AppSetting, LEDGER_KEY, transaction);
  if (!companyId) return base;
  const own = await readOne(AppSetting, companyKey(companyId), transaction);
  const merged = { ...base };
  for (const [bucket, sides] of Object.entries(own)) {
    if (sides && typeof sides === 'object') merged[bucket] = { ...(base[bucket] || {}), ...sides };
  }
  return merged;
};

/**
 * A function that turns a side - 'income', 'expense' or 'disbursement' - into
 * the Child_Account row it posts to, or null.
 *
 * THE ORDER OF PREFERENCE, and why each step is there:
 *
 *   1. the id configured for this side's own bucket. A decision somebody made
 *      on the settings screen beats a title this code guessed.
 *   2. for the expense side only, the id configured for the job's DIRECTION
 *      bucket. The clearance expense split by cargo type came later, so an
 *      install that mapped "Clearance - import" and has not yet mapped
 *      "Clearance - LCL" keeps posting where it always did instead of falling
 *      all the way back to a title it may not have.
 *   3. the seeded title for this side's bucket, then the direction bucket's -
 *      the same two steps again, for an install that has never opened the
 *      settings screen at all.
 *
 * A CONFIGURED ACCOUNT THAT NO LONGER EXISTS falls through rather than
 * failing: charts get reorganised, and the title may well still resolve.
 *
 * @param {Object} Child_Account  the model (passed in - this file stays free
 *                                of model imports so it can be unit tested).
 * @param {Object} mapping        from readLedgerAccounts.
 * @param {string} bucket         the job's bucket, for income and disbursement.
 * @param {string} expenseBucket  the bucket the EXPENSE side uses, which may
 *                                differ - see ledgerBuckets.expenseBucketFor.
 * @param {Object} fallbacks      { income: [...], expense: [...], disbursement: [...] }
 *                                buckets to try, in order, when the job's own
 *                                are unset - ledgerBuckets.fallbacksFor.
 * @param {Object} findOptions    merged into every findOne (an invoice adds
 *                                the parent include; a voucher head does not).
 */
const makeAccountResolver = ({
  Child_Account, mapping = {}, bucket, expenseBucket = bucket, fallbacks,
  findOptions = {}, transaction,
}) => async (side) => {
  const own = side === 'expense' ? expenseBucket : bucket;
  const opts = { ...findOptions, ...(transaction ? { transaction } : {}) };

  // own bucket, then the job's bucket (expense), then where it falls back to
  // while those are unset (ledgerBuckets.fallbacksFor: the old clearance
  // direction / cargo-type rows, AIR for aviation) - ids first, titles after.
  const chain = [...new Set([own, bucket, ...(fallbacks?.[side] || [])].filter(Boolean))];

  for (const from of chain) {
    const id = mapping?.[from]?.[side];
    if (!id) continue;
    const byId = await Child_Account.findOne({ where: { id }, ...opts });
    if (byId) return byId;
  }

  for (const from of chain) {
    const title = titleFor(from, side);
    if (!title) continue;
    const byTitle = await Child_Account.findOne({ where: { title }, ...opts });
    if (byTitle) return byTitle;
  }
  return null;
};

/* What a bucket is called in words. The keys are how the code spells them;
 * these are how the settings screen labels them, and telling somebody to fix
 * "CUSTOMS_EXPORT" sends them looking for a row that is not on the screen
 * under that name. */
const BUCKET_LABELS = {
  AIR: 'Air freight',
  FCL: 'FCL freight',
  LCL: 'LCL freight',
  CUSTOMS_IMPORT: 'Clearance — import',
  CUSTOMS_EXPORT: 'Clearance — export',
  CUSTOMS_LCL: 'Clearance — LCL',
  CUSTOMS_FCL: 'Clearance — FCL',
  CUSTOMS_SEA_IMPORT: 'Clearance — sea import',
  CUSTOMS_SEA_EXPORT: 'Clearance — sea export',
  CUSTOMS_AIR_IMPORT: 'Clearance — air import',
  CUSTOMS_AIR_EXPORT: 'Clearance — air export',
  CUSTOMS_ROAD: 'Clearance — transport',
  AVIATION: 'Aviation flights',
  TAX: 'Sales tax',
};

/**
 * What to say when nothing resolved.
 *
 * BOTH WAYS OUT, in the order they should be tried. Choosing the account on
 * the settings screen is the answer on an install with its own chart of
 * accounts; creating one under the seeded name is the answer on an install
 * that is meant to match the seed. The old message offered only the second,
 * which reads as "your chart is wrong" when the chart is fine and the mapping
 * is simply unset.
 *
 * @param {string} document  what could not be posted, e.g. 'invoice'.
 */
const missingAccountMessage = ({ document = 'document', side, bucket }) => {
  const title = titleFor(bucket, side) || titleFor(FALLBACK_BUCKET[bucket], side);
  const label = BUCKET_LABELS[bucket] || bucket;
  return (
    `Cannot post this ${document}: no ${side} account is set for ${label}. ` +
    'Choose one in Configuration > Ledger Accounts' +
    (title ? `, or create an account titled "${title}" in Accounts > Chart Of Account.` : '.')
  );
};

module.exports = {
  LEDGER_KEY, companyKey, readLedgerAccounts, makeAccountResolver, missingAccountMessage, BUCKET_LABELS,
};

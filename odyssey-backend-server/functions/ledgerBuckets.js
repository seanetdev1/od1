/**
 * Which pair of ledger accounts a job's money posts to.
 *
 * Extracted from routes/invoice approveInvoice(), which worked this out
 * correctly for all three operation modes, and was the ONLY place that did.
 * Direct Job E/R had its own copy of the same decision with two of the five
 * buckets missing - it read SE_Job.subType and chose between the LCL and FCL
 * pair, so an aviation or customs entry had no bucket to land in at all (and,
 * because the SE_Job lookup returned null, threw before it could).
 *
 * ONE LIST, TWO CALLERS. The titles below are matched EXACTLY against the
 * chart of accounts, so a second hand-kept copy is not a duplicate that might
 * drift, it is one that WILL: renaming an account in one list and not the
 * other posts two documents about the same job to two different accounts, and
 * nothing in the ledger says which was meant.
 *
 * Titles are the ones seeded by functions/chartOfAccounts.js - note LCL's
 * expense is "EXP", not "EXPENSE", which is why they are written out rather
 * than built from the bucket name.
 *
 * Kept free of model imports: this is a mapping, and the account lookup that
 * uses it differs between the two callers (an invoice needs the account's
 * parent, a voucher head does not).
 */

const FREIGHT_ACCOUNTS = {
  FCL: { income: 'FCL FREIGHT INCOME', expense: 'FCL FREIGHT EXPENSE' },
  LCL: { income: 'LCL FREIGHT INCOME', expense: 'LCL FREIGHT EXP' },
  // Aviation has no subType and falls here, which is what an airline is.
  AIR: { income: 'AIR FREIGHT INCOME', expense: 'AIR FREIGHT EXPENSE' },
  // A customs job has no sub type either, so before these existed it fell
  // through to AIR and every goods declaration posted to air freight income.
  // Clearance is chosen by DIRECTION instead.
  CUSTOMS_IMPORT: {
    income: 'CLEARANCE INCOME - IMPORT',
    expense: 'CLEARANCE EXPENSE - IMPORT',
    disbursement: 'DISBURSEMENTS RECOVERABLE',
  },
  CUSTOMS_EXPORT: {
    income: 'CLEARANCE INCOME - EXPORT',
    expense: 'CLEARANCE EXPENSE - EXPORT',
    disbursement: 'DISBURSEMENTS RECOVERABLE',
  },
  /* CLEARANCE EXPENSE, SPLIT BY CARGO TYPE.
   *
   * Expense only, and not by direction: a clearing agent's costs differ
   * between a container and a groupage consignment - yard, handling, cartage -
   * in a way the income does not, so this is the split that was asked for and
   * nothing more. Income and disbursement stay on the direction buckets above.
   *
   * These carry NO income or disbursement key on purpose. They are consulted
   * for the expense side only, and a key here would be a second place for the
   * same decision to be made differently. */
  CUSTOMS_LCL: { expense: 'CLEARANCE EXPENSE - LCL' },
  CUSTOMS_FCL: { expense: 'CLEARANCE EXPENSE - FCL' },
};

/* CUSTOMS CLEARANCE BY TRANSPORT AND DIRECTION.
 *
 * Config > Ledger Accounts sets clearance income and expense (and the
 * disbursements account) for Sea Import, Sea Export, Air Import, Air Export
 * and By Road - the lines of business a clearing agent reports on. They have
 * no seeded titles: a new row that has not been chosen falls back to what the
 * job posted to before they existed - see fallbacksFor. */
const CUSTOMS_BUCKETS = [
  'CUSTOMS_SEA_IMPORT', 'CUSTOMS_SEA_EXPORT',
  'CUSTOMS_AIR_IMPORT', 'CUSTOMS_AIR_EXPORT',
  'CUSTOMS_ROAD',
];

/** Sea / Air / Road from a customs job's transportMode ('By Road' or the older 'Land'). */
const transportOf = (mode) => {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'air') return 'AIR';
  if (m === 'by road' || m === 'road' || m === 'land') return 'ROAD';
  // Sea is the model's default, and what a job with nothing recorded is.
  return 'SEA';
};

/**
 * The bucket for one job.
 *
 * A customs job (it has a direction) by its transport and direction - By Road
 * is one bucket whichever way the goods go. An aviation flight by AVIATION, so
 * airline income stays apart from air freight. A freight job by its sub type,
 * an absent one falling to AIR as it always has.
 */
function bucketFor({ subType, customsDirection, customsTransportMode, aviation } = {}) {
  if (customsDirection) {
    const t = transportOf(customsTransportMode);
    if (t === 'ROAD') return 'CUSTOMS_ROAD';
    return `CUSTOMS_${t}_${customsDirection === 'Export' ? 'EXPORT' : 'IMPORT'}`;
  }
  if (aviation) return 'AVIATION';
  if (subType === 'FCL') return 'FCL';
  if (subType === 'LCL') return 'LCL';
  return 'AIR';
}

/**
 * The bucket the EXPENSE side posts to - the job's own bucket. (It used to be
 * the clearance LCL / FCL bucket for a customs job with that cargo type; those
 * are fall-backs now, behind the transport rows - see fallbacksFor.)
 */
function expenseBucketFor(args = {}) {
  return bucketFor(args);
}

/**
 * Where each side looks when the job's own bucket has nothing chosen, in order.
 *
 * NOTHING MOVES UNTIL SOMEBODY CHOOSES. A new customs row that is still empty
 * posts exactly where the job posted before the rows existed:
 *
 *   income, disbursement   Clearance - import / export (by direction)
 *   expense                Clearance - LCL / FCL for that cargo type, then
 *                          Clearance - import / export
 *
 * and an unset AVIATION posts where air freight does. Each step is tried by
 * the account chosen on the settings screen and then by its seeded title - see
 * makeAccountResolver in functions/ledgerAccounts.
 */
function fallbacksFor({ customsDirection, customsCargoType, aviation } = {}) {
  if (customsDirection) {
    const legacy = customsDirection === 'Export' ? 'CUSTOMS_EXPORT' : 'CUSTOMS_IMPORT';
    const cargo = String(customsCargoType || '').trim().toUpperCase();
    const byCargo = cargo === 'LCL' ? ['CUSTOMS_LCL'] : cargo === 'FCL' ? ['CUSTOMS_FCL'] : [];
    return { income: [legacy], expense: [...byCargo, legacy], disbursement: [legacy] };
  }
  if (aviation) return { income: ['AIR'], expense: ['AIR'], disbursement: [] };
  return { income: [], expense: [], disbursement: [] };
}

/** Everything a caller needs to resolve one job's accounts. */
function ledgerBucketsFor(job = {}) {
  return {
    bucket: bucketFor(job),
    expenseBucket: expenseBucketFor(job),
    fallbacks: fallbacksFor(job),
  };
}

/**
 * The account title for one side of a bucket.
 *
 * `side` is 'income', 'expense' or 'disbursement'. Only the customs buckets
 * define the third; everything else returns undefined and the caller skips it.
 */
const titleFor = (bucket, side) => (FREIGHT_ACCOUNTS[bucket] || {})[side];

/* The bucket whose seeded title a failure message offers, for buckets that
 * have none of their own. */
const FALLBACK_BUCKET = {
  AVIATION: 'AIR',
  CUSTOMS_SEA_IMPORT: 'CUSTOMS_IMPORT',
  CUSTOMS_AIR_IMPORT: 'CUSTOMS_IMPORT',
  CUSTOMS_SEA_EXPORT: 'CUSTOMS_EXPORT',
  CUSTOMS_AIR_EXPORT: 'CUSTOMS_EXPORT',
};

module.exports = {
  FREIGHT_ACCOUNTS, FALLBACK_BUCKET, CUSTOMS_BUCKETS,
  bucketFor, expenseBucketFor, fallbacksFor, ledgerBucketsFor, titleFor, transportOf,
};

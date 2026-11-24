/**
 * Which ledger accounts a job's money posts to - functions/ledgerBuckets.
 *
 * Extracted from routes/invoice approveInvoice(), which was the only place
 * that got this right for all three operation modes. Direct Job E/R had its
 * own copy with only the two freight buckets in it, so an aviation or customs
 * entry had nowhere correct to post.
 *
 * The titles are matched EXACTLY against the chart of accounts, so they are
 * asserted literally here: a typo in one of them posts real money to an
 * account nobody meant, and there is nothing in the ledger afterwards that
 * says which was intended.
 */
const {
  FREIGHT_ACCOUNTS, bucketFor, expenseBucketFor, fallbacksFor, ledgerBucketsFor, titleFor,
} = require('../../functions/ledgerBuckets');

describe('choosing a bucket', () => {
  test('a freight job goes by its sub type', () => {
    expect(bucketFor({ subType: 'FCL' })).toBe('FCL');
    expect(bucketFor({ subType: 'LCL' })).toBe('LCL');
  });

  test('a flight has no sub type and falls to AIR', () => {
    // Which is what an airline is. This is the case that used to throw in
    // Direct Job E/R, because the SE_Job lookup behind it returned null.
    expect(bucketFor({})).toBe('AIR');
    expect(bucketFor({ subType: undefined })).toBe('AIR');
    expect(bucketFor()).toBe('AIR');
  });
});

describe('the account titles', () => {
  test("LCL's expense is EXP, not EXPENSE", () => {
    // The one that is not built from the bucket name, and so the one a
    // generated title would get wrong.
    expect(titleFor('LCL', 'expense')).toBe('LCL FREIGHT EXP');
    expect(titleFor('FCL', 'expense')).toBe('FCL FREIGHT EXPENSE');
  });

  test('are exactly the ones seeded into the chart of accounts', () => {
    expect(FREIGHT_ACCOUNTS.AIR).toEqual({
      income: 'AIR FREIGHT INCOME', expense: 'AIR FREIGHT EXPENSE',
    });
    expect(FREIGHT_ACCOUNTS.CUSTOMS_IMPORT).toEqual({
      income: 'CLEARANCE INCOME - IMPORT',
      expense: 'CLEARANCE EXPENSE - IMPORT',
      disbursement: 'DISBURSEMENTS RECOVERABLE',
    });
  });

  test('only the customs buckets carry a disbursement account', () => {
    // A freight bucket resolves to undefined and the caller skips the split.
    for (const b of ['FCL', 'LCL', 'AIR']) expect(titleFor(b, 'disbursement')).toBeUndefined();
    for (const b of ['CUSTOMS_IMPORT', 'CUSTOMS_EXPORT']) {
      expect(titleFor(b, 'disbursement')).toBe('DISBURSEMENTS RECOVERABLE');
    }
  });

  test('every bucket names an expense, and an income unless it is expense-only', () => {
    /* The exception is LISTED rather than inferred. Two clearance buckets
       carry an expense alone - they are consulted for that side only, and an
       income on them would be a second place for a decision the direction
       buckets already make. Naming them here means a THIRD such bucket, added
       without that being thought about, fails this test rather than silently
       posting nothing. */
    const EXPENSE_ONLY = ['CUSTOMS_LCL', 'CUSTOMS_FCL'];

    for (const [name, pair] of Object.entries(FREIGHT_ACCOUNTS)) {
      expect(name).toBe(name.toUpperCase());
      expect(typeof pair.expense).toBe('string');
      if (EXPENSE_ONLY.includes(name)) {
        expect(pair.income).toBeUndefined();
      } else {
        expect(typeof pair.income).toBe('string');
        expect(pair.income).not.toBe(pair.expense);
      }
    }
  });

  test('no two buckets share an expense account', () => {
    // Clearance LCL and clearance FCL exist precisely to be told apart; two
    // buckets pointing at one account would report as one and nothing in the
    // ledger would say they were meant to differ.
    const expenses = Object.values(FREIGHT_ACCOUNTS).map((p) => p.expense);
    expect(new Set(expenses).size).toBe(expenses.length);
  });

  test('an unknown bucket is undefined rather than a crash', () => {
    expect(titleFor('NOPE', 'income')).toBeUndefined();
  });
});

describe('customs clearance, by transport and direction', () => {
  test('Sea / Air x Import / Export, and By Road whichever way', () => {
    expect(bucketFor({ customsDirection: 'Import', customsTransportMode: 'Sea' })).toBe('CUSTOMS_SEA_IMPORT');
    expect(bucketFor({ customsDirection: 'Export', customsTransportMode: 'Sea' })).toBe('CUSTOMS_SEA_EXPORT');
    expect(bucketFor({ customsDirection: 'Import', customsTransportMode: 'Air' })).toBe('CUSTOMS_AIR_IMPORT');
    expect(bucketFor({ customsDirection: 'Export', customsTransportMode: 'Air' })).toBe('CUSTOMS_AIR_EXPORT');
    expect(bucketFor({ customsDirection: 'Import', customsTransportMode: 'By Road' })).toBe('CUSTOMS_ROAD');
    expect(bucketFor({ customsDirection: 'Export', customsTransportMode: 'By Road' })).toBe('CUSTOMS_ROAD');
  });

  test('"Land" - the name before By Road - is road; nothing recorded is sea', () => {
    expect(bucketFor({ customsDirection: 'Export', customsTransportMode: 'Land' })).toBe('CUSTOMS_ROAD');
    expect(bucketFor({ customsDirection: 'Export' })).toBe('CUSTOMS_SEA_EXPORT');
    expect(bucketFor({ customsDirection: 'Import', customsTransportMode: 'air' })).toBe('CUSTOMS_AIR_IMPORT');
  });

  test('direction wins over a sub type, and anything but Export is an import', () => {
    expect(bucketFor({ subType: 'FCL', customsDirection: 'Import' })).toBe('CUSTOMS_SEA_IMPORT');
    expect(bucketFor({ customsDirection: 'Something' })).toBe('CUSTOMS_SEA_IMPORT');
  });

  test('income and expense sit in the same row now', () => {
    const job = { customsDirection: 'Import', customsTransportMode: 'Sea', customsCargoType: 'LCL' };
    expect(expenseBucketFor(job)).toBe(bucketFor(job));
  });
});

/* NOTHING MOVES UNTIL SOMEBODY CHOOSES. A transport row left empty posts where
 * the job posted before those rows existed. */
describe('where an unchosen row falls back to', () => {
  test('income and disbursement: the old import / export row', () => {
    const f = fallbacksFor({ customsDirection: 'Export', customsCargoType: 'FCL' });
    expect(f.income).toEqual(['CUSTOMS_EXPORT']);
    expect(f.disbursement).toEqual(['CUSTOMS_EXPORT']);
  });

  test('expense: the old LCL / FCL row for that cargo type, then import / export', () => {
    expect(fallbacksFor({ customsDirection: 'Import', customsCargoType: ' lcl ' }).expense).toEqual(['CUSTOMS_LCL', 'CUSTOMS_IMPORT']);
    expect(fallbacksFor({ customsDirection: 'Import', customsCargoType: 'Fcl' }).expense).toEqual(['CUSTOMS_FCL', 'CUSTOMS_IMPORT']);
    expect(fallbacksFor({ customsDirection: 'Import', customsCargoType: '' }).expense).toEqual(['CUSTOMS_IMPORT']);
  });

  test('a flight: air freight; freight: nowhere else', () => {
    expect(fallbacksFor({ aviation: true }).income).toEqual(['AIR']);
    expect(fallbacksFor({ subType: 'FCL' })).toEqual({ income: [], expense: [], disbursement: [] });
  });

  test('ledgerBucketsFor gives a caller all three at once', () => {
    expect(ledgerBucketsFor({ customsDirection: 'Import', customsTransportMode: 'Air' })).toEqual({
      bucket: 'CUSTOMS_AIR_IMPORT',
      expenseBucket: 'CUSTOMS_AIR_IMPORT',
      fallbacks: { income: ['CUSTOMS_IMPORT'], expense: ['CUSTOMS_IMPORT'], disbursement: ['CUSTOMS_IMPORT'] },
    });
  });

  test('the old rows keep their seeded titles, so an install that never chose still posts', () => {
    expect(titleFor('CUSTOMS_LCL', 'expense')).toBe('CLEARANCE EXPENSE - LCL');
    expect(titleFor('CUSTOMS_FCL', 'expense')).toBe('CLEARANCE EXPENSE - FCL');
    expect(titleFor('CUSTOMS_SEA_IMPORT', 'income')).toBeUndefined();
  });
});

describe('freight is untouched by any of it', () => {
  test('its expense stays with its own bucket', () => {
    expect(expenseBucketFor({ subType: 'FCL', customsCargoType: 'LCL' })).toBe('FCL');
    expect(expenseBucketFor({ subType: 'LCL' })).toBe('LCL');
    expect(expenseBucketFor({})).toBe('AIR');
  });
});

describe('an aviation flight', () => {
  test('is its own bucket, for income and expense alike', () => {
    expect(bucketFor({ aviation: true })).toBe('AVIATION');
    expect(expenseBucketFor({ aviation: true })).toBe('AVIATION');
  });

  test('a freight air job is still AIR, and a customs job still its direction', () => {
    expect(bucketFor({ subType: 'AIR' })).toBe('AIR');
    expect(bucketFor({ customsDirection: 'Export', aviation: true })).toBe('CUSTOMS_SEA_EXPORT');
  });
});

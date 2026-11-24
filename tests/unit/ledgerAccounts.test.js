/**
 * Resolving a bucket to an actual account - functions/ledgerAccounts.
 *
 * ledgerBuckets answers "which bucket, and what is its account CALLED"; this
 * answers "which row in THIS install's chart of accounts", which is a
 * different question with a per-install answer. It is worth its own tests
 * because the order of preference is the whole of it, and every step in that
 * order exists because of a way an install can differ from the seed:
 *
 *   - a chart that names its accounts differently, mapped on the settings
 *     screen. That mapping must win over the seeded title.
 *   - a mapping made before the clearance expense split existed, which knows
 *     Clearance - import but not Clearance - LCL.
 *   - an install that has never opened the settings screen, where only the
 *     titles exist.
 *   - a mapped account somebody has since deleted.
 *
 * Both callers - invoice approval and Direct Job E / R - go through this, so
 * an error here posts the same job's money to two different accounts depending
 * on which screen was used, which is the failure it was extracted to prevent.
 */
const {
  readLedgerAccounts, makeAccountResolver, missingAccountMessage,
} = require('../../functions/ledgerAccounts');
const { fallbacksFor } = require('../../functions/ledgerBuckets');

/* A chart of accounts as a list, and a Child_Account that queries it the two
 * ways the resolver does. Not a mock returning canned answers: the point is
 * which query is asked and in which order, and a fake that actually looks
 * things up is the only way a wrong lookup fails. */
const chartOf = (rows) => {
  const calls = [];
  return {
    calls,
    model: {
      findOne: async ({ where }) => {
        calls.push(where);
        const found = rows.find((r) => (
          where.id !== undefined ? r.id === where.id : r.title === where.title
        ));
        return found || null;
      },
    },
  };
};

const SEEDED = [
  { id: 1, title: 'CLEARANCE INCOME - IMPORT' },
  { id: 2, title: 'CLEARANCE EXPENSE - IMPORT' },
  { id: 3, title: 'CLEARANCE INCOME - EXPORT' },
  { id: 4, title: 'CLEARANCE EXPENSE - EXPORT' },
  { id: 5, title: 'CLEARANCE EXPENSE - LCL' },
  { id: 9, title: 'A HOUSE OF ITS OWN' },
];

describe('the configured mapping', () => {
  test('a missing setting row is "nothing configured", not a failure', async () => {
    const AppSetting = { findOne: async () => null };
    expect(await readLedgerAccounts(AppSetting)).toEqual({});
  });

  test('a row nobody can parse is the same', async () => {
    // Hand-edited JSON must not take posting down with it: the titles below
    // still resolve, and an unreadable preference is not worth a stopped book.
    const AppSetting = { findOne: async () => ({ value: '{ not json' }) };
    expect(await readLedgerAccounts(AppSetting)).toEqual({});
  });

  test('and so is a database that threw', async () => {
    const AppSetting = { findOne: async () => { throw new Error('no such table'); } };
    expect(await readLedgerAccounts(AppSetting)).toEqual({});
  });

  test('a stored mapping comes back parsed', async () => {
    const AppSetting = {
      findOne: async () => ({ value: JSON.stringify({ AIR: { income: 12 } }) }),
    };
    expect(await readLedgerAccounts(AppSetting)).toEqual({ AIR: { income: 12 } });
  });

  // A company that keeps its own chart (functions/companySeparation) has its
  // own mapping, laid over the install's side by side.
  test('a company\'s own mapping is laid over the install\'s, side by side', async () => {
    const rows = {
      ledgerAccounts: { AIR: { income: 12, expense: 13 }, FCL: { income: 20 } },
      'ledgerAccounts:2': { AIR: { income: 99 } },
    };
    const AppSetting = { findOne: async ({ where }) => (rows[where.key] ? { value: JSON.stringify(rows[where.key]) } : null) };
    expect(await readLedgerAccounts(AppSetting, undefined, 2)).toEqual({
      AIR: { income: 99, expense: 13 },
      FCL: { income: 20 },
    });
    expect(await readLedgerAccounts(AppSetting, undefined, 3)).toEqual(rows.ledgerAccounts);
    expect(await readLedgerAccounts(AppSetting)).toEqual(rows.ledgerAccounts);
  });
});

describe('resolving a side to an account', () => {
  test('falls back to the seeded title when nothing is configured', async () => {
    const chart = chartOf(SEEDED);
    const resolve = makeAccountResolver({
      Child_Account: chart.model, mapping: {}, bucket: 'CUSTOMS_EXPORT',
    });
    expect((await resolve('income')).title).toBe('CLEARANCE INCOME - EXPORT');
  });

  test('the configured id WINS over the title', async () => {
    // The point of the setting: this install's chart does not use the seeded
    // names, and somebody has said which account to use instead.
    const chart = chartOf(SEEDED);
    const resolve = makeAccountResolver({
      Child_Account: chart.model,
      mapping: { CUSTOMS_EXPORT: { income: 9 } },
      bucket: 'CUSTOMS_EXPORT',
    });
    expect((await resolve('income')).title).toBe('A HOUSE OF ITS OWN');
    // And it did not go looking by title at all.
    expect(chart.calls).toEqual([{ id: 9 }]);
  });

  test('a configured account that has since been deleted falls back', async () => {
    // Charts get reorganised. The title may well still resolve, and posting
    // to it beats refusing to post.
    const chart = chartOf(SEEDED);
    const resolve = makeAccountResolver({
      Child_Account: chart.model,
      mapping: { CUSTOMS_EXPORT: { income: 404 } },
      bucket: 'CUSTOMS_EXPORT',
    });
    expect((await resolve('income')).title).toBe('CLEARANCE INCOME - EXPORT');
  });

  test('nothing configured and nothing titled is null, not a throw', async () => {
    // The caller says what to do about it - the two screens word it
    // differently and one of them is mid-transaction.
    const chart = chartOf([]);
    const resolve = makeAccountResolver({
      Child_Account: chart.model, mapping: {}, bucket: 'CUSTOMS_EXPORT',
    });
    expect(await resolve('income')).toBeNull();
  });

  test('a bucket with no account for that side never queries for one', async () => {
    // Freight has no disbursement account. Asking by an undefined title would
    // match whatever row happens to have a null title.
    const chart = chartOf(SEEDED);
    const resolve = makeAccountResolver({
      Child_Account: chart.model, mapping: {}, bucket: 'AIR',
    });
    expect(await resolve('disbursement')).toBeNull();
    expect(chart.calls).toEqual([]);
  });
});

describe('the expense side, which may sit in a different bucket', () => {
  // An LCL sea import whose own row (Clearance - sea import) is unset: it
  // falls back to the old rows - Clearance - LCL for its expense, then
  // Clearance - import - exactly as it posted before the transport rows.
  const resolverFor = (mapping, chart) => makeAccountResolver({
    Child_Account: chart.model,
    mapping,
    bucket: 'CUSTOMS_SEA_IMPORT',
    expenseBucket: 'CUSTOMS_SEA_IMPORT',
    fallbacks: fallbacksFor({ customsDirection: 'Import', customsCargoType: 'LCL' }),
  });

  test('income reads the DIRECTION bucket and expense its own', async () => {
    const chart = chartOf(SEEDED);
    const resolve = resolverFor({}, chart);
    expect((await resolve('income')).title).toBe('CLEARANCE INCOME - IMPORT');
    expect((await resolve('expense')).title).toBe('CLEARANCE EXPENSE - LCL');
  });

  test('an unmapped cargo bucket uses the DIRECTION bucket\'s configured id', async () => {
    /* The clearance expense split came later. An install that mapped
       "Clearance - import" and has not yet mapped "Clearance - LCL" keeps
       posting where it always did, rather than jumping to a seeded title it
       may not even have. */
    const chart = chartOf(SEEDED);
    const resolve = resolverFor({ CUSTOMS_IMPORT: { expense: 9 } }, chart);
    expect((await resolve('expense')).title).toBe('A HOUSE OF ITS OWN');
  });

  test('once the cargo bucket IS mapped, it wins', async () => {
    const chart = chartOf(SEEDED);
    const resolve = resolverFor(
      { CUSTOMS_IMPORT: { expense: 9 }, CUSTOMS_LCL: { expense: 5 } }, chart,
    );
    expect((await resolve('expense')).title).toBe('CLEARANCE EXPENSE - LCL');
  });

  test('and the titles fall back the same two steps', async () => {
    // A chart with no LCL expense account: the direction bucket's title is
    // the account these jobs have always used.
    const chart = chartOf(SEEDED.filter((r) => r.title !== 'CLEARANCE EXPENSE - LCL'));
    const resolve = resolverFor({}, chart);
    expect((await resolve('expense')).title).toBe('CLEARANCE EXPENSE - IMPORT');
  });

  test('income is NOT given that second chance - it has only one bucket', async () => {
    const chart = chartOf(SEEDED);
    const resolve = resolverFor({ CUSTOMS_LCL: { income: 9 } }, chart);
    // CUSTOMS_LCL carries an expense account only; a stray income mapping
    // against it must not pull the income side away from the direction.
    expect((await resolve('income')).title).toBe('CLEARANCE INCOME - IMPORT');
  });
});

describe('what it says when nothing resolved', () => {
  test('offers BOTH ways out, settings first', async () => {
    const msg = missingAccountMessage({ document: 'entry', side: 'income', bucket: 'CUSTOMS_EXPORT' });
    expect(msg).toMatch(/Configuration > Ledger Accounts/);
    expect(msg).toMatch(/CLEARANCE INCOME - EXPORT/);
    expect(msg.indexOf('Ledger Accounts')).toBeLessThan(msg.indexOf('Chart Of Account'));
  });

  test('names the bucket the way the settings screen does', () => {
    // "no income account is set for CUSTOMS_EXPORT" sends somebody looking for
    // a row that is not on the screen under that name.
    expect(missingAccountMessage({ side: 'income', bucket: 'CUSTOMS_EXPORT' }))
      .toMatch(/Clearance — export/);
  });

  test('names the document, because both screens raise it', () => {
    expect(missingAccountMessage({ document: 'invoice', side: 'expense', bucket: 'AIR' }))
      .toMatch(/^Cannot post this invoice:/);
    expect(missingAccountMessage({ document: 'entry', side: 'expense', bucket: 'AIR' }))
      .toMatch(/^Cannot post this entry:/);
  });

  test('a side with no seeded title offers only the settings screen', () => {
    // Nothing to tell them to create - suggesting they create an account
    // called "undefined" is worse than not suggesting anything.
    const msg = missingAccountMessage({ side: 'disbursement', bucket: 'AIR' });
    expect(msg).toMatch(/Configuration > Ledger Accounts\.$/);
    expect(msg).not.toMatch(/Chart Of Account/);
  });
});

/* AVIATION, SEPARATE FROM AIR FREIGHT. Config > Ledger Accounts has its own
 * section for flights. Until it is set, a flight posts exactly where it always
 * did - AIR's configured account, then AIR's seeded title - so separating the
 * two on screen moves no money by itself. */
describe('aviation has its own accounts, and falls back to air freight', () => {
  const WITH_AIR = [...SEEDED, { id: 20, title: 'AIR FREIGHT INCOME' }, { id: 21, title: 'AIR FREIGHT EXPENSE' }];
  const aviation = (mapping, rows = WITH_AIR) => makeAccountResolver({
    Child_Account: chartOf(rows).model, mapping, bucket: 'AVIATION',
    fallbacks: fallbacksFor({ aviation: true }),
  });

  test('its own configured account wins', async () => {
    expect((await aviation({ AVIATION: { income: 9 }, AIR: { income: 20 } })('income')).id).toBe(9);
  });

  test('unset, it uses the account chosen for air freight', async () => {
    expect((await aviation({ AIR: { expense: 9 } })('expense')).id).toBe(9);
  });

  test('with nothing chosen at all, air freight\'s seeded titles', async () => {
    expect((await aviation({})('income')).title).toBe('AIR FREIGHT INCOME');
  });

  test('the failure message names aviation and the title it would accept', () => {
    expect(missingAccountMessage({ document: 'invoice', side: 'income', bucket: 'AVIATION' }))
      .toMatch(/income account is set for Aviation flights.*"AIR FREIGHT INCOME"/);
  });
});

describe('the customs transport rows', () => {
  const importLcl = fallbacksFor({ customsDirection: 'Import', customsCargoType: 'LCL' });
  const resolver = (mapping) => makeAccountResolver({
    Child_Account: chartOf(SEEDED).model, mapping,
    bucket: 'CUSTOMS_SEA_IMPORT', expenseBucket: 'CUSTOMS_SEA_IMPORT', fallbacks: importLcl,
  });

  test('once a row is chosen it wins over every old one', async () => {
    const r = resolver({ CUSTOMS_SEA_IMPORT: { income: 9, expense: 9 }, CUSTOMS_IMPORT: { income: 1 }, CUSTOMS_LCL: { expense: 5 } });
    expect((await r('income')).id).toBe(9);
    expect((await r('expense')).id).toBe(9);
  });

  test('an old row chosen on the screen still counts before any seeded title', async () => {
    expect((await resolver({ CUSTOMS_IMPORT: { income: 9 } })('income')).id).toBe(9);
  });

  test('the failure message names the new row', () => {
    expect(missingAccountMessage({ side: 'income', bucket: 'CUSTOMS_AIR_EXPORT' }))
      .toMatch(/Clearance — air export.*"CLEARANCE INCOME - EXPORT"/);
  });
});

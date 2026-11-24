/**
 * Plan a chart-of-accounts import before writing anything.
 *
 * This is the part the old importer had nothing of. `/accounts/importAccount`
 * looped the legacy array and called Child_Account.create per row, in whatever
 * order the array happened to arrive:
 *
 *   - no ordering. ChildAccountId has a real foreign key
 *     (Child_Accounts_ChildAccountId_fkey), so a child inserted before its
 *     parent does not corrupt anything - it throws. The import then died
 *     mid-loop having already written the rows before it;
 *   - no idempotency, so a second run collided on the primary key and the
 *     handler died part-way through, having already written some rows;
 *   - no transaction, so that half-import stayed;
 *   - `code: item.AccountCode.toString()` threw on any account with no code;
 *   - `editable` was written as a boolean into a STRING column that the rest
 *     of the codebase reads as '0'/'1';
 *   - subCategory could be null, which functions/ledgerMapping needs to
 *     classify a voucher line;
 *   - and nothing reported what had happened either way.
 *
 * So: work out the whole plan first, report every problem, and only then let
 * the caller decide whether to write. No database access here - it takes the
 * legacy rows and the ids already present, and returns what should happen.
 *
 * IDS ARE PRESERVED DELIBERATELY. Child_Account.id is set to the legacy GL_COA
 * Id, which is what makes everything downstream linkable without a lookup
 * table - Client_Associations, voucher heads and the party accounts all carry
 * legacy COA ids. That is also why a seeded chart of accounts collides: it
 * occupies ids 1..31 that the legacy data expects to own. Detected here rather
 * than discovered half way through an insert.
 */

/** Trim and collapse whitespace; returns null for nothing useful. */
function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

/**
 * Map one legacy GL_COA row onto Child_Account columns.
 *
 * Exported so the field mapping can be tested on its own - it is the part that
 * silently produces wrong-but-plausible data when it drifts.
 */
function mapAccount(row) {
  return {
    // Preserved, not generated. See the header.
    id: row.Id,
    title: cleanText(row.AccountName),
    // String(), not .toString() - an account with no code is a data-quality
    // problem, not a reason for the import to throw.
    code: row.AccountCode === null || row.AccountCode === undefined
      ? null
      : String(row.AccountCode),
    // 'General' rather than null: ledgerMapping.resolveAccountType reads this
    // to decide whether a voucher line is a party account, a payment account
    // or an adjustment, and null falls through to the wrong bucket silently.
    subCategory: cleanText(row.SubCategory && row.SubCategory.SubCategory) || 'General',
    // '0'/'1' strings - the column is a STRING and the rest of the codebase
    // compares against those. The old import wrote a raw boolean.
    editable: row.IsVoucherEntryAllowed === false ? '0' : '1',
    ChildAccountId: row.ParentAccountId === undefined ? null : row.ParentAccountId,
  };
}

/**
 * @param {Array} legacyRows      GL_COA rows, each optionally with SubCategory
 * @param {Iterable} existingIds  Child_Account ids already in the target
 * @param {object} [opts]
 * @param {Set|Array} [opts.migratedIds]  ids already imported by a previous run
 *                                        of THIS importer - safe to skip rather
 *                                        than treat as a collision
 */
function planImport(legacyRows, existingIds = [], opts = {}) {
  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const present = new Set([...existingIds].map(String));
  const migrated = new Set([...(opts.migratedIds || [])].map(String));

  const problems = {
    duplicateIds: [],
    missingId: 0,
    missingTitle: [],
    collisions: [],   // id already used by something we did not import
    orphans: [],      // parent is neither in the source nor already present
    cycles: [],       // a -> b -> a
  };

  // --- index the source, rejecting anything unusable -----------------------
  const byId = new Map();
  for (const row of rows) {
    if (row === null || row === undefined || row.Id === null || row.Id === undefined) {
      problems.missingId += 1;
      continue;
    }
    const key = String(row.Id);
    if (byId.has(key)) {
      problems.duplicateIds.push(row.Id);
      continue;
    }
    byId.set(key, row);
  }

  const toCreate = [];
  const skipped = [];

  for (const [key, row] of byId) {
    if (present.has(key)) {
      // Already there. If we put it there, that is a clean re-run; if
      // something else did, importing would overwrite an account that is not
      // ours - which on a fresh install is the seeded chart.
      (migrated.has(key) ? skipped : problems.collisions).push(row.Id);
      continue;
    }
    const mapped = mapAccount(row);
    if (!mapped.title) {
      problems.missingTitle.push(row.Id);
      continue;
    }
    toCreate.push(mapped);
  }

  // --- parent references ---------------------------------------------------
  const creatable = new Set(toCreate.map((a) => String(a.id)));
  for (const account of toCreate) {
    const parent = account.ChildAccountId;
    if (parent === null || parent === undefined) continue;
    const parentKey = String(parent);
    // A parent that is already in the target is fine - a previous run put it
    // there, or it is a root the chart hangs off.
    if (creatable.has(parentKey) || present.has(parentKey)) continue;
    problems.orphans.push({ id: account.id, title: account.title, missingParent: parent });
    // Detach it. The foreign key would reject the insert outright, so
    // without this one account missing from the export takes the whole
    // import down with it. A visible, obviously misplaced root is better
    // than no chart at all - and the report says which ones they are.
    account.ChildAccountId = null;
  }

  // --- order: every parent before its children -----------------------------
  //
  // ChildAccountId is a real foreign key, so this is not a nicety - a child
  // inserted before its parent is rejected by Postgres. The old importer went
  // in whatever order the legacy export happened to arrive in and died on the
  // first row whose parent had not been written yet, with no transaction to
  // undo the rows before it.
  const ordered = [];
  const state = new Map();   // id -> 'visiting' | 'done'
  const index = new Map(toCreate.map((a) => [String(a.id), a]));

  const visit = (account, trail) => {
    const key = String(account.id);
    const seen = state.get(key);
    if (seen === 'done') return;
    if (seen === 'visiting') {
      // A cycle. Record it once, from its lowest id so repeated runs report
      // the same thing, and break out - these accounts cannot be ordered.
      const cycle = [...trail.slice(trail.indexOf(key)), key];
      problems.cycles.push(cycle.map(Number));
      return;
    }
    state.set(key, 'visiting');

    const parentKey = account.ChildAccountId === null || account.ChildAccountId === undefined
      ? null : String(account.ChildAccountId);
    if (parentKey && index.has(parentKey)) {
      visit(index.get(parentKey), [...trail, key]);
    }

    state.set(key, 'done');
    ordered.push(account);
  };

  for (const account of toCreate) visit(account, []);

  // Anything caught in a cycle must not be written - it would produce a tree
  // that cannot be walked.
  const inCycle = new Set(problems.cycles.flat().map(String));
  const safe = ordered.filter((a) => !inCycle.has(String(a.id)));

  const blocking = problems.collisions.length + problems.cycles.length;

  return {
    ordered: safe,
    skipped,
    problems,
    stats: {
      source: rows.length,
      usable: byId.size,
      toCreate: safe.length,
      alreadyImported: skipped.length,
      blocked: toCreate.length - safe.length,
    },
    // Whether it is safe to write. Orphans are reported but not blocking: a
    // parent missing from the export is a gap in the source data, and the
    // account is still worth having with a null parent rather than not at all.
    canApply: blocking === 0,
  };
}

module.exports = { planImport, mapAccount, cleanText };

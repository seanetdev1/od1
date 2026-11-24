// Finding an account in the chart, and opening the tree onto it.
//
// The chart is deep and mostly collapsed, so an account somebody knows the
// name of is several clicks away through parents they have to guess at. The
// search box answers that by REVEALING rather than filtering: the tree opens
// down to the account and marks it, so it is seen where it lives - with its
// siblings, under its parent - rather than lifted out of context into a flat
// result list. Where an account sits is most of what the chart is for.
//
// Kept out of the component so the walking can be tested without rendering a
// recursive tree, and so the two shapes the API returns are dealt with once.

/**
 * A node's children, whichever shape it arrived in.
 *
 * The screen normalises everything to `.children`, but the raw API hands back
 * `Child_Accounts`, and this module is used on both - so it accepts either
 * rather than depending on where in the pipeline it is called.
 */
export const childrenOf = (node) => {
  if (!node) return [];
  if (Array.isArray(node.children)) return node.children;
  if (Array.isArray(node.Child_Accounts)) return node.Child_Accounts;
  return [];
};

/**
 * Every account in the chart, flat, each carrying the path that leads to it.
 *
 * THE PATH IS THE POINT. A chart has "Bank" under Assets and "Bank Charges"
 * under Expense, and several charts have the same leaf name in two places -
 * so an option list of bare titles asks the user to pick between identical
 * rows. The ancestors' titles are what tells them apart.
 *
 * `search` is everything worth matching on, lowercased once here rather than
 * on every keystroke of every row: the code, the title, and the path. Somebody
 * looking for an account has one of those three in their head.
 */
export const flattenAccounts = (records, trail = []) => {
  const out = [];
  for (const node of (Array.isArray(records) ? records : [])) {
    if (!node) continue;
    const path = trail.map((t) => t.title).filter(Boolean);
    const kids = childrenOf(node);
    out.push({
      id: node.id,
      title: node.title || '',
      code: node.code || '',
      // Ancestors, outermost first - 'Assets › Current Assets'. Empty at the
      // top level, where the account IS the heading.
      path: path.join(' › '),
      depth: trail.length,
      // A group or a leaf. The dropdown says which, because "reveal" means
      // something different for each: a leaf is a destination, a group is a
      // place to look inside.
      hasChildren: kids.length > 0,
      search: [node.code, node.title, ...path].filter(Boolean).join(' ').toLowerCase(),
    });
    out.push(...flattenAccounts(kids, [...trail, node]));
  }
  return out;
};

/**
 * The ids of an account's ancestors, outermost first - or null if not found.
 *
 * Ancestors ONLY, not the account itself: expanding the account would open its
 * own children, which is a different request. Revealing something means making
 * it visible, not opening it.
 */
export const ancestorIdsOf = (records, id) => {
  if (id === null || id === undefined) return null;
  const want = String(id);

  const walk = (nodes, trail) => {
    for (const node of (Array.isArray(nodes) ? nodes : [])) {
      if (!node) continue;
      if (String(node.id) === want) return trail;
      const found = walk(childrenOf(node), [...trail, node.id]);
      if (found) return found;
    }
    return null;
  };

  return walk(records, []);
};

/**
 * The chart with every ancestor of `id` expanded.
 *
 * ONLY OPENS, NEVER CLOSES. A branch the user opened by hand on their way to
 * something else stays open: a search that tidied the tree behind itself would
 * undo work the user could see themselves doing, and the next search would
 * undo this one.
 *
 * Returns the ORIGINAL array when the account is not in the chart, so a stale
 * id - an account deleted in another tab - leaves the tree exactly as it was
 * rather than quietly rebuilding it.
 */
export const expandToAccount = (records, id) => {
  const ancestors = ancestorIdsOf(records, id);
  if (!ancestors) return records;
  const open = new Set(ancestors.map(String));

  const mark = (nodes) => (Array.isArray(nodes) ? nodes : []).map((node) => {
    const kids = childrenOf(node);
    return {
      ...node,
      check: open.has(String(node.id)) ? true : node.check,
      children: mark(kids),
    };
  });

  return mark(records);
};

/**
 * THE ROWS THE SCREEN SHOWS (2026-11-15 redesign): the chart walked in order,
 * descending only into the branches in `expanded` (a Set of ids as strings),
 * each row with its depth and how many accounts sit directly under it.
 *
 * The open branches are kept APART from the chart: they used to be a `check`
 * flag on each account, so every reload of the chart - after any create,
 * edit or delete - came back with every branch shut.
 */
export const visibleRows = (records, expanded, depth = 0, out = []) => {
  const open = expanded instanceof Set ? expanded : new Set();
  for (const node of (Array.isArray(records) ? records : [])) {
    if (!node) continue;
    const kids = childrenOf(node);
    const isOpen = kids.length > 0 && open.has(String(node.id));
    out.push({ node, depth, childCount: kids.length, open: isOpen });
    if (isOpen) visibleRows(kids, open, depth + 1, out);
  }
  return out;
};

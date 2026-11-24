/**
 * WHAT A CHARGE-SHEET SAVE CHANGES THAT NEEDS A RIGHT OF ITS OWN.
 *
 * Since 2026-10-20 a job's charges and the invoices raised from them are
 * separate rights (functions/permissions/catalog.js jobCharges / jobInvoices):
 * someone may enter charges and raise invoices without approving or editing
 * them (the user's request). A save of the sheet carries two things that are
 * not "editing charges":
 *
 *   APPROVAL    a line's status '1' - approving it, which is what lets it be
 *               invoiced - is the charges' Approve right. Without it, a line
 *               keeps the approval it had; a new one comes in unapproved.
 *   INVOICED    a line already on an UNAPPROVED invoice is part of that
 *               document: changing it, or taking it off, is editing the
 *               invoice - the invoices' Create & edit right. Without it, those
 *               lines are left as they are.
 *
 * A line on an APPROVED invoice is frozen whoever saves (the routes' own
 * lock - the freight sheet's is approvedInvoiceLock below), so it is not
 * asked about here.
 *
 * Only a real change asks for a right: re-saving a sheet whose invoiced lines
 * and approvals are untouched needs neither, and logs no refusal.
 *
 * No model imports - unit tested. `stored` are the job's lines as the database
 * has them, each with its Invoice ({ approved }) where it is on one.
 */

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
const sameValue = (a, b) => {
  const x = text(a); const y = text(b);
  if (x === y) return true;
  const n = Number(x); const m = Number(y);
  if (x !== '' && y !== '' && Number.isFinite(n) && Number.isFinite(m)) return Math.abs(n - m) < 0.00005;
  const truthy = (s) => ['true', '1'].includes(s.toLowerCase());
  const falsy = (s) => ['false', '0', ''].includes(s.toLowerCase());
  return (truthy(x) && truthy(y)) || (falsy(x) && falsy(y));
};

// What makes a line the line it is on an invoice - its charge, party, figures.
const LINE_FIELDS = [
  'charge', 'description', 'type', 'basis', 'qty', 'amount', 'rate_charge', 'discount',
  'currency', 'ex_rate', 'partyId', 'tax_apply', 'taxPerc', 'net_amount',
];

const isApproved = (c) => String(c?.status ?? '') === '1';
const invoiceApproved = (r) => String(r?.Invoice?.approved ?? '') === '1';
/** On an invoice that is not approved: part of an open document. */
const onOpenInvoice = (r) => Boolean(r?.InvoiceId) && !invoiceApproved(r);
const onApprovedInvoice = (r) => Boolean(r?.InvoiceId) && invoiceApproved(r);
const lineChanged = (sent, stored) => LINE_FIELDS.some((f) => f in (sent || {}) && !sameValue(sent[f], stored[f]));

const indexed = (stored) => new Map((stored || []).map((r) => [String(r.id), r]));

/**
 * Which rights this save needs.
 * @param sent     the lines the screen sent
 * @param stored   the job's lines as stored
 * @param removed  ids the save takes off (a delete list), if it sends one;
 *                 otherwise a stored line on an open invoice missing from
 *                 `sent` counts as taken off
 * @returns {{ approve: boolean, invoiced: boolean }}
 */
function chargeRightsNeeded(sent, stored, { removed } = {}) {
  const byId = indexed(stored);
  let approve = false;
  let invoiced = false;
  const sentIds = new Set();
  for (const c of sent || []) {
    const old = c?.id !== undefined && c?.id !== null && c?.id !== '' ? byId.get(String(c.id)) : null;
    if (old) sentIds.add(String(old.id));
    if (old && onApprovedInvoice(old)) continue;
    if (isApproved(c) !== (old ? isApproved(old) : false)) approve = true;
    if (old && onOpenInvoice(old) && lineChanged(c, old)) invoiced = true;
  }
  const gone = removed
    ? removed.map((id) => byId.get(String(id))).filter(Boolean)
    : (stored || []).filter((r) => !sentIds.has(String(r.id)));
  if (gone.some(onOpenInvoice)) invoiced = true;
  return { approve, invoiced };
}

/**
 * The lines with their APPROVAL as stored, for a user who may not approve: a
 * stored line keeps its status and who approved it, a new one is unapproved.
 */
function holdApprovals(sent, stored) {
  const byId = indexed(stored);
  return (sent || []).map((c) => {
    const old = c?.id !== undefined && c?.id !== null && c?.id !== '' ? byId.get(String(c.id)) : null;
    if (old && onApprovedInvoice(old)) return c;
    const was = old ? isApproved(old) : false;
    if (isApproved(c) === was) return c;
    return {
      ...c,
      status: old ? old.status : '0',
      approved_by: old ? (old.approved_by ?? null) : null,
      approval_date: old ? (old.approval_date ?? null) : null,
    };
  });
}

/** Ids of stored lines on an open invoice - left alone without the right. */
const openInvoiceLineIds = (stored) => new Set((stored || []).filter(onOpenInvoice).map((r) => String(r.id)));

/* What the screen can change on a line. net_amount is not here: the freight
 * sheet works it out again for EVERY line before each save (ChargesComp
 * calculate()), approved ones included, so a difference in it is the sheet's
 * arithmetic, not the user's edit. partyId is not here either - see below. */
const EDITABLE_FIELDS = LINE_FIELDS.filter((f) => f !== 'net_amount' && f !== 'partyId');

const documentOf = (r) => r?.Invoice?.invoice_No || r?.invoice_id || 'its invoice';
const listOf = (items) => (items.length < 2 ? items.join('')
  : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const documentsOf = (rows) => listOf([...new Set(rows.map(documentOf))]);

/**
 * A LINE ON AN APPROVED INVOICE IS FROZEN on a save of the freight sheet -
 * read from the DATABASE, never from what the screen sent.
 *
 * The screen's copy can be stale. ACS-AE-728/27 (SNS, 2026-11-13): the sheet
 * reloaded half a second after raising ACS-JB-818/27, while its approval was
 * still being posted, and so showed the bill unapproved. Its three lines could
 * be removed, were removed and entered again, and went on two new bills - and
 * JB-818 stayed approved, with no lines, its 1,059,760.27 still in the ledger
 * and in Job P&L: the cost counted twice.
 *
 *   REMOVED   refused, and the whole save with it - the user meant to change
 *             the bill, and is told to un-approve it first.
 *   PARTY     refused the same way (as moveInvoiceToItsLines refuses it).
 *   ANYTHING ELSE  left as stored - the line is not written at all, so a stale
 *             copy cannot take it off its invoice or undo its approval either -
 *             with a warning when the user really changed something.
 *
 * @param sent     the lines the screen sent
 * @param stored   those lines as stored, each with its Invoice ({ approved, invoice_No })
 * @param removed  the ids the save deletes
 * @returns {{ refusal: string|null, warning: string|null, keep: Array }}
 *          keep - the sent lines less the frozen ones
 */
function approvedInvoiceLock(sent, stored, { removed = [] } = {}) {
  const byId = indexed(stored);
  const frozen = (id) => {
    if (id === undefined || id === null || id === '') return null;
    const r = byId.get(String(id));
    return r && onApprovedInvoice(r) ? r : null;
  };

  const gone = [].concat(removed || []).map(frozen).filter(Boolean);
  if (gone.length) {
    const names = listOf(gone.map((r) => r.particular || 'a charge'));
    const one = gone.length === 1;
    const docs = new Set(gone.map(documentOf)).size;
    return {
      refusal: `${names} ${one ? 'is' : 'are'} on ${documentsOf(gone)}, which ${docs === 1 ? 'is' : 'are'} approved, `
        + `so ${one ? 'it' : 'they'} cannot be removed. Un-approve ${docs === 1 ? 'it' : 'them'} first. Nothing was saved.`,
      warning: null,
      keep: sent || [],
    };
  }

  const keep = [];
  const moved = [];
  const edited = [];
  for (const c of sent || []) {
    const r = frozen(c?.id);
    if (!r) { keep.push(c); continue; }
    if ('partyId' in (c || {}) && !sameValue(c.partyId, r.partyId)) moved.push(r);
    else if (EDITABLE_FIELDS.some((f) => f in c && !sameValue(c[f], r[f]))) edited.push(r);
  }
  if (moved.length) {
    return {
      refusal: `${documentsOf(moved)} ${new Set(moved.map(documentOf)).size === 1 ? 'is' : 'are'} approved. `
        + 'Un-approve it before moving it to another party.',
      warning: null,
      keep: sent || [],
    };
  }
  return {
    refusal: null,
    warning: edited.length
      ? `${documentsOf(edited)} ${new Set(edited.map(documentOf)).size === 1 ? 'is' : 'are'} approved, so the changes to `
        + `${edited.length === 1 ? 'its line were' : 'those lines were'} not saved. Un-approve it to change them.`
      : null,
    keep,
  };
}

module.exports = {
  chargeRightsNeeded, holdApprovals, openInvoiceLineIds, onOpenInvoice, lineChanged, LINE_FIELDS,
  approvedInvoiceLock,
};

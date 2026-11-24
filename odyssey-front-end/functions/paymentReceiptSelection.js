/**
 * Which invoices a payment / receipt is paying, and how much of each.
 *
 * WHY THIS EXISTS
 * The Payments & Receipts list is paged, windowed to a period and searchable,
 * and the amounts used to live ON the rows of that list. So the moment the list
 * changed - a search, a page, a period - every amount typed against it was
 * gone, and a receipt could only ever pay invoices that happened to sit on one
 * screen together. A customer paying for invoices found by three different
 * searches could not be recorded as one receipt.
 *
 * The amounts now live here: a selection keyed by invoice id, kept apart from
 * the list. The list shows it (withSelection) and edits it (setAllocation), and
 * the totals, the journal and the save read it - never the rows on screen.
 *
 * AN ENTRY is the invoice as it was last seen, plus:
 *   receiving   what this receipt pays against it
 *   picked      the user chose it - a tick, a typed amount, the modal
 *   byKnockOff  auto knock-off added it from the list, nobody chose it
 *   saved       it was on the receipt being EDITED; see setAllocation
 *
 * Plain functions over plain objects, so the rules can be tested without the
 * screen, which has no tests of its own.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/* TO THE PAISA, because the amounts are floating point: 566,674.52 received
 * at 566,675 is -0.4799999999 open, not -0.48. So -0.48 against it left
 * +0.00000000006 - green, "still owed", never ticked - and ticking it put
 * -0.4799999999 in the box (the user's report, 2026-10-26). "|| 0" so a hair
 * below zero is 0, not -0. */
const toCents = (n) => (Math.round(num(n) * 100) / 100) || 0;

const keyOf = (invoice) => String(invoice?.id);

// What already stands settled on an invoice: `recieved` on a receivable,
// `paid` on a payable. The same reading the knock-off always used.
/* WHAT IS SETTLED ON AN INVOICE: its knock-offs added up -
 * Invoice_Transactions, the record of which voucher paid how much of it (the
 * invoice list sends every one). Its received / paid figure is a running total
 * kept beside them, and an edited receipt used to overwrite it: ACS-JI-605/27
 * read 718,706.75 received with 959,664.40 knocked off, and ticked on a
 * settlement it showed -718,706.75 (the user, 2026-11-06: "didn't we have
 * invoice_transactions for this exact case"). The figure only where the
 * invoice came with no knock-offs at all - an old one settled without them
 * (one on CargoLinkers), or a list that does not send them. */
export const settled = (invoice) => {
  const rows = invoice?.Invoice_Transactions;
  if (Array.isArray(rows) && rows.length) return toCents(rows.reduce((t, r) => t + num(r?.amount), 0));
  return num(invoice?.payType === 'Recievable' ? invoice?.recieved : invoice?.paid);
};

/**
 * Pay `amount` against `invoice`, as the USER asked.
 *
 * Any amount but zero makes it picked - below zero only as allowedAmount lets
 * it, against an invoice paid over. Zero takes it out of the selection -
 * EXCEPT an invoice that was on the receipt being edited. That one stays, at
 * zero: the server takes this receipt's old settlement off an invoice only if
 * the invoice is sent, so dropping it would leave the old payment standing
 * against an invoice the user meant to remove.
 */
export const setAllocation = (selection = {}, invoice, amount) => {
  const key = keyOf(invoice);
  const prev = selection[key];
  const next = { ...selection };
  const value = toCents(amount);

  if (value !== 0) {
    next[key] = {
      ...(prev || {}),
      ...invoice,
      receiving: value,
      picked: true,
      byKnockOff: false,
      saved: Boolean(prev?.saved),
    };
  } else if (prev?.saved) {
    next[key] = { ...prev, receiving: 0, picked: false, byKnockOff: false };
  } else {
    delete next[key];
  }
  return next;
};

/** Several allocations at once - the select-all box. */
export const setAllocations = (selection = {}, changes = []) =>
  changes.reduce((sel, { invoice, amount }) => setAllocation(sel, invoice, amount), selection);

/** The list as shown: each row carrying what the selection pays against it. */
export const withSelection = (rows = [], selection = {}) =>
  rows.map((row) => {
    const entry = selection[keyOf(row)];
    return { ...row, receiving: entry ? num(entry.receiving) : 0 };
  });

/**
 * What the count and the modal show: everything being paid, plus anything
 * picked that a knock-off did not reach. A saved invoice the user took off is
 * NOT shown - it is only carried so the save can remove it.
 */
export const selectedEntries = (selection = {}) =>
  Object.values(selection).filter((e) => num(e.receiving) !== 0 || e.picked);

/**
 * What the save sends: every entry, including saved ones taken down to zero -
 * see setAllocation for why those must go too.
 */
export const entriesToSubmit = (selection = {}) => Object.values(selection);

/**
 * A saved receipt's invoices, as the selection it starts from when edited:
 * each one it paid, at the amount it paid, picked and saved.
 */
export const seedFromSaved = (invoices = []) => {
  const selection = {};
  for (const invoice of invoices) {
    if (num(invoice?.receiving) > 0) {
      selection[keyOf(invoice)] = {
        ...invoice,
        receiving: num(invoice.receiving),
        picked: true,
        byKnockOff: false,
        saved: true,
      };
    }
  }
  return selection;
};

/**
 * The most that can go against an invoice. Lifted unchanged from the knock-off
 * this replaces: `constReceiving` is what THIS receipt already carried against
 * it, which cancels out on a new receipt and is added back when editing one.
 */
const maxFor = (invoice, editing) => {
  // With its round off: the ledger has the party owing the rounded total, and
  // the invoice counts as paid only at that - capped at the bare total, a
  // rounded invoice paid in full stayed part-paid.
  const total = num(invoice.total) + num(invoice.roundOff);
  const already = settled(invoice) - num(invoice.constReceiving);
  return editing
    ? total - already
    : (total - num(invoice.constReceiving)) - already;
};

// Under half a paisa is nothing - the server's own reading of "settled" (see
// functions/invoiceOwed there). Without it the float dust left by one
// invoice's share (300.3 - 100.1 is 200.20000000000002) rode on to the next
// invoice, which joined the receipt at 0.00000000000003.
const HALF_PAISA = 0.005;

/**
 * What an amount typed against an invoice may be.
 *
 * Above zero, as typed. Below zero only against an invoice already paid OVER,
 * and only as far as bringing it back to zero - an invoice of 1,120.50
 * received at 1,121 stands at -0.50, and -0.50 against it in an Adjust to bad
 * debts clears it (the user's report, 2026-10-26: the box turned -0.50 into
 * 0.50, so it could not be done). The receipt's total then goes below zero,
 * which the journal already posts the other way round - the party debited,
 * the chosen account credited.
 *
 * Anywhere else a minus is a slip and is dropped, as the boxes always did. Not
 * on an edit either - kept as it was when the server SET an edited receipt's
 * amount on the invoice (it now adds the difference; a share of an edited
 * receipt is never below zero).
 */
export const allowedAmount = (invoice, amount, editing = false) => {
  const value = num(amount);
  if (value >= 0) return value;
  const open = editing ? 0 : toCents(maxFor(invoice, false));
  return open < 0 ? Math.max(value, open) : -value;
};

/** Paid over: what is open on it is below zero - see allowedAmount. */
export const isOverpaid = (invoice) => toCents(maxFor(invoice, false)) < 0;

/**
 * What is left on an invoice once this receipt's amount is on it, to the
 * paisa - the list's Balance, its colour and its tick all read this one figure.
 * Editing, this receipt's earlier amount counts as open again. (As the list
 * always worked it: the bare total, not the round off.)
 */
export const balanceAfter = (invoice, editing = false) => {
  const already = settled(invoice) - (editing ? num(invoice?.constReceiving) : 0);
  return toCents(num(invoice?.total) - already - num(invoice?.receiving));
};

/**
 * Settled to the paisa by what this receipt pays - the row's tick. Editing a
 * voucher, by the same Balance the row shows (its own earlier share counted
 * as open again): read without it, an invoice the voucher had already paid
 * off showed its share as overpaid, so it stood unticked and ticking it
 * changed nothing - ACS-BRV-00660/25's own ACS-JI-1440/25 and ACS-JI-1521/25
 * (the user's screenshot, 2026-11-06). And only with something on it from
 * this receipt: an invoice paid off by others is not ticked here.
 */
export const isSettledHere = (invoice, editing = false) =>
  num(invoice?.receiving) !== 0 && balanceAfter(invoice, editing) === 0;

/**
 * What ticking an invoice puts against it: what is open on it, to the paisa.
 * Editing (or settling) a voucher, what is open plus what THIS voucher already
 * carried on it - every other receipt's share stays where it is.
 *
 * It was the WHOLE total when editing, made for a server that SET the
 * invoice's received to the edited receipt's share. The server now adds the
 * difference (functions/receiptEdit, advanceSettlement there), so the whole
 * total paid the invoice twice over what others had paid: ticking
 * ACS-JI-1303/26 against an advance put 251,860 on it and showed -8,173.75
 * (the user's screenshot, 2026-11-06).
 */
export const fullAmount = (invoice, editing = false) =>
  toCents(num(invoice?.total) - settled(invoice) + (editing ? num(invoice?.constReceiving) : 0));

// Oldest first, then by id so invoices raised in the same instant still come
// out in the same order every time.
const oldestFirst = (a, b) =>
  (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });

/**
 * Spread `amount` across invoices, oldest first.
 *
 * WHICH invoices: the ones the user picked, if any; otherwise `rows` - the
 * page on screen and as many pages after it as the amount needs (see
 * knockOffPool). What a previous knock-off added from the list is taken away first,
 * so typing the amount one digit at a time does not have each digit's
 * allocation turn into the next digit's "selection".
 *
 * HOW MUCH each: up to what is open on it, in date order - except the LAST,
 * which takes whatever is left. That last rule is kept exactly as it was: an
 * amount bigger than everything open lands on the newest invoice rather than
 * disappearing.
 */
export const knockOff = (selection = {}, rows = [], amount, editing = false) => {
  const kept = {};
  for (const [key, entry] of Object.entries(selection)) {
    if (!entry.byKnockOff) kept[key] = entry;
  }

  const picked = Object.values(kept).filter((e) => e.picked);
  const targets = [...(picked.length ? picked : rows)].sort(oldestFirst);

  const next = { ...kept };
  let remaining = num(amount);
  targets.forEach((invoice, index) => {
    let receiving = 0;
    if (remaining > 0) {
      if (index === targets.length - 1) {
        receiving = remaining;
        remaining = 0;
      } else {
        // Never below zero: an invoice paid over has less than nothing open,
        // and taking that off `remaining` handed its overpayment to the next.
        receiving = Math.max(0, Math.min(maxFor(invoice, editing), remaining));
        remaining -= receiving;
        if (remaining < HALF_PAISA) remaining = 0;
      }
    }

    const key = keyOf(invoice);
    if (picked.length) {
      // Chosen by the user, so it stays chosen even where the amount ran out.
      next[key] = { ...next[key], receiving };
    } else if (receiving > 0) {
      next[key] = { ...invoice, receiving, picked: false, byKnockOff: true, saved: false };
    }
  });
  return next;
};

/** The most a knock-off can spread over `rows` between them. */
export const openTotal = (rows = [], editing = false) =>
  rows.reduce((t, invoice) => t + Math.max(0, maxFor(invoice, editing)), 0);

/** The user chose invoices themselves - a knock-off then pays only those. */
export const hasPicked = (selection = {}) =>
  Object.values(selection).some((e) => e.picked && !e.byKnockOff);

/**
 * The invoices a knock-off with nothing picked spreads over: the page on
 * screen, then the pages after it, one at a time, until what is open on them
 * covers the amount or the list runs out.
 *
 * It was the page on screen alone. An amount bigger than that page landed its
 * whole remainder on the page's last invoice - knockOff's "last takes what is
 * left" - while the party's invoices on the next pages stayed open. Now "last"
 * is the last invoice the amount needs, or the party's newest when the amount
 * is more than everything open.
 *
 * `loadPage(n)` fetches page n of the same list - same party, period and
 * search, oldest first like the server pages it. An invoice already in hand is
 * not taken twice, should the list have shifted between pages.
 */
export const knockOffPool = async ({
  rows = [], amount, editing = false, page = 1, pageSize = 50, count = 0, loadPage,
}) => {
  const pool = [...rows];
  const seen = new Set(pool.map(keyOf));
  const lastPage = Math.ceil(num(count) / Math.max(1, num(pageSize)));
  for (let next = page + 1; next <= lastPage; next += 1) {
    if (openTotal(pool, editing) + HALF_PAISA >= num(amount)) break;
    // One page at a time on purpose: the next is fetched only if this one
    // was not enough.
    const more = await loadPage(next);
    for (const invoice of more || []) {
      if (!seen.has(keyOf(invoice))) {
        seen.add(keyOf(invoice));
        pool.push(invoice);
      }
    }
  }
  return pool;
};

/**
 * The receipt's total and its exchange gain/loss, from the selection.
 *
 * The arithmetic is the screen's own, with one correction: an invoice with
 * nothing against it contributes nothing. It used to be read from EVERY row on
 * screen, and a foreign-currency row with nothing typed against it fell back to
 * its PREVIOUS receipts - so each part-paid invoice that merely happened to be
 * on the page added gain/loss on money this receipt never touched.
 */
export const receiptTotals = (entries = [], exRate) => {
  let total = 0;
  let gainLoss = 0;
  const rate = num(exRate);
  for (const x of entries) {
    const receiving = num(x.receiving);
    if (!receiving) continue;
    total += x.payType === 'Recievable' ? receiving : -receiving;
    if (x.currency !== 'PKR') {
      const invoiceRate = num(x.ex_rate);
      gainLoss += x.payType !== 'Payble'
        ? (receiving * rate) - (receiving * invoiceRate)
        : (receiving * invoiceRate) - (receiving * rate);
    }
  }
  return { total, gainLoss };
};

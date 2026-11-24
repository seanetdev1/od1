/**
 * Plan a ledger import - Vouchers, Voucher_Heads, and invoice settlement.
 *
 * Pure: no database, no network. Everything arrives in `context`, so every
 * decision below is testable against real legacy rows.
 *
 * TWO PHASES, NOT ONE PASS
 *
 * The old importer nested settlement inside the voucher loop, which meant a
 * voucher could only settle invoices that happened to be in its own payload.
 * Here they are separate:
 *
 *   planVouchers     53,129 vouchers with their 121,967 detail lines
 *   planSettlements  38,330 GL_InvAdjustments -> Invoice_Transactions
 *
 * Settlement runs second because it needs both sides to exist. It finds its
 * voucher through Voucher_Heads.climaxId: GL_InvAdjustments points at a
 * voucher DETAIL line (GVDetailId), not at the voucher, and the head carries
 * that legacy detail id already - so no second join into the legacy database.
 *
 * WHICH INVOICE A SETTLEMENT BELONGS TO
 *
 * GL_InvAdjustments.InvoiceId points at GL_Invoices - the ACCOUNTING document.
 * The migrated Invoice rows carry the id of the OPERATIONAL document
 * (GL_JobInvoice / GL_JobBill / GL_AgentInvoice). Those id spaces overlap:
 * GL_Invoices runs to 40,023 and GL_JobInvoice to 15,362, so treating one as
 * the other finds a real invoice belonging to a different party. The legacy
 * endpoint resolves it through GLInvoiceId and sends { table, legacyId }, and
 * the invoice is matched on climaxId AND partyType - the identity it was
 * actually imported with.
 *
 * PAID AND RECEIVED ARE NOT THE SAME NUMBER
 *
 * The old importer incremented both by the settled amount on every invoice, so
 * everything read as fully paid AND fully received. Only one side moves: a
 * receivable is received, a payable is paid. Every invoice already carries the
 * payType that says which.
 */

const { legacyTimestamp } = require('./legacyTime');
const {
  resolveVoucherType,
  resolveAccountType,
  isPayableAccount,
  sequenceFromNumber,
  partyDetailLine,
} = require('./ledgerMapping');

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function toLegacyId(value) {
  const n = num(value);
  return n === null ? null : n;
}

/**
 * Shape a legacy detail row into what ledgerMapping expects.
 *
 * That module reads the nested legacy include shape (line.GL_COA.GL_COA
 * .AccountName for the parent). The accounts come from Odyssey's own
 * Child_Account rows, which carry the same ids, names, sub-categories and
 * parents - so the rules are applied to exactly the chart of accounts the
 * system will use, not a second copy shipped alongside.
 */
function shapeLine(detail, accounts) {
  const account = accounts.get(String(detail.COAAccountId)) || null;
  const parent = account && account.parentId !== null && account.parentId !== undefined
    ? accounts.get(String(account.parentId))
    : null;

  return {
    ...detail,
    GL_COA: {
      Id: detail.COAAccountId,
      AccountName: account ? account.title : '',
      GL_COASubCategory: { SubCategory: account ? account.subCategory : '' },
      GL_COA: { AccountName: parent ? parent.title : '' },
    },
  };
}

/**
 * A line's net value: debit minus credit. Positive is a debit, negative a
 * credit.
 *
 * NEGATIVE AMOUNTS ARE A SIDE, NOT A TYPO. Climax stores some lines as a
 * negative figure in one column - DebitLC -500 meaning a credit of 500. Taking
 * "whichever column is non-zero" called that a DEBIT, and the model's hook
 * then stripped the sign: debit 500 where the ledger holds credit 500, an
 * error of twice the amount on both the account and the voucher's balance.
 * Netting the two columns reads it the way the legacy trial balance does.
 *
 * Nulls count as zero - a column is often null rather than 0. Rounded to six
 * places so a line carrying both columns does not import float dust.
 */
function netAmount(debit, credit) {
  const n = (num(debit) || 0) - (num(credit) || 0);
  return Math.round(n * 1e6) / 1e6;
}

/** The amount on a voucher head, as a magnitude - direction is sideType's. */
function sideAmount(debit, credit) {
  return Math.abs(netAmount(debit, credit));
}

/**
 * Debit or credit, decided on the local-currency columns. A line that nets to
 * nothing is a credit, as it always was.
 */
function sideType(debitLC, creditLC) {
  return netAmount(debitLC, creditLC) > 0 ? 'debit' : 'credit';
}

/**
 * Vouchers raised by an invoice or a bill. The ledger shows these on the
 * document's date - see ledgerDate.
 */
const INVOICE_VOUCHER_TYPES = new Set(['SI', 'PI']);

/**
 * The date a voucher stands on in the ledger, which places every line by
 * createdAt.
 *
 * AN SI OR PI STANDS ON ITS INVOICE'S DATE. Climax sets VoucherDate to it -
 * every one of CargoLinkers' 23,486 SI vouchers, and all but 3 of 57,094 PI,
 * where Climax itself booked on a later date and its ledger shows that one.
 * Dated by AddOn instead, an invoice keyed in after the day it was raised sat
 * in the next period: SI-01732/27, for JI-1743/27 of 31 August, was entered on
 * 1 September and showed in September. On CargoLinkers 12,662 sat in the wrong
 * month. The CFO's ruling (2026-10-02): always the invoice date.
 *
 * Every other voucher stays on its entry time - the ruling covers SI and PI,
 * and was deliberately not extended. VoucherDate is a date, midnight, and is
 * not shifted - see functions/legacyTime.
 */
function ledgerDate(row, vType) {
  if (INVOICE_VOUCHER_TYPES.has(vType) && row.VoucherDate) return row.VoucherDate;
  return legacyTimestamp(row.AddOn) || row.VoucherDate || null;
}

/** Map one legacy voucher onto Vouchers columns. */
function mapVoucher(row, resolved, context) {
  const number = str(row.VoucherNo);
  const leading = resolved.leadingLine || {};

  return {
    // INTEGER and NOT NULL. sequenceFromNumber returns null for a number it
    // cannot parse rather than throwing, and a voucher with no number is
    // rejected before this point.
    voucher_No: Number(resolved.sequence),
    voucher_Id: number,

    type: resolved.type,
    vType: resolved.vType,

    currency: context.currencies.get(String(row.CurrencyId)) || 'PKR',
    exRate: num(row.ExchangeRate) === null ? null : String(num(row.ExchangeRate)),

    chequeNo: str(leading.ChequeNumber),
    chequeDate: leading.ChequeDate ? String(leading.ChequeDate) : null,

    voucherNarration: str(row.Narration),
    // The legacy cost centre is an id into GL_PropertiesLOV that this stage
    // does not decode; "KHI" is what the working importer wrote and what the
    // existing migrated vouchers already carry.
    costCenter: 'KHI',

    onAccount: resolved.partyType,
    partyType: resolved.partyType,
    partyId: resolved.party ? String(resolved.party.id) : null,
    partyName: resolved.party ? resolved.party.name : null,

    tranDate: row.VoucherDate ? String(row.VoucherDate) : null,
    createdBy: str(row.AddLog),

    CompanyId: resolved.companyId,
    climaxId: toLegacyId(row.Id),

    // The voucher's own dates. Ledger reports order on these - see ledgerDate.
    //
    // Entry times are Pakistan wall clock - see functions/legacyTime. Left as
    // Climax sent them, every voucher entered after 19:00 sat on the next day
    // in the ledger. The VoucherDate fallback is a date and does not move.
    createdAt: ledgerDate(row, resolved.vType),
    updatedAt: legacyTimestamp(row.EditOn || row.AddOn) || row.VoucherDate || null,
  };
}

/** Map one legacy detail line onto Voucher_Heads columns. */
function mapVoucherHead(line, voucherDates) {
  const account = line.GL_COA || {};

  return {
    // Local currency, then voucher currency. The model's hooks force both to
    // magnitudes - direction lives in `type` - so a signed legacy value cannot
    // unbalance the trial balance.
    defaultAmount: String(sideAmount(line.DebitLC, line.CreditLC)),
    // NOT NULL with a notEmpty validator that bulkCreate does not run, so it
    // is guaranteed here: '0' rather than null when a line carries nothing.
    amount: String(sideAmount(line.DebitVC, line.CreditVC)),
    type: sideType(line.DebitLC, line.CreditLC),

    narration: str(line.NarrationVD),
    accountType: resolveAccountType({
      AccountName: account.AccountName,
      GL_COASubCategory: account.GL_COASubCategory,
    }),

    // Child_Account.id IS the legacy GL_COA id - the accounts stage preserves
    // it deliberately - so this needs no lookup table.
    ChildAccountId: line.COAAccountId,
    climaxId: toLegacyId(line.Id),

    createdAt: voucherDates.createdAt,
    updatedAt: voucherDates.updatedAt,
  };
}

/**
 * Plan one batch of vouchers with their detail lines.
 *
 * context:
 *   existingClimaxIds  legacy voucher ids already imported
 *   accounts           Map<coaId, { id, title, subCategory, parentId }>
 *   partyByAccount     Map<childAccountId, { id, name }>
 *   companies          Map<legacySubCompanyId, odysseyCompanyId>
 *   currencies         Map<legacyCurrencyId, code>
 *   voucherTypes       Map<legacyTypeId, { TypeCode, VoucherType }>
 *   details            every GL_Voucher_Detail row for these vouchers
 */
function planVouchers(rows, context = {}) {
  const existing = new Set((context.existingClimaxIds || []).map((x) => String(x)));
  const accounts = context.accounts || new Map();
  const partyByAccount = context.partyByAccount || new Map();
  const companies = context.companies || new Map();
  const currencies = context.currencies || new Map();
  const voucherTypes = context.voucherTypes || new Map();
  /* The voucher DETAIL lines that GL_InvAdjustments points at - i.e. the lines
   * that were applied to an invoice or bill. A voucher settles a document if
   * any of its lines is in here, and that is what decides whether it belongs
   * in Payments & Receipts or in the Voucher List. See resolveVoucherType.
   *
   * Supplied by the legacy server with the page, because only it can see
   * GL_InvAdjustments. Absent, every voucher reads as settling nothing - which
   * is the safe direction: the Voucher List shows everything, so a
   * misclassified voucher is findable there. */
  const settledDetailIds = new Set(
    (context.settledDetailIds || []).map((x) => String(x))
  );

  // Detail lines grouped by the voucher they belong to, in their stored order:
  // which line comes first is what partyDetailLine reads.
  const detailsByVoucher = new Map();
  for (const d of context.details || []) {
    const key = String(d.VoucherId);
    if (!detailsByVoucher.has(key)) detailsByVoucher.set(key, []);
    detailsByVoucher.get(key).push(d);
  }

  const toCreate = [];
  const problems = {
    missingId: 0,
    unnumbered: [],
    withoutLines: [],
    duplicateClimaxIds: [],
    unknownVoucherType: [],
  };
  const stats = {
    seen: rows.length,
    alreadyImported: 0,
    toCreate: 0,
    heads: 0,
    voided: 0,
    // How many of this batch settle a document, and so reach Payments &
    // Receipts rather than the Voucher List. Reported because the split is
    // severe and worth seeing: on CargoLinkers it is 136 of 7,525.
    settlesInvoice: 0,
    withoutParty: 0,
    withoutCompany: 0,
    unresolvedAccounts: 0,
    payable: 0,
    receivable: 0,
    multiplePartyLines: 0,
  };

  const seenInBatch = new Set();

  for (const row of rows) {
    const legacyId = toLegacyId(row.Id);
    if (legacyId === null) { problems.missingId += 1; continue; }

    const key = String(legacyId);
    if (existing.has(key)) { stats.alreadyImported += 1; continue; }
    if (seenInBatch.has(key)) { problems.duplicateClimaxIds.push(legacyId); continue; }

    // voucher_No is INTEGER NOT NULL and voucher_Id is NOT NULL. A voucher
    // with no number cannot satisfy either without inventing one, and an
    // invented number collides with a real voucher. Reported, not guessed.
    const sequence = sequenceFromNumber(row.VoucherNo);
    if (!str(row.VoucherNo) || sequence === null) {
      problems.unnumbered.push(legacyId);
      continue;
    }

    const rawLines = detailsByVoucher.get(key) || [];
    if (!rawLines.length) {
      // A voucher with no lines moves no money and has no party or account.
      problems.withoutLines.push(legacyId);
      continue;
    }

    seenInBatch.add(key);

    const lines = rawLines.map((d) => shapeLine(d, accounts));
    for (const l of lines) {
      if (!accounts.has(String(l.COAAccountId))) stats.unresolvedAccounts += 1;
    }

    const partyLine = partyDetailLine(lines) || lines[0];
    const payable = isPayableAccount(partyLine);
    const partyType = payable ? 'vendor' : 'client';
    if (payable) stats.payable += 1; else stats.receivable += 1;

    // The party is reached through its ACCOUNT, not through a legacy party id:
    // a voucher names a subledger account, and Client_Associations is what ties
    // that account to a client.
    const party = partyByAccount.get(String(partyLine.COAAccountId)) || null;
    if (!party) stats.withoutParty += 1;

    const partyLines = lines.filter((l) => {
      const s = (accounts.get(String(l.COAAccountId)) || {}).subCategory || '';
      return s.includes('Customer') || s.includes('Vendor');
    });
    if (partyLines.length > 1) stats.multiplePartyLines += 1;

    const VT = voucherTypes.get(String(row.VoucherTypeId)) || {};
    if (!VT.TypeCode) problems.unknownVoucherType.push(legacyId);
    // Does any line of this voucher pay off a document? That, not the legacy
    // type name, is what puts it on the Payments & Receipts screen.
    const settlesInvoice = lines.some((l) => settledDetailIds.has(String(l.Id)));
    if (settlesInvoice) stats.settlesInvoice += 1;
    const { type, vType } = resolveVoucherType(VT, settlesInvoice);

    const companyId = companies.has(String(row.SubCompanyId))
      ? companies.get(String(row.SubCompanyId))
      : null;
    if (companyId === null) stats.withoutCompany += 1;

    if (row.IsVoid === true) stats.voided += 1;

    const voucher = mapVoucher(row, {
      sequence, type, vType, partyType, party, companyId,
      leadingLine: lines[0],
    }, { currencies });

    const dates = { createdAt: voucher.createdAt, updatedAt: voucher.updatedAt };
    const heads = lines.map((l) => mapVoucherHead(l, dates));
    stats.heads += heads.length;

    toCreate.push({ voucher, heads });
  }

  stats.toCreate = toCreate.length;

  return {
    toCreate,
    stats,
    problems,
    canApply: problems.missingId === 0 && problems.duplicateClimaxIds.length === 0,
  };
}

/**
 * Plan one batch of invoice settlements.
 *
 * context:
 *   existingClimaxIds  legacy adjustment ids already imported
 *   invoiceByKey       Map<'JobInvoice|123', { id, payType, total }>
 *   voucherByHead      Map<legacyDetailId, odysseyVoucherId>
 *   invoiceRefs        [{ glInvoiceId, table, legacyId }] for this page
 */
function planSettlements(rows, context = {}) {
  const existing = new Set((context.existingClimaxIds || []).map((x) => String(x)));
  const invoiceByKey = context.invoiceByKey || new Map();
  const voucherByHead = context.voucherByHead || new Map();

  // GL_Invoices id -> the operational document it belongs to.
  const docByGlId = new Map();
  for (const ref of context.invoiceRefs || []) {
    docByGlId.set(String(ref.glInvoiceId), ref);
  }

  const toCreate = [];
  // Per-invoice totals to add, so one invoice touched by many settlements is
  // updated once rather than once per settlement.
  const applyToInvoice = new Map();

  const problems = {
    missingId: 0,
    duplicateClimaxIds: [],
    unknownInvoice: [],
    unknownVoucher: [],
  };
  const stats = {
    seen: rows.length,
    alreadyImported: 0,
    toCreate: 0,
    withoutInvoice: 0,
    withoutVoucher: 0,
    zeroAmount: 0,
    negativeAmount: 0,
    settledToReceivable: 0,
    settledToPayable: 0,
    totalSettled: 0,
  };

  const seenInBatch = new Set();

  for (const row of rows) {
    const legacyId = toLegacyId(row.Id);
    if (legacyId === null) { problems.missingId += 1; continue; }

    const key = String(legacyId);
    if (existing.has(key)) { stats.alreadyImported += 1; continue; }
    if (seenInBatch.has(key)) { problems.duplicateClimaxIds.push(legacyId); continue; }

    // The accounting invoice id, translated to the operational document, then
    // to the Odyssey invoice by climaxId AND partyType - see the header.
    const doc = docByGlId.get(String(row.InvoiceId));
    const invoice = doc
      ? invoiceByKey.get(`${doc.table}|${doc.legacyId}`)
      : undefined;

    if (!invoice) {
      stats.withoutInvoice += 1;
      if (problems.unknownInvoice.length < 50) problems.unknownInvoice.push(legacyId);
      continue;
    }

    // GL_InvAdjustments names a voucher DETAIL line. The head imported from
    // that line carries its legacy id, which is how the voucher is reached.
    const voucherId = voucherByHead.get(String(row.GVDetailId));
    if (voucherId === undefined) {
      stats.withoutVoucher += 1;
      if (problems.unknownVoucher.length < 50) problems.unknownVoucher.push(legacyId);
      continue;
    }

    seenInBatch.add(key);

    const amount = num(row.Amount) || 0;
    if (amount === 0) stats.zeroAmount += 1;
    if (amount < 0) stats.negativeAmount += 1;
    stats.totalSettled += amount;

    toCreate.push({
      // NOT NULL with a notEmpty validator that bulkCreate does not run.
      // '0', not an invented figure: gain/loss is the difference between the
      // settlement rate and the invoice rate, and nothing here knows the
      // settlement rate. An invented exchange gain is worse than none.
      gainLoss: '0',
      amount: String(amount),
      InvoiceId: invoice.id,
      VoucherId: voucherId,
      climaxId: legacyId,
      createdAt: legacyTimestamp(row.AddOn) || row.InvAdjDate || null,
      updatedAt: legacyTimestamp(row.EditOn || row.AddOn) || row.InvAdjDate || null,
    });

    // Only one side moves. A receivable is received; a payable is paid.
    const receivable = invoice.payType !== 'Payble';
    if (receivable) stats.settledToReceivable += 1; else stats.settledToPayable += 1;

    const acc = applyToInvoice.get(String(invoice.id))
      || { id: invoice.id, receivable, amount: 0 };
    acc.amount += amount;
    applyToInvoice.set(String(invoice.id), acc);
  }

  stats.toCreate = toCreate.length;
  stats.totalSettled = Math.round(stats.totalSettled * 100) / 100;

  return {
    toCreate,
    applyToInvoice: [...applyToInvoice.values()],
    stats,
    problems,
    canApply: problems.missingId === 0 && problems.duplicateClimaxIds.length === 0,
  };
}

/* ------------------------------------------------------------------------ *
 * Numbering the vouchers Climax never numbered.
 * ------------------------------------------------------------------------ */

// "SNS-TV-00031/24" -> prefix "SNS-TV-", digits "00031", suffix "24".
// "BPV-00001/25" (CargoLinkers, no company) parses the same way.
const NUMBER_SHAPE = /^(.*-)(\d+)\/(\d+)$/;

/**
 * A number for each legacy voucher that has none, FILLING THE GAP IT SITS IN.
 *
 * The user's rule. planVouchers still refuses to invent a number inside a
 * batch, because a batch cannot see the rest of the book and an invented
 * number could belong to a real voucher on a later page. This runs once, after
 * every numbered voucher is in, when the whole sequence is visible.
 *
 * For each voucher, among the vouchers of the same company and type:
 *
 *   the year     the fiscal-year suffix of the vouchers either side of it by
 *                date. If those two disagree it sits on a year boundary and is
 *                refused rather than guessed.
 *   the anchor   the highest number in that year dated on or before it
 *   the number   the first number above the anchor that nobody holds
 *
 * so SNS's TV of 7 Mar 2024, between SNS-TV-00030/24 (28 Feb) and
 * SNS-TV-00034/24 (15 Mar), becomes SNS-TV-00031/24. Numbers taken here count
 * as held, so two gaps in one sequence get two numbers, not one.
 *
 * Laid out like its neighbours - same prefix, same zero-padding - so it reads
 * as one of the series and sequenceFromNumber parses it as any other.
 *
 * @param rows     the unnumbered GL_Voucher rows
 * @param context  companies     Map<legacySubCompanyId, odysseyCompanyId>
 *                 voucherTypes  Map<legacyTypeId, GL_VoucherType row>
 *                 existing      [{ CompanyId, vType, voucher_Id, tranDate }]
 *                               - every voucher already in Odyssey
 * @returns { assigned: [{ legacyId, VoucherNo }], unresolved: [{ legacyId, reason }] }
 */
function assignGapNumbers(rows, context = {}) {
  const companies = context.companies || new Map();
  const voucherTypes = context.voucherTypes || new Map();

  // Every parseable number, grouped by company and type.
  const groups = new Map();
  for (const v of context.existing || []) {
    const m = NUMBER_SHAPE.exec(String(v.voucher_Id || '').trim());
    if (!m) continue;
    const key = `${v.CompanyId}|${v.vType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      prefix: m[1], digits: m[2], seq: Number(m[2]), suffix: m[3],
      at: Date.parse(v.tranDate),
    });
  }

  const assigned = [];
  const unresolved = [];
  const refuse = (legacyId, reason) => unresolved.push({ legacyId, reason });

  // Oldest first, so two unnumbered vouchers in one gap number in date order.
  const ordered = [...rows].sort((a, b) => Date.parse(a.VoucherDate) - Date.parse(b.VoucherDate));

  for (const row of ordered) {
    const legacyId = toLegacyId(row.Id);
    const companyId = companies.get(String(row.SubCompanyId));
    if (companyId === undefined) { refuse(legacyId, `company ${row.SubCompanyId} is not in Odyssey`); continue; }

    const VT = voucherTypes.get(String(row.VoucherTypeId));
    if (!VT || !VT.TypeCode) { refuse(legacyId, `voucher type ${row.VoucherTypeId} is unknown`); continue; }
    const { vType } = resolveVoucherType(VT, false);

    const at = Date.parse(row.VoucherDate);
    if (Number.isNaN(at)) { refuse(legacyId, 'it has no voucher date'); continue; }

    const group = (groups.get(`${companyId}|${vType}`) || []).filter((v) => !Number.isNaN(v.at));
    if (!group.length) { refuse(legacyId, `there are no other ${vType} vouchers for its company to number it after`); continue; }

    // The neighbours by date: the latest on or before it, the earliest on or after.
    const before = group.filter((v) => v.at <= at)
      .sort((a, b) => (b.at - a.at) || (b.seq - a.seq))[0];
    const after = group.filter((v) => v.at >= at)
      .sort((a, b) => (a.at - b.at) || (a.seq - b.seq))[0];
    if (before && after && before.suffix !== after.suffix) {
      refuse(legacyId, `it falls between fiscal years /${before.suffix} and /${after.suffix}`);
      continue;
    }
    const suffix = (before || after).suffix;

    const year = group.filter((v) => v.suffix === suffix);
    const held = new Set(year.map((v) => v.seq));
    const anchor = year.filter((v) => v.at <= at).reduce((max, v) => Math.max(max, v.seq), 0);

    let seq = anchor + 1;
    while (held.has(seq)) seq += 1;

    // Laid out like the anchor, or the first of the year when it is the first.
    const model = year.find((v) => v.seq === anchor) || year[0];
    const digits = String(seq).padStart(model.digits.length, '0');
    const VoucherNo = `${model.prefix}${digits}/${suffix}`;

    // Held from now on, so the next voucher in the same gap takes the next one.
    groups.get(`${companyId}|${vType}`).push({ prefix: model.prefix, digits, seq, suffix, at });

    assigned.push({ legacyId, VoucherNo });
  }

  return { assigned, unresolved };
}

module.exports = {
  planVouchers,
  planSettlements,
  assignGapNumbers,
  // Exported for unit tests.
  shapeLine,
  sideAmount,
  sideType,
  mapVoucher,
  mapVoucherHead,
};

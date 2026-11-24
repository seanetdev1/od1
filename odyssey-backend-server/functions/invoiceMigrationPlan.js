/**
 * Plan an invoice import - Invoice, and the charge lines each one carries.
 *
 * Pure: no database, no network. Everything it needs arrives in `context`, so
 * every decision below is unit-testable against real legacy rows.
 *
 * WHICH LEGACY TABLE IS THE INVOICE
 *
 * There are two things called an invoice in Climax and they are not the same
 * row:
 *
 *   GL_Invoices        the ACCOUNTING document a voucher raises. Carries the
 *                      settlement history (GL_InvAdjustments) that says what
 *                      was actually paid. Belongs to the ledger stage.
 *   GL_JobInvoice      the OPERATIONAL document: sent to the client, along
 *   GL_JobBill         with GL_JobBill (billed by a vendor) and
 *   GL_AgentInvoice    GL_AgentInvoice (an overseas agent, either direction).
 *
 * This stage imports the second group, because those are the only ones tied to
 * charge lines. The junction tables - GL_JobInvoice_Charges and friends - are
 * the sole place the invoice/charge-line relationship is recorded, and they
 * point at GL_JobInvoice.Id, not at GL_Invoices.Id. GL_JobInvoice.GLInvoiceId
 * joins the two, so the ledger stage can attach settlement later without this
 * stage having to guess at any of it.
 *
 * TWO POPULATIONS, BOTH IMPORTED
 *
 * 32,251 of the 40,026 legacy invoices belong to a job. The other 7,775 are
 * cutover OPENING BALANCES: numbered ACS-OJI / ACS-OJB / SNS-OA, carrying no
 * job and no charge lines. The prefix predicts it exactly - every invoice with
 * a job id is numbered JI/JB/AI and every one without is numbered OJI/OJB/OA,
 * across all three tables with no exception.
 *
 * The openings are well formed: every one has a party, a currency, a date and
 * a company, all are status 1, none is zero, and their numbers do not collide
 * with anything. They date from 2006 to 2022 and carry 530M receivable, 770M
 * payable and 2.68M of agent balances, 276 of them negative (credit notes).
 *
 * They import as Odyssey's own opening types - "Opening Invoice" and
 * "Opening Bill", which is what /invoice/openingInvoice creates and what
 * /invoice/getOpeningInvoices reads - with SEJobId null. Their operation comes
 * from OperationTypeId, decoded below.
 *
 * Like every other invoice here they land fully outstanding, because what was
 * collected against them lives in GL_InvAdjustments and that is the ledger
 * stage. Until it runs, receivables and payables read high by whatever has
 * since been settled.
 *
 * WHAT IS DELIBERATELY NOT SET
 *
 *   paid / recieved  Both '0'. What was collected lives in GL_InvAdjustments,
 *                    which this stage does not read. Left at zero an invoice
 *                    reads as fully outstanding, which is wrong but VISIBLY
 *                    wrong; invented from NetAmount it would read as fully
 *                    settled, which is wrong and looks right.
 *   status           '1' - open. '3' means settled and nothing here knows
 *                    whether it was.
 *   Invoice_Transactions
 *                    Not created. The job P&L reads these to split realized
 *                    from unrealized revenue, and a transaction with no
 *                    voucher behind it is a fabricated payment.
 *
 * THE TYPE STRINGS ARE THE UI's, MISSPELLINGS INCLUDED
 *
 * Invoice.type is one of "Job Invoice", "Job Bill", "Agent Invoice",
 * "Agent Bill" - the same vocabulary as Charge_Head.invoiceType, which the job
 * P&L matches on exactly. Invoice.payType is "Recievable" / "Payble",
 * misspelled to match Charge_Head.type and every payType comparison in the
 * accounts screens. Correcting either spelling makes the rows invisible.
 */

const KINDS = {
  JobInvoice: {
    // Every Odyssey type this legacy table can produce. The already-imported
    // check scopes on these TOGETHER WITH partyType, because the opening types
    // are shared with GL_AgentInvoice and a legacy id is only unique within
    // its own table - scoping on type alone would let an agent opening look
    // like an already-imported client opening.
    types: ['Job Invoice', 'Opening Invoice'],
    type: 'Job Invoice',
    payType: 'Recievable',
    openingType: 'Opening Invoice',
    openingPayType: 'Recievable',
    partyType: 'client',
    partyKey: 'PartyId',
    // GL_JobBill names these columns Bill*, not Invoice*. Reading the wrong
    // one does not fail - it returns undefined, and every bill lands with a
    // null currency and a null date.
    currencyKey: 'InvoiceCurrencyId',
    dateKey: 'InvoiceDate',
    remarksKey: 'InvoiceRemarks',
    statusKey: 'InvoiceStatusId',
  },
  JobBill: {
    types: ['Job Bill', 'Opening Bill'],
    type: 'Job Bill',
    payType: 'Payble',
    openingType: 'Opening Bill',
    openingPayType: 'Payble',
    partyType: 'vendor',
    partyKey: 'PartyId',
    currencyKey: 'BillCurrencyId',
    dateKey: 'BillDate',
    remarksKey: 'BillRemarks',
    statusKey: 'BillStatusId',
  },
  AgentInvoice: {
    // One legacy table, four Odyssey types - see typeForAgent below. The
    // opening pair is shared with the other two tables, which is why
    // partyType is part of the identity check.
    types: ['Agent Invoice', 'Agent Bill', 'Opening Invoice', 'Opening Bill'],
    type: null,
    payType: null,
    openingType: null,
    openingPayType: null,
    partyType: 'agent',
    partyKey: 'OverseasAgentId',
    currencyKey: 'InvoiceCurrencyId',
    dateKey: 'InvoiceDate',
    remarksKey: 'InvoiceRemarks',
    statusKey: 'InvoiceStatusId',
  },
};

/**
 * A legacy invoice is live only if its status is 1.
 *
 * Established from the data rather than assumed, and the split is total:
 *
 *   status 1   31,800 invoices - every one carries charge lines, every one has
 *              a non-zero amount
 *   status 2      449 invoices - not one carries a charge line, every amount 0
 *   status 3        2 invoices - same
 *
 * No exceptions in either direction. Those 451 are invoices that were emptied
 * rather than deleted: the rows still hold their original remarks naming the
 * client, a VoucherId and a GLInvoiceId, and Version counts of 4 with EditOn a
 * year after AddOn. Someone stripped the lines and zeroed the amounts without
 * formally voiding - IsVoid is null on all of them.
 *
 * They are imported, because they hold real invoice numbers and the ledger
 * stage will find GL references pointing at them, but as UNAPPROVED. Odyssey
 * has no cancelled status, and its status '2' is not this one - it means an
 * invoice available for settlement, which /getAllOldInvoicesByPartyId and
 * /getTaskInvoices both select together with approved '1'. approved '0' is the
 * lever that keeps a cancelled document out of the payment-allocation screens.
 * They carry no money either way, so nothing sums differently.
 */
const LIVE_STATUS = 1;

/** Charge_Head.type for a junction column's side. */
const SIDE_TYPE = { Recv: 'Recievable', Payb: 'Payble' };

/**
 * Every charge-line column a junction row can carry, and what each one means.
 *
 * A legacy charge-line id is only unique within its own source table, so the
 * id alone identifies nothing - the COLUMN is what says which operation and
 * which side it came from. This is the same collision that silently dropped
 * 38,000 lines from the charge-line stage.
 *
 * Exactly one of these is populated on every junction row in the real data:
 * 119,601 rows, none with two.
 */
const LINE_COLUMNS = [
  ['SEJobChargesRecvId', 'SE', 'Recv'],
  ['SEJobChargesPaybId', 'SE', 'Payb'],
  ['SIJobChargesRecvId', 'SI', 'Recv'],
  ['SIJobChargesPaybId', 'SI', 'Payb'],
  ['AEJobChargesRecvId', 'AE', 'Recv'],
  ['AEJobChargesPaybId', 'AE', 'Payb'],
  ['AIJobChargesRecvId', 'AI', 'Recv'],
  ['AIJobChargesPaybId', 'AI', 'Payb'],
  // CUSTOMS CLEARANCE. These two used to be the "none of the eight columns"
  // case counted as logisticsLines and dropped - 16,779 of them on the freight
  // database, and on a clearing agent's database they are nearly every line
  // there is. The customs charge lines now import, so their invoice links can
  // be followed like any other.
  ['LGJobChargesRecvId', 'LG', 'Recv'],
  ['LGJobChargesPaybId', 'LG', 'Payb'],
];

/**
 * Which job column is populated says which operation the invoice belongs to.
 *
 * LGJobId is a logistics job - a stage that has not run - and is reported
 * separately from an invoice with no job at all, which is an opening balance.
 */
const JOB_COLUMNS = [
  ['SEJobId', 'SE'],
  ['SIJobId', 'SI'],
  ['AEJobId', 'AE'],
  ['AIJobId', 'AI'],
  ['LGJobId', 'LG'],
];

/**
 * OperationTypeId, which is the only thing an opening balance has to say which
 * trade it belongs to - it has no job to read it from.
 *
 * Not guessed: learned from the 13,387 job-linked invoices, where the id and
 * the populated job column can be compared directly. 1 -> AI (223 rows),
 * 2 -> AE (9,551), 3 -> SI (438), 4 -> SE (3,175), with no id mapping to two
 * operations.
 *
 * 185 agent openings carry OperationTypeId 7, which never appears on a
 * job-linked invoice and so cannot be decoded this way. Those get a null
 * operation rather than an invented one.
 */
const OPERATION_TYPE = { 1: 'AI', 2: 'AE', 3: 'SI', 4: 'SE' };

function toLegacyId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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

/**
 * The numeric sequence inside an invoice number.
 *
 * Odyssey's own numbering builds "ACS-JI-123/25" and stores 123 separately in
 * invoice_Id, which /makeInvoiceNew orders by to find the last invoice issued.
 * A migrated invoice with a null invoice_Id is invisible to that query, so the
 * next hand-made invoice reuses a number that already exists.
 *
 * Tolerant on purpose: this takes the digits immediately before the year
 * separator, falling back to the last run of digits in the string.
 */
function sequenceOf(invoiceNo) {
  const s = str(invoiceNo);
  if (!s) return null;

  const beforeSlash = s.includes('/') ? s.slice(0, s.lastIndexOf('/')) : s;
  const runs = beforeSlash.match(/\d+/g);
  if (!runs || !runs.length) return null;

  const last = runs[runs.length - 1].replace(/^0+/, '');
  return last === '' ? '0' : last;
}

function operationOf(row) {
  for (const [key, operation] of JOB_COLUMNS) {
    const id = toLegacyId(row[key]);
    if (id !== null) return { operation, legacyJobId: id };
  }
  return { operation: null, legacyJobId: null };
}

/**
 * Which direction an agent document runs: one we raised, or one raised against
 * us. GL_AgentInvoice is the source of BOTH Agent Invoices and Agent Bills -
 * there is no GL_AgentBill table.
 *
 * DebitCreditId is the header's own answer, and these two ids are what it
 * holds. They are NOT decoded from Gen_CommonLOV: that table's eight rows are
 * "Yes", "No", "99", "999" and so on, and say nothing about debit or credit.
 * They were established by cross-checking every job-linked agent invoice
 * against the side its own charge lines sit on:
 *
 *   DebitCreditId 3   1,446 invoices whose lines are ALL payable,  0 receivable
 *   DebitCreditId 5   1,256 invoices whose lines are ALL receivable, 0 payable
 *
 * 2,702 unambiguous cases, no contradiction in either direction, and no other
 * value appears in the data.
 *
 * The header decides rather than the lines, because it answers the cases the
 * lines cannot: 76 agent invoices carry no lines at all - every one of them a
 * bill - and 361 carry both sides at once, where counting lines is a guess.
 * The line side is kept as a cross-check, so an invoice whose lines contradict
 * its header is reported rather than quietly resolved one way.
 */
const AGENT_DIRECTION = {
  3: { type: 'Agent Bill', payType: 'Payble' },
  5: { type: 'Agent Invoice', payType: 'Recievable' },
};

function typeForAgent(sides, debitCreditId) {
  const recv = sides.Recv || 0;
  const payb = sides.Payb || 0;
  const mixed = Boolean(recv && payb);

  // What the lines say, when they say anything unambiguous.
  const fromLines = recv && !payb ? 'Agent Invoice'
    : payb && !recv ? 'Agent Bill'
      : null;

  const header = AGENT_DIRECTION[String(debitCreditId)];
  if (header) {
    return {
      ...header,
      source: 'header',
      mixed,
      conflict: Boolean(fromLines && fromLines !== header.type),
    };
  }

  // An unrecognised DebitCreditId. Rather than assume, fall back to the lines,
  // and to the majority side only if the lines disagree with each other.
  if (fromLines === 'Agent Invoice') {
    return { type: 'Agent Invoice', payType: 'Recievable', source: 'lines', mixed, conflict: false };
  }
  if (fromLines === 'Agent Bill') {
    return { type: 'Agent Bill', payType: 'Payble', source: 'lines', mixed, conflict: false };
  }
  if (mixed) {
    return recv >= payb
      ? { type: 'Agent Invoice', payType: 'Recievable', source: 'majority', mixed, conflict: false }
      : { type: 'Agent Bill', payType: 'Payble', source: 'majority', mixed, conflict: false };
  }
  return { type: null, payType: null, source: 'none', mixed: false, conflict: false };
}

/**
 * Group junction rows by invoice, decoding each line's operation and side from
 * the column it arrived in.
 *
 * A junction row with none of the eight columns populated belongs to a
 * logistics job (LGJobChargesRecvId / LGJobChargesPaybId, which this stage does
 * not request). There are 16,779 of them and they are counted, not silently
 * dropped, so the lgJobs stage has a number to hit.
 *
 * Returns { byInvoice: Map<id, { lines, sides }>, logisticsLines }.
 */
function groupLinks(links, parentKey) {
  const byInvoice = new Map();
  let logisticsLines = 0;

  for (const link of links || []) {
    const parent = toLegacyId(link[parentKey]);
    if (parent === null) continue;

    let entry = byInvoice.get(String(parent));
    if (!entry) {
      entry = { lines: [], sides: {} };
      byInvoice.set(String(parent), entry);
    }

    let found = false;
    for (const [column, operation, side] of LINE_COLUMNS) {
      const legacyId = toLegacyId(link[column]);
      if (legacyId === null) continue;
      entry.lines.push({ legacyId, operation, side });
      entry.sides[side] = (entry.sides[side] || 0) + 1;
      found = true;
    }
    if (!found) logisticsLines += 1;
  }

  return { byInvoice, logisticsLines };
}

/**
 * The amount the invoice is for.
 *
 * NetInclTaxAmount is what the party actually owes. In this data it is
 * populated on exactly the job-linked invoices - all 32,251 of them - and
 * always equals NetAmount + TaxAmount. NetAmount excludes tax and TotalAmount
 * excludes the discount as well, so both are fallbacks rather than choices.
 */
function totalOf(row) {
  const candidates = [row.NetInclTaxAmount, row.NetAmount, row.TotalAmount];
  for (const value of candidates) {
    const n = num(value);
    if (n !== null) return n;
  }
  return 0;
}

/**
 * Whether an invoice's own two amount columns contradict each other.
 *
 * At an exchange rate of 1, LocalAmount and the net amount are the same
 * quantity, so a row holding two different values for it is corrupt. That is
 * the whole test - deliberately narrow, because it is the only form of this
 * check that cannot produce a false positive.
 *
 * The looser version - LocalAmount = net x rate for every invoice - is NOT
 * used, because each charge line carries its own ExchRateLine, and a
 * multi-line foreign invoice whose lines were entered at different rates
 * legitimately fails it. Four agent invoices in this data do exactly that.
 *
 * One row fails the narrow test: job bill ACS-JB-143/23, whose header says
 * 829,677.12 while its single charge line, its voucher, its voucher detail and
 * its GL_Invoices row all say 3,650. The header is outvoted four to one, but
 * it is reported rather than overridden - correcting a financial figure is not
 * this stage's call to make.
 */
function amountsContradict(row, total) {
  const rate = num(row.ExchangeRate);
  if (rate !== 1) return false;
  const local = num(row.LocalAmount);
  if (local === null) return false;
  return Math.abs(local - total) > 1;
}

/** Map one legacy invoice onto Invoice columns. */
function mapInvoice(row, kind, resolved, context) {
  const spec = KINDS[kind];
  const legacyId = toLegacyId(row.Id);
  const invoiceNo = str(row.TranNumber);
  const party = resolved.party;
  const rate = num(row.ExchangeRate);

  // GL_JobBill calls it BillDate; TranDate is the posting date and is the
  // fallback, not the first choice.
  const date = row[spec.dateKey] || row.TranDate || null;

  return {
    invoice_No: invoiceNo,
    invoice_Id: sequenceOf(invoiceNo),

    type: resolved.type,
    payType: resolved.payType,
    partyType: spec.partyType,

    // '1' is open. Settlement is the ledger stage - see the header.
    status: '1',
    // Cancelled legacy invoices import unapproved, which is what keeps them
    // out of the settlement lists - see LIVE_STATUS.
    //
    // Openings import APPROVED, unlike /invoice/openingInvoice which creates
    // them with approved 0 for someone to review. These were already live and
    // approved in Climax - they are historical fact, not new entries awaiting
    // sign-off - and /invoice/getAllInvoicesByPartyId, which builds the
    // payment-allocation list, filters on approved '1'. Imported unapproved,
    // 1.3bn of balances could not be settled without approving 7,775 rows by
    // hand first.
    approved: resolved.cancelled ? '0' : '1',

    operation: resolved.operation,
    currency: context.currencies.get(String(row[spec.currencyKey])) || null,
    ex_rate: rate === null ? null : String(rate),

    /* THE PARTY'S LEDGER ACCOUNT, not the party. Every invoice raised in
     * Odyssey carries Child_Accounts.id here (routes/invoice createInvoices),
     * and approval posts the party line of the voucher to it. Writing the
     * Clients id made approving a migrated invoice fail on the voucher's
     * account foreign key (SNS-JI-426/27: party 51, account 5307), sent
     * ageing and the account statement to whichever account happened to
     * share the number, and was corrected by hand on 42,980 SNS invoices.
     * A party with no single ledger account keeps its Clients id: there is
     * no account to name, and the payments screen still finds it by party. */
    party_Id: party ? String(party.accountId ?? party.id) : null,
    party_Name: party ? party.name : null,

    paid: '0',
    recieved: '0',
    roundOff: '0',
    total: String(totalOf(row)),

    companyId: resolved.companyId === null ? null : String(resolved.companyId),
    note: str(row[spec.remarksKey]) || str(row.Remarks),

    SEJobId: resolved.jobId,
    climaxId: legacyId === null ? null : String(legacyId),

    // The invoice's own date, not the moment it was imported. Every invoice
    // listing and ageing report orders and buckets on createdAt, so importing
    // with today's date files fifteen years of invoices under one day.
    createdAt: date,
    updatedAt: date,
  };
}

/**
 * Plan one batch of one legacy invoice table.
 *
 * context:
 *   existingClimaxIds  legacy ids already imported for THIS KIND's types
 *   jobIdByLegacyId    Map<'SE|123', odysseyJobId> - operation-scoped, because
 *                      a legacy job id is only unique within its own table
 *   chargeHeadByKey    Map<'SE|Recievable|123', odysseyChargeHeadId>
 *   parties            Map<legacyPartyId, { id, name }>
 *   companies          Map<legacySubCompanyId, odysseyCompanyId>
 *   currencies         Map<legacyCurrencyId, code>
 *   links              junction rows for this batch
 *   parentKey          which column of `links` holds the invoice id
 */
function planInvoices(rows, kind, context = {}) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`Unknown invoice kind: ${kind}`);

  const existing = new Set((context.existingClimaxIds || []).map((x) => String(x)));
  const jobIdByLegacyId = context.jobIdByLegacyId || new Map();
  const chargeHeadByKey = context.chargeHeadByKey || new Map();
  const parties = context.parties || new Map();
  const companies = context.companies || new Map();
  const currencies = context.currencies || new Map();

  const { byInvoice, logisticsLines } = groupLinks(context.links, context.parentKey);

  const toCreate = [];
  // One entry per invoice that will be created, carrying the Charge_Head rows
  // to point at it. The invoice's own id is not known until it is inserted, so
  // these are matched up by the route afterwards.
  const linkPlan = [];

  const problems = {
    missingId: 0,
    missingInvoiceNo: 0,
    duplicateClimaxIds: [],
    orphaned: [],
    logisticsInvoices: [],
    mixedSideAgentInvoices: [],
    // An agent invoice whose DebitCreditId and whose charge lines disagree
    // about which way the document runs.
    agentDirectionConflicts: [],
    // An invoice whose status disagrees with whether it has any lines.
    statusContentMismatch: [],
    // An invoice whose own amount columns contradict each other at rate 1.
    contradictoryAmounts: [],
  };

  const stats = {
    seen: rows.length,
    alreadyImported: 0,
    toCreate: 0,
    // No job column at all: a cutover opening balance, deliberately skipped.
    openingBalances: 0,
    // Has a job id, but that job is not in Odyssey. A real gap.
    orphaned: 0,
    onLogisticsJobs: 0,
    voided: 0,
    // Emptied in Climax: no charge lines, zero amount, imported unapproved.
    cancelled: 0,
    unresolvedParty: 0,
    unresolvedCompany: 0,
    unresolvedCurrency: 0,
    withoutSequence: 0,
    agentDirectionFromHeader: 0,
    agentDirectionUndecided: 0,
    // Openings whose OperationTypeId is not one the job-linked invoices could
    // teach us - 185 agent openings carry a 7, which never appears with a job.
    openingsWithoutOperation: 0,
    // Credit notes: a negative balance carried in at cutover.
    negativeAmounts: 0,
    linesLinked: 0,
    linesUnresolved: 0,
    linesOnLogisticsJobs: logisticsLines,
    linesWithoutInvoiceRow: 0,
    totalAmount: 0,
  };

  const seenInBatch = new Set();

  for (const row of rows) {
    const legacyId = toLegacyId(row.Id);
    if (legacyId === null) { problems.missingId += 1; continue; }

    const key = String(legacyId);
    if (existing.has(key)) { stats.alreadyImported += 1; continue; }
    if (seenInBatch.has(key)) { problems.duplicateClimaxIds.push(legacyId); continue; }

    const { operation, legacyJobId } = operationOf(row);

    // No job column at all is an opening balance, not a missing job. It is
    // never reported as an orphan: nothing is absent, it never had one.
    const isOpening = operation === null;

    // A CUSTOMS invoice is a real Job Invoice or Job Bill, but it has no job
    // column to fill: Invoice carries SEJobId and no customs equivalent, and a
    // clearance invoice reaches its declaration through its charge lines
    // instead (Charge_Heads.CustomsJobId - see functions/customsInvoiceContext,
    // which resolves it in reverse for the reports).
    //
    // So it is NOT an opening balance - it keeps its own type and payType -
    // and it is NOT an orphan, because there was never an SEJobId to miss. It
    // simply lands with a null job and is counted separately.
    //
    // These used to be skipped outright, which on a clearing agent's database
    // discards essentially the whole sales and purchase ledger.
    const isCustoms = !isOpening && operation === 'LG';
    if (isCustoms) stats.onLogisticsJobs += 1;

    let jobId = null;
    if (!isOpening && !isCustoms) {
      jobId = jobIdByLegacyId.get(`${operation}|${legacyJobId}`);
      if (!jobId) {
        problems.orphaned.push(legacyId);
        stats.orphaned += 1;
        continue;
      }
    } else if (isOpening) {
      stats.openingBalances += 1;
    }

    seenInBatch.add(key);

    const entry = byInvoice.get(key) || { lines: [], sides: {} };

    let type = isOpening ? spec.openingType : spec.type;
    let payType = isOpening ? spec.openingPayType : spec.payType;
    if (kind === 'AgentInvoice') {
      const decided = typeForAgent(entry.sides, row.DebitCreditId);
      if (decided.mixed) problems.mixedSideAgentInvoices.push(legacyId);
      // The header and its own lines disagreeing is a genuine anomaly, not a
      // gap. It does not happen in the current data, and if it starts to, the
      // constant above is what needs revisiting.
      if (decided.conflict) problems.agentDirectionConflicts.push(legacyId);
      if (decided.source === 'header') stats.agentDirectionFromHeader += 1;
      // Nothing to decide from at all: no recognised DebitCreditId and no
      // lines. It is still a real document, so it is imported as an Agent
      // Invoice and counted rather than dropped.
      if (!decided.type) stats.agentDirectionUndecided += 1;
      const direction = decided.type || 'Agent Invoice';
      payType = decided.payType || 'Recievable';
      // An agent OPENING is still an opening balance - it just gets its
      // direction the same way, from DebitCreditId. It has no lines to read
      // one from, which is exactly why the header is the authority.
      type = isOpening
        ? (direction === 'Agent Bill' ? 'Opening Bill' : 'Opening Invoice')
        : direction;
    }

    const party = parties.get(String(row[spec.partyKey]));
    if (!party) stats.unresolvedParty += 1;

    const companyId = companies.has(String(row.SubCompanyId))
      ? companies.get(String(row.SubCompanyId))
      : null;
    if (companyId === null) stats.unresolvedCompany += 1;

    if (!currencies.has(String(row[spec.currencyKey]))) stats.unresolvedCurrency += 1;
    if (row.IsVoid === true) stats.voided += 1;

    const cancelled = Number(row[spec.statusKey]) !== LIVE_STATUS;
    if (cancelled) stats.cancelled += 1;

    const mapped = mapInvoice(row, kind, {
      type,
      payType,
      // An opening has no job to read its trade from, so it comes from
      // OperationTypeId - the one id that says which trade it belonged to.
      operation: isOpening ? (OPERATION_TYPE[row.OperationTypeId] || null) : operation,
      jobId,
      party,
      companyId,
      cancelled,
      isOpening,
    }, { currencies });

    // A live invoice with nothing on it, or a cancelled one that still has
    // lines, means the status no longer predicts the contents and LIVE_STATUS
    // needs revisiting. Neither happens in the current data.
    //
    // Openings are exempt: they are live and carry no lines by definition,
    // which is the whole shape of an opening balance, not an anomaly.
    if (!isOpening && cancelled !== (entry.lines.length === 0)) {
      problems.statusContentMismatch.push(legacyId);
    }

    if (isOpening && !mapped.operation) stats.openingsWithoutOperation += 1;

    if (!mapped.invoice_No) problems.missingInvoiceNo += 1;
    if (!mapped.invoice_Id) stats.withoutSequence += 1;

    if (amountsContradict(row, Number(mapped.total))) {
      problems.contradictoryAmounts.push({
        climaxId: legacyId,
        invoice_No: mapped.invoice_No,
        imported: Number(mapped.total),
        localAmount: num(row.LocalAmount),
      });
    }

    stats.totalAmount += Number(mapped.total) || 0;
    if (Number(mapped.total) < 0) stats.negativeAmounts += 1;
    toCreate.push(mapped);

    // Resolve every line this invoice carries to a Charge_Head row.
    const heads = [];
    for (const line of entry.lines) {
      const headId = chargeHeadByKey.get(
        `${line.operation}|${SIDE_TYPE[line.side]}|${line.legacyId}`,
      );
      if (headId === undefined) { stats.linesUnresolved += 1; continue; }
      heads.push(headId);
    }
    stats.linesLinked += heads.length;

    linkPlan.push({
      climaxId: key,
      invoice_No: mapped.invoice_No,
      chargeHeadIds: heads,
    });
  }

  // Lines whose invoice this batch will not create - it was already imported,
  // skipped as an opening balance, or orphaned. Counted so a run that links
  // nothing is visible rather than quietly successful.
  for (const [invoiceKey, entry] of byInvoice) {
    if (seenInBatch.has(invoiceKey)) continue;
    if (existing.has(invoiceKey)) continue;
    stats.linesWithoutInvoiceRow += entry.lines.length;
  }

  stats.toCreate = toCreate.length;
  stats.totalAmount = Math.round(stats.totalAmount * 100) / 100;

  return {
    toCreate,
    linkPlan,
    stats,
    problems,
    canApply: problems.missingId === 0 && problems.duplicateClimaxIds.length === 0,
  };
}

module.exports = {
  planInvoices,
  KINDS,
  SIDE_TYPE,
  LINE_COLUMNS,
  JOB_COLUMNS,
  // Exported for unit tests.
  sequenceOf,
  operationOf,
  amountsContradict,
  typeForAgent,
  groupLinks,
  totalOf,
  mapInvoice,
};

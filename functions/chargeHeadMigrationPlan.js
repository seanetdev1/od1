/**
 * Plan a job charge-line import - Charge_Head.
 *
 * 103,112 lines across eight legacy tables: payable and receivable for each of
 * the four job types. They land in one Odyssey table, separated by `type`.
 *
 * SCOPE: charge lines attached to their JOB. Every line gets its SEJobId, its
 * charge, its party, its amounts and its tax. InvoiceId is deliberately left
 * for the ledger stage - see BELOW.
 *
 * WHAT THE OLD IMPORT (UploadChargesRecv / UploadChargesPayb, both untouched)
 * GOT WRONG
 *
 *   amount: "1"          The line amount, hardcoded. Both source tables carry
 *                        a real Amount column and it was ignored, so every
 *                        migrated charge line says its amount is 1 while its
 *                        net_amount, tax and local_amount are real. That is
 *                        worse than a blank: it looks like data.
 *
 *   tax_apply            Derived as TaxAmount > 0 while the source carries
 *                        IsTaxApply. A taxable line with a zero tax amount
 *                        reads as non-taxable.
 *
 *   approved_date        Written with that name, which the model does not
 *                        declare - it declares approval_date - so Sequelize
 *                        dropped it. The same class of bug as IssuePlace on
 *                        the B/L. ApprovedBy and ApprovedOn were never mapped
 *                        from the source at all.
 *
 *   party.id             Read unguarded after a findOne that can miss, so one
 *                        charge line whose party is not in Odyssey threw a
 *                        TypeError inside the job's transaction and took the
 *                        job and everything else in its batch with it. Same
 *                        for CP.Customer.Id, CP.Charges.PerUnitFixedId and
 *                        CP.Currency.CurrencyCode.
 *
 *   one query per line   A Charges.findOne and a Clients.findOne per charge
 *                        line - 206,000 queries for 103,000 lines.
 *
 * invoiceType COMES FROM THE JUNCTION TABLES, NOT FROM INVOICES
 *
 * A charge line is a Job Invoice, a Job Bill or an Agent Invoice line
 * depending on which junction table references it - GL_JobInvoice_Charges,
 * GL_JobBill_Charges or GL_AgentInvoice_Charges - and that is knowable
 * without a single invoice existing. The job P&L separates revenue from cost
 * on exactly this field:
 *
 *   revenue  invoiceType === 'Job Invoice' && type === 'Recievable'
 *   cost     invoiceType === 'Job Bill'    && type === 'Payble'
 *
 * Leaving it null makes every imported line invisible to that calculation, so
 * cost reads as zero and the net is the revenue of whatever old rows remain.
 *
 * InvoiceId is still left null: that one really does need the Invoice rows,
 * and resolving it inline is what left every charge head with a null
 * InvoiceId when invoices had not been imported first.
 *
 * No database access here - pure, so it can be unit-tested.
 */

/**
 * kind -> the legacy job column and the Odyssey `type` value.
 *
 * THE TYPE STRINGS ARE MISSPELLED ON PURPOSE. Charge_Head.type holds "Payble"
 * and "Recievable", and every screen filters on those exact strings - the
 * Payable tab passes type={"Payble"} (ChargesComp/index.js) and the job
 * charge grouping tests item.type === 'Payble'. Writing the correct spelling
 * imports the rows and makes them invisible, which is what happened the first
 * time this stage was written: the receivable misspelling was matched and the
 * payable one was quietly "corrected".
 */
/*
 * `targetKey` is which Charge_Head column carries the parent. Charge_Heads has
 * three: SEJobId for freight, AviationConsignmentId, and CustomsJobId. The
 * eight freight kinds all use SEJobId, so it defaults there and only the
 * customs kinds name their own.
 */
const KINDS = {
  SeaExportPayb: { operation: 'SE', jobKey: 'SEJobId', type: 'Payble', partyKey: 'VendorId', rateKey: 'ExchRateLine' },
  SeaExportRecv: { operation: 'SE', jobKey: 'SEJobId', type: 'Recievable', partyKey: 'CustomerId', rateKey: 'ExchRateClient' },
  SeaImportPayb: { operation: 'SI', jobKey: 'SIJobId', type: 'Payble', partyKey: 'VendorId', rateKey: 'ExchRateLine' },
  SeaImportRecv: { operation: 'SI', jobKey: 'SIJobId', type: 'Recievable', partyKey: 'CustomerId', rateKey: 'ExchRateClient' },
  AirExportPayb: { operation: 'AE', jobKey: 'AEJobId', type: 'Payble', partyKey: 'VendorId', rateKey: 'ExchRateLine' },
  AirExportRecv: { operation: 'AE', jobKey: 'AEJobId', type: 'Recievable', partyKey: 'CustomerId', rateKey: 'ExchRateClient' },
  AirImportPayb: { operation: 'AI', jobKey: 'AIJobId', type: 'Payble', partyKey: 'VendorId', rateKey: 'ExchRateLine' },
  AirImportRecv: { operation: 'AI', jobKey: 'AIJobId', type: 'Recievable', partyKey: 'CustomerId', rateKey: 'ExchRateClient' },

  // CUSTOMS CLEARANCE. Log_Job_ChargesRecv / _ChargesPayb, keyed on LogJobId,
  // landing on CustomsJobId instead of SEJobId.
  //
  // Structurally identical to the freight eight - same column names for the
  // money, the same CustomerId/VendorId split, the same ExchRateClient /
  // ExchRateLine split - which is why this is two more rows in this table
  // rather than a second migration stage.
  //
  // On CargoLinkers these are 143,368 lines across 95% of the 15,364 jobs, and
  // they carry the duty: Log_DutyCalculation is empty on that database, so
  // CUSTOMS DUTY, WHARFAGE and the rest arrive here as ordinary charge lines.
  CustomsPayb: { operation: 'LG', jobKey: 'LogJobId', type: 'Payble', partyKey: 'VendorId', rateKey: 'ExchRateLine', targetKey: 'CustomsJobId' },
  CustomsRecv: { operation: 'LG', jobKey: 'LogJobId', type: 'Recievable', partyKey: 'CustomerId', rateKey: 'ExchRateClient', targetKey: 'CustomsJobId' },
};

/** Which Charge_Head column this kind attaches its parent to. */
const targetKeyFor = (spec) => spec.targetKey || 'SEJobId';

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

function toLegacyId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** Keep a number as it is, but never emit undefined or NaN. */
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Which invoice document a charge line belongs to.
 *
 * The sets come from the junction tables: a line referenced by
 * GL_JobInvoice_Charges is a Job Invoice line, one referenced by
 * GL_JobBill_Charges is a Job Bill line, and GL_AgentInvoice_Charges makes it
 * an Agent Invoice line. A line on no document is left null, which is a real
 * state - an uninvoiced charge.
 */
/**
 * Which document a line is (or will be) on, and for which kind of party.
 *
 * A line Climax INVOICED is read from the junction tables. One it never did
 * gets what the freight charge sheet itself sets when a party is chosen on a
 * line (ChargesComp/PartySearch): receivable -> Job Invoice for a client or
 * Agent Invoice for an overseas agent; payable -> Job Bill for a vendor or
 * Agent Bill for an agent. Leaving both null - as this did - meant Auto Bill
 * and Auto Agent Invoice skipped every payable Climax had not billed (they
 * pick lines by partyType), and the server, which sorts lines into documents
 * by invoiceType, had nothing to put them on.
 *
 * `invoiced` says which of the two it was: approval follows it, not the type.
 * Customs lines are priced and billed by their own sheet and keep nothing.
 */
function documentFor(row, spec, ctx = {}, party = null) {
  const id = String(toLegacyId(row.Id));
  const has = (set) => Boolean(set && set.has(id));

  if (has(ctx.jobInvoiceIds)) return { invoiceType: 'Job Invoice', partyType: 'client', invoiced: true };
  if (has(ctx.jobBillIds)) return { invoiceType: 'Job Bill', partyType: 'vendor', invoiced: true };
  if (has(ctx.agentIds)) return { invoiceType: 'Agent Invoice', partyType: 'agent', invoiced: true };
  if (spec.targetKey) return { invoiceType: null, partyType: null, invoiced: false };

  const agent = /overseas agent/i.test(String((party && party.types) || ''));
  if (spec.type === 'Recievable') {
    return agent
      ? { invoiceType: 'Agent Invoice', partyType: 'agent', invoiced: false }
      : { invoiceType: 'Job Invoice', partyType: 'client', invoiced: false };
  }
  return agent
    ? { invoiceType: 'Agent Bill', partyType: 'agent', invoiced: false }
    : { invoiceType: 'Job Bill', partyType: 'vendor', invoiced: false };
}

const lookup = (map, key) => {
  if (!map || key === null || key === undefined || key === '') return null;
  const hit = map.get(String(key));
  return hit === undefined ? null : hit;
};

/**
 * Map one legacy charge line onto Charge_Head columns.
 *
 * @param {object} row
 * @param {string} kind   one of KINDS
 * @param {object} ctx
 * @param {Map} ctx.charges     legacy charge id -> { id, name, calculationType }
 * @param {Map} ctx.parties     legacy party id  -> { id, name }
 * @param {Map} ctx.currencies  legacy currency id -> CurrencyCode
 * @param {*}   ctx.jobId       the Odyssey SE_Job id
 */
/** Sea operations type the price into Amount; everything else into Rate. */
const SEA_OPERATIONS = new Set(['SE', 'SI']);

/**
 * The price and its multiplier, in the fields the grid for this kind of line
 * edits - see mapChargeHead. Never Climax's Amount, which is the line TOTAL.
 */
function priceFields(spec, row) {
  return SEA_OPERATIONS.has(spec.operation)
    ? { amount: num(row.Rate), rate_charge: 1 }
    : { amount: 1, rate_charge: num(row.Rate) };
}

/** Climax's line discount, per unit of quantity - see mapChargeHead. */
function perUnitDiscount(discount, quantity) {
  const d = num(discount);
  const q = num(quantity);
  if (!d || !q) return d;
  return Math.round((d / q) * 1e6) / 1e6;
}

function mapChargeHead(row, kind, ctx = {}) {
  const spec = KINDS[kind];
  const charge = lookup(ctx.charges, row.ChargesId);
  const party = lookup(ctx.parties, row[spec.partyKey]);
  // Which invoice document this line sits on. Derived from the junction
  // tables, so it is known before any invoice is imported.
  const doc = documentFor(row, spec, ctx, party);

  return {
    climaxId: toLegacyId(row.Id),
    // The charge master row this line bills against.
    charge: charge ? charge.id : null,
    particular: charge ? charge.name : null,
    description: cleanText(row.Description),
    name: party ? party.name : null,
    // Guarded: reading .id off a missed lookup is what took whole batches down.
    partyId: party ? party.id : null,

    type: spec.type,
    // The charge master already knows this, and it is the same value the old
    // import read off the nested legacy charge.
    basis: charge ? charge.calculationType : null,
    pp_cc: Number(row.PPCCId) === 1 ? 'PP' : 'CC',
    size_type: cleanText(row.EquipCode),
    // Row level, not job level: the line says whether IT is dangerous goods.
    dg_type: Number(row.dDGNonDGId) === 1 ? 'DG' : 'non-DG',

    qty: num(row.Quantity),
    /* WHICH FIELD CARRIES THE PRICE depends on the operation, because the
     * freight grid types it into a different one: an AIR line's price is
     * typed into Rate (rate_charge) with amount a hidden 1, a SEA line's into
     * Amount with rate_charge a hidden 1 (new lines default both to 1). The
     * sum is the same either way - (amount x rate - discount) x qty - but the
     * price has to sit in the field the grid shows. Putting it in rate_charge
     * for every kind hid a sea line's price and showed its Amount as 1, so
     * whatever was typed there was multiplied by the hidden price. Customs
     * prices like air - see functions/customsCharge.
     *
     * The price is Climax's RATE, never its Amount: Amount is the line TOTAL
     * (Quantity x Rate on all 113,374 freight lines checked), and storing it
     * made Calculate / Save Charges price a line as total x rate x qty -
     * ACS-JI-639/27's receivables came to 4.9 billion. net_amount and
     * local_amount below carry the real money either way. */
    ...priceFields(spec, row),
    // Per unit, as that formula reads it. Climax stores the line's whole
    // discount, so spread it over the quantity: (rate - discount/qty) x qty
    // is exactly Climax's Amount - Discount. Ten freight lines carry one.
    discount: perUnitDiscount(row.DiscountAmount, row.Quantity),
    // The line has no tax-percentage column - the legacy rate lives in the
    // _TaxRevShare side table - but NetAmount excludes the tax, so the rate is
    // exactly TaxAmount / NetAmount (15 on CargoLinkers' SERVICES CHARGES).
    // Carried because the customs charge sheet and the Sale Tax Invoice print
    // "Sale Tax @ 15 %"; a 0 there reads as untaxed.
    taxPerc: num(row.TaxAmount) > 0 && num(row.NetAmount) > 0
      ? Math.round((num(row.TaxAmount) / num(row.NetAmount)) * 100 * 10000) / 10000
      : 0,
    // From the flag the source actually carries, not inferred from the amount.
    tax_apply: Boolean(row.IsTaxApply),
    tax_amount: num(row.TaxAmount),
    net_amount: num(row.NetAmount),
    ex_rate: num(row[spec.rateKey]),
    local_amount: num(row.LocalAmount),
    currency: lookup(ctx.currencies, row.CurrencyId),

    /* CLIMAX'S OWN APPROVAL, not "approved" across the board. Every line used
     * to arrive approved while its job kept Climax's approval - so each of the
     * ~230 freight jobs Climax had not approved came in unapproved over
     * approved charges, and the job screen offers no way out of that: its
     * Approve button hid behind the approved charges, and the charges' own
     * button shows only on an approved job.
     *
     * A line on an invoice is approved whatever the flag says - an issued
     * document's lines are. A bridge too old to send IsApproved keeps the old
     * behaviour rather than unapproving everything. */
    status: row.IsApproved === undefined || row.IsApproved === null
      ? 1
      : (row.IsApproved || doc.invoiced ? 1 : 0),
    approved_by: cleanText(row.ApprovedBy),
    // approval_date is the name the model declares; the old import wrote
    // approved_date, which Sequelize silently dropped.
    approval_date: row.ApprovedOn ?? null,

    // From the junction tables - see the header. The job P&L splits revenue
    // from cost on invoiceType, and needs it with or without invoices.
    invoiceType: doc.invoiceType,
    partyType: doc.partyType,
    // These two genuinely need the Invoice rows, so the ledger stage fills
    // them. invoice_id is the invoice NUMBER, which /linkCharges matches on.
    invoice_id: null,
    InvoiceId: null,

    // SEJobId for freight, CustomsJobId for a clearing job. Only the one this
    // kind names is set, so a customs line never carries a freight job id and
    // vice versa - the other stays null, which is what every screen that
    // separates the two reads.
    [targetKeyFor(spec)]: ctx.jobId ?? null,
  };
}

/**
 * @param {Array}  legacyRows
 * @param {string} kind                 one of KINDS
 * @param {object} ctx
 * @param {Iterable} ctx.existingClimaxIds  lines already imported for this kind
 * @param {Map} ctx.jobIdByLegacyId         legacy job id -> Odyssey SE_Job id
 * @param {Map} ctx.charges, ctx.parties, ctx.currencies
 */
function planChargeHeads(legacyRows, kind, ctx = {}) {
  const spec = KINDS[kind];
  if (!spec) {
    throw new Error(`Unknown charge-line kind "${kind}". Expected one of: ${Object.keys(KINDS).join(', ')}.`);
  }

  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const imported = new Set([...(ctx.existingClimaxIds || [])].map(String));
  const jobs = ctx.jobIdByLegacyId instanceof Map
    ? ctx.jobIdByLegacyId : new Map(Object.entries(ctx.jobIdByLegacyId || {}));

  const problems = {
    missingId: 0,
    missingJobRef: 0,
    duplicateClimaxIds: [],
    orphaned: [],
  };

  // A null here is money that cannot be attributed. Counted per relationship,
  // because "the charge master is short" and "the client list is short" are
  // different problems with different fixes.
  const unresolved = { charge: 0, party: 0, currency: 0 };
  // How many lines sit on each kind of document, and how many on none.
  const documents = { 'Job Invoice': 0, 'Job Bill': 0, 'Agent Invoice': 0, none: 0 };

  const seenIds = new Set();
  const toCreate = [];
  let skipped = 0;
  let totalNet = 0;

  for (const row of rows) {
    if (!row || toLegacyId(row.Id) === null) { problems.missingId += 1; continue; }

    const id = toLegacyId(row.Id);
    const key = String(id);

    if (seenIds.has(key)) { problems.duplicateClimaxIds.push(id); continue; }
    seenIds.add(key);

    if (imported.has(key)) { skipped += 1; continue; }

    const legacyJobId = toLegacyId(row[spec.jobKey]);
    if (legacyJobId === null) { problems.missingJobRef += 1; continue; }

    const jobId = jobs.get(String(legacyJobId));
    if (jobId === undefined || jobId === null) {
      // Nothing to attach it to. A charge line with no job is money floating
      // free of the shipment that earned it.
      problems.orphaned.push(legacyJobId);
      continue;
    }

    const mapped = mapChargeHead(row, kind, { ...ctx, jobId });

    if (row.ChargesId && !mapped.charge) unresolved.charge += 1;
    if (row[spec.partyKey] && !mapped.partyId) unresolved.party += 1;
    if (row.CurrencyId && !mapped.currency) unresolved.currency += 1;
    if (typeof mapped.net_amount === 'number') totalNet += mapped.net_amount;
    documents[mapped.invoiceType || 'none'] += 1;

    toCreate.push(mapped);
  }

  return {
    toCreate,
    problems,
    unresolved,
    documents,
    stats: {
      kind,
      operation: spec.operation,
      type: spec.type,
      source: rows.length,
      toCreate: toCreate.length,
      alreadyImported: skipped,
      orphaned: problems.orphaned.length,
      unresolvedCharge: unresolved.charge,
      unresolvedParty: unresolved.party,
      // Reported so the run can be reconciled against the legacy totals -
      // a row count cannot tell you the money came across intact.
      netAmount: Math.round(totalNet * 100) / 100,
      // Lines with no invoiceType contribute nothing to the job P&L.
      withoutDocument: documents.none,
    },
    // An unresolved charge or party leaves a line that still carries its money
    // and its job. Reported, not fatal.
    canApply: true,
  };
}

module.exports = {
  planChargeHeads, mapChargeHead, documentFor, cleanText, toLegacyId, num, KINDS,
};

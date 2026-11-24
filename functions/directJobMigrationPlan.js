/**
 * Legacy direct job expense / revenue -> Odyssey Direct Job E/R, for a CUSTOMS
 * install. Pure: no database, so the rules can be tested on their own.
 *
 *   GL_JobDirectExpRev          -> Direct_Jobs              (the entry)
 *   GL_JobDirectExpRev_Charges  -> Direct_Job_Association   (its lines)
 *
 * THE VOUCHER IS NOT POSTED AGAIN. Every entry the legacy system posted has a
 * voucher (VoucherId), and the ledger stage has already imported it, heads and
 * all. The lines here are linked to THAT voucher - found through
 * Vouchers.climaxId - so the books are exactly as the ledger stage left them
 * and this stage adds only the document: which job each amount was for. That
 * is also why this stage must run after the ledger.
 *
 * WHAT IT ADDS. The legacy system keeps these costs off the job's own charge
 * sheet (on CargoLinkers 4 of 23,451 lines match a job payable), so until they
 * are imported every clearing job is missing its cartage, lift on/off, labour
 * and the like.
 *
 * DECISIONS the user made (2026-09-25), not derivable from the data:
 *   - The legacy number is kept, prefixed with the company code only:
 *     JER-132/27 -> CL-JER-132/27. JER is not a code Odyssey issues (it uses
 *     DE / DR), so an imported entry is recognisable at a glance.
 *   - Adjust entries (settled by journal against a staff IOU or advance) have
 *     no legacy sub-type; they take the 'adjustment' sub-type added for them.
 *   - ACH (Automated Clearing House) is a wire payment: 'wire transfer'.
 *   - An entry is skipped only when leaving it out cannot change the ledger:
 *     one never posted (no voucher), or one with no lines (its voucher link
 *     lives on the lines, and CargoLinkers' only such entry is for 0).
 *
 * A LINE WITH NO JOB IS LEFT OUT, and its entry still comes in. The database
 * requires every Direct Job line to belong to exactly one job
 * (Direct_Job_Association_one_job, cl-deploy/direct-job-all-modes.sql), so
 * such a line cannot be stored. Its money is not lost: it is in the books
 * through the voucher the ledger stage imported, which this stage never
 * touches. The entry simply shows that much less than its voucher, and the
 * stage reports which entries and by how much. On CargoLinkers: 6 lines,
 * 1,020 in total, on JER-118/25, JER-141/25 and JER-172/25 - whose other 254
 * lines are attached to jobs and are imported.
 */

const { legacyTimestamp } = require('./legacyTime');

// GL_JobDirectExpRev.TypeId. Decoded from the vouchers the entries posted:
// every TypeId 1 posted a payment (CPV/BPV/JV), every TypeId 2 a receipt.
const TYPE = { 1: 'expense', 2: 'revenue' };

// GL_JobDirectExpRev.TranModeId, decoded the same way: 1 posted a cash
// voucher from Cash in Hand, 2 a bank voucher, 4 a journal voucher against a
// staff IOU/advance account. Odyssey's own three modes, one for one.
const TRAN_MODE = { 1: 'Cash', 2: 'Bank', 4: 'Adjust' };

// Gen_BankSubType -> Direct_Jobs.SubType, for Bank entries. Only the legacy
// sub-types with a clear Odyssey counterpart; anything else is reported
// rather than guessed at.
const BANK_SUB_TYPE = {
  1: 'wire transfer',    // ACH
  2: 'wire transfer',
  3: 'online transfer',
  4: 'credit card',
  5: 'cheque',
  6: 'po',
  7: 'tt',
  8: 'cash',
};

// GL_JobDirectExpRev_Charges.PerUnitFixedId -> the Basis the Direct Job
// screen offers ('unit' = Per Unit, 'shipment' = per shipment).
const BASIS = { 1: 'unit', 2: 'shipment' };

// Odyssey's Direct_Jobs / Direct_Job_Association Currency enum.
const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'OMR', 'PKR', 'BDT', 'CHF'];

// What Direct_Jobs.Entry_No must look like - models/Direct_Job.js.
const ENTRY_NO = /^[A-Z0-9]{2,6}-[A-Z]{2,6}-\d+\/\d+$/;

const toId = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
const key = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * @param headers  legacy GL_JobDirectExpRev rows
 * @param lines    legacy GL_JobDirectExpRev_Charges rows for those headers
 * @param ctx
 *   companyShortByLegacyId  Map legacy SubCompanyId -> Companies.short
 *   currencyByLegacyId      Map legacy CurrencyId -> code
 *   jobByLegacyId           Map legacy Log_Job id -> { id, jobNo }  (Customs_Jobs)
 *   chargeByLegacyId        Map legacy ChargesId -> Charges.id
 *   voucherByLegacyId       Map legacy VoucherId -> Vouchers.id
 *   accountIds              Set of Child_Accounts.id (the legacy GL_COA id is kept)
 *   partyAccountByLegacyId  Map legacy PartyId -> the party's Child_Account id
 *   existingEntryNos        Set of Direct_Jobs.Entry_No already in Odyssey
 * @returns {{ toCreate, problems, stats }}
 */
function planDirectJobs(headers = [], lines = [], ctx = {}) {
  const {
    companyShortByLegacyId = new Map(),
    currencyByLegacyId = new Map(),
    jobByLegacyId = new Map(),
    chargeByLegacyId = new Map(),
    voucherByLegacyId = new Map(),
    accountIds = new Set(),
    partyAccountByLegacyId = new Map(),
    existingEntryNos = new Set(),
  } = ctx;

  const problems = {
    noVoucher: [],          // never posted - no ledger effect, skipped
    noLines: [],            // nothing to link its voucher through, skipped
    voucherNotImported: [], // the ledger stage has not brought it in
    accountMissing: [],
    chargeMissing: [],
    unknownCode: [],        // a type / mode / sub-type with no mapping
    badEntryNo: [],
    duplicateInBatch: [],
    noAttachableLines: [],  // every line lacks a job - nothing can be stored
    // The entry is imported; these are not, or are imported changed:
    linesWithoutJob: [],    // no job in the legacy data - line left out
    jobNotImported: [],     // names a job Odyssey does not have - line left out
    currencyCorrected: [],  // tagged foreign at rate 1 with rupee amounts
    paidToUnresolved: [],
  };
  const stats = {
    headers: headers.length, lines: lines.length, alreadyImported: 0,
    entries: 0, entryLines: 0, amount: 0,
    // What the left-out lines were worth - in the books, not on an entry.
    leftOutAmount: 0,
  };

  const linesByHeader = new Map();
  for (const line of lines) {
    const k = key(line.JobDirectId);
    if (!linesByHeader.has(k)) linesByHeader.set(k, []);
    linesByHeader.get(k).push(line);
  }

  const toCreate = [];
  const seen = new Set();

  for (const h of headers) {
    const label = text(h.TranNumber) || `#${h.Id}`;
    const short = companyShortByLegacyId.get(key(h.SubCompanyId));
    const entryNo = short && text(h.TranNumber) ? `${short}-${text(h.TranNumber)}` : null;

    if (entryNo && existingEntryNos.has(entryNo)) { stats.alreadyImported += 1; continue; }

    if (toId(h.VoucherId) === null) { problems.noVoucher.push(label); continue; }
    const own = linesByHeader.get(key(h.Id)) || [];
    if (!own.length) { problems.noLines.push(label); continue; }

    if (!entryNo || !ENTRY_NO.test(entryNo)) { problems.badEntryNo.push(label); continue; }
    if (seen.has(entryNo)) { problems.duplicateInBatch.push(label); continue; }

    const voucherId = voucherByLegacyId.get(key(h.VoucherId));
    if (!voucherId) { problems.voucherNotImported.push(label); continue; }

    const account = toId(h.SettlementAccountId);
    if (account === null || !accountIds.has(account)) { problems.accountMissing.push(label); continue; }

    const type = TYPE[toId(h.TypeId)];
    const tranMode = TRAN_MODE[toId(h.TranModeId)];
    const subType = tranMode === 'Cash' ? 'cash'
      : tranMode === 'Adjust' ? 'adjustment'
      : tranMode === 'Bank' ? BANK_SUB_TYPE[toId(h.TranModeSubTypeId)]
      : undefined;
    if (!type || !tranMode || !subType) {
      problems.unknownCode.push(
        `${label} (type ${h.TypeId}, mode ${h.TranModeId}, sub-type ${h.TranModeSubTypeId})`,
      );
      continue;
    }

    const currency = currencyByLegacyId.get(key(h.CurrencyId)) || 'PKR';
    if (!CURRENCIES.includes(currency)) { problems.unknownCode.push(`${label} (currency ${currency})`); continue; }
    const exRate = num(h.ExchangeRate) || 1;

    let paidTo = null;
    if (toId(h.PartyId) !== null) {
      paidTo = partyAccountByLegacyId.get(key(h.PartyId)) || null;
      if (!paidTo) problems.paidToUnresolved.push(label);
    }

    // Lines first: one with no charge Odyssey knows cannot be written (the
    // charge is required), and dropping it would leave the entry short of its
    // own voucher - so the whole entry waits instead.
    const entryLines = [];
    let missingCharge = false;
    for (const l of own) {
      const chargeId = chargeByLegacyId.get(key(l.ChargesId));
      if (!chargeId) { missingCharge = true; break; }

      /* Amount is the line's POSTED value. Odyssey posts Amount x Ex_Rate and
       * never multiplies by quantity (routes/voucher saveDirectJob), and the
       * job charge summary reads it the same way - so Amount carries the net
       * line total, quantity included, exactly as the voucher does. */
      const amount = num(l.NetAmount) || num(l.Amount);
      const local = amount * (num(l.ExchangeRate) || exRate);

      // No job, no line - see the header comment.
      const legacyJob = toId(l.dLGJobId);
      const job = legacyJob === null ? null : jobByLegacyId.get(key(legacyJob));
      if (!job) {
        (legacyJob === null ? problems.linesWithoutJob : problems.jobNotImported)
          .push(`${label} line ${l.Id} (${local})`);
        stats.leftOutAmount += local;
        continue;
      }

      /* The line currency is the ENTRY's. Five CargoLinkers lines are tagged
       * USD/AED at rate 1 with their local amount equal to their own amount -
       * rupees in the wrong column, posted as rupees. Carrying the tag would
       * print 1,049,040 AED on a line that was 1,049,040 PKR. */
      const lineCurrency = currencyByLegacyId.get(key(l.CurrencyId));
      if (lineCurrency && lineCurrency !== currency) problems.currencyCorrected.push(`${label} line ${l.Id}`);

      stats.amount += local;

      entryLines.push({
        Job_No: job.jobNo,
        File_No: text(l.JobFileNumber),
        Charge_Name: String(chargeId),
        Basis: BASIS[toId(l.PerUnitFixedId)] || null,
        Rate_Group: text(l.RateGroup),
        Size_Type: text(l.EquipCode),
        Quantity: Math.round(num(l.Quantity)) || 1,
        Currency: currency,
        Ex_Rate: num(l.ExchangeRate) || exRate,
        Amount: amount,
        Discount: num(l.DiscountAmount),
        Tax_Apply: l.IsTaxApply === true || l.IsTaxApply === 1 || l.IsTaxApply === '1',
        Tax_Amount: num(l.TaxAmount),
        VAT_Catagory: text(l.VatCategoryId),
        Description: text(l.Description),
        Job_Id: null,
        AviationJobId: null,
        CustomsJobId: job.id,
        Voucher_Id: voucherId,
      });
    }
    if (missingCharge) { problems.chargeMissing.push(label); continue; }
    if (!entryLines.length) { problems.noAttachableLines.push(label); continue; }

    seen.add(entryNo);
    stats.entries += 1;
    stats.entryLines += entryLines.length;
    toCreate.push({
      entry: {
        Entry_No: entryNo,
        Type: type,
        Reference_No: text(h.ReferenceNumber),
        // Every legacy entry is against logistics (clearing) jobs.
        Operation: 'logistics',
        Job_Type: toId(h.SingleMultipleId) === 2 || entryLines.length > 1 ? 'multiple' : 'single',
        SubType: subType,
        Cheque_No: text(h.ChequeNo),
        Cheque_Date: h.ChequeDate || null,
        Currency: currency,
        Ex_Rate: exRate,
        Tran_Mode: tranMode,
        Drawn_At: text(h.DrawnAt),
        Account_No: account,
        Paid_To: paidTo,
        // Both are NOT NULL; a legacy row with neither date takes today's.
        // Entry times are Pakistan wall clock (functions/legacyTime); the
        // TranDate fallback is a date and stays as it is.
        createdAt: legacyTimestamp(h.AddOn) || h.TranDate || new Date().toISOString(),
        updatedAt: legacyTimestamp(h.EditOn || h.AddOn) || h.TranDate || new Date().toISOString(),
      },
      lines: entryLines,
    });
  }

  return { toCreate, problems, stats };
}

module.exports = {
  TYPE, TRAN_MODE, BANK_SUB_TYPE, BASIS, ENTRY_NO,
  planDirectJobs,
};

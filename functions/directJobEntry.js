/**
 * A saved Direct Job E/R, as the screen holds it (redux/directJob) - and the
 * line amount it is saved with.
 *
 * WHY THIS IS NOT INLINE IN THE SCREEN ANY MORE. Opening an entry read the
 * row field by field and stopped at the first that was not there:
 *
 *   - `Paid_To.toString()` threw on an entry with no Paid To - every entry
 *     migrated from Climax without one - and everything after it was never
 *     read: Reference, Sub Type, Tran Mode, Type, Remarks and every job line.
 *     The screen showed its blank-entry defaults (Revenue / Bank / Cheque,
 *     today's date) with the entry number on top.
 *   - Account # and Paid To were read as TEXT while the dropdowns hold
 *     numeric ids, so the box showed the bare id ("5448"), never the name.
 *   - The ENTRY DATE was the row's updatedAt - its last edit, or the day it
 *     was migrated. Direct_Jobs has no date column: the date an entry is
 *     saved with is its voucher's tranDate, so that is where it is read from.
 *
 * WHAT A LINE'S `Amount` IS. The line total - rate x quantity less discount,
 * in the entry's currency - which is what the voucher posts (routes/voucher
 * saveDirectJob, Amount x Ex_Rate), what the job's charge summary and the list
 * add up, and what the Climax migration writes. The screen alone treated it
 * as the RATE: it saved the rate there, so a line of 2 x 500 posted 500, and
 * read it back as a rate, so a migrated 2 x 500 = 1,000 showed 2 x 1,000. The
 * rate is now worked out from the total, and the total is what is saved.
 */
import { isCashMode } from './cashCheque';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** What a line posts: rate x quantity, less its discount. */
export const lineAmount = (line) => num(line.Rate) * num(line.Quantity) - num(line.Discount);

/** One saved Direct_Job_Association row, as a row of the screen's grid. */
export function lineFromSaved(x) {
  const quantity = num(x.Quantity) || 1;
  const discount = num(x.Discount);
  const net = num(x.Amount);
  const amount = net + discount;
  const tax = num(x.Tax_Amount);
  const exRate = num(x.Ex_Rate) || 1;
  // As the grid's own handlers work it out when a figure is typed.
  const netIncTax = net - tax;
  return {
    id: x.id,
    /* EXACTLY ONE of the three is set - which one depends on the install's
     * operation mode (Job_Id is freight, the other two aviation and customs).
     * Reading only Job_Id loaded an aviation entry with no job on it, and
     * re-saving would then have cleared the link. */
    JobId: x.Job_Id ?? x.AviationJobId ?? x.CustomsJobId,
    JobNumber: x.Job_No || '',
    Charge: parseInt(x.Charge_Name, 10) || '',
    FileNumber: x.File_No || '',
    Basis: x.Basis || undefined,
    Currency: x.Currency || undefined,
    RateGroup: x.Rate_Group || 'None',
    SizeType: x.Size_Type || undefined,
    Quantity: quantity,
    Rate: Math.round((amount / quantity) * 10000) / 10000,
    Amount: amount,
    Discount: discount,
    NetAmount: net,
    TaxApply: Boolean(x.Tax_Apply),
    TaxAmount: tax,
    VATCategory: x.VAT_Catagory ?? x.VAT_Category,
    NetIncTaxAmount: netIncTax,
    ExRate: exRate,
    LocalAmount: netIncTax * exRate,
    Description: x.Description || '',
  };
}

/**
 * A saved entry (GET /voucher/getDirectJob) as the screen's fields and lines.
 * Nothing here throws on a missing value.
 */
export function directJobFromSaved(r = {}) {
  const associations = r.Associations || [];
  const voucher = associations.find((a) => a?.Voucher)?.Voucher || null;
  const entryDate = voucher?.tranDate || r.createdAt || null;

  return {
    fields: {
      directJob_Id: r.id != null ? String(r.id) : '',
      directJob_EntryNumber: r.Entry_No || '',
      directJob_EntryDate: entryDate,
      directJob_Type: r.Type,
      directJob_Reference: r.Reference_No || '',
      directJob_Operation: r.Operation,
      directJob_JobType: r.Job_Type,
      directJob_SubType: r.SubType,
      directJob_TransMode: r.Tran_Mode,
      directJob_ChequeNo: r.Cheque_No || '',
      // A CASH entry has none and shows none - see functions/cashCheque. Any
      // other without one opens on its entry date, as a new entry opens on
      // today, ready for the cheque to be filled in.
      directJob_ChequeDate: isCashMode(r.Tran_Mode) ? null : (r.Cheque_Date || entryDate),
      directJob_Currency: r.Currency,
      directJob_ExRate: r.Ex_Rate,
      directJob_DrawnAt: r.Drawn_At || '',
      // Numbers, as the dropdowns' options are - see the header.
      directJob_Account: r.Account_No ?? undefined,
      directJob_PaidTo: r.Paid_To ?? undefined,
      /* THE REMARKS ARE THE VOUCHER'S NARRATION - Direct_Job has no column
       * of its own for them. */
      directJob_Remarks: voucher?.voucherNarration || '',
      directJob_CostCenter: voucher?.costCenter || '',
      directJob_VoucherNumber: voucher?.voucher_Id || '',
      directJob_VoucherId: voucher?.id ?? '',
    },
    lines: associations.map(lineFromSaved),
  };
}

/** The date a listed entry was made on - see directJobFromSaved. */
export const entryDateOf = (r = {}) =>
  (r.Associations || []).find((a) => a?.Voucher)?.Voucher?.tranDate || r.createdAt || null;

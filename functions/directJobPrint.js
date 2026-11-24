import numToWords from 'functions/numToWords';
import { isCashMode } from 'functions/cashCheque';

/**
 * What the Direct Job Expense / Revenue print shows, worked out from the
 * screen's state (redux/directJob).
 *
 * Laid out after the voucher Climax printed for these entries - the template
 * the office files: entry header, one row per job line, totals, the amount in
 * words and the remarks. Kept apart from the layout so the figures and the
 * wording can be tested on their own.
 *
 * REMARKS are the entry's voucher narration, as typed on the screen. An entry
 * with none gets the line Climax wrote for it:
 *     Cash Paid Against Invoice : JER-143/27 Against File Job No 56/27 Job #: TP-2044/27
 */

const cap = (s) => {
  const t = String(s || '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const distinct = (xs) => [...new Set(xs.map((x) => String(x || '').trim()).filter(Boolean))];

export function directJobPrintModel(state = {}) {
  const lines = (state.directJob || []).filter((l) => l && (l.JobNumber || l.Charge || num(l.Amount)));
  const charges = state.directJob_Charges || [];
  const accounts = [...(state.directJob_CAccounts || []), ...(state.directJob_SettlementAccounts || [])];
  const accountName = (id) => {
    if (id === undefined || id === null || id === '') return '';
    return accounts.find((a) => String(a.id) === String(id))?.title || '';
  };
  const chargeName = (id) => {
    const c = charges.find((x) => String(x.id) === String(id));
    return c ? (c.name || c.short || '') : '';
  };

  const rows = lines.map((l, i) => {
    const qty = num(l.Quantity);
    const rate = num(l.Rate);
    const amount = num(l.Amount) || qty * rate;
    const discount = num(l.Discount);
    const net = num(l.NetAmount) || amount - discount;
    const exRate = num(l.ExRate) || 1;
    return {
      sno: i + 1,
      jobNo: l.JobNumber || '',
      fileNo: l.FileNumber || '',
      charge: chargeName(l.Charge),
      currency: l.Currency || state.directJob_Currency || 'PKR',
      qty, rate, amount, discount, net, exRate,
      local: num(l.LocalAmount) || net * exRate,
      description: l.Description || '',
    };
  });

  const sum = (k) => Math.round(rows.reduce((t, r) => t + r[k], 0) * 100) / 100;
  const totals = { amount: sum('amount'), discount: sum('discount'), net: sum('net'), local: sum('local') };

  const jobs = distinct(rows.map((r) => r.jobNo));
  const files = distinct(rows.map((r) => r.fileNo));
  const expense = String(state.directJob_Type || '').toLowerCase() === 'expense';

  const generatedRemarks = [
    `${cap(state.directJob_TransMode)} ${expense ? 'Paid' : 'Received'} Against Invoice : ${state.directJob_EntryNumber || ''}`,
    files.length ? `Against File Job No ${files.join(', ')}` : '',
    jobs.length ? `Job #: ${jobs.join(', ')}` : '',
  ].filter(Boolean).join(' ');

  return {
    entryNo: state.directJob_EntryNumber || '',
    entryDate: state.directJob_EntryDate || null,
    type: cap(state.directJob_Type),
    reference: state.directJob_Reference || '',
    costCenter: state.directJob_CostCenter || '',
    currency: state.directJob_Currency || 'PKR',
    tranMode: cap(state.directJob_TransMode),
    subType: cap(state.directJob_SubType),
    // Cash has no cheque - see functions/cashCheque.
    chequeNo: isCashMode(state.directJob_TransMode) ? '' : (state.directJob_ChequeNo || ''),
    chequeDate: isCashMode(state.directJob_TransMode) ? null : (state.directJob_ChequeDate || null),
    account: accountName(state.directJob_Account),
    paidTo: accountName(state.directJob_PaidTo),
    drawnAt: state.directJob_DrawnAt || '',
    operation: cap(state.directJob_Operation),
    jobType: cap(state.directJob_JobType),
    // The header names the job on a single-job entry; several are in the rows.
    jobNo: jobs.length === 1 ? jobs[0] : '',
    rows,
    totals,
    // In local currency - the figure the voucher posts.
    inWords: `PKR ${numToWords(totals.local)}`,
    remarks: String(state.directJob_Remarks || '').trim() || generatedRemarks,
  };
}

export default directJobPrintModel;

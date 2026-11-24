/**
 * What the voucher print shows - Components/Layouts/AccountsComp/Voucher/Print.
 *
 * Pulled out of the component so each rule can be tested, because each was
 * wrong on the print:
 *
 *   DATE         printed the CHEQUE date - and, on a voucher with none,
 *                moment(undefined): the day it was printed. The voucher screen
 *                shows createdAt, which is also the date the ledger reads.
 *   NARRATION    read line 0 if it was the bank/cash line, else line 1. The
 *                screen saves the bank/cash line LAST, so with two or more
 *                lines it printed another line's narration. A migrated
 *                voucher's own narration (voucherNarration) was never read.
 *   PAY TO       printed that same narration a second time.
 *
 * No React, no store - unit tested.
 */
import moment from 'moment';

const fmtDate = (v) => {
  if (!v) return '';
  const m = moment(v);
  return m.isValid() ? m.format('DD-MM-YYYY') : '';
};

/** The date the voucher screen shows, and the ledger files it under. */
export const voucherDate = (v) => fmtDate(v?.createdAt || v?.tranDate);

/** The cheque's own date - blank when there is no cheque, never today. */
export const chequeDate = (v) => fmtDate(v?.chequeDate);

const heads = (v) => (Array.isArray(v?.Voucher_Heads) ? v.Voucher_Heads : []);
const settlementLine = (v) => heads(v).find((h) => h.accountType === 'payAccount');

/**
 * The voucher's narration: its own where it has one (a migrated voucher keeps
 * Climax's there), else the bank / cash line's - the "Settlement Account
 * Narration" the voucher screen saves - else the first line's.
 */
export const voucherNarration = (v) => {
  const own = String(v?.voucherNarration || '').trim();
  if (own) return own;
  const settle = String(settlementLine(v)?.narration || '').trim();
  if (settle) return settle;
  return String(heads(v)[0]?.narration || '').trim();
};

const PAYMENTS = ['BPV', 'CPV'];
const RECEIPTS = ['BRV', 'CRV'];

/**
 * "Pay to" on a payment, "Received from" on a receipt; nothing on a journal or
 * transfer, which has no single counterparty. The voucher's own payTo where it
 * was typed, else the accounts on the other side of the bank / cash line - the
 * parties, when the voucher names any.
 */
export const counterparty = (v) => {
  const label = PAYMENTS.includes(v?.vType) ? 'Pay to'
    : RECEIPTS.includes(v?.vType) ? 'Received from' : null;
  if (!label) return null;
  const typed = String(v?.payTo || '').trim();
  if (typed) return { label, value: typed };

  const others = heads(v).filter((h) => h.accountType !== 'payAccount');
  const parties = others.filter((h) => h.accountType === 'partyAccount');
  const titles = (parties.length ? parties : others)
    .map((h) => String(h.Child_Account?.title || '').trim())
    .filter(Boolean);
  return { label, value: [...new Set(titles)].join(', ') };
};

const num = (x) => {
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : 0;
};

/** Debit and credit totals, in the voucher's currency, as the lines show them. */
export const voucherTotals = (v) => heads(v).reduce((t, h) => {
  if (h.type === 'debit') t.debit += num(h.amount);
  else t.credit += num(h.amount);
  return t;
}, { debit: 0, credit: 0 });

/**
 * The print's heading for a voucher type - word for word as it has always
 * printed, spelling included, so the print and its Excel sheet (functions/
 * voucherExcel) say the same.
 */
const TITLES = {
  SI: 'Settlemen Inovice',
  PI: 'Payble Inovice',
  JV: 'General Voucher',
  BPV: 'Bank Payment Voucher',
  BRV: 'Bank Recieve Voucher',
  CRV: 'Cash Recieve Voucher',
  CPV: 'Cash Payment Voucher',
  TV: 'Transfer Voucher',
};
// `title`, when a voucher brings its own: the Archive's (old Climax) Debit Note,
// Credit Note and Cheque Return, which Odyssey has no type for
// (functions/archivePrint). An Odyssey voucher never sets it.
export const voucherTitle = (v) => String(v?.title || '').trim() || TITLES[v?.vType] || 'Undefined Type';

/**
 * The Cost Center column: the voucher's own. The print had "KHI" written in -
 * what every voucher on the copies holds, but an install set to another cost
 * centre (Configuration) would have printed KHI on all of them.
 */
export const costCentre = (v) => String(v?.costCenter || '').trim() || 'KHI';

/**
 * 1,250.00. This printed "1, 250.00" - a space after every comma - and any
 * amount under 1 as "0".
 */
export const money = (x) => num(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

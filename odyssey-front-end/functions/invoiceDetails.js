/**
 * THE INVOICE PAGE'S RULES (2026-11-15 redesign) - Components/Shared/
 * InvoiceCharges, kept here so they are tested without rendering it.
 */
import { hasRoundOff } from 'Components/Shared/invoicePrintDefaults';
import { settlementLines } from 'functions/invoiceSettlementLines';

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const zero = (v) => blank(v) || num(v) === 0;
// A figure with its thousands grouped and its own decimals kept - 46072 reads
// 46,072, 280.5 stays 280.5. Anything not a number is shown as it is.
export const grouped = (v) => {
  if (blank(v) || !Number.isFinite(Number(v))) return v ?? '';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
};

export const isForeign = (invoice) => String(invoice?.currency || 'PKR').toUpperCase() !== 'PKR';

/**
 * The money at the top of the page, in the invoice's own currency, as its
 * print has it (InvoicePrint): the total with its round off, then Received
 * (Paid, on a bill), Adjustment and Balance - functions/invoiceSettlementLines.
 * The round off is in rupees, so only a rupee invoice carries one.
 */
export function invoiceMoney(invoice) {
  const round = !isForeign(invoice) && hasRoundOff(invoice?.roundOff) ? num(invoice.roundOff) : 0;
  const total = Math.round((num(invoice?.total) + round) * 100) / 100;
  const [settled, adjustment, balance] = settlementLines(invoice, total);
  return { total, settled, adjustment, balance };
}

/* A freight job's screen and tab, by its kind - the keys the job lists open
 * them under (JobsList). Every kind was opened as '4-3', the SEA EXPORT tab,
 * so an SI, AE or AI job's tab took you to the sea export screen when it was
 * clicked again. */
export const FREIGHT = {
  SE: { path: '/seaJobs/export', key: '4-3', label: 'SE JOB' },
  SI: { path: '/seaJobs/import', key: '4-6', label: 'SI JOB' },
  AE: { path: '/airJobs/export', key: '7-2', label: 'AE JOB' },
  AI: { path: '/airJobs/import', key: '7-5', label: 'AI JOB' },
};

/**
 * The job the invoice is for, and how to open it: a freight job, a customs
 * job (a customs invoice carries its job - attachPrintContext on the server)
 * or a flight. The page showed only the freight one, so a customs invoice's
 * Job# was blank. `href` null: a number with nowhere known to go.
 */
export function jobLink(invoice) {
  const freightNo = invoice?.SE_Job?.jobNo;
  if (freightNo) {
    const kind = FREIGHT[String(invoice?.operation || '').toUpperCase()]
      ? String(invoice.operation).toUpperCase()
      : Object.keys(FREIGHT).find((k) => String(freightNo).includes(k));
    const f = FREIGHT[kind];
    if (!f || !invoice?.SEJobId) return { jobNo: freightNo, href: null, tab: null };
    return { jobNo: freightNo, href: `${f.path}/${invoice.SEJobId}`, tab: { label: f.label, key: f.key, id: `${invoice.SEJobId}` } };
  }
  const customs = invoice?.customsJob;
  if (customs?.jobNo) {
    return customs.id
      ? { jobNo: customs.jobNo, href: `/customsJobs/${customs.id}`, tab: { label: customs.jobNo, key: '11-2', id: customs.id } }
      : { jobNo: customs.jobNo, href: null, tab: null };
  }
  const flight = invoice?.aviation;
  if (flight?.jobNo) {
    return flight.jobId
      ? { jobNo: flight.jobNo, href: `/aviationJobs/${flight.jobId}`, tab: { label: flight.jobNo, key: '10-2', id: flight.jobId } }
      : { jobNo: flight.jobNo, href: null, tab: null };
  }
  return null;
}

/**
 * The charge table's columns. All eighteen are the invoice's - and the Round
 * Off line (invoicePrintDefaults roundOffLine) fills them by position, so
 * each keeps its `index` - but one no line has anything in is left off: a
 * customs invoice has no PP/CC, size or DG, and a rupee one no rate of
 * exchange. Those empty columns were most of what made the table hard to read.
 */
export function chargeColumns(lines) {
  const rows = Array.isArray(lines) ? lines : [];
  const any = (pick, test) => rows.some((r) => !test(pick(r)));
  const cols = [
    { index: 0, title: '#', cell: (r, i) => i + 1, className: 'dl-muted', always: true },
    { index: 1, title: 'Code', cell: (r) => r.charge, className: 'dl-muted dl-code', show: any((r) => r.charge, blank) },
    { index: 2, title: 'Particular', cell: (r) => r.particular, className: 'inv-particular', always: true },
    { index: 3, title: 'Basis', cell: (r) => String(r.basis || '').slice(0, 12), show: any((r) => r.basis, blank) },
    { index: 4, title: 'PP/CC', cell: (r) => r.pp_cc, show: any((r) => r.pp_cc, blank) },
    { index: 5, title: 'Size', cell: (r) => r.size_type, show: any((r) => r.size_type, blank) },
    { index: 6, title: 'DG', cell: (r) => r.dg_type, show: any((r) => r.dg_type, blank) },
    { index: 7, title: 'Qty', cell: (r) => r.qty, num: true, always: true },
    { index: 8, title: 'Cur.', cell: (r) => r.currency, always: true },
    { index: 9, title: 'DN/CN', cell: (r) => (r.type === 'Recievable' ? 'DN' : 'CN'), always: true },
    { index: 10, title: 'Rate', cell: (r) => grouped(r.rate_charge), num: true, always: true },
    { index: 11, title: 'Amount', cell: (r) => grouped(r.amount), num: true, always: true },
    { index: 12, title: 'Disc', cell: (r) => r.discount, num: true, show: any((r) => r.discount, zero) },
    // tax_apply is a boolean: React prints nothing for one, so this column
    // was empty on every invoice, taxed lines included.
    { index: 13, title: 'Tax', cell: (r) => (r.tax_apply === true || r.tax_apply === 'true' || r.tax_apply === 1 ? 'Yes' : ''), show: rows.some((r) => r.tax_apply === true || r.tax_apply === 'true' || r.tax_apply === 1) },
    { index: 14, title: 'Tax Amt', cell: (r) => grouped(r.tax_amount), num: true, show: any((r) => r.tax_amount, zero) },
    { index: 15, title: 'Net', cell: (r) => grouped(r.net_amount), num: true, always: true },
    { index: 16, title: 'Ex.', cell: (r) => (String(r.currency || '').toUpperCase() === 'PKR' ? '1.00' : r.ex_rate), num: true, show: rows.some((r) => String(r.currency || 'PKR').toUpperCase() !== 'PKR') },
    { index: 17, title: 'Total', cell: (r) => r.local_amount, num: true, money: true, always: true },
  ];
  return cols.filter((c) => c.always || c.show);
}

/**
 * THE SETTLEMENTS WINDOW'S ROWS (2026-11-15 redesign), from
 * /invoice/getAllInvoiceData: InvTran - this invoice's share of each voucher
 * that settled it - with the vouchers in the same order, and the party's
 * lines of those vouchers (their narration).
 *
 * It paired the vouchers with those LINES by position, and showed the line's
 * amount: a receipt that paid three invoices showed its whole amount on each,
 * and a voucher with no matching line - or two - put every amount after it
 * beside the wrong voucher. And it read `voucherDate` off rows that carried
 * `voucher_Date`, so every row was dated today. The share is InvTran's own
 * amount, in the invoice's currency; a foreign one's rupees are at the
 * voucher's rate, and the exchange difference is against the invoice's.
 * A gain is positive whichever side the document is on.
 */
export function settlementRows(result, invoice) {
  const trans = Array.isArray(result?.InvTran) ? result.InvTran : [];
  const vouchers = Array.isArray(result?.vouchers) ? result.vouchers : [];
  const heads = Array.isArray(result?.heads) ? result.heads : [];
  const foreign = isForeign(invoice);
  const booked = num(invoice?.ex_rate) || 1;
  const bill = invoice?.payType === 'Payble';
  const round2 = (v) => Math.round(v * 100) / 100;
  return trans.map((t, i) => {
    const v = vouchers.find((x) => String(x?.id) === String(t?.VoucherId)) || vouchers[i] || {};
    const head = heads.find((h) => String(h?.VoucherId) === String(v.id));
    const amount = num(t?.amount);
    const rate = foreign ? (num(v.exRate) || booked) : 1;
    const local = round2(amount * rate);
    const atBooked = amount * (foreign ? booked : 1);
    return {
      id: v.id,
      voucherNo: v.voucher_Id || v.voucher_No || '',
      type: v.vType || '',
      date: v.tranDate || v.createdAt || null,
      amount,
      rate,
      local,
      exchange: foreign ? round2(bill ? atBooked - local : local - atBooked) : 0,
      narration: head?.narration || '',
    };
  }).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

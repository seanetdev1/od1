// An archive record, in the shape Odyssey's own prints take - so a Climax
// invoice, bill or voucher prints on THIS install's templates (the user's
// decision, 2026-11-11), not in a layout drawn for the archive.
//
//   archiveInvoicePrint -> { invoice, records } for Components/Shared/InvoicePrint,
//     as a customs invoice: operation 'LG' (a migrated customs document)
//     takes the customs header - M/S, GD #, Job No, packages - that every
//     CargoLinkers invoice prints with.
//   archiveVoucherPrint -> voucherData for Components/Layouts/AccountsComp/Voucher/Print.
//
// Pure: no store, no requests.

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(v * 100) / 100;

const invoiceTitle = (doc) => {
  if (doc.side === 'bill') return doc.kind === 'Bill' ? 'Bill' : doc.kind;
  return doc.kind === 'Credit Note' ? 'Credit Note' : 'Job Invoice';
};

/**
 * The print's lines. Each line's total INCLUDES its sales tax (local_amount):
 * the customs print adds local_amount up for the invoice total, and splits a
 * taxed line (tax_apply, tax_amount, net_amount) into Service Charges.
 */
function printLines(doc) {
  const type = doc.side === 'bill' ? 'Payble' : 'Recievable';
  return (doc.lines || []).map((l) => {
    const tax = num(l.tax);
    const amount = num(l.amount);
    const withTax = round2(amount + tax);
    return {
      id: `archive-${l.rowId}`,
      particular: l.charge || '',
      description: [l.remarks, l.vehicle].filter((x) => String(x || '').trim()).join(' - '),
      qty: num(l.qty),
      rate_charge: num(l.rate),
      amount: 1,
      discount: 0,
      type,
      pp_cc: 'PP',
      currency: 'PKR',
      ex_rate: 1,
      tax_apply: tax > 0,
      taxPerc: num(l.taxPerc),
      tax_amount: tax,
      net_amount: withTax,
      local_amount: withTax,
    };
  });
}

export function archiveInvoicePrint(doc) {
  if (!doc) return { invoice: null, records: [] };
  const records = printLines(doc);
  const linesTotal = round2(records.reduce((t, r) => t + r.local_amount, 0));
  // Climax's NetAmount is the lines and their tax; the odd one that differs
  // (5 of the 2016 book's 99,314) prints the difference as its round off, so
  // the printed total is the invoice's own.
  const roundOff = round2(num(doc.net) - linesTotal);
  const job = doc.job || {};
  const parties = job.parties || {};

  const invoice = {
    id: `archive-${doc.side}-${doc.id}`,
    invoice_No: doc.number,
    type: invoiceTitle(doc),
    createdAt: doc.date,
    approved: '1',
    operation: 'LG',
    payType: doc.side === 'bill' ? 'Payble' : 'Recievable',
    currency: 'PKR',
    ex_rate: 1,
    roundOff: Math.abs(roundOff) >= 0.01 ? roundOff : 0,
    note: doc.remarks || '',
    party_Name: doc.party?.name || '',
    recipient: {
      name: doc.party?.name || '',
      address1: doc.party?.address || '',
      ntn: doc.party?.ntn || '',
    },
    Sales_Tax_Invoice: doc.gstNo ? { taxInvoiceNo: doc.gstNo } : null,
    customsJob: {
      jobNo: job.jobNo || '',
      jobDate: job.jobDate || '',
      gdNumber: job.gdNo || '',
      customFileNo: job.customFileNo || '',
      formENo: job.formENo || '',
      mblNo: job.mbl || '',
      jobType: [job.direction, job.mode].filter(Boolean).join(' ') || job.activity || '',
      jobRef: job.clientRef || '',
      terminal: parties.terminal || '',
      packages: job.packages || '',
      pkgUnit: job.packageType || '',
      goodsDescription: job.goodsDescription || '',
      shipper: { name: parties.shipper?.name || '', address1: parties.shipper?.address || '' },
    },
  };
  return { invoice, records };
}

// The voucher print's titles cover Odyssey's types; Climax has three more.
const CLIMAX_TITLES = { DN: 'Debit Note', CN: 'Credit Note', CR: 'Cheque Return', SI: 'Sales Invoice', PI: 'Purchase Invoice' };
const CASH_BANK = ['CPV', 'BPV', 'CRV', 'BRV'];

export function archiveVoucherPrint(v) {
  if (!v) return null;
  const head = v.headAccount?.id ?? null;
  // On a cash or bank voucher the head account is the cash book or bank - the
  // print's "pay account"; the rest are the parties paid or received from.
  const isCashBank = CASH_BANK.includes(v.type);
  const centres = [...new Set((v.lines || []).map((l) => l.costCentre).filter(Boolean))];
  return {
    voucher_Id: v.voucherNo,
    vType: v.type,
    title: CLIMAX_TITLES[v.type] || undefined,
    createdAt: v.date,
    tranDate: v.date,
    chequeNo: v.chequeNo || '',
    chequeDate: v.chequeDate || null,
    voucherNarration: v.narration || '',
    payTo: v.payTo || v.receivedBy || '',
    sourceNo: v.refNo || '',
    costCenter: centres.length === 1 ? centres[0] : '',
    Voucher_Heads: (v.lines || []).map((l) => {
      const debit = num(l.debit);
      const credit = num(l.credit);
      return {
        type: debit > 0 ? 'debit' : 'credit',
        amount: debit > 0 ? debit : credit,
        narration: l.narration || '',
        accountType: isCashBank && head !== null && l.accountId === head ? 'payAccount' : 'partyAccount',
        Child_Account: { title: l.accountName || '' },
      };
    }),
  };
}

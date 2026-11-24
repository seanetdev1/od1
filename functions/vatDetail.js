/**
 * The VAT Detail - the sales tax return's list of documents.
 *
 * One row per SALE TAX INVOICE (Sales_Tax_Invoice) whose invoice is dated in
 * the period and approved: the buyer, the document, and its taxed services -
 * value excluding tax, the tax, the rate. It is the list Climax's "VAT Detail"
 * printed, column for column. Checked against its September 2026 export on a
 * copy of the CargoLinkers books: the same 819 documents, and the same value,
 * tax, rate, NTN and date on every one; the buyer's name differs on 36, for
 * the reason below.
 *
 * THE BUYER is the party the Sale Tax Invoice is addressed to - the one on the
 * invoice's charge lines, which is who the print names (see printRecipient in
 * routes/invoice). Its name, NTN and district come from that one record.
 * Climax took the NAME from the job's shipper and the NTN from the billed
 * party, so on a file billed to a forwarder (35 of 819 that month) it paired
 * one company's name with another's NTN; that is not repeated here.
 *
 * THE FIGURES are the Sale Tax Invoice's own, worked out the same way as the
 * screen's functions/saleTaxInvoice: only the taxed receivable lines; a
 * customs line's value is qty x (rate - discount), its tax that times its
 * rate. A migrated line arrived with its tax but a 0% rate, so the rate is
 * read back out of the tax (263 on 1,750 is 15.03%) - which reproduces the
 * legacy figure exactly, rounded tax and all. The RATE COLUMN shows the
 * charge's rate to one place (15, not 15.03): the rate the tax was charged at,
 * not the rounding in it.
 *
 * Kept free of model imports so it can be tested without a database; the
 * route (routes/misc/vatDetail) reads the documents and passes them in.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(v * 100) / 100;

const isTaxed = (c) => c?.tax_apply === true || c?.tax_apply === 'true' || c?.tax_apply === 1 || c?.tax_apply === '1';
const qtyOf = (c) => (c?.qty === null || c?.qty === undefined || c?.qty === '' ? 1 : num(c.qty));
const taxableOf = (c) => qtyOf(c) * (num(c?.rate_charge) - num(c?.discount));

/** A line's tax rate: its own, or read back out of its tax when it has none. */
const taxPercOf = (c) => {
  if (!isTaxed(c)) return 0;
  const perc = num(c?.taxPerc);
  if (perc) return perc;
  const taxable = taxableOf(c);
  return num(c?.tax_amount) && taxable
    ? Math.round((num(c.tax_amount) / taxable) * 100 * 10000) / 10000
    : 0;
};

/** A line's value excluding tax, its tax and its rate - in rupees. */
function lineFigures(c) {
  const exRate = num(c?.ex_rate) || 1;
  if (c?.CustomsJobId) {
    const taxable = taxableOf(c);
    const perc = taxPercOf(c);
    return { value: taxable * exRate, tax: (taxable * perc) / 100 * exRate, perc };
  }
  const tax = num(c?.tax_amount);
  const value = num(c?.net_amount) - tax;
  const perc = num(c?.taxPerc) || (value ? round2((tax / value) * 100) : 0);
  return { value: value * exRate, tax: tax * exRate, perc };
}

/** A line that goes on the Sale Tax Invoice. */
const isSaleTaxLine = (c) => c?.type === 'Recievable' && isTaxed(c) && lineFigures(c).tax > 0;

/**
 * A document's figures: its taxed lines added up, and the one rate they
 * share (to one place) - null when its lines are taxed at different rates.
 *
 * THE TAX IS ROUNDED TO THE RUPEE, per document, half up: 15% of 1,750 is
 * 262.50 and goes on the return as 263. Climax did exactly that - its invoice
 * totals were built on 263 too (CL-23843's 18,713) - so the return agrees
 * with the invoices it lists.
 */
function documentFigures(lines = []) {
  const taxed = lines.filter(isSaleTaxLine).map(lineFigures);
  const rates = [...new Set(taxed.map((l) => Math.round(l.perc * 10) / 10))];
  return {
    value: round2(taxed.reduce((t, l) => t + l.value, 0)),
    // Cents first, so 262.4999999 from the arithmetic still reads as 262.50.
    tax: Math.round(round2(taxed.reduce((t, l) => t + l.tax, 0))),
    rate: rates.length === 1 ? rates[0] : null,
  };
}

const text = (v) => String(v ?? '').trim();

/**
 * The report.
 *
 * @param {Array} documents  [{ taxInvoiceNo, seq, date: 'YYYY-MM-DD', lines,
 *                            buyer: { name, ntn, city }, hsCode }]
 * @returns {{ rows: Object[], totals: { value, tax, withheld } }}
 *
 * Ordered as Climax listed them: by NTN (a buyer without one first), then
 * buyer, then document number.
 */
function vatDetailReport(documents = []) {
  const rows = documents.map((d) => {
    const f = documentFigures(d.lines);
    return {
      ntn: text(d.buyer?.ntn),
      cnic: '',
      buyer: text(d.buyer?.name),
      district: text(d.buyer?.city),
      buyerType: '',
      documentType: 'SI',
      documentNo: text(d.taxInvoiceNo),
      seq: Number(d.seq) || 0,
      date: d.date || '',
      hsCode: text(d.hsCode),
      saleType: 'Services',
      rate: f.rate,
      value: f.value,
      tax: f.tax,
      withheld: 0,
    };
  });
  rows.sort((a, b) => a.ntn.localeCompare(b.ntn)
    || a.buyer.localeCompare(b.buyer)
    || (a.seq - b.seq)
    || a.documentNo.localeCompare(b.documentNo));
  rows.forEach((r, i) => { r.sr = i + 1; });
  const totals = {
    value: round2(rows.reduce((t, r) => t + r.value, 0)),
    tax: round2(rows.reduce((t, r) => t + r.tax, 0)),
    withheld: 0,
  };
  return { rows, totals };
}

module.exports = { lineFigures, isSaleTaxLine, documentFigures, vatDetailReport, taxPercOf };

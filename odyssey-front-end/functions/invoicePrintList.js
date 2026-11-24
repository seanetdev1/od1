import { hasNote } from 'functions/invoiceNote';

/**
 * The bulk print list on Accounts > Invoice / Bills: invoices found by
 * searching are added one by one to a list of their own, and the whole list
 * prints as one job - each invoice on its own pages, exactly as it prints on
 * its own. Built the way Payment / Receipt keeps its selection: apart from the
 * page of search results, so it survives a new search, a page change and a
 * switch between Job Invoice / Job Bill / Agent Invoice...
 *
 * An entry is only what the list SHOWS. What prints is fetched fresh, by id,
 * when Print is pressed - see fetchInChunks - so an invoice amended after it
 * was added prints as it now stands.
 *
 * No React - unit tested.
 */

const sameId = (a, b) => String(a) === String(b);

/** What the list keeps of a search-result row. */
export const printListEntry = (row, type) => ({
  id: row.id,
  invoice_No: row.invoice_No,
  // The rows on Invoice / Bills do not carry their type: it is the filter
  // they were found under.
  type: row.type || type || '',
  party_Name: row.party_Name,
  currency: row.currency,
  total: row.total,
  approved: row.approved,
});

export const inPrintList = (list, id) => (list || []).some((x) => sameId(x.id, id));

/** Appended, in the order picked - which is the order it prints in. Once only. */
export const addToPrintList = (list, row, type) =>
  (inPrintList(list, row.id) ? list : [...(list || []), printListEntry(row, type)]);

export const removeFromPrintList = (list, id) => (list || []).filter((x) => !sameId(x.id, id));

/**
 * Fetch every invoice's full detail, a few at a time - not one request per
 * invoice all at once against the server, and not one after another.
 * Resolves in the LIST's order, with the ones that could not be fetched
 * named rather than silently left out of the print.
 */
export async function fetchInChunks(entries, fetchOne, size = 4) {
  const results = new Array(entries.length);
  const failed = [];
  for (let i = 0; i < entries.length; i += size) {
    const slice = entries.slice(i, i + size);
    // eslint-disable-next-line no-await-in-loop
    const got = await Promise.all(slice.map((e) => Promise.resolve()
      .then(() => fetchOne(e))
      .catch(() => null)));
    got.forEach((detail, j) => {
      if (detail) results[i + j] = detail;
      else failed.push(slice[j]);
    });
  }
  return { invoices: results.filter(Boolean), failed };
}

/**
 * The invoices a bulk "Sales Tax Invoices" print can print: those with at least
 * one taxed charge - the lines a Sales Tax Invoice is made of (isSaleTaxLine).
 * One with none has nothing to put on it, so it is SKIPPED and named rather
 * than printed as an empty document.
 */
export function saleTaxDocuments(invoices, isTaxedLine) {
  const printable = [];
  const skipped = [];
  for (const inv of invoices || []) {
    if ((inv?.Charge_Heads || []).some(isTaxedLine)) printable.push(inv);
    else skipped.push(inv);
  }
  return { printable, skipped };
}

/**
 * Printing Options for a bulk print - the invoice page's, applied to every
 * invoice on the list. Where they start: nothing hidden, no Sales Tax
 * Invoices, and each invoice on its own company's letterhead ('').
 * hideSignLine and hideTax start as Configuration > Invoices says (PrintList
 * sets them).
 */
export const BULK_PRINT_OPTIONS = {
  hideRef: false,
  hideLogo: false,
  hideNote: false,
  shipperInMs: false,
  vatInvoice: false,
  hideBalance: false,
  hideSignLine: false,
  hidePrintedBy: false,
  hideTax: false,
  hideBankDetails: false,
  letterhead: '',
};

/**
 * One invoice's print settings under the bulk Printing Options, by the rules
 * the invoice page applies to one invoice:
 *   - Hide Note hides every note; an invoice with no note never prints the
 *     box anyway (functions/invoiceNote).
 *   - Shipper in M/S only where the invoice's customs job has a shipper - the
 *     rest print their invoiced party, as the page's disabled box would.
 *   - The letterhead picked, else the invoice's own company, else the page's.
 *     Its bank account follows it (the caller's defaultBankAccount).
 */
export function bulkPrintSettings(inv, options, pageCompanyId) {
  const o = { ...BULK_PRINT_OPTIONS, ...options };
  return {
    companyId: o.letterhead || (inv?.companyId ?? pageCompanyId),
    logo: o.hideLogo,
    reference: o.hideRef,
    note: o.hideNote || !hasNote(inv),
    shipperInMs: o.shipperInMs && Boolean(inv?.customsJob?.shipper?.name),
    vatInvoice: o.vatInvoice,
    hideBalance: o.hideBalance,
    hideSignLine: o.hideSignLine,
    hidePrintedBy: o.hidePrintedBy,
    // Customs invoices only - InvoicePrint leaves a freight one as it is.
    hideTax: o.hideTax,
    hideBankDetails: o.hideBankDetails,
  };
}

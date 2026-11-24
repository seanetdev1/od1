// Single source of truth for "what is this company called and what does its
// letterhead look like".
//
// WHY THIS EXISTS
// Company identity used to be hardcoded across ~30 files, three different ways:
//
//   {company=='1' ? "SEA NET SHIPPING & LOGISTICS" : "AIR CARGO SERVICES"}
//   const imageUrl = query.company=='1' ? '/seanet-colored.png' : '/acs-colored.png'
//   <Radio value={1}>SEA NET SHIPPING & LOGISTICS</Radio>
//
// That is fine for one installation and fatal for a leased product: every
// client's invoices, vouchers, BLs and reports would carry Seanet/ACS names and
// artwork. The id->name mappings had also drifted apart - one file said id 2 was
// "CARGO LINKERS", another said "AIR CARGO SERVICES", the reports used id 3 -
// so the hardcoding was already producing wrong output on this install.
//
// Everything needed is already in the database and already in redux:
// /companies/getAllCompanies returns every Company column (title, short, logo,
// printLogo, address, phone, email, web, ntn, strn) plus its BankAccounts, and
// MainLayout dispatches the whole payload into state.company.companies.
//
// Reading the store directly (rather than useSelector) is deliberate: half the
// call sites are plain functions that build print HTML, not components. That is
// the same approach Components/Shared/Notification.js already uses.

import Cookies from 'js-cookie';
import { store } from 'redux/store';

/**
 * The company the user currently has selected, as set by the header dropdown
 * (MainLayout writes this cookie). Some print components - the BL and the
 * loading program - were written against a single installation and take no
 * company prop at all; this is how they find out whose letterhead to use.
 */
export function currentCompanyId() {
  try {
    return Cookies.get('companyId') || null;
  } catch (_) {
    return null;
  }
}

/** Every company known to this installation. Never null. */
export function allCompanies() {
  try {
    return store.getState()?.company?.companies || [];
  } catch (_) {
    return [];
  }
}

/** The full Company record, or null. Ids are compared as strings - they arrive
 *  as numbers from redux, strings from cookies and query params. */
export function getCompany(companyId) {
  if (companyId === null || companyId === undefined || companyId === '') return null;
  return allCompanies().find((c) => String(c.id) === String(companyId)) || null;
}

/** Display name. Falls back to `short`, then to a neutral placeholder - never
 *  to another tenant's name. */
export function companyTitle(companyId, fallback = '') {
  const c = getCompany(companyId);
  return (c && (c.title || c.short)) || fallback;
}

/**
 * The company a report is for, by name: the one picked, or - when it covers
 * every company - all of their names. Replaces headers that named companies by
 * a FIXED id ('1' = Seanet, '2' = Air Cargo Services), which was only ever true
 * on one installation: on SNS's own install company 2 is SNS, and on
 * CargoLinkers' company 1 is CargoLinkers.
 */
export function reportCompanyTitle(companyId) {
  const one = companyTitle(reportLetterheadId(companyId));
  if (one) return one;
  // No company in the header either - a session with no cookie yet.
  return allCompanies().map((c) => c.title || c.short).filter(Boolean).join(' & ');
}

/**
 * The company a REPORT's letterhead is printed for: the one picked on the
 * report when it is a company, and otherwise - "All companies" ('all', or
 * none) - the company selected in the HEADER, the one the user is working in.
 *
 * "All companies" is not a company. Looked up as one it found nothing, so the
 * letterhead printed blank - no name, no logo, no address - or, where a screen
 * reached for every name instead, all of them run together. A document goes
 * out on one company's letterhead; the header's is the one the user chose.
 */
export function reportLetterheadId(companyId) {
  return getCompany(companyId) ? companyId : currentCompanyId();
}

/**
 * The address a report's letterhead or export prints, by the same rule.
 * The Excel exports all wrote "House# A230, PECHS, Block 2, Karachi" - one
 * company's street address - whichever company and whichever install.
 */
export function reportAddress(companyId) {
  return companyDetails(reportLetterheadId(companyId)).address;
}

/**
 * Logo for an <img src>. Company.logo / printLogo hold base64 data URLs, so the
 * value is used directly.
 *
 * Returns null when the company has no logo, and callers must render nothing in
 * that case. Do NOT substitute a bundled image: the whole point is that a
 * client who hasn't uploaded a logo gets a text-only header rather than someone
 * else's branding.
 */
export function companyLogo(companyId, { print = false } = {}) {
  const c = getCompany(companyId);
  if (!c) return null;
  // printLogo is the print/report variant; fall back to the screen logo.
  const src = print ? (c.printLogo || c.logo) : (c.logo || c.printLogo);
  return src || null;
}

/** Address block fields for print headers. Always an object, fields may be ''. */
export function companyDetails(companyId) {
  const c = getCompany(companyId) || {};
  return {
    title: c.title || c.short || '',
    short: c.short || '',
    address: c.address || '',
    phone: c.phone || '',
    email: c.email || '',
    web: c.web || '',
    ntn: c.ntn || '',
    strn: c.strn || '',
  };
}

/**
 * Bank accounts for this company, newest-id last (the order they were added in
 * Config). Replaces the hardcoded `bankDetails` constant that shipped Soneri
 * and Bank Al Habib account numbers for AIR CARGO SERVICES / SEA NET inside
 * every build.
 */
export function companyBankAccounts(companyId) {
  const c = getCompany(companyId);
  const list = (c && c.BankAccounts) || [];
  return [...list].sort((a, b) => Number(a.id) - Number(b.id));
}

// An agent's document - AI / AB, and the agents' openings. The same test the
// Agent Invoice Balancing report uses on the server.
const AGENT_INVOICE_TYPES = ['Agent Invoice', 'Agent Bill', 'Old Agent Invoice', 'Old Agent Bill'];
export function isAgentDocument(invoice) {
  return Boolean(invoice) && (AGENT_INVOICE_TYPES.includes(invoice.type) || invoice.partyType === 'agent');
}

/**
 * The account an invoice prints until someone picks another - Config > Bank
 * Accounts, "Make client default" / "Make agent default". An agent's document
 * takes the agent default, everything else (JI / JB) the client default; with
 * that one unset, the company's first account, as it always was. The server
 * puts clientDefault / agentDefault on each account - see the backend's
 * functions/bankAccountDefaults.
 */
export function defaultBankAccount(accounts, invoice) {
  const list = [...(accounts || [])].sort((a, b) => Number(a.id) - Number(b.id));
  const flag = isAgentDocument(invoice) ? 'agentDefault' : 'clientDefault';
  return list.find((a) => a[flag]) || list[0] || null;
}

/**
 * One account as label/value pairs, empty fields dropped.
 *
 * The single definition of what a bank block contains and in what order.
 * formatBankAccount below joins these for print and anywhere else that needs
 * a plain string; screens that can lay out properly should render the pairs
 * instead, so the labels and values can be aligned rather than run together.
 */
export function bankAccountFields(acc) {
  if (!acc) return [];
  return [
    ['Bank Name', acc.bankName],
    ['Bank Branch', acc.branch],
    ['A/c Title', acc.accountTitle],
    ['A/c #', acc.accountNo],
    ['Swift Code', acc.swift],
    ['IBAN', acc.iban],
  ].filter(([, v]) => v);
}

/** One account as the printable block invoices show. */
export function formatBankAccount(acc) {
  return bankAccountFields(acc).map(([k, v]) => `${k}: ${v}`).join('\n');
}

/**
 * The company logo as a Blob, for embedding in an xlsx export via
 * workbook.addImage. Returns null when there is no logo (or it fails to
 * decode), and every caller must skip adding the image in that case.
 *
 * The report exports each had their own copy of this canvas dance against a
 * hardcoded '/seanet-colored.png'. Centralised so the null case is handled the
 * same way everywhere: previously a missing image rejected the promise and took
 * the whole export down.
 */
export function companyLogoBlob(companyId) {
  // A report's export: "All companies" carries the header company's logo -
  // see reportLetterheadId.
  const src = companyLogo(reportLetterheadId(companyId), { print: true });
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob(resolve);
      };
      img.onerror = () => resolve(null);   // never reject - a logo is cosmetic
      img.src = src;
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * Company choices for a REPORT filter, with an "All companies" entry.
 *
 * The three job reports each hardcoded this list as Seanet's own companies -
 *
 *   { value: 1, label: "Sea Net Shipping & Logistics" }
 *   { value: 4, label: "SNS & ACS" }
 *
 * - which is the exact problem this module exists to remove. On any other
 * install those names are wrong AND the ids select the wrong rows, so the
 * reports defaulted to filtering on companies that are not there.
 *
 * `'all'` means no company filter. The backend still honours the legacy '4'
 * (companies 1 and 3) so an existing Seanet saved filter keeps working, but
 * nothing offers it any more.
 */
export function reportCompanyOptions() {
  // A user restricted to some companies gets no "All companies": the server
  // refuses it (backend functions/companyAccess.js), since "all" would
  // include companies they may not see.
  let restricted = false;
  try { restricted = Boolean(store.getState()?.company?.restricted); } catch (_) { /* no store */ }
  return [
    ...(restricted ? [] : [{ value: 'all', label: 'All companies' }]),
    ...companyOptions(),
  ];
}

/**
 * Options for the company pickers that used to be hardcoded
 * `<Radio value={1}>SEA NET SHIPPING & LOGISTICS</Radio>` lists. Driven by the
 * actual companies on this installation, so a client sees theirs and the ids
 * can never drift from the database again.
 */
export function companyOptions() {
  return allCompanies().map((c) => ({
    value: c.id,
    label: c.title || c.short || `Company ${c.id}`,
  }));
}

/**
 * One company's short code, e.g. 1 -> "SNS" on a Seanet install and whatever
 * Company.short holds on any other. Empty string when the company is unknown,
 * so a caller building a string does not print "undefined".
 */
export function companyShort(companyId) {
  const c = getCompany(companyId);
  return c ? String(c.short || '').trim().toUpperCase() : '';
}

/**
 * The short codes of the companies on this installation, uppercased.
 *
 * Several screens tested document numbers with `invNo.indexOf("SNS") == 0`
 * against a fixed list of Seanet's codes, so on any other installation the
 * test never matched and the number was left alone.
 */
export function companyShorts() {
  return allCompanies()
    .map((c) => String(c.short || '').trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Does this document number start with one of our company codes followed by a
 * dash? Returns the prefix length including the dash, or 0.
 *
 * Used where a marker has to be inserted after the company prefix - the old
 * code hardcoded both the codes and the offset (`slice(0, 4)`, i.e. a
 * three-letter code plus a dash), which silently breaks for any code that is
 * not exactly three characters.
 */
export function companyPrefixLength(documentNumber) {
  const text = String(documentNumber || '').toUpperCase();
  for (const short of companyShorts()) {
    if (text.startsWith(short + '-')) return short.length + 1;
  }
  return 0;
}

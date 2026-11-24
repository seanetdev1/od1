import { useEffect, useRef, useState } from 'react';
import Cookies from 'js-cookie';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { invoiceTemplateFields } from 'functions/invoiceTemplateFields';

/* PRINTING FROM A TEMPLATE - the client's own Word file, set up in
 * Configuration > Printing Templates. The values are worked out here
 * (functions/invoiceTemplateFields; a B/L's or Air Waybill's in
 * functions/blTemplateFields); the server fills the file and makes the PDF,
 * which opens in a new tab to print or save. */

const BASE = () => `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/printingTemplates`;

/* The document the Sales Tax Invoice (VAT Tax Invoice) is asked for as. Its
 * template is saved for it by name: an every-document one is an invoice
 * layout, and the server never gives one for it. */
export const SALES_TAX_INVOICE = 'Sales Tax Invoice';

/** The template an invoice of this company and type prints from - null for the built-in layout. */
export function usePrintingTemplate(companyId, type) {
  const [template, setTemplate] = useState(null);
  useEffect(() => {
    if (!type) { setTemplate(null); return undefined; }
    let alive = true;
    // ownErrors: a lookup that fails is not the user's to hear about - every
    // invoice opened would say so (a server whose sync never made the table).
    axiosClient.get(`${BASE()}/applies`, { params: { companyId: companyId ?? '', type }, ownErrors: true })
      .then(({ data }) => { if (alive) setTemplate(data?.result || null); })
      // Not reachable: the built-in layout, as before templates existed.
      .catch(() => { if (alive) setTemplate(null); });
    return () => { alive = false; };
  }, [companyId, type]);
  return template;
}

const blobText = (blob) => (typeof blob.text === 'function'
  ? blob.text()
  : new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  }));

/* The server's reason for a failed file request. apis/axiosClient has read a
 * JSON reply out of its Blob already; one it could not is read here. A reply
 * that never came says so - the reason is not the template then. */
async function errorText(error, fallback) {
  const { response } = error || {};
  if (!response) {
    return error?.isAxiosError || error?.request
      ? 'The server could not be reached - check the connection and print again.'
      : fallback;
  }
  const data = response.data;
  try {
    const parsed = data instanceof Blob ? JSON.parse(await blobText(data)) : data;
    const details = Array.isArray(parsed?.details) && parsed.details.length ? ` ${parsed.details.join(' ')}` : '';
    const reason = (typeof parsed?.result === 'string' && parsed.result) || parsed?.message;
    return `${reason || fallback}${details}`;
  } catch (_) {
    return fallback;
  }
}

// "SNS-JI-7/27", or "SNS-JI-7/27 Sales Tax Invoice" - what the file is called.
const fileNameOf = (args) => [args.invoice?.invoice_No || 'invoice', args.salesTaxInvoice ? SALES_TAX_INVOICE : '']
  .filter(Boolean).join(' ');

/* A DOCUMENT, as the hooks and helpers below take it: what one template
 * prints, worked out for a moment `now` (undefined: this one) -
 *   { docs: [values, ...], fileName, what }
 * docs is one set of values per copy - an invoice has one, a B/L one per
 * Original and Non-Negotiable copy - and `what` names it in a message. */
const invoiceDocument = (args) => (now) => ({
  docs: [invoiceTemplateFields({ printedBy: Cookies.get('username') || '', ...args, now })],
  fileName: fileNameOf(args),
  what: 'invoice',
});

/* The document through its template: one copy from /render, several as ONE
 * PDF from /renderMany, each copy's pages after the last's. The Word file is
 * the first copy's - there is one file to edit. */
async function renderDocument(template, { docs, fileName }, format) {
  if (docs.length === 1 || format === 'docx') {
    const { data } = await axiosClient.post(`${BASE()}/render`, {
      templateId: template.id,
      fields: docs[0],
      format,
      fileName,
    }, { responseType: 'blob', ownErrors: true });
    return data;
  }
  const { data } = await axiosClient.post(`${BASE()}/renderMany`, {
    items: docs.map((fields) => ({ templateId: template.id, fields })),
    fileName,
  }, { responseType: 'blob', ownErrors: true });
  return data;
}

/**
 * The invoice as its template's PDF, in a new tab. The tab is opened at once,
 * in the click, so a pop-up blocker lets it through; the PDF fills it when the
 * server has made it.
 *
 * args: what invoiceTemplateFields takes - invoice, records, company,
 * bankAccount, options (Printing Options) - and salesTaxInvoice when it is the
 * Sales Tax Invoice, for the file's name.
 */
export async function printFromTemplate(template, args) {
  const tab = window.open('', '_blank');
  if (tab) tab.document.write('<p style="font-family:sans-serif;padding:24px">Preparing the invoice…</p>');
  try {
    const pdf = await renderDocument(template, invoiceDocument(args)(), 'pdf');
    const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (error) {
    if (tab) tab.close();
    openNotification('Error', await errorText(error, 'The invoice could not be printed from its template.'), 'red', 10);
  }
}

// What decides whether a PDF made a moment ago is still the one to print:
// every value but "Printed On", which would make each one stale at once.
const KEY_NOW = new Date(0);
// After the last change - ticking three options makes one PDF, not three.
const PREPARE_AFTER_MS = 400;

const openTab = (url) => Boolean(window.open(url, '_blank'));

/**
 * PRINT WITHOUT AN EMPTY TAB (the user's request, 2026-10-29). The document's
 * PDF is made while its print screen is open (`enabled`) - and again a moment
 * after anything it prints changes - so Print opens a tab with it already in
 * it, and any wait is on the print screen. Opened in the click itself, which
 * is also what a pop-up blocker lets through.
 *
 * Returns { status: 'idle' | 'preparing' | 'ready' | 'failed', print }.
 * print() opens it; pressed while it is still being made, it opens the moment
 * it is - and if the browser blocks a tab opened that long after the click,
 * says so: Print again then opens it at once.
 *
 * documentOf: (now) => the document - see invoiceDocument above.
 */
export function usePreparedDocumentPdf(template, documentOf, enabled) {
  const sample = documentOf(KEY_NOW);
  const what = sample.what || 'document';
  const key = enabled && template ? `${template.id}|${JSON.stringify(sample.docs)}` : null;
  const documentRef = useRef(documentOf);
  documentRef.current = documentOf;
  const [state, setState] = useState({ key: null, status: 'idle', url: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const waiting = useRef(false);   // Print pressed before it was ready

  useEffect(() => {
    if (!key) {
      waiting.current = false;
      setState({ key: null, status: 'idle', url: null, error: null });
      return undefined;
    }
    let alive = true;
    setState({ key, status: 'preparing', url: null, error: null });
    const timer = setTimeout(() => {
      renderDocument(template, documentRef.current(), 'pdf')
        .then((pdf) => {
          const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
          if (alive) setState({ key, status: 'ready', url, error: null });
          else URL.revokeObjectURL(url);
        })
        .catch(async (error) => {
          const message = await errorText(error, `The ${what} could not be printed from its template.`);
          if (alive) setState({ key, status: 'failed', url: null, error: message });
        });
    }, PREPARE_AFTER_MS);
    return () => { alive = false; clearTimeout(timer); };
    // The key is the template and every value it prints.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  // A replaced PDF is let go of - later, in case a tab is still loading it.
  const pdfUrl = state.url;
  useEffect(() => () => { if (pdfUrl) setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000); }, [pdfUrl]);

  // The state still describes the last PDF until the effect above catches up.
  const current = state.key === key ? state : { status: key ? 'preparing' : 'idle' };

  useEffect(() => {
    if (!waiting.current) return;
    if (current.status === 'ready') {
      waiting.current = false;
      if (!openTab(current.url)) {
        openNotification('Pop-up blocked', `The ${what} is ready - press Print again to open it.`, 'orange', 8);
      }
    } else if (current.status === 'failed') {
      waiting.current = false;
      openNotification('Error', current.error, 'red', 10);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.status, current.url, current.error]);

  const print = () => {
    if (current.status === 'ready') {
      if (!openTab(current.url)) openNotification('Pop-up blocked', 'Allow pop-ups for this site to print from a Word template.', 'orange', 8);
      return;
    }
    waiting.current = true;
    // Failed before: try again - it may have been a moment's trouble.
    if (current.status === 'failed') setAttempt((a) => a + 1);
  };

  return { status: current.status, print };
}

/** An invoice's prepared PDF - usePreparedDocumentPdf. args: as printFromTemplate takes. */
export function usePreparedTemplatePdf(template, args, enabled) {
  return usePreparedDocumentPdf(template, invoiceDocument(args), enabled);
}

/** The document as its template's Word file (the first copy's), downloaded. */
export async function downloadDocumentWord(template, document) {
  try {
    const docx = await renderDocument(template, document, 'docx');
    const url = URL.createObjectURL(new Blob([docx]));
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${String(document.fileName || 'document').replace(/[^\w.\- ]+/g, '_')}.docx`;
    window.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (error) {
    openNotification('Error', await errorText(error, 'The Word file could not be made.'), 'red', 10);
  }
}

/** The invoice as its template's Word file, downloaded. */
export const downloadTemplateWord = (template, args) => downloadDocumentWord(template, invoiceDocument(args)());

/* ------------------------------- bulk print -------------------------------- */

/**
 * The template each of many invoices prints from: asks the server once per
 * company and document among them (`keyOf` gives the pair), so its rule for
 * which applies is the only one. Resolves to one template, or null, per item.
 */
export async function templatesFor(items, keyOf) {
  const keys = items.map(keyOf);
  const unique = [...new Map(keys.map((k) => [`${k.companyId ?? ''}|${k.type}`, k])).entries()];
  const found = new Map(await Promise.all(unique.map(([id, k]) => axiosClient
    .get(`${BASE()}/applies`, { params: { companyId: k.companyId ?? '', type: k.type }, ownErrors: true })
    .then(({ data }) => [id, data?.result || null]))));
  return keys.map((k) => found.get(`${k.companyId ?? ''}|${k.type}`));
}

/**
 * Many invoices, each through its own template, as ONE PDF in their order -
 * a Blob. items: [{ template, args }], args as printFromTemplate takes.
 * Rejects with the server's own words (errorMessage) when it cannot.
 */
export async function renderManyPdf(items, fileName) {
  const printedBy = Cookies.get('username') || '';
  try {
    const { data } = await axiosClient.post(`${BASE()}/renderMany`, {
      items: items.map(({ template, args }) => ({ templateId: template.id, fields: invoiceTemplateFields({ printedBy, ...args }) })),
      fileName,
    }, { responseType: 'blob', ownErrors: true });
    return new Blob([data], { type: 'application/pdf' });
  } catch (error) {
    throw new Error(await errorText(error, 'The invoices could not be printed from their templates.'));
  }
}

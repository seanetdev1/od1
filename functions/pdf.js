const puppeteer = require('puppeteer');
const { signPrintToken } = require('./printToken');

// Renders the invoice by loading the frontend's bare print page in a headless
// browser (same InvoicePrint component the "Print" button uses), so the PDF
// always matches what a manual print would produce instead of drifting out
// of sync with a separately maintained backend template.
async function renderInvoicePdf(invoiceId) {
  const baseUrl = process.env.FRONTEND_BASE_URL;
  if (!baseUrl) {
    throw new Error('FRONTEND_BASE_URL is not configured.');
  }

  // An invoice with a Word template set up for it is sent as the template, as
  // the screen prints it - see functions/printingTemplate.
  const template = await invoiceTemplateFor(invoiceId);
  if (template) return renderTemplatedInvoicePdf(invoiceId, template, baseUrl);

  const token = signPrintToken(invoiceId);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    // Puppeteer's default viewport (800x600) is narrower than a normal desktop
    // browser window, which reflows the Bootstrap grid taller than intended and
    // pushes the content just past one A4 page, producing a trailing blank page.
    await page.setViewport({ width: 1200, height: 1600 });
    await page.goto(`${baseUrl}/invoice-print/${invoiceId}?token=${token}`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    await page.waitForSelector('.invoice-print-root', { timeout: 10000 });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

// The Word template this invoice prints from, with its file - or null.
// A lookup that fails (no "Printing_Templates" table - a sync that stopped
// short) sends the built-in layout: emailing an invoice worked before
// templates and must not stop over one.
async function invoiceTemplateFor(invoiceId) {
  // Required here, not at the top: models/index requires half the app.
  const { Invoice, Printing_Template } = require('../models');
  const { findTemplate } = require('./printingTemplate');
  try {
    const invoice = await Invoice.findByPk(invoiceId, { attributes: ['id', 'companyId', 'type'] });
    if (!invoice) return null;
    return await findTemplate(Printing_Template, { companyId: invoice.companyId, type: invoice.type }, { withContent: true });
  } catch (error) {
    console.error(`[pdf] invoice ${invoiceId}: no template lookup (${error.message}) - sent in the built-in layout.`);
    return null;
  }
}

/* A templated invoice as a PDF. The values come from the frontend's print page
 * in its values mode (?fields=1), which works them out with the same functions
 * as the screen's Print - so the emailed copy and the printed one are the same
 * document. Only the filling and the PDF are done here. */
async function renderTemplatedInvoicePdf(invoiceId, template, baseUrl) {
  const { fill, toPdf } = require('./printingTemplate');
  const token = signPrintToken(invoiceId);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  let fields;
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/invoice-print/${invoiceId}?token=${token}&fields=1`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    await page.waitForSelector('#invoice-template-fields', { timeout: 10000 });
    fields = JSON.parse(await page.$eval('#invoice-template-fields', (el) => el.textContent));
  } finally {
    await browser.close();
  }
  return toPdf(fill(template.content, fields));
}

/**
 * A ledger as a PDF, by loading the frontend's bare ledger print page.
 *
 * Same approach as renderInvoicePdf and for the same reason: the report's
 * arithmetic - opening balance, ex-rate handling, which accounts a foreign
 * currency ledger leaves out - lives in the frontend's LedgerReport, so the
 * only way a PDF and the screen cannot disagree is for the PDF to BE the
 * screen.
 *
 * PORTRAIT, like every other printable this app produces. The page is asked for
 * A4 portrait explicitly rather than left to the content, which is how the same
 * report used to come out one way on one machine and another elsewhere.
 *
 * The token carries which ledger to render; the page presents it in place of a
 * login session (see /accounts/getLedgerPrintData).
 */
async function renderLedgerPdf({ id, from, to, currency, company, name, token }) {
  const baseUrl = process.env.FRONTEND_BASE_URL;
  if (!baseUrl) {
    throw new Error('FRONTEND_BASE_URL is not configured.');
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    // Wide enough that the Bootstrap grid lays out as it does on a desktop -
    // see the note in renderInvoicePdf.
    await page.setViewport({ width: 1200, height: 1600 });

    const qs = new URLSearchParams({
      token: token || '',
      from: String(from ?? ''),
      to: String(to ?? ''),
      name: String(name ?? ''),
      company: String(company ?? ''),
      currency: String(currency ?? ''),
    }).toString();

    await page.goto(`${baseUrl}/ledger-print/${encodeURIComponent(id)}?${qs}`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    /* WAIT FOR EITHER OUTCOME, not just the happy one.
     *
     * The page renders `.ledger-print-root` when it has a ledger to draw - even
     * an empty one - and `.ledger-print-error` when the token was rejected.
     * Watching only the first meant an expired link sat here for the full
     * timeout and was then reported as a hang, which says nothing about what
     * actually went wrong. */
    await page.waitForSelector('.ledger-print-root, .ledger-print-error', { timeout: 10000 });
    const failed = await page.$('.ledger-print-error');
    if (failed) {
      // The page knows WHY it could not open - a rejected token and a request
      // that never reached the token check both land there, and reporting them
      // identically sends the reader after the wrong one.
      const reason = await failed.evaluate((el) => el.getAttribute('data-reason'));
      throw new Error(`The ledger print page could not be opened: ${reason || 'no reason given'}`);
    }

    return await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
  } finally {
    await browser.close();
  }
}

/**
 * A page the server wrote itself - no frontend involved - as a PDF. For a
 * report that exists only to be sent (the WhatsApp daily update), where there
 * is no screen for the PDF to match.
 */
async function renderHtmlPdf(html, { landscape = false } = {}) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    return await page.pdf({
      format: 'A4',
      landscape,
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
  } finally {
    await browser.close();
  }
}

module.exports = { renderInvoicePdf, renderLedgerPdf, renderHtmlPdf };

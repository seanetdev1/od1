const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const InspectModule = require('docxtemplater/js/inspect-module.js');

/* PRINTING TEMPLATES - an invoice printed from the client's own Word file
 * (the user's design, 2026-10-28); a job's B/L and Air Waybill too since
 * 2026-11-01, when Invoice Templates became Printing Templates.
 *
 * The file is laid out in Word with the data's names typed where the data
 * goes: {invoiceNo}, {gdDate}, a table row between {#expenses} and
 * {/expenses} for each charge, {#hasServiceCharges}...{/hasServiceCharges}
 * for a part only some invoices have. Every value arrives as finished text -
 * dates, amounts, the total in words - because Word cannot work anything out.
 *
 * WHO WORKS THE VALUES OUT. The frontend (functions/invoiceTemplateFields
 * there), with the same functions the built-in print uses, so a template can
 * never total an invoice differently from it. This side only fills the file
 * and turns it into a PDF - with LibreOffice, which the release image has
 * (see the Dockerfile) and a developer's machine may not.
 */

/* The documents a template can be for; '*' is every invoice and bill. The
 * Sales Tax Invoice (Printing Options' VAT Tax Invoice) is a different form -
 * the taxed lines only, under the GST number - so it prints from a template
 * saved for it by name, never from a '*' one. So do a job's Bill of Lading
 * and Air Waybill (the user's request, 2026-11-01): forms of their own,
 * printed from the B/L's Ref No's / Stamps tab. */
const SALES_TAX_INVOICE = 'Sales Tax Invoice';
const BILL_OF_LADING = 'Bill of Lading';
const AIR_WAYBILL = 'Air Waybill';
const OWN_FORMS = [SALES_TAX_INVOICE, BILL_OF_LADING, AIR_WAYBILL];
const DOC_TYPES = ['Job Invoice', 'Job Bill', 'Agent Invoice', 'Agent Bill', ...OWN_FORMS];
const ALL_DOCS = '*';

/** A problem with the Word file itself - shown to whoever uploaded it. */
class TemplateProblem extends Error {
  constructor(message, details = []) {
    super(message);
    this.details = details;
  }
}

/** No LibreOffice on this server: the PDF cannot be made here. */
class ConversionUnavailable extends Error {}

const OPTIONS = {
  // A loop or condition alone in its paragraph leaves no blank line behind.
  paragraphLoop: true,
  // A line break in a value (an address) is a line break in the document.
  linebreaks: true,
  // A name the invoice has no value for prints nothing, not "undefined".
  nullGetter: () => '',
};

/** The document's text and settings, or why the file is not a Word document. */
function openZip(buffer) {
  let zip;
  try {
    zip = new PizZip(buffer);
  } catch (_) {
    throw new TemplateProblem('This is not a Word document. Save it in Word as "Word Document (.docx)" and upload that.');
  }
  if (!zip.file('word/document.xml')) {
    throw new TemplateProblem('This is not a Word document. Save it in Word as "Word Document (.docx)" and upload that.');
  }
  return zip;
}

/* docxtemplater's own explanations, one per mistake ("The tag beginning with
 * "{gdNumbe" is unclosed"), so the uploader can find each one in Word. */
function explain(error) {
  const errors = error?.properties?.errors || [error];
  return errors.map((e) => e?.properties?.explanation || e?.message || String(e));
}

function compile(buffer, modules = []) {
  const zip = openZip(buffer);
  try {
    return new Docxtemplater(zip, { ...OPTIONS, modules });
  } catch (error) {
    const details = explain(error);
    throw new TemplateProblem(`The Word file has ${details.length === 1 ? 'a mistake' : `${details.length} mistakes`} in its {fields}.`, details);
  }
}

/* The names a template uses, as a tree: { invoiceNo: {}, expenses: { sr: {},
 * particular: {} } } - a loop's names inside it. Checking the names against
 * the ones that exist is the screen's job; it has the list. */
function inspect(buffer) {
  const iModule = new InspectModule();
  compile(buffer, [iModule]);
  return iModule.getAllTags();
}

/** The Word file with the invoice's values in it. */
function fill(buffer, values) {
  const doc = compile(buffer);
  try {
    doc.render(values || {});
  } catch (error) {
    throw new TemplateProblem('The invoice could not be put into the Word file.', explain(error));
  }
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/* -------------------------------- to PDF ---------------------------------- */

function sofficePath() {
  if (process.env.SOFFICE_PATH) return process.env.SOFFICE_PATH;
  const windows = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';
  if (process.platform === 'win32' && fs.existsSync(windows)) return windows;
  return 'soffice';
}

// A file:// URL for LibreOffice's -env:UserInstallation, on either system.
const fileUrl = (p) => (p.startsWith('/') ? `file://${p}` : `file:///${p.replace(/\\/g, '/')}`);

const SOFFICE_FLAGS = ['--headless', '--norestore', '--nologo', '--nolockcheck'];

/* The command that converts `sources` (files in `dir`) to PDFs beside them.
 *
 * SOFFICE_DOCKER_IMAGE runs LibreOffice in Docker instead - for a developer's
 * PC without it (the user's, 2026-10-29). Any image with LibreOffice will do,
 * the release backend image among them; it then makes the PDF with the
 * server's own LibreOffice and fonts, so it is the PDF the client will get. */
function sofficeCommand(dir, sources) {
  const image = process.env.SOFFICE_DOCKER_IMAGE;
  if (image) {
    const inside = (p) => `/work/${path.basename(p)}`;
    return ['docker', [
      'run', '--rm', '-v', `${dir}:/work`, image,
      'soffice', ...SOFFICE_FLAGS, '-env:UserInstallation=file:///work/profile',
      '--convert-to', 'pdf', '--outdir', '/work', ...sources.map(inside),
    ]];
  }
  return [sofficePath(), [
    ...SOFFICE_FLAGS, `-env:UserInstallation=${fileUrl(path.join(dir, 'profile'))}`,
    '--convert-to', 'pdf', '--outdir', dir, ...sources,
  ]];
}

/* Two at a time. Each conversion is its own LibreOffice, a couple of hundred
 * megabytes while it runs - a bulk print must not start twenty at once. A
 * bulk print converts its invoices BATCH to a LibreOffice instead, one batch
 * after another: starting LibreOffice is most of the time a conversion takes. */
const MAX_AT_ONCE = 2;
const BATCH = 20;
let running = 0;
const waiting = [];
async function slot(work) {
  if (running >= MAX_AT_ONCE) await new Promise((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    const next = waiting.shift();
    if (next) next();
  }
}

function run(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

/* PDFs of Word files, in their order, from one LibreOffice. Every run gets its
 * own LibreOffice profile folder: two running at once on a shared profile, one
 * of them fails. */
async function convert(docxList) {
  return slot(async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'odyssey-invoice-'));
    try {
      const sources = docxList.map((_, i) => path.join(dir, `invoice-${i + 1}.docx`));
      await Promise.all(sources.map((source, i) => fs.promises.writeFile(source, docxList[i])));
      try {
        const [command, args] = sofficeCommand(dir, sources);
        await run(command, args, 120000 + 10000 * (sources.length - 1));
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new ConversionUnavailable(process.env.SOFFICE_DOCKER_IMAGE
            ? 'This server cannot make PDFs from Word files - SOFFICE_DOCKER_IMAGE is set, but Docker is not installed on it.'
            : 'This server cannot make PDFs from Word files - LibreOffice is not installed on it. The release image has it. On a PC without it, set SOFFICE_DOCKER_IMAGE to run it in Docker.');
        }
        if (process.env.SOFFICE_DOCKER_IMAGE && /error during connect|docker daemon/i.test(error.stderr || '')) {
          throw new ConversionUnavailable('PDFs from Word files are made in Docker here (SOFFICE_DOCKER_IMAGE), and Docker is not running - start Docker Desktop.');
        }
        throw new Error(`LibreOffice could not convert the invoice: ${error.stderr || error.message}`);
      }
      return await Promise.all(sources.map((source) => {
        const pdf = source.replace(/\.docx$/, '.pdf');
        if (!fs.existsSync(pdf)) throw new Error('LibreOffice made no PDF of the invoice.');
        return fs.promises.readFile(pdf);
      }));
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

/** A PDF of the Word file. */
async function toPdf(docx) {
  return (await convert([docx]))[0];
}

/** PDFs one after another, as one PDF - each keeps its own pages. */
async function mergePdfs(pdfs) {
  if (pdfs.length === 1) return pdfs[0];
  const { PDFDocument } = require('pdf-lib');
  const out = await PDFDocument.create();
  for (const bytes of pdfs) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await PDFDocument.load(bytes);
    // eslint-disable-next-line no-await-in-loop
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => out.addPage(page));
  }
  return Buffer.from(await out.save());
}

/** Many Word files as ONE PDF, in their order - a bulk print. */
async function toOnePdf(docxList) {
  const pdfs = [];
  for (let i = 0; i < docxList.length; i += BATCH) {
    // eslint-disable-next-line no-await-in-loop
    pdfs.push(...await convert(docxList.slice(i, i + BATCH)));
  }
  return mergePdfs(pdfs);
}

/* ------------------------------ which one ---------------------------------- */

/** The document an invoice (or a B/L) is, as a template names it; '*' for any other. */
function docTypeOf(type) {
  const plain = String(type || '').replace(/^Old\s+/i, '');
  return DOC_TYPES.includes(plain) ? plain : ALL_DOCS;
}

/* The template an invoice prints from: its own company's for its own
 * document, else its company's for every document, else every company's for
 * its document, else every company's for every document. None: null, and the
 * invoice prints the built-in layout. The Sales Tax Invoice, the Bill of
 * Lading and the Air Waybill (each its name as the type) only ever from one
 * saved for it. */
async function findTemplate(Printing_Template, { companyId, type }, { withContent = false } = {}) {
  const docType = docTypeOf(type);
  const company = companyId === null || companyId === undefined || companyId === '' ? null : parseInt(companyId, 10);
  const rows = await Printing_Template.findAll({
    attributes: withContent ? undefined : { exclude: ['content'] },
  });
  const score = (row) => {
    const companyFits = row.companyId === null ? 1 : (row.companyId === company ? 2 : 0);
    const everyDoc = row.docType === ALL_DOCS && !OWN_FORMS.includes(docType);
    const docFits = everyDoc ? 1 : (row.docType === docType ? 2 : 0);
    return companyFits && docFits ? companyFits * 10 + docFits : 0;
  };
  return rows.filter((r) => score(r) > 0).sort((a, b) => score(b) - score(a))[0] || null;
}

module.exports = {
  DOC_TYPES,
  ALL_DOCS,
  SALES_TAX_INVOICE,
  BILL_OF_LADING,
  AIR_WAYBILL,
  TemplateProblem,
  ConversionUnavailable,
  inspect,
  fill,
  toPdf,
  toOnePdf,
  mergePdfs,
  docTypeOf,
  findTemplate,
};

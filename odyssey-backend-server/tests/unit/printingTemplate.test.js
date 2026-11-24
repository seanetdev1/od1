const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const { PDFDocument } = require('pdf-lib');
const {
  inspect, fill, toPdf, toOnePdf, mergePdfs, docTypeOf, findTemplate, TemplateProblem, ConversionUnavailable,
} = require('../../functions/printingTemplate');

/* Printing templates - the client's own Word file with {names} for the data
 * (functions/printingTemplate). The fixture is H.O Enterprises' invoice, the
 * first one set up; the frontend's public/printing-templates has the same file. */
const HO = fs.readFileSync(path.join(__dirname, '../fixtures/ho-enterprises-invoice.docx'));

// A server with no LibreOffice is one with no Docker route to it either, even
// where this PC's .env names SOFFICE_DOCKER_IMAGE (printingTemplateDocker.test).
const dockerImage = process.env.SOFFICE_DOCKER_IMAGE;
beforeAll(() => { delete process.env.SOFFICE_DOCKER_IMAGE; });
afterAll(() => { if (dockerImage !== undefined) process.env.SOFFICE_DOCKER_IMAGE = dockerImage; });
const documentXml = (docx) => new PizZip(docx).file('word/document.xml').asText();
const footerXml = (docx) => {
  const zip = new PizZip(docx);
  return Object.keys(zip.files).filter((n) => /^word\/footer\d*\.xml$/.test(n)).map((n) => zip.file(n).asText()).join('');
};
// The text of a document, without its XML - what a reader would see.
const words = (xml) => xml.replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '');

const line = (sr, particular, amount, extra = {}) => ({
  sr, particular, description: '', paidByClient: '0.00', paidByUs: amount, amount, ...extra,
});
const values = (over = {}) => ({
  companyName: 'H.O Enterprises', invoiceNo: 'HO-9695/26', msName: 'AL-WAHAB RICE MILLS (PRIVATE) LIMITED',
  expenses: [line('1', 'WEBOC TOKEN CHARGES', '500.00'), line('2', 'QICT WHARFAGE', '111,610.00', { description: '3226240' })],
  totalExpenses: '112,110.00',
  hasServiceCharges: true,
  serviceCharges: [line('1', 'SERVICES CHARGES', '2,500.00', { description: '5X20' })],
  totalForSalesTax: '2,500.00', salesTaxRate: '15 %', salesTax: '375.00',
  totalAmount: '114,985.00', netBalance: '114,985.00', printedBy: 'Account',
  ...over,
});

describe('reading a template', () => {
  test('its names, a list\'s inside it', () => {
    const tags = inspect(HO);
    expect(tags.invoiceNo).toEqual({});
    expect(Object.keys(tags.expenses)).toEqual(['sr', 'particular', 'description', 'paidByClient', 'paidByUs', 'amount']);
    expect(Object.keys(tags.hasServiceCharges)).toEqual(expect.arrayContaining(['serviceCharges', 'totalForSalesTax', 'salesTax']));
    // Its "Shipper:" box is M/S, so Printing Options' Shipper in M/S moves it
    // (the user, 10-29: ticked, it printed the same).
    expect(tags.msName).toEqual({});
    expect(tags.shipperName).toBeUndefined();
  });

  test('a file that is not a Word document is refused, saying what to do', () => {
    expect(() => inspect(Buffer.from('%PDF-1.4 not a docx'))).toThrow(TemplateProblem);
    expect(() => inspect(Buffer.from('%PDF-1.4'))).toThrow(/Word Document \(\.docx\)/);
    // A zip, but not a Word file.
    const zip = new PizZip();
    zip.file('hello.txt', 'hi');
    expect(() => inspect(zip.generate({ type: 'nodebuffer' }))).toThrow(TemplateProblem);
  });

  test('a mistake in its {fields} is refused, each one named', () => {
    const zip = new PizZip(HO);
    zip.file('word/document.xml', documentXml(HO).replace('{/expenses}', ''));
    let problem;
    try { inspect(zip.generate({ type: 'nodebuffer' })); } catch (e) { problem = e; }
    expect(problem).toBeInstanceOf(TemplateProblem);
    expect(problem.details.join(' ')).toMatch(/expenses/);
  });
});

describe('filling it', () => {
  test('the values go in, one table row per charge', () => {
    const text = words(documentXml(fill(HO, values())));
    expect(text).toContain('HO-9695/26');
    expect(text).toContain('AL-WAHAB RICE MILLS (PRIVATE) LIMITED');
    expect(text).toContain('WEBOC TOKEN CHARGES');
    expect(text).toContain('QICT WHARFAGE');
    expect(text).toContain('111,610.00');
    expect(text).toContain('Clearance Service Charges');
    expect(text).toContain('Sales Tax @ 15 %');
    expect(text).not.toMatch(/[{}]/);
  });

  test('the footer is filled too', () => {
    expect(words(footerXml(fill(HO, values())))).toContain('Account');
  });

  test('no taxed lines: the service charges and the sales tax line are not there at all', () => {
    const text = words(documentXml(fill(HO, values({ hasServiceCharges: false, serviceCharges: [] }))));
    expect(text).not.toContain('Clearance Service Charges');
    expect(text).not.toContain('Total For SalesTax');
    expect(text).not.toContain('Sales Tax @');
    expect(text).toContain('Balance Invoice');
  });

  test('a name with no value prints nothing, not "undefined"', () => {
    const text = words(documentXml(fill(HO, { expenses: [] })));
    expect(text).not.toContain('undefined');
    expect(text).toContain('Invoice No');
  });
});

describe('the example Sales Tax Invoice - the built-in one\'s layout', () => {
  const STI = fs.readFileSync(path.join(__dirname, '../fixtures/sales-tax-invoice.docx'));
  const sti = (over = {}) => words(documentXml(fill(STI, {
    companyName: 'H.O Enterprises', gstInvoiceNo: '9643-A', invoiceNo: 'HO-9695/26', msName: 'AL-WAHAB RICE MILLS', msStrn: '32-77',
    gstServiceCharges: '2,500.00', gstRate: '15 %', gstTax: '375.00', gstAdditionalTax: '0.00', gstTotal: '2,875.00',
    gstTotalInWords: 'PKR Two Thousand Eight Hundred Seventy Five only', isDraft: false, ...over,
  })));

  test('prints the taxed figures under the GST number', () => {
    const text = sti();
    ['SALES TAX INVOICE', '9643-A', 'AL-WAHAB RICE MILLS', '32-77', 'Sales Tax @ 15 %', '2,875.00', 'Two Thousand Eight Hundred Seventy Five']
      .forEach((s) => expect(text).toContain(s));
    expect(text).not.toMatch(/[{}]/);
    expect(text).not.toContain('DRAFT');
  });

  test('says DRAFT until approved; a blank line is left out, not printed empty', () => {
    expect(sti({ isDraft: true })).toContain('DRAFT');
    expect(sti({ companyStrn: '' })).not.toContain('STRN #');
    expect(sti({ companyStrn: '12-34' })).toContain('STRN # 12-34');
  });
});

/* A job's Bill of Lading and Air Waybill (2026-11-01) - the examples the
 * Configuration screen offers; the frontend's functions/blTemplateFields
 * works out the values. */
describe('the example Bill of Lading', () => {
  const BL = fs.readFileSync(path.join(__dirname, '../fixtures/bill-of-lading.docx'));
  const container = (no) => ({ sr: '1', no, size: "40'HC", seal: 'ML-1', packages: '250 CTNS', grossWeight: '4968.000 KGS', cbm: '14.000 CBM' });
  const bl = (over = {}) => words(documentXml(fill(BL, {
    blNo: 'SNSL/KHI/0425', copyName: 'ORIGINAL', shipper: 'ABC TEXTILES (PVT) LTD\nKARACHI', portOfLoading: 'KARACHI, PAKISTAN',
    description: 'COTTON YARN', grossWeight: '9936.000 KGS', freightTerms: 'FREIGHT PREPAID', showNetWeight: true, netWeight: '9800.000 KGS',
    hasContainers: true, containers: [container('MSKU1234565'), container('MSKU7654321')], containerCount: '2',
    hasFormE: true, formENo: '12345', formEDate: '20/Oct/2026', ...over,
  })));

  test('prints the B/L, a row per container', () => {
    const text = bl();
    ['BILL OF LADING', 'ORIGINAL', 'SNSL/KHI/0425', 'ABC TEXTILES (PVT) LTD', 'KARACHI, PAKISTAN', 'FREIGHT PREPAID',
      'MSKU1234565', 'MSKU7654321', 'FORM E NUMBER : 12345', 'Net: 9800.000 KGS'].forEach((s) => expect(text).toContain(s));
    expect(text).not.toMatch(/[{}]/);
  });

  test('a part left off is left out: the containers, Form E, the net weight', () => {
    const text = bl({ hasContainers: false, containers: [], hasFormE: false, showNetWeight: false });
    expect(text).not.toContain('Container no.');
    expect(text).not.toContain('FORM E');
    expect(text).not.toContain('Net:');
    expect(text).toContain('FREIGHT PREPAID');
  });
});

describe('the example Air Waybill', () => {
  const AWB = fs.readFileSync(path.join(__dirname, '../fixtures/air-waybill.docx'));
  const item = (pieces, total) => ({ sr: '1', pieces, grossWeight: '100', kgLb: 'K', rateClass: 'Q', chargeableWeight: '120', rate: '2.78', total });
  const awb = (over = {}) => words(documentXml(fill(AWB, {
    mawbNo: '176-12345675', hawbNo: 'SNSA-0112', copyName: 'ORIGINAL', airportOfDeparture: 'Jinnah Intl - Karachi, Pakistan',
    routingTo1: 'DXB', routingBy1: 'EK', items: [item('20', '333.60'), item('5', '83.40')], totalPieces: '25',
    weightChargePrepaid: '1,250.00', totalPrepaid: '1,420.00', hasDimensions: true, dimensionsText: '60 x 40 x 40 x 25', totalVolume: '2.4', ...over,
  })));

  test('prints the air waybill, a rating line per item', () => {
    const text = awb();
    ['Air Waybill', '176-12345675', 'SNSA-0112', 'Jinnah Intl', 'DXB', 'EK', '333.60', '83.40', '1,250.00', '1,420.00', 'DIMS (CM):', '60 x 40 x 40 x 25']
      .forEach((s) => expect(text).toContain(s));
    expect(text).not.toMatch(/[{}]/);
  });

  test('no dimensions, no DIMS', () => {
    expect(awb({ hasDimensions: false })).not.toContain('DIMS');
  });
});

describe('which template an invoice prints from', () => {
  const rows = [
    { id: 1, companyId: null, docType: '*' },
    { id: 2, companyId: null, docType: 'Job Bill' },
    { id: 3, companyId: 5, docType: '*' },
    { id: 4, companyId: 5, docType: 'Job Invoice' },
  ];
  const model = (list) => ({ findAll: async () => list });
  const pick = async (list, companyId, type) => (await findTemplate(model(list), { companyId, type }))?.id ?? null;

  test('the most specific there is', async () => {
    expect(await pick(rows, 5, 'Job Invoice')).toBe(4);   // its company, its document
    expect(await pick(rows, '5', 'Agent Invoice')).toBe(3); // its company, every document
    expect(await pick(rows, 9, 'Job Bill')).toBe(2);       // every company, its document
    expect(await pick(rows, 9, 'Job Invoice')).toBe(1);    // every company, every document
  });

  test('another company\'s is never used; none at all, the built-in layout', async () => {
    expect(await pick([{ id: 3, companyId: 5, docType: '*' }], 9, 'Job Invoice')).toBeNull();
    expect(await pick([], 5, 'Job Invoice')).toBeNull();
  });

  test('"Old" documents are their new names; an opening invoice is only "every document"', () => {
    expect(docTypeOf('Old Job Invoice')).toBe('Job Invoice');
    expect(docTypeOf('Opening Invoice')).toBe('*');
    expect(docTypeOf('Sales Tax Invoice')).toBe('Sales Tax Invoice');
  });

  test('the Sales Tax Invoice only from a template saved for it - an every-document one is an invoice layout', async () => {
    expect(await pick(rows, 5, 'Sales Tax Invoice')).toBeNull();
    const withSti = [...rows, { id: 7, companyId: null, docType: 'Sales Tax Invoice' }, { id: 8, companyId: 5, docType: 'Sales Tax Invoice' }];
    expect(await pick(withSti, 5, 'Sales Tax Invoice')).toBe(8);
    expect(await pick(withSti, 9, 'Sales Tax Invoice')).toBe(7);
    // ...and a Sales Tax Invoice template never prints an invoice.
    expect(await pick([{ id: 8, companyId: 5, docType: 'Sales Tax Invoice' }], 5, 'Job Invoice')).toBeNull();
  });

  test('a Bill of Lading and an Air Waybill likewise - each only from its own', async () => {
    expect(docTypeOf('Bill of Lading')).toBe('Bill of Lading');
    expect(docTypeOf('Air Waybill')).toBe('Air Waybill');
    expect(await pick(rows, 5, 'Bill of Lading')).toBeNull();
    const withForms = [...rows,
      { id: 10, companyId: null, docType: 'Bill of Lading' }, { id: 11, companyId: 5, docType: 'Bill of Lading' },
      { id: 12, companyId: null, docType: 'Air Waybill' }];
    expect(await pick(withForms, 5, 'Bill of Lading')).toBe(11);
    expect(await pick(withForms, 9, 'Bill of Lading')).toBe(10);
    expect(await pick(withForms, 5, 'Air Waybill')).toBe(12);
    // Neither prints an invoice, nor the other.
    expect(await pick(withForms.slice(4), 5, 'Job Invoice')).toBeNull();
    expect(await pick([{ id: 12, companyId: null, docType: 'Air Waybill' }], 5, 'Bill of Lading')).toBeNull();
  });
});

describe('a bulk print as one PDF', () => {
  // A PDF of `count` pages, each `width` wide - so the order can be read back.
  const pdfOf = async (count, width) => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < count; i += 1) doc.addPage([width, 842]);
    return Buffer.from(await doc.save());
  };

  test('every invoice\'s pages, one invoice after another, in the order given', async () => {
    const merged = await PDFDocument.load(await mergePdfs([await pdfOf(1, 595), await pdfOf(2, 600), await pdfOf(1, 610)]));
    expect(merged.getPages().map((p) => Math.round(p.getWidth()))).toEqual([595, 600, 600, 610]);
  });

  test('one invoice is its own PDF, untouched', async () => {
    const one = await pdfOf(1, 595);
    expect(await mergePdfs([one])).toBe(one);
  });

  test('no LibreOffice: the same plain answer as one invoice', async () => {
    const before = process.env.SOFFICE_PATH;
    process.env.SOFFICE_PATH = path.join(__dirname, 'no-such-soffice');
    try {
      await expect(toOnePdf([fill(HO, values()), fill(HO, values())])).rejects.toBeInstanceOf(ConversionUnavailable);
    } finally {
      if (before === undefined) delete process.env.SOFFICE_PATH; else process.env.SOFFICE_PATH = before;
    }
  });
});

test('no LibreOffice on the server: it says so, rather than failing anyhow', async () => {
  const before = process.env.SOFFICE_PATH;
  process.env.SOFFICE_PATH = path.join(__dirname, 'no-such-soffice');
  try {
    await expect(toPdf(fill(HO, values()))).rejects.toBeInstanceOf(ConversionUnavailable);
  } finally {
    if (before === undefined) delete process.env.SOFFICE_PATH; else process.env.SOFFICE_PATH = before;
  }
});

/**
 * The values an invoice template prints - functions/invoiceTemplateFields.
 * They must total an invoice as the built-in print does (CustomsInvoicePrint
 * pins the same figures), and arrive as finished text.
 */
import { invoiceTemplateFields, unknownTemplateNames, FIELDS, LISTS, CONDITIONS } from 'functions/invoiceTemplateFields';

// H.O Enterprises' HO-9695/26 (24-Oct-2026), as their own system printed it.
const line = (particular, value, extra = {}) => ({
  type: 'Recievable', CustomsJobId: 9588, particular, qty: 1, rate_charge: value, discount: 0,
  currency: 'PKR', amount: '1', partyType: 'Client', net_amount: value, local_amount: value, ex_rate: 1,
  tax_apply: false, tax_amount: 0, pp_cc: 'PP', ...extra,
});
const hoRecords = [
  line('WEBOC TOKEN CHARGES', 500),
  line('QICT WHARFAGE', 111610, { description: '3226240' }),
  line('HANDLING CHARGES', 1500),
  line('SERVICES CHARGES', 2500, { description: '5X20', tax_apply: true, tax_amount: 375, taxPerc: 15, net_amount: 2875, local_amount: 2875 }),
];
const hoInvoice = {
  invoice_No: 'HO-9695/26', type: 'Job Invoice', payType: 'Recievable', operation: 'CC', currency: 'PKR', ex_rate: '1',
  createdAt: '2026-10-24T10:00:00', roundOff: '0', recieved: '0', paid: '0', approved: '1',
  party_Name: 'AL-WAHAB RICE MILLS (PRIVATE) LIMITED',
  recipient: { name: 'AL-WAHAB RICE MILLS (PRIVATE) LIMITED', address1: 'KARACHI' },
  Sales_Tax_Invoice: { taxInvoiceNo: '9643-A' },
  customsJob: {
    jobNo: 'TP-9588/26', jobDate: '2026-10-20', jobType: 'CLEARING', customFileNo: '9588', clientRef: '1949',
    gdNumber: 'KPPE-SB-101192', gdDate: '2026-10-21', packages: 100, pkgUnit: 'BAGS', goodsDescription: 'RICE',
    terminal: 'QICT', pofd: 'ANTWERPEN', invoiceValue: '1', transportMode: 'Sea',
    shipper: { name: 'AL-WAHAB RICE MILLS (PRIVATE) LIMITED' },
    Customs_Containers: [{ containerNo: 'APZU3465269', sizeType: '20GP' }],
  },
};
const hoCompany = { title: 'H.O Enterprises', address: 'OFFICE NO. 604, 6TH FLOOR, AL RAHIM TOWER', phone: '32471736, 32422184', ntn: '0287535-7' };
const fields = (over = {}) => invoiceTemplateFields({
  invoice: hoInvoice, records: hoRecords, company: hoCompany, printedBy: 'Account', now: new Date(2026, 9, 24, 16, 38, 21), ...over,
});

describe("H.O Enterprises' invoice", () => {
  const f = fields();

  test('its boxes', () => {
    expect(f).toMatchObject({
      companyName: 'H.O Enterprises', companyNtn: '0287535-7',
      invoiceNo: 'HO-9695/26', invoiceDate: '24-Oct-2026', clientRef: '1949', gstInvoiceNo: '9643-A', jobType: 'CLEARING',
      shipperName: 'AL-WAHAB RICE MILLS (PRIVATE) LIMITED', jobNo: 'TP-9588/26', fileNo: '9588',
      packages: '100 BAGS', goodsDescription: 'RICE', terminal: 'QICT', destination: 'ANTWERPEN',
      invoiceValue: '1.00', gdNumber: 'KPPE-SB-101192', gdDate: '21-Oct-2026', containerNos: 'APZU3465269',
      printedOn: '24/10/2026 16:38:21', printedBy: 'Account',
    });
  });

  test('the expenses, then the service charge at its value before tax', () => {
    expect(f.expenses.map((l) => [l.sr, l.particular, l.description, l.paidByClient, l.paidByUs, l.amount])).toEqual([
      ['1', 'WEBOC TOKEN CHARGES', '', '0.00', '500.00', '500.00'],
      ['2', 'QICT WHARFAGE', '3226240', '0.00', '111,610.00', '111,610.00'],
      ['3', 'HANDLING CHARGES', '', '0.00', '1,500.00', '1,500.00'],
    ]);
    expect(f.serviceCharges.map((l) => [l.sr, l.particular, l.description, l.amount, l.tax, l.taxRate])).toEqual([
      ['1', 'SERVICES CHARGES', '5X20', '2,500.00', '375.00', '15 %'],
    ]);
    // Every line, numbered straight through.
    expect(f.lines.map((l) => l.sr)).toEqual(['1', '2', '3', '4']);
  });

  test('its totals, to the rupee', () => {
    expect(f).toMatchObject({
      totalExpenses: '113,610.00', totalExpensesPaidByClient: '0.00', totalExpensesPaidByUs: '113,610.00',
      totalForSalesTax: '2,500.00', salesTaxRate: '15 %', salesTax: '375.00',
      totalAmount: '116,485.00', advanceReceived: '0.00', netBalance: '116,485.00',
      totalInWords: 'PKR One Hundred Sixteen Thousand Four Hundred Eighty Five only',
    });
    expect(f.hasServiceCharges).toBe(true);
  });
});

/* The same figures CustomsInvoicePrint.test pins for the built-in print, with
 * the taxed line stored both ways (migrated, without its tax; entered here,
 * with it) - a template cannot total an invoice differently. */
describe.each([
  ['migrated', (amount) => ({ amount, partyType: 'client' }), { local_amount: 2500, net_amount: 2500, taxPerc: 0 }],
  ['entered here', () => ({ amount: '1', partyType: 'Client' }), { local_amount: 2875, net_amount: 2875, taxPerc: 15 }],
])('as the built-in print totals it (%s)', (_, stored, taxedStored) => {
  const l = (particular, value, extra = {}) => ({
    type: 'Recievable', CustomsJobId: 7, particular, qty: 1, rate_charge: value, discount: 0, currency: 'PKR',
    net_amount: value, local_amount: value, ex_rate: 1, tax_apply: false, tax_amount: 0, pp_cc: 'PP', ...stored(value), ...extra,
  });
  const f = invoiceTemplateFields({
    invoice: { ...hoInvoice, recieved: '5000' },
    records: [l('PSID CHARGES', 1500), l('SERVICES CHARGES', 2500, { tax_apply: true, tax_amount: 375, ...taxedStored }), l('WHARFAGE EXP', 45030)],
  });

  test('Total Expenses, Total For Sales Tax, Sales Tax, without and with', () => {
    expect([f.totalExpenses, f.totalForSalesTax, f.salesTax, f.totalWithoutTax, f.totalWithTax])
      .toEqual(['46,530.00', '2,500.00', '375.00', '49,030.00', '49,405.00']);
  });

  test('Received and Balance', () => {
    expect([f.received, f.balance]).toEqual(['5,000.00', '44,405.00']);
    expect(f.settlement.map((s) => s.label)).toEqual(['Received', 'Adjustment', 'Balance']);
  });
});

describe('Printing Options', () => {
  test('arrive as conditions', () => {
    const f = fields({ options: { hideBalance: true, hideRef: true } });
    expect([f.showBalance, f.showRef, f.showNote, f.showSignLine]).toEqual([false, false, true, true]);
  });

  test('Shipper in M/S puts the shipper in M/S', () => {
    const shipper = { name: 'SHIPPER CO', address1: 'PORT QASIM' };
    const invoice = { ...hoInvoice, recipient: { name: 'BUYER CO' }, customsJob: { ...hoInvoice.customsJob, shipper } };
    expect(invoiceTemplateFields({ invoice, records: hoRecords }).msName).toBe('BUYER CO');
    const f = invoiceTemplateFields({ invoice, records: hoRecords, options: { shipperInMs: true } });
    expect([f.msName, f.msAddress]).toEqual(['SHIPPER CO', 'PORT QASIM']);
  });

  test('Hide Tax Column: the service line totals without its tax', () => {
    expect(fields().serviceCharges[0].total).toBe('2,875.00');
    expect(fields({ options: { hideTax: true } }).serviceCharges[0].total).toBe('2,500.00');
  });
});

test('a freight invoice: its job, ports by Setup name, one list of lines', () => {
  const f = invoiceTemplateFields({
    invoice: {
      invoice_No: 'SNS-JI-1/27', type: 'Job Invoice', payType: 'Recievable', operation: 'SE', roundOff: '0', recieved: '0',
      party_Name: 'FREIGHT CLIENT', placeNames: { PKKHI: 'Karachi', CNSJQ: 'Sanshui' },
      SE_Job: { jobNo: 'SNS-SEJ-1/27', pol: 'PKKHI', pod: 'CNSJQ', vessel: { name: 'MSC ANNA' }, Bl: { mbl: 'MBL1', hbl: 'HBL1', Container_Infos: [{ no: 'TGHU1', size: '40HC' }] } },
    },
    records: [{ type: 'Recievable', particular: 'OCEAN FREIGHT', qty: 1, rate_charge: 100, currency: 'PKR', local_amount: 100, net_amount: 100, partyType: 'client', ex_rate: 1 }],
  });
  expect(f).toMatchObject({ isFreight: true, jobNo: 'SNS-SEJ-1/27', pol: 'Karachi', pod: 'Sanshui', vessel: 'MSC ANNA', mblNo: 'MBL1', hblNo: 'HBL1', containerNos: 'TGHU1', totalAmount: '100.00' });
  expect(f.expenses).toHaveLength(1);
  expect(f.hasServiceCharges).toBe(false);
});

describe('the Sales Tax Invoice (VAT Tax Invoice)', () => {
  test("H.O's: the taxed charge only, as SaleTaxInvoicePrint prints it", () => {
    const f = fields();
    expect(f).toMatchObject({
      hasSalesTax: true, gstInvoiceNo: '9643-A', gdNumber: 'KPPE-SB-101192', clientInvoiceNo: expect.any(String),
      gstServiceCharges: '2,500.00', gstRate: '15 %', gstTax: '375.00', gstAdditionalTax: '0.00', gstTotal: '2,875.00',
      gstTotalInWords: 'PKR Two Thousand Eight Hundred Seventy Five only', printedDate: '24-Oct-2026',
    });
    expect(f.gstLines.map((l) => [l.sr, l.particular, l.amount, l.taxRate, l.tax, l.total]))
      .toEqual([['1', 'SERVICES CHARGES', '2,500.00', '15 %', '375.00', '2,875.00']]);
  });

  test('Hide Tax Column does not touch it - the form is the tax', () => {
    expect(fields({ options: { hideTax: true } }).gstTotal).toBe('2,875.00');
  });

  test('addressed to the shipper with Shipper in M/S - the shipper\'s own STRN and NTN', () => {
    const shipper = { name: 'SHIPPER CO', strn: 'S-1', ntn: 'N-1' };
    const invoice = { ...hoInvoice, recipient: { name: 'BUYER CO', strn: 'S-2', ntn: 'N-2' }, customsJob: { ...hoInvoice.customsJob, shipper } };
    expect(invoiceTemplateFields({ invoice, records: hoRecords })).toMatchObject({ msName: 'BUYER CO', msStrn: 'S-2', msNtn: 'N-2' });
    expect(invoiceTemplateFields({ invoice, records: hoRecords, options: { shipperInMs: true } }))
      .toMatchObject({ msName: 'SHIPPER CO', msStrn: 'S-1', msNtn: 'N-1' });
  });

  test('a freight invoice\'s taxed line, in rupees - its net carries the tax', () => {
    const f = invoiceTemplateFields({
      invoice: { invoice_No: 'SNS-JI-2/27', type: 'Job Invoice', payType: 'Recievable', operation: 'SE', currency: 'USD', ex_rate: '280', roundOff: '0', recieved: '0' },
      records: [
        { type: 'Recievable', particular: 'OCEAN FREIGHT', qty: 1, net_amount: 100, ex_rate: 280, tax_apply: false },
        { type: 'Recievable', particular: 'DOC FEE', qty: 1, net_amount: 23, tax_amount: 3, tax_apply: true, ex_rate: 280 },
      ],
    });
    expect(f).toMatchObject({ hasSalesTax: true, gstServiceCharges: '5,600.00', gstTax: '840.00', gstTotal: '6,440.00', gstRate: '15 %' });
    // The invoice's own split stays customs-only.
    expect(f.hasServiceCharges).toBe(false);
  });

  test('nothing taxed: nothing on it', () => {
    const f = fields({ records: hoRecords.slice(0, 3) });
    expect([f.hasSalesTax, f.gstLines, f.gstTotal]).toEqual([false, [], '0.00']);
  });
});

test('nothing undefined - every value is text, a list or a yes/no', () => {
  const f = fields();
  Object.entries(f).forEach(([k, v]) => {
    expect([k, ['string', 'boolean'].includes(typeof v) || Array.isArray(v)]).toEqual([k, true]);
  });
});

test('every name in the list for authors is a value, and every value is in the list', () => {
  const f = fields();
  const listed = new Set([...FIELDS.flatMap((g) => g.fields.map(([n]) => n)), ...LISTS.map((l) => l.name), ...CONDITIONS.map(([n]) => n)]);
  Object.keys(f).forEach((k) => expect([k, listed.has(k)]).toEqual([k, true]));
  listed.forEach((k) => expect([k, k in f]).toEqual([k, true]));
  const lineKeys = Object.keys(f.expenses[0]);
  LISTS.find((l) => l.name === 'expenses').fields.forEach(([n]) => expect(lineKeys).toContain(n));
});

describe('names a template uses that are not fields', () => {
  test('are found, with where they are', () => {
    expect(unknownTemplateNames({ invoiceNo: {}, gdNumbr: {}, expenses: { sr: {}, particulr: {} } }))
      .toEqual(['gdNumbr', 'expenses > particulr']);
  });

  test("a list's own names, the invoice's inside a list, and conditions are fine", () => {
    expect(unknownTemplateNames({
      hasServiceCharges: { serviceCharges: { sr: {}, amount: {}, currency: {} }, totalForSalesTax: {} },
      containers: { no: {} }, showBalance: { netBalance: {} },
    })).toEqual([]);
  });
});

// Printing Options' Hide Printed On / By (the user, 2026-11-02).
test('Hide Printed On / By blanks the printed values, and says so for a condition', () => {
  expect(fields()).toMatchObject({ showPrintedBy: true, printedBy: 'Account' });
  expect(fields({ options: { hidePrintedBy: true } })).toMatchObject({
    showPrintedBy: false, printedOn: '', printedDate: '', printedBy: '',
  });
});

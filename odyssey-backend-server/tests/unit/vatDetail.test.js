/**
 * The VAT Detail - functions/vatDetail.js.
 *
 * Built to Climax's report and checked against its September 2026 export on a
 * copy of the books (819 documents, same value, tax, rate, NTN and date). These
 * pin the rules that produced those figures.
 */
const { documentFigures, vatDetailReport, lineFigures, isSaleTaxLine } = require('../../functions/vatDetail');

const taxed = (over = {}) => ({
  type: 'Recievable', tax_apply: true, taxPerc: '15', tax_amount: '375',
  qty: '1', rate_charge: '2500', discount: '0', ex_rate: '1', CustomsJobId: 9, ...over,
});

describe('a document\'s figures', () => {
  test('value excluding tax, the tax, and the rate', () => {
    expect(documentFigures([taxed()])).toEqual({ value: 2500, tax: 375, rate: 15 });
  });

  test('only the taxed receivable lines - not an untaxed line, not a payable', () => {
    const lines = [
      taxed(),
      taxed({ tax_apply: false, rate_charge: '9000' }),
      taxed({ type: 'Payble', rate_charge: '5000', tax_amount: '750' }),
    ];
    expect(documentFigures(lines)).toMatchObject({ value: 2500, tax: 375 });
  });

  test('the tax is rounded to the rupee, half up: 15% of 1,750 is 263, as Climax filed it', () => {
    expect(documentFigures([taxed({ rate_charge: '1750', tax_amount: '262.5' })])).toEqual({ value: 1750, tax: 263, rate: 15 });
  });

  test('a migrated line with no rate: the rate is read back out of its tax', () => {
    const f = documentFigures([taxed({ rate_charge: '1750', taxPerc: '0', tax_amount: '263' })]);
    expect(f.tax).toBe(263);
    // The charge's rate, not the rounding in it (263 / 1,750 is 15.03%).
    expect(f.rate).toBe(15);
  });

  test('several lines add up; one rate when they share it, none when they do not', () => {
    expect(documentFigures([taxed(), taxed({ rate_charge: '1000', tax_amount: '150' })])).toEqual({ value: 3500, tax: 525, rate: 15 });
    expect(documentFigures([taxed(), taxed({ rate_charge: '1000', taxPerc: '13', tax_amount: '130' })]).rate).toBeNull();
  });

  test('qty and discount count; a foreign-currency line in rupees', () => {
    expect(lineFigures(taxed({ qty: '2', rate_charge: '1000', discount: '100' }))).toMatchObject({ value: 1800, tax: 270 });
    expect(lineFigures(taxed({ rate_charge: '10', ex_rate: '280' }))).toMatchObject({ value: 2800, tax: 420 });
  });

  test('a non-customs line: its net includes the tax', () => {
    const line = { type: 'Recievable', tax_apply: '1', net_amount: '1150', tax_amount: '150', ex_rate: '1' };
    expect(isSaleTaxLine(line)).toBe(true);
    expect(lineFigures(line)).toMatchObject({ value: 1000, tax: 150 });
  });
});

describe('the report', () => {
  const doc = (taxInvoiceNo, seq, buyer, over = {}) => ({
    taxInvoiceNo, seq, date: '2026-09-18', lines: [taxed()], buyer, hsCode: '', ...over,
  });
  const azta = { name: 'AZTA TEXTILE SOLUTIONS', ntn: null, city: 'KARACHI CITY' };
  const proline = { name: 'PROLINE (PVT) LTD', ntn: '0704059-8', city: 'KARACHI,PAKISTAN' };
  const liberty = { name: 'LIBERTY MILLS LIMITED', ntn: '0803125-8', city: 'KARACHI,PAKISTAN' };

  test('one row per document, in Climax\'s columns', () => {
    const { rows } = vatDetailReport([doc('CL-24159', 24159, azta, { hsCode: '520512' })]);
    expect(rows[0]).toEqual({
      sr: 1, ntn: '', cnic: '', buyer: 'AZTA TEXTILE SOLUTIONS', district: 'KARACHI CITY', buyerType: '',
      documentType: 'SI', documentNo: 'CL-24159', seq: 24159, date: '2026-09-18', hsCode: '520512',
      saleType: 'Services', rate: 15, value: 2500, tax: 375, withheld: 0,
    });
  });

  test('ordered by NTN - a buyer with none first - then buyer, then document number', () => {
    const { rows } = vatDetailReport([
      doc('CL-24500', 24500, liberty),
      doc('CL-24160', 24160, proline),
      doc('CL-24159', 24159, proline),
      doc('CL-24300', 24300, azta),
    ]);
    expect(rows.map((r) => r.documentNo)).toEqual(['CL-24300', 'CL-24159', 'CL-24160', 'CL-24500']);
    expect(rows.map((r) => r.sr)).toEqual([1, 2, 3, 4]);
  });

  test('the totals', () => {
    const { totals } = vatDetailReport([
      doc('CL-1', 1, proline),
      doc('CL-2', 2, proline, { lines: [taxed({ rate_charge: '1750', tax_amount: '262.5' })] }),
    ]);
    expect(totals).toEqual({ value: 4250, tax: 638, withheld: 0 });
  });

  test('nothing in the period is an empty report, not an error', () => {
    expect(vatDetailReport([])).toEqual({ rows: [], totals: { value: 0, tax: 0, withheld: 0 } });
  });
});

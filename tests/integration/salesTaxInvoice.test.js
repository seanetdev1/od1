const { TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { assignTaxInvoiceNo, needsTaxInvoiceNo, seqFrom } = require('../../functions/salesTaxInvoice');

// The GST invoice number an approved invoice with taxed lines is issued under
// - functions/salesTaxInvoice, called by invoice approval inside its
// transaction. Run against the real table so the lock, the per-company
// sequence and the unique indexes are the ones production has.
describe('GST (sales tax) invoice numbers', () => {
  let company;
  const invoices = [];
  const CODE = 'TGS';

  const seedInvoice = async (extra = {}) => {
    const inv = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}GST-${Date.now()}-${invoices.length}`,
      payType: 'Recievable', total: '2875', recieved: '0', paid: '0', approved: '0',
      companyId: company.id, ...extra,
    }, { fiscalYearCheck: false });
    invoices.push(inv);
    return inv;
  };
  const taxed = { type: 'Recievable', tax_apply: true, tax_amount: '375' };
  const untaxed = { type: 'Recievable', tax_apply: false, tax_amount: '0' };
  const assign = (inv, charges) => db.sequelize.transaction((t) => assignTaxInvoiceNo({
    db, invoice: inv.dataValues, charges, companyCode: CODE, transaction: t,
  }));

  beforeAll(async () => {
    company = await db.Company.create({ title: `${TEST_PREFIX}GST Co ${Date.now()}`, short: CODE });
  });

  afterAll(async () => {
    await db.Sales_Tax_Invoice.destroy({ where: { CompanyId: company.id } });
    await db.Invoice.destroy({ where: { id: invoices.map((i) => i.id) }, fiscalYearCheck: false });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('continues after the highest number the company has - migrated ones included', async () => {
    // As if the migration brought CL-24295 across.
    const old = await seedInvoice();
    await db.Sales_Tax_Invoice.create({ taxInvoiceNo: `${CODE}-24295`, seq: 24295, CompanyId: company.id, InvoiceId: old.id });

    const inv = await seedInvoice();
    expect(await assign(inv, [taxed, untaxed])).toBe(`${CODE}-24296`);
  });

  it('an invoice approved again keeps the number it was first issued under', async () => {
    const inv = await seedInvoice();
    const first = await assign(inv, [taxed]);
    expect(await assign(inv, [taxed])).toBe(first);
    expect(await db.Sales_Tax_Invoice.count({ where: { InvoiceId: inv.id } })).toBe(1);
  });

  it('no taxed line, no number', async () => {
    const inv = await seedInvoice();
    expect(await assign(inv, [untaxed])).toBeNull();
    expect(await db.Sales_Tax_Invoice.count({ where: { InvoiceId: inv.id } })).toBe(0);
  });

  it('a bill gets none - the Sale Tax Invoice is issued to a client', async () => {
    const bill = await seedInvoice({ payType: 'Payble' });
    expect(await assign(bill, [{ ...taxed, type: 'Payble' }])).toBeNull();
  });

  // Configuration > Invoices' GST number format (Essani, 2026-11-14): four
  // digits, and the sequence carrying on from the highest - not restarting.
  it('numbers in the configured format, carrying on the same sequence', async () => {
    const before = await db.AppSetting.findOne({ where: { key: 'gstNumberFormat' } });
    const restore = before ? before.value : null;
    // A company with no numbers yet, so the first is 1.
    await db.Sales_Tax_Invoice.destroy({ where: { CompanyId: company.id } });
    try {
      const value = String.raw`{CODE}-\d{4}`;
      if (before) await before.update({ value });
      else await db.AppSetting.create({ key: 'gstNumberFormat', value });
      const first = await seedInvoice();
      expect(await assign(first, [taxed])).toBe(`${CODE}-0001`);
      const second = await seedInvoice();
      expect(await assign(second, [taxed])).toBe(`${CODE}-0002`);
    } finally {
      const row = await db.AppSetting.findOne({ where: { key: 'gstNumberFormat' } });
      if (restore === null) await row.destroy();
      else await row.update({ value: restore });
    }
  });

  it('two approvals at once do not share a number', async () => {
    const [a, b] = [await seedInvoice(), await seedInvoice()];
    const numbers = await Promise.all([assign(a, [taxed]), assign(b, [taxed])]);
    expect(new Set(numbers).size).toBe(2);
  });
});

describe('the rules, on their own', () => {
  test('the sequence in a GST number, padded or not', () => {
    expect(seqFrom('CL-24295')).toBe(24295);
    expect(seqFrom('CL-001')).toBe(1);
    expect(seqFrom('')).toBeNull();
  });

  test('a ticked box with no tax on it does not make a Sale Tax Invoice', () => {
    expect(needsTaxInvoiceNo({ payType: 'Recievable' }, [{ type: 'Recievable', tax_apply: true, tax_amount: '0' }])).toBe(false);
  });
});

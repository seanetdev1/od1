/**
 * Deleting an opening invoice or bill (2026-11-16). It destroyed the invoice
 * and THEN looked for its voucher - one without a voucher threw with the
 * invoice already gone, and the request was never answered. Now the voucher,
 * if any, and the invoice go together, and it always answers.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Invoice, Vouchers, Voucher_Heads, Company, Child_Account } = require('../../models');

const COMPANY = '990097';

describe('POST /invoice/deleteOpeningInvoices', () => {
  let authHeader;
  const stamp = Date.now();
  beforeAll(async () => { ({ authHeader } = await loginAs('employee')); });

  const opening = (n) => Invoice.create({
    invoice_No: `${TEST_PREFIX}OI-${stamp}-${n}`, type: 'Opening Invoice', payType: 'Recievable',
    party_Id: '1', party_Name: `${TEST_PREFIX}Party`, total: '1234.56', companyId: COMPANY,
  }, { fiscalYearCheck: false });

  const del = (body) => request(app).post('/invoice/deleteOpeningInvoices').set('Authorization', authHeader).send(body);

  afterAll(async () => {
    await Invoice.destroy({ where: { companyId: COMPANY }, fiscalYearCheck: false });
  });

  it('removes the invoice, its voucher and the voucher\'s lines', async () => {
    const inv = await opening(1);
    // A voucher belongs to a company that exists.
    const company = await Company.findOne({ attributes: ['id'] });
    const voucher = await Vouchers.create({
      voucher_No: 1, voucher_Id: `${TEST_PREFIX}OIV-${stamp}`, type: 'Opening Invoice', vType: 'OI',
      invoice_Id: String(inv.id), CompanyId: company.id, currency: 'PKR', exRate: '1',
    }, { fiscalYearCheck: false });
    const account = await Child_Account.create({ title: `${TEST_PREFIX}OI PARTY ${stamp}`, subCategory: 'Customer' });
    await Voucher_Heads.create({ VoucherId: voucher.id, amount: '1234.56', defaultAmount: '1234.56', type: 'debit', ChildAccountId: account.id, narration: 'x' });

    const res = await del({ headers: { id: inv.id, invoice_No: inv.invoice_No }, employeeId: null });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(await Invoice.findByPk(inv.id)).toBeNull();
    expect(await Vouchers.findByPk(voucher.id)).toBeNull();
    expect(await Voucher_Heads.count({ where: { VoucherId: voucher.id } })).toBe(0);
    await account.destroy();
  });

  it('one with no voucher - a migrated one - is removed and answered, not left hanging', async () => {
    const inv = await opening(2);
    const res = await del({ headers: { id: inv.id } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(await Invoice.findByPk(inv.id)).toBeNull();
  });

  it('nothing given: refused, and said so', async () => {
    const res = await del({});
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
  });
});

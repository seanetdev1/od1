/**
 * Which screen a voucher belongs to (functions/voucherSource) - asked about
 * 2026-11-13: ADJ-P-113/27 opened on the Voucher screen could not be edited,
 * and there was no Delete. It is a Direct Job adjustment's voucher: changed
 * or deleted there, it stops matching the entry's own lines. The Voucher
 * screen and the Voucher List now leave such a voucher to its own screen, and
 * edit and delete their own.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const db = require('../../models');

describe('a voucher another record made is changed and deleted there', () => {
  const stamp = Date.now();
  let admin; let company; let n = 0;
  const made = { vouchers: [], lines: [], entries: [], accounts: [] };

  const voucher = async (values) => {
    n += 1;
    const v = await db.Vouchers.create({
      voucher_No: 900000 + n, voucher_Id: `${TEST_PREFIX}V-${stamp}-${n}`, type: 'Journal Voucher', vType: 'JV',
      CompanyId: company.id, currency: 'PKR', exRate: '1', ...values,
    }, { fiscalYearCheck: false });
    made.vouchers.push(v.id);
    return v;
  };
  const byId = (v) => request(app).get('/voucher/getVoucherById').set('Authorization', admin.authHeader).set('id', String(v.id));
  const del = (v) => request(app).post('/voucher/deleteBaseVoucher').set('Authorization', admin.authHeader).send({ id: v.id });
  const update = (v) => request(app).post('/voucher/updateVoucher').set('Authorization', admin.authHeader)
    .send({ id: v.id, voucher_Id: v.voucher_Id, vType: v.vType, type: v.type, CompanyId: company.id, Voucher_Heads: [] });

  beforeAll(async () => {
    admin = await loginAs('admin');
    company = await anyCompany();
  });

  afterAll(async () => {
    await db.Direct_Job_Association.destroy({ where: { id: made.lines } });
    await db.Direct_Job.destroy({ where: { id: made.entries } });
    await db.Vouchers.destroy({ where: { id: made.vouchers }, force: true });
    await db.Child_Account.destroy({ where: { id: made.accounts } });
  });

  test('a Direct Job adjustment\'s voucher names its entry, and is neither changed nor deleted here', async () => {
    const account = await db.Child_Account.create({ title: `${TEST_PREFIX}DJ ADJ ${stamp}`, subCategory: 'General' });
    made.accounts.push(account.id);
    const entry = await db.Direct_Job.create({
      Entry_No: 'TST-DE-9113/27', Type: 'expense', Operation: 'logistics', Job_Type: 'single',
      SubType: 'adjustment', Currency: 'PKR', Ex_Rate: 1, Tran_Mode: 'Adjust', Account_No: account.id,
    });
    made.entries.push(entry.id);
    const v = await voucher({ type: 'Job Payble', vType: 'ADJ-P' });
    const line = await db.Direct_Job_Association.create({
      Direct_Job_Id: entry.id, Voucher_Id: v.id, Job_No: 'TST-CCJ-1/27', Charge_Name: 'ADJ', Quantity: 1,
      Currency: 'PKR', Ex_Rate: 1, Amount: 11300, Tax_Apply: false,
    });
    made.lines.push(line.id);

    const got = await byId(v);
    expect(got.body.source).toEqual({ screen: 'Direct Job', label: 'Direct Job TST-DE-9113/27', open: { page: 'directJob', id: entry.id } });

    const refused = await del(v);
    expect(refused.status).toBe(409);
    expect(refused.body.result).toBe(`${v.voucher_Id} was made by Direct Job TST-DE-9113/27 (Direct Job). Delete it there - here, the voucher would stop matching the record it came from.`);
    expect(await db.Vouchers.findByPk(v.id)).not.toBeNull();
    const notChanged = await update(v);
    expect(notChanged.status).toBe(409);
    expect(notChanged.body.result).toMatch(/Change it there/);
  });

  test('a payment or receipt\'s voucher belongs to Payments & Receipts', async () => {
    const v = await voucher({ type: 'Job Reciept', vType: 'BRV' });
    expect((await byId(v)).body.source).toMatchObject({ screen: 'Payments & Receipts', open: { page: 'paymentReceipt', id: v.id } });
    expect((await del(v)).status).toBe(409);
  });

  test('an invoice\'s voucher belongs to the invoice', async () => {
    const v = await voucher({ type: 'Sales Invoice', vType: 'SI', invoice_Voucher: '1', invoice_Id: '999999999' });
    expect((await byId(v)).body.source).toMatchObject({ screen: 'Invoices', label: 'an invoice' });
    expect((await del(v)).status).toBe(409);
  });

  test('the Voucher screen\'s own voucher has no other screen - it is deleted here', async () => {
    const v = await voucher({});
    expect((await byId(v)).body.source).toBeNull();
    const res = await del(v);
    expect(res.status).toBe(200);
    expect(await db.Vouchers.findByPk(v.id)).toBeNull();
  });

  test('an opening balance is still deleted through here by its own list', async () => {
    const v = await voucher({ type: 'Opening Balance', vType: 'OP' });
    expect((await byId(v)).body.source).toMatchObject({ screen: 'Opening Balances' });
    expect((await del(v)).status).toBe(200);
  });

  test('a voucher that is not there is said so', async () => {
    expect((await del({ id: 999999999 })).status).toBe(404);
  });
});

const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Vouchers, Voucher_Heads, Company, Invoice, Child_Account } = require('../../models');

// Pins the fixes for the critical findings of the financial audit (September
// 2026). Each block names the finding it guards, so a failure here says which
// control has come undone rather than only which route misbehaved.
//
// Rows are seeded straight through the models with `{ fiscalYearCheck: false }`
// - the escape hatch the import routes use - because none of these behaviours
// depends on the fiscal-year flow, and pulling it in would make every test here
// fail for an unrelated reason first.
describe('Financial controls - audit fixes', () => {
  let authHeader;
  let company;
  const vouchers = [];
  const invoices = [];
  const accounts = [];

  const seedVoucher = async (extra = {}) => {
    const v = await Vouchers.create({
      voucher_No: 1,
      voucher_Id: `${TEST_PREFIX}FC-${Date.now()}-${vouchers.length}`,
      type: 'JOURNAL VOUCHER',
      vType: 'JV',
      CompanyId: company.id,
      ...extra,
    }, { fiscalYearCheck: false });
    vouchers.push(v);
    return v;
  };

  const seedInvoice = async (extra = {}) => {
    const inv = await Invoice.create({
      invoice_No: `${TEST_PREFIX}INV-${Date.now()}-${invoices.length}`,
      payType: 'Recievable',
      total: '100',
      recieved: '0',
      paid: '0',
      approved: '0',
      companyId: company.id,
      ...extra,
    }, { fiscalYearCheck: false });
    invoices.push(inv);
    return inv;
  };

  beforeAll(async () => {
    ({ authHeader } = await loginAs('employee'));
    company = await Company.create({ title: `${TEST_PREFIX}FC Company ${Date.now()}`, short: 'TFC' });
  });

  afterAll(async () => {
    const voucherIds = vouchers.map((v) => v.id);
    if (voucherIds.length) {
      await Voucher_Heads.destroy({ where: { VoucherId: voucherIds } });
      await Vouchers.destroy({ where: { id: voucherIds }, fiscalYearCheck: false });
    }
    const invoiceIds = invoices.map((i) => i.id);
    if (invoiceIds.length) {
      await Vouchers.destroy({ where: { invoice_Id: invoiceIds.map(String) }, fiscalYearCheck: false });
      await Invoice.destroy({ where: { id: invoiceIds }, fiscalYearCheck: false });
    }
    if (accounts.length) await Child_Account.destroy({ where: { id: accounts.map((a) => a.id) } });
    await Company.destroy({ where: { id: company.id } });
  });

  // Finding 2: one request deleted every voucher and voucher line.
  describe('the ledger-wide delete endpoint is gone', () => {
    it('POST /voucher/testDeleteVouchers is not a route, and deletes nothing', async () => {
      const survivor = await seedVoucher();
      const res = await request(app).post('/voucher/testDeleteVouchers').set('Authorization', authHeader).send({});
      expect(res.status).toBe(404);
      expect(await Vouchers.count({ where: { id: survivor.id } })).toBe(1);
    });
  });

  // Finding 3: the settled amount was pasted into SQL unescaped.
  describe('Payments & Receipts refuses an amount that is not a number', () => {
    it('rejects the request before anything is written', async () => {
      const inv = await seedInvoice();
      const res = await request(app)
        .post('/voucher/makeTransaction')
        .set('Authorization', authHeader)
        .send({
          transactions: [],
          invoices: [{ id: inv.id, invoice_No: inv.invoice_No, payType: 'Recievable', receiving: '0); SELECT (1' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('error');
      await inv.reload();
      expect(inv.recieved).toBe('0');
    });
  });

  // Finding 7: approving an approved invoice posted it to the ledger again.
  describe('an invoice cannot be approved twice', () => {
    it('refuses an invoice that is already approved, and raises no voucher', async () => {
      const inv = await seedInvoice({ approved: '1' });
      const res = await request(app)
        .post('/invoice/approve')
        .set('Authorization', authHeader)
        .send({ id: inv.id });

      expect(res.body.status).toBe('error');
      expect(res.body.result).toMatch(/already approved/i);
      expect(await Vouchers.count({ where: { invoice_Id: String(inv.id) } })).toBe(0);
    });

    it('refuses an unapproved invoice that already has a voucher in the ledger', async () => {
      const inv = await seedInvoice();
      await seedVoucher({ vType: 'SI', type: 'Job Recievable', invoice_Voucher: '1', invoice_Id: String(inv.id) });
      const res = await request(app)
        .post('/invoice/approve')
        .set('Authorization', authHeader)
        .send({ id: inv.id });

      expect(res.body.status).toBe('error');
      expect(res.body.result).toMatch(/already in the ledger/i);
      expect(await Vouchers.count({ where: { invoice_Id: String(inv.id) } })).toBe(1);
      await inv.reload();
      expect(String(inv.approved)).toBe('0');
    });
  });

  /* Unapproving deletes the invoice's voucher; the receipt that settled it
   * would stay in the books against nothing. The invoice screen greys its
   * toggle - the route refuses too, because the customs charge sheet
   * unapproves in bulk. */
  describe('a settled invoice cannot be unapproved', () => {
    it('refuses a receivable that has been received against, and keeps its voucher', async () => {
      const inv = await seedInvoice({ approved: '1', recieved: '40' });
      await seedVoucher({ vType: 'SI', type: 'Job Recievable', invoice_Voucher: '1', invoice_Id: String(inv.id) });
      const res = await request(app)
        .post('/invoice/unApprove')
        .set('Authorization', authHeader)
        .send({ id: inv.id });

      expect(res.status).toBe(409);
      expect(res.body.result).toMatch(/payments or receipts/i);
      await inv.reload();
      expect(String(inv.approved)).toBe('1');
      expect(await Vouchers.count({ where: { invoice_Id: String(inv.id) } })).toBe(1);
    });

    it('unapproves one that has not been settled', async () => {
      const inv = await seedInvoice({ approved: '1' });
      await seedVoucher({ vType: 'SI', type: 'Job Recievable', invoice_Voucher: '1', invoice_Id: String(inv.id) });
      const res = await request(app)
        .post('/invoice/unApprove')
        .set('Authorization', authHeader)
        .send({ id: inv.id });

      expect(res.body.status).toBe('success');
      await inv.reload();
      expect(String(inv.approved)).toBe('0');
      expect(await Vouchers.count({ where: { invoice_Id: String(inv.id) } })).toBe(0);
    });
  });

  // Finding 5: the Income Statement printed a period but totalled all time.
  describe('the Income Statement keeps to the period it was asked for', () => {
    let account;
    let inPeriod;
    let beforePeriod;

    beforeAll(async () => {
      account = await Child_Account.create({ title: `${TEST_PREFIX}FC Income ${Date.now()}` });
      accounts.push(account);
      inPeriod = await seedVoucher({ createdAt: new Date('2026-07-15T12:00:00Z') });
      beforePeriod = await seedVoucher({ createdAt: new Date('2025-01-15T12:00:00Z') });
      for (const v of [inPeriod, beforePeriod]) {
        await Voucher_Heads.create({
          amount: '100', defaultAmount: '100', type: 'credit',
          VoucherId: v.id, ChildAccountId: account.id,
        });
      }
    });

    const heads = (res) => {
      const mine = (res.body.result || []).find((a) => a.id === account.id);
      return (mine?.Voucher_Heads || []).map((h) => h.VoucherId).sort();
    };

    it('returns only the lines whose voucher falls inside from/to', async () => {
      const res = await request(app)
        .get('/misc/profitLoss/incomeStatement')
        .set('Authorization', authHeader)
        .set('company', String(company.id))
        .set('from', '2026-07-01T09:30:00.000Z')
        .set('to', '2026-09-30T09:30:00.000Z');

      expect(res.body.status).toBe('success');
      expect(heads(res)).toEqual([inPeriod.id]);
    });

    it('still returns everything when no period is sent', async () => {
      const res = await request(app)
        .get('/misc/profitLoss/incomeStatement')
        .set('Authorization', authHeader)
        .set('company', String(company.id));

      expect(heads(res)).toEqual([inPeriod.id, beforePeriod.id].sort());
    });
  });
});

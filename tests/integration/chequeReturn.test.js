const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* CHEQUE RETURN on Payments & Receipts (functions/chequeReturn): a CR voucher
 * reversing every line of a bank receipt, the invoices it settled reopened by
 * its own share, and the receipt then fixed - no second return, no edit, no
 * delete, and the return not deletable either. */
describe('a returned cheque', () => {
  const stamp = Date.now();
  let authHeader; let fiscalYear; let company; let party; let partyAccount; let bank; let invoice;
  const voucherIds = [];
  const spareAccounts = [];

  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYear.id));
  const receive = async (amount) => {
    const res = await auth(request(app).post('/voucher/makeTransaction')).send({
      invoices: [{ id: invoice.id, receiving: amount, payType: 'Recievable', invoice_No: invoice.invoice_No, party_Name: party.name }],
      edit: false, advance: false, payType: 'Recievable', transactionMode: 'Bank', subType: 'Cheque', checkNo: `CHQ-${amount}`,
      partyId: party.id, partyName: party.name, partyType: 'client', type: 'client', totalReceiving: amount, gainLoss: 0,
      companyId: company.id, currency: 'PKR', exRate: 1, fiscalYearId: fiscalYear.id, narration: '', tranDate: '2026-09-01T09:00:00.000Z',
      transactions: [
        { accountName: 'party', type: 'credit', credit: amount, debit: 0, accountType: 'partyAccount', partyId: party.id, currency: 'PKR' },
        { accountName: 'bank', type: 'debit', debit: amount, credit: 0, accountType: 'payAccount', partyId: bank.id, currency: 'PKR' },
      ],
    });
    expect(res.body.status).toBe('success');
    const v = await db.Vouchers.findOne({ where: { CompanyId: company.id, vType: 'BRV' }, order: [['id', 'DESC']] });
    voucherIds.push(v.id);
    return v;
  };
  const returnCheque = (voucherId) => auth(request(app).post('/voucher/chequeReturn'))
    .send({ voucherId, date: '2026-09-10T09:00:00.000Z', fiscalYearId: fiscalYear.id });
  const received = async () => parseFloat((await db.Invoice.findByPk(invoice.id)).recieved);

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Cheque Co ${stamp}`, short: 'TCQ' });
    partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}CHEQUE PARTY ${stamp}`, subCategory: 'Customer' });
    party = await db.Clients.create({ name: `${TEST_PREFIX}CHEQUE PARTY ${stamp}` });
    // A line whose partyId equals the receipt's party is posted to the
    // party's ledger (/makeTransaction) - Clients and Child_Accounts ids
    // overlap, so on a fresh database the bank can share the party's number.
    // A second one when it does.
    bank = await db.Child_Account.create({ title: `${TEST_PREFIX}CHEQUE BANK ${stamp}`, subCategory: 'Bank' });
    if (bank.id === party.id) {
      spareAccounts.push(bank);
      bank = await db.Child_Account.create({ title: `${TEST_PREFIX}CHEQUE BANK 2 ${stamp}`, subCategory: 'Bank' });
    }
    await db.Client_Associations.create({ ClientId: party.id, ChildAccountId: partyAccount.id });
    invoice = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}CQ-${stamp}`, payType: 'Recievable', total: '1000', recieved: '0', paid: '0',
      approved: '1', companyId: company.id, currency: 'PKR', party_Id: String(partyAccount.id),
    }, { fiscalYearCheck: false });
  });

  afterAll(async () => {
    const all = await db.Vouchers.findAll({ where: { CompanyId: company.id }, attributes: ['id'] });
    const ids = [...new Set([...voucherIds, ...all.map((v) => v.id)])];
    await db.Invoice_Transactions.destroy({ where: { VoucherId: ids } });
    await db.Voucher_Heads.destroy({ where: { VoucherId: ids } });
    await db.Vouchers.destroy({ where: { id: ids }, fiscalYearCheck: false });
    await db.Invoice.destroy({ where: { id: invoice.id }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { ClientId: party.id } });
    await db.Clients.destroy({ where: { id: party.id } });
    await db.Child_Account.destroy({ where: { id: [partyAccount.id, bank.id, ...spareAccounts.map((a) => a.id)] } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  let first; let second; let cr;

  it('posts a CR reversing every line, on the day it came back', async () => {
    first = await receive(400);
    second = await receive(100);
    expect(await received()).toBe(500);

    const res = await returnCheque(first.id);
    expect(res.body.status).toBe('success');
    cr = await db.Vouchers.findOne({ where: { returnOfId: first.id } });
    voucherIds.push(cr.id);
    expect(cr).toMatchObject({ vType: 'CR', type: 'CHEQUE RETURN', partyId: String(party.id), chequeNo: 'CHQ-400' });
    expect(cr.voucherNarration).toMatch(/^Reversal: Received Cheque CHQ-400/);
    expect(cr.createdAt.toISOString()).toBe('2026-09-10T09:00:00.000Z');

    const lines = await db.Voucher_Heads.findAll({ where: { VoucherId: cr.id } });
    const side = (account) => lines.filter((l) => l.ChildAccountId === account.id).map((l) => [l.type, parseFloat(l.amount)]);
    expect(side(bank)).toEqual([['credit', 400]]);
    expect(side(partyAccount)).toEqual([['debit', 400]]);
  });

  it("reopens the invoice by this receipt's share only", async () => {
    expect(await received()).toBe(100);
    expect(await db.Invoice_Transactions.count({ where: { VoucherId: first.id } })).toBe(0);
    expect(await db.Invoice_Transactions.count({ where: { VoucherId: second.id } })).toBe(1);
  });

  it('is shown on the receipt in the Payments & Receipts list', async () => {
    const res = await auth(request(app).get('/voucher/getAllJobPayRecVouchers')).query({ companyid: company.id, limit: 50 });
    const row = (id) => res.body.result.find((v) => v.id === id);
    expect(row(first.id).returnedBy).toBe(cr.voucher_Id);
    expect(row(second.id).returnedBy).toBeNull();
  });

  it('leaves the receipt fixed: no second return, no edit, no delete', async () => {
    const again = await returnCheque(first.id);
    expect(again.status).toBe(400);
    expect(again.body.result).toMatch(/already returned/);

    const edit = await auth(request(app).post('/voucher/makeTransaction')).send({ edit: true, voucherId: first.id, transactions: [], invoices: [] });
    expect(edit.status).toBe(400);
    expect(edit.body.result).toMatch(/was returned/);

    const del = await auth(request(app).post('/voucher/deletePaymentReceipt')).send({ id: first.id });
    expect(del.status).toBe(400);
    expect(await db.Vouchers.count({ where: { id: first.id } })).toBe(1);
  });

  it('cannot itself be deleted, edited, or returned', async () => {
    const del = await auth(request(app).post('/voucher/deleteVoucher')).send({ type: 'VoucherId Exists', id: cr.id });
    expect(del.status).toBe(400);
    expect(await db.Vouchers.count({ where: { id: cr.id } })).toBe(1);

    const edit = await auth(request(app).post('/voucher/voucherEdit')).send({ id: cr.id, returnOfId: null, Voucher_Heads: [] });
    expect(edit.status).toBe(400);
    expect((await db.Vouchers.findByPk(cr.id)).returnOfId).toBe(first.id);

    expect((await returnCheque(cr.id)).status).toBe(400);
  });

  it('only on a bank voucher - a cash receipt has no cheque', async () => {
    const cash = await db.Vouchers.create({
      voucher_No: 1, voucher_Id: `${TEST_PREFIX}CRV-${stamp}`, type: 'Job Reciept', vType: 'CRV', CompanyId: company.id,
    }, { fiscalYearCheck: false });
    voucherIds.push(cash.id);
    const res = await returnCheque(cash.id);
    expect(res.status).toBe(400);
    expect(res.body.result).toMatch(/Only a bank payment or receipt/);
  });
});

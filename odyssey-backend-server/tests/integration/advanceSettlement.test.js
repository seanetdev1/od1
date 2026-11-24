const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* SETTLING AN ADVANCE - POST /voucher/settleTransaction, and the advance's
 * leftover as a row of Job Balancing (functions/advanceSettlement,
 * functions/jobBalancingAdvances; the user's choices, 2026-11-06).
 *
 * The workflow: an advance receipt; later the invoices it pays are ticked
 * against it. Only the knock-offs change - the voucher and its ledger lines
 * never do - and what is not ticked stays as advance, which Job Balancing now
 * shows so its bottom line is the party's ledger. */
describe('settling an advance', () => {
  const stamp = Date.now();
  const DATE = '2026-09-15T10:00:00.000Z';
  let authHeader; let employeeId; let fiscalYear; let company; let party; let partyAccount; let bank;
  const voucherIds = [];
  const invoiceIds = [];

  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYear.id));
  const recieved = async (inv) => Number((await db.Invoice.findByPk(inv.id)).recieved);
  const lines = async (id) => (await db.Voucher_Heads.findAll({ where: { VoucherId: id }, order: [['id', 'ASC']], raw: true }))
    .map((h) => [h.accountType, h.type, Number(h.amount), h.ChildAccountId]);

  const raise = async (total) => {
    const inv = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}JI-${stamp}-${invoiceIds.length}`, invoice_Id: 1, type: 'Job Invoice',
      payType: 'Recievable', operation: 'SE', status: '1', approved: '1', roundOff: '0', currency: 'PKR', ex_rate: '1',
      party_Id: String(partyAccount.id), party_Name: party.name, partyType: 'client',
      total: String(total), recieved: '0', paid: '0', companyId: String(company.id), FiscalYearId: fiscalYear.id,
      createdAt: DATE,
    }, { fiscalYearCheck: false });
    invoiceIds.push(inv.id);
    return inv;
  };

  // A receipt through Payments & Receipts: an advance when `shares` is empty.
  const receipt = async (amount, shares = []) => {
    const res = await auth(request(app).post('/voucher/makeTransaction')).send({
      invoices: shares.map(([inv, receiving]) => ({ id: inv.id, receiving, payType: 'Recievable', invoice_No: inv.invoice_No, party_Name: party.name })),
      edit: false, advance: shares.length === 0, payType: 'Recievable', transactionMode: 'Bank', subType: 'Cheque',
      checkNo: '1', checkDate: DATE, partyId: party.id, partyName: party.name, partyType: 'client', type: 'client',
      gainLoss: 0, totalReceiving: amount, companyId: company.id, currency: 'PKR', exRate: 1,
      fiscalYearId: fiscalYear.id, narration: '', tranDate: DATE, employeeId,
      transactions: [
        { accountName: 'party', accountType: 'partyAccount', onParty: true, partyId: party.id, currency: 'PKR', type: 'credit', credit: amount, debit: 0 },
        { accountName: 'bank', accountType: 'payAccount', partyId: bank.id, currency: 'PKR', type: 'debit', debit: amount, credit: 0 },
      ],
    });
    expect(res.body.status).toBe('success');
    voucherIds.push(res.body.result.id);
    return res.body.result.id;
  };
  const settle = (voucherId, shares) => auth(request(app).post('/voucher/settleTransaction')).send({
    voucherId, employeeId, invoices: shares.map(([inv, receiving]) => ({ id: inv.id, receiving })),
  });

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Advance Co ${stamp}`, short: 'TAD' });
    partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}ADV PARTY ${stamp}`, subCategory: 'Customer' });
    bank = await db.Child_Account.create({ title: `${TEST_PREFIX}ADV BANK ${stamp}`, subCategory: 'Bank' });
    party = await db.Clients.create({ name: `${TEST_PREFIX}ADV PARTY ${stamp}`, types: 'Shipper' });
    await db.Client_Associations.create({ ClientId: party.id, ChildAccountId: partyAccount.id });
  });

  afterAll(async () => {
    await db.Invoice_Transactions.destroy({ where: { VoucherId: voucherIds } });
    await db.Voucher_Heads.destroy({ where: { VoucherId: voucherIds } });
    await db.Vouchers.destroy({ where: { id: voucherIds }, fiscalYearCheck: false });
    await db.Invoice.destroy({ where: { id: invoiceIds }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { ClientId: party.id } });
    await db.Clients.destroy({ where: { id: party.id } });
    await db.Child_Account.destroy({ where: { id: [partyAccount.id, bank.id] } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  let adv; let a; let b;

  it('ticks part of an advance: the invoice is paid, the voucher is not touched', async () => {
    adv = await receipt(1000);
    a = await raise(600);
    b = await raise(700);
    const before = await lines(adv);

    const res = await settle(adv, [[a, 600]]);
    expect(res.body).toMatchObject({ status: 'success', result: { applied: 600, left: 400 } });
    expect(await recieved(a)).toBe(600);
    // The receipt is still 1,000 - it used to shrink to what was ticked.
    expect(await lines(adv)).toEqual(before);
    expect((await db.Vouchers.findByPk(adv)).invoices).toBe(`${a.id},`);
  });

  it('settles the rest later; more than is left is refused', async () => {
    expect((await settle(adv, [[b, 400]])).body.result).toMatchObject({ applied: 1000, left: 0 });
    expect(await recieved(b)).toBe(400);

    const refused = await settle(adv, [[b, 500]]);
    expect(refused.status).toBe(400);
    expect(refused.body.result).toMatch(/is 1,000\.00; the invoices ticked come to 1,100\.00 - 100\.00 more than it has/);
    expect(await recieved(b)).toBe(400);
  });

  it('unticking gives the share back to the advance', async () => {
    expect((await settle(adv, [[a, 0]])).body.result).toMatchObject({ applied: 400, left: 600 });
    expect(await recieved(a)).toBe(0);
    expect(await db.Invoice_Transactions.count({ where: { InvoiceId: a.id, VoucherId: adv } })).toBe(0);
  });

  it("another receipt's payment on the same invoice stays", async () => {
    await receipt(200, [[a, 200]]);
    expect(await recieved(a)).toBe(200);
    await settle(adv, [[a, 300]]);
    expect(await recieved(a)).toBe(500);
  });

  it("Job Balancing shows the advance's leftover, and its bottom line is the ledger", async () => {
    const res = await auth(request(app).get('/invoice/jobBalancing')).set({
      company: String(company.id), party: String(party.id), from: '2026-01-01', to: '2026-12-31', paytype: 'All',
    });
    expect(res.body.status).toBe('success');
    const rows = res.body.result;
    const advanceRow = rows.find((r) => r.advance);
    // 1,000 in; 300 on A and 400 on B knocked off - 300 left.
    expect(advanceRow).toMatchObject({ voucherId: adv, total: '0', recieved: '300', payType: 'Recievable' });

    const outstanding = rows.reduce((t, r) => t + Number(r.total) - Number(r.payType === 'Recievable' ? r.recieved : r.paid), 0);
    const ledger = (await db.Voucher_Heads.findAll({ where: { ChildAccountId: partyAccount.id } }))
      .reduce((t, h) => t + (h.type === 'debit' ? 1 : -1) * Number(h.amount), 0);
    // Invoices 1,300 raised (no SI voucher here), receipts 1,200: the ledger
    // holds only the receipts, so compare what the receipts did.
    expect(outstanding).toBe(1300 - 500 - 400 - 300);
    expect(ledger).toBe(-1200);
  });

  it('Show Advance Transactions off leaves the advance out; on (or no switch) keeps it', async () => {
    const run = (extra) => auth(request(app).get('/invoice/jobBalancing')).set({
      company: String(company.id), party: String(party.id), from: '2026-01-01', to: '2026-12-31', paytype: 'All', ...extra,
    });
    const hidden = (await run({ advances: 'hide' })).body.result;
    expect(hidden.some((r) => r.advance)).toBe(false);
    expect(hidden.length).toBeGreaterThan(0); // the invoices are still there
    expect((await run({ advances: 'show' })).body.result.some((r) => r.advance)).toBe(true);
  });

  it("the install's setting decides when the filter sends no choice - CL off, SNS on", async () => {
    const KEY = 'jobBalancingAdvances';
    const before = (await db.AppSetting.findOne({ where: { key: KEY } }))?.value;
    const run = (extra = {}) => auth(request(app).get('/invoice/jobBalancing')).set({
      company: String(company.id), party: String(party.id), from: '2026-01-01', to: '2026-12-31', paytype: 'All', ...extra,
    });
    const setting = () => auth(request(app).get('/settings/jobBalancingAdvances'));
    const set = (enabled) => auth(request(app).post('/settings/jobBalancingAdvances')).send({ enabled });
    try {
      await db.AppSetting.destroy({ where: { key: KEY } });
      expect((await setting()).body.result).toEqual({ enabled: true });       // on until turned off
      expect((await run()).body.result.some((r) => r.advance)).toBe(true);

      expect((await set(false)).body.result).toEqual({ enabled: false });
      expect((await setting()).body.result).toEqual({ enabled: false });
      expect((await run()).body.result.some((r) => r.advance)).toBe(false);
      expect((await run({ advances: '' })).body.result.some((r) => r.advance)).toBe(false);
      // The switch moved on the filter still wins for that run.
      expect((await run({ advances: 'show' })).body.result.some((r) => r.advance)).toBe(true);

      expect((await set('no')).status).toBe(400);
    } finally {
      await db.AppSetting.destroy({ where: { key: KEY } });
      if (before != null) await db.AppSetting.create({ key: KEY, value: before });
    }
  });
});

const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* EDITING A RECEIPT KEEPS EVERY OTHER RECEIPT ON ITS INVOICES - functions/receiptEdit.
 *
 * An edit SET each invoice's received to the edited receipt's own share. On
 * SNS, ACS-JI-605/27 (Hasnain Cargo) had 718,706.75 from Climax, 193,582.65
 * from ACS-BRV-429/27 and 47,375 from ACS-BRV-443/27; editing BRV-429 left it
 * at 193,582.65, and editing the Climax receipt next left it at 718,706.75 -
 * Job Balancing 240,957.65 above the ledger (the user's report, 2026-11-05).
 * Bills the same: ACS-JB-655/27 read part-paid after an edit and was paid
 * again. Run through the real route, on real Postgres. */
describe('editing a payment or receipt', () => {
  const stamp = Date.now();
  const DATE = '2026-09-15T10:00:00.000Z';
  let authHeader; let employeeId; let fiscalYear; let company; let party; let partyAccount; let bank;
  const voucherIds = [];
  const invoiceIds = [];

  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYear.id));
  const settledOn = async (id, column = 'recieved') => Number((await db.Invoice.findByPk(id))[column]);

  const raise = async (payType, total) => {
    const inv = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}${payType === 'Recievable' ? 'JI' : 'JB'}-${stamp}-${invoiceIds.length}`,
      invoice_Id: 1, type: payType === 'Recievable' ? 'Job Invoice' : 'Job Bill', payType, operation: 'SE',
      status: '1', approved: '1', roundOff: '0', currency: 'PKR', ex_rate: '1',
      party_Id: String(partyAccount.id), party_Name: party.name, partyType: payType === 'Recievable' ? 'client' : 'vendor',
      total: String(total), recieved: '0', paid: '0', companyId: String(company.id), FiscalYearId: fiscalYear.id,
    }, { fiscalYearCheck: false });
    invoiceIds.push(inv.id);
    return inv;
  };

  // One receipt (or payment) knocking `shares` off: [[invoice, amount], ...].
  const save = async (shares, { payType = 'Recievable', edit = false, voucherId } = {}) => {
    const total = shares.reduce((t, [, a]) => t + a, 0);
    const party_ = payType === 'Recievable'
      ? { type: 'credit', credit: total, debit: 0 } : { type: 'debit', debit: total, credit: 0 };
    const bank_ = payType === 'Recievable'
      ? { type: 'debit', debit: total, credit: 0 } : { type: 'credit', credit: total, debit: 0 };
    const res = await auth(request(app).post('/voucher/makeTransaction')).send({
      invoices: shares.map(([inv, receiving]) => ({ id: inv.id, receiving, payType, invoice_No: inv.invoice_No, party_Name: party.name })),
      edit, voucherId, advance: false, payType, transactionMode: 'Bank', subType: 'Cheque', checkNo: '1', checkDate: DATE,
      partyId: party.id, partyName: party.name, partyType: 'client', type: 'client', gainLoss: 0, totalReceiving: total,
      companyId: company.id, currency: 'PKR', exRate: 1, fiscalYearId: fiscalYear.id, narration: '', tranDate: DATE,
      employeeId,
      transactions: [
        { accountName: 'party', accountType: 'partyAccount', onParty: true, partyId: party.id, currency: 'PKR', ...party_ },
        { accountName: 'bank', accountType: 'payAccount', partyId: bank.id, currency: 'PKR', ...bank_ },
      ],
    });
    expect(res.body.status).toBe('success');
    const id = edit ? voucherId : res.body.result.id;
    if (!voucherIds.includes(id)) voucherIds.push(id);
    return id;
  };

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Receipt Edit Co ${stamp}`, short: 'TRE' });
    partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}EDIT PARTY ${stamp}`, subCategory: 'Customer' });
    bank = await db.Child_Account.create({ title: `${TEST_PREFIX}EDIT BANK ${stamp}`, subCategory: 'Bank' });
    party = await db.Clients.create({ name: `${TEST_PREFIX}EDIT PARTY ${stamp}` });
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

  it('re-saving a receipt unchanged leaves the other receipts on its invoice', async () => {
    const inv = await raise('Recievable', 1000);
    const first = await save([[inv, 600]]);
    await save([[inv, 300]]);
    expect(await settledOn(inv.id)).toBe(900);

    await save([[inv, 600]], { edit: true, voucherId: first });
    // It was 600 - the edited receipt's share alone.
    expect(await settledOn(inv.id)).toBe(900);
  });

  it('changing a receipt\'s share changes the invoice by the difference', async () => {
    const inv = await raise('Recievable', 1000);
    const first = await save([[inv, 600]]);
    await save([[inv, 300]]);

    await save([[inv, 450.5]], { edit: true, voucherId: first });
    expect(await settledOn(inv.id)).toBe(750.5);
  });

  it('an invoice taken off a receipt gives back what that receipt paid', async () => {
    const inv = await raise('Recievable', 1000);
    const other = await raise('Recievable', 500);
    const first = await save([[inv, 600], [other, 500]]);
    await save([[inv, 300]]);

    await save([[inv, 0], [other, 500]], { edit: true, voucherId: first });
    expect(await settledOn(inv.id)).toBe(300);
    expect(await settledOn(other.id)).toBe(500);
  });

  it('a bill: editing one payment keeps the others in paid', async () => {
    const bill = await raise('Payble', 1848248);
    const migratedLike = await save([[bill, 1055510]], { payType: 'Payble' });
    const later = await save([[bill, 792738]], { payType: 'Payble' });
    expect(await settledOn(bill.id, 'paid')).toBe(1848248);

    await save([[bill, 792738]], { payType: 'Payble', edit: true, voucherId: later });
    // ACS-JB-655/27 read 792,738 here, and was paid 1,055,510 again.
    expect(await settledOn(bill.id, 'paid')).toBe(1848248);
    expect(migratedLike).toBeTruthy();
  });

  it('the knock-offs and received agree after every edit', async () => {
    const inv = await raise('Recievable', 1000);
    const a = await save([[inv, 250]]);
    await save([[inv, 250]]);
    await save([[inv, 400]], { edit: true, voucherId: a });
    const knocked = (await db.Invoice_Transactions.findAll({ where: { InvoiceId: inv.id } }))
      .reduce((t, r) => t + Number(r.amount), 0);
    expect(await settledOn(inv.id)).toBe(knocked);
  });
});

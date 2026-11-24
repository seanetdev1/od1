const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* A BANK ACCOUNT WITH THE PARTY'S ID - functions/paymentLines.
 *
 * A Payments & Receipts line was taken for the party's whenever its partyId
 * equalled the party's Clients id, and a bank account is a Child_Account: a
 * different sequence that can land on the same number. Then the bank line
 * posted to the party - the receipt netted to nothing there, the bank never
 * debited. v1.2.88's tag run hit it by chance on a fresh database; here the
 * party is GIVEN the bank's id, so it is hit every time. */
describe('a receipt whose bank account shares the party\'s id', () => {
  const stamp = Date.now();
  const DATE = '2026-09-15T10:00:00.000Z';
  let authHeader; let employeeId; let fiscalYear; let company; let party; let partyAccount; let bank;
  const voucherIds = [];

  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYear.id));
  const receipt = async (amount, marks) => {
    const mark = (on) => (marks ? { onParty: on } : {});
    const res = await auth(request(app).post('/voucher/makeTransaction')).send({
      invoices: [], edit: false, advance: true, payType: 'Recievable', transactionMode: 'Bank', subType: 'Cheque',
      checkNo: '1', checkDate: DATE, partyId: party.id, partyName: party.name, partyType: 'client', type: 'client',
      gainLoss: 0, totalReceiving: amount, companyId: company.id, currency: 'PKR', exRate: 1,
      fiscalYearId: fiscalYear.id, narration: '', tranDate: DATE, employeeId,
      transactions: [
        { accountName: 'party', accountType: 'partyAccount', ...mark(true), partyId: party.id, currency: 'PKR', type: 'credit', credit: amount, debit: 0 },
        { accountName: 'bank', accountType: 'payAccount', ...mark(false), partyId: bank.id, currency: 'PKR', type: 'debit', debit: amount, credit: 0 },
      ],
    });
    expect(res.body.status).toBe('success');
    voucherIds.push(res.body.result.id);
    return res.body.result.id;
  };
  const posted = async (id) => (await db.Voucher_Heads.findAll({ where: { VoucherId: id }, order: [['id', 'ASC']], raw: true }))
    .map((h) => [h.accountType, h.type, Number(h.amount), h.ChildAccountId]);

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Lines Co ${stamp}`, short: 'TLN' });
    partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}LINES PARTY ${stamp}`, subCategory: 'Customer' });
    bank = await db.Child_Account.create({ title: `${TEST_PREFIX}LINES BANK ${stamp}`, subCategory: 'Bank' });
    // The party takes the bank's number - the collision, on purpose.
    if (await db.Clients.findByPk(bank.id)) throw new Error(`Clients ${bank.id} is taken - cannot set up the collision`);
    party = await db.Clients.create({ id: bank.id, name: `${TEST_PREFIX}LINES PARTY ${stamp}` });
    await db.Client_Associations.create({ ClientId: party.id, ChildAccountId: partyAccount.id });
  });

  afterAll(async () => {
    await db.Voucher_Heads.destroy({ where: { VoucherId: voucherIds } });
    await db.Vouchers.destroy({ where: { id: voucherIds }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { ClientId: party.id } });
    await db.Clients.destroy({ where: { id: party.id } });
    await db.Child_Account.destroy({ where: { id: [partyAccount.id, bank.id] } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('the bank line goes to the bank, the party line to the party - by the screen\'s marks', async () => {
    expect(party.id).toBe(bank.id);
    const id = await receipt(1000, true);
    expect(await posted(id)).toEqual([
      ['partyAccount', 'credit', 1000, partyAccount.id],
      ['payAccount', 'debit', 1000, bank.id],
    ]);
  });

  it('unmarked (an older screen) it is read as before - the collision this fixes', async () => {
    const id = await receipt(500, false);
    expect((await posted(id)).map((l) => l[3])).toEqual([partyAccount.id, partyAccount.id]);
  });
});

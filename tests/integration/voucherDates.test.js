const request = require('supertest');
const moment = require('moment');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* A VOUCHER STANDS IN THE LEDGER ON THE DATE PICKED FOR IT.
 *
 * The ledger places every line by Voucher_Heads.createdAt. Read back here as
 * the local DAY, which is what the ledger shows. */
describe('the date a voucher stands on in the ledger', () => {
  const stamp = Date.now();
  let authHeader; let employeeId; let fiscalYear; let company; let party; let partyAccount; let bank;
  const voucherIds = [];

  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYear.id));
  const dayOf = (v) => moment(v).format('YYYY-MM-DD');
  const datesOf = async (voucherId) => {
    const v = await db.Vouchers.findByPk(voucherId);
    const heads = await db.Voucher_Heads.findAll({ where: { VoucherId: voucherId } });
    return { voucher: dayOf(v.createdAt), heads: [...new Set(heads.map((h) => dayOf(h.createdAt)))] };
  };

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Dates Co ${stamp}`, short: 'TDT' });
    partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}DATES PARTY ${stamp}`, subCategory: 'Customer' });
    bank = await db.Child_Account.create({ title: `${TEST_PREFIX}DATES BANK ${stamp}`, subCategory: 'Bank' });
    party = await db.Clients.create({ name: `${TEST_PREFIX}DATES PARTY ${stamp}` });
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

  describe('a voucher made on the Voucher screen', () => {
    const BACK = '2026-08-03T10:00:00.000Z';
    let id;

    it('is saved on the back date picked for it', async () => {
      const res = await auth(request(app).post('/voucher/createVoucher')).send({
        type: 'Journal Voucher', vType: 'JV', currency: 'PKR', exRate: 1, costCenter: 'KHI',
        CompanyId: company.id, fiscalYearId: fiscalYear.id, employeeId, tranDate: BACK, createdAt: BACK,
        Voucher_Heads: [
          { type: 'debit', amount: 100, defaultAmount: 100, ChildAccountId: partyAccount.id, accountType: 'partyAccount', narration: 'x', createdAt: BACK },
          { type: 'credit', amount: 100, defaultAmount: 100, ChildAccountId: bank.id, accountType: 'partyAccount', narration: 'x', createdAt: BACK },
        ],
      });
      expect(res.body.status).toBe('success');
      id = res.body.result.id;
      voucherIds.push(id);
      expect(await datesOf(id)).toEqual({ voucher: dayOf(BACK), heads: [dayOf(BACK)] });
    });
  });

  describe('a payment from Payments & Receipts', () => {
    const pay = (tranDate, over = {}) => auth(request(app).post('/voucher/makeTransaction')).send({
      invoices: [], edit: false, advance: true, payType: 'Recievable', transactionMode: 'Bank', subType: 'Bank',
      partyId: party.id, partyName: party.name, partyType: 'client', type: 'client',
      companyId: company.id, currency: 'PKR', exRate: 1, fiscalYearId: fiscalYear.id, narration: '', tranDate,
      transactions: [
        { accountName: 'party', type: 'credit', credit: 250, debit: 0, accountType: 'partyAccount', partyId: party.id, currency: 'PKR' },
        { accountName: 'bank', type: 'debit', debit: 250, credit: 0, accountType: 'payAccount', partyId: bank.id, currency: 'PKR' },
      ],
      ...over,
    });
    const newest = async () => (await db.Vouchers.findOne({
      where: { CompanyId: company.id, vType: 'BRV' }, order: [['id', 'DESC']],
    }));

    it('reads a DD-MM-YYYY date day first: 05-09-2026 is 5 September, not 9 May', async () => {
      const res = await pay('05-09-2026');
      expect(res.body.status).toBe('success');
      const v = await newest();
      voucherIds.push(v.id);
      expect(await datesOf(v.id)).toEqual({ voucher: '2026-09-05', heads: ['2026-09-05'] });
    });

    it('saves 28-09-2026, which month-first reading made no date at all', async () => {
      const res = await pay('28-09-2026');
      expect(res.body.status).toBe('success');
      const v = await newest();
      voucherIds.push(v.id);
      expect(await datesOf(v.id)).toEqual({ voucher: '2026-09-28', heads: ['2026-09-28'] });
    });

    it('takes the full date the Payments & Receipts screen sends', async () => {
      const res = await pay('2026-08-20T09:00:00.000Z');
      expect(res.body.status).toBe('success');
      const v = await newest();
      voucherIds.push(v.id);
      expect((await datesOf(v.id)).heads).toEqual([dayOf('2026-08-20T09:00:00.000Z')]);
    });

    it('moves the receipt, not just its lines, when an edit changes the date', async () => {
      await pay('2026-08-20T09:00:00.000Z');
      const v = await newest();
      voucherIds.push(v.id);

      const res = await pay('2026-08-25T09:00:00.000Z', { edit: true, voucherId: v.id });
      expect(res.body.status).toBe('success');
      const moved = dayOf('2026-08-25T09:00:00.000Z');
      expect(await datesOf(v.id)).toEqual({ voucher: moved, heads: [moved] });
    });

    /* ACS-ADJ-P-38/27: re-saved at a new rate with a typed narration, its
     * lines took both and its header neither - the screen showed one voucher,
     * the ledger another. */
    it('an edit saves the rate, cheque and typed narration on the voucher, as on its lines', async () => {
      const usd = (amount) => [
        { accountName: 'party', type: 'credit', credit: amount, debit: 0, accountType: 'partyAccount', partyId: party.id, currency: 'USD' },
        { accountName: 'bank', type: 'debit', debit: amount, credit: 0, accountType: 'payAccount', partyId: bank.id, currency: 'USD' },
      ];
      await pay('2026-08-20T09:00:00.000Z', { currency: 'USD', exRate: 328, checkNo: 'ADJUSTMENT', transactions: usd(100) });
      const v = await newest();
      voucherIds.push(v.id);
      expect(v.voucherNarration).toMatch(/^Received Bank ADJUSTMENT/);

      const res = await pay('2026-08-20T09:00:00.000Z', {
        edit: true, voucherId: v.id, currency: 'USD', exRate: 334.44, checkNo: 'CHQ-9',
        narration: 'LDP PAID TO TCI', transactions: usd(100),
      });
      expect(res.body.status).toBe('success');

      const saved = await db.Vouchers.findByPk(v.id);
      expect(saved).toMatchObject({ voucherNarration: 'LDP PAID TO TCI', chequeNo: 'CHQ-9' });
      expect(parseFloat(saved.exRate)).toBe(334.44);
      const heads = await db.Voucher_Heads.findAll({ where: { VoucherId: v.id } });
      expect(heads.map((h) => h.narration)).toEqual(['LDP PAID TO TCI', 'LDP PAID TO TCI']);
      expect(heads.map((h) => Math.round(h.defaultAmount))).toEqual([33444, 33444]);

      const logged = await db.History.findOne({ where: { EmployeeId: employeeId, formName: 'Transaction', type: 'Edit' }, order: [['id', 'DESC']] });
      expect(logged?.docNo).toBe(String(saved.voucher_No));
    });
  });
});

const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* A CASH VOUCHER HAS NO CHEQUE - functions/cashCheque.
 *
 * Reported 2026-10-21. Every screen that writes a cash voucher sent the date
 * picker's default - the moment it was opened - as the cheque date, and
 * Payments & Receipts kept a number typed before the mode was switched to
 * Cash. The ledger's cheque column then showed " | 01-10-2026" against cash
 * paid out of the petty cash box. The server now stores none, whatever is
 * sent. (Direct Job E/R: tests/integration/directJob.) */
describe('cash vouchers carry no cheque', () => {
  const stamp = Date.now();
  const SENT_DATE = '2026-08-03T10:00:00.000Z';
  let authHeader; let employeeId; let fiscalYear; let company; let party; let partyAccount; let cash;
  const voucherIds = [];

  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYear.id));
  const chequeOf = async (id) => {
    const v = await db.Vouchers.findByPk(id);
    return [v.chequeNo, v.chequeDate];
  };

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Cash Co ${stamp}`, short: 'TCQ' });
    partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}CASH PARTY ${stamp}`, subCategory: 'Customer' });
    cash = await db.Child_Account.create({ title: `${TEST_PREFIX}CASH BOX ${stamp}`, subCategory: 'Cash' });
    party = await db.Clients.create({ name: `${TEST_PREFIX}CASH PARTY ${stamp}` });
    await db.Client_Associations.create({ ClientId: party.id, ChildAccountId: partyAccount.id });
  });

  afterAll(async () => {
    await db.Voucher_Heads.destroy({ where: { VoucherId: voucherIds } });
    await db.Vouchers.destroy({ where: { id: voucherIds }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { ClientId: party.id } });
    await db.Clients.destroy({ where: { id: party.id } });
    await db.Child_Account.destroy({ where: { id: [partyAccount.id, cash.id] } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  describe('on the Voucher screen', () => {
    const voucher = (vType, over = {}) => ({
      type: 'Payment Voucher', vType, currency: 'PKR', exRate: 1, costCenter: 'KHI',
      subType: vType === 'CPV' ? 'Cash' : 'Bank',
      chequeNo: '777', chequeDate: SENT_DATE,
      CompanyId: company.id, fiscalYearId: fiscalYear.id, employeeId, tranDate: SENT_DATE, createdAt: SENT_DATE,
      Voucher_Heads: [
        { type: 'debit', amount: 100, defaultAmount: 100, ChildAccountId: partyAccount.id, accountType: 'partyAccount', narration: 'x', createdAt: SENT_DATE },
        { type: 'credit', amount: 100, defaultAmount: 100, ChildAccountId: cash.id, accountType: 'payAccount', narration: 'x', createdAt: SENT_DATE },
      ],
      ...over,
    });
    const create = async (vType) => {
      const res = await auth(request(app).post('/voucher/createVoucher')).send(voucher(vType));
      expect(res.body.status).toBe('success');
      voucherIds.push(res.body.result.id);
      return res.body.result;
    };

    it.each(['CPV', 'CRV'])('a %s is saved with no cheque number or date', async (vType) => {
      const made = await create(vType);
      expect(await chequeOf(made.id)).toEqual(['', null]);
    });

    it('a bank voucher keeps the cheque it was given', async () => {
      const made = await create('BPV');
      const [no, date] = await chequeOf(made.id);
      expect(no).toBe('777');
      expect(date).toBeTruthy();
    });

    it('re-saving a cash voucher clears a cheque an earlier save stored', async () => {
      const made = await create('CPV');
      await db.Vouchers.update({ chequeDate: SENT_DATE }, { where: { id: made.id }, fiscalYearCheck: false });

      const heads = await db.Voucher_Heads.findAll({ where: { VoucherId: made.id }, raw: true });
      const res = await auth(request(app).post('/voucher/updateVoucher')).send(voucher('CPV', {
        id: made.id, voucher_No: made.voucher_No, voucher_Id: made.voucher_Id, FiscalYearId: fiscalYear.id, Voucher_Heads: heads,
      }));
      expect(res.body.status).toBe('success');
      expect(await chequeOf(made.id)).toEqual(['', null]);
    });
  });

  describe('on Payments & Receipts', () => {
    const pay = (transactionMode, over = {}) => auth(request(app).post('/voucher/makeTransaction')).send({
      invoices: [], edit: false, advance: true, payType: 'Recievable', transactionMode,
      subType: transactionMode === 'Cash' ? 'Cash' : 'Cheque',
      checkNo: '777', checkDate: SENT_DATE,
      partyId: party.id, partyName: party.name, partyType: 'client', type: 'client',
      companyId: company.id, currency: 'PKR', exRate: 1, fiscalYearId: fiscalYear.id, narration: '', tranDate: SENT_DATE,
      transactions: [
        { accountName: 'party', type: 'credit', credit: 250, debit: 0, accountType: 'partyAccount', partyId: party.id, currency: 'PKR' },
        { accountName: 'cash', type: 'debit', debit: 250, credit: 0, accountType: 'payAccount', partyId: cash.id, currency: 'PKR' },
      ],
      ...over,
    });
    const newest = async (vType) => {
      const v = await db.Vouchers.findOne({ where: { CompanyId: company.id, vType }, order: [['id', 'DESC']] });
      voucherIds.push(v.id);
      return v;
    };

    it('a cash receipt is saved with no cheque, and none in its narration', async () => {
      const res = await pay('Cash');
      expect(res.body.status).toBe('success');
      const v = await newest('CRV');
      expect([v.chequeNo, v.chequeDate]).toEqual(['', null]);
      expect(v.voucherNarration).not.toMatch(/777|Date:/);
      const heads = await db.Voucher_Heads.findAll({ where: { VoucherId: v.id } });
      heads.forEach((h) => expect(h.narration).not.toMatch(/777|Date:/));
    });

    it('editing a cash receipt clears a cheque an earlier save stored', async () => {
      await pay('Cash');
      const v = await newest('CRV');
      await db.Vouchers.update({ chequeNo: '777', chequeDate: SENT_DATE }, { where: { id: v.id }, fiscalYearCheck: false });

      const res = await pay('Cash', { edit: true, voucherId: v.id });
      expect(res.body.status).toBe('success');
      expect(await chequeOf(v.id)).toEqual(['', null]);
    });

    it('a bank receipt keeps its cheque', async () => {
      const res = await pay('Bank');
      expect(res.body.status).toBe('success');
      const v = await newest('BRV');
      expect(v.chequeNo).toBe('777');
      expect(v.chequeDate).toBeTruthy();
    });
  });
});

const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const db = require('../../models');

/* A VOUCHER'S LINES IN THE ORDER THEY WERE MADE (the user's request,
 * 2026-10-22 - ACS-CPV-90/27's eight petty cash lines came back shuffled).
 *
 * getVoucherById read the lines with no ORDER BY, so Postgres returned them
 * as it held them - and saving a voucher rewrites its lines (an UPDATE is a
 * new row version), so an edited voucher's lines moved around. Also: vouchers
 * of one date share a midnight createdAt, so the Vouchers list put them in no
 * particular order, and its OFFSET paging could repeat or skip one. */
describe('the order of vouchers and their lines', () => {
  const stamp = Date.now();
  let authHeader; let employeeId; let fiscalYear; let company; let cash; let accounts;
  const voucherIds = [];
  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYear.id));
  const DAY = '2026-08-03T00:00:00.000Z';

  const line = (account, amount, narration, type = 'debit') => ({
    type, amount, defaultAmount: amount, ChildAccountId: account.id, accountType: 'partyAccount', narration, createdAt: DAY,
  });
  const create = async (lines) => {
    const total = lines.reduce((t, l) => t + l.amount, 0);
    const res = await auth(request(app).post('/voucher/createVoucher')).send({
      type: 'Journal Voucher', vType: 'JV', currency: 'PKR', exRate: 1, costCenter: 'KHI',
      CompanyId: company.id, fiscalYearId: fiscalYear.id, employeeId, tranDate: DAY, createdAt: DAY,
      Voucher_Heads: [...lines, line(cash, total, 'TO RECORD EXP', 'credit')],
    });
    expect(res.body.status).toBe('success');
    voucherIds.push(res.body.result.id);
    return res.body.result;
  };

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await anyFiscalYear();
    company = await db.Company.create({ title: `${TEST_PREFIX}Order Co ${stamp}`, short: 'TOR' });
    cash = await db.Child_Account.create({ title: `${TEST_PREFIX}PETTY CASH ${stamp}`, subCategory: 'Cash' });
    accounts = await Promise.all(['DRAWING', 'PRINTING', 'POSTAGE'].map((t) => db.Child_Account.create({ title: `${TEST_PREFIX}${t} ${stamp}`, subCategory: 'General' })));
  });

  afterAll(async () => {
    await db.Voucher_Heads.destroy({ where: { VoucherId: voucherIds } });
    await db.Vouchers.destroy({ where: { id: voucherIds }, fiscalYearCheck: false });
    await db.Child_Account.destroy({ where: { id: [cash.id, ...accounts.map((a) => a.id)] } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('opens with its lines in the order they were made, even after the lines were rewritten', async () => {
    const [drawing, printing, postage] = accounts;
    const v = await create([line(drawing, 50000, 'BOSS DRAWING'), line(printing, 2400, 'VISITING CARD'), line(postage, 6980, 'COURIER')]);
    // An edit rewrites the first line - a new row version at the end of the
    // table, which is where an unordered read finds it.
    const first = await db.Voucher_Heads.findOne({ where: { VoucherId: v.id }, order: [['id', 'ASC']] });
    await db.Voucher_Heads.update({ narration: 'BOSS DRAWING (EDITED)' }, { where: { id: first.id } });

    const res = await auth(request(app).get('/voucher/getVoucherById')).set('id', String(v.id));
    const heads = res.body.result.Voucher_Heads;
    expect(heads.map((h) => h.id)).toEqual([...heads.map((h) => h.id)].sort((a, b) => a - b));
    expect(heads.map((h) => h.narration)).toEqual(['BOSS DRAWING (EDITED)', 'VISITING CARD', 'COURIER', 'TO RECORD EXP']);
  });

  it('lists vouchers of the same date newest first, the same way every time', async () => {
    const made = [];
    for (let i = 0; i < 3; i += 1) made.push((await create([line(accounts[0], 100 + i, `SAME DAY ${i}`)])).id);
    const res = await auth(request(app).get('/voucher/getAllVouchers')).set('id', String(company.id)).query({ limit: 50 });
    const listed = res.body.result.map((v) => v.id).filter((id) => made.includes(id));
    expect(listed).toEqual([...made].reverse());
  });
});

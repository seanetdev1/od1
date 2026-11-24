const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Office_Vouchers, Vouchers, Voucher_Heads, Child_Account, Company } = require('../../models');
const { Op } = require('sequelize');

// routes/voucher/index.js has no requireDesignation gates. Full voucher
// creation through the route (/voucherCreation, /createVoucher,
// /makeTransaction, etc.) needs a resolved FiscalYear + real Child_Account
// chart-of-accounts rows, which is a lot of unrelated setup for "basic CRUD
// smoke coverage" - this file exercises the Office_Vouchers sub-resource for
// a real create/read/update path instead, plus smoke coverage (auth +
// non-throwing) on the read-only Vouchers endpoints.
//
// Office_Vouchers.EmployeeId and Office_Vouchers.VoucherId are both
// allowNull:false (see functions/Associations/voucherAssociations), and
// Vouchers.CompanyId is also allowNull:false (see the same file) - so even
// this "simple" sub-resource needs one real Company + one real Vouchers row
// as FK prerequisites. Those are seeded directly via the models (bypassing
// the fiscal-year-resolution beforeCreate hook with
// `{ fiscalYearCheck: false }`, the same escape hatch legacy-import routes
// use) rather than through the API, since creating them "for real" would
// pull in the fiscal year flow this file is deliberately avoiding.
describe('Voucher - routes/voucher/index.js (smoke coverage)', () => {
  let authHeader;
  let employee;
  let company;
  let prereqVoucher;

  beforeAll(async () => {
    ({ authHeader, employee } = await loginAs('employee'));
    company = await Company.create({ title: `${TEST_PREFIX}Company ${Date.now()}`, short: 'TST' });
    prereqVoucher = await Vouchers.create(
      {
        voucher_No: 1,
        voucher_Id: `${TEST_PREFIX}V-${Date.now()}`,
        type: 'Office',
        vType: 'OV',
        CompanyId: company.id,
      },
      { fiscalYearCheck: false }
    );
  });

  afterAll(async () => {
    await Office_Vouchers.destroy({ where: { EmployeeId: employee.id } });
    await Vouchers.destroy({ where: { id: prereqVoucher.id }, fiscalYearCheck: false });
    await Company.destroy({ where: { id: company.id } });
  });

  it('rejects requests with no auth token at all (401)', async () => {
    const res = await request(app).get('/voucher/getAllVouchers');
    expect(res.status).toBe(401);
  });

  describe('Office_Vouchers CRUD', () => {
    it('creates an office voucher via /voucher/OfficeVoucherUpsert', async () => {
      const res = await request(app)
        .post('/voucher/OfficeVoucherUpsert')
        .set('Authorization', authHeader)
        .send({
          requestedBy: `${TEST_PREFIX}Someone`,
          preparedBy: `${TEST_PREFIX}Preparer`,
          amount: '1000',
          approved: false,
          EmployeeId: employee.id,
          VoucherId: prereqVoucher.id,
        });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result[0]).toHaveProperty('id');
    });

    it('reads it back via /voucher/OfficeVoucherById', async () => {
      const created = (
        await request(app)
          .post('/voucher/OfficeVoucherUpsert')
          .set('Authorization', authHeader)
          .send({ requestedBy: `${TEST_PREFIX}ReadBack`, amount: '500', EmployeeId: employee.id, VoucherId: prereqVoucher.id })
      ).body.result[0];

      const res = await request(app)
        .get('/voucher/OfficeVoucherById')
        .set('Authorization', authHeader)
        .set('id', String(created.id));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result.id).toBe(created.id);
    });

    it('approves an office voucher via /voucher/ApproveOfficeVoucher', async () => {
      const created = (
        await request(app)
          .post('/voucher/OfficeVoucherUpsert')
          .set('Authorization', authHeader)
          .send({ requestedBy: `${TEST_PREFIX}ToApprove`, amount: '250', approved: false, EmployeeId: employee.id, VoucherId: prereqVoucher.id })
      ).body.result[0];

      const res = await request(app)
        .post('/voucher/ApproveOfficeVoucher')
        .set('Authorization', authHeader)
        .send({ id: created.id, approved: true, VoucherId: prereqVoucher.id });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');

      const updated = await Office_Vouchers.findByPk(created.id);
      expect(updated.approved).toBe(true);
    });

    // FIXED: models/Office_Vouchers.js used to declare
    // `CompanyId: { type: DataTypes.BOOLEAN }` - clearly wrong, since every
    // other route in this codebase treats company ids as small integers
    // (e.g. routes/voucher's own "SNS"/"CLS"/"ACS" mapping). Postgres used
    // to accept "1"/"0" as boolean literals (so id 1 "worked" by
    // coincidence) but threw a real type-cast error for any other id, e.g.
    // "4". It's now DataTypes.INTEGER, so arbitrary company ids work.
    it('/voucher/OfficeAllVouchers succeeds for a real (non-boolean-like) company id like "4"', async () => {
      const res = await request(app)
        .get('/voucher/OfficeAllVouchers')
        .set('Authorization', authHeader)
        .set('companyid', '4');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.result)).toBe(true);
    });

    it('also succeeds for company id "1" (previously only worked by boolean-cast coincidence)', async () => {
      const res = await request(app)
        .get('/voucher/OfficeAllVouchers')
        .set('Authorization', authHeader)
        .set('companyid', '1');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.result)).toBe(true);
    });
  });

  describe('the Voucher List is paged and searched on the server', () => {
    /* It used to be neither: findAll with no limit, every voucher and its
     * heads in one response, `count: 1`, and the screen slicing twenty rows
     * out of what it already held. On the first customs install that is 59,745
     * vouchers and 63,094 heads fetched to show twenty. */
    let extra = [];

    beforeAll(async () => {
      // Enough to page, plus one that is findable only by search.
      for (let i = 0; i < 25; i++) {
        extra.push(await Vouchers.create({
          voucher_No: 100 + i,
          voucher_Id: `${TEST_PREFIX}VL-${i}`,
          type: 'Office', vType: 'OV',
          payTo: i === 7 ? `${TEST_PREFIX}NEEDLE PARTY` : `${TEST_PREFIX}HAYSTACK`,
          CompanyId: company.id,
        }, { fiscalYearCheck: false }));
      }
    });

    afterAll(async () => {
      await Vouchers.destroy({
        where: { id: extra.map((v) => v.id) }, fiscalYearCheck: false,
      });
    });

    const list = (params = {}) => request(app)
      .get('/voucher/getAllVouchers')
      .set('Authorization', authHeader)
      .set('id', String(company.id))
      .query(params);

    it('returns one page and a REAL count, not the literal 1', async () => {
      const res = await list({ page: 1, limit: 10 });
      expect(res.status).toBe(200);
      expect(res.body.result).toHaveLength(10);
      // 25 seeded here + the one from the outer fixture.
      expect(res.body.count).toBe(26);
      expect(res.body.pages).toBe(3);
    });

    it('gives a different page different rows', async () => {
      const one = await list({ page: 1, limit: 10 });
      const two = await list({ page: 2, limit: 10 });
      const idsOne = one.body.result.map((v) => v.id);
      const idsTwo = two.body.result.map((v) => v.id);
      expect(idsTwo).toHaveLength(10);
      expect(idsOne.some((id) => idsTwo.includes(id))).toBe(false);
    });

    it('searches the whole book, not the page in hand', async () => {
      /* The proof is in two halves. Rows come back newest first, so the needle
       * - seeded eighth of twenty-five - is NOT on page 1. If search were the
       * old client-side filter over the rows already fetched, page 1 could
       * never find it. */
      const unsearched = await list({ page: 1, limit: 10 });
      expect(unsearched.body.result.some((v) => String(v.payTo).includes('NEEDLE')))
        .toBe(false);

      const res = await list({ page: 1, limit: 10, search: 'NEEDLE' });
      expect(res.body.count).toBe(1);
      expect(res.body.result).toHaveLength(1);
      expect(res.body.result[0].payTo).toContain('NEEDLE');
    });

    it('is case-insensitive and matches part of a value', async () => {
      const res = await list({ search: 'needle party' });
      expect(res.body.count).toBe(1);
    });

    it('searches the voucher number, which is an integer column', async () => {
      const res = await list({ search: '107' });
      expect(res.body.count).toBeGreaterThanOrEqual(1);
      expect(res.body.result.some((v) => v.voucher_No === 107)).toBe(true);
    });

    it('caps the page size so one request cannot ask for the table', async () => {
      const res = await list({ page: 1, limit: 100000 });
      expect(res.body.limit).toBeLessThanOrEqual(200);
    });

    it('never returns a settlement - those belong to Payments & Receipts', async () => {
      const paid = await Vouchers.create({
        voucher_No: 999, voucher_Id: `${TEST_PREFIX}VL-PAID`,
        type: 'Job Payment', vType: 'BPV', CompanyId: company.id,
      }, { fiscalYearCheck: false });

      const res = await list({ limit: 200 });
      expect(res.body.result.some((v) => v.id === paid.id)).toBe(false);

      await Vouchers.destroy({ where: { id: paid.id }, fiscalYearCheck: false });
    });

    it("gives each payment and receipt its Net Amount - what the bank or cash paid or took in", async () => {
      /* The user's request, 2026-10-26. Salary 100,000 with a 20,000 loan
       * instalment held back: the list's Amount (the debit lines) is 100,000,
       * the bank paid 80,000. A journal has no bank side: null. */
      const account = await Child_Account.create({ title: `${TEST_PREFIX}VL-NET`, subCategory: 'Expense' });
      const bpv = await Vouchers.create({
        voucher_No: 502, voucher_Id: `${TEST_PREFIX}VL-NET-BPV`, type: 'Bank Payment Voucher', vType: 'BPV',
        currency: 'USD', exRate: '280', CompanyId: company.id,
      }, { fiscalYearCheck: false });
      const jv = await Vouchers.create({
        voucher_No: 503, voucher_Id: `${TEST_PREFIX}VL-NET-JV`, type: 'Journal Voucher', vType: 'JV', CompanyId: company.id,
      }, { fiscalYearCheck: false });
      const line = (VoucherId, type, amount, accountType) => Voucher_Heads.create({
        VoucherId, ChildAccountId: account.id, type, amount: String(amount), defaultAmount: String(amount * 280), accountType,
      });
      await line(bpv.id, 'debit', 1000, 'partyAccount');
      await line(bpv.id, 'credit', 200, 'partyAccount');
      await line(bpv.id, 'credit', 800, 'payAccount');
      await line(jv.id, 'debit', 50, 'partyAccount');
      await line(jv.id, 'credit', 50, 'partyAccount');

      const res = await list({ category: 'general', limit: 200 });
      const byId = (id) => res.body.result.find((v) => v.id === id);
      expect(byId(bpv.id)).toMatchObject({ netAmount: 800, netAmountPkr: 224000 });
      // The heads are still the debit ones alone, so the Amount is unchanged.
      expect(byId(bpv.id).Voucher_Heads.map((h) => h.type)).toEqual(['debit']);
      expect(byId(jv.id)).toMatchObject({ netAmount: null, netAmountPkr: null });

      await Voucher_Heads.destroy({ where: { VoucherId: [bpv.id, jv.id] } });
      await Vouchers.destroy({ where: { id: [bpv.id, jv.id] }, fiscalYearCheck: false });
      await Child_Account.destroy({ where: { id: account.id } });
    });

    it('splits into the three tabs on the SERVER, so a tab is never empty by paging', async () => {
      /* The tabs were a client-side filter over the whole table, which only
       * works while the whole table is in the browser. Paged, page one of
       * twenty General rows may hold no SI/PI at all - and that tab would read
       * as empty with 14,530 of them in the book. */
      const si = await Vouchers.create({
        voucher_No: 500, voucher_Id: `${TEST_PREFIX}VL-SI`,
        type: 'SALES INVOICE', vType: 'SI', CompanyId: company.id,
      }, { fiscalYearCheck: false });
      const op = await Vouchers.create({
        voucher_No: 501, voucher_Id: `${TEST_PREFIX}VL-OP`,
        type: 'OPENING BALANCE', vType: 'OP', CompanyId: company.id,
      }, { fiscalYearCheck: false });

      const sipi = await list({ category: 'sipi', limit: 200 });
      expect(sipi.body.result.map((v) => v.id)).toContain(si.id);
      expect(sipi.body.result.map((v) => v.id)).not.toContain(op.id);

      const opening = await list({ category: 'opening', limit: 200 });
      expect(opening.body.result.map((v) => v.id)).toContain(op.id);

      // And neither shows up under General.
      const general = await list({ category: 'general', limit: 200 });
      const ids = general.body.result.map((v) => v.id);
      expect(ids).not.toContain(si.id);
      expect(ids).not.toContain(op.id);

      await Vouchers.destroy({ where: { id: [si.id, op.id] }, fiscalYearCheck: false });
    });

    it('puts a vType belonging to no named tab in General rather than nowhere', async () => {
      /* The old client filter named six codes for General, so a voucher whose
       * vType was none of the eleven across the three tabs appeared in NO tab:
       * 616 on the first customs install - 593 credit notes, 17 cheque returns,
       * 6 debit notes - in the database and absent from every screen. */
      const note = await Vouchers.create({
        voucher_No: 502, voucher_Id: `${TEST_PREFIX}VL-CN`,
        type: 'CREDIT NOTE', vType: 'ADJ-P', CompanyId: company.id,
      }, { fiscalYearCheck: false });

      const res = await list({ category: 'general', limit: 200 });
      expect(res.body.result.map((v) => v.id)).toContain(note.id);

      await Vouchers.destroy({ where: { id: note.id }, fiscalYearCheck: false });
    });

    it('shows a voucher that has no debit head', async () => {
      /* The include carried `where: { type: 'debit' }`, which Sequelize reads
       * as required - an INNER join that silently dropped every voucher with
       * no debit head. 269 rows on the first customs install were simply
       * absent from the list, with nothing to say so. */
      const res = await list({ search: 'VL-3' });
      // None of the seeded vouchers has any head at all.
      expect(res.body.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Read-only Vouchers endpoints (smoke: authenticated + does not throw)', () => {
    it('GET /voucher/getAllVouchers', async () => {
      const res = await request(app).get('/voucher/getAllVouchers').set('Authorization', authHeader).set('id', String(company.id));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.result)).toBe(true);
    });

    // A developer endpoint no screen calls: Seanet-only now.
    it('GET /voucher/testgetAll is refused to anyone but system', async () => {
      const res = await request(app).get('/voucher/testgetAll').set('Authorization', authHeader).set('id', String(company.id));
      expect(res.status).toBe(403);
    });

    it('GET /voucher/getVoucherById returns the seeded voucher for a real id', async () => {
      const res = await request(app)
        .get('/voucher/getVoucherById')
        .set('Authorization', authHeader)
        .set('id', String(prereqVoucher.id));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result.id).toBe(prereqVoucher.id);
    });

    it('GET /voucher/getVoucherById returns a null result (not an error) for an unknown-but-valid-shaped id', async () => {
      // Vouchers.id is an auto-incrementing INTEGER, not a UUID - a
      // non-existent large integer is the right "doesn't exist" probe here
      // (a UUID string would fail Postgres integer parsing and hit the
      // catch block instead, which is a different thing than "not found").
      const res = await request(app)
        .get('/voucher/getVoucherById')
        .set('Authorization', authHeader)
        .set('id', '999999999');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result).toBeNull();
    });

    it('GET /voucher/getVouchersByEmployeeId', async () => {
      const res = await request(app)
        .get('/voucher/getVouchersByEmployeeId')
        .set('Authorization', authHeader)
        .set('id', employee.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.result)).toBe(true);
    });

    it('GET /voucher/getAllJobPayRecVouchers (paginated)', async () => {
      const res = await request(app)
        .get('/voucher/getAllJobPayRecVouchers')
        .set('Authorization', authHeader)
        .query({ page: 1, limit: 10, companyid: String(company.id) });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.result)).toBe(true);
    });
  });
});

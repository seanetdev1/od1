/**
 * Ledger migration receiver - GL_Voucher / GL_Voucher_Detail into Vouchers and
 * Voucher_Heads, then invoice settlement.
 *
 * THE STAGE'S FIRST INTEGRATION TEST. The planner is thoroughly unit-tested
 * and has never once written a row: every case below is the seam where that
 * mapping meets Postgres, which is exactly where the other three customs
 * stages turned out to be broken.
 *
 * On CargoLinkers this is 59,993 vouchers carrying 138,237 detail lines - the
 * largest table in the migration - plus 868 settlements. Vouchers are NOT
 * job-shaped: a clearing agent's receipts and payments are ordinary vouchers,
 * so this stage runs unchanged on a customs install. The one place customs
 * matters is settlement, which has to find an invoice that carries no job.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('Ledger migration (vouchers, heads and settlement)', () => {
  let admin, user, company, client, vendor;
  let receivableControl, payableControl, clientAccount, vendorAccount, bankAccount;
  const BASE = 960000;
  const Op = db.Sequelize.Op;

  // Child_Account.id IS the legacy GL_COA id - the accounts stage preserves it
  // deliberately - so a voucher line names these numbers directly.
  const AC = {
    receivable: BASE + 1, payable: BASE + 2,
    client: BASE + 3, vendor: BASE + 4, bank: BASE + 5,
  };

  const voucher = (n, over = {}) => ({
    Id: BASE + n,
    VoucherNo: `${TEST_PREFIX}BRV-${n}/26`,
    VoucherDate: '2026-08-01T00:00:00.000Z',
    VoucherTypeId: 2,
    CurrencyId: 1,
    ExchangeRate: 1,
    SubCompanyId: BASE + 60,
    Narration: 'Receipt against a clearance invoice',
    AddOn: '2026-08-01T10:00:00.000Z',
    ...over,
  });

  /** Party line then bank line - the two-line shape a receipt really has. */
  const lines = (n, over = {}) => ([
    {
      Id: BASE + 100 + n * 2, VoucherId: BASE + n, COAAccountId: AC.client,
      DebitVC: 1170, CreditVC: 0, DebitLC: 1170, CreditLC: 0,
      NarrationVD: 'ACME', ChequeNumber: '10582568',
      ChequeDate: '2026-08-01T00:00:00.000Z', ...over,
    },
    {
      Id: BASE + 101 + n * 2, VoucherId: BASE + n, COAAccountId: AC.bank,
      DebitVC: 0, CreditVC: 1170, DebitLC: 0, CreditLC: 1170,
      NarrationVD: 'HBL',
    },
  ]);

  const currencies = [{ Id: 1, CurrencyCode: 'PKR' }, { Id: 2, CurrencyCode: 'USD' }];
  const voucherTypes = [
    { Id: 1, TypeCode: 'BPV', VoucherType: 'BANK PAYMENT VOUCHER' },
    { Id: 2, TypeCode: 'BRV', VoucherType: 'BANK RECEIPT VOUCHER' },
  ];

  const applyVouchers = (rows, details, over = {}) =>
    request(app).post('/ledgerMigration/vouchers/apply')
      .set('Authorization', admin.authHeader)
      .send({ rows, details, currencies, voucherTypes, ...over });

  const applySettlements = (rows, invoiceRefs) =>
    request(app).post('/ledgerMigration/settlements/apply')
      .set('Authorization', admin.authHeader)
      .send({ rows, invoiceRefs });

  const account = (id, title, subCategory, parent) => db.Child_Account.create({
    id, title, subCategory, ChildAccountId: parent, code: String(id),
  });

  beforeAll(async () => {
    admin = await loginAs('admin');
    user = await loginAs('employee');

    company = await db.Company.create({
      title: `${TEST_PREFIX}CL`, short: 'TCL', climaxId: BASE + 60,
    });

    receivableControl = await account(AC.receivable, `${TEST_PREFIX}ACCOUNT RECEIVABLE`, null, null);
    payableControl = await account(AC.payable, `${TEST_PREFIX}ACCOUNT PAYABLE`, null, null);
    clientAccount = await account(AC.client, `${TEST_PREFIX}ACME`, 'Customer', AC.receivable);
    vendorAccount = await account(AC.vendor, `${TEST_PREFIX}MAERSK`, 'Vendor', AC.payable);
    bankAccount = await account(AC.bank, `${TEST_PREFIX}HBL CURRENT`, 'Bank', null);

    client = await db.Clients.create({ name: `${TEST_PREFIX}ACME`, climaxId: BASE + 20 });
    vendor = await db.Clients.create({ name: `${TEST_PREFIX}MAERSK`, climaxId: BASE + 21 });

    // The party is reached through its ACCOUNT, not a legacy party id.
    await db.Client_Associations.create({ ClientId: client.id, ChildAccountId: AC.client });
    await db.Client_Associations.create({ ClientId: vendor.id, ChildAccountId: AC.vendor });
  });

  afterEach(async () => {
    await db.Invoice_Transactions.destroy({ where: { climaxId: { [Op.gte]: BASE } } });
    await db.Voucher_Heads.destroy({ where: { climaxId: { [Op.gte]: BASE } } });
    await db.Vouchers.destroy({ where: { climaxId: { [Op.gte]: BASE } } });
    await db.Invoice.destroy({
      where: { climaxId: { [Op.gte]: String(BASE) } }, fiscalYearCheck: false,
    });
  });

  afterAll(async () => {
    await db.Client_Associations.destroy({ where: { ChildAccountId: { [Op.gte]: BASE } } });
    await db.Clients.destroy({ where: { id: { [Op.in]: [client.id, vendor.id] } } });
    await db.Child_Account.destroy({ where: { id: { [Op.gte]: BASE } } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/ledgerMigration/vouchers/plan')
      .set('Authorization', user.authHeader).send({ rows: [], details: [] });
    expect(res.status).toBe(403);
  });

  it('creates the voucher with its heads, in one transaction', async () => {
    const res = await applyVouchers([voucher(1)], lines(1));

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);
    expect(res.body.result.heads).toBe(2);

    const row = await db.Vouchers.findOne({ where: { climaxId: BASE + 1 } });
    expect(row).not.toBeNull();
    expect(row.voucher_Id).toBe(`${TEST_PREFIX}BRV-1/26`);
    // Capital C - it is an association FK, not a declared column.
    expect(String(row.CompanyId)).toBe(String(company.id));

    const heads = await db.Voucher_Heads.findAll({
      where: { VoucherId: row.id }, order: [['climaxId', 'ASC']], raw: true,
    });
    expect(heads).toHaveLength(2);
    // Child_Account.id IS the legacy COA id, so no lookup table is involved.
    expect(String(heads[0].ChildAccountId)).toBe(String(AC.client));
    expect(String(heads[1].ChildAccountId)).toBe(String(AC.bank));
  });

  it('stores the legacy id, which is what makes a re-run safe', async () => {
    await applyVouchers([voucher(1)], lines(1));
    const row = await db.Vouchers.findOne({ where: { voucher_Id: `${TEST_PREFIX}BRV-1/26` } });
    expect(String(row.climaxId)).toBe(String(BASE + 1));
  });

  it('running it twice does not double the ledger', async () => {
    expect((await applyVouchers([voucher(1)], lines(1))).body.result.created).toBe(1);

    const again = await applyVouchers([voucher(1)], lines(1));
    expect(again.body.result.created).toBe(0);

    expect(await db.Vouchers.count({ where: { climaxId: { [Op.gte]: BASE } } })).toBe(1);
    expect(await db.Voucher_Heads.count({ where: { climaxId: { [Op.gte]: BASE } } })).toBe(2);
  });

  it('takes whichever side carries the value, and says which side it was', async () => {
    await applyVouchers([voucher(1)], lines(1));

    const row = await db.Vouchers.findOne({ where: { climaxId: BASE + 1 } });
    const heads = await db.Voucher_Heads.findAll({
      where: { VoucherId: row.id }, order: [['climaxId', 'ASC']], raw: true,
    });
    expect(Number(heads[0].amount)).toBe(1170);
    expect(heads[0].type).toBe('debit');
    expect(Number(heads[1].amount)).toBe(1170);
    expect(heads[1].type).toBe('credit');
  });

  it('lands a negative debit as a credit, and the voucher still balances', async () => {
    // Climax signs some lines in one column: DebitLC -1170 is a credit.
    const detail = lines(1);
    detail[1] = { ...detail[1], DebitVC: -1170, CreditVC: 0, DebitLC: -1170, CreditLC: 0 };
    await applyVouchers([voucher(1)], detail);

    const row = await db.Vouchers.findOne({ where: { climaxId: BASE + 1 } });
    const heads = await db.Voucher_Heads.findAll({
      where: { VoucherId: row.id }, order: [['climaxId', 'ASC']], raw: true,
    });
    expect(heads.map((h) => [h.type, Number(h.defaultAmount)])).toEqual([['debit', 1170], ['credit', 1170]]);
  });

  it('numbers a voucher Climax never numbered into its gap, then imports it', async () => {
    // 10 and 12 are in; 11 sits between them by date and has no number.
    await applyVouchers(
      [voucher(10, { VoucherDate: '2026-08-02T00:00:00.000Z' }), voucher(12, { VoucherDate: '2026-08-04T00:00:00.000Z' })],
      [...lines(10), ...lines(12)],
    );

    const res = await request(app).post('/ledgerMigration/vouchers/numberUnnumbered')
      .set('Authorization', admin.authHeader)
      .send({
        rows: [voucher(11, { VoucherNo: '', VoucherDate: '2026-08-03T00:00:00.000Z' })],
        details: lines(11), currencies, voucherTypes,
      });

    expect(res.status).toBe(200);
    expect(res.body.result.unresolved).toEqual([]);
    expect(res.body.result.assigned).toEqual([{ legacyId: BASE + 11, VoucherNo: `${TEST_PREFIX}BRV-11/26` }]);
    expect(res.body.result.created).toBe(1);

    const row = await db.Vouchers.findOne({ where: { climaxId: BASE + 11 } });
    expect(row.voucher_Id).toBe(`${TEST_PREFIX}BRV-11/26`);
    expect(row.voucher_No).toBe(11);
    expect(await db.Voucher_Heads.count({ where: { VoucherId: row.id } })).toBe(2);

    // Sent again, it is already in and nothing is written twice.
    const again = await request(app).post('/ledgerMigration/vouchers/numberUnnumbered')
      .set('Authorization', admin.authHeader)
      .send({ rows: [voucher(11, { VoucherNo: '' })], details: lines(11), currencies, voucherTypes });
    expect(again.body.result.alreadyImported).toBe(1);
    expect(await db.Vouchers.count({ where: { climaxId: BASE + 11 } })).toBe(1);
  });

  it('reports a voucher with no lines rather than importing an empty one', async () => {
    // A voucher with no heads is not a voucher - it is a number with nothing
    // behind it, and it unbalances every trial balance that includes it.
    const res = await applyVouchers([voucher(1), voucher(2)], lines(1));

    expect(res.body.result.created).toBe(1);
    expect(res.body.result.problems.withoutLines).toContain(BASE + 2);
  });

  it('refuses an oversized batch', async () => {
    const huge = Array.from({ length: 5001 }, (_, i) => voucher(i + 200));
    const res = await applyVouchers(huge, []);
    expect(res.status).toBe(413);
  });

  it('plan writes nothing', async () => {
    const res = await request(app).post('/ledgerMigration/vouchers/plan')
      .set('Authorization', admin.authHeader)
      .send({ rows: [voucher(1)], details: lines(1), currencies, voucherTypes });

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(await db.Vouchers.count({ where: { climaxId: { [Op.gte]: BASE } } })).toBe(0);
  });

  /**
   * SETTLEMENT AGAINST A CLEARANCE INVOICE.
   *
   * The only part of this stage customs touches, and the reason it was moved
   * to run after the customs invoices stage rather than before it. A clearance
   * invoice carries NO job - Invoice has SEJobId and no customs equivalent -
   * so anything that reaches an invoice through its job cannot find one.
   *
   * Settlement does not: it matches on partyType + legacy id, which a customs
   * invoice carries like any other. These cases pin that.
   */
  describe('settling a clearance invoice', () => {
    const customsInvoice = async (n) => db.Invoice.create({
      climaxId: String(BASE + n),
      // What the customs invoices stage produces: a real job invoice, with a
      // null job, marked LG.
      type: 'Job Invoice', payType: 'Recievable', operation: 'LG',
      partyType: 'client', party_Id: String(client.id),
      SEJobId: null,
      // invoice_Id is the INTEGER sequence; invoice_No is the printed
      // number. They are the opposite way round from Vouchers.
      invoice_Id: n, invoice_No: `${TEST_PREFIX}CL-INV-${n}`,
      currency: 'PKR', total: '1170', paid: '0', recieved: '0',
      companyId: String(company.id),
    }, { fiscalYearCheck: false });

    const adj = (n, over = {}) => ({
      Id: BASE + 300 + n, InvoiceId: 8836, GVDetailId: BASE + 100 + n * 2,
      Amount: 500, InvAdjDate: '2026-08-05T00:00:00.000Z',
      AddOn: '2026-08-05T09:00:00.000Z', ...over,
    });

    const refs = (n) => ([{ glInvoiceId: '8836', table: 'JobInvoice', legacyId: String(BASE + n) }]);

    it('finds an invoice that has no job at all', async () => {
      await applyVouchers([voucher(1)], lines(1));
      await customsInvoice(1);

      const res = await applySettlements([adj(1)], refs(1));

      expect(res.status).toBe(200);
      expect(res.body.result.created).toBe(1);
      expect(res.body.result.stats.withoutInvoice).toBe(0);
    });

    it('moves only the received side of a receivable', async () => {
      // The old importer incremented paid AND recieved by the same amount, so
      // every settled invoice read as both.
      await applyVouchers([voucher(1)], lines(1));
      const invoice = await customsInvoice(1);

      await applySettlements([adj(1)], refs(1));

      const after = await db.Invoice.findByPk(invoice.id);
      expect(Number(after.recieved)).toBe(500);
      expect(Number(after.paid)).toBe(0);
    });

    it('attaches the settlement to the voucher that carried it', async () => {
      await applyVouchers([voucher(1)], lines(1));
      await customsInvoice(1);
      await applySettlements([adj(1)], refs(1));

      const tx = await db.Invoice_Transactions.findOne({
        where: { climaxId: BASE + 301 },
      });
      const v = await db.Vouchers.findOne({ where: { climaxId: BASE + 1 } });
      expect(tx).not.toBeNull();
      expect(String(tx.VoucherId)).toBe(String(v.id));
    });

    it('records the settled invoice ON the voucher, which is what the payments screen reads', async () => {
      /* Payments & Receipts reads `Vouchers.invoices` - a comma-separated list
       * of invoice ids - to show what each row paid off. The migration filled
       * the junction table and left this column empty, so a migrated payment
       * reached that screen with no document against it: the money was right,
       * the row could not say what it was for. */
      await applyVouchers([voucher(1)], lines(1));
      const invoice = await customsInvoice(1);
      await applySettlements([adj(1)], refs(1));

      const v = await db.Vouchers.findOne({ where: { climaxId: BASE + 1 } });
      expect(v.invoices).toBe(String(invoice.id));
    });

    it('does not double the list when settlements are applied twice', async () => {
      // Recomputed from Invoice_Transactions rather than appended per batch -
      // settlements are paged, and one voucher's can straddle two pages.
      await applyVouchers([voucher(1)], lines(1));
      const invoice = await customsInvoice(1);
      await applySettlements([adj(1)], refs(1));
      await applySettlements([adj(1)], refs(1));

      const v = await db.Vouchers.findOne({ where: { climaxId: BASE + 1 } });
      expect(v.invoices).toBe(String(invoice.id));
    });

    it('is safe to run twice', async () => {
      await applyVouchers([voucher(1)], lines(1));
      const invoice = await customsInvoice(1);

      expect((await applySettlements([adj(1)], refs(1))).body.result.created).toBe(1);
      const again = await applySettlements([adj(1)], refs(1));
      expect(again.body.result.created).toBe(0);

      // And the invoice is not settled a second time.
      const after = await db.Invoice.findByPk(invoice.id);
      expect(Number(after.recieved)).toBe(500);
    });

    it('reports a settlement whose invoice is missing rather than guessing', async () => {
      await applyVouchers([voucher(1)], lines(1));
      // No invoice created at all.
      const res = await applySettlements([adj(1)], refs(1));

      expect(res.body.result.created).toBe(0);
      expect(res.body.result.stats.withoutInvoice).toBe(1);
    });
  });

  it('verify reports what actually landed', async () => {
    await applyVouchers([voucher(1)], lines(1));

    const res = await request(app).get('/ledgerMigration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result).toHaveProperty('vouchers');
    expect(res.body.result).toHaveProperty('voucherHeads');
  });
});

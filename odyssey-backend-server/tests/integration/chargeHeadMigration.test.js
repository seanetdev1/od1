const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('Job charge line migration', () => {
  let admin, user, seJob, aeJob, charge, client, vendor;
  const BASE = 989000;

  const recv = (n, over = {}) => ({
    Id: BASE + n, SEJobId: BASE + 1,
    ChargesId: BASE + 5, CustomerId: BASE + 20, CurrencyId: 2,
    EquipCode: '40HC', PPCCId: 1, dDGNonDGId: 2,
    Quantity: 2, Rate: 150, Amount: 300, DiscountAmount: 0,
    IsTaxApply: true, TaxAmount: 51, NetAmount: 351,
    ExchRateClient: 280, LocalAmount: 98280,
    Description: `${TEST_PREFIX}Ocean freight`,
    ApprovedBy: 'ADMIN', ApprovedOn: '2024-03-01',
    ...over,
  });

  const currencies = [{ Id: 2, CurrencyCode: 'USD' }];

  const send = (path, body) => request(app).post(`/chargeHeadMigration/${path}`)
    .set('Authorization', admin.authHeader).send({ currencies, ...body });
  const apply = (body) => send('apply', body);
  const plan = (body) => send('plan', body);

  beforeAll(async () => {
    admin = await loginAs('admin');
    user = await loginAs('employee');
    seJob = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}SEJOB`, operation: 'SE', climaxId: BASE + 1 },
      { fiscalYearCheck: false },
    );
    aeJob = await db.SE_Job.create(
      { jobNo: `${TEST_PREFIX}AEJOB`, operation: 'AE', climaxId: BASE + 2 },
      { fiscalYearCheck: false },
    );
    charge = await db.Charges.create({
      code: BASE + 5, climaxId: BASE + 5, name: `${TEST_PREFIX}OCEAN FREIGHT`,
      short: 'OFT', currency: 'USD', calculationType: 'Per Unit',
      defaultPaybleParty: 'Client', defaultRecivableParty: 'Client',
      taxApply: 'No', taxPerc: '0',
    });
    client = await db.Clients.create({ name: `${TEST_PREFIX}ACME`, climaxId: BASE + 20 });
    vendor = await db.Clients.create({ name: `${TEST_PREFIX}MAERSK`, climaxId: BASE + 30 });
  });

  afterAll(async () => {
    await db.Charges.destroy({ where: { id: charge.id } });
    await db.Clients.destroy({ where: { id: [client.id, vendor.id] } });
    await db.SE_Job.destroy({ where: { id: [seJob.id, aeJob.id] } });
  });

  afterEach(async () => {
    await db.Charge_Head.destroy({ where: { climaxId: { [db.Sequelize.Op.gte]: BASE } } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/chargeHeadMigration/plan')
      .set('Authorization', user.authHeader).send({ kind: 'SeaExportRecv', rows: [] });
    expect(res.status).toBe(403);
  });

  it('imports a sea line with its price in Amount, and the money into net and local', async () => {
    // (amount x rate - discount) x qty. A sea line's grid edits Amount and
    // keeps rate_charge a hidden 1, so the per-unit price (150) goes in
    // amount - never Climax's Amount, which is the line total.
    const res = await apply({ kind: 'SeaExportRecv', rows: [recv(10)] });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);

    const row = await db.Charge_Head.findOne({ where: { climaxId: BASE + 10 } });
    expect(String(row.amount)).toBe('150');
    expect(String(row.rate_charge)).toBe('1');
    expect(String(row.net_amount)).toBe('351');
    expect(String(row.tax_amount)).toBe('51');
  });

  it('attaches the line to its job, its charge and its party', async () => {
    await apply({ kind: 'SeaExportRecv', rows: [recv(10)] });

    const row = await db.Charge_Head.findOne({ where: { climaxId: BASE + 10 } });
    expect(String(row.SEJobId)).toBe(String(seJob.id));
    expect(String(row.charge)).toBe(String(charge.id));
    expect(row.particular).toBe(`${TEST_PREFIX}OCEAN FREIGHT`);
    expect(String(row.partyId)).toBe(String(client.id));
    expect(row.name).toBe(`${TEST_PREFIX}ACME`);
    expect(row.currency).toBe('USD');
    expect(row.basis).toBe('Per Unit');
  });

  it('records approval from the source, under the name the model declares', async () => {
    await apply({ kind: 'SeaExportRecv', rows: [recv(10)] });

    const row = await db.Charge_Head.findOne({ where: { climaxId: BASE + 10 } });
    expect(row.approved_by).toBe('ADMIN');
    expect(row.approval_date).toBe('2024-03-01');
  });

  it('takes the tax flag from IsTaxApply, not from the tax amount', async () => {
    await apply({ kind: 'SeaExportRecv', rows: [recv(10, { IsTaxApply: true, TaxAmount: 0 })] });

    const row = await db.Charge_Head.findOne({ where: { climaxId: BASE + 10 } });
    expect(String(row.tax_apply)).toMatch(/true|1/);
  });

  it('does not fail the batch when a party is missing', async () => {
    // party.id read unguarded is what took whole job transactions down.
    const res = await apply({
      kind: 'SeaExportRecv',
      rows: [recv(10, { CustomerId: 777777 }), recv(11), recv(12)],
    });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(3);
    expect(res.body.result.stats.unresolvedParty).toBe(1);

    const orphan = await db.Charge_Head.findOne({ where: { climaxId: BASE + 10 } });
    expect(orphan.partyId).toBeNull();
    expect(String(orphan.net_amount)).toBe('351');   // money still lands
  });

  it('skips a line whose job is not in Odyssey', async () => {
    const res = await apply({
      kind: 'SeaExportRecv', rows: [recv(10), recv(11, { SEJobId: 666666 })],
    });

    expect(res.body.result.created).toBe(1);
    expect(res.body.result.problems.orphaned).toContain(666666);
  });

  it('imports the payable side from VendorId', async () => {
    const res = await apply({
      kind: 'SeaExportPayb',
      rows: [{
        Id: BASE + 30, SEJobId: BASE + 1, ChargesId: BASE + 5, VendorId: BASE + 30,
        CurrencyId: 2, Quantity: 1, Rate: 100, Amount: 100, NetAmount: 100,
        ExchRateLine: 279,
      }],
    });

    expect(res.body.result.created).toBe(1);
    const row = await db.Charge_Head.findOne({ where: { climaxId: BASE + 30 } });
    // The spelling the Payable tab filters on - see the planner header.
    expect(row.type).toBe('Payble');
    expect(String(row.partyId)).toBe(String(vendor.id));
    expect(String(row.ex_rate)).toBe('279');
  });

  it('sets invoiceType from the junction tables, with no invoice present', async () => {
    // This is what the job P&L splits revenue from cost on, and it must work
    // before the ledger stage has created a single invoice.
    await apply({
      kind: 'SeaExportPayb',
      rows: [{
        Id: BASE + 40, SEJobId: BASE + 1, ChargesId: BASE + 5, VendorId: BASE + 30,
        CurrencyId: 2, Quantity: 1, Rate: 100, Amount: 100, NetAmount: 100,
        LocalAmount: 28000, ExchRateLine: 280, PPCCId: 1,
      }],
      jobBillIds: [BASE + 40],
    });

    const row = await db.Charge_Head.findOne({ where: { climaxId: BASE + 40 } });
    expect(row.invoiceType).toBe('Job Bill');
    expect(row.partyType).toBe('vendor');
    expect(row.type).toBe('Payble');
    // The exact pair the cost calculation tests for, with no Invoice row.
    expect(row.InvoiceId).toBeNull();
    expect(String(row.local_amount)).toBe('28000');
  });

  it('leaves the invoice ROW link for the ledger stage', async () => {
    await apply({ kind: 'SeaExportRecv', rows: [recv(10)], jobInvoiceIds: [BASE + 10] });

    const row = await db.Charge_Head.findOne({ where: { climaxId: BASE + 10 } });
    expect(row.invoiceType).toBe('Job Invoice');
    expect(row.InvoiceId).toBeNull();
    expect(row.invoice_id).toBeNull();
  });

  it('does not treat the same legacy id under another operation as imported', async () => {
    // A legacy charge-line id is only unique within its own source table, and
    // every payable table stores the same type string. Scoping the
    // already-imported check on type alone made sea-export ids block the
    // air-export lines that share them - ~38,000 lines silently dropped.
    const seLine = {
      Id: BASE + 50, SEJobId: BASE + 1, ChargesId: BASE + 5, VendorId: BASE + 30,
      CurrencyId: 2, Quantity: 1, Rate: 100, Amount: 100, NetAmount: 100,
    };
    const aeLine = { ...seLine, AEJobId: BASE + 2 };
    delete aeLine.SEJobId;

    await apply({ kind: 'SeaExportPayb', rows: [seLine] });
    const res = await apply({ kind: 'AirExportPayb', rows: [aeLine] });

    expect(res.body.result.created).toBe(1);
    expect(res.body.result.stats.alreadyImported).toBe(0);
    // Both exist: same legacy id, different operations.
    expect(await db.Charge_Head.count({ where: { climaxId: BASE + 50 } })).toBe(2);
  });

  it('is safe to run twice', async () => {
    await apply({ kind: 'SeaExportRecv', rows: [recv(10), recv(11)] });
    const second = await apply({ kind: 'SeaExportRecv', rows: [recv(10), recv(11)] });

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.stats.alreadyImported).toBe(2);
    expect(await db.Charge_Head.count({ where: { climaxId: [BASE + 10, BASE + 11] } })).toBe(2);
  });

  it('plan writes nothing', async () => {
    const res = await plan({ kind: 'SeaExportRecv', rows: [recv(10)] });

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(await db.Charge_Head.count({ where: { climaxId: BASE + 10 } })).toBe(0);
  });

  it('rejects an unknown kind', async () => {
    expect((await apply({ kind: 'Nonsense', rows: [] })).status).toBe(400);
  });

  it('refuses an oversized batch', async () => {
    const huge = Array.from({ length: 5001 }, (_, i) => recv(i + 100));
    expect((await apply({ kind: 'SeaExportRecv', rows: huge })).status).toBe(413);
  });

  it('verify reports money that cannot be attributed', async () => {
    await apply({ kind: 'SeaExportRecv', rows: [recv(10)] });

    const res = await request(app).get('/chargeHeadMigration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result.chargeLines).toBeGreaterThan(0);
    expect(res.body.result).toHaveProperty('detached');
    expect(res.body.result).toHaveProperty('withoutInvoice');
    expect(res.body.result).toHaveProperty('amountIsOne');
    expect(res.body.result).toHaveProperty('netAmountTotal');
    expect(res.body.result.byType).toHaveProperty('Recievable');
  });

  /**
   * CLEARING-JOB CHARGE LINES - the customs half of this receiver.
   *
   * Structurally the same eight-column payload as the freight kinds, but the
   * parent is different, and that difference is the whole risk: these land on
   * Charge_Heads.CustomsJobId and their SEJobId is null. Two things read that
   * wrong and both were bugs - /chargeHeadMigration/verify counted every
   * customs line as detached, and /migration/linkage still did until it was
   * fixed alongside these tests.
   *
   * On CargoLinkers this stage is 143,368 lines across 95% of the book, and it
   * carries the duty: Log_DutyCalculation is empty there, so CUSTOMS DUTY,
   * WHARFAGE and the rest arrive here as ordinary charge lines. It is the
   * single largest thing the customs migration moves.
   */
  describe('clearing-job charge lines', () => {
    let customsJob;

    const lg = (n, over = {}) => ({
      Id: BASE + n, LogJobId: BASE + 3,
      ChargesId: BASE + 5, CustomerId: BASE + 20, CurrencyId: 2,
      PerUnitFixedId: 1, Quantity: 1, Rate: 500, Amount: 500, DiscountAmount: 0,
      IsTaxApply: false, TaxAmount: 0, NetAmount: 500,
      ExchRateClient: 1, LocalAmount: 500,
      Description: `${TEST_PREFIX}CUSTOMS DUTY`,
      ApprovedBy: 'ADMIN', ApprovedOn: '2024-09-04',
      ...over,
    });

    beforeAll(async () => {
      customsJob = await db.Customs_Job.create({
        jobNo: `${TEST_PREFIX}TP-1/26`, climaxId: BASE + 3,
        direction: 'Export', transportMode: 'Sea',
      });
    });

    afterAll(async () => {
      await db.Customs_Job.destroy({ where: { id: customsJob.id } });
    });

    it('attaches the line to the DECLARATION, not to a freight job', async () => {
      const res = await apply({ kind: 'CustomsRecv', rows: [lg(40)] });
      expect(res.status).toBe(200);
      expect(res.body.result.created).toBe(1);

      const line = await db.Charge_Head.findOne({ where: { climaxId: BASE + 40 } });
      expect(String(line.CustomsJobId)).toBe(String(customsJob.id));
      // Null is correct here, not an orphan - a clearing job has no SE_Job.
      expect(line.SEJobId).toBeNull();
      expect(line.type).toBe('Recievable');
      expect(Number(line.net_amount)).toBe(500);
      expect(String(line.charge)).toBe(String(charge.id));
      expect(String(line.partyId)).toBe(String(client.id));
    });

    it('imports the payable side from VendorId and its own exchange rate', async () => {
      await apply({
        kind: 'CustomsPayb',
        rows: [lg(41, {
          CustomerId: undefined, VendorId: BASE + 30,
          ExchRateClient: undefined, ExchRateLine: 280, LocalAmount: 140000,
        })],
      });

      const line = await db.Charge_Head.findOne({ where: { climaxId: BASE + 41 } });
      expect(line.type).toBe('Payble');
      expect(String(line.partyId)).toBe(String(vendor.id));
      expect(String(line.CustomsJobId)).toBe(String(customsJob.id));
      expect(Number(line.ex_rate)).toBe(280);
    });

    it('skips a line whose declaration is not in Odyssey', async () => {
      // Money with no declaration behind it. Counted, not invented.
      const res = await apply({ kind: 'CustomsRecv', rows: [lg(42), lg(43, { LogJobId: 777777 })] });
      expect(res.body.result.created).toBe(1);
      expect(res.body.result.stats.orphaned).toBe(1);
    });

    it('records which invoice document the line sits on', async () => {
      // The field the job P&L splits revenue from cost on. Knowable before any
      // invoice is imported, because the legacy junction table names the line.
      await apply({ kind: 'CustomsRecv', rows: [lg(44)], jobInvoiceIds: [BASE + 44] });
      const line = await db.Charge_Head.findOne({ where: { climaxId: BASE + 44 } });
      expect(line.invoiceType).toBe('Job Invoice');
      // The invoice ROW link is the invoices stage's job, not this one's.
      expect(line.InvoiceId).toBeNull();
    });

    it('is safe to run twice', async () => {
      expect((await apply({ kind: 'CustomsRecv', rows: [lg(45)] })).body.result.created).toBe(1);
      const again = await apply({ kind: 'CustomsRecv', rows: [lg(45)] });
      expect(again.body.result.created).toBe(0);
      expect(await db.Charge_Head.count({ where: { climaxId: BASE + 45 } })).toBe(1);
    });

    it('verify does not call a clearing line detached', async () => {
      // It did: checking SEJobId alone reported all 143,368 customs lines as
      // money with no shipment behind it.
      await apply({ kind: 'CustomsRecv', rows: [lg(46)] });

      const res = await request(app).get('/chargeHeadMigration/verify')
        .set('Authorization', admin.authHeader);

      expect(res.status).toBe(200);
      expect(res.body.result.detached).toBe(0);
    });

    it('linkage does not count a clearing line as having no job', async () => {
      // /migration/linkage feeds the stage warning on the migration screen, and
      // it counted nulls in SEJobId only - so the clearing charge-lines stage
      // reported every row it had just imported as unlinked.
      await apply({ kind: 'CustomsRecv', rows: [lg(47)] });

      const res = await request(app).get('/migration/linkage')
        .set('Authorization', admin.authHeader);

      expect(res.status).toBe(200);
      const line = await db.Charge_Head.findOne({ where: { climaxId: BASE + 47 } });
      expect(line.SEJobId).toBeNull();
      expect(res.body.result.chargeHeadsWithoutJob).toBe(0);
    });
  });

});

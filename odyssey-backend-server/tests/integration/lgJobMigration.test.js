/**
 * Clearing-job migration receiver - legacy Log_Job -> Customs_Job.
 *
 * THE FIRST INTEGRATION TEST THIS MODULE HAS EVER HAD, and it exists because
 * the mapping was thoroughly unit-tested while the seam where that mapping
 * meets a database was not tested at all. That is exactly where it broke:
 * Customs_Job never declared `climaxId`, so `/plan` and `/apply` both failed
 * on their first batch with a Postgres 42703 - and every pure-function test
 * still passed, because none of them touch Postgres.
 *
 * So the cases below are deliberately weighted towards what only a real
 * database can show: that the row lands, that its foreign keys resolve, that
 * the legacy id is STORED (not merely accepted), that the children arrive with
 * their parent, and that running it twice does not double the book.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('Clearing job migration (Log_Job -> Customs_Job)', () => {
  let admin, user, company, client, shipper;
  const BASE = 970000;
  const Op = db.Sequelize.Op;

  const job = (n, over = {}) => ({
    Id: BASE + n,
    JobNumber: `${TEST_PREFIX}TP-${n}/26`,
    JobDate: '2026-08-01T00:00:00.000Z',
    MachineNo: `GD-${n}`,
    SubCompanyId: company?.climaxId,
    CustomerId: client?.climaxId,
    ShipperId: shipper?.climaxId,
    ImportExportId: 2,
    ModeId: 1,
    CurrencyId: 1,
    CommInvValue: 50000,
    CostCenterId: 22,
    ContianerTypeId: 3,
    DeliveryDetailId: 5,
    ...over,
  });

  // The lookups the client resolves once and sends with every batch, in the
  // { legacyId: value } shape readBatch turns into Maps.
  const LOOKUPS = {
    packing: { CTN: 'CARTONS' },
    currency: { 1: 'USD', 2: 'PKR' },
    terminals: { 9: 'QICT' },
    cargoTypes: { 4: 'FCL' },
    incoTerms: { 7: 'FOB' },
    cancelReasons: { 6: 'Duplicate job' },
    // ONE cost centre, which is the real shape of this customer's data and
    // the branch resolveCostCenter exists for.
    costCenters: { 22: 'HO' },
    containerTypes: { 3: 'General Cargo' },
    // Padded, as the fixed-width legacy column really returns it.
    deliveryTypes: { 5: 'DR / DR        ' },
  };

  const body = (jobs, over = {}) => ({ jobs, duty: [], containers: [], ...LOOKUPS, ...over });

  const apply = (jobs, over) => request(app).post('/lgJobMigration/apply')
    .set('Authorization', admin.authHeader).send(body(jobs, over));

  const plan = (jobs, over) => request(app).post('/lgJobMigration/plan')
    .set('Authorization', admin.authHeader).send(body(jobs, over));

  const verify = () => request(app).get('/lgJobMigration/verify')
    .set('Authorization', admin.authHeader);

  beforeAll(async () => {
    admin = await loginAs('admin');
    user = await loginAs('employee');
    company = await db.Company.create({
      title: `${TEST_PREFIX}CL`, short: 'TCL', climaxId: BASE + 1,
    });
    client = await db.Clients.create({ name: `${TEST_PREFIX}IMPORTER`, climaxId: BASE + 2 });
    shipper = await db.Clients.create({ name: `${TEST_PREFIX}SHIPPER`, climaxId: BASE + 3 });
  });

  afterEach(async () => {
    // Duty and containers cascade with their job.
    await db.Customs_Job.destroy({ where: { climaxId: { [Op.gte]: BASE } } });
  });

  afterAll(async () => {
    await db.Company.destroy({ where: { id: company.id } });
    await db.Clients.destroy({ where: { id: { [Op.in]: [client.id, shipper.id] } } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/lgJobMigration/plan')
      .set('Authorization', user.authHeader).send(body([]));
    expect(res.status).toBe(403);
  });

  it('creates the declaration and resolves its foreign keys', async () => {
    const res = await apply([job(1)]);

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);

    const row = await db.Customs_Job.findOne({ where: { climaxId: BASE + 1 } });
    expect(row).not.toBeNull();
    expect(row.jobNo).toBe(`${TEST_PREFIX}TP-1/26`);
    expect(row.gdNumber).toBe('GD-1');
    expect(row.direction).toBe('Export');
    expect(row.transportMode).toBe('Sea');
    expect(String(row.companyId)).toBe(String(company.id));
    expect(String(row.clientId)).toBe(String(client.id));
    expect(String(row.shipperId)).toBe(String(shipper.id));
  });

  it('STORES the legacy id, which is what makes a re-run safe', async () => {
    // The regression that blocked the whole stage. Sequelize silently drops an
    // attribute the model does not declare, so a climaxId that is accepted in
    // the payload but absent from the model reads as success and stores null -
    // and then every re-run creates a second copy of the entire book.
    await apply([job(1)]);
    const row = await db.Customs_Job.findOne({ where: { jobNo: `${TEST_PREFIX}TP-1/26` } });
    expect(String(row.climaxId)).toBe(String(BASE + 1));
  });

  it('running it twice does not double the book', async () => {
    const first = await apply([job(1), job(2)]);
    expect(first.body.result.created).toBe(2);

    const second = await apply([job(1), job(2)]);
    expect(second.body.result.created).toBe(0);
    expect(second.body.result.stats.alreadyImported).toBe(2);

    const count = await db.Customs_Job.count({ where: { climaxId: { [Op.gte]: BASE } } });
    expect(count).toBe(2);
  });

  it('carries the duty lines with their job, in one transaction', async () => {
    const res = await apply([job(1)], {
      duty: [
        { Id: BASE + 50, LogJobId: BASE + 1, ItemNo: '1', CDPerc: 20, SalesTaxPerc: 18, ASSValue: 1000 },
        { Id: BASE + 51, LogJobId: BASE + 1, ItemNo: '2', CDPerc: 5 },
      ],
    });
    expect(res.body.result.dutyCreated).toBe(2);

    const row = await db.Customs_Job.findOne({ where: { climaxId: BASE + 1 } });
    const duty = await db.Customs_Duty.findAll({
      where: { CustomsJobId: row.id }, order: [['sortOrder', 'ASC']], raw: true,
    });
    expect(duty).toHaveLength(2);
    expect(Number(duty[0].customDutyPerc)).toBe(20);
    expect(Number(duty[0].salesTaxPerc)).toBe(18);
    expect(String(duty[0].climaxId)).toBe(String(BASE + 50));
  });

  it('carries the containers with their job', async () => {
    // These were fetched by the legacy endpoint and then left out of its
    // response, so every batch sent an empty list and 6,164 real rows were
    // silently dropped. Nothing failed - the count was simply zero.
    const res = await apply([job(1)], {
      containers: [
        { Id: BASE + 60, LogJobId: BASE + 1, ContainerNo: 'MSKU1234567', EquipCode: '40HC', GrossWt: 0 },
        { Id: BASE + 61, LogJobId: BASE + 1, ContainerNo: 'TGHU7654321', EquipCode: '20GP', GrossWt: 24000 },
      ],
    });
    expect(res.body.result.containersCreated).toBe(2);

    const row = await db.Customs_Job.findOne({ where: { climaxId: BASE + 1 } });
    const boxes = await db.Customs_Container.findAll({
      where: { CustomsJobId: row.id }, order: [['sortOrder', 'ASC']], raw: true,
    });
    expect(boxes.map((b) => b.containerNo)).toEqual(['MSKU1234567', 'TGHU7654321']);
    expect(boxes[0].sizeType).toBe('40HC');
    // A zero weight is not a measurement anybody took.
    expect(boxes[0].grossWeight).toBeNull();
    expect(Number(boxes[1].grossWeight)).toBe(24000);
  });

  it('a child row naming another job is not attached to this one', async () => {
    const res = await apply([job(1)], {
      containers: [{ Id: BASE + 62, LogJobId: BASE + 999, ContainerNo: 'WRONG1234567', EquipCode: '40HC' }],
    });
    expect(res.body.result.containersCreated).toBe(0);
  });

  it('resolves the lookups to values, not to raw legacy ids', async () => {
    await apply([job(1)]);
    const row = await db.Customs_Job.findOne({ where: { climaxId: BASE + 1 } });

    // Carried across as recorded - legacy files keep saying General Cargo.
    expect(row.containerType).toBe('General Cargo');
    // Trimmed: the legacy column is fixed-width and really returns padding.
    expect(row.deliveryTerms).toBe('DR / DR');
    // 15,363 of 15,364 real jobs carry a currency and 60% are not PKR, so a
    // value migrated without its unit is a figure nobody can read.
    expect(row.invoiceCurrency).toBe('USD');
    expect(Number(row.invoiceValue)).toBe(50000);
    // ONE legacy cost centre means that cost centre IS this installation, so
    // the install's own code wins over the legacy label.
    expect(row.costCenter).toBeTruthy();
    expect(row.costCenter).not.toBe('HO');
  });

  it('carries the job date the form asks for', async () => {
    await apply([job(1)]);
    const row = await db.Customs_Job.findOne({ where: { climaxId: BASE + 1 } });
    expect(row.jobDate).toBe('2026-08-01');
  });

  it('plan writes nothing', async () => {
    const res = await plan([job(1), job(2)]);

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(0);
    expect(res.body.result.stats.toCreate).toBe(2);
    expect(await db.Customs_Job.count({ where: { climaxId: { [Op.gte]: BASE } } })).toBe(0);
  });

  it('reports a job with no job number rather than importing it blank', async () => {
    // jobNo is how every screen finds a declaration; a blank one is unusable.
    const res = await apply([job(1), job(2, { JobNumber: '   ' })]);

    expect(res.body.result.created).toBe(1);
    expect(res.body.result.stats.missingJobNo).toBe(1);
    expect(res.body.result.problems.missingJobNo).toContain(BASE + 2);
  });

  it('reports a legacy code it did not recognise instead of defaulting silently', async () => {
    // Real ids on this customer's data: ModeId 4 on 138 jobs, and a duty payer
    // id 3 on 5,135. Both take a default, and the operator has to be told.
    const res = await apply([job(1, { ModeId: 4, SecurityPaidById: 3 })]);
    expect(res.body.result.unknownCodes.mode).toContain(4);
    expect(res.body.result.unknownCodes.dutyPaidBy).toContain(3);
  });

  it('refuses a batch larger than the receiver accepts', async () => {
    const res = await apply(Array.from({ length: 501 }, (_, i) => job(i + 1)));
    expect(res.status).toBe(400);
    expect(String(res.body.result)).toMatch(/Batch too large/i);
  });

  it('verify counts what actually landed', async () => {
    await apply([job(1), job(2)], {
      duty: [{ Id: BASE + 50, LogJobId: BASE + 1, ItemNo: '1' }],
    });

    const res = await verify();
    expect(res.status).toBe(200);

    const r = res.body.result;
    expect(r.migrated).toBeGreaterThanOrEqual(2);
    expect(r.dutyLines).toBeGreaterThanOrEqual(1);
    // Both test jobs carry a GD number and a company.
    expect(r.duplicateClimaxIdCount).toBe(0);
  });

  it('rejects a body that is not a batch', async () => {
    const res = await request(app).post('/lgJobMigration/apply')
      .set('Authorization', admin.authHeader).send({ nope: true });
    expect(res.status).toBe(400);
  });
});

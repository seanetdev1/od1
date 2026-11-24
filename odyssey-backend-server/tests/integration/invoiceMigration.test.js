const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('Invoice migration', () => {
  let admin, user, seJob, aeJob, client, company;
  let seRecvHead, aeRecvHead, sePaybHead;
  const BASE = 979000;

  const inv = (n, over = {}) => ({
    Id: BASE + n,
    TranNumber: `${TEST_PREFIX}ACS-JI-${n}/24`,
    TranDate: '2024-03-05T00:00:00.000Z',
    InvoiceDate: '2024-03-01T00:00:00.000Z',
    SEJobId: BASE + 1,
    PartyId: BASE + 20,
    SubCompanyId: BASE + 60,
    InvoiceStatusId: 1,
    InvoiceCurrencyId: 2,
    ExchangeRate: 280,
    TotalAmount: 1000,
    NetAmount: 1000,
    TaxAmount: 170,
    NetInclTaxAmount: 1170,
    InvoiceRemarks: 'Freight',
    ...over,
  });

  const currencies = [{ Id: 2, CurrencyCode: 'USD' }, { Id: 1, CurrencyCode: 'PKR' }];

  const send = (path, body) => request(app).post(`/invoiceMigration/${path}`)
    .set('Authorization', admin.authHeader)
    .send({ currencies, parentKey: 'JobInvoiceId', ...body });
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
    client = await db.Clients.create({ name: `${TEST_PREFIX}ACME`, climaxId: BASE + 20 });
    company = await db.Company.create({
      title: `${TEST_PREFIX}Seanet`, short: 'TSN', climaxId: BASE + 60,
    });

    // Three charge lines that share one legacy id across two operations and
    // both sides - the collision this stage has to resolve correctly.
    seRecvHead = await db.Charge_Head.create({
      charge: '1', type: 'Recievable', invoiceType: 'Job Invoice',
      climaxId: BASE + 10, SEJobId: seJob.id, net_amount: '1170',
    });
    aeRecvHead = await db.Charge_Head.create({
      charge: '1', type: 'Recievable', invoiceType: 'Job Invoice',
      climaxId: BASE + 10, SEJobId: aeJob.id, net_amount: '500',
    });
    sePaybHead = await db.Charge_Head.create({
      charge: '1', type: 'Payble', invoiceType: 'Job Bill',
      climaxId: BASE + 10, SEJobId: seJob.id, net_amount: '900',
    });
  });

  afterAll(async () => {
    await db.Charge_Head.destroy({ where: { climaxId: { [db.Sequelize.Op.gte]: BASE } } });
    await db.Clients.destroy({ where: { id: client.id } });
    await db.Company.destroy({ where: { id: company.id } });
    await db.SE_Job.destroy({ where: { id: [seJob.id, aeJob.id] } });
  });

  afterEach(async () => {
    await db.Invoice.destroy({
      where: { climaxId: { [db.Sequelize.Op.gte]: String(BASE) } },
      fiscalYearCheck: false,
    });
    await db.Charge_Head.update(
      { InvoiceId: null, invoice_id: null },
      { where: { climaxId: { [db.Sequelize.Op.gte]: BASE } } },
    );
  });

  it('is admin only', async () => {
    const res = await request(app).post('/invoiceMigration/plan')
      .set('Authorization', user.authHeader).send({ kind: 'JobInvoice', rows: [] });
    expect(res.status).toBe(403);
  });

  it('imports an invoice with its job, party, company, currency and date', async () => {
    const res = await apply({ kind: 'JobInvoice', rows: [inv(10)] });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(1);

    const row = await db.Invoice.findOne({ where: { climaxId: String(BASE + 10) } });
    expect(row.invoice_No).toBe(`${TEST_PREFIX}ACS-JI-${10}/24`);
    // invoice_Id is INTEGER: /makeInvoiceNew orders by it to find the last
    // number issued, and that ordering has to be numeric, not lexical.
    expect(row.invoice_Id).toBe(10);
    expect(row.type).toBe('Job Invoice');
    expect(row.payType).toBe('Recievable');
    expect(row.partyType).toBe('client');
    expect(String(row.SEJobId)).toBe(String(seJob.id));
    expect(row.party_Id).toBe(String(client.id));
    expect(row.party_Name).toBe(`${TEST_PREFIX}ACME`);
    expect(row.companyId).toBe(String(company.id));
    expect(row.currency).toBe('USD');
    expect(row.ex_rate).toBe('280');
    expect(row.operation).toBe('SE');
    // What the party owes, tax included.
    expect(row.total).toBe('1170');
    // The invoice's own date, not today - ageing buckets on this.
    expect(new Date(row.createdAt).toISOString().slice(0, 10)).toBe('2024-03-01');
  });

  it('invents no settlement', async () => {
    await apply({ kind: 'JobInvoice', rows: [inv(10)] });

    const row = await db.Invoice.findOne({ where: { climaxId: String(BASE + 10) } });
    expect(row.paid).toBe('0');
    expect(row.recieved).toBe('0');
    expect(row.status).toBe('1');
    expect(await db.Invoice_Transactions.count({ where: { InvoiceId: row.id } })).toBe(0);
  });

  it('points the charge line at the invoice, by id and by number', async () => {
    const res = await apply({
      kind: 'JobInvoice',
      rows: [inv(10)],
      links: [{ JobInvoiceId: BASE + 10, SEJobChargesRecvId: BASE + 10 }],
    });

    expect(res.body.result.linked).toBe(1);

    const invoice = await db.Invoice.findOne({ where: { climaxId: String(BASE + 10) } });
    const head = await db.Charge_Head.findByPk(seRecvHead.id);

    expect(String(head.InvoiceId)).toBe(String(invoice.id));
    // The job list counts invoices and bills with invoice_id LIKE '%I%'/'%B%'.
    expect(head.invoice_id).toBe(invoice.invoice_No);
  });

  it('does not attach the same legacy id from another operation or side', async () => {
    // Legacy charge-line ids are only unique within their own source table.
    // Line 10 exists as a sea-export receivable, an air-export receivable and
    // a sea-export payable, and only the first belongs to this invoice.
    await apply({
      kind: 'JobInvoice',
      rows: [inv(10)],
      links: [{ JobInvoiceId: BASE + 10, SEJobChargesRecvId: BASE + 10 }],
    });

    expect((await db.Charge_Head.findByPk(seRecvHead.id)).InvoiceId).not.toBeNull();
    expect((await db.Charge_Head.findByPk(aeRecvHead.id)).InvoiceId).toBeNull();
    expect((await db.Charge_Head.findByPk(sePaybHead.id)).InvoiceId).toBeNull();
  });

  it('leaves a charge line attached to the first invoice that claimed it', async () => {
    // Two lines in the real data sit on two invoices, and InvoiceId holds one.
    await apply({
      kind: 'JobInvoice',
      rows: [inv(10)],
      links: [{ JobInvoiceId: BASE + 10, SEJobChargesRecvId: BASE + 10 }],
    });
    const first = await db.Invoice.findOne({ where: { climaxId: String(BASE + 10) } });

    const second = await apply({
      kind: 'JobInvoice',
      rows: [inv(11)],
      links: [{ JobInvoiceId: BASE + 11, SEJobChargesRecvId: BASE + 10 }],
    });

    expect(second.body.result.created).toBe(1);
    expect(second.body.result.linked).toBe(0);
    expect(String((await db.Charge_Head.findByPk(seRecvHead.id)).InvoiceId))
      .toBe(String(first.id));
  });

  it('imports an opening balance with no job, and never as an orphan', async () => {
    const opening = inv(30, {
      SEJobId: null, OperationTypeId: 4, TranNumber: `${TEST_PREFIX}ACS-OJI-30/23`,
    });
    const res = await apply({ kind: 'JobInvoice', rows: [opening, inv(10)] });

    expect(res.body.result.created).toBe(2);
    expect(res.body.result.stats.openingBalances).toBe(1);
    expect(res.body.result.stats.orphaned).toBe(0);

    const row = await db.Invoice.findOne({ where: { climaxId: String(BASE + 30) } });
    expect(row.type).toBe('Opening Invoice');
    expect(row.payType).toBe('Recievable');
    expect(row.partyType).toBe('client');
    expect(row.SEJobId).toBeNull();
    expect(row.operation).toBe('SE');
    // Approved, or the payments screen cannot see it to settle it.
    expect(row.approved).toBe('1');
  });

  it('does not treat a client opening and an agent opening as the same row', async () => {
    // Both produce type 'Opening Invoice', and a legacy id is only unique
    // within its own table - so identity has to include partyType.
    const clientOpening = inv(80, {
      SEJobId: null, OperationTypeId: 4, TranNumber: `${TEST_PREFIX}ACS-OJI-80/23`,
    });
    const agentOpening = inv(80, {
      SEJobId: null, OperationTypeId: 4, PartyId: null, OverseasAgentId: BASE + 20,
      DebitCreditId: 5, TranNumber: `${TEST_PREFIX}SNS-OA-80/23`,
    });

    await apply({ kind: 'JobInvoice', rows: [clientOpening] });
    const second = await apply({
      kind: 'AgentInvoice', rows: [agentOpening], parentKey: 'AgentInvoiceId',
    });

    expect(second.body.result.created).toBe(1);
    expect(second.body.result.stats.alreadyImported).toBe(0);
    expect(await db.Invoice.count({ where: { climaxId: String(BASE + 80) } })).toBe(2);

    const rows = await db.Invoice.findAll({
      where: { climaxId: String(BASE + 80) }, order: [['partyType', 'ASC']], raw: true,
    });
    expect(rows.map((r) => r.partyType)).toEqual(['agent', 'client']);
    expect(rows.every((r) => r.type === 'Opening Invoice')).toBe(true);
  });

  it('skips an invoice whose job is not in Odyssey', async () => {
    const res = await apply({ kind: 'JobInvoice', rows: [inv(10, { SEJobId: 666666 })] });

    expect(res.body.result.created).toBe(0);
    expect(res.body.result.problems.orphaned).toContain(666666 && BASE + 10);
  });

  it('reads a job bill from its Bill* columns', async () => {
    const bill = {
      Id: BASE + 40,
      TranNumber: `${TEST_PREFIX}ACS-JB-40/24`,
      TranDate: '2024-05-09T00:00:00.000Z',
      BillDate: '2024-05-01T00:00:00.000Z',
      BillCurrencyId: 1,
      BillRemarks: 'Trucking',
      SEJobId: BASE + 1,
      PartyId: BASE + 20,
      SubCompanyId: BASE + 60,
      BillStatusId: 1,
      ExchangeRate: 1,
      NetAmount: 900,
      NetInclTaxAmount: 900,
    };

    await apply({
      kind: 'JobBill', rows: [bill], parentKey: 'JobBillId',
      links: [{ JobBillId: BASE + 40, SEJobChargesPaybId: BASE + 10 }],
    });

    const row = await db.Invoice.findOne({ where: { climaxId: String(BASE + 40) } });
    expect(row.type).toBe('Job Bill');
    expect(row.payType).toBe('Payble');
    expect(row.partyType).toBe('vendor');
    expect(row.currency).toBe('PKR');
    expect(row.note).toBe('Trucking');
    expect(new Date(row.createdAt).toISOString().slice(0, 10)).toBe('2024-05-01');

    // And it took the payable line, not the receivable one with the same id.
    expect(String((await db.Charge_Head.findByPk(sePaybHead.id)).InvoiceId)).toBe(String(row.id));
    expect((await db.Charge_Head.findByPk(seRecvHead.id)).InvoiceId).toBeNull();
  });

  it('types an agent bill out of GL_AgentInvoice - there is no GL_AgentBill', async () => {
    const agent = inv(50, { OverseasAgentId: BASE + 20, PartyId: null, DebitCreditId: 3 });
    await apply({
      kind: 'AgentInvoice', rows: [agent], parentKey: 'AgentInvoiceId',
      links: [{ AgentInvoiceId: BASE + 50, SEJobChargesPaybId: BASE + 10 }],
    });

    const row = await db.Invoice.findOne({ where: { climaxId: String(BASE + 50) } });
    expect(row.type).toBe('Agent Bill');
    expect(row.payType).toBe('Payble');
    expect(row.partyType).toBe('agent');
    expect(row.party_Id).toBe(String(client.id));
  });

  it('treats both agent types as one id space when re-running', async () => {
    // GL_AgentInvoice is one table producing two Odyssey types. Scoping the
    // already-imported check on a single type makes half its rows look new.
    const agent = inv(50, { OverseasAgentId: BASE + 20, PartyId: null, DebitCreditId: 3 });
    const body = {
      kind: 'AgentInvoice', rows: [agent], parentKey: 'AgentInvoiceId',
      links: [{ AgentInvoiceId: BASE + 50, SEJobChargesPaybId: BASE + 10 }],
    };

    await apply(body);
    const second = await apply(body);

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.stats.alreadyImported).toBe(1);
    expect(await db.Invoice.count({ where: { climaxId: String(BASE + 50) } })).toBe(1);
  });

  it('is safe to run twice', async () => {
    const body = {
      kind: 'JobInvoice',
      rows: [inv(10), inv(11)],
      links: [{ JobInvoiceId: BASE + 10, SEJobChargesRecvId: BASE + 10 }],
    };
    await apply(body);
    const second = await apply(body);

    expect(second.body.result.created).toBe(0);
    expect(second.body.result.stats.alreadyImported).toBe(2);
    expect(await db.Invoice.count({
      where: { climaxId: [String(BASE + 10), String(BASE + 11)] },
    })).toBe(2);
  });

  it('plan writes nothing, and links nothing', async () => {
    const res = await plan({
      kind: 'JobInvoice',
      rows: [inv(10)],
      links: [{ JobInvoiceId: BASE + 10, SEJobChargesRecvId: BASE + 10 }],
    });

    expect(res.status).toBe(200);
    expect(res.body.result.stats.toCreate).toBe(1);
    expect(res.body.result.stats.linesLinked).toBe(1);
    expect(await db.Invoice.count({ where: { climaxId: String(BASE + 10) } })).toBe(0);
    expect((await db.Charge_Head.findByPk(seRecvHead.id)).InvoiceId).toBeNull();
  });

  it('rejects an unknown kind', async () => {
    expect((await apply({ kind: 'Nonsense', rows: [] })).status).toBe(400);
  });

  it('refuses an oversized batch', async () => {
    const huge = Array.from({ length: 5001 }, (_, i) => inv(i + 100));
    expect((await apply({ kind: 'JobInvoice', rows: huge })).status).toBe(413);
  });

  it('verify reports the link, not just the count', async () => {
    await apply({
      kind: 'JobInvoice',
      rows: [inv(10)],
      links: [{ JobInvoiceId: BASE + 10, SEJobChargesRecvId: BASE + 10 }],
    });

    const res = await request(app).get('/invoiceMigration/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    const r = res.body.result;
    expect(r.invoices).toBeGreaterThan(0);
    expect(r.byType).toHaveProperty('Job Invoice');
    expect(r).toHaveProperty('totalByType');
    expect(r).toHaveProperty('chargeLinesLinked');
    expect(r).toHaveProperty('chargeLinesPointingAtNothing');
    expect(r).toHaveProperty('chargeLinesTypeMismatch');
    expect(r).toHaveProperty('duplicateInvoiceNumberCount');
    expect(r.chargeLinesPointingAtNothing).toBe(0);
    expect(r.chargeLinesTypeMismatch).toBe(0);
    expect(r).toHaveProperty('cancelled');
    expect(r).toHaveProperty('liveWithoutLines');
    expect(r).toHaveProperty('liveWithoutLinesValue');
  });

  it('imports a cancelled invoice unapproved, keeping its number', async () => {
    const dead = inv(70, {
      InvoiceStatusId: 2, TotalAmount: 0, NetAmount: 0, TaxAmount: 0, NetInclTaxAmount: 0,
    });
    const res = await apply({ kind: 'JobInvoice', rows: [dead] });

    expect(res.body.result.created).toBe(1);
    expect(res.body.result.stats.cancelled).toBe(1);

    const row = await db.Invoice.findOne({ where: { climaxId: String(BASE + 70) } });
    expect(row.approved).toBe('0');
    expect(row.total).toBe('0');
    expect(row.invoice_No).toBe(`${TEST_PREFIX}ACS-JI-70/24`);
  });

  /**
   * CLEARANCE INVOICES - the customs half.
   *
   * On CargoLinkers this is the whole sales and purchase ledger: 14,535 client
   * invoices and 36,410 vendor bills, against zero freight ones. Every one of
   * them lands with a NULL job, and that is correct - Invoice carries SEJobId
   * and has no customs equivalent, so a clearance invoice reaches its
   * declaration through its charge lines instead.
   *
   * Which is why these cases exist. Two separate places treated that null job
   * as a fault: the plan skipped LG rows outright, discarding the entire
   * ledger, and verify counted every one that did import as detached.
   */
  describe('clearance invoices', () => {
    let customsJob, lgRecvHead;

    const lgInv = (n, over = {}) => inv(n, {
      SEJobId: null, LGJobId: BASE + 3, ...over,
    });

    beforeAll(async () => {
      customsJob = await db.Customs_Job.create({
        jobNo: `${TEST_PREFIX}TP-9/26`, climaxId: BASE + 3,
        direction: 'Export', transportMode: 'Sea',
      });
      lgRecvHead = await db.Charge_Head.create({
        charge: '1', type: 'Recievable', invoiceType: 'Job Invoice',
        climaxId: BASE + 11, CustomsJobId: customsJob.id, net_amount: '1170',
      });
    });

    afterAll(async () => {
      await db.Charge_Head.destroy({ where: { id: lgRecvHead.id } });
      await db.Customs_Job.destroy({ where: { id: customsJob.id } });
    });

    it('imports a clearance invoice instead of discarding it', async () => {
      const res = await apply({ kind: 'JobInvoice', rows: [lgInv(30)] });

      expect(res.status).toBe(200);
      expect(res.body.result.created).toBe(1);
      // Counted as what it is, not as an orphan and not as an opening.
      expect(res.body.result.stats.onLogisticsJobs).toBe(1);
      expect(res.body.result.stats.orphaned).toBe(0);
      expect(res.body.result.stats.openingBalances).toBe(0);
    });

    it('lands with a null job, and keeps its own type', async () => {
      await apply({ kind: 'JobInvoice', rows: [lgInv(30)] });

      const row = await db.Invoice.findOne({ where: { climaxId: String(BASE + 30) } });
      expect(row).not.toBeNull();
      // Null is correct here - there is no customs column on Invoice.
      expect(row.SEJobId).toBeNull();
      // NOT an opening balance: it is a real job invoice with a real job.
      expect(row.type).toBe('Job Invoice');
      expect(row.operation).toBe('LG');
    });

    it('points the clearance charge line at its invoice', async () => {
      // The link this stage exists to form. Without it every migrated line
      // reads as uninvoiced work and the job P&L shows nothing realised.
      const res = await apply({
        kind: 'JobInvoice',
        rows: [lgInv(30)],
        links: [{ JobInvoiceId: BASE + 30, LGJobChargesRecvId: BASE + 11 }],
      });
      expect(res.status).toBe(200);

      const head = await db.Charge_Head.findByPk(lgRecvHead.id);
      const invoice = await db.Invoice.findOne({ where: { climaxId: String(BASE + 30) } });
      expect(String(head.InvoiceId)).toBe(String(invoice.id));
    });

    it('verify does not call a clearance invoice detached', async () => {
      // It did: SEJobId is null on every one, so all 50,945 of them read as
      // job invoices that had lost their job.
      await apply({ kind: 'JobInvoice', rows: [lgInv(30)] });

      const res = await request(app).get('/invoiceMigration/verify')
        .set('Authorization', admin.authHeader);

      expect(res.status).toBe(200);
      expect(res.body.result.detached).toBe(0);
      expect(res.body.result.onCustomsJobs).toBeGreaterThanOrEqual(1);
    });

    it('is safe to run twice', async () => {
      expect((await apply({ kind: 'JobInvoice', rows: [lgInv(30)] })).body.result.created).toBe(1);
      const again = await apply({ kind: 'JobInvoice', rows: [lgInv(30)] });
      expect(again.body.result.created).toBe(0);
      expect(await db.Invoice.count({ where: { climaxId: String(BASE + 30) } })).toBe(1);
    });

    it('a vendor bill on a declaration imports the same way', async () => {
      const res = await request(app).post('/invoiceMigration/apply')
        .set('Authorization', admin.authHeader)
        .send({
          currencies, parentKey: 'JobBillId', kind: 'JobBill',
          rows: [lgInv(31)],
        });

      expect(res.body.result.created).toBe(1);
      const row = await db.Invoice.findOne({ where: { climaxId: String(BASE + 31) } });
      expect(row.type).toBe('Job Bill');
      expect(row.operation).toBe('LG');
      expect(row.SEJobId).toBeNull();
    });
  });

});

// nodemailer/puppeteer are mocked at the top of the file (before any
// require of ../../index, which pulls in routes/invoice ->
// functions/mailer.js / functions/pdf.js) so the one happy-path "email
// actually sent" test below never opens a real SMTP connection or launches
// a real browser. jest.mock calls are hoisted above requires automatically.
// Every OTHER test in this file relies on the default global puppeteer
// mock (tests/mocks/puppeteerMock.js, wired via moduleNameMapper) which
// makes puppeteer.launch() reject - that's fine, it's a safety net, not
// something those tests exercise.
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' }),
  })),
}));

jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      setViewport: jest.fn().mockResolvedValue(undefined),
      goto: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from('fake-pdf-bytes')),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

// Configuration the sendEmail happy path needs BEFORE it reaches the mocks
// above. Both functions/pdf.js and functions/mailer.js validate their config
// first and throw, so mocking puppeteer and nodemailer is not enough on its
// own - the route 500s before either mock is called.
//
// Declared here rather than left to whatever .env the machine happens to have.
// This test passed locally and failed in CI purely because a developer's .env
// supplied these, which made the suite's result depend on the machine rather
// than on the code.
//
// None of the values are used: no browser is launched and no SMTP connection
// is opened. They only have to be non-empty, and they must be set BEFORE
// ../../index is required below.
process.env.FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'http://localhost:3003';
process.env.SMTP_HOST = process.env.SMTP_HOST || 'smtp.invalid';
process.env.SMTP_USER = process.env.SMTP_USER || 'test@example.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'test-password';

const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Clients, SE_Job, Invoice, Charge_Head, Employees, Email_Suggestion, History, Sales_Tax_Invoice } = require('../../models');
const { Op } = require('sequelize');
const { signPrintToken } = require('../../functions/printToken');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');

// SE_Job, Invoice and Vouchers all have a beforeCreate hook (see
// functions/Associations/fiscalYearAssociations) that requires a resolvable
// FiscalYearId and throws otherwise. Seeding these directly via the models
// with `{ fiscalYearCheck: false }` (the same escape hatch legacy-import
// routes use) sidesteps that, since these fixtures are prerequisites for
// exercising the INVOICE routes, not something we're testing the fiscal
// year gate itself with here.
// A company nothing else uses, so the company-scoped list contains exactly the
// fixture below and its count can be asserted exactly rather than "at least".
const TEST_COMPANY_ID = '990099';

describe('Invoice - routes/invoice/index.js', () => {
  let authHeader;
  let client;
  let seJob;
  let invoice;
  let chargeHead;
  const historyEmployeeIds = [];

  beforeAll(async () => {
    ({ authHeader } = await loginAs('employee'));

    client = await Clients.create({ name: `${TEST_PREFIX}Client ${Date.now()}` });
    seJob = await SE_Job.create(
      { jobNo: `${TEST_PREFIX}JOB-${Date.now()}`, subType: 'FCL', ClientId: client.id },
      { fiscalYearCheck: false }
    );
    invoice = await Invoice.create(
      {
        invoice_No: `${TEST_PREFIX}INV-${Date.now()}`,
        invoice_Id: 1,
        type: 'Job Invoice',
        payType: 'Recievable',
        status: '1',
        currency: 'PKR',
        party_Id: '1',
        party_Name: `${TEST_PREFIX}Client`,
        total: '1000',
        companyId: TEST_COMPANY_ID,
        SEJobId: seJob.id,
      },
      { fiscalYearCheck: false }
    );
    chargeHead = await Charge_Head.create({
      charge: `${TEST_PREFIX}Freight`,
      invoiceType: 'Job Invoice',
      type: 'Recievable',
      amount: '1000',
      net_amount: '1000',
      InvoiceId: invoice.id,
      SEJobId: seJob.id,
    });
  });

  afterAll(async () => {
    if (historyEmployeeIds.length) {
      await History.destroy({ where: { EmployeeId: historyEmployeeIds } });
    }
    await Email_Suggestion.destroy({ where: { email: { [Op.like]: `${TEST_PREFIX}%` } } });
    await Charge_Head.destroy({ where: { InvoiceId: invoice.id } });
    await Invoice.destroy({ where: { id: invoice.id }, fiscalYearCheck: false });
    await SE_Job.destroy({ where: { id: seJob.id }, fiscalYearCheck: false });
    await Clients.destroy({ where: { id: client.id } });
  });

  it('rejects requests with no auth token at all (401)', async () => {
    const res = await request(app).get('/invoice/getJobInvoices');
    expect(res.status).toBe(401);
  });

  it('GET /invoice/getJobInvoices returns the invoice (with its Charge_Heads) for the job', async () => {
    const res = await request(app)
      .get('/invoice/getJobInvoices')
      .set('Authorization', authHeader)
      .set('id', String(seJob.id));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    const found = res.body.result.find((i) => i.id === invoice.id);
    expect(found).toBeTruthy();
    expect(found.Charge_Heads.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /invoice/getInvoiceById returns full invoice + SE_Job detail', async () => {
    const res = await request(app)
      .get('/invoice/getInvoiceById')
      .set('Authorization', authHeader)
      .set('invoiceid', String(invoice.id));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.result.resultOne.invoice_No).toBe(invoice.invoice_No);
    expect(res.body.result.resultOne.SE_Job.jobNo).toBe(seJob.jobNo);
  });

  // What the customs invoice prints in place of the freight job's columns:
  // the job's number, date, type and S/R page, GD, Form-E / MBL, terminal,
  // the goods, and the invoiced party in full (name, address, NTN).
  it('GET /invoice/getInvoiceById carries the customs job and the invoiced party in full', async () => {
    const stamp = Date.now();
    const party = await Clients.create({
      name: `${TEST_PREFIX}CC Client ${stamp}`, address1: 'PLOT 5, KARACHI', ntn: '0709571-6', strn: '1200620000891',
    });
    const other = await Clients.create({ name: `${TEST_PREFIX}CC Other ${stamp}` });
    // "Shipper in M/S" on Printing Options prints this one instead.
    const shipper = await Clients.create({ name: `${TEST_PREFIX}CC Shipper ${stamp}`, address1: 'GUANGZHOU, CHINA' });
    const job = await Customs_Job.create({
      shipperId: shipper.id,
      jobNo: `${TEST_PREFIX}CC-${stamp}`, jobDate: '2026-09-20', jobType: 'Clearing', jobRef: '1726',
      invoiceNo: 'AMA-18792-26', packages: 2157, pkgUnit: 'CARTONS', goodsDescription: 'GARMENTS',
      gdNumber: '50712', formENo: 'FE-9921', mblNo: 'MBL-4410', terminal: 'QICT',
      transportMode: 'Sea', companyId: TEST_COMPANY_ID,
    });
    // party_Id as an invoice raised here stores it: a LEDGER ACCOUNT id - here
    // one that is also another party's Clients id, as CL-JI-1/27's 7137 was
    // (Velocity Textiles' account, S & D Chemicals' Clients row). The print
    // must address the invoice to the party on its lines, not to that row.
    const inv = await Invoice.create({
      invoice_No: `${TEST_PREFIX}CCINV-${stamp}`, type: 'Job Invoice', payType: 'Recievable', operation: 'CC',
      party_Id: String(other.id), party_Name: party.name, total: '2875', companyId: TEST_COMPANY_ID,
    }, { fiscalYearCheck: false });
    await Charge_Head.create({
      charge: `${TEST_PREFIX}Service`, type: 'Recievable', amount: '1', net_amount: '2875',
      InvoiceId: inv.id, CustomsJobId: job.id, partyId: party.id, partyType: 'Client',
    });
    try {
      const res = await request(app)
        .get('/invoice/getInvoiceById')
        .set('Authorization', authHeader)
        .set('invoiceid', String(inv.id));
      expect(res.status).toBe(200);
      const { customsJob, recipient } = res.body.result.resultOne;
      expect(customsJob).toMatchObject({
        jobNo: job.jobNo, jobDate: '2026-09-20', jobType: 'Clearing', jobRef: '1726',
        invoiceNo: 'AMA-18792-26', packages: 2157, pkgUnit: 'CARTONS', goodsDescription: 'GARMENTS',
        gdNumber: '50712', formENo: 'FE-9921', mblNo: 'MBL-4410', terminal: 'QICT',
      });
      expect(recipient).toMatchObject({ name: party.name, address1: 'PLOT 5, KARACHI', ntn: '0709571-6' });
      expect(customsJob.shipper).toMatchObject({ name: shipper.name, address1: 'GUANGZHOU, CHINA' });
    } finally {
      await Charge_Head.destroy({ where: { InvoiceId: inv.id } });
      await Invoice.destroy({ where: { id: inv.id }, fiscalYearCheck: false });
      await Customs_Job.destroy({ where: { id: job.id } });
      await Clients.destroy({ where: { id: [party.id, other.id, shipper.id] } });
    }
  });

  it('GET /invoice/getFilteredInvoices filters by type', async () => {
    // Searched for by number rather than trusting it to be on the first page.
    // The list is newest-first and capped now, so on a book of any size "is it
    // in the response" is a question about paging, not about the type filter.
    const res = await request(app)
      .get('/invoice/getFilteredInvoices')
      .query({ search: invoice.invoice_No })
      .set('Authorization', authHeader)
      .set('companyid', TEST_COMPANY_ID)
      .set('type', invoice.type);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.result.some((i) => i.id === invoice.id)).toBe(true);
    // Every row that comes back is of the type that was asked for.
    expect(res.body.result.every((i) => i.type === undefined || i.type === invoice.type)).toBe(true);
  });

  it('GET /invoice/getFilteredInvoices returns ONE PAGE and says how many there are', async () => {
    const res = await request(app)
      .get('/invoice/getFilteredInvoices')
      .query({ page: 1, limit: 1 })
      .set('Authorization', authHeader)
      .set('companyid', TEST_COMPANY_ID)
      .set('type', invoice.type);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.result.length).toBe(1);
    // The pager is built from these, so they are part of the contract.
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(1);
    expect(res.body.count).toBe(1);
    expect(res.body.pages).toBe(1);
  });

  it('GET /invoice/getFilteredInvoices searches the whole book, not the page in hand', async () => {
    // limit 1 so the fixture cannot be in the response by luck - with the book
    // newest-first, the server has to have filtered for it. This is the whole
    // point of moving search off the browser.
    const res = await request(app)
      .get('/invoice/getFilteredInvoices')
      .query({ page: 1, limit: 1, search: invoice.invoice_No })
      .set('Authorization', authHeader)
      .set('companyid', TEST_COMPANY_ID)
      .set('type', invoice.type);
    expect(res.status).toBe(200);
    expect(res.body.result.some((i) => i.id === invoice.id)).toBe(true);
  });

  describe('GET /invoice/getFilteredInvoices by date', () => {
    // The fixture was raised today. A day either side keeps the test clear of
    // the hour around midnight where "today" differs between zones.
    const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const listed = (query) => request(app)
      .get('/invoice/getFilteredInvoices')
      .query({ page: 1, limit: 50, search: invoice.invoice_No, ...query })
      .set('Authorization', authHeader)
      .set('companyid', TEST_COMPANY_ID)
      .set('type', invoice.type)
      .then((res) => res.body.result.map((i) => i.id));

    it('keeps an invoice dated inside the range, the last day included', async () => {
      expect(await listed({ from: day(-1), to: day(1) })).toContain(invoice.id);
    });

    it('leaves out one dated outside it', async () => {
      expect(await listed({ from: '2020-01-01', to: '2020-12-31' })).not.toContain(invoice.id);
    });

    it('takes either end on its own', async () => {
      expect(await listed({ from: day(-1) })).toContain(invoice.id);
      expect(await listed({ to: '2020-12-31' })).not.toContain(invoice.id);
    });

    it('ignores a date it cannot read rather than emptying the list', async () => {
      expect(await listed({ from: 'yesterday' })).toContain(invoice.id);
    });
  });

  it('GET /invoice/getFilteredInvoices searches the joined job number', async () => {
    // jobNo lives on SE_Job, not Invoice, so this is the `$SE_Job.jobNo$`
    // branch - and the one that breaks first if the LIMIT ever goes back to
    // being applied in a subquery the join is not inside.
    const res = await request(app)
      .get('/invoice/getFilteredInvoices')
      .query({ page: 1, limit: 5, search: seJob.jobNo })
      .set('Authorization', authHeader)
      .set('companyid', TEST_COMPANY_ID)
      .set('type', invoice.type);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.result.some((i) => i.id === invoice.id)).toBe(true);
  });

  it('GET /invoice/getFilteredInvoices shows the GST invoice number and finds an invoice by it', async () => {
    // The number lives on Sales_Tax_Invoice (hasOne, unique per invoice) - the
    // `$Sales_Tax_Invoice.taxInvoiceNo$` branch, under the same LIMIT as the
    // job number's.
    const seq = 80000000 + (Date.now() % 1000000);
    const gst = await Sales_Tax_Invoice.create({
      taxInvoiceNo: `${TEST_PREFIX}CL-${seq}`, seq, CompanyId: Number(TEST_COMPANY_ID), InvoiceId: invoice.id,
    });
    try {
      const listed = (search) => request(app)
        .get('/invoice/getFilteredInvoices')
        .query({ page: 1, limit: 5, search })
        .set('Authorization', authHeader)
        .set('companyid', TEST_COMPANY_ID)
        .set('type', invoice.type);

      const res = await listed(gst.taxInvoiceNo);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.result[0]).toMatchObject({ id: invoice.id, Sales_Tax_Invoice: { taxInvoiceNo: gst.taxInvoiceNo } });
      // Part of it, as typed into a search box - the sequence alone.
      expect((await listed(String(seq))).body.result.map((i) => i.id)).toEqual([invoice.id]);
      // Not a number it does not have.
      expect((await listed(`${TEST_PREFIX}CL-${seq + 1}`)).body.count).toBe(0);
    } finally {
      await gst.destroy();
    }
  });

  it('GET /invoice/getFilteredInvoices clamps the page and limit it is given', async () => {
    // A limit nobody typed on purpose is how "paginated" quietly becomes
    // "fetch the table again".
    const res = await request(app)
      .get('/invoice/getFilteredInvoices')
      .query({ page: 0, limit: 5000 })
      .set('Authorization', authHeader)
      .set('companyid', TEST_COMPANY_ID)
      .set('type', invoice.type);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(200);
  });

  it('GET /invoice/getFilteredInvoices finds an amount typed the way the list SHOWS it', async () => {
    // The list prints total '1000' as 1,000.00. Someone searching copies what
    // is on their screen, so the grouping and the trailing zeros have to be
    // taken back off before it can match the bare string in the column.
    const res = await request(app)
      .get('/invoice/getFilteredInvoices')
      .query({ page: 1, limit: 200, search: '1,000.00' })
      .set('Authorization', authHeader)
      .set('companyid', TEST_COMPANY_ID)
      .set('type', invoice.type);
    expect(res.status).toBe(200);
    expect(res.body.result.some((i) => i.id === invoice.id)).toBe(true);
  });

  it('GET /invoice/getFilteredInvoices still matches part of an amount', async () => {
    // Normalising the formatted form must not cost the partial match that
    // typing part of any other field gets.
    const res = await request(app)
      .get('/invoice/getFilteredInvoices')
      .query({ page: 1, limit: 200, search: '100' })
      .set('Authorization', authHeader)
      .set('companyid', TEST_COMPANY_ID)
      .set('type', invoice.type);
    expect(res.status).toBe(200);
    expect(res.body.result.some((i) => i.id === invoice.id)).toBe(true);
  });

  it('GET /invoice/getFilteredInvoices is scoped to the company that asked', async () => {
    // Another company's header must not reach this company's books.
    const res = await request(app)
      .get('/invoice/getFilteredInvoices')
      .query({ page: 1, limit: 200 })
      .set('Authorization', authHeader)
      .set('companyid', `${TEST_COMPANY_ID}-other`)
      .set('type', invoice.type);
    expect(res.status).toBe(200);
    expect(res.body.result.some((i) => i.id === invoice.id)).toBe(false);
  });

  it('GET /invoice/getFilteredInvoices returns NOTHING when no company is given', async () => {
    // Not "everything". companyId is a string column, so an absent header would
    // filter on undefined - which Sequelize drops, quietly handing back every
    // company's invoices again.
    const res = await request(app)
      .get('/invoice/getFilteredInvoices')
      .query({ page: 1, limit: 200 })
      .set('Authorization', authHeader)
      .set('type', invoice.type);
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  /**
   * THE PAYMENTS & RECEIPTS ALLOCATION LIST.
   *
   * Untested until now, which is how a ReferenceError in this very route
   * reached a running server: it is reachable only from one screen, and nothing
   * here exercised it.
   *
   * The rule it exists to pin: `party_Id` holds the CLIENT id on every migrated
   * invoice, and the LEDGER account id on ones aviation raised. The route used
   * to match the ledger account alone, so on a migrated book it matched nothing
   * at all and the screen showed no invoices, ever.
   */
  describe('getAllInvoicesByPartyId', () => {
    let payable;
    let receivable;
    let ancient;

    beforeAll(async () => {
      // party_Id is the CLIENT id here - the migrated convention.
      const base = {
        companyId: TEST_COMPANY_ID,
        currency: 'PKR',
        approved: '1',
        party_Id: String(client.id),
        party_Name: `${TEST_PREFIX}Client`,
        total: '500',
        invoice_Id: 1,
      };
      receivable = await Invoice.create(
        { ...base, invoice_No: `${TEST_PREFIX}PR-REC-${Date.now()}`, type: 'Job Invoice', payType: 'Recievable' },
        { fiscalYearCheck: false }
      );
      payable = await Invoice.create(
        { ...base, invoice_No: `${TEST_PREFIX}PR-PAY-${Date.now()}`, type: 'Job Bill', payType: 'Payble' },
        { fiscalYearCheck: false }
      );
      // Old enough to fall outside any current calendar period - the case the
      // whole feature turns on, and the one a screen defaulting to a fortnight
      // will hide.
      ancient = await Invoice.create(
        { ...base, invoice_No: `${TEST_PREFIX}PR-OLD-${Date.now()}`, type: 'Job Invoice', payType: 'Recievable' },
        { fiscalYearCheck: false }
      );
      await Invoice.update(
        { createdAt: new Date('2021-03-04T10:00:00Z') },
        { where: { id: ancient.id }, silent: true, fiscalYearCheck: false },
      );
    });

    afterAll(async () => {
      await Invoice.destroy({ where: { id: [receivable.id, payable.id, ancient.id] }, fiscalYearCheck: false });
    });

    const ask = (pay) => request(app)
      .get('/invoice/getAllInvoicesByPartyId')
      .set('Authorization', authHeader)
      .set('id', String(client.id))
      .set('companyid', TEST_COMPANY_ID)
      .set('invoicecurrency', 'PKR')
      .set('pay', pay);

    it('finds invoices whose party_Id is the CLIENT id', async () => {
      // The regression this route was fixed for. Also the cheapest guard against
      // the route throwing at all - a ReferenceError here is a 500, not an
      // empty list.
      const res = await ask('Recievable');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result.some((i) => i.id === receivable.id)).toBe(true);
    });

    it('filters to one side of the ledger when asked for one', async () => {
      const rec = await ask('Recievable');
      expect(rec.body.result.some((i) => i.id === receivable.id)).toBe(true);
      expect(rec.body.result.some((i) => i.id === payable.id)).toBe(false);

      const pay = await ask('Payble');
      expect(pay.body.result.some((i) => i.id === payable.id)).toBe(true);
      expect(pay.body.result.some((i) => i.id === receivable.id)).toBe(false);
    });

    it("'Both' returns payables AND receivables together", async () => {
      // What the Agent branch used to do by skipping the filter, now an
      // explicit choice for any party.
      const res = await ask('Both');
      expect(res.status).toBe(200);
      expect(res.body.result.some((i) => i.id === receivable.id)).toBe(true);
      expect(res.body.result.some((i) => i.id === payable.id)).toBe(true);
    });

    it('a PERIOD narrows the window, and says which window it used', async () => {
      // The fixtures were written just now, so this fortnight holds them.
      const res = await ask('Both').set('period', 'fortnight');
      expect(res.status).toBe(200);
      expect(res.body.period).toMatchObject({ period: 'fortnight' });
      expect(res.body.period.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.body.result.some((i) => i.id === receivable.id)).toBe(true);
    });

    it('an invoice older than the period is OUT of it', async () => {
      const res = await ask('Both').set('period', 'fortnight');
      expect(res.body.result.some((i) => i.id === ancient.id)).toBe(false);
    });

    it('a custom range wide enough finds it again', async () => {
      const res = await ask('Both')
        .set('period', 'custom').set('from', '2020-01-01').set('to', '2099-12-31');
      expect(res.body.period).toMatchObject({ period: 'custom' });
      expect(res.body.result.some((i) => i.id === ancient.id)).toBe(true);
    });

    it('NO period header leaves the window wide open - the edit path', async () => {
      // Re-opening a saved voucher has to see every invoice it allocated
      // against, whenever they were raised. That is why the filter is opt-in.
      const res = await ask('Both');
      expect(res.body.period).toBeNull();
      expect(res.body.result.some((i) => i.id === ancient.id)).toBe(true);
    });

    it('pages when asked, and counts the whole window', async () => {
      const res = await ask('Both')
        .set('period', 'custom').set('from', '2020-01-01').set('to', '2099-12-31')
        .set('page', '1').set('limit', '1');
      expect(res.status).toBe(200);
      expect(res.body.result.length).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(1);
      // Three fixtures in this party, so the count is of the window and not of
      // the page - otherwise the pager stops after one.
      expect(res.body.count).toBeGreaterThanOrEqual(3);
      expect(res.body.pages).toBe(Math.ceil(res.body.count / 1));
    });

    it('pages do not repeat or skip rows', async () => {
      const ids = [];
      for (const page of [1, 2, 3]) {
        const res = await ask('Both')
          .set('period', 'custom').set('from', '2020-01-01').set('to', '2099-12-31')
          .set('page', String(page)).set('limit', '1');
        ids.push(...res.body.result.map((i) => i.id));
      }
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('outstanding=true drops settled invoices, and the COUNT agrees', async () => {
      // The count, the pages and the rows have to describe one population. They
      // did not: the screen dropped settled invoices in the browser, after the
      // server had already counted and paged them - so the caption said one
      // number over a list of a different length.
      const settled = await Invoice.create(
        {
          invoice_No: `${TEST_PREFIX}PR-SETTLED-${Date.now()}`,
          invoice_Id: 1, type: 'Job Invoice', payType: 'Recievable',
          currency: 'PKR', approved: '1', companyId: TEST_COMPANY_ID,
          party_Id: String(client.id), party_Name: `${TEST_PREFIX}Client`,
          total: '500', paid: '500', recieved: '500',
        },
        { fiscalYearCheck: false }
      );
      try {
        const all = await ask('Both')
          .set('period', 'custom').set('from', '2020-01-01').set('to', '2099-12-31');
        expect(all.body.result.some((i) => i.id === settled.id)).toBe(true);

        const open = await ask('Both')
          .set('period', 'custom').set('from', '2020-01-01').set('to', '2099-12-31')
          .set('outstanding', 'true');
        expect(open.body.result.some((i) => i.id === settled.id)).toBe(false);
        // And the count is of the same set the rows came from.
        expect(open.body.count).toBe(all.body.count - 1);
      } finally {
        await Invoice.destroy({ where: { id: settled.id }, fiscalYearCheck: false });
      }
    });

    it('returns nothing for a party with no invoices', async () => {
      const res = await request(app)
        .get('/invoice/getAllInvoicesByPartyId')
        .set('Authorization', authHeader)
        .set('id', '99999999')
        .set('companyid', TEST_COMPANY_ID)
        .set('invoicecurrency', 'PKR')
        .set('pay', 'Both');
      expect(res.status).toBe(200);
      expect(res.body.result).toEqual([]);
    });

    /* EVERY INVOICE ON SOME PAGE. The page used to be cut from the JOINED
     * rows - one per equipment line on the invoice's job - so a party whose
     * jobs carry several lines had invoices that no page ever showed, while a
     * search found them at once. */
    describe('paging a party whose jobs carry several equipment lines', () => {
      let pagedClient; const pagedJobs = []; const pagedInvoices = [];

      beforeAll(async () => {
        const db = require('../../models');
        pagedClient = await Clients.create({ name: `${TEST_PREFIX}Paged ${Date.now()}` });
        for (let i = 0; i < 5; i += 1) {
          const job = await SE_Job.create({ jobNo: `${TEST_PREFIX}PG-${Date.now()}-${i}`, operation: 'SE' }, { fiscalYearCheck: false });
          pagedJobs.push(job);
          for (const size of ['20GP', '40HC', '40GP']) await db.SE_Equipments.create({ SEJobId: job.id, size, qty: '1' });
          pagedInvoices.push(await Invoice.create({
            invoice_No: `${TEST_PREFIX}PG-INV-${Date.now()}-${i}`, invoice_Id: i + 1, type: 'Job Invoice', payType: 'Recievable',
            companyId: TEST_COMPANY_ID, currency: 'PKR', approved: '1', total: '100', recieved: '0', paid: '0',
            party_Id: String(pagedClient.id), party_Name: pagedClient.name, SEJobId: job.id,
          }, { fiscalYearCheck: false }));
        }
      });

      afterAll(async () => {
        const db = require('../../models');
        await Invoice.destroy({ where: { id: pagedInvoices.map((i) => i.id) }, fiscalYearCheck: false });
        await db.SE_Equipments.destroy({ where: { SEJobId: pagedJobs.map((j) => j.id) } });
        await SE_Job.destroy({ where: { id: pagedJobs.map((j) => j.id) }, fiscalYearCheck: false });
        await Clients.destroy({ where: { id: pagedClient.id } });
      });

      it('shows each invoice exactly once across the pages, full pages first', async () => {
        const page = (n) => request(app).get('/invoice/getAllInvoicesByPartyId')
          .set('Authorization', authHeader).set('id', String(pagedClient.id))
          .set('companyid', TEST_COMPANY_ID).set('invoicecurrency', 'PKR').set('pay', 'Recievable')
          .set('outstanding', 'true').set('page', String(n)).set('limit', '2');
        const first = await page(1);
        expect(first.body.count).toBe(5);
        expect(first.body.result).toHaveLength(2);
        const seen = [];
        for (let n = 1; n <= 3; n += 1) seen.push(...(await page(n)).body.result.map((i) => i.id));
        expect(seen).toEqual(pagedInvoices.map((i) => i.id));
      });
    });

    // Payments & Receipts settles the oldest first, so the paged list opens
    // on the oldest outstanding invoice. It was newest first.
    it('pages the list oldest first', async () => {
      const res = await ask('Recievable').set('page', '1').set('limit', '50');
      expect(res.status).toBe(200);
      const mine = res.body.result.filter((i) => [ancient.id, receivable.id].includes(i.id)).map((i) => i.id);
      expect(mine).toEqual([ancient.id, receivable.id]);
      const dates = res.body.result.map((i) => new Date(i.createdAt).getTime());
      expect([...dates].sort((x, y) => x - y)).toEqual(dates);
    });

    // The Payments & Receipts search. It is a query parameter, not a header,
    // and it is searched on the server because the list is paged.
    describe('search', () => {
      it('finds an invoice by part of its number, in any case', async () => {
        const fragment = ancient.invoice_No.slice(-10).toLowerCase();
        const res = await ask('Recievable').query({ search: fragment });
        expect(res.status).toBe(200);
        expect(res.body.result.map((i) => i.id)).toEqual([ancient.id]);
      });

      it('finds an invoice older than any period, because the screen sends no period with a search', async () => {
        // The case search is for: ancient is years outside the fortnight the
        // list opens on, where browsing never shows it.
        const browse = await ask('Recievable').set('period', 'fortnight');
        expect(browse.body.result.some((i) => i.id === ancient.id)).toBe(false);

        const found = await ask('Recievable').query({ search: ancient.invoice_No });
        expect(found.body.result.some((i) => i.id === ancient.id)).toBe(true);
      });

      it('counts what it found, not the whole party', async () => {
        const res = await ask('Recievable')
          .set('page', '1').set('limit', '50')
          .query({ search: ancient.invoice_No });
        expect(res.body.count).toBe(1);
        expect(res.body.result).toHaveLength(1);
      });

      it('reads % and _ as text, not as wildcards', async () => {
        const all = await ask('Both');
        expect(all.body.result.length).toBeGreaterThan(0);

        // As a wildcard, % would match every invoice.
        const percent = await ask('Both').query({ search: '%' });
        expect(percent.status).toBe(200);
        expect(percent.body.result).toEqual([]);

        // As a wildcard, _ would match the '-' in "PR-REC". As text it must
        // not: no invoice number contains "PR_REC". (A bare '_' is no test -
        // the fixture numbers really do contain underscores.)
        const underscore = await ask('Both').query({ search: 'PR_REC' });
        expect(underscore.status).toBe(200);
        expect(underscore.body.result).toEqual([]);
        const dash = await ask('Both').query({ search: 'PR-REC' });
        expect(dash.body.result.some((i) => i.id === receivable.id)).toBe(true);
      });

      it('an empty search is no search', async () => {
        const plain = await ask('Both');
        const blank = await ask('Both').query({ search: '   ' });
        expect(blank.body.result.map((i) => i.id).sort()).toEqual(plain.body.result.map((i) => i.id).sort());
      });
    });
  });

  it('GET /invoice/getFilteredInvoices returns nothing for a search that matches nothing', async () => {
    const res = await request(app)
      .get('/invoice/getFilteredInvoices')
      .query({ search: `${TEST_PREFIX}NO-SUCH-INVOICE-${Date.now()}` })
      .set('Authorization', authHeader)
      .set('companyid', TEST_COMPANY_ID)
      .set('type', invoice.type);
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual([]);
    expect(res.body.count).toBe(0);
    expect(res.body.pages).toBe(0);
  });

  it('GET /invoice/getInvoices returns invoices that have a non-null Charge_Head.charge', async () => {
    const res = await request(app)
      .get('/invoice/getInvoices')
      .set('Authorization', authHeader)
      .set('id', String(seJob.id));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.result.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /invoice/deleteInvoice detaches Charge_Heads and removes the invoice', async () => {
    // Uses its own throwaway invoice/job so it doesn't interfere with the
    // shared fixture the other tests in this file depend on.
    const job = await SE_Job.create({ jobNo: `${TEST_PREFIX}JOB-DEL-${Date.now()}` }, { fiscalYearCheck: false });
    const inv = await Invoice.create(
      { invoice_No: `${TEST_PREFIX}INV-DEL-${Date.now()}`, type: 'Job Invoice', SEJobId: job.id },
      { fiscalYearCheck: false }
    );
    const head = await Charge_Head.create({ charge: `${TEST_PREFIX}ToDelete`, InvoiceId: inv.id, SEJobId: job.id });

    const res = await request(app)
      .get('/invoice/deleteInvoice')
      .set('Authorization', authHeader)
      .set('id', String(inv.id));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    expect(await Invoice.findByPk(inv.id)).toBeNull();
    const reloadedHead = await Charge_Head.findByPk(head.id);
    expect(reloadedHead.InvoiceId).toBeNull();

    await Charge_Head.destroy({ where: { id: head.id } });
    await SE_Job.destroy({ where: { id: job.id }, fiscalYearCheck: false });
  });

  describe('GET /invoice/getPrintData (public path, gated by a short-lived print token instead of a session)', () => {
    it('is reachable with NO Authorization header at all, given a valid print token', async () => {
      const token = signPrintToken(invoice.id);
      const res = await request(app)
        .get('/invoice/getPrintData')
        .set('printtoken', token)
        .set('invoiceid', String(invoice.id));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result.resultOne.invoice_No).toBe(invoice.invoice_No);
    });

    it('rejects with 401 when no print token is supplied', async () => {
      const res = await request(app).get('/invoice/getPrintData').set('invoiceid', String(invoice.id));
      expect(res.status).toBe(401);
    });

    it('rejects with 401 when the print token was issued for a different invoice', async () => {
      const token = signPrintToken(invoice.id + 999999);
      const res = await request(app)
        .get('/invoice/getPrintData')
        .set('printtoken', token)
        .set('invoiceid', String(invoice.id));
      expect(res.status).toBe(401);
    });
  });

  describe('POST /invoice/sendEmail - validation (never reaches PDF generation or nodemailer)', () => {
    it('rejects an invalid "to" address', async () => {
      const res = await request(app)
        .post('/invoice/sendEmail')
        .set('Authorization', authHeader)
        .send({ id: invoice.id, to: 'not-an-email' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('error');
      expect(res.body.result).toMatch(/valid email address/i);
    });

    it('rejects a missing "to" address', async () => {
      const res = await request(app).post('/invoice/sendEmail').set('Authorization', authHeader).send({ id: invoice.id });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('error');
    });

    it('rejects an invalid cc address even when "to" is valid', async () => {
      const res = await request(app)
        .post('/invoice/sendEmail')
        .set('Authorization', authHeader)
        .send({ id: invoice.id, to: 'ok@example.com', cc: 'not-valid' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('error');
      expect(res.body.result).toMatch(/CC/i);
    });

    it('errors when the sending employee has no email registered', async () => {
      const noEmailEmployee = await Employees.create({
        name: `${TEST_PREFIX}NoEmail`,
        username: `${TEST_PREFIX}noemail_${Date.now()}`,
        designation: 'employee',
        active: 'true',
      });
      const res = await request(app)
        .post('/invoice/sendEmail')
        .set('Authorization', authHeader)
        .send({ id: invoice.id, employeeId: noEmailEmployee.id, to: 'ok@example.com' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('error');
      expect(res.body.result).toMatch(/no email registered/i);
    });

    it('errors when the invoice does not exist', async () => {
      const employee = await Employees.create({
        name: `${TEST_PREFIX}Sender2`,
        username: `${TEST_PREFIX}sender2_${Date.now()}`,
        email: `${TEST_PREFIX}sender2@example.com`,
        designation: 'employee',
        active: 'true',
      });
      const res = await request(app)
        .post('/invoice/sendEmail')
        .set('Authorization', authHeader)
        // Invoice.id is an auto-incrementing INTEGER - use an id that
        // can't possibly exist rather than a non-numeric string, so this
        // exercises "not found" rather than a DB type-cast error.
        .send({ id: 999999999, employeeId: employee.id, to: 'ok@example.com' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('error');
      expect(res.body.result).toBe('Invoice not found.');
    });
  });

  describe('POST /invoice/sendEmail - happy path (puppeteer + nodemailer mocked per-file)', () => {
    let sender;

    beforeAll(async () => {
      sender = await Employees.create({
        name: `${TEST_PREFIX}Sender`,
        username: `${TEST_PREFIX}sender_${Date.now()}`,
        email: `${TEST_PREFIX}sender@example.com`,
        designation: 'employee',
        active: 'true',
      });
      historyEmployeeIds.push(sender.id);
    });

    it('generates a PDF (mocked), sends the email (mocked) and records history + email usage', async () => {
      const to = `${TEST_PREFIX}client@example.com`;
      const res = await request(app)
        .post('/invoice/sendEmail')
        .set('Authorization', authHeader)
        .send({
          id: invoice.id,
          employeeId: sender.id,
          to,
          subject: 'Custom subject',
          body: 'Custom body',
        });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');

      // NOTE (documents a real race, not fixed here): the route calls
      // `recordEmailUsage(...)` WITHOUT awaiting it before responding
      // (see routes/invoice/index.js's /sendEmail handler) - the HTTP
      // response can arrive before that Email_Suggestion upsert has
      // actually committed. A short poll makes this test reliable instead
      // of flaky, but the underlying fire-and-forget call is worth fixing
      // in the route itself at some point (a slow request between two fast
      // ones could plausibly lose this write in production too, e.g. if
      // the process exits/restarts right after responding).
      let suggestion = null;
      for (let attempt = 0; attempt < 10 && !suggestion; attempt += 1) {
        suggestion = await Email_Suggestion.findOne({ where: { email: to } });
        if (!suggestion) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(suggestion).toBeTruthy();
      expect(suggestion.usageCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /invoice/suggestEmails', () => {
    it('returns an empty result for an empty query', async () => {
      const res = await request(app).get('/invoice/suggestEmails').set('Authorization', authHeader);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'success', result: [] });
    });

    it('finds a previously-used address (seeded by the happy-path sendEmail test above)', async () => {
      const res = await request(app)
        .get('/invoice/suggestEmails')
        .set('Authorization', authHeader)
        .set('q', `${TEST_PREFIX}client`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result).toContain(`${TEST_PREFIX}client@example.com`);
    });
  });
});

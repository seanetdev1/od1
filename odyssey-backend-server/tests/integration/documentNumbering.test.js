const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const {
  normalise, lastInYear, nextAfter, perCompany, KEY, resetNumbering,
} = require('../../functions/documentNumber');
const { nextVoucherNo } = require('../../functions/voucherNumber');
const { lastInvoiceInYear } = require('../../functions/invoiceNumber');

/* NO SETTING CAN RESTART A SEQUENCE OR REUSE A NUMBER.
 *
 * The user's rule for Config > Document Numbers: the number on jobs, invoices
 * and vouchers continues "no matter what" - renaming a code, dropping the
 * company prefix, or putting the year first. Run against the real tables,
 * because the guarantee lives in the SQL: the last number is found by the
 * sequence column and the document's kind, never by the text those settings
 * control.
 *
 * Fiscal year '97' belongs to nobody, and the two companies are this test's
 * own, so the shared (prefix-off) sequence sees only these rows. */
describe('document numbering carries on through every setting', () => {
  const YEAR = '97';
  const made = { vouchers: [], invoices: [], jobs: [] };
  let a; let b;

  const plain = normalise({});
  const renamed = normalise({ codes: { vouchers: { BPV: 'BP' }, invoices: { 'Job Invoice': 'INV' }, jobs: { SE: 'SEA' } } });
  const noPrefix = normalise({ companyPrefix: { jobs: false, invoices: false, vouchers: false } });
  const yearFirst = normalise({ yearFirst: { jobs: true, invoices: true, vouchers: true } });

  const voucher = async (company, vType, no, id) => {
    const v = await db.Vouchers.create({ voucher_No: no, voucher_Id: id, vType, type: 'Test', CompanyId: company.id },
      { fiscalYearCheck: false });
    made.vouchers.push(v.id);
  };
  const invoice = async (company, no, id) => {
    const i = await db.Invoice.create({ invoice_No: id, invoice_Id: no, type: 'Job Invoice', payType: 'Recievable',
      companyId: String(company.id) }, { fiscalYearCheck: false });
    made.invoices.push(i.id);
  };

  beforeAll(async () => {
    a = await db.Company.create({ title: `${TEST_PREFIX}Numbering A ${Date.now()}`, short: 'TNA' });
    b = await db.Company.create({ title: `${TEST_PREFIX}Numbering B ${Date.now()}`, short: 'TNB' });

    // Vouchers of a type nobody else uses. A is at 5, B at 9.
    await voucher(a, 'ZZN', 5, `TNA-ZZN-5/${YEAR}`);
    await voucher(b, 'ZZN', 9, `TNB-ZZN-9/${YEAR}`);
    // FY96's 97th voucher, "TNA-ZZN-97/96". Read year-first it looks like
    // FY97's 96th - it must not count, or A would jump to 98.
    await voucher(a, 'ZZN', 97, 'TNA-ZZN-97/96');

    // Job Invoices: A at 4, B at 7.
    await invoice(a, 4, `TNA-JI-4/${YEAR}`);
    await invoice(b, 7, `TNB-JI-7/${YEAR}`);
  });

  afterAll(async () => {
    await db.Vouchers.destroy({ where: { id: made.vouchers }, fiscalYearCheck: false });
    await db.Invoice.destroy({ where: { id: made.invoices }, fiscalYearCheck: false });
    await db.SE_Job.destroy({ where: { id: made.jobs }, fiscalYearCheck: false });
    await db.Company.destroy({ where: { id: [a.id, b.id] } });
  });

  describe('vouchers', () => {
    const next = (settings, company = a) =>
      nextVoucherNo(db.Vouchers, { vType: 'ZZN', CompanyId: company.id, suffix: YEAR, settings });

    test('each company runs its own sequence while vouchers carry the prefix', async () => {
      expect(await next(plain, a)).toBe(6);
      expect(await next(plain, b)).toBe(10);
    });

    test('renaming the code does not restart it - the sequence is the voucher type\'s, not the text\'s', async () => {
      expect(await next(renamed)).toBe(6);
    });

    test('dropping the prefix makes it one sequence for every company, past the highest issued', async () => {
      // A at 5 and B at 9 would both issue "ZZN-10/97" otherwise.
      expect(await next(noPrefix, a)).toBe(10);
      expect(await next(noPrefix, b)).toBe(10);
    });

    test('a number issued without the prefix still counts once the prefix is back on', async () => {
      await voucher(a, 'ZZN', 12, `ZZN-12/${YEAR}`);
      expect(await next(plain, a)).toBe(13);
    });

    test('a year-first number is read as this year\'s - and last year\'s is not', async () => {
      await voucher(a, 'ZZN', 14, `TNA-ZZN-${YEAR}/14`);
      expect(await next(yearFirst, a)).toBe(15);
      expect(await next(plain, a)).toBe(15);
    });
  });

  describe('invoices', () => {
    const last = (settings, company = a) => lastInvoiceInYear(db.Invoice, {
      type: 'Job Invoice', companyId: company.id, suffix: YEAR, settings,
    });

    test('per company with the prefix, carried straight on through a renamed code', async () => {
      expect(nextAfter(await last(plain), 'invoice_Id')).toBe(5);
      expect(nextAfter(await last(renamed), 'invoice_Id')).toBe(5);
    });

    test('shared, past every company\'s highest, without it', async () => {
      expect(nextAfter(await last(noPrefix, a), 'invoice_Id')).toBe(8);
    });

    test('an invoice numbered year-first and unprefixed still counts for its company', async () => {
      await invoice(a, 9, `INV-${YEAR}/9`);
      expect(nextAfter(await last(plain, a), 'invoice_Id')).toBe(10);
    });
  });

  describe('jobs', () => {
    test('found by jobId and operation, whatever the job number says', async () => {
      const job = await db.SE_Job.create({
        jobNo: `SEA-${YEAR}/3`, jobId: 3, operation: 'SE', subType: 'FCL', companyId: String(a.id),
      }, { fiscalYearCheck: false });
      made.jobs.push(job.id);
      const lastJob = (settings) => lastInYear(db.SE_Job, {
        seqCol: 'jobId', noCol: 'jobNo', suffix: YEAR, where: { operation: 'SE' },
        company: { column: 'companyId', id: String(a.id) }, scoped: perCompany(settings, 'jobs'),
      });
      expect(nextAfter(await lastJob(plain), 'jobId')).toBe(4);
      expect(nextAfter(await lastJob(noPrefix), 'jobId')).toBe(4);
    });
  });
});

describe('Config > Document Numbers', () => {
  let authHeader;
  beforeAll(async () => { ({ authHeader } = await loginAs('admin')); });
  afterAll(async () => {
    await db.AppSetting.destroy({ where: { key: KEY } });
    resetNumbering();
  });

  test('reads the defaults, with the codes that can be named and an example per class', async () => {
    await db.AppSetting.destroy({ where: { key: KEY } });
    const res = await request(app).get('/settings/documentNumbering').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.result.codes.jobs.SE).toBe('SEJ');
    expect(res.body.configurable.vouchers.map((c) => c.key)).toEqual(['BRV', 'BPV', 'CRV', 'CPV', 'ADJ-R', 'ADJ-P']);
    expect(res.body.examples.jobs).toMatch(/^ABC-SEJ-/);
  });

  test('refuses a code two kinds would share, and says which', async () => {
    const res = await request(app).post('/settings/documentNumbering').set('Authorization', authHeader)
      .send({ codes: { vouchers: { CRV: 'CV', CPV: 'CV' } } });
    expect(res.status).toBe(400);
    expect(res.body.result).toMatch(/Cash Payment: "CV" is already used by Cash Receipt/);
  });

  test('saves, and the next read (and document) uses it', async () => {
    const res = await request(app).post('/settings/documentNumbering').set('Authorization', authHeader)
      .send({ companyPrefix: { invoices: false }, yearFirst: { vouchers: true }, codes: { jobs: { SE: 'sea' } } });
    expect(res.status).toBe(200);
    expect(res.body.examples.invoices).toBe('JI-140/27');
    expect(res.body.examples.vouchers).toBe('ABC-BPV-27/140');
    expect(res.body.examples.jobs).toBe('ABC-SEA-140/27');
    const again = await request(app).get('/settings/documentNumbering').set('Authorization', authHeader);
    expect(again.body.result.companyPrefix.invoices).toBe(false);
  });

  test('only an admin may change it', async () => {
    const { authHeader: employee } = await loginAs('employee');
    const res = await request(app).post('/settings/documentNumbering').set('Authorization', employee).send({});
    expect(res.status).toBe(403);
  });
});

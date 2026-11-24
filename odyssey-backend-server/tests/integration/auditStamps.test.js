const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const { Charge_Head, Invoice } = require('../../functions/Associations/incoiceAssociations');
const { Clients } = require('../../functions/Associations/clientAssociation');
const { FiscalYears, Charges, Vouchers } = require('../../models');
const db = require('../../models');
const { fiscalYearContextMiddleware } = require('../../functions/fiscalYearContext');

/* WHO MADE A RECORD, AND WHO LAST CHANGED IT - functions/auditStamps.
 *
 * createdBy / createdOn / editedBy / editedOn on jobs, vouchers, invoices and
 * charge lines, stamped by model hooks from the signed-in user. Through the
 * routes for the part that depends on the request (customs: a job and its
 * charge sheet, which deletes and rewrites its lines on every save); on the
 * models directly, inside a request's context, for the rules. */
describe('audit stamps', () => {
  let first; let second;          // two people, so an edit is told from a creation
  let fiscalYearId; let companyId; let clientId; let chargeMaster;
  const made = { jobs: [], invoices: [], vouchers: [], charges: [] };
  const stamp = Date.now();

  const as = (who) => (req) => req
    .set('Authorization', who.authHeader)
    .set('x-fiscal-year-id', String(fiscalYearId));
  // Model calls as if made inside a request by this person.
  const inRequestOf = (who, fn) => new Promise((resolve, reject) => {
    fiscalYearContextMiddleware({ headers: {}, user: { id: who.employee.id } }, {}, () => { fn().then(resolve, reject); });
  });
  const near = (when) => expect(Math.abs(new Date(when).getTime() - Date.now())).toBeLessThan(60 * 1000);

  beforeAll(async () => {
    first = await loginAs('admin');
    second = await loginAs('admin');
    const year = await FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    fiscalYearId = year
      ? year.id
      : (await FiscalYears.create({
          label: TEST_PREFIX + 'FY', suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
        })).id;
    companyId = String((await anyCompany()).id);
    clientId = (await Clients.create({ name: `${TEST_PREFIX}AU Client ${stamp}`, code: `${TEST_PREFIX}AU${stamp % 100000}` })).id;
    chargeMaster = await Charges.create({
      code: 9801, name: TEST_PREFIX + 'Audit Fee', short: 'TAUF',
      currency: 'PKR', calculationType: 'Per Unit', status: true,
      defaultPaybleParty: 'Shipper', defaultRecivableParty: 'Shipper', taxApply: 'false', taxPerc: '0',
    });
  });

  afterAll(async () => {
    await Charge_Head.destroy({ where: { CustomsJobId: made.jobs } });
    await Charge_Head.destroy({ where: { id: made.charges } });
    await db.Customs_Job.destroy({ where: { id: made.jobs } });
    await Invoice.destroy({ where: { id: made.invoices }, fiscalYearCheck: false });
    await Vouchers.destroy({ where: { id: made.vouchers }, fiscalYearCheck: false });
    await Charges.destroy({ where: { id: chargeMaster.id } });
    await Clients.destroy({ where: { id: clientId } });
  });

  /* ------------------------------------------------------- through the routes */
  describe('a customs job and its charge sheet', () => {
    let jobId; let job; let lines;
    const load = async () => {
      job = await db.Customs_Job.findByPk(jobId, { raw: true });
      lines = await Charge_Head.findAll({ where: { CustomsJobId: jobId }, order: [['id', 'ASC']], raw: true });
    };
    const edit = (who, data) => as(who)(request(app).post('/customsJob/edit'))
      .send({ employeeId: who.employee.id, data: { id: jobId, companyId, fiscalYearId, ...data } });

    beforeAll(async () => {
      const res = await as(first)(request(app).post('/customsJob/create')).send({
        employeeId: first.employee.id,
        data: {
          companyId, fiscalYearId, direction: 'Import', transportMode: 'Sea', clientId,
          gdNumber: `${TEST_PREFIX}GD-AUDIT`, gdDate: '2026-04-15', remarks: 'first',
          charges: [
            { charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 1000, description: 'one' },
            { charge: chargeMaster.id, type: 'Recievable', qty: 1, rate_charge: 2000, description: 'two' },
          ],
        },
      });
      expect(res.status).toBe(200);
      jobId = res.body.result.id;
      made.jobs.push(jobId);
      await load();
    });

    it('the job and each line: who entered them and when, and no edit yet', () => {
      expect(job.createdBy).toBe(first.employee.name);
      near(job.createdOn);
      expect(job.editedBy).toBeNull();
      expect(lines).toHaveLength(2);
      for (const l of lines) {
        expect(l.createdBy).toBe(first.employee.name);
        near(l.createdOn);
        expect(l.editedBy).toBeNull();
      }
    });

    it("another person's change is theirs; the creator stays, whatever the screen sends back", async () => {
      const [one, two] = lines;
      const res = await edit(second, {
        remarks: 'second',
        createdBy: 'Mallory', createdOn: '2001-01-01T00:00:00.000Z', editedBy: 'Mallory',
        charges: [
          { ...one, createdBy: 'Mallory', editedBy: 'Mallory' },          // as it was
          { ...two, rate_charge: 2500, createdBy: 'Mallory' },              // changed
        ],
      });
      expect(res.status).toBe(200);
      const before = { job, lines };
      await load();

      expect(job.createdBy).toBe(first.employee.name);
      expect(new Date(job.createdOn).getTime()).toBe(new Date(before.job.createdOn).getTime());
      expect(job.editedBy).toBe(second.employee.name);
      near(job.editedOn);

      // The sheet deletes and rewrites its lines: each keeps its creator, and
      // only the one that changed is edited.
      const [keptLine, changedLine] = lines;
      expect(keptLine.createdBy).toBe(first.employee.name);
      expect(new Date(keptLine.createdOn).getTime()).toBe(new Date(before.lines[0].createdOn).getTime());
      expect(keptLine.editedBy).toBeNull();
      expect(changedLine.createdBy).toBe(first.employee.name);
      expect(changedLine.editedBy).toBe(second.employee.name);
    });

    it('a save that changes nothing is not an edit', async () => {
      const before = { job, lines };
      const res = await edit(first, { remarks: 'second', charges: lines });
      expect(res.status).toBe(200);
      await load();
      expect(job.editedBy).toBe(second.employee.name);
      expect(new Date(job.editedOn).getTime()).toBe(new Date(before.job.editedOn).getTime());
      expect(lines.map((l) => l.editedBy)).toEqual([null, second.employee.name]);
    });

    it('the job comes back with them, and its creator by name', async () => {
      const res = await as(first)(request(app).get('/customsJob/getById')).set('id', String(jobId));
      expect(res.status).toBe(200);
      expect(res.body.result).toMatchObject({ createdByName: first.employee.name, editedBy: second.employee.name });
      expect(res.body.result.Charge_Heads[0]).toHaveProperty('createdBy', first.employee.name);
    });
  });

  /* ------------------------------------------------------------ the rules */
  describe('on the models', () => {
    let seq = 0;
    const invoice = (values = {}) => Invoice.create({
      invoice_No: `${TEST_PREFIX}AU-${stamp}-${seq += 1}`, type: 'Job Invoice', payType: 'Recievable',
      currency: 'PKR', total: '1000', recieved: '0', approved: '1', companyId, ...values,
    }, { fiscalYearCheck: false }).then((i) => { made.invoices.push(i.id); return i; });

    it("what is received or paid against an invoice is not an edit of it; its note is", async () => {
      const inv = await inRequestOf(first, () => invoice());
      await inRequestOf(second, () => Invoice.update({ recieved: '400', status: '1' }, { where: { id: inv.id }, fiscalYearCheck: false }));
      await inRequestOf(second, () => Invoice.update(
        { recieved: db.sequelize.literal('ROUND(CAST("recieved" AS numeric) + 100, 2)') },
        { where: { id: inv.id }, fiscalYearCheck: false },
      ));
      let row = await Invoice.findByPk(inv.id, { raw: true });
      expect(row.recieved).toBe('500.00');
      expect(row.editedBy).toBeNull();

      await inRequestOf(second, () => Invoice.update({ note: 'a note' }, { where: { id: inv.id }, fiscalYearCheck: false }));
      row = await Invoice.findByPk(inv.id, { raw: true });
      expect(row.editedBy).toBe(second.employee.name);
      expect(row.createdBy).toBe(first.employee.name);
    });

    it('an instance save: stamped when a field changes, not when one is set to what it was', async () => {
      const inv = await inRequestOf(first, () => invoice({ note: 'same' }));
      await inRequestOf(second, () => inv.update({ note: 'same', total: 1000 }, { fiscalYearCheck: false }));
      expect((await Invoice.findByPk(inv.id, { raw: true })).editedBy).toBeNull();
      await inRequestOf(second, () => inv.update({ note: 'changed', createdBy: 'Mallory' }, { fiscalYearCheck: false }));
      const row = await Invoice.findByPk(inv.id, { raw: true });
      expect(row).toMatchObject({ note: 'changed', createdBy: first.employee.name, editedBy: second.employee.name });
    });

    it('upsert - the charges screen: a new line is created, an untouched one left, a changed one edited', async () => {
      const line = (values) => ({ description: `${TEST_PREFIX}audit line`, amount: '100', qty: '1', status: '0', ...values });
      await inRequestOf(first, () => Charge_Head.upsert(line({ createdBy: 'Mallory' })));
      const created = await Charge_Head.findOne({ where: { description: `${TEST_PREFIX}audit line` }, order: [['id', 'DESC']], raw: true });
      made.charges.push(created.id);
      expect(created.createdBy).toBe(first.employee.name);
      near(created.createdOn);

      // Sent back as loaded: amounts as numbers, the stamps included.
      await inRequestOf(second, () => Charge_Head.upsert({ ...created, amount: 100, qty: 1 }));
      let row = await Charge_Head.findByPk(created.id, { raw: true });
      expect(row.editedBy).toBeNull();

      await inRequestOf(second, () => Charge_Head.upsert({ ...created, amount: '150', createdBy: 'Mallory' }));
      row = await Charge_Head.findByPk(created.id, { raw: true });
      expect(row).toMatchObject({ amount: '150', createdBy: first.employee.name, editedBy: second.employee.name });
      expect(new Date(row.createdOn).getTime()).toBe(new Date(created.createdOn).getTime());
    });

    it("a record migrated from Climax keeps the import's creator; whoever ran the import is not it", async () => {
      const v = await inRequestOf(first, () => Vouchers.create({
        voucher_No: 990000 + (stamp % 1000), voucher_Id: `${TEST_PREFIX}AU-V-${stamp}`, vType: 'JV', type: 'Journal Voucher',
        currency: 'PKR', exRate: '1', CompanyId: companyId, climaxId: 424242,
        createdBy: 'abbas # SERVER # Administrator # 192.168.50.136',
      }, { fiscalYearCheck: false }));
      made.vouchers.push(v.id);
      let row = await Vouchers.findByPk(v.id, { raw: true });
      expect(row.createdBy).toBe('abbas # SERVER # Administrator # 192.168.50.136');
      expect(row.createdOn).toBeNull();

      // Changed in Odyssey afterwards: an edit like any other.
      await inRequestOf(second, () => Vouchers.update({ voucherNarration: 'fixed' }, { where: { id: v.id }, fiscalYearCheck: false }));
      row = await Vouchers.findByPk(v.id, { raw: true });
      expect(row.createdBy).toBe('abbas # SERVER # Administrator # 192.168.50.136');
      expect(row.editedBy).toBe(second.employee.name);
    });

    it('outside a request - a script - when is stamped, but no person, and no edit', async () => {
      const inv = await invoice();
      let row = await Invoice.findByPk(inv.id, { raw: true });
      expect(row.createdBy).toBeNull();
      near(row.createdOn);
      await Invoice.update({ note: 'by a script' }, { where: { id: inv.id }, fiscalYearCheck: false });
      row = await Invoice.findByPk(inv.id, { raw: true });
      expect(row.editedBy).toBeNull();
      expect(row.editedOn).toBeNull();
    });

    it('{ audit: false } leaves them alone', async () => {
      const inv = await inRequestOf(first, () => invoice());
      await inRequestOf(second, () => Invoice.update({ note: 'repair' }, { where: { id: inv.id }, fiscalYearCheck: false, audit: false }));
      expect((await Invoice.findByPk(inv.id, { raw: true })).editedBy).toBeNull();
    });
  });
});

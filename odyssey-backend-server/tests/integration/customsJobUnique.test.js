/**
 * The customs job list and save, as asked 2026-11-14:
 *   1. the list's search finds a job by its S/R Page #, Client Invoice # and
 *      container numbers too - in any case;
 *   2. GD #, Client Invoice # and the S/R Page # each kept to one live job of
 *      the company, where Configuration > Customs switches it on
 *      (functions/customsJobUnique);
 *   3. a time period on the list, by job date, as Payments & Receipts has.
 *
 * The switches are read through readCustomsJobForm, mocked HERE - this file's
 * modules only - so turning one on never touches the shared AppSetting that
 * other suites, running alongside, save their jobs under.
 */
const mockForm = jest.fn();
jest.mock('../../functions/customsJobForm', () => ({
  ...jest.requireActual('../../functions/customsJobForm'),
  readCustomsJobForm: (...a) => mockForm(...a),
}));

const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const { Customs_Job, Customs_Container } = require('../../functions/Associations/customsAssociations');
const { Company } = require('../../models');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const { DEFAULTS } = jest.requireActual('../../functions/customsJobForm');
const { numbersToCheck } = require('../../functions/customsJobUnique');

describe('customs job numbers, search and period', () => {
  let authHeader; let employeeId; let fiscalYearId; let companyId; let otherCompany;
  const jobIds = [];
  const tag = `${TEST_PREFIX}UQ${Date.now()}`;
  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYearId));

  const create = async (data = {}, company = companyId) => {
    const res = await auth(request(app).post('/customsJob/create')).send({
      employeeId,
      data: { companyId: company, fiscalYearId, direction: 'Export', transportMode: 'Sea', jobDate: '2026-04-10', ...data },
    });
    if (res.body?.result?.id) jobIds.push(res.body.result.id);
    return res;
  };
  const edit = (data) => auth(request(app).post('/customsJob/edit')).send({ employeeId, data });
  const list = (query = {}, search = '') => auth(request(app).get('/customsJob/get'))
    .set('companyid', companyId).set('search', search).query({ limit: 200, ...query });

  const switches = (on) => mockForm.mockResolvedValue({ ...DEFAULTS, referenceLabel: 'File Job Number', ...on });

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYearId = (await anyFiscalYear()).id;
    companyId = String((await anyCompany()).id);
    otherCompany = await Company.create({ title: `${TEST_PREFIX}UQ Other Co`, short: 'TUQ' });
  });

  beforeEach(() => switches({}));

  afterAll(async () => {
    await Customs_Container.destroy({ where: { CustomsJobId: jobIds } });
    await Customs_Job.destroy({ where: { id: jobIds }, fiscalYearCheck: false });
    await otherCompany.destroy();
  });

  describe('numbers no two jobs may share', () => {
    it('switched off - as every install was - a repeat is saved', async () => {
      expect((await create({ gdNumber: `${tag}-GD-OFF` })).status).toBe(200);
      expect((await create({ gdNumber: `${tag}-GD-OFF` })).status).toBe(200);
    });

    it('GD #: refused in any case or spacing, naming the job that has it', async () => {
      switches({ uniqueGdNumber: true });
      const first = await create({ gdNumber: `${tag}-GD-1` });
      expect(first.status).toBe(200);
      const again = await create({ gdNumber: `  ${tag.toLowerCase()}-gd-1 ` });
      expect(again.status).toBe(400);
      expect(again.body.result).toContain(`is already on job ${first.body.result.jobNo}`);
      expect(again.body.result).toContain('GD #');
    });

    it('across the whole company only - another company may have it', async () => {
      switches({ uniqueGdNumber: true });
      await create({ gdNumber: `${tag}-GD-CO` });
      expect((await create({ gdNumber: `${tag}-GD-CO` }, String(otherCompany.id))).status).toBe(200);
    });

    it('a cancelled job does not count', async () => {
      switches({ uniqueGdNumber: true });
      const old = await create({ gdNumber: `${tag}-GD-CXL` });
      await Customs_Job.update({ canceled: true }, { where: { id: old.body.result.id } });
      expect((await create({ gdNumber: `${tag}-GD-CXL` })).status).toBe(200);
    });

    it('Client Invoice #: either column, the whole number', async () => {
      switches({ uniqueClientInvoice: true });
      await create({ invoiceNo: `${tag}-INV-7`, clientRef: `${tag}-INV-7` });
      const again = await create({ clientRef: `${tag}-inv-7` });
      expect(again.status).toBe(400);
      expect(again.body.result).toContain('Client Invoice #');
    });

    it("the S/R Page # - under the install's name for it - only when its own switch is on", async () => {
      switches({ uniqueGdNumber: true });
      await create({ jobRef: `${tag}-SR-1` });
      expect((await create({ jobRef: `${tag}-SR-1` })).status).toBe(200);
      switches({ uniqueJobRef: true });
      const again = await create({ jobRef: `${tag}-SR-1` });
      expect(again.status).toBe(400);
      expect(again.body.result).toMatch(/^File Job Number /);
    });

    it('a job keeps a number it already has; changing to one in use is refused', async () => {
      // Two jobs sharing a GD from before the switch - CargoLinkers has 885.
      const a = await create({ gdNumber: `${tag}-GD-OLD` });
      const b = await create({ gdNumber: `${tag}-GD-OLD` });
      const c = await create({ gdNumber: `${tag}-GD-OTHER` });
      switches({ uniqueGdNumber: true });
      const kept = await edit({ ...b.body.result, remarks: 'still saves' });
      expect(kept.status).toBe(200);
      const moved = await edit({ ...c.body.result, gdNumber: `${tag}-GD-OLD` });
      expect(moved.status).toBe(400);
      expect(moved.body.result).toContain(a.body.result.jobNo);
    });

    it('a blank number is never a duplicate', () => {
      const form = { uniqueGdNumber: true, uniqueClientInvoice: true, uniqueJobRef: true };
      expect(numbersToCheck(form, { gdNumber: ' ', clientRef: '', jobRef: null })).toEqual([]);
    });
  });

  describe('the list search', () => {
    let job;
    beforeAll(async () => {
      job = (await create({
        jobRef: `${tag}-FJN-55`, invoiceNo: `${tag}-CINV-55`, clientRef: `${tag}-CINV-55`,
        containers: `${tag.slice(-6)}TYPD123`,
        containerRows: [{ containerNo: `${tag.slice(-6)}ROW1234`, sizeType: '40HC' }],
      })).body.result;
    });
    const finds = async (text) => (await list({}, text)).body.result.some((r) => r.id === job.id);

    it('by the S/R Page # / File Job Number, in any case', async () => {
      expect(await finds(`${tag}-fjn-55`.toLowerCase())).toBe(true);
    });
    it('by the Client Invoice #', async () => {
      expect(await finds(`${tag}-CINV-55`)).toBe(true);
    });
    it('by a container row\'s number, and by the typed list', async () => {
      expect(await finds(`${tag.slice(-6)}ROW1234`.toLowerCase())).toBe(true);
      expect(await finds(`${tag.slice(-6)}TYPD`)).toBe(true);
    });
    it('a % typed is a % - not "anything"', async () => {
      expect(await finds(`${tag}%55`)).toBe(false);
    });
  });

  describe('the time period', () => {
    let april; let june;
    beforeAll(async () => {
      april = (await create({ gdNumber: `${tag}-P-APR`, jobDate: '2026-04-20' })).body.result;
      june = (await create({ gdNumber: `${tag}-P-JUN`, jobDate: '2026-06-02' })).body.result;
    });
    const ids = (res) => res.body.result.map((r) => r.id);

    it('custom: by job date, both ends inclusive, and says the dates it used', async () => {
      const res = await list({ period: 'custom', from: '2026-04-20', to: '2026-05-31' }, `${tag}-P-`);
      expect(ids(res)).toContain(april.id);
      expect(ids(res)).not.toContain(june.id);
      expect(res.body.period).toMatchObject({ from: '2026-04-20', to: '2026-05-31', period: 'custom' });
    });

    it('all - or none given - is every date', async () => {
      for (const query of [{ period: 'all' }, {}]) {
        const res = await list(query, `${tag}-P-`);
        expect(ids(res)).toEqual(expect.arrayContaining([april.id, june.id]));
        expect(res.body.period).toBeNull();
      }
    });
  });
});

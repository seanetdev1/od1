const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { MIGRATION_REMARK } = require('../../functions/awblMigration');
const { nextVoucherNo } = require('../../functions/voucherNumber');

const { Op } = db.Sequelize;

// The changes carried over from the live freight install's "Final Update":
// the freight AWB stock and the rule that an air-export BL's MAWB must come
// from it, the MAWBs a migration registers, Replace Party, and voucher numbers
// that restart each fiscal year.
//
// Jobs, BLs and vouchers are seeded through the models with
// { fiscalYearCheck: false } - the import routes' escape hatch - because none
// of this depends on the fiscal-year flow.
describe('Freight AWB stock, Replace Party and per-year voucher numbers', () => {
  let admin, company;
  const started = new Date();
  const parties = [];
  const jobs = [];
  const bls = [];
  const vouchers = [];

  // A prefix no real airline uses, so leftovers can never collide with data.
  const PREFIX = '998';
  // A different random serial block per run: the register is unique worldwide.
  const BASE = 1000000 + Math.floor(Math.random() * 8000000);
  const numberFor = (serial) => `${PREFIX}${String(serial).padStart(7, '0')}${serial % 7}`;
  const shown = (serial) => `${PREFIX}-${String(serial).padStart(7, '0')}${serial % 7}`;

  const party = async (name, types = 'Air Line') => {
    const p = await db.Clients.create({
      name: `${TEST_PREFIX}${name} ${Date.now()}`, code: 'TAW', types, active: true,
    });
    parties.push(p);
    return p;
  };
  const job = async (extra = {}) => {
    const j = await db.SE_Job.create({
      jobNo: `${TEST_PREFIX}AWB-${Date.now()}-${jobs.length}`, operation: 'AE', ...extra,
    }, { fiscalYearCheck: false });
    jobs.push(j);
    return j;
  };
  const bl = async (jobRow, mbl) => {
    const b = await db.Bl.create({
      hbl: `${TEST_PREFIX}HAWB-${Date.now()}-${bls.length}`, mbl, operation: 'AE', SEJobId: jobRow.id,
    });
    bls.push(b);
    return b;
  };
  const post = (path, body) => request(app).post(path).set('Authorization', admin.authHeader).send(body);

  beforeAll(async () => {
    admin = await loginAs('admin');
    company = await db.Company.create({ title: `${TEST_PREFIX}AWB Co ${Date.now()}`, short: 'TAW' });
  });

  afterAll(async () => {
    await db.Awbl.destroy({ where: { prefix: PREFIX } });
    await db.Awbl.destroy({ where: { remarks: MIGRATION_REMARK, createdAt: { [Op.gte]: started } } });
    if (bls.length) await db.Bl.destroy({ where: { id: bls.map((b) => b.id) } });
    if (vouchers.length) await db.Vouchers.destroy({ where: { id: vouchers.map((v) => v.id) }, fiscalYearCheck: false });
    const remaining = jobs.map((j) => j.id);
    if (remaining.length) await db.SE_Job.destroy({ where: { id: remaining }, fiscalYearCheck: false });
    if (parties.length) await db.Clients.destroy({ where: { id: parties.map((p) => p.id) } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  describe('the AWB register', () => {
    it('registers a series, stepping the check digit and wrapping 6 -> 0', async () => {
      const airline = await party('Airline A');
      const first = BASE - (BASE % 7) + 5; // check digit 5, so the series wraps
      const res = await post('/awbl/register', {
        airlineId: airline.id, prefix: PREFIX, code: `${String(first).padStart(7, '0')}5`,
        series: true, count: 3,
      });
      expect(res.body).toMatchObject({ status: 'success', result: { created: 3, skipped: 0 } });
      const rows = await db.Awbl.findAll({ where: { prefix: PREFIX, AirlineId: airline.id }, order: [['serial', 'ASC']] });
      expect(rows.map((r) => r.checkDigit)).toEqual(['5', '6', '0']);
    });

    it('refuses a number whose last digit is not the serial mod 7', async () => {
      const airline = await party('Airline B');
      const serial = BASE + 100;
      const wrong = (serial % 7 + 1) % 7;
      const res = await post('/awbl/register', {
        airlineId: airline.id, prefix: PREFIX, code: `${String(serial).padStart(7, '0')}${wrong}`,
      });
      expect(res.body.status).toBe('error');
      expect(res.body.result).toMatch(/should be \d, not \d/);
    });

    it('assigns a number to one job, will not give it to a second, and frees it when the job goes', async () => {
      const airline = await party('Airline C');
      const serial = BASE + 200;
      await post('/awbl/register', { airlineId: airline.id, prefix: PREFIX, code: numberFor(serial).slice(3) });
      const awb = await db.Awbl.findOne({ where: { awbNumber: numberFor(serial) } });

      const a = await job({ airLineId: airline.id });
      const b = await job({ airLineId: airline.id });
      expect((await post('/awbl/assign', { awblId: awb.id, jobId: a.id })).body.status).toBe('success');
      expect((await post('/awbl/assign', { awblId: awb.id, jobId: b.id })).body.status).toBe('error');

      // Used stock cannot be deleted from the register.
      expect((await post('/awbl/delete', { id: awb.id })).body.status).toBe('error');

      await db.SE_Job.destroy({ where: { id: a.id }, fiscalYearCheck: false });
      jobs.splice(jobs.indexOf(a), 1);
      await awb.reload();
      expect(awb.status).toBe('unused');
      expect(awb.SEJobId).toBeNull();
    });
  });

  describe('an air-export BL must carry a registered MAWB', () => {
    const blBody = (jobRow, mbl) => ({
      operation: 'AE', SEJobId: jobRow.id, hbl: `${TEST_PREFIX}HAWB-R3-${Date.now()}-${Math.random()}`,
      mbl, Item_Details: [], Container_Infos: [], Dimensions: [],
    });

    it('refuses an unregistered number, and one registered to another airline', async () => {
      const airline = await party('Airline D');
      const other = await party('Airline E');
      const j = await job({ airLineId: airline.id });

      const unregistered = await post('/seaJob/createBl', blBody(j, shown(BASE + 300)));
      expect(unregistered.body).toMatchObject({ status: 'warning' });
      expect(unregistered.body.result).toMatch(/is not registered/);

      await post('/awbl/register', { airlineId: other.id, prefix: PREFIX, code: numberFor(BASE + 301).slice(3) });
      const wrongAirline = await post('/seaJob/createBl', blBody(j, shown(BASE + 301)));
      expect(wrongAirline.body.result).toMatch(/not this job's airline/);
    });

    it('lets an existing BL be edited without touching its old, unregistered MAWB', async () => {
      const airline = await party('Airline F');
      const j = await job({ airLineId: airline.id });
      const old = await bl(j, '125-99999999'); // never registered, wrong check digit
      const res = await post('/seaJob/editBl', {
        ...blBody(j, old.mbl), id: old.id, hbl: old.hbl,
      });
      expect(res.body.status).not.toBe('warning');
    });
  });

  /* DHL's non-IATA MAWBs (2026-10-21): registered as printed, then usable on an
   * air-export BL like any other. Letters keep these test numbers apart from
   * anything real; a new block per run, as above. */
  describe('special-format AWBs', () => {
    const tag = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    const SPECIALS = [`TS${tag}1`, `TS${tag}2`];
    const blBody = (jobRow, mbl) => ({
      operation: 'AE', SEJobId: jobRow.id, hbl: `${TEST_PREFIX}HAWB-SP-${Date.now()}-${Math.random()}`,
      mbl, Item_Details: [], Container_Infos: [], Dimensions: [],
    });
    afterAll(() => db.Awbl.destroy({ where: { awbNumber: SPECIALS } }));

    it('registers a list as printed, marked special and shown as stored', async () => {
      const dhl = await party('DHL Special');
      const res = await post('/awbl/register', {
        airlineId: dhl.id, special: true,
        numbers: `ts-${tag}-1\nTS ${tag} 2, ts${tag}1`,
      });
      expect(res.body).toMatchObject({ status: 'success', result: { created: 2, skipped: 0 } });

      const rows = await db.Awbl.findAll({ where: { awbNumber: SPECIALS }, order: [['awbNumber', 'ASC']] });
      expect(rows.map((r) => [r.awbNumber, r.prefix, r.serial, r.checkDigit, r.status, r.AirlineId]))
        .toEqual(SPECIALS.map((n) => [n, '', '', '', 'unused', dhl.id]));

      const list = await request(app).get('/awbl/list').set('Authorization', admin.authHeader)
        .query({ search: `TS${tag}`, airlineId: dhl.id });
      expect(list.body.result.rows.map((r) => [r.formatted, r.special])).toEqual(SPECIALS.map((n) => [n, true]));

      const available = await request(app).get('/awbl/available').set('Authorization', admin.authHeader)
        .query({ airlineId: dhl.id });
      expect(available.body.result.map((r) => r.name)).toEqual(SPECIALS);
    });

    it('refuses the lot when one entry is not acceptable, and writes none of it', async () => {
      const dhl = await party('DHL Special B');
      const res = await post('/awbl/register', {
        airlineId: dhl.id, special: true, numbers: `TS${tag}9\n${numberFor(BASE + 500)}`,
      });
      expect(res.body.status).toBe('error');
      expect(res.body.result).toMatch(/standard IATA number/);
      expect(await db.Awbl.count({ where: { awbNumber: `TS${tag}9` } })).toBe(0);
    });

    it('is accepted as an air-export MAWB, typed with or without its separators', async () => {
      const dhl = await party('DHL Special C');
      await post('/awbl/register', { airlineId: dhl.id, special: true, numbers: `TS${tag}3` });
      SPECIALS.push(`TS${tag}3`);
      const j = await job({ airLineId: dhl.id });

      const res = await post('/seaJob/createBl', blBody(j, `TS-${tag}-3`));
      expect(res.body.status).not.toBe('warning');
      const made = await db.Bl.findOne({ where: { SEJobId: j.id } });
      if (made) bls.push(made);

      const unregistered = await post('/seaJob/createBl', blBody(await job({ airLineId: dhl.id }), `TS-${tag}-8`));
      expect(unregistered.body.status).toBe('warning');
      expect(unregistered.body.result).toMatch(new RegExp(`MAWB TS-${tag}-8 is not registered`));
    });
  });

  describe('the migration registers MAWBs typed on air BLs', () => {
    it('registers a clean number to its job, and a number on two jobs to neither', async () => {
      const airline = await party('Airline G');
      const clean = await job({ airLineId: airline.id });
      await bl(clean, shown(BASE + 400));
      const dupA = await job({ airLineId: airline.id });
      const dupB = await job({ airLineId: airline.id });
      await bl(dupA, shown(BASE + 401));
      await bl(dupB, shown(BASE + 401));

      const res = await post('/blMigration/registerMawbs', {});
      expect(res.body.status).toBe('success');

      const registered = await db.Awbl.findOne({ where: { awbNumber: numberFor(BASE + 400) } });
      expect(registered).toMatchObject({ SEJobId: clean.id, status: 'used', remarks: MIGRATION_REMARK });
      expect(await db.Awbl.count({ where: { awbNumber: numberFor(BASE + 401) } })).toBe(0);

      // Running again adds nothing.
      await post('/blMigration/registerMawbs', {});
      expect(await db.Awbl.count({ where: { awbNumber: numberFor(BASE + 400) } })).toBe(1);
    });
  });

  describe('Replace Party', () => {
    it('moves jobs and AWB stock to the replacement and deletes the old party', async () => {
      const from = await party('Dup Airline');
      const to = await party('Real Airline');
      const j = await job({ airLineId: from.id, ClientId: from.id });
      await post('/awbl/register', { airlineId: from.id, prefix: PREFIX, code: numberFor(BASE + 500).slice(3) });

      const impact = await request(app).get('/clientRoutes/mergeImpact')
        .set('Authorization', admin.authHeader).query({ id: from.id });
      expect(impact.body.result).toMatchObject({ canMerge: true, operationalTotal: 3 });

      const res = await post('/clientRoutes/mergeParty', { fromId: from.id, toId: to.id });
      expect(res.body).toMatchObject({ status: 'success', result: { movedTotal: 3, deleted: true } });
      await j.reload();
      expect([j.airLineId, j.ClientId]).toEqual([to.id, to.id]);
      expect((await db.Awbl.findOne({ where: { awbNumber: numberFor(BASE + 500) } })).AirlineId).toBe(to.id);
      expect(await db.Clients.count({ where: { id: from.id } })).toBe(0);
    });

    it('refuses while an invoice names the party', async () => {
      const from = await party('Invoiced', 'Shipper');
      const to = await party('Other', 'Shipper');
      const inv = await db.Invoice.create({
        invoice_No: `${TEST_PREFIX}MRG-${Date.now()}`, payType: 'Recievable', total: '100',
        recieved: '0', paid: '0', party_Id: String(from.id), companyId: company.id,
      }, { fiscalYearCheck: false });
      try {
        const res = await post('/clientRoutes/mergeParty', { fromId: from.id, toId: to.id });
        expect(res.body.status).toBe('error');
        expect(res.body.impact.unpaid).toHaveLength(1);
        expect(await db.Clients.count({ where: { id: from.id } })).toBe(1);
      } finally {
        await db.Invoice.destroy({ where: { id: inv.id }, fiscalYearCheck: false });
      }
    });

    it('is closed to an ordinary employee', async () => {
      const user = await loginAs('employee');
      const res = await request(app).post('/clientRoutes/mergeParty')
        .set('Authorization', user.authHeader).send({ fromId: 1, toId: 2 });
      expect(res.status).toBe(403);
    });
  });

  describe('voucher numbers restart each fiscal year', () => {
    const seed = async (voucher_Id, voucher_No) => {
      const v = await db.Vouchers.create({
        voucher_Id, voucher_No, vType: 'TVN', type: 'JOURNAL VOUCHER', CompanyId: company.id,
      }, { fiscalYearCheck: false });
      vouchers.push(v);
    };

    beforeAll(async () => {
      await seed('TAW-TVN-01875/26', 1875); // last voucher of the previous year
      await seed('TAW-TVN-00027/26', 27);   // FY26's 27th - looks like "27/.." to a loose match
      await seed('TAW-TVN-3/27', 3);        // this year so far
    });

    it('continues this year\'s sequence, not the previous year\'s', async () => {
      expect(await nextVoucherNo(db.Vouchers, { vType: 'TVN', CompanyId: company.id, suffix: '27' })).toBe(4);
    });

    it('opens a new year at 1 - FY27\'s 28th voucher is not read as year 28', async () => {
      await seed('TAW-TVN-28/27', 28);
      expect(await nextVoucherNo(db.Vouchers, { vType: 'TVN', CompanyId: company.id, suffix: '28' })).toBe(1);
    });

    it('counts year-first numbers too', async () => {
      await seed('TAW-TVN-29/7', 7); // year/seq: voucher 7 of FY29
      expect(await nextVoucherNo(db.Vouchers, { vType: 'TVN', CompanyId: company.id, suffix: '29' })).toBe(8);
    });
  });
});

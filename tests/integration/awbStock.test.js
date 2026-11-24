/**
 * AWB stock - routes/aviationJobs/awb.js.
 *
 * The register of air waybill numbers the office holds. Its rules are all
 * route-level, so they cannot be reached from the unit tests: functions/awb.js
 * decides what a REGISTRATION will do (planRegistration, tested there), but
 * everything below is about what the register refuses, and that is decided
 * against rows in a database.
 *
 * The two this file exists for:
 *
 *   UNASSIGN   takes a number back off a master agent and into office stock.
 *              Refused for a number already on a flight - the consignment
 *              names both the AWB and the agent it went out to, so releasing
 *              it would leave the flight referring to a hand-over the register
 *              says never happened.
 *
 *   VOID       marks a number unusable - a torn, misprinted or lost document -
 *              WITHOUT removing it. The airline allocated that serial and will
 *              ask what became of it, so a delete is the wrong answer. What it
 *              costs the number is the point of the tests here: it leaves the
 *              flight screen's dropdown, and assign, unassign and delete all
 *              refuse it. Restore is the way back, because voiding is one
 *              click on a row that looks like every other one.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const { Op } = require('sequelize');
const {
  Aviation_Awb, Aviation_Carrier, Aviation_Job, Aviation_Consignment,
} = require('../../functions/Associations/aviationAssociations');
const { Clients } = require('../../functions/Associations/clientAssociation');
const { FiscalYears, Company } = require('../../models');

describe('AWB stock - routes/aviationJobs/awb.js', () => {
  let authHeader;
  let employeeId;
  let fiscalYearId;
  let companyId;
  let carrierId;
  let agentId;
  let otherAgentId;
  const jobIds = [];

  const auth = (req) => req
    .set('Authorization', authHeader)
    .set('x-fiscal-year-id', String(fiscalYearId));

  // A prefix of its own, so these numbers cannot collide with a real block on
  // a developer's database - awbNumber is unique, and a clash would fail as a
  // duplicate rather than as the thing being tested.
  const PREFIX = '779';
  let nextSerial = 4000000;

  // The 8 digits a user types: serial + check digit, the digit being serial % 7.
  const codeFor = (serial) => `${String(serial).padStart(7, '0')}${serial % 7}`;

  /** Registers one fresh number and returns its row. */
  const registerOne = async (extra = {}) => {
    const serial = nextSerial++;
    const res = await auth(request(app).post('/aviationJob/awb/register'))
      .send({ carrierId, code: codeFor(serial), employeeId, ...extra });
    expect(res.status).toBe(200);
    return Aviation_Awb.findOne({ where: { awbNumber: `${PREFIX}${String(serial).padStart(7, '0')}${serial % 7}` } });
  };

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));

    const year = await FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    fiscalYearId = year
      ? year.id
      : (await FiscalYears.create({
          label: TEST_PREFIX + 'FY', suffix: '99',
          startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
        })).id;

    companyId = String((await anyCompany()).id);

    // The carrier owns the prefix - registration reads it off this row rather
    // than taking a typed one, which is why one has to exist.
    carrierId = (await Aviation_Carrier.create({
      name: TEST_PREFIX + 'Void Air', prefix: PREFIX, category: 'Cargo', status: true,
    })).id;

    agentId = (await Clients.create({
      name: TEST_PREFIX + 'Agent One', code: TEST_PREFIX + 'A1',
    })).id;
    otherAgentId = (await Clients.create({
      name: TEST_PREFIX + 'Agent Two', code: TEST_PREFIX + 'A2',
    })).id;
  });

  afterAll(async () => {
    if (jobIds.length) await Aviation_Consignment.destroy({ where: { AviationJobId: jobIds } });
    if (jobIds.length) await Aviation_Job.destroy({ where: { id: jobIds }, fiscalYearCheck: false });
    await Aviation_Awb.destroy({ where: { prefix: PREFIX } });
    await Aviation_Carrier.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
    await Clients.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
  });

  /* ---------------------------------------------------------------- unassign */
  describe('unassign', () => {
    test('takes a number back off its master agent', async () => {
      const row = await registerOne({ masterAgentId: agentId });
      expect(row.masterAgentId).toBe(agentId);

      const res = await auth(request(app).post('/aviationJob/awb/unassign'))
        .send({ ids: [row.id], employeeId });

      expect(res.status).toBe(200);
      expect(res.body.result.released).toBe(1);

      await row.reload();
      expect(row.masterAgentId).toBeNull();
      // assignedAt goes with it: a date saying when it was handed over is a
      // lie about a number sitting in office stock.
      expect(row.assignedAt).toBeNull();
    });

    test('refuses one that is already on a flight', async () => {
      const row = await registerOne({ masterAgentId: agentId });

      const job = await Aviation_Job.create({
        companyId, jobId: 90001, jobNo: TEST_PREFIX + 'AVJ-90001',
        flightDate: '2026-09-01', FiscalYearId: fiscalYearId,
      });
      jobIds.push(job.id);
      await Aviation_Consignment.create({
        AviationJobId: job.id, AviationAwbId: row.id, awb: row.awbNumber, sortOrder: 0,
      });

      const res = await auth(request(app).post('/aviationJob/awb/unassign'))
        .send({ ids: [row.id], employeeId });

      expect(res.status).toBe(409);
      await row.reload();
      expect(row.masterAgentId).toBe(agentId);
    });
  });

  /* -------------------------------------------------------------------- void */
  describe('void', () => {
    test('requires a reason - the note IS the record', async () => {
      const row = await registerOne();
      const res = await auth(request(app).post('/aviationJob/awb/void'))
        .send({ ids: [row.id], employeeId });

      expect(res.status).toBe(400);
      await row.reload();
      expect(row.voidedAt).toBeNull();
    });

    test('marks the number without removing it', async () => {
      const row = await registerOne({ masterAgentId: agentId });

      const res = await auth(request(app).post('/aviationJob/awb/void'))
        .send({ ids: [row.id], reason: 'Torn on arrival', employeeId });

      expect(res.status).toBe(200);
      expect(res.body.result.voided).toBe(1);

      const still = await Aviation_Awb.findByPk(row.id);
      // STILL THERE. That is the whole difference from a delete: the airline
      // issued this serial and will ask what became of it.
      expect(still).not.toBeNull();
      expect(still.voidedAt).toBeTruthy();
      expect(still.voidReason).toBe('Torn on arrival');
      // And still with the agent who was holding the spoiled document.
      expect(still.masterAgentId).toBe(agentId);
    });

    test('refuses a number that is already on a flight', async () => {
      const row = await registerOne();
      const job = await Aviation_Job.create({
        companyId, jobId: 90002, jobNo: TEST_PREFIX + 'AVJ-90002',
        flightDate: '2026-09-02', FiscalYearId: fiscalYearId,
      });
      jobIds.push(job.id);
      await Aviation_Consignment.create({
        AviationJobId: job.id, AviationAwbId: row.id, awb: row.awbNumber, sortOrder: 0,
      });

      const res = await auth(request(app).post('/aviationJob/awb/void'))
        .send({ ids: [row.id], reason: 'Torn', employeeId });

      expect(res.status).toBe(409);
      await row.reload();
      expect(row.voidedAt).toBeNull();
    });

    test('nothing is written when one of a batch is on a flight', async () => {
      // Voiding half a selection and stopping leaves the operator to work out
      // by hand which half.
      const clean = await registerOne();
      const flown = await registerOne();
      const job = await Aviation_Job.create({
        companyId, jobId: 90003, jobNo: TEST_PREFIX + 'AVJ-90003',
        flightDate: '2026-09-03', FiscalYearId: fiscalYearId,
      });
      jobIds.push(job.id);
      await Aviation_Consignment.create({
        AviationJobId: job.id, AviationAwbId: flown.id, awb: flown.awbNumber, sortOrder: 0,
      });

      const res = await auth(request(app).post('/aviationJob/awb/void'))
        .send({ ids: [clean.id, flown.id], reason: 'Water damaged', employeeId });

      expect(res.status).toBe(409);
      await clean.reload();
      expect(clean.voidedAt).toBeNull();
    });

    test('a second void does not re-stamp the first one', async () => {
      // The date and reason belong to when the document was actually spoiled.
      const row = await registerOne();
      await auth(request(app).post('/aviationJob/awb/void'))
        .send({ ids: [row.id], reason: 'Misprinted', employeeId });
      await row.reload();
      const first = row.voidedAt;

      const res = await auth(request(app).post('/aviationJob/awb/void'))
        .send({ ids: [row.id], reason: 'Something else', employeeId });

      expect(res.status).toBe(200);
      expect(res.body.result.voided).toBe(0);
      await row.reload();
      expect(row.voidedAt).toBe(first);
      expect(row.voidReason).toBe('Misprinted');
    });
  });

  /* ------------------------------------------ what a voided number can't do */
  describe('a voided number', () => {
    let voidedId;

    beforeAll(async () => {
      const row = await registerOne({ masterAgentId: agentId });
      await auth(request(app).post('/aviationJob/awb/void'))
        .send({ ids: [row.id], reason: 'Lost in transit', employeeId });
      voidedId = row.id;
    });

    test('is not offered to the flight screen', async () => {
      const res = await auth(request(app).get('/aviationJob/awb/available'));
      expect(res.status).toBe(200);
      expect(res.body.result.map((r) => r.id)).not.toContain(voidedId);
    });

    test('cannot be assigned to anybody', async () => {
      const res = await auth(request(app).post('/aviationJob/awb/assign'))
        .send({ ids: [voidedId], masterAgentId: otherAgentId, employeeId });

      expect(res.status).toBe(409);
      const row = await Aviation_Awb.findByPk(voidedId);
      expect(row.masterAgentId).toBe(agentId);
    });

    test('cannot be taken back off its agent', async () => {
      // It is frozen as it was voided, agent included - that is who was
      // holding the spoiled document.
      const res = await auth(request(app).post('/aviationJob/awb/unassign'))
        .send({ ids: [voidedId], employeeId });

      expect(res.status).toBe(409);
      const row = await Aviation_Awb.findByPk(voidedId);
      expect(row.masterAgentId).toBe(agentId);
    });

    test('cannot be deleted - the register is the record of what became of it', async () => {
      const res = await auth(request(app).post('/aviationJob/awb/delete'))
        .send({ id: voidedId, employeeId });

      expect(res.status).toBe(409);
      expect(await Aviation_Awb.findByPk(voidedId)).not.toBeNull();
    });

    test('cannot be put on a flight, even by a stale tab', async () => {
      // The dropdown drops it the moment it is voided, but a flight screen
      // opened before that still has it in its options and will post it back.
      const res = await auth(request(app).post('/aviationJob/create')).send({
        data: {
          companyId, fiscalYearId, flightDate: '2026-09-05',
          consignments: [{ AviationAwbId: voidedId, awb: '77940000009' }],
        },
        employeeId,
      });

      expect(res.status).toBe(409);
      expect(String(res.body.result)).toMatch(/voided/i);
    });

    test('is found by the voided filter, and kept out of stock', async () => {
      const voided = await auth(request(app).get('/aviationJob/awb/list'))
        .query({ status: 'voided', carrierId, all: 1 });
      expect(voided.body.result.rows.map((r) => r.id)).toContain(voidedId);

      const stock = await auth(request(app).get('/aviationJob/awb/list'))
        .query({ status: 'available', carrierId, all: 1 });
      expect(stock.body.result.rows.map((r) => r.id)).not.toContain(voidedId);
    });

    test('is named rather than blocking a re-run of its series', async () => {
      // One torn AWB in the middle of a block must not stop the ninety-nine
      // good ones around it from registering.
      const row = await Aviation_Awb.findByPk(voidedId);
      const serial = Number(row.serial);
      const res = await auth(request(app).post('/aviationJob/awb/register'))
        .send({ carrierId, code: codeFor(serial), series: true, count: 3, employeeId });

      expect(res.status).toBe(200);
      expect(res.body.result.created).toBe(2);
      expect(res.body.result.voided).toBe(1);
      expect(res.body.result.voidedNote).toMatch(/voided/i);

      // This run reached forward into serials the counter had not handed out
      // yet, so move it past them - registerOne() asserts a 200 and would
      // otherwise fail on "already registered" in a later test.
      nextSerial = Math.max(nextSerial, serial + 3);
    });
  });

  /* ----------------------------------------------------------------- restore */
  describe('restore', () => {
    test('makes the number usable again, back with the agent it was voided under', async () => {
      const row = await registerOne({ masterAgentId: agentId });
      await auth(request(app).post('/aviationJob/awb/void'))
        .send({ ids: [row.id], reason: 'Thought it was torn', employeeId });

      const res = await auth(request(app).post('/aviationJob/awb/unvoid'))
        .send({ ids: [row.id], employeeId });

      expect(res.status).toBe(200);
      expect(res.body.result.restored).toBe(1);

      await row.reload();
      expect(row.voidedAt).toBeNull();
      expect(row.voidReason).toBeNull();
      expect(row.masterAgentId).toBe(agentId);

      // And it can be taken back into stock again, which it could not while
      // it was voided.
      const back = await auth(request(app).post('/aviationJob/awb/unassign'))
        .send({ ids: [row.id], employeeId });
      expect(back.status).toBe(200);
    });

    test('says so when nothing in the request is voided', async () => {
      const row = await registerOne();
      const res = await auth(request(app).post('/aviationJob/awb/unvoid'))
        .send({ ids: [row.id], employeeId });
      expect(res.status).toBe(404);
    });
  });
});

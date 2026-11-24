/**
 * Aviation flights, AWBs and their charges - routes/aviationJobs/index.js.
 *
 * Aviation is a separate module (own tables, own routes) with ONE deliberate
 * join to the rest of the system: a charge on an AWB is a Charge_Head, the
 * same shared row a freight charge is. That is what lets invoicing, the
 * ledger, payments and ageing work with no aviation branch - and it is also
 * the thing most worth testing, because a mistake there corrupts a shared
 * table rather than an aviation-only one.
 *
 * The rules that carry real money are:
 *   - an AWB on an APPROVED invoice is frozen (except its remarks)
 *   - a charge on an APPROVED invoice is never rewritten or deleted
 *   - unapproving reopens both, and the charge keeps its place on the invoice
 *   - a carrier prefix identifies exactly one carrier
 *   - a master still referenced by history is deactivated, never deleted
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const { Op } = require('sequelize');
const {
  Aviation_Job, Aviation_Consignment, Aviation_Carrier, Aviation_Aircraft,
} = require('../../functions/Associations/aviationAssociations');
const { Charge_Head, Invoice } = require('../../functions/Associations/incoiceAssociations');
// Master agents are Clients - the flight-summary filter selects on one.
const { Clients } = require('../../functions/Associations/clientAssociation');
const { FiscalYears, Company, Charges, AppSetting } = require('../../models');

describe('Aviation jobs - routes/aviationJobs/index.js', () => {
  let authHeader;
  let employeeId;
  let fiscalYearId;
  let fySuffix;
  let companyId;
  let chargeMaster;
  const jobIds = [];

  // Every write here goes through the fiscal-year gate in
  // functions/Associations/fiscalYearAssociations: a create needs a resolvable
  // unlocked year, and an update needs the record to belong to the year the
  // REQUEST has selected - read from the x-fiscal-year-id header, not from the
  // body. Both have to be set, or an edit comes back 400 for a reason that has
  // nothing to do with aviation.
  const auth = (req) => req
    .set('Authorization', authHeader)
    .set('x-fiscal-year-id', String(fiscalYearId));

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));

    const year = await FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    const fy = year || await FiscalYears.create({
      label: TEST_PREFIX + 'FY', suffix: '99',
      startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
    });
    fiscalYearId = fy.id;
    // Needed by the null-sequence test below: a job number only counts toward
    // the sequence if it ends in this year's suffix.
    fySuffix = fy.suffix;

    // A real company, so the job number gets a real short code rather than
    // whatever companyShort() falls back to for an id that is not there.
    companyId = String((await anyCompany()).id);

    // The test database ships with no charge master, so looking one up would
    // return null and quietly skip every assertion about charges.
    chargeMaster = await Charges.create({
      code: 9900, name: TEST_PREFIX + 'AV Freight', short: 'TAVF',
      currency: 'PKR', calculationType: 'Per Unit', status: true,
      defaultPaybleParty: 'Shipper', defaultRecivableParty: 'Shipper',
      taxApply: 'false', taxPerc: '0',
    });
  });

  afterAll(async () => {
    // Charges first: they reference the consignments below.
    const mine = await Aviation_Consignment.findAll({
      where: { AviationJobId: jobIds.length ? jobIds : -1 },
      attributes: ['id'],
    });
    const cIds = mine.map((c) => c.id);
    if (cIds.length) await Charge_Head.destroy({ where: { AviationConsignmentId: cIds } });
    if (jobIds.length) await Aviation_Consignment.destroy({ where: { AviationJobId: jobIds } });
    if (jobIds.length) await Aviation_Job.destroy({ where: { id: jobIds }, fiscalYearCheck: false });
    await Clients.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
    await Aviation_Carrier.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
    await Aviation_Aircraft.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
    await Charges.destroy({ where: { name: { [Op.like]: TEST_PREFIX + '%' } } });
  });

  /* TODAY, not a pinned date.
   *
   * A flight's buying and selling rates stay editable only until the calendar
   * fortnight of its FLIGHT DATE closes - the 1st to the 15th, or the 16th to
   * month end (see functions/aviationFortnight). A fixture pinned to one date
   * therefore drifts out of its own window as the real clock moves, and a
   * suite that passes in September starts refusing rate edits in October for
   * reasons that have nothing to do with the code under test.
   *
   * Dating the fixture today keeps every flight it makes inside an open
   * fortnight, so the rule is exercised deliberately rather than by accident
   * of when the suite happens to run.
   */
  const TODAY = new Date().toISOString().slice(0, 10);

  const createJob = async (data = {}) => {
    const res = await auth(request(app).post('/aviationJob/create')).send({
      employeeId,
      fiscalYearId,
      data: {
        companyId,
        fiscalYearId,
        flightNo: 'ER-101',
        origin: 'LHE',
        destination: 'JED',
        flightDate: TODAY,
        status: 'Active',
        ...data,
      },
    });
    if (res.body && res.body.result && res.body.result.id) jobIds.push(res.body.result.id);
    return res;
  };

  // As the screen sends it: the company picked in the header comes with every
  // save, and the server refuses one without (functions/companyCodes).
  const editJob = (data) => auth(request(app).post('/aviationJob/edit')).send({ employeeId, data: { companyId, ...data } });

  describe('authentication', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app).get('/aviationJob/get');
      expect(res.status).toBe(401);
    });
  });

  describe('creating a flight', () => {
    it('assigns a job number from the company code and fiscal year', async () => {
      const res = await createJob();
      expect(res.status).toBe(200);
      // <SHORT>-AVJ-<n>/<fy>, the same shape a sea job gets, so the two never
      // look like different products.
      expect(res.body.result.jobNo).toMatch(/-AVJ-\d+\/\w+$/);
      expect(Number(res.body.result.jobId)).toBeGreaterThan(0);
    });

    it('numbers each new flight after the last', async () => {
      const a = await createJob();
      const b = await createJob();
      expect(Number(b.body.result.jobId)).toBe(Number(a.body.result.jobId) + 1);
    });

    it('numbers past a row that has NO job id at all', async () => {
      /* Postgres sorts NULLs FIRST on ORDER BY ... DESC, so one Aviation_Job
       * with a null jobId became "the last one" and parseInt(null) + 1 is NaN.
       * The insert went out as 'XXX-AVJ-NaN/99' with jobId NaN, the database
       * refused it, and EVERY new flight for that company and fiscal year
       * failed with a 500 that named nothing - until somebody found the row.
       *
       * Such rows are real: anything written straight into the table rather
       * than through this route has no sequence on it. */
      const before = await createJob();
      const seq = Number(before.body.result.jobId);

      const orphan = await Aviation_Job.create({
        // Ends in the fiscal year's suffix on purpose - otherwise it falls
        // outside the window the sequence is read from and proves nothing.
        jobNo: `ZZZ-AVJ-999999/${fySuffix}`,
        flightNo: 'ER-999', origin: 'LHE', destination: 'JED',
        flightDate: TODAY, status: 'Active', companyId,
        // jobId deliberately absent - that is the whole test.
      });
      jobIds.push(orphan.id);

      const after = await createJob();
      expect(after.status).toBe(200);
      expect(after.body.result.jobNo).not.toMatch(/NaN/);
      expect(Number(after.body.result.jobId)).toBe(seq + 1);
    });

    it('ignores a client-supplied id', async () => {
      // The number is the server's to assign; accepting one would let a client
      // overwrite an existing flight.
      const res = await createJob({ id: 999999 });
      expect(res.body.result.id).not.toBe(999999);
    });

    it('stores consignments sent with the flight', async () => {
      const res = await createJob({
        consignments: [
          { awb: '12345678', pieces: 10, grossWeight: 500, chargeableWeight: 520 },
          { awb: '87654321', pieces: 4, grossWeight: 200, chargeableWeight: 200 },
        ],
      });
      expect(res.body.result.Aviation_Consignments).toHaveLength(2);
    });

    it('drops the blank rows the grid always carries', async () => {
      const res = await createJob({
        consignments: [{ awb: '111', grossWeight: 1 }, {}, { awb: '' }],
      });
      expect(res.body.result.Aviation_Consignments).toHaveLength(1);
    });
  });

  describe('editing a flight', () => {
    it('rejects a missing or unusable id', async () => {
      for (const id of [undefined, 'abc', 0]) {
        const res = await editJob({ id, flightNo: 'X' });
        expect(res.status).toBe(400);
      }
    });

    it('does not let an edit renumber the flight', async () => {
      // People file against a job number; rewriting one orphans their paperwork.
      const created = await createJob();
      const { id, jobNo, jobId } = created.body.result;
      const res = await editJob({ id, jobNo: 'HACKED-1/99', jobId: 4242, flightNo: 'ER-202' });
      expect(res.status).toBe(200);
      expect(res.body.result.jobNo).toBe(jobNo);
      expect(String(res.body.result.jobId)).toBe(String(jobId));
      expect(res.body.result.flightNo).toBe('ER-202');
    });

    it('removes a consignment the screen no longer sends', async () => {
      const created = await createJob({
        consignments: [{ awb: 'AAA', grossWeight: 1 }, { awb: 'BBB', grossWeight: 2 }],
      });
      const { id, Aviation_Consignments: lines } = created.body.result;
      const keep = lines.find((l) => l.awb === 'AAA');

      const res = await editJob({
        id, consignments: [{ id: keep.id, awb: 'AAA', grossWeight: 1 }],
      });
      expect(res.body.result.Aviation_Consignments.map((l) => l.awb)).toEqual(['AAA']);
    });

    it('leaves consignments alone when the payload omits them entirely', async () => {
      // undefined is "the screen did not send them", which is not the same as
      // "this flight has none".
      const created = await createJob({ consignments: [{ awb: 'KEEP', grossWeight: 1 }] });
      const res = await editJob({ id: created.body.result.id, flightNo: 'ER-999' });
      expect(res.body.result.Aviation_Consignments).toHaveLength(1);
    });
  });

  describe('charges on an AWB are shared Charge_Head rows', () => {
    it('are stored against the consignment, with no SE_Job', async () => {
      const charge = chargeMaster;
      const created = await createJob({
        consignments: [{
          awb: '99999999', grossWeight: 100, chargeableWeight: 100,
          sellingRate: 1.7, exRate: 280,
          charges: [{ charge: charge.id, type: 'Recievable', qty: 100, rate_charge: 1.7 }],
        }],
      });
      const line = created.body.result.Aviation_Consignments[0];
      const stored = await Charge_Head.findAll({ where: { AviationConsignmentId: line.id } });

      expect(stored).toHaveLength(1);
      // The whole point of reusing Charge_Head: no SE_Job, and the shared
      // column has to tolerate that.
      expect(stored[0].SEJobId).toBeNull();
      expect(Number(stored[0].net_amount)).toBeCloseTo(170, 4);
      expect(Number(stored[0].local_amount)).toBeCloseTo(170 * 280, 2);
    });
  });

  describe('an invoiced AWB is locked', () => {
    let jobId; let lineId; let chargeId; let invoiceId;

    beforeAll(async () => {
      const charge = chargeMaster;
      const created = await createJob({
        consignments: [{
          awb: 'LOCKME', pieces: 3, grossWeight: 300, chargeableWeight: 300,
          remarks: 'before',
          charges: [{ charge: charge.id, type: 'Recievable', qty: 300, rate_charge: 2 }],
        }],
      });
      jobId = created.body.result.id;
      lineId = created.body.result.Aviation_Consignments[0].id;

      const stored = await Charge_Head.findOne({ where: { AviationConsignmentId: lineId } });
      chargeId = stored.id;

      // Stands in for /makeInvoice, which raises an aviation invoice ALREADY
      // APPROVED - it calls approveInvoice the moment the row exists, because
      // the charges it bills were approved before it was raised.
      //
      // `approved: '1'` is therefore part of standing in for it, not a detail.
      // The lock keys off the invoice being APPROVED, not merely off
      // Charge_Head.InvoiceId: an unapproved invoice has had its voucher
      // destroyed and is out of the ledger, so there is no issued figure left
      // for the AWB to contradict - see isInvoiceLocked. A fixture that left
      // this at the model's default of '0' would be testing the lock against
      // an invoice that is not in force.
      const inv = await Invoice.create(
        {
          invoice_No: TEST_PREFIX + 'AV-LOCK', invoiceType: 'Job Invoice',
          status: '0', approved: '1',
        },
        { fiscalYearCheck: false }
      );
      invoiceId = inv.id;
      await Charge_Head.update({ InvoiceId: invoiceId }, { where: { id: chargeId } });
    });

    afterAll(async () => {
      if (invoiceId) {
        await Charge_Head.update({ InvoiceId: null }, { where: { InvoiceId: invoiceId } });
        await Invoice.destroy({ where: { id: invoiceId }, fiscalYearCheck: false });
      }
    });

    const editLine = (values) =>
      editJob({ id: jobId, consignments: [{ id: lineId, ...values }] });

    it('refuses to change the figures the invoice was computed from', async () => {
      await editLine({ awb: 'CHANGED', grossWeight: 9999, chargeableWeight: 9999 });
      const after = await Aviation_Consignment.findByPk(lineId);
      expect(after.awb).toBe('LOCKME');
      expect(Number(after.grossWeight)).toBe(300);
    });

    it('still accepts remarks', async () => {
      // Notes are not figures - the explanation of why an AWB was invoiced a
      // certain way is usually wanted after everything else is frozen.
      await editLine({ awb: 'LOCKME', remarks: 'after' });
      expect((await Aviation_Consignment.findByPk(lineId)).remarks).toBe('after');
    });

    it('does not delete the AWB when the screen stops sending it', async () => {
      // The invoice would be left pointing at a consignment that is gone.
      await editJob({ id: jobId, consignments: [] });
      expect(await Aviation_Consignment.findByPk(lineId)).not.toBeNull();
    });

    it('never rewrites or deletes the invoiced charge itself', async () => {
      const still = await Charge_Head.findByPk(chargeId);
      expect(still).not.toBeNull();
      expect(still.InvoiceId).toBe(invoiceId);
      expect(Number(still.net_amount)).toBeCloseTo(600, 4);
    });
  });

  /* ---------------------------------------------------------------------
   * The other half of the lock. Unapproving an invoice destroys its voucher
   * and takes it back out of the ledger, and correcting the figures is the
   * whole reason anyone does that - so the AWB and its charges have to open
   * again.
   *
   * The subtle part is that the charge must be UPDATED IN PLACE. Rewriting it
   * as a fresh row would give it a new id, and the invoice would silently lose
   * the line it was raised from.
   * ------------------------------------------------------------------- */
  describe('unapproving an invoice reopens its AWB', () => {
    let jobId; let lineId; let chargeId; let invoiceId;

    beforeAll(async () => {
      const created = await createJob({
        consignments: [{
          awb: 'REOPEN01', pieces: 3, grossWeight: 300, chargeableWeight: 300,
          charges: [{ charge: chargeMaster.id, type: 'Recievable', qty: 300, rate_charge: 2 }],
        }],
      });
      jobId = created.body.result.id;
      lineId = created.body.result.Aviation_Consignments[0].id;
      chargeId = (await Charge_Head.findOne({ where: { AviationConsignmentId: lineId } })).id;

      const inv = await Invoice.create(
        {
          invoice_No: TEST_PREFIX + 'AV-REOPEN', invoiceType: 'Job Invoice',
          status: '0', approved: '1',
        },
        { fiscalYearCheck: false }
      );
      invoiceId = inv.id;
      await Charge_Head.update({ InvoiceId: invoiceId }, { where: { id: chargeId } });
    });

    afterAll(async () => {
      if (invoiceId) {
        await Charge_Head.update({ InvoiceId: null }, { where: { InvoiceId: invoiceId } });
        await Invoice.destroy({ where: { id: invoiceId }, fiscalYearCheck: false });
      }
    });

    const editLine = (values, charges) => editJob({
      id: jobId,
      consignments: [{ id: lineId, awb: 'REOPEN01', ...values, ...(charges ? { charges } : {}) }],
    });

    it('is frozen while the invoice is approved', async () => {
      await editLine({ grossWeight: 9999, chargeableWeight: 9999 });
      expect(Number((await Aviation_Consignment.findByPk(lineId)).grossWeight)).toBe(300);
    });

    it('opens again once the invoice is unapproved', async () => {
      // Straight to the flag: /invoice/unApprove is tested where it lives, and
      // what is under test here is what the aviation save does about it.
      await Invoice.update({ approved: '0' }, { where: { id: invoiceId }, fiscalYearCheck: false });

      await editLine(
        { grossWeight: 400, chargeableWeight: 400 },
        [{ id: chargeId, charge: chargeMaster.id, type: 'Recievable', qty: 400, rate_charge: 3 }],
      );

      const line = await Aviation_Consignment.findByPk(lineId);
      expect(Number(line.grossWeight)).toBe(400);
    });

    it('keeps the charge on its invoice rather than replacing the row', async () => {
      // Same id, same InvoiceId, new figures. A destroy-and-recreate would
      // satisfy the amount but leave the invoice pointing at nothing.
      const still = await Charge_Head.findByPk(chargeId);
      expect(still).not.toBeNull();
      expect(still.InvoiceId).toBe(invoiceId);
      expect(Number(still.net_amount)).toBeCloseTo(1200, 4);

      // And no duplicate was left behind alongside it.
      const all = await Charge_Head.findAll({ where: { AviationConsignmentId: lineId } });
      expect(all).toHaveLength(1);
    });
  });

  describe('ETD and ATD', () => {
    // Two departure times, because the gap between them is the delay: one
    // "departure time" overwritten on the day destroys the only record that
    // there was one.
    it('stores the planned time and the actual one separately', async () => {
      const created = await createJob({ etd: '17:40', departureTime: '19:15' });
      expect(created.status).toBe(200);
      expect(created.body.result.etd).toBe('17:40');
      // departureTime IS the ATD, under its old name - renaming the column
      // would cost every past flight its departure time to the alter-sync
      // that reconciles this table on every boot. See the model.
      expect(created.body.result.departureTime).toBe('19:15');
    });

    it('keeps them apart when the flight is edited', async () => {
      // The ATD is the one that moves on the day. The ETD is the slot the
      // flight was given, and an edit recording a late departure must not
      // quietly restate what it was scheduled for.
      const created = await createJob({ etd: '09:00', departureTime: '09:00' });
      const res = await editJob({ id: created.body.result.id, departureTime: '11:25' });
      expect(res.status).toBe(200);
      expect(res.body.result.etd).toBe('09:00');
      expect(res.body.result.departureTime).toBe('11:25');
    });
  });

  describe('a load that flew none of itself', () => {
    // Pieces and Gross WT are what the AWB was ASKED to carry. On a leg where
    // all of it was offloaded the operator types the offload and leaves those
    // blank - and blank reads as an AWB that was never booked, so the flight's
    // manifest loses the weight and a continuation leg prefills from nothing.
    //
    // Enforced HERE and not only in the grid: a consignment also arrives from
    // a stale tab and straight from the endpoint.
    it('books the leg from what it left behind', async () => {
      const created = await createJob({
        consignments: [{ awb: 'ALLOFF', offloadPieces: 5, offload: 500 }],
      });
      expect(created.status).toBe(200);
      const line = created.body.result.Aviation_Consignments[0];
      expect(line.pieces).toBe(5);
      expect(Number(line.grossWeight)).toBe(500);
      // Still recorded as offloaded - the rule fills the booking in, it does
      // not move the figures.
      expect(Number(line.offload)).toBe(500);
    });

    it('puts the weight back on the manifest, which is the point', async () => {
      // The manifest is the sum of what each leg was ASKED to carry - carryIn,
      // which falls back to gross. With the booking blank this flight reports
      // having been asked to carry nothing, by exactly the amount it was left
      // holding.
      const month = TODAY.slice(0, 7);
      const before = await auth(request(app).get('/aviationJob/report')).query({ month });
      await createJob({
        consignments: [{ awb: 'PENDOFF', offloadPieces: 2, offload: 300 }],
      });
      const after = await auth(request(app).get('/aviationJob/report')).query({ month });

      expect(after.body.result.grand.manifest - before.body.result.grand.manifest).toBe(300);
      // And nothing flew, so no column of the report grows.
      expect(after.body.result.grand.ttlUplift - before.body.result.grand.ttlUplift).toBe(0);
    });

    it('leaves a partly offloaded leg alone', async () => {
      const created = await createJob({
        consignments: [{ awb: 'PARTOFF', pieces: 10, grossWeight: 1000, offloadPieces: 3, offload: 300 }],
      });
      const line = created.body.result.Aviation_Consignments[0];
      expect(line.pieces).toBe(10);
      expect(Number(line.grossWeight)).toBe(1000);
    });

    it('does not shrink a booking that recorded its pieces', async () => {
      // 5 of 10 pieces left behind. Copying 5 into Pieces would rewrite the
      // booking as a smaller one than it was.
      const created = await createJob({
        consignments: [{ awb: 'SOMEPCS', pieces: 10, offloadPieces: 5, offload: 500 }],
      });
      const line = created.body.result.Aviation_Consignments[0];
      expect(line.pieces).toBe(10);
      expect(line.grossWeight).toBeNull();
    });

    it('needs both offload figures', async () => {
      const created = await createJob({
        consignments: [{ awb: 'HALFOFF', offload: 500 }],
      });
      const line = created.body.result.Aviation_Consignments[0];
      expect(line.pieces).toBeNull();
      expect(line.grossWeight).toBeNull();
    });

    it('skips a continuation leg', async () => {
      // carriedForward already records what this leg was asked to take, and
      // gross on such a leg is the whole shipment's documented total.
      const created = await createJob({
        consignments: [{ awb: 'CONTOFF', carriedForward: 300, offloadPieces: 2, offload: 300 }],
      });
      const line = created.body.result.Aviation_Consignments[0];
      expect(line.grossWeight).toBeNull();
      expect(line.pieces).toBeNull();
    });

    it('stores a chargeable weight of nought as nought, not as a blank', async () => {
      /* THE ROUND TRIP IS THE TEST. Nought is a real chargeable weight - it is
       * what an AWB that flew none of its cargo weighs - and `0 || null` is
       * null. The grid computed the 0, sent the 0, and the server stored a
       * blank; the flight then came back with a hole in a column the screen
       * requires, so it saved exactly once and every attempt after that was
       * refused for a figure the server had thrown away. */
      const created = await createJob({
        consignments: [{
          awb: 'ZEROCHG', pieces: 100, grossWeight: 100,
          chargeableWeight: 0, offloadPieces: 100, offload: 100,
        }],
      });
      expect(created.status).toBe(200);
      const line = created.body.result.Aviation_Consignments[0];
      expect(line.chargeableWeight).not.toBeNull();
      expect(Number(line.chargeableWeight)).toBe(0);

      // And it survives being read back and saved again, which is the part
      // that was actually broken.
      const again = await editJob({
        id: created.body.result.id,
        consignments: [{
          id: line.id, awb: 'ZEROCHG', pieces: 100, grossWeight: 100,
          chargeableWeight: line.chargeableWeight, offloadPieces: 100, offload: 100,
        }],
      });
      expect(Number(again.body.result.Aviation_Consignments[0].chargeableWeight)).toBe(0);
    });

    it('settles the chargeable weight when it fills the booking itself', async () => {
      // A stale tab or the endpoint sends the offload with nothing else.
      // Leaving chargeable null would hand back a row the screen refuses to
      // save - the same dead end by a different route.
      const created = await createJob({
        consignments: [{ awb: 'SRVCHG', offloadPieces: 4, offload: 400 }],
      });
      const line = created.body.result.Aviation_Consignments[0];
      expect(Number(line.grossWeight)).toBe(400);
      expect(line.chargeableWeight).not.toBeNull();
      expect(Number(line.chargeableWeight)).toBe(0);
    });

    it('never overrides a chargeable weight that was sent', async () => {
      // Conventionally the greater of actual and volumetric, so it is not
      // always derivable.
      const created = await createJob({
        consignments: [{
          awb: 'VOLCHG', offloadPieces: 4, offload: 400, chargeableWeight: 450,
        }],
      });
      expect(Number(created.body.result.Aviation_Consignments[0].chargeableWeight)).toBe(450);
    });

    it('does not rewrite a booking it already filled in', async () => {
      // Editing the offload afterwards means what it says: some of it flew.
      const created = await createJob({
        consignments: [{ awb: 'ONCEOFF', offloadPieces: 5, offload: 500 }],
      });
      const line = created.body.result.Aviation_Consignments[0];
      expect(Number(line.grossWeight)).toBe(500);

      const res = await editJob({
        id: created.body.result.id,
        consignments: [{
          id: line.id, awb: 'ONCEOFF', pieces: 5, grossWeight: 500,
          offloadPieces: 4, offload: 400,
        }],
      });
      const after = res.body.result.Aviation_Consignments[0];
      expect(Number(after.grossWeight)).toBe(500);
      expect(Number(after.offload)).toBe(400);
    });
  });

  describe('the per-AWB reporting tag', () => {
    // An OVERRIDE. The tag normally comes from the carrier, which is right for
    // almost every consignment; this column is for the flights where it is
    // not. Null means inherit, which is what every AWB saved before it existed
    // still does.
    let gamCarrier;

    beforeAll(async () => {
      const made = await auth(request(app).post('/aviationJob/carriers/save'))
        .send({ name: TEST_PREFIX + 'Tagged GAM', prefix: '731', category: 'GAM' });
      gamCarrier = made.body.result.id;
    });

    it('saves an override and leaves a blank one null', async () => {
      const created = await createJob({
        consignments: [
          { awb: 'OVR1', grossWeight: 10, AviationCarrierId: gamCarrier, reportingTag: 'Other' },
          { awb: 'OVR2', grossWeight: 10, AviationCarrierId: gamCarrier },
        ],
      });
      expect(created.status).toBe(200);
      const lines = created.body.result.Aviation_Consignments;
      expect(lines.find((l) => l.awb === 'OVR1').reportingTag).toBe('Other');
      // NOT 'GAM' copied down. Copying the carrier's tag at save time would
      // freeze it, so retagging the carrier in Setup would leave every AWB
      // already flown counting under the old column.
      expect(lines.find((l) => l.awb === 'OVR2').reportingTag).toBeNull();
    });

    it('counts the AWB under its own tag rather than its carrier\'s', async () => {
      const month = TODAY.slice(0, 7);
      const before = await auth(request(app).get('/aviationJob/report')).query({ month });

      await createJob({
        consignments: [
          { awb: 'RPT-OWN', grossWeight: 500, AviationCarrierId: gamCarrier, reportingTag: 'IFA' },
          { awb: 'RPT-INH', grossWeight: 300, AviationCarrierId: gamCarrier },
        ],
      });

      const after = await auth(request(app).get('/aviationJob/report')).query({ month });
      expect(after.status).toBe(200);

      // Read as a DIFFERENCE, not an absolute: the test database carries
      // whatever other flights this month's suite has already made.
      const grew = (key) => after.body.result.grand[key] - before.body.result.grand[key];
      expect(grew('ifaLoads')).toBe(500);   // the override
      expect(grew('gamUplift')).toBe(300);  // the one that inherited
    });

    it('rescues an AWB whose carrier has no tag of its own', async () => {
      // The case the column was added for. Without an override this weight
      // lands in `untagged` and counts toward no column at all.
      const untaggedCarrier = (await auth(request(app).post('/aviationJob/carriers/save'))
        .send({ name: TEST_PREFIX + 'No Tag', prefix: '732' })).body.result.id;

      const month = TODAY.slice(0, 7);
      const before = await auth(request(app).get('/aviationJob/report')).query({ month });
      await createJob({
        consignments: [
          { awb: 'RESCUED', grossWeight: 70, AviationCarrierId: untaggedCarrier, reportingTag: 'IFA' },
        ],
      });
      const after = await auth(request(app).get('/aviationJob/report')).query({ month });

      const grew = (key) => after.body.result.grand[key] - before.body.result.grand[key];
      expect(grew('ifaLoads')).toBe(70);
      // A carrier with no category defaults to 'Other', so nothing is
      // untagged here - what matters is that the override won.
      expect(grew('untagged')).toBe(0);
    });

    it("ignores a tag it does not recognise rather than storing it", async () => {
      // A stale tab or a poke at the endpoint. Falling back to inheriting is
      // exactly the behaviour this column did not exist for, so it is the safe
      // reading - and it keeps the column free of spellings the report would
      // have to guess at.
      const created = await createJob({
        consignments: [
          { awb: 'BADTAG', grossWeight: 5, AviationCarrierId: gamCarrier, reportingTag: 'Cargolux' },
        ],
      });
      expect(created.status).toBe(200);
      expect(created.body.result.Aviation_Consignments[0].reportingTag).toBeNull();
    });

    it('clears an override back to inheriting when the cell is emptied', async () => {
      const created = await createJob({
        consignments: [{ awb: 'CLEARME', grossWeight: 8, AviationCarrierId: gamCarrier, reportingTag: 'IFA' }],
      });
      const line = created.body.result.Aviation_Consignments[0];
      expect(line.reportingTag).toBe('IFA');

      const res = await editJob({
        id: created.body.result.id,
        consignments: [{ id: line.id, awb: 'CLEARME', grossWeight: 8, AviationCarrierId: gamCarrier, reportingTag: null }],
      });
      expect(res.status).toBe(200);
      expect(res.body.result.Aviation_Consignments[0].reportingTag).toBeNull();
    });
  });

  describe('the sales report', () => {
    /* One row per APPROVED AWB, buying against selling. The arithmetic is
     * pinned by tests/unit/aviationSalesReport.test.js; what matters here is
     * that the right AWBs are selected, that the money survives the round trip
     * through Sequelize, and that the breakout setting is read as a charge
     * CODE rather than as the id the row actually stores. */
    let carrierId; let agentId; let gtcCharge;
    const FROM = '2026-03-01';
    const TO = '2026-03-31';

    const report = (params) => auth(request(app).get('/aviationJob/salesReport'))
      .query({ from: FROM, to: TO, ...params });

    // The AWB the assertions below are about, whatever else the suite left in
    // the window.
    const rowFor = (res, awb) => res.body.result.rows.find((r) => r.awb === awb);

    /* LONGER THAN THE DEFAULT 20s, because this hook is five HTTP round trips
     * and a flight create runs 3-6 SECONDS against a local Postgres - it
     * writes the job, its consignments and their charge lines, then reads the
     * whole thing back through the same deep include the screen uses. Four
     * creates plus a carrier save sits right on the limit, so the block failed
     * as ten timed-out tests whenever the machine was busy, which says nothing
     * about the sales report. */
    const SETUP_TIMEOUT = 90000;

    beforeAll(async () => {
      carrierId = (await auth(request(app).post('/aviationJob/carriers/save'))
        .send({ name: TEST_PREFIX + 'Sales Air', prefix: '743', category: 'GAM' })).body.result.id;
      agentId = (await Clients.create({
        name: TEST_PREFIX + 'Sales Agent', code: TEST_PREFIX + 'SLA',
      })).id;

      // A SECOND charge master whose code and id deliberately differ, so a
      // report that matched the configured code straight against the stored
      // value would break out the wrong charge - or nothing at all.
      gtcCharge = await Charges.create({
        code: 9901, name: TEST_PREFIX + 'GTC Scan', short: 'TGTC',
        currency: 'PKR', calculationType: 'Per Unit', status: true,
        defaultPaybleParty: 'Shipper', defaultRecivableParty: 'Shipper',
        taxApply: 'false', taxPerc: '0',
      });

      await AppSetting.destroy({ where: { key: 'salesReportGtcCodes' } });
      await AppSetting.create({ key: 'salesReportGtcCodes', value: '9901' });

      // An APPROVED AWB, priced both ways, with a non-freight payable beside
      // the freight one.
      await createJob({
        flightNo: 'SR-100', flightDate: '2026-03-10',
        origin: 'ISB', destination: 'JED',
        operatingCarrierId: carrierId,
        consignments: [{
          awb: 'SRSOLD', grossWeight: 500, chargeableWeight: 500,
          AviationCarrierId: carrierId, masterAgentId: agentId,
          awbApproved: true,
          buyingRate: 7.1, sellingRate: 7.27,
          buyingExRate: 281, sellingExRate: 281,
          charges: [
            { charge: chargeMaster.id, type: 'Payble', currency: 'USD', qty: 500, rate_charge: 7.1 },
            { charge: gtcCharge.id, type: 'Payble', currency: 'USD', qty: 1, rate_charge: 20 },
            { charge: chargeMaster.id, type: 'Recievable', currency: 'USD', qty: 500, rate_charge: 7.27 },
          ],
        }],
      });

      // NOT approved: a selling rate typed with no charges behind it. It would
      // report a hundred per cent margin.
      await createJob({
        flightNo: 'SR-200', flightDate: '2026-03-12',
        operatingCarrierId: carrierId,
        consignments: [{
          awb: 'SRUNAPPROVED', grossWeight: 100, chargeableWeight: 100,
          AviationCarrierId: carrierId, awbApproved: false, sellingRate: 9,
        }],
      });

      // Someone else's load on someone else's air waybill - in the manifest,
      // never on an invoice.
      await createJob({
        flightNo: 'SR-300', flightDate: '2026-03-14',
        operatingCarrierId: carrierId,
        consignments: [{
          awb: 'SRDIRECT', grossWeight: 200, chargeableWeight: 200,
          AviationCarrierId: carrierId, awbApproved: true, direct: true,
        }],
      });

      // Outside the window, to prove the range is bounded at both ends.
      await createJob({
        flightNo: 'SR-OUT', flightDate: '2026-04-02',
        operatingCarrierId: carrierId,
        consignments: [{
          awb: 'SRLATER', grossWeight: 100, chargeableWeight: 100,
          AviationCarrierId: carrierId, awbApproved: true,
        }],
      });
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      await AppSetting.destroy({ where: { key: 'salesReportGtcCodes' } });
    });

    it('refuses a range it cannot read, and one that runs backwards', async () => {
      expect((await auth(request(app).get('/aviationJob/salesReport'))
        .query({ from: 'March', to: TO })).status).toBe(400);
      const backwards = await auth(request(app).get('/aviationJob/salesReport'))
        .query({ from: TO, to: FROM });
      expect(backwards.status).toBe(400);
      expect(String(backwards.body.result)).toMatch(/starts after it ends/);
    });

    it('lists an approved AWB, and neither the unapproved nor the direct one', async () => {
      const res = await report();
      expect(res.status).toBe(200);
      // AWB numbers are stored normalised - see functions/awb.normalizeAwb -
      // so the fixture names them without punctuation and they come back
      // exactly as typed.
      const mine = res.body.result.rows.filter((r) => String(r.awb).startsWith('SR'));
      expect(mine.map((r) => r.awb)).toEqual(['SRSOLD']);
    });

    it('bounds the period at both ends', async () => {
      const res = await report();
      expect(rowFor(res, 'SRLATER')).toBeUndefined();
    });

    it('carries the money through, priced off the charges', async () => {
      const res = await report();
      const row = rowFor(res, 'SRSOLD');

      // 500 x 7.1 x 281 freight, plus a 20 x 281 non-freight line.
      expect(row.payable).toBeCloseTo(500 * 7.1 * 281 + 20 * 281, 0);
      expect(row.receivable).toBeCloseTo(500 * 7.27 * 281, 0);
      expect(row.profit).toBeCloseTo(row.receivable - row.payable, 1);
      // The foreign face of the payable, converted per line.
      expect(row.dollarPayable).toBeCloseTo(500 * 7.1 + 20, 1);

      expect(row.buyingRate).toBe(7.1);
      expect(row.sellingRate).toBe(7.27);
      expect(row.agent).toBe(TEST_PREFIX + 'Sales Agent');
      expect(row.origin).toBe('ISB');
      expect(row.destination).toBe('JED');
    });

    it('breaks out the configured charge by its CODE, not by its id', async () => {
      // gtcCharge.code is 9901 and its id is whatever the sequence gave it.
      // Matching the setting straight against Charge_Head.charge would find
      // nothing and the column would read zero.
      expect(String(gtcCharge.code)).not.toBe(String(gtcCharge.id));
      const row = rowFor(await report(), 'SRSOLD');
      expect(row.gtcScan).toBeCloseTo(20, 2);
    });

    it('never lets a breakout pull Payable out of step with the charges', async () => {
      const row = rowFor(await report(), 'SRSOLD');
      // The freight line is in neither list and is still in Payable.
      expect(row.payable).toBeCloseTo(500 * 7.1 * 281 + 20 * 281, 0);
      expect(row.er).toBe(0);
    });

    it('leaves the settlement columns blank while the bill is unpaid', async () => {
      // Nothing has been invoiced or remitted against this AWB, and a 0.00
      // would read as "paid, with no exchange difference".
      const row = rowFor(await report(), 'SRSOLD');
      expect(row.remitAmount).toBeNull();
      expect(row.remitExRate).toBeNull();
      expect(row.exGainLoss).toBeNull();
      // And the totals say so, rather than leaving it to be counted out of a
      // column of dashes.
      expect((await report({ awb: 'SRSOLD' })).body.result.totals.settled).toBe(0);
    });

    it('heads the columns with the airline and the currency it was bought in', async () => {
      // Both decided by the server so a print or an export cannot disagree
      // with the screen about what a column is called.
      const res = await report({ awb: 'SRSOLD' });
      expect(res.body.result.labels.carrier).toBe(TEST_PREFIX + 'Sales Air');
      expect(res.body.result.labels.currency).toBe('USD');
    });

    it('filters by airline, agent, sector and AWB', async () => {
      expect(rowFor(await report({ operatingCarrierId: carrierId }), 'SRSOLD')).toBeTruthy();
      expect(rowFor(await report({ masterAgentId: agentId }), 'SRSOLD')).toBeTruthy();
      expect(rowFor(await report({ origin: 'ISB' }), 'SRSOLD')).toBeTruthy();
      expect(rowFor(await report({ destination: 'JED' }), 'SRSOLD')).toBeTruthy();
      // Typed WITH the hyphen, which is how an AWB is always written, against
      // a value stored without it.
      expect(rowFor(await report({ awb: 'SR-SOL' }), 'SRSOLD')).toBeTruthy();
      expect(rowFor(await report({ awb: 'SRSOL' }), 'SRSOLD')).toBeTruthy();
      expect(rowFor(await report({ flightNo: 'SR-100' }), 'SRSOLD')).toBeTruthy();

      // And excludes when the filter names something else.
      expect(rowFor(await report({ origin: 'KHI' }), 'SRSOLD')).toBeUndefined();
      expect(rowFor(await report({ awb: 'NOTHING' }), 'SRSOLD')).toBeUndefined();
    });

    it('totals the period', async () => {
      const res = await report({ awb: 'SRSOLD' });
      const t = res.body.result.totals;
      expect(t.awbs).toBe(1);
      expect(t.chargeableWeight).toBe(500);
      expect(t.receivable).toBeCloseTo(500 * 7.27 * 281, 0);
      expect(t.marginPerc).toBeCloseTo((t.profit / t.receivable) * 100, 2);
    });
  });

  describe('the per-flight summary report', () => {
    /* One row per flight, uplift AND offload split by tag. The arithmetic is
     * pinned by tests/unit/aviationFlightSummary.test.js; what matters here is
     * that the FILTERS select the right flights and that the figures survive
     * the round trip through Sequelize. */
    let gamCarrier; let otherCarrier; let agentId; let aircraftId;
    const FROM = '2026-05-01';
    const TO = '2026-05-31';

    const summary = (params) => auth(request(app).get('/aviationJob/flightSummary'))
      .query({ from: FROM, to: TO, ...params });

    beforeAll(async () => {
      gamCarrier = (await auth(request(app).post('/aviationJob/carriers/save'))
        .send({ name: TEST_PREFIX + 'Gamma Air', prefix: '741', category: 'GAM' })).body.result.id;
      otherCarrier = (await auth(request(app).post('/aviationJob/carriers/save'))
        .send({ name: TEST_PREFIX + 'Someone Else', prefix: '742', category: 'Other' })).body.result.id;
      aircraftId = (await auth(request(app).post('/aviationJob/aircraft/save'))
        .send({ name: TEST_PREFIX + 'A330-FS' })).body.result.id;
      agentId = (await Clients.create({
        name: TEST_PREFIX + 'FS Agent', code: TEST_PREFIX + 'FSA',
      })).id;

      await createJob({
        flightNo: 'FS-100', flightDate: '2026-05-10', pfm: 1000,
        origin: 'KHI', destination: 'JED',
        operatingCarrierId: gamCarrier, AviationAircraftId: aircraftId,
        consignments: [
          { awb: 'FS-A', grossWeight: 800, offload: 100, AviationCarrierId: gamCarrier, masterAgentId: agentId },
          { awb: 'FS-B', grossWeight: 400, offload: 0, AviationCarrierId: otherCarrier },
        ],
      });
      await createJob({
        flightNo: 'FS-200', flightDate: '2026-05-20', pfm: 500,
        origin: 'LHE', destination: 'DXB',
        operatingCarrierId: gamCarrier,
        consignments: [{ awb: 'FS-C', grossWeight: 300, offload: 50, AviationCarrierId: gamCarrier }],
      });
      // Outside the window, to prove the range is bounded at both ends.
      await createJob({ flightNo: 'FS-OUT', flightDate: '2026-06-01', pfm: 900 });
    });

    it('refuses a range it cannot read, and one that runs backwards', async () => {
      expect((await auth(request(app).get('/aviationJob/flightSummary'))
        .query({ from: 'May', to: TO })).status).toBe(400);
      const backwards = await auth(request(app).get('/aviationJob/flightSummary'))
        .query({ from: TO, to: FROM });
      expect(backwards.status).toBe(400);
      expect(String(backwards.body.result)).toMatch(/starts after it ends/);
    });

    it('returns a row per flight in the window, oldest first', async () => {
      const res = await summary();
      expect(res.status).toBe(200);
      const mine = res.body.result.rows.filter((r) => String(r.flightNo).startsWith('FS-'));
      expect(mine.map((r) => r.flightNo)).toEqual(['FS-100', 'FS-200']);
      // FS-OUT is dated 1 June: the window is closed at both ends.
      expect(mine.some((r) => r.flightNo === 'FS-OUT')).toBe(false);
    });

    it('splits uplift and offload by tag on the row', async () => {
      const res = await summary();
      const row = res.body.result.rows.find((r) => r.flightNo === 'FS-100');
      expect(row.pfm).toBe(1000);
      expect(row.manifest).toBe(1200);
      expect(row.uplift.GAM).toBe(700);
      expect(row.offload.GAM).toBe(100);
      expect(row.uplift.Other).toBe(400);
      expect(row.totalUplift).toBe(1100);
      expect(row.totalOffload).toBe(100);
      expect(row.aircraft).toContain('A330-FS');
    });

    it('heads the GAM column with the airline name', async () => {
      const res = await summary({ operatingCarrierId: gamCarrier });
      expect(res.body.result.labels.gam).toBe(TEST_PREFIX + 'Gamma Air');
      expect(res.body.result.labels.ifa).toBe('IFA');
    });

    it('filters by airline, aircraft, origin, destination and flight number', async () => {
      const byOrigin = await summary({ origin: 'LHE' });
      expect(byOrigin.body.result.rows.every((r) => r.origin === 'LHE')).toBe(true);

      const byDest = await summary({ destination: 'JED' });
      expect(byDest.body.result.rows.every((r) => r.destination === 'JED')).toBe(true);

      const byAircraft = await summary({ aircraftId });
      expect(byAircraft.body.result.rows.some((r) => r.flightNo === 'FS-100')).toBe(true);
      expect(byAircraft.body.result.rows.some((r) => r.flightNo === 'FS-200')).toBe(false);

      // Flight number is a contains-match: 'PK-301' and 'PK301' both get typed.
      const byFlight = await summary({ flightNo: 'FS-10' });
      expect(byFlight.body.result.rows.map((r) => r.flightNo)).toEqual(['FS-100']);
    });

    it('uses the master agent to SELECT flights, not to narrow the figures', async () => {
      /* PFM is a plan for the aircraft and cannot be apportioned to one agent,
       * so a column of part-flight figures beside a whole-flight PFM would be
       * a row that does not add up. */
      const res = await summary({ masterAgentId: agentId });
      const rows = res.body.result.rows;
      expect(rows.map((r) => r.flightNo)).toEqual(['FS-100']);

      const row = rows[0];
      // FS-B belongs to no agent and is still counted.
      expect(row.uplift.Other).toBe(400);
      expect(row.manifest).toBe(1200);
    });

    it('returns an empty report when the agent flew nothing, rather than everything', async () => {
      const stranger = await Clients.create({
        name: TEST_PREFIX + 'Flew Nothing', code: TEST_PREFIX + 'FN',
      });
      const res = await summary({ masterAgentId: stranger.id });
      expect(res.status).toBe(200);
      expect(res.body.result.rows).toEqual([]);
      await Clients.destroy({ where: { id: stranger.id } });
    });

    it('totals the period', async () => {
      const res = await summary({ operatingCarrierId: gamCarrier });
      const t = res.body.result.totals;
      expect(t.flights).toBe(2);
      expect(t.pfm).toBe(1500);
      expect(t.uplift.GAM).toBe(950);
      expect(t.offload.GAM).toBe(150);
      expect(t.uplift.Other).toBe(400);
      expect(t.totalOffload).toBe(150);
    });
  });

  describe('carrier master', () => {
    const save = (body) => auth(request(app).post('/aviationJob/carriers/save')).send(body);
    const del = (body) => auth(request(app).post('/aviationJob/carriers/delete')).send(body);

    it('requires a name', async () => {
      const res = await save({ prefix: '214' });
      expect(res.status).toBe(400);
    });

    it('defaults the category to Other and strips non-digits from the prefix', async () => {
      // The prefix is an IATA number and prints on every AWB, so a stray dash
      // or space must not survive.
      const res = await save({ name: TEST_PREFIX + 'Carrier A', prefix: ' 2-1 4 ' });
      expect(res.status).toBe(200);
      expect(res.body.result.prefix).toBe('214');
      expect(res.body.result.category).toBe('Other');
    });

    it('whitelists the category, because it decides a report column', async () => {
      const res = await save({ name: TEST_PREFIX + 'Carrier B', category: 'SOMETHING' });
      expect(res.status).toBe(400);
      expect(String(res.body.result)).toMatch(/GAM, IFA, Other/);
    });

    it.each(['GAM', 'IFA', 'Other'])('accepts category %s', async (category) => {
      const res = await save({ name: TEST_PREFIX + 'Carrier ' + category, category });
      expect(res.status).toBe(200);
      expect(res.body.result.category).toBe(category);
    });

    it("stores the pre-1.2.3 'ER' as GAM rather than refusing it", async () => {
      // A browser tab left open across the upgrade is still offering the old
      // spelling. Rejecting a value the application itself handed out is a bad
      // way to tell someone to reload - so it is translated on the way in and
      // the column ends up holding one spelling of the tag.
      const res = await save({ name: TEST_PREFIX + 'Carrier Legacy', category: 'ER' });
      expect(res.status).toBe(200);
      expect(res.body.result.category).toBe('GAM');
    });

    it('reads a carrier stored as ER back as GAM', async () => {
      // What the Setup screen would otherwise get is a tag its dropdown no
      // longer offers, which renders as an empty box and saves as a change
      // nobody made. Written straight to the table, because /carriers/save
      // translates it - this is the row an install has BEFORE the data script
      // in ifa-deploy/1.2.3-gam-reporting-tag.sql is run.
      const legacy = await Aviation_Carrier.create({
        name: TEST_PREFIX + 'Stored As ER', prefix: '559', category: 'ER', active: true,
      });
      const res = await auth(request(app).get('/aviationJob/carriers'));
      expect(res.status).toBe(200);
      const found = res.body.result.find((c) => c.id === legacy.id);
      expect(found.category).toBe('GAM');
    });

    it('refuses a prefix another carrier already uses', async () => {
      await save({ name: TEST_PREFIX + 'First', prefix: '777' });
      const res = await save({ name: TEST_PREFIX + 'Second', prefix: '777' });
      expect(res.status).toBe(409);
      // A sentence, not a Postgres unique-violation stack.
      expect(String(res.body.result)).toMatch(/already used by/);
    });

    it('lets a carrier keep its own prefix when edited', async () => {
      const first = await save({ name: TEST_PREFIX + 'Keeps', prefix: '888' });
      const res = await save({
        id: first.body.result.id, name: TEST_PREFIX + 'Keeps Renamed', prefix: '888',
      });
      expect(res.status).toBe(200);
      expect(res.body.result.name).toBe(TEST_PREFIX + 'Keeps Renamed');
    });

    it('allows several carriers with no prefix at all', async () => {
      // NULL is not a duplicate of NULL.
      expect((await save({ name: TEST_PREFIX + 'NoPrefix 1' })).status).toBe(200);
      expect((await save({ name: TEST_PREFIX + 'NoPrefix 2' })).status).toBe(200);
    });

    it('deletes an unused carrier', async () => {
      const made = await save({ name: TEST_PREFIX + 'Unused', prefix: '555' });
      const res = await del({ id: made.body.result.id });
      expect(res.status).toBe(200);
      expect(await Aviation_Carrier.findByPk(made.body.result.id)).toBeNull();
    });

    it('deactivates rather than deletes one a consignment still uses', async () => {
      // Deleting would strip the GAM/IFA/Other tag off historical AWBs and
      // silently change what past months report.
      const made = await save({ name: TEST_PREFIX + 'InUse', prefix: '556', category: 'GAM' });
      const carrierId = made.body.result.id;
      await createJob({
        consignments: [{ awb: 'TAGGED', grossWeight: 5, AviationCarrierId: carrierId }],
      });

      const res = await del({ id: carrierId });
      expect(res.status).toBe(200);
      expect(String(res.body.result)).toMatch(/deactivated/);
      const after = await Aviation_Carrier.findByPk(carrierId);
      expect(after).not.toBeNull();
      expect(after.active).toBe(false);
    });

    it('requires an id to delete', async () => {
      expect((await del({})).status).toBe(400);
    });
  });

  describe('aircraft master', () => {
    const save = (body) => auth(request(app).post('/aviationJob/aircraft/save')).send(body);
    const del = (body) => auth(request(app).post('/aviationJob/aircraft/delete')).send(body);

    it('deactivates rather than deletes one that has flown', async () => {
      // The report splits every sector by aircraft; deleting one would change
      // how past months group.
      const made = await save({ name: TEST_PREFIX + 'A330', maxPayload: 60000 });
      expect(made.status).toBe(200);
      const aircraftId = made.body.result.id;

      await createJob({ AviationAircraftId: aircraftId });

      const res = await del({ id: aircraftId });
      expect(res.status).toBe(200);
      expect(String(res.body.result)).toMatch(/deactivated/);
      expect((await Aviation_Aircraft.findByPk(aircraftId)).active).toBe(false);
    });

    it('deletes one that has never flown', async () => {
      const made = await save({ name: TEST_PREFIX + 'B737' });
      const res = await del({ id: made.body.result.id });
      expect(res.status).toBe(200);
      expect(await Aviation_Aircraft.findByPk(made.body.result.id)).toBeNull();
    });
  });

  describe('pick lists', () => {
    it('offers only what a flight actually uses', async () => {
      const res = await auth(request(app).get('/aviationJob/getValues'));
      expect(res.status).toBe(200);
      const keys = Object.keys(res.body.result);
      // The three roles an AWB names, plus the aviation masters. No vessels,
      // no shipping lines, no depots.
      expect(keys).toEqual(expect.arrayContaining([
        'party', 'shipper', 'consignee', 'masterAgent',
        'commodity', 'airport', 'aircraft', 'carrier', 'charge',
      ]));
      expect(keys).not.toContain('vessel');
    });

    it('describes a route by airport CODE, the way an air freight job does', async () => {
      const res = await auth(request(app).get('/aviationJob/getValues'));
      for (const a of res.body.result.airport.slice(0, 5)) {
        expect(typeof a.id).toBe('string');   // 'LHE', not 7
      }
    });
  });

  describe('charges on other legs of the same AWB', () => {
    it('finds the same AWB on a different flight', async () => {
      // A shipment too big for one aircraft goes out in parts, and the
      // customer expects one invoice covering the lot.
      const awb = 'SPLIT' + Date.now();
      const legA = await createJob({ consignments: [{ awb, grossWeight: 400 }] });
      const legB = await createJob({ consignments: [{ awb, grossWeight: 400 }] });

      const res = await auth(request(app).get('/aviationJob/relatedCharges'))
        .set('jobid', String(legB.body.result.id));
      expect(res.status).toBe(200);
      expect(res.body.result[awb]).toBeDefined();
      // The other leg, not this one.
      expect(res.body.result[awb].map((x) => x.jobId)).toEqual([legA.body.result.id]);
    });

    it('returns nothing without a flight, rather than everything', async () => {
      const res = await auth(request(app).get('/aviationJob/relatedCharges'));
      expect(res.body.result).toEqual({});
    });

    it('does not match blank AWBs to each other', async () => {
      const job = await createJob({ consignments: [{ grossWeight: 10 }] });
      const res = await auth(request(app).get('/aviationJob/relatedCharges'))
        .set('jobid', String(job.body.result.id));
      expect(res.body.result).toEqual({});
    });
  });
});

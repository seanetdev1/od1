/**
 * The audit trail of the Charges tab's Approve button - /invoice/approveHeads.
 *
 * Each press flips a charge line on or off. It is logged under form "Charges",
 * as the way the line went (Approve or Unapprove), with the job's number as
 * the Doc #. It used to be an "Invoice" "Approve/Unapprove" with a blank Doc #:
 * the route read a document number the screen never sent.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('charge approval in the audit log', () => {
  const stamp = Date.now();
  let admin; let job; let charge;

  // createHistory is not awaited by the route, so its row can land a moment
  // after the reply does.
  const entriesFor = async (jobNo, count) => {
    for (let i = 0; i < 40; i++) {
      const rows = await db.History.findAll({ where: { docNo: jobNo }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
      if (rows.length >= count) return rows;
      await new Promise((r) => setTimeout(r, 50));
    }
    return db.History.findAll({ where: { docNo: jobNo }, order: [['createdAt', 'ASC'], ['id', 'ASC']] });
  };
  const press = () => request(app).post('/invoice/approveHeads')
    .set('Authorization', admin.authHeader).send({ id: charge.id, employeeId: admin.employee.id });

  beforeAll(async () => {
    admin = await loginAs('admin');
    job = await db.SE_Job.create({ jobNo: `${TEST_PREFIX}CHA-${stamp}`, operation: 'SE' }, { fiscalYearCheck: false });
    charge = await db.Charge_Head.create({
      charge: `${TEST_PREFIX}OCEAN FREIGHT`, particular: 'OCEAN FREIGHT', type: 'Recievable', status: '0',
      SEJobId: job.id, qty: 1, rate_charge: '100', amount: '1', net_amount: '100', local_amount: '100',
    });
  });

  afterAll(async () => {
    await db.History.destroy({ where: { docNo: job.jobNo } });
    await db.Charge_Head.destroy({ where: { id: charge.id } });
    await db.SE_Job.destroy({ where: { id: job.id }, fiscalYearCheck: false });
  });

  it('logs Approve, then Unapprove, under Charges with the job number', async () => {
    expect((await press()).body.status).toBe('success');
    expect((await db.Charge_Head.findByPk(charge.id)).status).toBe('1');
    expect((await press()).body.status).toBe('success');
    expect((await db.Charge_Head.findByPk(charge.id)).status).toBe('0');

    const rows = await entriesFor(job.jobNo, 2);
    expect(rows.map((r) => [r.formName, r.type, r.docNo])).toEqual([
      ['Charges', 'Approve', job.jobNo],
      ['Charges', 'Unapprove', job.jobNo],
    ]);
    // None of the old shape.
    expect(await db.History.count({ where: { type: 'Approve/Unapprove', docNo: job.jobNo } })).toBe(0);
  });
});

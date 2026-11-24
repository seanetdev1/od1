const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* A LINE ON AN APPROVED INVOICE IS FROZEN when the freight charge sheet is
 * saved - /invoice/saveHeadesNew, functions/chargeRights approvedInvoiceLock.
 *
 * ACS-AE-728/27 (SNS, 2026-11-13): the sheet reloaded while ACS-JB-818/27's
 * approval was still posting and showed the bill unapproved. Its three lines
 * were removed and entered again, and went on two new bills; JB-818 stayed
 * approved with no lines, and Job P&L counted the cost twice. Replayed here
 * with the copy of the sheet the user had. */
describe('the freight sheet cannot change lines on an approved invoice', () => {
  const stamp = Date.now();
  let admin; let job; let bill; let billed; let loose;
  const made = { accounts: [], clients: [] };
  let vendor;

  const sheet = (rows, over = {}) => rows.map((r) => {
    const { Invoice, ...plain } = r.get({ plain: true });
    return { ...plain, ...over };
  });
  const save = (charges, deleteList = []) => request(app).post('/invoice/saveHeadesNew')
    .set('Authorization', admin.authHeader)
    .send({ id: job.id, exRate: '1', employeeId: admin.employee.id, deleteList, charges });
  const linesOnJob = () => db.Charge_Head.findAll({ where: { SEJobId: job.id }, order: [['id', 'ASC']] });
  const newLine = (particular) => ({
    charge: `${TEST_PREFIX}${particular}`, particular, type: 'Payble', status: '0', SEJobId: job.id,
    qty: 1, rate_charge: '100', amount: '1', net_amount: '100', local_amount: '100', currency: 'PKR', ex_rate: '1',
    partyId: String(vendor.client.id), name: vendor.client.name, partyType: 'vendor', invoiceType: 'Job Bill',
  });

  beforeAll(async () => {
    admin = await loginAs('admin');
    const account = await db.Child_Account.create({ title: `${TEST_PREFIX}LOCK VENDOR ${stamp}`, subCategory: 'Customer/Vendor' });
    const client = await db.Clients.create({ name: `${TEST_PREFIX}LOCK VENDOR ${stamp}`, code: `${TEST_PREFIX}LK${stamp % 100000}`, types: 'Vendor' });
    await db.Client_Associations.create({ ClientId: client.id, ChildAccountId: account.id });
    made.accounts.push(account.id);
    made.clients.push(client.id);
    vendor = { account, client };

    job = await db.SE_Job.create({ jobNo: `${TEST_PREFIX}LK-${stamp}`, operation: 'AE' }, { fiscalYearCheck: false });
    bill = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}JB-${stamp}`, type: 'Job Bill', payType: 'Payble', approved: '1', status: '1',
      party_Id: String(account.id), party_Name: client.name, partyType: 'vendor', SEJobId: job.id, currency: 'PKR', total: '200',
    }, { fiscalYearCheck: false });
    for (const particular of ['AIR FREIGHT', 'AWC']) {
      await db.Charge_Head.create({ ...newLine(particular), status: '1', InvoiceId: bill.id, invoice_id: bill.invoice_No });
    }
    await db.Charge_Head.create(newLine('LOOSE'));
    const lines = await db.Charge_Head.findAll({ where: { SEJobId: job.id }, include: [db.Invoice], order: [['id', 'ASC']] });
    billed = lines.filter((l) => l.InvoiceId);
    loose = lines.filter((l) => !l.InvoiceId);
  });

  afterAll(async () => {
    await db.Charge_Head.destroy({ where: { SEJobId: job.id } });
    await db.Invoice.destroy({ where: { id: bill.id }, fiscalYearCheck: false });
    await db.SE_Job.destroy({ where: { id: job.id }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { ClientId: made.clients } });
    await db.Clients.destroy({ where: { id: made.clients } });
    await db.Child_Account.destroy({ where: { id: made.accounts } });
  });

  it('removing them and entering them again is refused - and nothing is saved', async () => {
    const res = await save(
      [...sheet(loose), newLine('AIR FREIGHT'), newLine('AWC')],
      billed.map((l) => l.id),
    );
    expect(res.status).toBe(409);
    expect(res.body.result).toMatch(/^AIR FREIGHT and AWC are on .*JB-.*, which is approved, so they cannot be removed\. Un-approve it first/);
    const lines = await linesOnJob();
    expect(lines).toHaveLength(3);
    expect(lines.filter((l) => l.InvoiceId === bill.id)).toHaveLength(2);
  });

  it('a stale copy - off the bill, unapproved - leaves them on it, approved', async () => {
    const res = await save([...sheet(billed, { InvoiceId: null, invoice_id: null, status: '0' }), ...sheet(loose)]);
    expect(res.status).toBe(200);
    expect(res.body.warning).toBeUndefined();
    const onBill = (await linesOnJob()).filter((l) => l.InvoiceId === bill.id);
    expect(onBill).toHaveLength(2);
    expect(onBill.map((l) => l.status)).toEqual(['1', '1']);
  });

  it('a changed figure is not saved, and the save says why; the other lines still save', async () => {
    const res = await save([...sheet(billed, { rate_charge: '999' }), ...sheet(loose, { rate_charge: '150' })]);
    expect(res.status).toBe(200);
    expect(res.body.warning).toMatch(/JB-.* is approved, so the changes to those lines were not saved/);
    const lines = await linesOnJob();
    expect(lines.filter((l) => l.InvoiceId === bill.id).map((l) => l.rate_charge)).toEqual(['100', '100']);
    expect(lines.find((l) => l.id === loose[0].id).rate_charge).toBe('150');
  });

  it('a line on no invoice may still be removed', async () => {
    const res = await save(sheet(billed), [loose[0].id]);
    expect(res.status).toBe(200);
    const lines = await linesOnJob();
    expect(lines.map((l) => l.id)).toEqual(billed.map((l) => l.id));
  });

  it('once un-approved, the lines can be removed', async () => {
    await bill.update({ approved: '0' }, { fiscalYearCheck: false });
    const res = await save([], billed.map((l) => l.id));
    expect(res.status).toBe(200);
    expect(await linesOnJob()).toHaveLength(0);
  });
});

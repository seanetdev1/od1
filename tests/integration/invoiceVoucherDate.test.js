const request = require('supertest');
const app = require('../../index'); // wires every association the approval reads through
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { approveInvoice } = require('../../routes/invoice');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');

/* THE DATE AN APPROVED INVOICE STANDS ON IN THE LEDGER.
 *
 * The ledger places every line by Voucher_Heads.createdAt. Approval used to
 * leave it to default - the moment of approval - so an invoice raised on 31
 * August and approved in September showed in September. Customs raises every
 * invoice unapproved for the director, which makes that gap the normal case.
 * The CFO's ruling (2026-10-02): an SI or PI always stands on its invoice's
 * date. Run through the real approval and read back through the real ledger
 * route, so the date is checked where it is actually used. */
describe('the ledger date of an approved invoice', () => {
  const stamp = Date.now();
  const INVOICE_DATE = new Date('2026-08-31T00:00:00.000Z');
  const made = { accounts: [], clients: [] };
  let authHeader; let company; let fiscalYear; let employeeId; let job; let invoice; let partyAccount;

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
      made.fiscalYear = fiscalYear;
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Ledger Date Co ${stamp}`, short: 'TLD' });

    partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}PROLINE ${stamp}`, subCategory: 'Customer' });
    made.accounts.push(partyAccount);
    const INCOME = 'CLEARANCE INCOME - IMPORT';
    if (!(await db.Child_Account.findOne({ where: { title: INCOME } }))) {
      made.accounts.push(await db.Child_Account.create({ title: INCOME, subCategory: 'General' }));
    }

    const client = await db.Clients.create({ name: `${TEST_PREFIX}PROLINE ${stamp}` });
    made.clients.push(client);
    job = await Customs_Job.create({
      jobNo: `${TEST_PREFIX}TP-${stamp}`, direction: 'Import', clientId: client.id, companyId: String(company.id),
    });
    // Raised on 31 August - silent, so the date sticks as an invoice's does.
    invoice = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}CL-JI-${stamp}`, invoice_Id: 1, type: 'Job Invoice', payType: 'Recievable',
      operation: 'CC', status: '1', approved: '0', roundOff: '0', currency: 'PKR', ex_rate: '1',
      party_Id: String(partyAccount.id), party_Name: client.name, partyType: 'client',
      total: '12683', companyId: String(company.id), FiscalYearId: fiscalYear.id,
      createdAt: INVOICE_DATE, updatedAt: INVOICE_DATE,
    }, { fiscalYearCheck: false, silent: true });
    await db.Charge_Head.create({
      charge: `${TEST_PREFIX}Clearance Fee`, particular: 'CLEARANCE FEE', type: 'Recievable',
      partyId: client.id, partyType: 'client', qty: 1, rate_charge: '12683', amount: '1',
      net_amount: '12683', local_amount: '12683', ex_rate: '1', currency: 'PKR',
      InvoiceId: invoice.id, CustomsJobId: job.id,
    });

    // Approved "in September" - now, which is any day but the invoice's.
    await approveInvoice({ id: invoice.id, fiscalYearId: fiscalYear.id, employeeId });
  });

  afterAll(async () => {
    const vouchers = await db.Vouchers.findAll({ where: { invoice_Id: String(invoice.id) }, attributes: ['id'] });
    const voucherIds = vouchers.map((v) => v.id);
    if (voucherIds.length) {
      await db.Voucher_Heads.destroy({ where: { VoucherId: voucherIds } });
      await db.Vouchers.destroy({ where: { id: voucherIds }, fiscalYearCheck: false });
    }
    await db.Charge_Head.destroy({ where: { InvoiceId: invoice.id } });
    await db.Invoice.destroy({ where: { id: invoice.id }, fiscalYearCheck: false });
    await Customs_Job.destroy({ where: { id: job.id } });
    await db.Clients.destroy({ where: { id: made.clients.map((c) => c.id) } });
    await db.Child_Account.destroy({ where: { id: made.accounts.map((a) => a.id) } });
    await db.History.destroy({ where: { EmployeeId: employeeId } });
    await db.Company.destroy({ where: { id: company.id } });
    if (made.fiscalYear) await made.fiscalYear.destroy();
  });

  it('dates the voucher by the invoice, not the approval', async () => {
    const voucher = await db.Vouchers.findOne({ where: { invoice_Id: String(invoice.id) } });
    expect(voucher.vType).toBe('SI');
    expect(new Date(voucher.createdAt).toISOString()).toBe(INVOICE_DATE.toISOString());
    expect(voucher.tranDate).toBe(INVOICE_DATE.toISOString());
  });

  it('dates every line by the invoice - which is what the ledger reads', async () => {
    const voucher = await db.Vouchers.findOne({ where: { invoice_Id: String(invoice.id) } });
    const heads = await db.Voucher_Heads.findAll({ where: { VoucherId: voucher.id } });
    expect(heads.length).toBeGreaterThanOrEqual(2);
    for (const h of heads) expect(new Date(h.createdAt).toISOString()).toBe(INVOICE_DATE.toISOString());
  });

  it('shows in the party ledger for August', async () => {
    const res = await request(app)
      .get('/accounts/getLedger')
      .set('Authorization', authHeader)
      .set('id', String(partyAccount.id))
      .set('to', '31-08-2026')
      .set('currency', 'PKR')
      .set('company', String(company.id));

    expect(res.body.status).toBe('success');
    expect(res.body.result).toHaveLength(1);
    expect(res.body.result[0].type).toBe('debit');
    expect(Number(res.body.result[0].defaultAmount)).toBe(12683);
  });
});

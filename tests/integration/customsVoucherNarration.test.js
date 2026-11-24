require('../../index'); // wires every association the approval reads through
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { approveInvoice } = require('../../routes/invoice');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');

/* THE VOUCHER A CUSTOMS INVOICE POSTS, and what its narration says.
 *
 * functions/customsVoucherNarration is pinned on its own by the unit test.
 * This is the WIRING: that approval finds the declaration through the charge
 * lines, reads the shipper through the job, and puts the result on every head
 * of the voucher - run through the real approval, on a real transaction, so
 * the query that loads the job is the one production runs. */
describe('the voucher narration of an approved customs invoice', () => {
  const stamp = Date.now();
  const made = { accounts: [], clients: [] };
  let company; let fiscalYear; let employeeId; let job; let invoice;

  beforeAll(async () => {
    ({ employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
      made.fiscalYear = fiscalYear;
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Narration Co ${stamp}`, short: 'TNR' });

    // The party's ledger account - what an invoice raised here stores in
    // party_Id, and what the voucher's party head posts to.
    const partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}HAFIZ TANNERY ${stamp}`, subCategory: 'Customer' });
    made.accounts.push(partyAccount);
    // The income account the customs Import bucket posts to, found by its
    // seeded title when the database has one.
    const INCOME = 'CLEARANCE INCOME - IMPORT';
    if (!(await db.Child_Account.findOne({ where: { title: INCOME } }))) {
      made.accounts.push(await db.Child_Account.create({ title: INCOME, subCategory: 'General' }));
    }

    const client = await db.Clients.create({ name: `${TEST_PREFIX}HAFIZ TANNERY ${stamp}` });
    made.clients.push(client);
    // The job's shipper is someone else: the narration names the shipper, the
    // client it is billed to before it (the user, 2026-11-03).
    const shipper = await db.Clients.create({ name: `${TEST_PREFIX}SMART EXPORTS ${stamp}` });
    made.clients.push(shipper);
    job = await Customs_Job.create({
      jobNo: `${TEST_PREFIX}TP-${stamp}`, direction: 'Import', clientId: client.id, shipperId: shipper.id, companyId: String(company.id),
      invoiceNo: 'AMA-18792-26', formENo: 'FE-9921', gdNumber: '50712',
    });
    invoice = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}CL-JI-${stamp}`, invoice_Id: 1, type: 'Job Invoice', payType: 'Recievable',
      operation: 'CC', status: '1', approved: '0', roundOff: '0', currency: 'PKR', ex_rate: '1',
      party_Id: String(partyAccount.id), party_Name: `${client.name} (77)`, partyType: 'client',
      total: '5000', companyId: String(company.id), FiscalYearId: fiscalYear.id,
    }, { fiscalYearCheck: false });
    await db.Charge_Head.create({
      charge: `${TEST_PREFIX}Clearance Fee`, particular: 'CLEARANCE FEE', type: 'Recievable',
      partyId: client.id, partyType: 'client', qty: 1, rate_charge: '5000', amount: '1',
      net_amount: '5000', local_amount: '5000', ex_rate: '1', currency: 'PKR',
      InvoiceId: invoice.id, CustomsJobId: job.id,
    });
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

  it('names the party, the shipper, client invoice #, Form-E #, job #, invoice # and GD # on every head', async () => {
    await approveInvoice({ id: invoice.id, fiscalYearId: fiscalYear.id, employeeId });

    const voucher = await db.Vouchers.findOne({ where: { invoice_Id: String(invoice.id) } });
    expect(voucher).not.toBeNull();
    const heads = await db.Voucher_Heads.findAll({ where: { VoucherId: voucher.id } });
    expect(heads.length).toBeGreaterThanOrEqual(2);

    const expected = `Receivable from ${TEST_PREFIX}HAFIZ TANNERY ${stamp} (77) for ${TEST_PREFIX}SMART EXPORTS ${stamp}, `
      + 'Client Inv # AMA-18792-26, '
      + `Form-E # FE-9921, Against Job # ${job.jobNo}, Inv # ${invoice.invoice_No}, GD # 50712`;
    for (const h of heads) expect(h.narration).toBe(expected);
  });
});

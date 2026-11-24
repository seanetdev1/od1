require('../../index'); // wires every association the approval reads through
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { approveInvoice } = require('../../routes/invoice');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');

/* An invoice's party follows its charge lines on approval.
 *
 * Reported on CargoLinkers: the party was changed on every charge, the
 * invoice unapproved and approved again, and the header still named the old
 * party - and the voucher's party line, which posts to party_Id, went to the
 * OLD party's ledger. Run through the real approval on a real transaction. */
describe('approving an invoice whose charges were moved to another party', () => {
  const stamp = Date.now();
  const made = { accounts: [], clients: [], invoices: [], links: [] };
  let company; let fiscalYear; let employeeId; let job;
  let oldParty; let newParty; let oldAccount; let newAccount;

  const raise = async (lines) => {
    const invoice = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}PF-${stamp}-${made.invoices.length}`, invoice_Id: 1, type: 'Job Invoice',
      payType: 'Recievable', operation: 'CC', status: '1', approved: '0', roundOff: '0', currency: 'PKR',
      ex_rate: '1', party_Id: String(oldAccount.id), party_Name: oldParty.name, partyType: 'client',
      total: '5000', companyId: String(company.id), FiscalYearId: fiscalYear.id,
    }, { fiscalYearCheck: false });
    made.invoices.push(invoice);
    for (const partyId of lines) {
      await db.Charge_Head.create({
        charge: `${TEST_PREFIX}Fee`, particular: 'CLEARANCE FEE', type: 'Recievable',
        partyId, partyType: 'client', qty: 1, rate_charge: '2500', amount: '1',
        net_amount: '2500', local_amount: '2500', ex_rate: '1', currency: 'PKR',
        InvoiceId: invoice.id, CustomsJobId: job.id,
      });
    }
    return invoice;
  };

  beforeAll(async () => {
    ({ employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
      made.fiscalYear = fiscalYear;
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Party Co ${stamp}`, short: 'TPF' });
    const INCOME = 'CLEARANCE INCOME - IMPORT';
    if (!(await db.Child_Account.findOne({ where: { title: INCOME } }))) {
      made.accounts.push(await db.Child_Account.create({ title: INCOME, subCategory: 'General' }));
    }
    oldAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}OLD PARTY ${stamp}`, subCategory: 'Customer' });
    newAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}NEW PARTY ${stamp}`, subCategory: 'Customer' });
    made.accounts.push(oldAccount, newAccount);
    oldParty = await db.Clients.create({ name: `${TEST_PREFIX}OLD PARTY ${stamp}` });
    newParty = await db.Clients.create({ name: `${TEST_PREFIX}NEW PARTY ${stamp}` });
    made.clients.push(oldParty, newParty);
    made.links.push(
      await db.Client_Associations.create({ ClientId: oldParty.id, ChildAccountId: oldAccount.id }),
      await db.Client_Associations.create({ ClientId: newParty.id, ChildAccountId: newAccount.id }),
    );
    job = await Customs_Job.create({
      jobNo: `${TEST_PREFIX}TP-PF-${stamp}`, direction: 'Import', clientId: newParty.id, companyId: String(company.id),
    });
  });

  afterAll(async () => {
    const ids = made.invoices.map((i) => i.id);
    const vouchers = await db.Vouchers.findAll({ where: { invoice_Id: ids.map(String) }, attributes: ['id'] });
    if (vouchers.length) {
      await db.Voucher_Heads.destroy({ where: { VoucherId: vouchers.map((v) => v.id) } });
      await db.Vouchers.destroy({ where: { id: vouchers.map((v) => v.id) }, fiscalYearCheck: false });
    }
    await db.Sales_Tax_Invoice.destroy({ where: { InvoiceId: ids } });
    await db.Charge_Head.destroy({ where: { InvoiceId: ids } });
    await db.Invoice.destroy({ where: { id: ids }, fiscalYearCheck: false });
    await Customs_Job.destroy({ where: { id: job.id } });
    await db.Client_Associations.destroy({ where: { id: made.links.map((l) => l.id) } });
    await db.Clients.destroy({ where: { id: made.clients.map((c) => c.id) } });
    await db.Child_Account.destroy({ where: { id: made.accounts.map((a) => a.id) } });
    await db.History.destroy({ where: { EmployeeId: employeeId } });
    await db.Company.destroy({ where: { id: company.id } });
    if (made.fiscalYear) await made.fiscalYear.destroy();
  });

  it('moves the invoice, and posts the voucher, to the party its charges now name', async () => {
    const invoice = await raise([newParty.id, newParty.id]);
    await approveInvoice({ id: invoice.id, fiscalYearId: fiscalYear.id, employeeId });

    await invoice.reload();
    expect(invoice.party_Id).toBe(String(newAccount.id));
    expect(invoice.party_Name).toBe(newParty.name);

    const voucher = await db.Vouchers.findOne({ where: { invoice_Id: String(invoice.id) } });
    expect(voucher.partyName).toBe(newParty.name);
    const debit = await db.Voucher_Heads.findOne({ where: { VoucherId: voucher.id, type: 'debit' } });
    expect(debit.ChildAccountId).toBe(newAccount.id);
  });

  it('keeps its own party when the charges name more than one', async () => {
    const invoice = await raise([newParty.id, oldParty.id]);
    await approveInvoice({ id: invoice.id, fiscalYearId: fiscalYear.id, employeeId });

    await invoice.reload();
    expect(invoice.party_Id).toBe(String(oldAccount.id));
    expect(invoice.party_Name).toBe(oldParty.name);
  });
});

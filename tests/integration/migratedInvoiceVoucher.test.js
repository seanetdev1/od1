const request = require('supertest');
const app = require('../../index'); // wires every association the approval reads through
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');

/* A MIGRATED INVOICE, EDITED, STAYS IN THE LEDGER ONCE.
 *
 * Climax's voucher for an invoice carries no invoice_Id, so unapprove found
 * nothing to take out and approving after the edit posted a second voucher
 * beside it. Climax names the invoice in the voucher's lines ("Inv # ..."),
 * and that is how it is found now - see functions/invoiceVoucher. */
describe('the voucher of an invoice migrated from Climax', () => {
  const stamp = Date.now();
  const made = { accounts: [], vouchers: [], invoices: [] };
  let authHeader; let employeeId; let company; let fiscalYear; let client; let job; let partyAccount;

  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYear.id));

  /** A migrated invoice, approved in Climax, with its one charge. */
  const migratedInvoice = async (suffix, over = {}) => {
    const inv = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}JI-${stamp}${suffix}/27`, invoice_Id: 1, type: 'Job Invoice', payType: 'Recievable',
      operation: 'CC', status: '1', approved: '1', roundOff: '0', currency: 'PKR', ex_rate: '1',
      party_Id: String(partyAccount.id), party_Name: client.name, partyType: 'client',
      total: '5000', companyId: String(company.id), FiscalYearId: fiscalYear.id,
      climaxId: String(800000 + made.invoices.length), ...over,
    }, { fiscalYearCheck: false });
    made.invoices.push(inv);
    await db.Charge_Head.create({
      charge: `${TEST_PREFIX}Clearance Fee`, particular: 'CLEARANCE FEE', type: 'Recievable',
      partyId: client.id, partyType: 'client', qty: 1, rate_charge: '5000', amount: '1',
      net_amount: '5000', local_amount: '5000', ex_rate: '1', currency: 'PKR', status: '1',
      InvoiceId: inv.id, CustomsJobId: job.id,
    });
    return inv;
  };

  /** A voucher as the ledger migration wrote one: climaxId, no invoice_Id. */
  const climaxVoucher = async (vType, narration) => {
    const v = await db.Vouchers.create({
      voucher_No: 1, voucher_Id: `${TEST_PREFIX}${vType}-${stamp}-${made.vouchers.length}`,
      type: 'Job Recievable', vType, CompanyId: company.id, FiscalYearId: fiscalYear.id,
      climaxId: 900000 + made.vouchers.length,
    }, { fiscalYearCheck: false });
    made.vouchers.push(v);
    await db.Voucher_Heads.bulkCreate([
      { amount: '5000', defaultAmount: '5000', type: 'debit', VoucherId: v.id, ChildAccountId: partyAccount.id, narration },
      { amount: '5000', defaultAmount: '5000', type: 'credit', VoucherId: v.id, ChildAccountId: partyAccount.id, narration },
    ]);
    return v;
  };
  const narrationFor = (inv) => `Receivable Against Job # TP-1/27 Consignee X HBL # MBL # LC # Inv # ${inv.invoice_No} Job Ref # 1`;
  const exists = async (v) => (await db.Vouchers.count({ where: { id: v.id } })) === 1;
  const postedFor = (inv) => db.Vouchers.findAll({ where: { invoice_Id: String(inv.id) } });

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
      made.fiscalYear = fiscalYear;
    }
    company = await db.Company.create({ title: `${TEST_PREFIX}Migrated Inv Co ${stamp}`, short: 'TMI' });
    partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}MIGRATED PARTY ${stamp}`, subCategory: 'Customer' });
    made.accounts.push(partyAccount);
    const INCOME = 'CLEARANCE INCOME - IMPORT';
    if (!(await db.Child_Account.findOne({ where: { title: INCOME } }))) {
      made.accounts.push(await db.Child_Account.create({ title: INCOME, subCategory: 'General' }));
    }
    client = await db.Clients.create({ name: `${TEST_PREFIX}MIGRATED PARTY ${stamp}` });
    job = await Customs_Job.create({
      jobNo: `${TEST_PREFIX}TP-${stamp}`, direction: 'Import', clientId: client.id, companyId: String(company.id),
    });
  });

  afterAll(async () => {
    const ids = [
      ...made.vouchers.map((v) => v.id),
      ...(await db.Vouchers.findAll({ where: { invoice_Id: made.invoices.map((i) => String(i.id)) } })).map((v) => v.id),
    ];
    if (ids.length) {
      await db.Voucher_Heads.destroy({ where: { VoucherId: ids } });
      await db.Vouchers.destroy({ where: { id: ids }, fiscalYearCheck: false });
    }
    const invoiceIds = made.invoices.map((i) => i.id);
    await db.Charge_Head.destroy({ where: { InvoiceId: invoiceIds } });
    await db.Sales_Tax_Invoice?.destroy({ where: { InvoiceId: invoiceIds } }).catch(() => {});
    await db.Invoice.destroy({ where: { id: invoiceIds }, fiscalYearCheck: false });
    await Customs_Job.destroy({ where: { id: job.id } });
    await db.Clients.destroy({ where: { id: client.id } });
    await db.Child_Account.destroy({ where: { id: made.accounts.map((a) => a.id) } });
    await db.Company.destroy({ where: { id: company.id } });
    if (made.fiscalYear) await made.fiscalYear.destroy();
  });

  it('unapprove takes the Climax voucher out, and nothing that only resembles it', async () => {
    const inv = await migratedInvoice('1');
    const own = await climaxVoucher('SI', narrationFor(inv));
    const longerNumber = await climaxVoucher('SI', narrationFor({ invoice_No: inv.invoice_No.replace('/27', '0/27') }));
    const receipt = await climaxVoucher('BRV', `Received against Inv # ${inv.invoice_No} Job Ref # 1`);

    const res = await auth(request(app).post('/invoice/unApprove')).send({ id: inv.id, employeeId });
    expect(res.body.status).toBe('success');
    expect(res.body.voucherRemoved).toBe(true);

    expect(await exists(own)).toBe(false);
    expect(await db.Voucher_Heads.count({ where: { VoucherId: own.id } })).toBe(0);
    expect(await exists(longerNumber)).toBe(true);
    expect(await exists(receipt)).toBe(true);
  });

  it('approving it again after the edit leaves ONE voucher for it in the ledger', async () => {
    const inv = await migratedInvoice('2');
    const own = await climaxVoucher('SI', narrationFor(inv));

    await auth(request(app).post('/invoice/unApprove')).send({ id: inv.id, employeeId });
    const res = await auth(request(app).post('/invoice/approve')).send({ id: inv.id, fiscalYearId: fiscalYear.id, employeeId });
    expect(res.body.status).toBe('success');

    expect(await exists(own)).toBe(false);
    expect(await postedFor(inv)).toHaveLength(1);
  });

  it('an invoice unapproved before this fix, its Climax voucher still in, is replaced on approval - not doubled', async () => {
    const inv = await migratedInvoice('3', { approved: '0' });
    const own = await climaxVoucher('SI', narrationFor(inv));

    const res = await auth(request(app).post('/invoice/approve')).send({ id: inv.id, fiscalYearId: fiscalYear.id, employeeId });
    expect(res.body.status).toBe('success');

    expect(await exists(own)).toBe(false);
    expect(await postedFor(inv)).toHaveLength(1);
  });

  it('an invoice raised in Odyssey never touches a Climax voucher, whatever it names', async () => {
    const inv = await migratedInvoice('4', { climaxId: null });
    const look = await climaxVoucher('SI', narrationFor(inv));

    const res = await auth(request(app).post('/invoice/unApprove')).send({ id: inv.id, employeeId });
    expect(res.body.status).toBe('success');
    expect(await exists(look)).toBe(true);
  });

  it('a payable finds its PI, by "Bill #"', async () => {
    const inv = await migratedInvoice('5', { payType: 'Payble', type: 'Job Bill', invoice_No: `${TEST_PREFIX}JB-${stamp}5/27` });
    const own = await climaxVoucher('PI', `Payable Against Job # TP-1/27 Consignee X LC # Bill # ${inv.invoice_No} Job Ref # 1`);

    const res = await auth(request(app).post('/invoice/unApprove')).send({ id: inv.id, employeeId });
    expect(res.body.status).toBe('success');
    expect(await exists(own)).toBe(false);
  });
});

const request = require('supertest');
const moment = require('moment');
const app = require('../../index'); // wires every association the approval reads through
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { approveInvoice } = require('../../routes/invoice');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');

/* CHANGING AN INVOICE'S DATE moves its SI / PI voucher with it - the CFO's
 * ruling: an SI or PI stands on its invoice's date. And the vendor's tax
 * invoice number, entered on a bill after it was raised. */
describe('an invoice\'s date, and the vendor\'s tax invoice number', () => {
  const stamp = Date.now();
  const made = { accounts: [], invoices: [], vouchers: [] };
  let authHeader; let employeeId; let fiscalYear; let company; let client; let job; let partyAccount;
  let inside; let before;

  const auth = (req) => req.set('Authorization', authHeader).set('x-fiscal-year-id', String(fiscalYear.id));
  const changeDate = (id, date) => auth(request(app).post('/invoice/changeDate')).send({ id, date, employeeId });
  const day = (v) => moment(v).utc().format('YYYY-MM-DD');

  const invoice = async (over = {}) => {
    const inv = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}JI-${stamp}-${made.invoices.length}/27`, invoice_Id: 1, type: 'Job Invoice',
      payType: 'Recievable', operation: 'CC', status: '1', approved: '0', roundOff: '0', currency: 'PKR', ex_rate: '1',
      party_Id: String(partyAccount.id), party_Name: client.name, partyType: 'client', total: '5000',
      companyId: String(company.id), FiscalYearId: fiscalYear.id, ...over,
    }, { fiscalYearCheck: false });
    made.invoices.push(inv);
    await db.Charge_Head.create({
      charge: `${TEST_PREFIX}Fee`, particular: 'CLEARANCE FEE', type: 'Recievable', partyId: client.id, partyType: 'client',
      qty: 1, rate_charge: '5000', amount: '1', net_amount: '5000', local_amount: '5000', ex_rate: '1', currency: 'PKR',
      status: '1', InvoiceId: inv.id, CustomsJobId: job.id,
    });
    return inv;
  };
  const ledgerDays = async (voucherId) => {
    const v = await db.Vouchers.findByPk(voucherId);
    const heads = await db.Voucher_Heads.findAll({ where: { VoucherId: voucherId } });
    return { voucher: day(v.createdAt), tranDate: day(v.tranDate), heads: [...new Set(heads.map((h) => day(h.createdAt)))] };
  };

  beforeAll(async () => {
    ({ authHeader, employee: { id: employeeId } = {} } = await loginAs('admin'));
    fiscalYear = await db.FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
    if (!fiscalYear) {
      fiscalYear = await db.FiscalYears.create({
        label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false,
      });
      made.fiscalYear = fiscalYear;
    }
    inside = moment(fiscalYear.startDate).add(9, 'days').format('YYYY-MM-DD');
    before = moment(fiscalYear.startDate).subtract(1, 'day').format('YYYY-MM-DD');
    company = await db.Company.create({ title: `${TEST_PREFIX}Date Co ${stamp}`, short: 'TDC' });
    partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}DATE PARTY ${stamp}`, subCategory: 'Customer' });
    made.accounts.push(partyAccount);
    const INCOME = 'CLEARANCE INCOME - IMPORT';
    if (!(await db.Child_Account.findOne({ where: { title: INCOME } }))) {
      made.accounts.push(await db.Child_Account.create({ title: INCOME, subCategory: 'General' }));
    }
    client = await db.Clients.create({ name: `${TEST_PREFIX}DATE PARTY ${stamp}` });
    job = await Customs_Job.create({ jobNo: `${TEST_PREFIX}TP-${stamp}`, direction: 'Import', clientId: client.id, companyId: String(company.id) });
  });

  afterAll(async () => {
    const ids = made.invoices.map((i) => i.id);
    const vouchers = await db.Vouchers.findAll({ where: { invoice_Id: ids.map(String) }, attributes: ['id'] });
    const voucherIds = [...vouchers.map((v) => v.id), ...made.vouchers.map((v) => v.id)];
    if (voucherIds.length) {
      await db.Voucher_Heads.destroy({ where: { VoucherId: voucherIds } });
      await db.Vouchers.destroy({ where: { id: voucherIds }, fiscalYearCheck: false });
    }
    await db.Charge_Head.destroy({ where: { InvoiceId: ids } });
    await db.Invoice.destroy({ where: { id: ids }, fiscalYearCheck: false });
    await Customs_Job.destroy({ where: { id: job.id } });
    await db.Clients.destroy({ where: { id: client.id } });
    await db.Child_Account.destroy({ where: { id: made.accounts.map((a) => a.id) } });
    await db.Company.destroy({ where: { id: company.id } });
    if (made.fiscalYear) await made.fiscalYear.destroy();
  });

  it('moves an approved invoice and its SI voucher - the voucher and every line', async () => {
    const inv = await invoice();
    await approveInvoice({ id: inv.id, fiscalYearId: fiscalYear.id, employeeId });
    const voucher = await db.Vouchers.findOne({ where: { invoice_Id: String(inv.id) } });

    const res = await changeDate(inv.id, inside);
    expect(res.body.status).toBe('success');
    expect(res.body.vouchersMoved).toBe(1);
    expect(day(res.body.invoice.createdAt)).toBe(inside);
    expect(await ledgerDays(voucher.id)).toEqual({ voucher: inside, tranDate: inside, heads: [inside] });
  });

  it('moves a migrated invoice\'s Climax voucher too, found by the number it names', async () => {
    const inv = await invoice({ approved: '1', climaxId: String(700000 + (stamp % 1000)) });
    const v = await db.Vouchers.create({
      voucher_No: 1, voucher_Id: `${TEST_PREFIX}SI-${stamp}`, type: 'Job Recievable', vType: 'SI',
      CompanyId: company.id, FiscalYearId: fiscalYear.id, climaxId: 990000 + (stamp % 1000),
      tranDate: '2026-07-02T00:00:00.000Z',
    }, { fiscalYearCheck: false });
    made.vouchers.push(v);
    const narration = `Receivable Against Job # TP-1/27 Inv # ${inv.invoice_No} Job Ref # 1`;
    await db.Voucher_Heads.bulkCreate([
      { amount: '5000', defaultAmount: '5000', type: 'debit', VoucherId: v.id, ChildAccountId: partyAccount.id, narration },
      { amount: '5000', defaultAmount: '5000', type: 'credit', VoucherId: v.id, ChildAccountId: partyAccount.id, narration },
    ]);

    const res = await changeDate(inv.id, inside);
    expect(res.body.status).toBe('success');
    expect(await ledgerDays(v.id)).toEqual({ voucher: inside, tranDate: inside, heads: [inside] });
  });

  it('moves an unapproved invoice on its own - it has no voucher yet', async () => {
    const inv = await invoice();
    const res = await changeDate(inv.id, inside);
    expect(res.body.status).toBe('success');
    expect(res.body.vouchersMoved).toBe(0);
    expect(day((await db.Invoice.findByPk(inv.id)).createdAt)).toBe(inside);
  });

  it('refuses a date outside the invoice\'s fiscal year, and changes nothing', async () => {
    const inv = await invoice();
    const was = (await db.Invoice.findByPk(inv.id)).createdAt;
    const res = await changeDate(inv.id, before);
    expect(res.status).toBe(400);
    expect(res.body.result).toMatch(/belongs to fiscal year .* Pick a date inside it/);
    expect(new Date((await db.Invoice.findByPk(inv.id)).createdAt).getTime()).toBe(new Date(was).getTime());
  });

  it('refuses something that is not a date', async () => {
    const inv = await invoice();
    for (const bad of ['', '31-02-2026', 'yesterday']) {
      expect((await changeDate(inv.id, bad)).status).toBe(400);
    }
  });

  it('saves the vendor\'s tax invoice number with the note, and leaves it when not sent', async () => {
    const bill = await invoice({ type: 'Job Bill', payType: 'Payble' });
    const save = (body) => auth(request(app).post('/invoice/addInvoiceNote')).send({ id: bill.id, currency: 'PKR', total: '5000', employeeId, ...body });

    await save({ note: 'n', vendorTaxInvoiceNo: '  STX-2026-0451 ' });
    expect((await db.Invoice.findByPk(bill.id)).vendorTaxInvoiceNo).toBe('STX-2026-0451');

    await save({ note: 'edited' }); // a screen that does not send it
    const after = await db.Invoice.findByPk(bill.id);
    expect(after.note).toBe('edited');
    expect(after.vendorTaxInvoiceNo).toBe('STX-2026-0451');

    await save({ note: 'edited', vendorTaxInvoiceNo: '' });
    expect((await db.Invoice.findByPk(bill.id)).vendorTaxInvoiceNo).toBeNull();
  });
});

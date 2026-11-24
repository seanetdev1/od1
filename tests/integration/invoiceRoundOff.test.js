const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyFiscalYear } = require('../helpers/fiscalYear');
const db = require('../../models');
const { Customs_Job } = require('../../functions/Associations/customsAssociations');

/* ROUND OFF - see functions/invoiceRoundOff.
 *
 * Worked out at approval from the total being posted: for a ticked invoice
 * (its stored figure was for whatever the total was when the box was ticked),
 * and for every invoice in rupees when Configuration > Invoices says so. The
 * voucher carries the rounded total on the party line and balances. */
describe('invoice round off', () => {
  const stamp = Date.now();
  const made = { accounts: [], invoices: [] };
  const KEY = 'autoRoundOff';
  let admin; let employee; let company; let fiscalYear; let client; let job; let partyAccount; let before;

  const auth = (req, who = admin) => req.set('Authorization', who.authHeader).set('x-fiscal-year-id', String(fiscalYear.id));
  const setAuto = (auto, who = admin) => auth(request(app).post('/settings/invoiceRoundOff'), who).send({ auto });

  /** An unapproved invoice in rupees with one charge of `amount`. */
  const invoiceOf = async (amount, over = {}, chargeType = 'Recievable') => {
    const inv = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}RO-${stamp}-${made.invoices.length}/27`, type: 'Job Invoice', payType: 'Recievable',
      operation: 'CC', status: '1', approved: '0', roundOff: '0', currency: 'PKR', ex_rate: '1',
      party_Id: String(partyAccount.id), party_Name: client.name, partyType: 'client',
      total: '0', companyId: String(company.id), FiscalYearId: fiscalYear.id, ...over,
    }, { fiscalYearCheck: false });
    made.invoices.push(inv);
    await db.Charge_Head.create({
      charge: `${TEST_PREFIX}Clearance Fee`, particular: 'CLEARANCE FEE', type: chargeType,
      partyId: client.id, partyType: 'client', qty: 1, rate_charge: String(amount), amount: '1',
      net_amount: String(amount), local_amount: String(amount), ex_rate: '1', currency: 'PKR', status: '1',
      InvoiceId: inv.id, CustomsJobId: job.id,
    });
    return inv;
  };
  const approve = (inv) => auth(request(app).post('/invoice/approve')).send({ id: inv.id, fiscalYearId: fiscalYear.id, employeeId: admin.employee.id });
  const linesOf = async (inv) => {
    const v = await db.Vouchers.findOne({ where: { invoice_Id: String(inv.id) } });
    const heads = await db.Voucher_Heads.findAll({ where: { VoucherId: v.id } });
    const sum = (type, col = 'amount') => Math.round(heads.filter((h) => h.type === type).reduce((t, h) => t + Number(h[col]), 0) * 100) / 100;
    const party = heads.find((h) => String(h.ChildAccountId) === String(partyAccount.id));
    /* And in RUPEES - defaultAmount, which the ledger and the trial balance
     * read. Approval rounded `amount` only (2026-10-22), and these tests
     * summed `amount` only, so the books were wrong and nothing here said so. */
    return {
      debits: sum('debit'), credits: sum('credit'), party: Number(party.amount),
      rupees: { debits: sum('debit', 'defaultAmount'), credits: sum('credit', 'defaultAmount'), party: Number(party.defaultAmount) },
      heads,
    };
  };
  const stored = async (inv) => (await db.Invoice.findByPk(inv.id)).roundOff;

  beforeAll(async () => {
    admin = await loginAs('admin');
    employee = await loginAs('employee');
    fiscalYear = await anyFiscalYear();
    before = (await db.AppSetting.findOne({ where: { key: KEY } }))?.value ?? null;
    company = await db.Company.create({ title: `${TEST_PREFIX}Round Off Co ${stamp}`, short: 'TRO' });
    // NOT company 4: the reports read '4' as the legacy "companies 1 and 3"
    // (companyAccess.reportCompanies), so on a fresh database where this one
    // came out as 4, its agent invoices vanished from Agent Balancing
    // (2026-10-26). That one goes, and another is made - ids are not reused.
    if (String(company.id) === '4') {
      await company.destroy();
      company = await db.Company.create({ title: `${TEST_PREFIX}Round Off Co ${stamp}`, short: 'TRO' });
    }
    partyAccount = await db.Child_Account.create({ title: `${TEST_PREFIX}ROUND OFF PARTY ${stamp}`, subCategory: 'Customer' });
    made.accounts.push(partyAccount);
    for (const title of ['CLEARANCE INCOME - IMPORT', 'CLEARANCE EXPENSE - IMPORT']) {
      if (!(await db.Child_Account.findOne({ where: { title } }))) {
        made.accounts.push(await db.Child_Account.create({ title, subCategory: 'General' }));
      }
    }
    client = await db.Clients.create({ name: `${TEST_PREFIX}ROUND OFF PARTY ${stamp}` });
    job = await Customs_Job.create({
      jobNo: `${TEST_PREFIX}RO-${stamp}`, direction: 'Import', clientId: client.id, companyId: String(company.id),
    });
  });

  afterEach(async () => {
    await db.AppSetting.destroy({ where: { key: KEY } });
  });

  afterAll(async () => {
    const ids = (await db.Vouchers.findAll({ where: { invoice_Id: made.invoices.map((i) => String(i.id)) } })).map((v) => v.id);
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
    await db.AppSetting.destroy({ where: { key: KEY } });
    if (before != null) await db.AppSetting.create({ key: KEY, value: before });
  });

  it('the setting is off until an admin turns it on', async () => {
    expect((await auth(request(app).get('/settings/invoiceRoundOff'), employee)).body.result).toEqual({ auto: false });
    expect((await setAuto(true)).body.result).toEqual({ auto: true });
    expect((await auth(request(app).get('/settings/invoiceRoundOff'), employee)).body.result).toEqual({ auto: true });
    expect((await setAuto('yes')).status).toBe(400);
    expect((await setAuto(false, employee)).status).toBe(403);
  });

  it('Hide Sign Line and Hide Tax Column by default: off until an admin turns them on', async () => {
    const KEYS = ['invoiceHideSignLine', 'invoiceHideTax', 'invoiceHideBankDetails', 'invoiceContainerNosInNote', 'invoiceSignDisclaimer'];
    // Essani's three (2026-11-14) ride along, unset: nothing hidden, no disclaimer.
    const NONE = { hideBankDetails: false, containerNosInNote: false, signDisclaimer: '' };
    const kept = await db.AppSetting.findAll({ where: { key: KEYS }, raw: true });
    await db.AppSetting.destroy({ where: { key: KEYS } });
    try {
      const read = () => auth(request(app).get('/settings/invoicePrint'), employee);
      expect((await read()).body.result).toEqual({ hideSignLine: false, hideTax: false, ...NONE });
      const save = (body, who = admin) => auth(request(app).post('/settings/invoicePrint'), who).send(body);
      expect((await save({ hideSignLine: true })).body.result).toEqual({ hideSignLine: true, hideTax: false, ...NONE });
      // One at a time - saving one leaves the other as it was.
      expect((await save({ hideTax: true })).body.result).toEqual({ hideSignLine: true, hideTax: true, ...NONE });
      expect((await save({ hideSignLine: false })).body.result).toEqual({ hideSignLine: false, hideTax: true, ...NONE });
      expect((await read()).body.result).toEqual({ hideSignLine: false, hideTax: true, ...NONE });
      expect((await save({ hideSignLine: 'yes' })).status).toBe(400);
      expect((await save({ hideTax: 1 })).status).toBe(400);
      expect((await save({})).status).toBe(400);
      expect((await save({ hideTax: false }, employee)).status).toBe(403);
    } finally {
      await db.AppSetting.destroy({ where: { key: KEYS } });
      for (const row of kept) await db.AppSetting.create({ key: row.key, value: row.value });
    }
  });

  // Essani (2026-11-14): Hide Bank Details by default, container numbers in
  // the Note box, and a disclaimer where the sign line was - read by every
  // user, and sent with the invoice so the emailed PDF prints them too.
  it('Hide Bank Details, Container Nos and the disclaimer: saved by an admin, sent with the invoice', async () => {
    const KEYS = ['invoiceHideBankDetails', 'invoiceContainerNosInNote', 'invoiceSignDisclaimer'];
    const kept = await db.AppSetting.findAll({ where: { key: KEYS }, raw: true });
    await db.AppSetting.destroy({ where: { key: KEYS } });
    try {
      const save = (body, who = admin) => auth(request(app).post('/settings/invoicePrint'), who).send(body);
      const saved = await save({ hideBankDetails: true, containerNosInNote: true, signDisclaimer: '  Computer generated - no signature needed.  ' });
      expect(saved.body.result).toMatchObject({
        hideBankDetails: true, containerNosInNote: true, signDisclaimer: 'Computer generated - no signature needed.',
      });
      expect((await save({ signDisclaimer: 5 })).status).toBe(400);
      expect((await save({ signDisclaimer: 'x'.repeat(501) })).status).toBe(400);
      expect((await save({ signDisclaimer: 'Nope' }, employee)).status).toBe(403);

      const inv = await invoiceOf(1000);
      const read = await auth(request(app).get('/invoice/getInvoiceById'), employee).set('invoiceid', String(inv.id));
      expect(read.body.result.resultOne.printSettings).toEqual({
        referenceLabel: expect.any(String),
        containerNosInNote: true,
        signDisclaimer: 'Computer generated - no signature needed.',
      });
    } finally {
      await db.AppSetting.destroy({ where: { key: KEYS } });
      for (const row of kept) await db.AppSetting.create({ key: row.key, value: row.value });
    }
  });

  it('approving sends the GST number back with the invoice, and unapproving keeps it', async () => {
    // The screen spreads the returned row over its own copy; before this it
    // came back without the number approval had just issued, and both prints
    // showed GST Invoice # blank until the invoice was opened again.
    const inv = await invoiceOf(2500);
    await db.Charge_Head.update({ tax_apply: true, taxPerc: 15, tax_amount: '375' }, { where: { InvoiceId: inv.id } });
    const approved = await approve(inv);
    expect(approved.body.status).toBe('success');
    const issued = approved.body.invoice.Sales_Tax_Invoice?.taxInvoiceNo;
    expect(issued).toMatch(/^TRO-\d+$/);

    const undone = await auth(request(app).post('/invoice/unApprove')).send({ id: inv.id, employeeId: admin.employee.id });
    expect(undone.body.status).toBe('success');
    expect(undone.body.invoice.Sales_Tax_Invoice.taxInvoiceNo).toBe(issued);
  });

  it('an invoice with no taxed line comes back with no GST number', async () => {
    const inv = await invoiceOf(1000);
    const approved = await approve(inv);
    expect(approved.body.status).toBe('success');
    expect(approved.body.invoice.Sales_Tax_Invoice).toBeNull();
  });

  it('approving again after a charge rate was corrected moves the invoice to the new rate', async () => {
    // Raised at 280, unapproved, the line corrected to 285: the header, the
    // print and the approval voucher all have to say 285.
    const inv = await invoiceOf(100, { type: 'Agent Invoice', currency: 'USD', ex_rate: '280', partyType: 'agent' });
    await db.Charge_Head.update(
      { currency: 'USD', ex_rate: '285', net_amount: '100', local_amount: '28500', partyType: 'agent' },
      { where: { InvoiceId: inv.id } },
    );
    const approved = await approve(inv);
    expect(approved.body.status).toBe('success');
    expect(approved.body.invoice.ex_rate).toBe('285');
    const voucher = await db.Vouchers.findOne({ where: { invoice_Id: String(inv.id) } });
    expect(Number(voucher.exRate)).toBe(285);
  });

  it('a rupee invoice at rate 1 stays at 1 whatever its lines say', async () => {
    const inv = await invoiceOf(1000);
    await db.Charge_Head.update({ ex_rate: '285' }, { where: { InvoiceId: inv.id } });
    expect((await approve(inv)).body.invoice.ex_rate).toBe('1');
  });

  it('the agent balancing report lists by date, oldest first, whatever order they were stored in', async () => {
    const newer = await invoiceOf(100, { type: 'Agent Invoice', currency: 'USD', ex_rate: '280', partyType: 'agent' });
    const older = await invoiceOf(100, { type: 'Agent Invoice', currency: 'USD', ex_rate: '280', partyType: 'agent' });
    // Stored newer first, as a migrated book often is.
    const dated = (inv, d) => db.sequelize.query('UPDATE "Invoices" SET "createdAt" = :d WHERE id = :id', { replacements: { d, id: inv.id } });
    await dated(newer, '2026-09-15T10:00:00Z');
    await dated(older, '2022-03-10T10:00:00Z');
    const res = await auth(request(app).get('/invoice/invoiceBalancing'))
      .set('from', '2022-01-01').set('to', '2026-12-31').set('paytype', 'All').set('currency', 'ALL')
      .set('company', String(company.id));
    expect(res.body.status).toBe('success');
    const ids = res.body.result.map((r) => r.id).filter((id) => [newer.id, older.id].includes(id));
    expect(ids).toEqual([older.id, newer.id]);
  });

  it('off, and the box not ticked: posted as it is', async () => {
    const inv = await invoiceOf(1234.56);
    expect((await approve(inv)).body.status).toBe('success');
    expect(await stored(inv)).toBe('0');
    const v = await linesOf(inv);
    expect(v.party).toBe(1234.56);
    expect(v.debits).toBe(v.credits);
    expect(v.rupees).toEqual({ debits: 1234.56, credits: 1234.56, party: 1234.56 });
  });

  it('ticked for an older total: rounded from the total approved', async () => {
    // Ticked when the total was 1,250.70; a rate was corrected since.
    const inv = await invoiceOf(1234.56, { roundOff: '+0.30' });
    expect((await approve(inv)).body.status).toBe('success');
    expect(await stored(inv)).toBe('+0.44');
    const v = await linesOf(inv);
    expect(v.party).toBe(1235);
    expect(v.debits).toBe(1235);
    expect(v.credits).toBe(1235);
    // In rupees too - it posted 1,234.56 here, unrounded.
    expect(v.rupees).toEqual({ debits: 1235, credits: 1235, party: 1235 });
  });

  it('on: every invoice in rupees is rounded - down half a rupee or less', async () => {
    await setAuto(true);
    const inv = await invoiceOf(1234.4);
    expect((await approve(inv)).body.status).toBe('success');
    expect(await stored(inv)).toBe('-0.40');
    const v = await linesOf(inv);
    expect(v.party).toBe(1234);
    // The 0.40 rounded away is an expense line; the voucher still balances.
    expect(v.heads.some((h) => Number(h.amount) === 0.4 && h.type === 'debit')).toBe(true);
    expect(v.debits).toBe(v.credits);
    // In rupees: the 0.40 line is 0.40, not the whole 1,234.40, and income
    // carries the total - it had no rupee amount at all.
    expect(v.heads.find((h) => Number(h.amount) === 0.4).defaultAmount).toBe('0.4');
    expect(v.rupees).toEqual({ debits: 1234.4, credits: 1234.4, party: 1234 });
  });

  it('a bill rounded down: the party is owed the rounded total, the difference is income', async () => {
    await setAuto(true);
    const bill = await invoiceOf(800.3, { type: 'Job Bill', payType: 'Payble' }, 'Payble');
    expect((await approve(bill)).body.status).toBe('success');
    expect(await stored(bill)).toBe('-0.30');
    const v = await linesOf(bill);
    expect(v.party).toBe(800);
    expect(v.heads.find((h) => Number(h.amount) === 0.3)).toMatchObject({ type: 'credit', defaultAmount: '0.3' });
    expect(v.rupees).toEqual({ debits: 800.3, credits: 800.3, party: 800 });
  });

  it('on: a whole total needs none', async () => {
    await setAuto(true);
    const inv = await invoiceOf(1234);
    await approve(inv);
    expect(await stored(inv)).toBe('0');
    expect((await linesOf(inv)).party).toBe(1234);
  });

  it('the Round Off box: not on an approved invoice, and only in rupees', async () => {
    const inv = await invoiceOf(99.5);
    const box = (id, roundOff) => auth(request(app).post('/invoice/roundOffInv')).send({ id, roundOff });
    expect((await box(inv.id, '+0.50')).body.status).toBe('success');
    expect(await stored(inv)).toBe('+0.50');

    await approve(inv);
    expect((await box(inv.id, '0')).status).toBe(400);

    const agent = await invoiceOf(10.25, { type: 'Agent Invoice', currency: 'USD', ex_rate: '280', partyType: 'agent' });
    expect((await box(agent.id, '-0.25')).status).toBe(400);
    expect((await box(agent.id, 'abc')).status).toBe(400);
  });
});

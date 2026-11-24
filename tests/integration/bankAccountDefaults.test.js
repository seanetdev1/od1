const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Company, BankAccount, AppSetting } = require('../../models');
const { Invoice } = require('../../functions/Associations/incoiceAssociations');
const { signPrintToken } = require('../../functions/printToken');
const { BANK_DEFAULTS_KEY } = require('../../functions/bankAccountDefaults');

/* Config > Bank Accounts: "Make client default" (JI / JB) and "Make agent
 * default" (AI / AB). Stored in AppSettings and put onto the accounts on the
 * way out - see functions/bankAccountDefaults - so what is checked here is
 * that every place accounts leave the server carries the flags: the company
 * list the screens read, the Config list, and the emailed PDF's payload. */
describe('bank account defaults - routes/companies', () => {
  let admin; let company; let soneri; let habib; let invoice; let savedSetting;

  const setDefault = (id, kind, auth = admin.authHeader) =>
    request(app).post('/companies/bankAccount/setDefault').set('Authorization', auth).send({ id, kind });
  const byCompany = async () => (await request(app)
    .get(`/companies/bankAccount/byCompany/${company.id}`).set('Authorization', admin.authHeader)).body.result;

  beforeAll(async () => {
    admin = await loginAs('admin');
    savedSetting = await AppSetting.findOne({ where: { key: BANK_DEFAULTS_KEY } });
    savedSetting = savedSetting ? savedSetting.value : null;

    company = await Company.create({ title: `${TEST_PREFIX}Bank Co ${Date.now()}`, short: 'TBK' });
    soneri = await BankAccount.create({ CompanyId: company.id, label: 'Soneri - Main', bankName: 'Soneri' });
    habib = await BankAccount.create({ CompanyId: company.id, label: 'Habib - USD', bankName: 'Bank Al Habib' });
    invoice = await Invoice.create({
      invoice_No: `${TEST_PREFIX}BK-AI-1`, type: 'Agent Invoice', payType: 'Recievable',
      companyId: String(company.id), approved: '0',
    }, { fiscalYearCheck: false });
  });

  afterAll(async () => {
    await Invoice.destroy({ where: { id: invoice.id }, fiscalYearCheck: false });
    await BankAccount.destroy({ where: { CompanyId: company.id } });
    await Company.destroy({ where: { id: company.id } });
    if (savedSetting === null) await AppSetting.destroy({ where: { key: BANK_DEFAULTS_KEY } });
    else await AppSetting.update({ value: savedSetting }, { where: { key: BANK_DEFAULTS_KEY } });
  });

  it('starts with neither default set', async () => {
    const accounts = await byCompany();
    expect(accounts.map((a) => [a.clientDefault, a.agentDefault])).toEqual([[false, false], [false, false]]);
  });

  it('makes one account the client default and another the agent default', async () => {
    expect((await setDefault(soneri.id, 'client')).body.status).toBe('success');
    expect((await setDefault(habib.id, 'agent')).body.status).toBe('success');

    const [s, h] = await byCompany();
    expect([s.clientDefault, s.agentDefault]).toEqual([true, false]);
    expect([h.clientDefault, h.agentDefault]).toEqual([false, true]);
  });

  it('carries the flags in the company list every screen reads', async () => {
    const res = await request(app).get('/companies/getAllCompanies');
    const mine = res.body.result.find((c) => c.id === company.id);
    const flags = Object.fromEntries(mine.BankAccounts.map((a) => [a.label, [a.clientDefault, a.agentDefault]]));
    expect(flags).toEqual({ 'Soneri - Main': [true, false], 'Habib - USD': [false, true] });
  });

  it('carries them to the emailed PDF too', async () => {
    const res = await request(app).get('/invoice/getPrintData')
      .set('invoiceid', String(invoice.id)).set('printtoken', signPrintToken(invoice.id));
    const agent = res.body.result.company.BankAccounts.find((a) => a.agentDefault);
    expect(agent.label).toBe('Habib - USD');
  });

  it('moves a default rather than adding a second one', async () => {
    await setDefault(habib.id, 'client');
    const [s, h] = await byCompany();
    expect(s.clientDefault).toBe(false);
    expect([h.clientDefault, h.agentDefault]).toEqual([true, true]);   // one account may be both
  });

  it('refuses a kind that is not client or agent', async () => {
    const res = await setDefault(soneri.id, 'vendor');
    expect(res.status).toBe(400);
  });

  it('refuses an account that does not exist', async () => {
    expect((await setDefault(99999999, 'client')).status).toBe(404);
  });

  it('is for admins only', async () => {
    const { authHeader } = await loginAs('employee');
    const res = await setDefault(soneri.id, 'client', authHeader);
    expect(res.status).toBe(403);
    expect((await byCompany())[0].clientDefault).toBe(false);
  });
});

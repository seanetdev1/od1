const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Company, BankAccount, AppSetting } = require('../../models');
const { BANK_DEFAULTS_KEY } = require('../../functions/bankAccountDefaults');

/* Config > Bank Accounts > Edit (the user, 2026-11-02: "I can't edit bank
 * accounts"). Changed in place: the id stays, so the account's default does
 * too, and it stays with its company. */
describe('bank account edit - routes/companies', () => {
  let admin; let company; let soneri; let savedSetting;

  const edit = (body, auth = admin.authHeader) =>
    request(app).post('/companies/bankAccount/edit').set('Authorization', auth).send(body);

  beforeAll(async () => {
    admin = await loginAs('admin');
    savedSetting = await AppSetting.findOne({ where: { key: BANK_DEFAULTS_KEY } });
    savedSetting = savedSetting ? savedSetting.value : null;
    company = await Company.create({ title: `${TEST_PREFIX}Bank Edit Co ${Date.now()}`, short: 'TBE' });
    soneri = await BankAccount.create({
      CompanyId: company.id, label: 'Soneri - Main', bankName: 'Soneri', accountNo: '0011', iban: 'PK00SONE0011',
    });
  });

  afterAll(async () => {
    await BankAccount.destroy({ where: { CompanyId: company.id } });
    await Company.destroy({ where: { id: company.id } });
    if (savedSetting === null) await AppSetting.destroy({ where: { key: BANK_DEFAULTS_KEY } });
    else await AppSetting.update({ value: savedSetting }, { where: { key: BANK_DEFAULTS_KEY } });
  });

  it('changes the details in place, and the account keeps its default', async () => {
    await request(app).post('/companies/bankAccount/setDefault').set('Authorization', admin.authHeader)
      .send({ id: soneri.id, kind: 'client' });
    const res = await edit({ id: soneri.id, accountNo: '0099', branch: 'I.I. Chundrigar Rd', CompanyId: 999999 });
    expect(res.status).toBe(200);

    const [account] = (await request(app).get(`/companies/bankAccount/byCompany/${company.id}`)
      .set('Authorization', admin.authHeader)).body.result;
    expect(account).toMatchObject({
      id: soneri.id, label: 'Soneri - Main', accountNo: '0099', branch: 'I.I. Chundrigar Rd',
      iban: 'PK00SONE0011', clientDefault: true,
    });
    // It stays with its company, whatever the body says.
    expect((await BankAccount.findByPk(soneri.id)).CompanyId).toBe(company.id);
  });

  it('refuses to leave it with neither a bank name nor an IBAN', async () => {
    const res = await edit({ id: soneri.id, bankName: '', iban: ' ' });
    expect(res.status).toBe(400);
    expect((await BankAccount.findByPk(soneri.id)).bankName).toBe('Soneri');
  });

  it('refuses an account that does not exist', async () => {
    expect((await edit({ id: 99999999, label: 'x' })).status).toBe(404);
  });

  it('is for admins only', async () => {
    const { authHeader } = await loginAs('employee');
    expect((await edit({ id: soneri.id, label: 'Changed' }, authHeader)).status).toBe(403);
    expect((await BankAccount.findByPk(soneri.id)).label).toBe('Soneri - Main');
  });
});

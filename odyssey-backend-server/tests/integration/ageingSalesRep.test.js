const request = require('supertest');
const moment = require('moment');
const app = require('../../index');
const { loginAs, createEmployee, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* THE AGEING REPORT BY SALES REP - the rep set on the PARTY (Setup > Parties),
 * which is who a receivable belongs to in every mode. */
describe('the ageing report\'s sales rep', () => {
  const stamp = Date.now();
  let authHeader; let company; let rep; const made = { accounts: [], clients: [], invoices: [] };

  const ageing = (salesRep) => {
    let req = request(app).get('/invoice/ageingSummary')
      .set('Authorization', authHeader)
      .set('from', moment().subtract(1, 'day').toISOString())
      .set('to', moment().add(1, 'day').toISOString())
      .set('ageing_company', String(company.id))
      .set('ageing_rp', 'Recievable,Payble')
      .set('ageing_partytype', 'Local');
    if (salesRep !== undefined) req = req.set('ageing_salesrep', String(salesRep));
    return req;
  };
  const parties = (res) => (res.body.temp || []).map((p) => [p.partyName, p.salesRep]).sort();

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    rep = await createEmployee({ name: `${TEST_PREFIX}REP SARA ${stamp}` });
    company = await db.Company.create({ title: `${TEST_PREFIX}Rep Co ${stamp}`, short: 'TRP' });
    for (const [name, salesRepresentatorId] of [[`${TEST_PREFIX}WITH REP ${stamp}`, rep.id], [`${TEST_PREFIX}NO REP ${stamp}`, null]]) {
      const account = await db.Child_Account.create({ title: name, subCategory: 'Customer' });
      const client = await db.Clients.create({ name, salesRepresentatorId });
      await db.Client_Associations.create({ ClientId: client.id, ChildAccountId: account.id });
      made.accounts.push(account); made.clients.push(client);
      made.invoices.push(await db.Invoice.create({
        invoice_No: `${TEST_PREFIX}JI-${account.id}`, type: 'Job Invoice', payType: 'Recievable', partyType: 'client',
        party_Id: String(account.id), party_Name: name, currency: 'PKR', total: '1000', recieved: '0', paid: '0',
        approved: '1', companyId: String(company.id),
      }, { fiscalYearCheck: false }));
    }
  });

  afterAll(async () => {
    await db.Invoice.destroy({ where: { id: made.invoices.map((i) => i.id) }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { ClientId: made.clients.map((c) => c.id) } });
    await db.Clients.destroy({ where: { id: made.clients.map((c) => c.id) } });
    await db.Child_Account.destroy({ where: { id: made.accounts.map((a) => a.id) } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('names each party\'s sales rep, and none where the party has none', async () => {
    expect(parties(await ageing())).toEqual([
      [`${TEST_PREFIX}NO REP ${stamp}`, null],
      [`${TEST_PREFIX}WITH REP ${stamp}`, rep.name],
    ]);
  });

  it('one rep picked: only that rep\'s parties', async () => {
    expect(parties(await ageing(rep.id))).toEqual([[`${TEST_PREFIX}WITH REP ${stamp}`, rep.name]]);
  });

  it('a rep with no parties: nothing, and All: everyone', async () => {
    const nobody = await createEmployee({ name: `${TEST_PREFIX}REP NOBODY ${stamp}` });
    expect(parties(await ageing(nobody.id))).toEqual([]);
    expect(parties(await ageing('All'))).toHaveLength(2);
  });
});

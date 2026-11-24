const request = require('supertest');
const moment = require('moment');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* THE AGEING REPORT, BY CURRENCY - GET /invoice/ageingSummary.
 * One currency picked reads only its invoices (PKR includes those with no
 * currency recorded); 'All' and 'All-PKR' read every one - the second is
 * converted on the screen, not here. */
describe('the ageing report\'s currency', () => {
  const stamp = Date.now();
  let authHeader; let company; let account;
  const made = [];

  const ageing = (currency) => {
    let req = request(app).get('/invoice/ageingSummary')
      .set('Authorization', authHeader)
      .set('from', moment().subtract(1, 'day').toISOString())
      .set('to', moment().add(1, 'day').toISOString())
      .set('ageing_company', String(company.id))
      .set('ageing_rp', 'Recievable,Payble')
      .set('ageing_partytype', 'Local');
    if (currency !== undefined) req = req.set('ageing_currency', currency);
    return req;
  };
  const numbersIn = (res) => (res.body.temp || []).flatMap((p) => p.invoices.map((i) => i.invoice_No)).sort();

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    company = await db.Company.create({ title: `${TEST_PREFIX}Ageing Co ${stamp}`, short: 'TAG' });
    account = await db.Child_Account.create({ title: `${TEST_PREFIX}AGEING PARTY ${stamp}`, subCategory: 'Customer' });
    for (const [no, currency] of [['USD-1', 'USD'], ['PKR-1', 'PKR'], ['NONE-1', null], ['EUR-1', 'EUR']]) {
      made.push(await db.Invoice.create({
        invoice_No: `${TEST_PREFIX}${no}-${stamp}`, type: 'Job Invoice', payType: 'Recievable', partyType: 'client',
        party_Id: String(account.id), party_Name: account.title, currency, ex_rate: currency === 'PKR' ? '1' : '280',
        total: '1000', recieved: '0', paid: '0', approved: '1', companyId: String(company.id),
      }, { fiscalYearCheck: false }));
    }
  });

  afterAll(async () => {
    await db.Invoice.destroy({ where: { id: made.map((i) => i.id) }, fiscalYearCheck: false });
    await db.Child_Account.destroy({ where: { id: account.id } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  const no = (n) => `${TEST_PREFIX}${n}-${stamp}`;

  it('one currency: only its invoices', async () => {
    expect(numbersIn(await ageing('USD'))).toEqual([no('USD-1')]);
    expect(numbersIn(await ageing('eur'))).toEqual([no('EUR-1')]);
  });

  it('PKR takes the invoices with no currency recorded too', async () => {
    expect(numbersIn(await ageing('PKR'))).toEqual([no('NONE-1'), no('PKR-1')].sort());
  });

  it('All, All-PKR and no choice at all read every currency', async () => {
    const every = [no('USD-1'), no('PKR-1'), no('NONE-1'), no('EUR-1')].sort();
    expect(numbersIn(await ageing('All'))).toEqual(every);
    expect(numbersIn(await ageing('All-PKR'))).toEqual(every);
    expect(numbersIn(await ageing(undefined))).toEqual(every);
  });
});

/* THE CUT-OFF - the report's From date (the user's request, 2026-10-09).
 * By the invoice's DATE: one dated before From is left out, whatever is still
 * owed on it; one dated after To is not there yet. It read updatedAt, which a
 * migrated invoice has as the day it was migrated - like these, dated in 2035
 * and written today - so From cut nothing off. */
describe("the ageing report's cut-off", () => {
  const stamp = Date.now();
  let authHeader; let company; let account;
  const made = [];
  const ageing = (from, to) => request(app).get('/invoice/ageingSummary')
    .set('Authorization', authHeader)
    .set('from', moment(from).toISOString())
    .set('to', moment(to).toISOString())
    .set('ageing_company', String(company.id))
    .set('ageing_rp', 'Recievable,Payble')
    .set('ageing_partytype', 'Local');
  const numbersIn = (res) => (res.body.temp || []).flatMap((p) => p.invoices.map((i) => i.invoice_No)).sort();
  const no = (n) => `${TEST_PREFIX}CUT-${n}-${stamp}`;

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    company = await db.Company.create({ title: `${TEST_PREFIX}Ageing Cut ${stamp}`, short: 'TAC' });
    account = await db.Child_Account.create({ title: `${TEST_PREFIX}AGEING CUT ${stamp}`, subCategory: 'Customer' });
    for (const [n, on] of [['MAR', '2035-03-01'], ['JUN', '2035-06-10'], ['JUL', '2035-07-05']]) {
      made.push(await db.Invoice.create({
        invoice_No: no(n), type: 'Job Invoice', payType: 'Recievable', partyType: 'client',
        party_Id: String(account.id), party_Name: account.title, currency: 'PKR', ex_rate: '1',
        total: '1000', recieved: '0', paid: '0', approved: '1', companyId: String(company.id),
        createdAt: new Date(`${on}T07:00:00.000Z`),
      }, { fiscalYearCheck: false }));
    }
  });

  afterAll(async () => {
    await db.Invoice.destroy({ where: { id: made.map((i) => i.id) }, fiscalYearCheck: false });
    await db.Child_Account.destroy({ where: { id: account.id } });
    await db.Company.destroy({ where: { id: company.id } });
  });

  it('leaves out what is dated before the cut-off, and after the To date', async () => {
    expect(numbersIn(await ageing('2035-06-01', '2035-06-30'))).toEqual([no('JUN')]);
  });

  it('moved back, the cut-off takes the older one in', async () => {
    expect(numbersIn(await ageing('2035-01-01', '2035-06-30'))).toEqual([no('JUN'), no('MAR')].sort());
  });
});

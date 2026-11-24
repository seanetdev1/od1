/**
 * Invoice Balancing (agents) and Job Balancing - which invoices a filtered
 * report returns. routes/invoice /invoiceBalancing and /jobBalancing.
 *
 *   - The agent report took "anything but a Job Invoice/Bill", so every client
 *     and vendor OPENING invoice came with it; it is agent documents now.
 *   - It ignored the currency picked, adding USD, EUR and PKR into one column.
 *   - A party was matched on its FIRST ledger account only (findOne), and a
 *     party with no account was not filtered at all - the report then showed
 *     every party's invoices as the one picked.
 */
const request = require('supertest');
const moment = require('moment');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { Invoice } = require('../../functions/Associations/incoiceAssociations');

describe('balancing reports filter by party and currency', () => {
  let admin;
  const stamp = Date.now();
  const made = { clients: [], accounts: [], links: [], invoices: [] };
  let agentA; let agentB; let other;

  const client = async (name) => {
    const c = await db.Clients.create({ name: `${TEST_PREFIX}${name} ${stamp}`, types: 'Overseas Agent' });
    made.clients.push(c.id);
    return c;
  };
  const account = async (c, n) => {
    const a = await db.Child_Account.create({ title: `${TEST_PREFIX}${c.name} A/C ${n}`, subCategory: 'General' });
    made.accounts.push(a.id);
    const l = await db.Client_Associations.create({ ClientId: c.id, ChildAccountId: a.id });
    made.links.push(l.id);
    return a;
  };
  const invoice = async (fields) => {
    const i = await Invoice.create({
      invoice_No: `${TEST_PREFIX}BAL-${stamp}-${made.invoices.length}`,
      status: '1', approved: '1', currency: 'USD', ex_rate: '280', total: '100', paid: '0', recieved: '0',
      roundOff: '0', companyId: '1', ...fields,
    }, { fiscalYearCheck: false });
    made.invoices.push(i.id);
    return i;
  };

  const range = { from: moment().subtract(1, 'day').toISOString(), to: moment().add(1, 'day').toISOString() };
  const agentReport = (headers) => request(app).get('/invoice/invoiceBalancing')
    .set('Authorization', admin.authHeader)
    .set({ ...range, company: 'all', paytype: 'All', currency: 'USD', ...headers });
  const mine = (res) => res.body.result.map((i) => i.invoice_No).filter((n) => n.startsWith(`${TEST_PREFIX}BAL-${stamp}`)).sort();

  let usdA1; let usdA2; let eurA; let migratedA; let clientOpening; let usdOther;

  beforeAll(async () => {
    admin = await loginAs('admin');
    agentA = await client('Agent A');
    agentB = await client('Agent B');      // no ledger account at all
    other = await client('Agent Other');
    const a1 = await account(agentA, 1);
    const a2 = await account(agentA, 2);    // a second company's account
    const o1 = await account(other, 1);

    usdA1 = await invoice({ type: 'Agent Invoice', partyType: 'agent', payType: 'Recievable', party_Id: String(a1.id), party_Name: agentA.name });
    usdA2 = await invoice({ type: 'Agent Bill', partyType: 'agent', payType: 'Payble', party_Id: String(a2.id), party_Name: agentA.name });
    eurA = await invoice({ type: 'Agent Invoice', partyType: 'agent', payType: 'Recievable', currency: 'EUR', party_Id: String(a1.id), party_Name: agentA.name });
    // Migrated while the agent had no single account: party_Id is the Clients id.
    migratedA = await invoice({ type: 'Opening Invoice', partyType: 'agent', payType: 'Recievable', party_Id: String(agentA.id), party_Name: agentA.name });
    clientOpening = await invoice({ type: 'Opening Invoice', partyType: 'client', payType: 'Recievable', currency: 'USD', party_Id: String(o1.id), party_Name: other.name });
    usdOther = await invoice({ type: 'Agent Invoice', partyType: 'agent', payType: 'Recievable', party_Id: String(o1.id), party_Name: other.name });
  });

  afterAll(async () => {
    await Invoice.destroy({ where: { id: made.invoices }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { id: made.links } });
    await db.Child_Account.destroy({ where: { id: made.accounts } });
    await db.Clients.destroy({ where: { id: made.clients } });
  });

  it('lists agent documents only - not a client opening invoice', async () => {
    const res = await agentReport({});
    expect(res.status).toBe(200);
    expect(mine(res)).toEqual([usdA1, usdA2, migratedA, usdOther].map((i) => i.invoice_No).sort());
    expect(mine(res)).not.toContain(clientOpening.invoice_No);
  });

  it('keeps to the currency picked, and PKR takes every currency', async () => {
    expect(mine(await agentReport({}))).not.toContain(eurA.invoice_No);
    expect(mine(await agentReport({ currency: 'EUR' }))).toEqual([eurA.invoice_No]);
    expect(mine(await agentReport({ currency: 'PKR' }))).toContain(eurA.invoice_No);
  });

  it('All is every currency, as invoiced', async () => {
    const res = await agentReport({ currency: 'All' });
    expect(mine(res)).toEqual([usdA1, usdA2, eurA, migratedA, usdOther].map((i) => i.invoice_No).sort());
    // Unconverted: the EUR invoice comes back in EUR, at its own figures.
    const eur = res.body.result.find((i) => i.invoice_No === eurA.invoice_No);
    expect([eur.currency, Number(eur.total)]).toEqual(['EUR', 100]);
  });

  it('finds an agent on every one of its accounts, and on its Clients id', async () => {
    const res = await agentReport({ overseasagent: String(agentA.id) });
    expect(mine(res)).toEqual([usdA1, usdA2, migratedA].map((i) => i.invoice_No).sort());
  });

  it('returns nothing for an agent with no account, instead of everyone', async () => {
    const res = await agentReport({ overseasagent: String(agentB.id) });
    expect(mine(res)).toEqual([]);
  });

  it('Job Balancing: a party with no account returns nothing, instead of everyone', async () => {
    const res = await request(app).get('/invoice/jobBalancing')
      .set('Authorization', admin.authHeader)
      .set({ ...range, company: 'all', paytype: 'All', party: String(agentB.id) });
    expect(res.status).toBe(200);
    const list = Array.isArray(res.body.result) ? res.body.result : [];
    expect(list.filter((i) => String(i.invoice_No || '').startsWith(`${TEST_PREFIX}BAL-${stamp}`))).toEqual([]);
  });
});

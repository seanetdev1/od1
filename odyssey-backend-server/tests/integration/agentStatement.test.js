const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* THE INTERNATIONAL REPORT, FROM THE DATABASE - routes/misc/agentStatement.
 *
 * The arithmetic is pinned in tests/unit/agentStatement; this is the reading
 * of it: which accounts are agents (the party on an agent document, by its
 * account), and what counts - each APPROVED agent invoice and bill, what is
 * still owed on it, in currencies other than rupees, dated up to the end of
 * the As on day, one company's or all - each currency's balance added as it
 * stands, nothing converted. Not the agent's ledger: an advance no invoice was
 * knocked off by is not on it. Dated in 2035, clear of anything else. Only
 * this file's agents are looked at - the test database has others. */
describe('the International Report', () => {
  const stamp = Date.now();
  let authHeader; let company; let otherCompany;
  let agentClient; let agentOne; let agentTwo; let localClient; let local; let disabled;
  const made = { invoices: [], vouchers: [], accounts: [], clients: [] };
  let seq = 0;

  const account = async (title) => {
    const a = await db.Child_Account.create({ title: `${TEST_PREFIX}${title} ${stamp}`, subCategory: 'General' });
    made.accounts.push(a.id);
    return a;
  };
  const client = async (name, acct) => {
    const c = await db.Clients.create({ name: `${TEST_PREFIX}${name} ${stamp}`, code: `${TEST_PREFIX}AS${seq += 1}${stamp % 10000}`, types: 'Overseas Agent' });
    made.clients.push(c.id);
    await db.Client_Associations.create({ ClientId: c.id, ChildAccountId: acct.id, CompanyId: company.id });
    return c;
  };
  // An invoice or bill for a party, on a day: what it is for, and what was paid / received on it.
  const invoice = async (type, partyId, {
    total = 1, settled = 0, currency = 'USD', on = '2035-06-10', approved = '1', companyId = company.id,
  } = {}) => {
    const receivable = /Invoice/.test(type);
    const when = new Date(`${on}T07:00:00.000Z`);
    const i = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}AS-${stamp}-${seq += 1}`, type, payType: receivable ? 'Recievable' : 'Payble',
      party_Id: String(partyId), currency, ex_rate: '280', total: String(total), approved,
      recieved: receivable ? String(settled) : '0', paid: receivable ? '0' : String(settled),
      companyId: String(companyId), createdAt: when, updatedAt: when,
    }, { fiscalYearCheck: false });
    made.invoices.push(i.id);
  };

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    company = await db.Company.create({ title: `${TEST_PREFIX}AS Co ${stamp}`, short: 'TAS' });
    otherCompany = await db.Company.create({ title: `${TEST_PREFIX}AS Other ${stamp}`, short: 'TAT' });

    // An agent with its party record, named by it; one with only an account,
    // named by that; a local customer - no agent documents - dealt with in
    // dollars too.
    agentOne = await account('AGENT ONE A/C');
    agentClient = await client('AGENT ONE LTD', agentOne);
    agentTwo = await account('AGENT TWO A/C');
    local = await account('LOCAL CUSTOMER A/C');
    localClient = await client('LOCAL CUSTOMER', local);

    // A disabled party's agent account, with something owed.
    disabled = await account('DISABLED AGENT A/C');
    const disabledClient = await client('DISABLED AGENT', disabled);
    await disabledClient.update({ active: false });
    await invoice('Agent Invoice', disabled.id, { total: 750 });

    // AGENT ONE: owes 1,000 here and 200 (300 less 100 received) in the other
    // company - 1,200. Not the rupee one, not the one dated after the day,
    // and not the one still awaiting approval.
    await invoice('Agent Invoice', agentOne.id, { total: 1000 });
    await invoice('Agent Invoice', agentOne.id, { total: 300, settled: 100, on: '2035-06-12', companyId: otherCompany.id });
    await invoice('Agent Invoice', agentOne.id, { total: 50000, currency: 'PKR', on: '2035-06-15' });
    await invoice('Agent Invoice', agentOne.id, { total: 999, on: '2035-07-02' });
    await invoice('Agent Invoice', agentOne.id, { total: 500, approved: '0', on: '2035-06-15' });
    // AGENT TWO: we owe USD 400 and EUR 100 - -500, not converted.
    await invoice('Agent Bill', agentTwo.id, { total: 400 });
    await invoice('Agent Bill', agentTwo.id, { total: 100, currency: 'EUR', on: '2035-06-15' });
    // Settled in full: adds nothing.
    await invoice('Agent Bill', agentTwo.id, { total: 250, settled: 250, on: '2035-06-15' });
    // A local customer's own invoice is not an agent document.
    await invoice('Job Invoice', local.id, { total: 500, on: '2035-06-20' });
    // An agent document naming a party by its CLIENT id: not read as an
    // account - client and account ids overlap. By a client whose id is not
    // also one of these accounts': on an empty database the two run side by
    // side, and the 1 landed on an agent - 1,201, or -499 (2026-10-26).
    let byClientId = localClient;
    while (made.accounts.includes(byClientId.id)) byClientId = await client(`LOCAL CUSTOMER ${seq}`, local);
    await invoice('Agent Invoice', byClientId.id, { total: 1 });

    // An advance to AGENT ONE on its ledger that no invoice was knocked off by:
    // not counted - the report is about invoices and bills.
    const when = new Date('2035-06-11T07:00:00.000Z');
    seq += 1;
    const v = await db.Vouchers.create({
      voucher_No: 900000 + seq, voucher_Id: `${TEST_PREFIX}AS-${stamp}-${seq}`, vType: 'BPV', type: 'Bank Payment Voucher',
      currency: 'USD', exRate: '280', CompanyId: company.id, createdAt: when, updatedAt: when,
    }, { fiscalYearCheck: false });
    made.vouchers.push(v.id);
    await db.Voucher_Heads.create({
      VoucherId: v.id, ChildAccountId: agentOne.id, type: 'debit', amount: '5000', defaultAmount: '1400000',
      narration: 'agent statement test - advance', createdAt: when, updatedAt: when,
    });
  });

  afterAll(async () => {
    await db.Voucher_Heads.destroy({ where: { VoucherId: made.vouchers } });
    await db.Vouchers.destroy({ where: { id: made.vouchers }, fiscalYearCheck: false });
    await db.Invoice.destroy({ where: { id: made.invoices }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { ClientId: made.clients } });
    await db.Clients.destroy({ where: { id: made.clients } });
    await db.Child_Account.destroy({ where: { id: made.accounts } });
    await db.Company.destroy({ where: { id: [company.id, otherCompany.id] } });
  });

  const statement = async (headers = {}) => {
    const res = await request(app).get('/misc/agentStatement')
      .set('Authorization', authHeader)
      .set({ ason: '2035-06-30', company: 'all', ...headers });
    expect(res.status).toBe(200);
    return res.body.result;
  };
  const ours = (r) => [...r.payables, ...r.receivables]
    .filter((a) => [agentOne.id, agentTwo.id, local.id].includes(a.accountId))
    .map((a) => [a.agent, a.amount]);

  it("what is still owed on the agents' invoices and bills to the date, added as they stand - named by their party record, or account", async () => {
    const r = await statement();
    expect(ours(r)).toEqual([
      [`${TEST_PREFIX}AGENT TWO A/C ${stamp}`, -500],    // USD -400 and EUR -100, not converted
      [`${TEST_PREFIX}AGENT ONE LTD ${stamp}`, 1200],
    ]);
    // No rate, and no currency, in what comes back.
    expect(r).not.toHaveProperty('usdRate');
    expect(r.payables.find((a) => a.accountId === agentTwo.id)).not.toHaveProperty('byCurrency');
  });

  it('leaves out rupee invoices, invoices after the date, unapproved ones, the ledger, and parties with no agent documents of their own', async () => {
    const r = await statement();
    // Not +50,000 PKR, not +999 on 2 July, not the unapproved 500, not the 5,000 advance.
    expect(r.receivables.find((a) => a.accountId === agentOne.id).amount).toBe(1200);
    expect(ours(r).map(([name]) => name)).not.toContain(`${TEST_PREFIX}LOCAL CUSTOMER ${stamp}`);
  });

  it('as on an earlier day: only what was dated by its end', async () => {
    const r = await statement({ ason: '2035-06-11' });
    expect(ours(r)).toEqual([[`${TEST_PREFIX}AGENT TWO A/C ${stamp}`, -400], [`${TEST_PREFIX}AGENT ONE LTD ${stamp}`, 1000]]);
  });

  it('leaves off a disabled party, balance or not', async () => {
    const r = await statement();
    expect([...r.payables, ...r.receivables].map((a) => a.accountId)).not.toContain(disabled.id);
  });

  it('one company: only its invoices', async () => {
    const r = await statement({ company: String(company.id) });
    expect(r.company).toBe(String(company.id));
    expect(r.receivables.find((a) => a.accountId === agentOne.id).amount).toBe(1000);
  });

  // The cut-off (the user's request, 2026-10-09): what is dated before it is
  // left out, whatever is still owed on it.
  it('a cut-off date: only what is dated from it to the As on day', async () => {
    const r = await statement({ from: '2035-06-11' });
    expect(r.from).toBe('2035-06-11');
    // AGENT ONE's 1,000 of 10 June is gone, its 200 of 12 June stays; AGENT
    // TWO keeps only the EUR 100 of 15 June.
    expect(ours(r)).toEqual([[`${TEST_PREFIX}AGENT TWO A/C ${stamp}`, -100], [`${TEST_PREFIX}AGENT ONE LTD ${stamp}`, 200]]);
    // None given: every document, as before.
    expect((await statement()).from).toBeNull();
  });

  it('refuses a cut-off after the As on day', async () => {
    const res = await request(app).get('/misc/agentStatement')
      .set('Authorization', authHeader)
      .set({ ason: '2035-06-30', from: '2035-07-01', company: 'all' });
    expect(res.status).toBe(400);
  });

  describe('the typed-in section', () => {
    const KEY = 'agentStatementManual';
    let before;
    beforeAll(async () => {
      before = await db.AppSetting.findOne({ where: { key: KEY } });
      await db.AppSetting.destroy({ where: { key: KEY } });
    });
    afterAll(async () => {
      await db.AppSetting.destroy({ where: { key: KEY } });
      if (before) await db.AppSetting.create({ key: KEY, value: before.value });
    });

    const get = () => request(app).get('/misc/agentStatement/manual').set('Authorization', authHeader);
    const save = (body) => request(app).post('/misc/agentStatement/manual').set('Authorization', authHeader).send(body);

    it('is empty until one is saved', async () => {
      expect((await get()).body.result).toEqual({ title: '', lines: [] });
    });

    it('keeps its heading and lines, to the cent, leaving out empty rows', async () => {
      const res = await save({
        title: '  INTERNATIONAL FREIGHT & AVIATION  ',
        lines: [{ agent: 'SKYGATE SERVICES FZCO', amount: '-122,551' }, { agent: '', amount: '' }, { agent: 'FITS AIR', amount: 9495.704 }],
      });
      expect(res.status).toBe(200);
      const kept = { title: 'INTERNATIONAL FREIGHT & AVIATION', lines: [{ agent: 'SKYGATE SERVICES FZCO', amount: -122551 }, { agent: 'FITS AIR', amount: 9495.7 }] };
      expect(res.body.result).toEqual(kept);
      expect((await get()).body.result).toEqual(kept);
    });

    it('refuses a line with an agent and no amount, or the other way round', async () => {
      expect((await save({ lines: [{ agent: 'ZEAL GLOBAL', amount: '' }] })).status).toBe(400);
      expect((await save({ lines: [{ agent: '', amount: 20000 }] })).status).toBe(400);
      expect((await save({ lines: [{ agent: 'ZEAL GLOBAL', amount: 'twenty' }] })).status).toBe(400);
    });

    it('refuses more than a hundred lines', async () => {
      const lines = Array.from({ length: 101 }, (_, i) => ({ agent: `A${i}`, amount: 1 }));
      expect((await save({ lines })).status).toBe(400);
    });
  });
});

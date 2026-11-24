const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

/* AN UN-APPROVED INVOICE MOVES TO THE PARTY ITS LINES ARE MOVED TO, AND KEEPS
 * ITS NUMBER - /invoice/saveHeadesNew, moveInvoiceToItsLines.
 *
 * Raised to the wrong party, an invoice is un-approved, its lines are given
 * the right party on the charges screen and saved: the same document, now
 * the new party's. Refused, with the whole save, where that would leave a
 * wrong document. */
describe('moving an invoice to another party', () => {
  const stamp = Date.now();
  let admin; let job; let invoice; let lines; let partyA; let partyB; let agent;
  const made = { accounts: [], clients: [] };
  let seq = 0;

  const party = async (name, types = 'Client') => {
    const account = await db.Child_Account.create({ title: `${TEST_PREFIX}${name} ${stamp}`, subCategory: 'Customer/Vendor' });
    const client = await db.Clients.create({ name: `${TEST_PREFIX}${name} ${stamp}`, code: `${TEST_PREFIX}PM${seq += 1}${stamp % 10000}`, types });
    await db.Client_Associations.create({ ClientId: client.id, ChildAccountId: account.id });
    made.accounts.push(account.id);
    made.clients.push(client.id);
    return { account, client };
  };
  // The lines as the screen sends them back, with these changes.
  const save = (changes) => request(app).post('/invoice/saveHeadesNew')
    .set('Authorization', admin.authHeader)
    .send({
      id: job.id, exRate: '1', employeeId: admin.employee.id, deleteList: [],
      charges: lines.map((l, i) => ({ ...l.get({ plain: true }), ...(changes[i] || {}) })),
    });
  const toParty = (p, invoiceType = 'Job Invoice') => ({ partyId: String(p.client.id), name: p.client.name, partyType: 'client', invoiceType });
  const reload = async () => {
    invoice = await db.Invoice.findByPk(invoice.id);
    lines = await db.Charge_Head.findAll({ where: { InvoiceId: invoice.id }, order: [['id', 'ASC']] });
  };
  const historyCount = async (count) => {
    for (let i = 0; i < 40; i++) {
      const n = await db.History.count({ where: { formName: 'Invoice', type: 'Change Party', docNo: invoice.invoice_No } });
      if (n >= count) return n;
      await new Promise((r) => setTimeout(r, 50));
    }
    return db.History.count({ where: { formName: 'Invoice', type: 'Change Party', docNo: invoice.invoice_No } });
  };

  beforeAll(async () => {
    admin = await loginAs('admin');
    partyA = await party('PARTY A');
    partyB = await party('PARTY B');
    agent = await party('OVERSEAS AGENT', 'Overseas Agent');
    job = await db.SE_Job.create({ jobNo: `${TEST_PREFIX}PM-${stamp}`, operation: 'SE' }, { fiscalYearCheck: false });
    invoice = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}JI-${stamp}`, type: 'Job Invoice', payType: 'Recievable', approved: '0', status: '1',
      party_Id: String(partyA.account.id), party_Name: partyA.client.name, partyType: 'client', SEJobId: job.id, currency: 'PKR',
    }, { fiscalYearCheck: false });
    for (const charge of ['OCEAN FREIGHT', 'THC']) {
      await db.Charge_Head.create({
        charge: `${TEST_PREFIX}${charge}`, particular: charge, type: 'Recievable', status: '1', invoice_id: invoice.invoice_No,
        SEJobId: job.id, InvoiceId: invoice.id, qty: 1, rate_charge: '100', amount: '1', net_amount: '100', local_amount: '100',
        ...toParty(partyA),
      });
    }
    await reload();
  });

  afterAll(async () => {
    await db.History.destroy({ where: { docNo: invoice.invoice_No } });
    await db.Charge_Head.destroy({ where: { SEJobId: job.id } });
    await db.Invoice.destroy({ where: { id: invoice.id }, fiscalYearCheck: false });
    await db.SE_Job.destroy({ where: { id: job.id }, fiscalYearCheck: false });
    await db.Client_Associations.destroy({ where: { ClientId: made.clients } });
    await db.Clients.destroy({ where: { id: made.clients } });
    await db.Child_Account.destroy({ where: { id: made.accounts } });
  });

  it('refuses to split it: one line moved, the other left', async () => {
    const res = await save([toParty(partyB)]);
    expect(res.status).toBe(400);
    expect(res.body.result).toMatch(/lines for two parties/);
    await reload();
    // The whole save rolled back - the moved line too.
    expect(lines.map((l) => l.partyId)).toEqual([String(partyA.client.id), String(partyA.client.id)]);
    expect(invoice.party_Id).toBe(String(partyA.account.id));
  });

  it('refuses a party of another kind - an agent on a Job Invoice', async () => {
    const res = await save([toParty(agent, 'Agent Invoice'), toParty(agent, 'Agent Invoice')]);
    expect(res.status).toBe(400);
    expect(res.body.result).toMatch(/is a Job Invoice; .* would need an Agent Invoice/);
    await reload();
    expect(invoice.party_Id).toBe(String(partyA.account.id));
  });

  it('every line moved: the invoice moves to the new party, and keeps its number', async () => {
    const number = invoice.invoice_No;
    const res = await save([toParty(partyB), toParty(partyB)]);
    expect(res.status).toBe(200);
    await reload();
    expect(invoice.invoice_No).toBe(number);
    expect(invoice.party_Id).toBe(String(partyB.account.id));
    expect(invoice.party_Name).toBe(partyB.client.name);
    expect(lines.map((l) => l.partyId)).toEqual([String(partyB.client.id), String(partyB.client.id)]);
    expect(await historyCount(1)).toBe(1);
  });

  it('saving the lines again under the same party changes nothing', async () => {
    const res = await save([]);
    expect(res.status).toBe(200);
    await reload();
    expect(invoice.party_Id).toBe(String(partyB.account.id));
    expect(await historyCount(2)).toBe(1);
  });

  it('refuses to move an approved invoice', async () => {
    await invoice.update({ approved: '1' }, { fiscalYearCheck: false });
    const res = await save([toParty(partyA), toParty(partyA)]);
    expect(res.status).toBe(409);
    expect(res.body.result).toMatch(/is approved/);
    await reload();
    expect(invoice.party_Id).toBe(String(partyB.account.id));
    expect(lines.map((l) => l.partyId)).toEqual([String(partyB.client.id), String(partyB.client.id)]);
  });
});

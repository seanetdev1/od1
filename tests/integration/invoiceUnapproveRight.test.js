const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const permissions = require('../../functions/permissions/middleware');
const grants = require('../../functions/permissions/grants');

/* UNAPPROVE, APART FROM APPROVE (the user's request, 2026-10-24), enforced:
 * an operator who raises and approves invoices - so they post to the ledger
 * as they are made - cannot unapprove one and take it back out. Whoever has
 * Unapprove can. And someone saved before the split keeps unapproving until
 * saved again. Through the routes, in enforce mode. */
describe('unapproving an invoice is a right of its own', () => {
  const stamp = Date.now();
  let operator; let accountant; let older; let invoice;

  const grant = async (who, names) => {
    for (const n of names) await db.Access_Levels.create({ EmployeeId: who.employee.id, access_name: n });
    grants.invalidate(who.employee.id);
  };
  const post = (who, path) => request(app).post(path).set('Authorization', who.authHeader)
    .send({ id: invoice.id, employeeId: who.employee.id });

  beforeAll(async () => {
    permissions._setModeForTest('enforce');
    operator = await loginAs('employee');
    accountant = await loginAs('employee');
    older = await loginAs('employee');
    await grant(operator, ['perm:jobInvoices:view', 'perm:jobInvoices:raise', 'perm:jobInvoices:approve', 'perm:catalog:4']);
    await grant(accountant, ['perm:invoices:view', 'perm:invoices:approve', 'perm:invoices:unapprove', 'perm:catalog:4']);
    // Saved before the split: Approve meant both.
    await grant(older, ['perm:invoices:view', 'perm:invoices:approve', 'perm:catalog:3']);

    // Settled, so a permitted unapprove is refused by the route itself (409)
    // and nothing is actually taken out of the ledger here.
    invoice = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}UNAP-${stamp}`, type: 'Job Invoice', payType: 'Recievable', partyType: 'client',
      party_Name: 'X', currency: 'PKR', total: '100', recieved: '100', paid: '0', approved: '1',
    }, { fiscalYearCheck: false });
  });

  afterAll(async () => {
    permissions._setModeForTest(null);
    await db.Invoice.destroy({ where: { id: invoice.id }, fiscalYearCheck: false });
    await db.Access_Levels.destroy({ where: { EmployeeId: [operator.employee.id, accountant.employee.id, older.employee.id] } });
  });

  it('the operator, who approves, is refused an unapprove', async () => {
    expect((await post(operator, '/invoice/unApprove')).status).toBe(403);
  });

  it('the flag route too - clearing it needs Unapprove, setting it Approve', async () => {
    const clear = await request(app).post('/invoice/invApproveDisapp').set('Authorization', operator.authHeader)
      .send({ id: invoice.id, approved: '0', total: '100' });
    expect(clear.status).toBe(403);
  });

  it('whoever has Unapprove gets past the right - and is stopped only by the settlement', async () => {
    const res = await post(accountant, '/invoice/unApprove');
    expect(res.status).toBe(409);
    expect(res.body.result).toMatch('payments or receipts');
  });

  it('someone saved before the split still unapproves', async () => {
    expect((await post(older, '/invoice/unApprove')).status).toBe(409);
  });

  it('what each is told it may do', async () => {
    const mine = async (who) => (await request(app).get('/authRoutes/myPermissions').set('Authorization', who.authHeader)).body.result.perms;
    expect(await mine(operator)).toEqual(expect.arrayContaining(['jobInvoices:approve']));
    expect(await mine(operator)).not.toContain('jobInvoices:unapprove');
    expect(await mine(older)).toContain('invoices:unapprove');
  });
});

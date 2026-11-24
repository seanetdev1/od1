const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { Charge_Head, Invoice } = require('../../functions/Associations/incoiceAssociations');

/* THE INVOICE PAGE'S CURRENCY BOX - POST /invoice/changeCurrency (the user's
 * report, 2026-10-12). Saved at once, the total rebuilt from the charge lines;
 * an approved invoice refused; and the note's save no longer writes back a
 * currency and total of its own. */
describe('changing an invoice\'s currency', () => {
  const stamp = Date.now();
  let authHeader; let inv;
  const made = { invoices: [], lines: [] };

  const change = (currency) => request(app).post('/invoice/changeCurrency')
    .set('Authorization', authHeader).send({ id: inv.id, currency });
  const stored = () => Invoice.findByPk(inv.id, { raw: true });

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    inv = await Invoice.create({
      invoice_No: `${TEST_PREFIX}CUR-${stamp}`, type: 'Job Invoice', payType: 'Recievable',
      currency: 'USD', ex_rate: '280', total: '150', approved: '0', recieved: '0', paid: '0',
    }, { fiscalYearCheck: false });
    made.invoices.push(inv.id);
    for (const [net, local] of [['100', '28000'], ['50', '14150']]) {
      const line = await Charge_Head.create({
        InvoiceId: inv.id, type: 'Recievable', currency: 'USD', net_amount: net, local_amount: local,
        description: `${TEST_PREFIX}currency line`,
      });
      made.lines.push(line.id);
    }
  });

  afterAll(async () => {
    await Charge_Head.destroy({ where: { id: made.lines } });
    await Invoice.destroy({ where: { id: made.invoices }, fiscalYearCheck: false });
  });

  it('to PKR: saved at once, the total the lines\' PKR amounts', async () => {
    const res = await change('PKR');
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ currency: 'PKR', total: 42150 });
    expect(await stored()).toMatchObject({ currency: 'PKR', total: '42150' });
  });

  it('back to USD: the lines\' own amounts', async () => {
    await change('USD');
    expect(await stored()).toMatchObject({ currency: 'USD', total: '150' });
  });

  it('not to EUR - the lines are in USD', async () => {
    const res = await change('EUR');
    expect(res.status).toBe(409);
    expect(res.body.result).toBe('Its charges are in USD, so it can be in USD or PKR.');
    expect((await stored()).currency).toBe('USD');
  });

  it('a note saved from a tab that still holds an older currency changes only the note', async () => {
    await request(app).post('/invoice/addInvoiceNote').set('Authorization', authHeader)
      .send({ id: inv.id, note: 'checked', currency: 'PKR', total: '42000' });
    expect(await stored()).toMatchObject({ note: 'checked', currency: 'USD', total: '150' });
  });

  it('refused once approved - its voucher was posted in it', async () => {
    await Invoice.update({ approved: '1' }, { where: { id: inv.id }, fiscalYearCheck: false });
    const res = await change('PKR');
    expect(res.status).toBe(409);
    expect(res.body.result).toMatch(/Unapprove it first/);
    expect((await stored()).currency).toBe('USD');
  });
});

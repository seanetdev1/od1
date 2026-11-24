/**
 * Payments & Receipts' list of a party's open invoices -
 * /invoice/getAllInvoicesByPartyId with `outstanding: true`.
 *
 * Settled is what shows as 0.00 - the rounded total less what was received,
 * under half a paisa (functions/invoiceOwed). The list used "total less
 * received is not exactly 0", which kept invoices paid in full listed at 0.00
 * (a knock-off's floating point in `recieved`) or at -0.44 (their round off).
 */
const request = require('supertest');
const app = require('../../index');
const { Op } = require('sequelize');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('open invoices for Payments & Receipts', () => {
  const stamp = Date.now();
  const made = [];
  let admin; let company; const partyId = `9${String(stamp).slice(-8)}`;

  const invoice = async (label, over) => {
    const inv = await db.Invoice.create({
      invoice_No: `${TEST_PREFIX}OWED-${stamp}-${label}`, type: 'Job Invoice', payType: 'Recievable',
      operation: 'SE', status: '1', approved: '1', roundOff: '0', currency: 'PKR', ex_rate: '1',
      party_Id: partyId, party_Name: 'OWED TEST', partyType: 'client', paid: '0', recieved: '0',
      total: '1000', companyId: String(company.id), ...over,
    }, { fiscalYearCheck: false });
    made.push(inv);
    return inv;
  };
  const listed = async () => {
    const res = await request(app).get('/invoice/getAllInvoicesByPartyId').set('Authorization', admin.authHeader)
      .set('id', partyId).set('companyid', String(company.id)).set('invoicecurrency', 'PKR')
      .set('pay', 'Recievable').set('outstanding', 'true');
    expect(res.body.status).toBe('success');
    return res.body.result.map((r) => r.invoice_No.split('-').pop());
  };

  beforeAll(async () => {
    admin = await loginAs('admin');
    company = await db.Company.create({ title: `${TEST_PREFIX}Owed Co ${stamp}`, short: 'TOW' });
  });

  afterAll(async () => {
    await db.Invoice.destroy({ where: { id: made.map((i) => i.id) }, fiscalYearCheck: false });
    await db.Company.destroy({ where: { id: company.id } });
    await db.Invoice.destroy({ where: { invoice_No: { [Op.like]: `${TEST_PREFIX}OWED-${stamp}%` } }, fiscalYearCheck: false });
  });

  it('leaves out what is settled to the paisa, keeps what is not, by date', async () => {
    await invoice('ROUNDED', { total: '1234.56', roundOff: '+0.44', recieved: '1235' });
    await invoice('HAIR', { total: '1234.56', recieved: '1234.5599999999999' });
    const half = await invoice('HALF', { recieved: '999.5' });
    const part = await invoice('PART', { recieved: '400' });
    const unrounded = await invoice('UNROUNDED', { total: '1234.56', roundOff: '+0.44', recieved: '1234.56' });
    // Dated out of the order they were made in.
    const dated = (inv, d) => db.sequelize.query('UPDATE "Invoices" SET "createdAt" = :d WHERE id = :id', { replacements: { d, id: inv.id } });
    await dated(part, '2026-01-05T10:00:00Z');
    await dated(half, '2026-03-05T10:00:00Z');
    await dated(unrounded, '2026-02-05T10:00:00Z');

    expect(await listed()).toEqual(['PART', 'UNROUNDED', 'HALF']);
  });
});

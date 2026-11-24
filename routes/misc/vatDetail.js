const routes = require('express').Router();
const Sequelize = require('sequelize');
const moment = require('moment');
const db = require('../../models');
const { utcOffsetOf, reportDay, dayStart, dayEnd } = require('../../functions/trialBalance');
const { vatDetailReport } = require('../../functions/vatDetail');

const { Op } = Sequelize;

/**
 * The VAT Detail - every Sale Tax Invoice in the period, for the sales tax
 * return. See functions/vatDetail for what each column is.
 *
 * Headers: from, to ('YYYY-MM-DD'), utcoffset (the screen's, minutes),
 * company.
 *
 * IN THE PERIOD means the INVOICE's date - the date the Sale Tax Invoice
 * prints. Not when the number was given: every migrated one carries the day
 * of the migration. Only APPROVED invoices: an unapproved one is out of the
 * books until it is approved again.
 */
routes.get('/vatDetail', async (req, res) => {
  try {
    const offset = utcOffsetOf(req.headers.utcoffset);
    const fromDay = reportDay(req.headers.from, offset);
    const toDay = reportDay(req.headers.to, offset);
    if (!fromDay || !toDay) {
      return res.status(400).json({ status: 'error', result: 'A From and To date are required.' });
    }
    if (toDay < fromDay) {
      return res.status(400).json({ status: 'error', result: 'To is before From.' });
    }
    const company = /^\d+$/.test(String(req.headers.company ?? '')) ? Number(req.headers.company) : null;

    const numbers = await db.Sales_Tax_Invoice.findAll({
      where: company ? { CompanyId: company } : {},
      attributes: ['taxInvoiceNo', 'seq', 'InvoiceId'],
      raw: true,
    });
    const invoices = numbers.length ? await db.Invoice.findAll({
      where: {
        id: numbers.map((n) => n.InvoiceId),
        approved: '1',
        createdAt: { [Op.gte]: dayStart(fromDay, offset), [Op.lt]: dayEnd(toDay, offset) },
      },
      attributes: ['id', 'createdAt', 'party_Id', 'party_Name'],
      raw: true,
    }) : [];
    const invoiceIds = invoices.map((i) => i.id);

    const lines = invoiceIds.length ? await db.Charge_Head.findAll({
      where: { InvoiceId: invoiceIds },
      attributes: ['InvoiceId', 'type', 'tax_apply', 'taxPerc', 'tax_amount', 'qty', 'rate_charge',
        'discount', 'ex_rate', 'net_amount', 'CustomsJobId', 'partyId'],
      raw: true,
    }) : [];
    const linesOf = new Map();
    lines.forEach((l) => {
      if (!linesOf.has(l.InvoiceId)) linesOf.set(l.InvoiceId, []);
      linesOf.get(l.InvoiceId).push(l);
    });

    // The buyer: the party on the invoice's lines - the Clients id - as the
    // Sale Tax Invoice print takes it; an invoice whose lines name nobody falls
    // back to its ledger account's party. See printRecipient.
    const isId = (v) => /^\d+$/.test(String(v ?? ''));
    const lineParty = (id) => (linesOf.get(id) || []).map((l) => l.partyId).find(isId);
    const fallbackAccounts = invoices.filter((i) => !lineParty(i.id) && isId(i.party_Id)).map((i) => String(i.party_Id));
    const links = fallbackAccounts.length ? await db.Client_Associations.findAll({
      where: { ChildAccountId: fallbackAccounts }, attributes: ['ChildAccountId', 'ClientId'], raw: true,
    }) : [];
    const clientOfAccount = new Map(links.map((l) => [String(l.ChildAccountId), l.ClientId]));
    const buyerIdOf = (i) => lineParty(i.id) || clientOfAccount.get(String(i.party_Id)) || null;
    const buyerIds = [...new Set(invoices.map(buyerIdOf).filter(Boolean).map(Number))];
    const buyers = buyerIds.length ? await db.Clients.findAll({
      where: { id: buyerIds }, attributes: ['id', 'name', 'ntn', 'city'], raw: true,
    }) : [];
    const buyerById = new Map(buyers.map((b) => [String(b.id), b]));

    // HS code: the customs job's commodity, where it has one.
    const jobIdOf = (id) => (linesOf.get(id) || []).map((l) => l.CustomsJobId).find(Boolean);
    const jobIds = [...new Set(invoiceIds.map(jobIdOf).filter(Boolean))];
    const jobs = jobIds.length ? await db.Customs_Job.findAll({
      where: { id: jobIds }, attributes: ['id', 'CommodityId'], raw: true,
    }) : [];
    const commodityIds = [...new Set(jobs.map((j) => j.CommodityId).filter(Boolean))];
    const commodities = commodityIds.length ? await db.Commodity.findAll({
      where: { id: commodityIds }, attributes: ['id', 'hs'], raw: true,
    }) : [];
    const hsOfCommodity = new Map(commodities.map((c) => [c.id, c.hs]));
    const hsOfJob = new Map(jobs.map((j) => [j.id, hsOfCommodity.get(j.CommodityId) || '']));

    const numberOf = new Map(numbers.map((n) => [n.InvoiceId, n]));
    const documents = invoices.map((i) => {
      const n = numberOf.get(i.id);
      return {
        taxInvoiceNo: n.taxInvoiceNo,
        seq: n.seq,
        date: moment(i.createdAt).utcOffset(offset).format('YYYY-MM-DD'),
        lines: linesOf.get(i.id) || [],
        buyer: buyerById.get(String(buyerIdOf(i))) || { name: i.party_Name },
        hsCode: hsOfJob.get(jobIdOf(i.id)) || '',
      };
    });

    res.json({ status: 'success', result: { ...vatDetailReport(documents), from: fromDay, to: toDay } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

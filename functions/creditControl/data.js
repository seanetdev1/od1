/* CREDIT CONTROL - reading the books. The rules are in ./rules. */
const { Op, fn, col, where: sqlWhere } = require('sequelize');
const db = require('../../models');
const { localDate } = require('./clock');
const { AGENT_TYPES, openInvoice, partyOf, withinAge, aboveIgnoreAmount, uniq, emailOf, isActiveEmployee } = require('./rules');

const CLIENT_ATTRS = [
  'id', 'code', 'name', 'person1', 'mobile1', 'telephone1', 'accountsMail', 'infoMail', 'city',
  'creditLimitDays', 'creditLimitAmount', 'salesRepresentatorId', 'active',
];

const plainClient = (c) => {
  const p = c.get ? c.get({ plain: true }) : c;
  return { ...p, creditLimitAmount: p.creditLimitAmount == null ? null : Number(p.creditLimitAmount) };
};

/**
 * Every OPEN approved receivable - or, with payType 'Payble', bill - by party.
 *
 *   clientIds  only these parties' invoices (one party's live check, the
 *              daily check's parties with a limit); null = every party's
 *   withOmitted  keep omitted invoices, marked - the Credit Control screen
 *              shows them; every email and limit leaves them out
 *
 * Returns { clients: Map(id -> client), invoicesByClient: Map(id -> [invoice]) }.
 */
async function loadOpen({ settings, clientIds = null, withOmitted = false, now = new Date(), payType = RECEIVABLE }) {
  const { Invoice, SE_Job, Clients, Client_Associations, Charge_Head, Customs_Job, Credit_Omission } = db;
  const today = localDate(now, settings.timeZone);

  const where = { approved: '1', payType };
  if (!settings.includeAgentInvoices) where.type = { [Op.notIn]: AGENT_TYPES };
  if (settings.companies?.length) where.companyId = { [Op.in]: settings.companies.map(String) };
  // Older than the ignore limit: not even read. A day's margin - the exact age
  // is counted in the install's zone below.
  const ignore = Number(settings.ignoreOlderThanDays) || 0;
  if (ignore > 0) where.createdAt = { [Op.gte]: new Date(now.getTime() - (ignore + 1) * 86400000) };

  // One party (or a few): only what names its accounts, or - a migrated
  // customs invoice - its own id.
  let links = null;
  if (clientIds) {
    if (!clientIds.length) return { clients: new Map(), invoicesByClient: new Map() };
    links = await Client_Associations.findAll({ where: { ClientId: clientIds }, attributes: ['ClientId', 'ChildAccountId'], raw: true });
    const ids = [...links.map((l) => l.ChildAccountId).filter(Boolean), ...clientIds].map(String);
    where.party_Id = { [Op.in]: [...new Set(ids)] };
  }

  const rows = await Invoice.findAll({
    where,
    attributes: ['id', 'invoice_No', 'type', 'currency', 'ex_rate', 'total', 'roundOff', 'paid', 'recieved', 'createdAt', 'party_Id', 'party_Name', 'companyId', 'SEJobId'],
    include: [{ model: SE_Job, attributes: ['jobNo'], required: false }],
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  });

  // Too little left on it to chase: out the same way (the user's request,
  // 2026-10-26) - in rupees, so a foreign one is weighed at its own rate.
  const floor = Number(settings.ignoreBelowAmount) || 0;
  const open = [];
  for (const r of rows) {
    const inv = r.get({ plain: true });
    const o = openInvoice({ ...inv, jobNo: inv.SE_Job?.jobNo }, { today, timeZone: settings.timeZone });
    if (o && withinAge(o, ignore) && aboveIgnoreAmount(o, floor)) open.push({ ...o, party_Id: inv.party_Id, party_Name: inv.party_Name, SEJobId: inv.SEJobId });
  }
  if (!open.length) return { clients: new Map(), invoicesByClient: new Map() };

  // Omitted by an approver: out of every email and every limit.
  const omitted = new Set((await Credit_Omission.findAll({
    where: { InvoiceId: open.map((i) => i.id) }, attributes: ['InvoiceId'], raw: true,
  })).map((o) => o.InvoiceId));

  // A customs invoice's job - through its charge lines; it has no SEJobId.
  const customsIds = open.filter((i) => !i.SEJobId).map((i) => i.id);
  if (customsIds.length) {
    const lines = await Charge_Head.findAll({
      where: { InvoiceId: customsIds, CustomsJobId: { [Op.ne]: null } }, attributes: ['InvoiceId', 'CustomsJobId'], raw: true,
    });
    const jobs = lines.length ? await Customs_Job.findAll({
      where: { id: [...new Set(lines.map((l) => l.CustomsJobId))] }, attributes: ['id', 'jobNo'], raw: true,
    }) : [];
    const jobNo = new Map(jobs.map((j) => [j.id, j.jobNo]));
    const byInvoice = new Map();
    for (const l of lines) if (!byInvoice.has(l.InvoiceId)) byInvoice.set(l.InvoiceId, jobNo.get(l.CustomsJobId));
    for (const i of open) if (!i.jobNo && byInvoice.has(i.id)) i.jobNo = byInvoice.get(i.id) || null;
  }

  // Whose: the party behind each account named, and - for a migrated customs
  // invoice - a party by its own id and name.
  const named = [...new Set(open.map((i) => String(i.party_Id ?? '').trim()).filter(Boolean))];
  if (!links) {
    links = await Client_Associations.findAll({
      where: { ChildAccountId: named.map(Number).filter(Number.isFinite) }, attributes: ['ClientId', 'ChildAccountId'], raw: true,
    });
  }
  const accountClient = new Map(links.map((l) => [String(l.ChildAccountId), l.ClientId]));
  const wanted = new Set([...links.map((l) => l.ClientId), ...named.map(Number).filter(Number.isFinite)]);
  const clientRows = await Clients.findAll({ where: { id: [...wanted] }, attributes: CLIENT_ATTRS });
  const clients = new Map(clientRows.map((c) => [c.id, plainClient(c)]));

  const only = clientIds ? new Set(clientIds.map(Number)) : null;
  const invoicesByClient = new Map();
  for (const inv of open) {
    const clientId = partyOf(inv, accountClient, clients);
    if (!clientId || (only && !only.has(Number(clientId)))) continue;
    const isOmitted = omitted.has(inv.id);
    if (isOmitted && !withOmitted) continue;
    const { party_Id, party_Name, SEJobId, ...clean } = inv;
    if (!invoicesByClient.has(clientId)) invoicesByClient.set(clientId, []);
    invoicesByClient.get(clientId).push(withOmitted ? { ...clean, omitted: isOmitted } : clean);
  }
  for (const id of [...clients.keys()]) if (!invoicesByClient.has(id) && !(only && only.has(id))) clients.delete(id);
  return { clients, invoicesByClient };
}

const RECEIVABLE = 'Recievable';
const PAYABLE = 'Payble';

/** Every open receivable, by party - see loadOpen. */
const loadOpenReceivables = (opts) => loadOpen({ ...opts, payType: RECEIVABLE });

/**
 * A party's whole position: its open invoices, and the open BILLS we owe it
 * (the user's request, 2026-10-26: "some parties have payables against them
 * as well and then the net balance becomes important"). The bills are read
 * as the invoices are - approved, open, whose by the same rule, the same
 * agent, company and ignore settings, omissions honoured.
 *
 * Returns { clients, invoicesByClient, billsByClient }.
 */
async function loadOpenBalances(opts) {
  const [invoices, bills] = await Promise.all([loadOpenReceivables(opts), loadOpen({ ...opts, payType: PAYABLE })]);
  return {
    clients: new Map([...bills.clients, ...invoices.clients]),
    invoicesByClient: invoices.invoicesByClient,
    billsByClient: bills.invoicesByClient,
  };
}

/** The parties with a credit limit of either kind. */
async function clientsWithLimits() {
  const rows = await db.Clients.findAll({
    where: { [Op.or]: [{ creditLimitDays: { [Op.ne]: null } }, { creditLimitAmount: { [Op.ne]: null } }] },
    attributes: CLIENT_ATTRS,
  });
  return rows.map(plainClient);
}

/** Active employees of these designations (lowercase), with an email. */
async function employeesOf(designations) {
  if (!designations?.length) return [];
  const rows = await db.Employees.findAll({
    where: sqlWhere(fn('lower', col('designation')), { [Op.in]: designations.map((d) => d.toLowerCase()) }),
    attributes: ['id', 'name', 'email', 'designation', 'active'],
    raw: true,
  });
  return rows.filter(isActiveEmployee);
}

const addressesOf = (employees) => uniq(employees.map(emailOf).filter(Boolean));

/** Every address a run needs: management (CC), the admins, and the reps. */
async function recipientsContext(settings, repIds) {
  const [management, admins, reps] = await Promise.all([
    employeesOf(settings.recipients.management),
    employeesOf(settings.recipients.admin),
    repIds.length ? db.Employees.findAll({ where: { id: repIds }, attributes: ['id', 'name', 'email', 'designation', 'active'], raw: true }) : [],
  ]);
  return {
    management: uniq([...addressesOf(management), ...settings.recipients.extraCc]),
    admins: uniq([...addressesOf(admins), ...settings.recipients.extraAdmin]),
    reps: new Map(reps.map((r) => [String(r.id), r])),
  };
}

module.exports = { loadOpenReceivables, loadOpenBalances, clientsWithLimits, employeesOf, addressesOf, recipientsContext, CLIENT_ATTRS };

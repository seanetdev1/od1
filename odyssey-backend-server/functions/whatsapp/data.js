/* WHATSAPP DAILY UPDATE - reading the day out of the books. The report is
 * built in ./report. */
const { Op } = require('sequelize');
const db = require('../../models');
const { startOfDay, addDays } = require('../creditControl/clock');
const { jobKeyOf } = require('./report');

const INVOICE_ATTRS = ['id', 'invoice_No', 'type', 'payType', 'currency', 'ex_rate', 'total', 'roundOff', 'party_Name', 'approved', 'SEJobId', 'companyId'];

const FREIGHT_TYPE = { SE: 'Sea Export', SI: 'Sea Import', AE: 'Air Export', AI: 'Air Import' };

/**
 * The day 'YYYY-MM-DD' in `settings.timeZone`: the jobs and invoices entered
 * on it, the jobs those invoices are on, and every invoice on those jobs.
 */
async function loadDay({ date, settings }) {
  const { SE_Job, Customs_Job, Aviation_Job, Aviation_Consignment, Invoice, Charge_Head, Clients, Employees } = db;
  const range = { [Op.gte]: startOfDay(date, settings.timeZone), [Op.lt]: startOfDay(addDays(date, 1), settings.timeZone) };
  const company = settings.companies?.length ? { companyId: { [Op.in]: settings.companies.map(String) } } : {};
  // ENTERED that day - by the audit stamp. A record from before the stamps
  // (v1.2.57), or migrated, has none: it goes by its own date instead - a
  // job's date, an invoice's date - so a day looked back on still shows what
  // it held (the user previewed 8 Jan 2026 on a copy with no stamps at all
  // and got an empty report). Anything entered now is stamped, so the evening
  // send is unchanged.
  const enteredThatDay = { [Op.or]: [{ createdOn: range }, { createdOn: null, createdAt: range }] };

  // ---- bookings: every job entered that day
  const [freight, customs, aviation] = await Promise.all([
    SE_Job.findAll({
      where: { ...enteredThatDay, ...company },
      attributes: ['id', 'jobNo', 'operation', 'createdBy'],
      include: [
        { model: Clients, attributes: ['name'], required: false },
        { model: Employees, as: 'sales_representator', attributes: ['name'], required: false },
      ],
    }),
    Customs_Job.findAll({
      where: { ...enteredThatDay, ...company },
      attributes: ['id', 'jobNo', 'direction', 'transportMode', 'createdBy'],
      include: [{ model: Clients, as: 'client', attributes: ['name'], required: false }],
    }),
    Aviation_Job.findAll({
      where: { ...enteredThatDay, ...company },
      attributes: ['id', 'jobNo', 'flightNo', 'origin', 'destination', 'flightDate', 'createdBy'],
    }),
  ]);
  const bookings = [
    ...freight.map((j) => ({
      kind: 'freight', jobNo: j.jobNo, type: FREIGHT_TYPE[j.operation] || j.operation || '',
      client: j.Client?.name || '', salesRep: j.sales_representator?.name || '', enteredBy: j.createdBy || '', detail: '',
    })),
    ...customs.map((j) => ({
      kind: 'customs', jobNo: j.jobNo, type: ['Customs', j.direction, j.transportMode].filter(Boolean).join(' '),
      client: j.client?.name || '', salesRep: '', enteredBy: j.createdBy || '', detail: '',
    })),
    ...aviation.map((j) => ({
      kind: 'aviation', jobNo: j.jobNo, type: 'Flight', client: '', salesRep: '', enteredBy: j.createdBy || '',
      detail: [j.flightNo, [j.origin, j.destination].filter(Boolean).join(' - '), j.flightDate].filter(Boolean).join(' · '),
    })),
  ];

  // ---- invoices and bills raised that day
  const raised = await Invoice.findAll({
    where: { ...enteredThatDay, ...company },
    attributes: INVOICE_ATTRS,
    include: [{ model: Charge_Head, attributes: ['CustomsJobId', 'AviationConsignmentId'], required: false }],
  });
  const consignmentIds = [...new Set(raised.flatMap((i) => (i.Charge_Heads || []).map((c) => c.AviationConsignmentId)).filter(Boolean))];
  const consignmentJob = new Map((consignmentIds.length ? await Aviation_Consignment.findAll({
    where: { id: consignmentIds }, attributes: ['id', 'AviationJobId'], raw: true,
  }) : []).map((c) => [c.id, c.AviationJobId]));
  const newInvoices = raised.map((i) => ({ ...i.get({ plain: true }), jobKey: jobKeyOf(i, consignmentJob) }));

  // ---- the jobs they are on, and every invoice on those jobs
  const ids = (kind) => [...new Set(newInvoices.map((i) => i.jobKey).filter((k) => k?.startsWith(`${kind}:`)).map((k) => Number(k.split(':')[1])))];
  const [fIds, cIds, aIds] = [ids('freight'), ids('customs'), ids('aviation')];
  const jobs = new Map();
  const jobInvoices = [];

  if (fIds.length) {
    const rows = await SE_Job.findAll({ where: { id: fIds }, attributes: ['id', 'jobNo', 'operation'], include: [{ model: Clients, attributes: ['name'], required: false }] });
    rows.forEach((j) => jobs.set(`freight:${j.id}`, { kind: 'freight', jobNo: j.jobNo, type: FREIGHT_TYPE[j.operation] || j.operation || '', client: j.Client?.name || '' }));
    (await Invoice.findAll({ where: { SEJobId: fIds }, attributes: INVOICE_ATTRS, raw: true }))
      .forEach((i) => jobInvoices.push({ ...i, jobKey: `freight:${i.SEJobId}` }));
  }
  if (cIds.length) {
    const rows = await Customs_Job.findAll({ where: { id: cIds }, attributes: ['id', 'jobNo'], include: [{ model: Clients, as: 'client', attributes: ['name'], required: false }] });
    rows.forEach((j) => jobs.set(`customs:${j.id}`, { kind: 'customs', jobNo: j.jobNo, type: 'Customs', client: j.client?.name || '' }));
    const links = await Charge_Head.findAll({ where: { CustomsJobId: cIds, InvoiceId: { [Op.ne]: null } }, attributes: ['InvoiceId', 'CustomsJobId'], raw: true });
    const jobOf = new Map(links.map((l) => [l.InvoiceId, l.CustomsJobId]));
    if (jobOf.size) {
      (await Invoice.findAll({ where: { id: [...jobOf.keys()] }, attributes: INVOICE_ATTRS, raw: true }))
        .forEach((i) => jobInvoices.push({ ...i, jobKey: `customs:${jobOf.get(i.id)}` }));
    }
  }
  if (aIds.length) {
    const rows = await Aviation_Job.findAll({ where: { id: aIds }, attributes: ['id', 'jobNo', 'flightNo'] });
    rows.forEach((j) => jobs.set(`aviation:${j.id}`, { kind: 'aviation', jobNo: j.jobNo, type: `Flight${j.flightNo ? ` ${j.flightNo}` : ''}`, client: '' }));
    const cons = await Aviation_Consignment.findAll({ where: { AviationJobId: aIds }, attributes: ['id', 'AviationJobId'], raw: true });
    const flightOf = new Map(cons.map((c) => [c.id, c.AviationJobId]));
    const links = cons.length ? await Charge_Head.findAll({
      where: { AviationConsignmentId: [...flightOf.keys()], InvoiceId: { [Op.ne]: null } }, attributes: ['InvoiceId', 'AviationConsignmentId'], raw: true,
    }) : [];
    const jobOf = new Map(links.map((l) => [l.InvoiceId, flightOf.get(l.AviationConsignmentId)]));
    if (jobOf.size) {
      (await Invoice.findAll({ where: { id: [...jobOf.keys()] }, attributes: INVOICE_ATTRS, raw: true }))
        .forEach((i) => jobInvoices.push({ ...i, jobKey: `aviation:${jobOf.get(i.id)}` }));
    }
  }

  return { date, bookings, newInvoices, jobs, jobInvoices };
}

/** A heading for the report: the companies it covers. */
async function companyTitle(settings) {
  const where = settings.companies?.length ? { id: settings.companies.map(Number).filter(Number.isFinite) } : {};
  const rows = await db.Company.findAll({ where, attributes: ['title'], order: [['id', 'ASC']], raw: true });
  return rows.map((c) => c.title).filter(Boolean).join(', ') || 'Odyssey';
}

module.exports = { loadDay, companyTitle };

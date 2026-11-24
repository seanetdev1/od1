/**
 * Customs jobs as Job Profit/Loss rows.
 *
 * The report enumerates SE_Job, so goods declarations were simply absent: the
 * type filter offers "Customs Clearance" and selecting it returned nothing,
 * which reads as missing data rather than as a report that cannot see the
 * module.
 *
 * ONE ROW PER GD. The declaration is the job people file against
 * (SNS-CCJ-1/26), and its revenue and cost are the charges raised against it.
 *
 * Rows are built in the EXACT shape SE_Job returns, associations included, so
 * the screen, the Excel export and the summary tab need no customs branch.
 * Several of those fields are read unguarded (x.Client.name, x.shipper.name,
 * x.local_vendor.name), so every one is always an object here, even when a
 * clearance file has no such party.
 *
 * WHAT A CUSTOMS ROW CANNOT HAVE: a sales representative, an overseas agent, a
 * shipping line, containers. Those filters therefore EXCLUDE customs entirely
 * rather than matching it with blanks - see customsAppliesTo.
 */
const { Op } = require('sequelize');
const { reportCompanies } = require('./companyAccess');
const { totalDuty } = require('./customsDuty');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// A customs invoice carries operation 'CC'.
const CUSTOMS_OPERATION = 'CC';

/* The Sub Types filter offers FCL / LCL / AIR, and a clearance file can now
 * answer all three.
 *
 * It could not when this was written: the module captured no cargo type, so
 * the only honest mapping was Air mode to AIR, and ticking FCL or LCL excluded
 * customs entirely. The migration added Customs_Job.cargoType - 7,085 FCL and
 * 4,609 LCL on CargoLinkers' own book - so FCL and LCL are now facts the file
 * records, and AIR remains the transport mode.
 *
 * The two are read from DIFFERENT columns and combined with OR: an Air job can
 * be FCL or LCL, so a filter of "FCL and AIR" means "container files, plus
 * everything that flew", not the intersection of the two.
 *
 * A file with NO cargo type recorded - about one in four - answers neither FCL
 * nor LCL, and so drops out when either is ticked. That is the filter doing
 * its job: it was asked for container or groupage files, and the file does not
 * say which it is. */
const AIR_SUBTYPE = 'AIR';
const CARGO_SUBTYPES = ['FCL', 'LCL'];

const list = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);

/**
 * Can a customs job satisfy these filters at all?
 *
 * Answering "no" early is not an optimisation, it is correctness: a clearance
 * file has no sales representative and no overseas agent, so a report filtered
 * by either is asking for something customs cannot be part of. Returning rows
 * anyway would add ones that do not meet the stated filter.
 */
const customsAppliesTo = (filters = {}) => {
  if (filters.salesrepresentative) return false;
  if (filters.overseasagent) return false;

  const types = list(filters.jobtype);
  if (types.length && !types.includes(CUSTOMS_OPERATION)) return false;

  const subTypes = list(filters.subtype);
  // A clearance file answers FCL and LCL through its cargo type, and AIR
  // through its transport mode. A sub-type filter naming none of the three -
  // some future fourth - can have nothing to do with customs.
  if (subTypes.length
      && !subTypes.includes(AIR_SUBTYPE)
      && !subTypes.some((t) => CARGO_SUBTYPES.includes(t))) return false;

  return true;
};

/**
 * Shape one goods declaration into an SE_Job-like row.
 *
 * `invoiceShare` maps an invoice id to the fraction of that invoice belonging
 * to THIS job. It is 1 for the ordinary case - the screen only ever offers one
 * job's charges - and exists so an invoice raised across two files by anything
 * posting straight at the endpoint is not counted twice over.
 */
const declarationRow = (job, invoiceShare = {}) => {
  // Dedupe: one invoice usually covers several charges on the same file.
  const seen = new Map();
  for (const charge of job.Charge_Heads || []) {
    const inv = charge.Invoice;
    if (!inv || seen.has(inv.id)) continue;

    const ratio = invoiceShare[inv.id] === undefined ? 1 : invoiceShare[inv.id];
    seen.set(inv.id, {
      id: inv.id,
      total: String(num(inv.total) * ratio),
      payType: inv.payType,
      recieved: String(num(inv.recieved) * ratio),
      paid: String(num(inv.paid) * ratio),
      type: inv.type,
      status: inv.status,
      ex_rate: inv.ex_rate,
      currency: inv.currency,
      // Exchange gain/loss is realised against the invoice as a whole, so it
      // is apportioned the same way its total is.
      Invoice_Transactions: (inv.Invoice_Transactions || []).map((t) => ({
        ...(t.dataValues || t),
        gainLoss: num(t.gainLoss) * ratio,
      })),
    });
  }

  return {
    id: job.id,
    jobNo: job.jobNo,
    // The report's Date column, and the range it is filtered by, must be the
    // same date - otherwise a GD selected for September shows an August date
    // and looks like it should not be there. The row therefore reports the GD
    // date, falling back to when the record was created for a file opened on
    // the B/L before the declaration was filed.
    createdAt: job.gdDate || job.createdAt,
    operation: CUSTOMS_OPERATION,
    subType: job.transportMode === 'Air' ? AIR_SUBTYPE : '',
    jobType: 'Customs Clearance',
    companyId: job.companyId,
    exRate: job.exRate,

    // Route, off the transport document the GD was filed against.
    fd: job.pod || '',
    pol: job.pol || '',
    eta: job.etaDate || '',
    shipDate: job.arrivalDate || job.etaDate || '',

    weight: num(job.grossWeight),
    vol: 0,
    pcs: num(job.packages),

    // Fields a clearance file has no equivalent of. Present and empty rather
    // than absent, because the report reads several of them without guarding.
    // A clearance file DOES have one - Log_Job.CostCenterId, set on every one
    // of CargoLinkers' 15,364 jobs and decoding to "HEAD OFFICE" (HO). This
    // reported '' on the assumption it had no equivalent.
    costCenter: job.costCenter || '',
    nomination: '',
    pkgUnit: job.pkgUnit || '',
    // The GD number is what a clearing agent's customer quotes back, so it is
    // what belongs in the reference column.
    customerRef: job.gdNumber || '',

    Invoices: [...seen.values()],

    // The carrier's document standing in for the house bill, and the GD for
    // the master - a clearing agent issues neither, but these are the two
    // numbers that identify the file.
    Bl: { hbl: job.blNo || '', mbl: job.gdNumber || '' },

    Client: { name: job.client?.name || '' },
    shipper: { name: job.shipper?.name || '' },
    consignee: { name: job.consignee?.name || '' },
    commodity: { name: job.Commodity?.name || '' },

    // A clearing agent has none of these on a declaration.
    local_vendor: { name: '' },
    overseas_agent: { name: '' },
    shipping_line: { name: '' },
    sales_representator: { name: '' },
    SE_Equipments: [],

    // Not an SE_Job field, and deliberately extra: duty is the largest number
    // on a clearance file and is NOT revenue - it is assessed on the
    // consignment, and only the reimbursement of it is ever billed. Carried so
    // a reader can see why a file with a small margin moved a large sum.
    totalDuty: totalDuty(job),
  };
};

/**
 * Every invoice's share that belongs to each job.
 *
 * A customs invoice's total is the sum of its charges' local_amount (see
 * /makeInvoice), so the share is exact rather than estimated - and it is 1
 * whenever an invoice sits entirely on one job, which is every invoice the
 * screen can raise.
 */
const invoiceShares = async (jobIds, models) => {
  const { Charge_Head } = models;

  // raw: every customs charge in the book, read once for three fields. As
  // model instances that was a couple of hundred thousand objects built for
  // nothing.
  const charges = await Charge_Head.findAll({
    where: { InvoiceId: { [Op.ne]: null }, CustomsJobId: { [Op.ne]: null } },
    attributes: ['InvoiceId', 'CustomsJobId', 'local_amount'],
    raw: true,
  });

  const byInvoice = new Map();   // invoiceId -> { total, byJob: Map(jobId -> amount) }
  for (const c of charges) {
    const amount = num(c.local_amount);
    if (!byInvoice.has(c.InvoiceId)) byInvoice.set(c.InvoiceId, { total: 0, byJob: new Map() });
    const entry = byInvoice.get(c.InvoiceId);
    entry.total += amount;
    entry.byJob.set(c.CustomsJobId, (entry.byJob.get(c.CustomsJobId) || 0) + amount);
  }

  // { jobId: { invoiceId: fraction } }
  const shares = {};
  for (const jobId of jobIds) shares[jobId] = {};
  for (const [invoiceId, entry] of byInvoice) {
    for (const [jobId, amount] of entry.byJob) {
      if (!shares[jobId]) continue;
      // A zero-value invoice cannot be apportioned; give the whole of nothing
      // to each file rather than dividing by zero.
      shares[jobId][invoiceId] = entry.total ? amount / entry.total : 1;
    }
  }
  return shares;
};

/**
 * Customs rows for the Job Profit/Loss report.
 *
 * Only jobs carrying at least one APPROVED invoice come back - the same rule
 * the freight side applies by inner-joining Invoice with approved '1'. A file
 * with nothing billed against it has no profit or loss to report.
 */
const customsJobPLRows = async (filters, models) => {
  if (!customsAppliesTo(filters)) return [];

  const {
    Customs_Job, Customs_Duty, Charge_Head, Invoice, Invoice_Transactions,
    Clients, Commodity,
  } = models;

  // Every model this needs, checked BEFORE the query is built.
  //
  // A model the caller forgot becomes `{ model: undefined }` in the include
  // below, and Sequelize's own error for that names neither the model nor this
  // module - it just 500s the Job P/L report, freight and aviation rows
  // included, because they are all one response. That is exactly how the
  // customs duty rewrite broke the report: Customs_Duty was added to the
  // include here and not to the bundle in routes/misc/profitLoss.js.
  const missing = Object.entries({
    Customs_Job, Customs_Duty, Charge_Head, Invoice, Invoice_Transactions,
    Clients, Commodity,
  }).filter(([, model]) => !model).map(([name]) => name);
  if (missing.length) {
    throw new Error(
      `customsJobPLRows is missing model(s): ${missing.join(', ')}. `
      + 'Add them to the bundle passed by routes/misc/profitLoss.js - without them '
      + 'the include is built with an undefined model and the whole Job P/L report fails.',
    );
  }

  const where = {};

  // Same company rules as the freight branch: '4' is the legacy Seanet
  // "companies 1 and 3", 'all' means no company filter.
  // A list is a restricted user's own 'all' (functions/companyAccess).
  const companyIds = reportCompanies(filters.company, filters.allowedCompanies);
  if (companyIds) where.companyId = { [Op.in]: companyIds };

  // The Client filter names the party the file is being cleared for.
  if (filters.client) where.clientId = filters.client;

  /* Sub types, from two different columns, combined with OR - see the note on
   * CARGO_SUBTYPES. Ticking all three asks for everything the filter can
   * describe, which is what a screen with every box ticked should mean; it
   * used to mean "air files only", and quietly returned 284 rows out of 4,822
   * on CargoLinkers' book. */
  const subTypes = list(filters.subtype);
  if (subTypes.length) {
    const cargo = subTypes.filter((t) => CARGO_SUBTYPES.includes(t));
    const or = [];
    if (cargo.length) or.push({ cargoType: { [Op.in]: cargo } });
    if (subTypes.includes(AIR_SUBTYPE)) or.push({ transportMode: 'Air' });
    // One condition needs no OR wrapper, and Sequelize is happier without it.
    if (or.length === 1) Object.assign(where, or[0]);
    else if (or.length > 1) where[Op.or] = or;
  }

  // Ranged on the GD DATE, not on when the record was typed. For a clearing
  // agent "September" means the declarations filed in September, and a file
  // opened in August whose GD went in on 2 September belongs to September.
  //
  // gdDate is a 'YYYY-MM-DD' string, which compares correctly with plain
  // string operators - ISO dates sort lexicographically. The bound is
  // INCLUSIVE of `to`, matching the freight side's `< to + 1 day` on a
  // timestamp.
  if (filters.from || filters.to) {
    const gdRange = {};
    if (filters.from) gdRange[Op.gte] = filters.from;
    if (filters.to) gdRange[Op.lte] = filters.to;

    const createdRange = {};
    if (filters.fromDate) createdRange[Op.gte] = filters.fromDate;
    if (filters.toDate) createdRange[Op.lte] = filters.toDate;

    where[Op.or] = [
      { gdDate: gdRange },
      // A file whose GD has not been filed yet would otherwise disappear from
      // every date-ranged report, taking its billed agency fee with it.
      // Falling back to when the record was created keeps it visible and in a
      // sensible period.
      {
        [Op.and]: [
          { [Op.or]: [{ gdDate: null }, { gdDate: '' }] },
          { createdAt: createdRange },
        ],
      },
    ];
  }

  /* FLAT QUERIES, JOINED HERE.

     This was one query joining each file to its duty lines, its charges, each
     charge's invoice and each invoice's transactions. Postgres returns a row
     for every combination of those - 218,296 rows for 23,178 files on
     CargoLinkers' book, about nine per file - and Sequelize then folds them
     back into nested model instances. Measured on the full book: 8 seconds in
     Postgres and 30 in Node, for a report that reads a handful of figures per
     invoice. Each query below returns at most one row per thing it fetches,
     and the charge/invoice/transaction rows come back raw, so no model
     instance is built for them at all.

     The result is the same nested shape declarationRow always received. */
  // raw + nest: plain objects rather than model instances. Building an
  // instance per file, with its four parties, was 3 of the remaining seconds.
  const jobs = await Customs_Job.findAll({
    where,
    include: [
      { model: Clients, as: 'client',    attributes: ['id', 'name'], required: false },
      { model: Clients, as: 'shipper',   attributes: ['id', 'name'], required: false },
      { model: Clients, as: 'consignee', attributes: ['id', 'name'], required: false },
      { model: Commodity, attributes: ['id', 'name'], required: false },
    ],
    raw: true,
    nest: true,
  });

  if (!jobs.length) return [];

  const jobIds = jobs.map((j) => j.id);

  // Duty is assessed per item on Customs_Duty, so the totalDuty column below is
  // derived from these rows. Without them every row would report duty as 0 -
  // which reads as a duty-free consignment rather than as a missing join. Its
  // own query, so a file's duty lines do not multiply its rows.
  const dutyKey = ['CustomsJobId', 'customsJobId'].find((k) => Customs_Duty.rawAttributes[k]) || 'CustomsJobId';
  const dutiesByJob = new Map();
  const duties = await Customs_Duty.findAll({ where: { [dutyKey]: { [Op.in]: jobIds } }, raw: true });
  for (const d of duties) {
    const key = String(d[dutyKey]);
    if (!dutiesByJob.has(key)) dutiesByJob.set(key, []);
    dutiesByJob.get(key).push(d);
  }

  // Each file's APPROVED invoices. One row per charge carrying its one invoice
  // (a charge belongs to a single invoice, so this does not fan out).
  const billed = await Charge_Head.findAll({
    where: { CustomsJobId: { [Op.in]: jobIds } },
    attributes: ['CustomsJobId'],
    include: [{
      model: Invoice,
      required: true,
      where: { approved: '1' },
      attributes: ['id', 'total', 'payType', 'recieved', 'paid', 'type',
                   'status', 'ex_rate', 'currency'],
    }],
    raw: true,
    nest: true,
  });

  const invoicesByJob = new Map();   // jobId -> Map(invoiceId -> invoice)
  for (const c of billed) {
    const jobKey = String(c.CustomsJobId);
    if (!invoicesByJob.has(jobKey)) invoicesByJob.set(jobKey, new Map());
    invoicesByJob.get(jobKey).set(String(c.Invoice.id), c.Invoice);
  }

  // Their transactions, for the realised figures and gain/loss. The foreign
  // key's spelling is resolved rather than assumed - it comes from an
  // association, and routes read it under both spellings.
  const txKey = ['InvoiceId', 'invoiceId'].find((k) => Invoice_Transactions.rawAttributes[k]) || 'InvoiceId';
  const invoiceIds = [...new Set(billed.map((c) => c.Invoice.id))];
  const txByInvoice = new Map();
  if (invoiceIds.length) {
    const txs = await Invoice_Transactions.findAll({
      where: { [txKey]: { [Op.in]: invoiceIds } },
      raw: true,
    });
    for (const t of txs) {
      const key = String(t[txKey]);
      if (!txByInvoice.has(key)) txByInvoice.set(key, []);
      txByInvoice.get(key).push(t);
    }
  }

  const shares = await invoiceShares(jobIds, models);

  const rows = [];
  for (const j of jobs) {
    const invoices = invoicesByJob.get(String(j.id));
    // A file with nothing approved billed against it has no profit or loss -
    // the rule the old inner join on Charge_Head enforced.
    if (!invoices) continue;
    const job = { ...j, Customs_Duties: dutiesByJob.get(String(j.id)) || [] };
    job.Charge_Heads = [...invoices.values()].map((inv) => ({
      Invoice: { ...inv, Invoice_Transactions: txByInvoice.get(String(inv.id)) || [] },
    }));
    rows.push(declarationRow(job, shares[j.id] || {}));
  }
  return rows;
};

module.exports = {
  customsJobPLRows, customsAppliesTo, declarationRow,
  CUSTOMS_OPERATION, AIR_SUBTYPE,
};

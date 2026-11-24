/**
 * Aviation flights as Job Profit/Loss rows.
 *
 * The report enumerates SE_Job, so aviation flights were simply absent: the
 * type filter offered "Aviation" and selecting it returned nothing, which
 * reads as missing data rather than as a report that cannot see the module.
 *
 * ONE ROW PER FLIGHT. A flight is the job people file against (IFA-AVJ-1/27),
 * and its revenue and cost are those of every AWB on board. Because a flight
 * carries many shippers, the Client column names the shipper when there is
 * only one and says "Multiple (n)" otherwise - it is never blank and never
 * silently picks one of several.
 *
 * Rows are built in the EXACT shape SE_Job returns, associations included, so
 * the screen, the Excel export and the summary tab need no aviation branch.
 * Several of those fields are read unguarded (x.Client.name, x.shipper.name,
 * x.local_vendor.name), so every one is always an object here, even when
 * aviation has no such party.
 *
 * WHAT AN AVIATION ROW CANNOT HAVE: a sales representative, an overseas agent,
 * a shipping line, containers. Those filters therefore EXCLUDE aviation
 * entirely rather than matching it with blanks - see aviationAppliesTo.
 */
const { Op } = require('sequelize');
const { reportCompanies } = require('./companyAccess');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// An aviation invoice carries operation 'AV'; the Sub Types filter offers
// FCL / LCL / AIR, and a flight is air.
const AVIATION_OPERATION = 'AV';
const AVIATION_SUBTYPE = 'AIR';

const list = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);

/**
 * Can an aviation flight satisfy these filters at all?
 *
 * Answering "no" early is not an optimisation, it is correctness: a flight has
 * no sales representative and no overseas agent, so a report filtered by
 * either is asking for something aviation cannot be part of. Returning flights
 * anyway would add rows that do not meet the stated filter.
 */
const aviationAppliesTo = (filters = {}) => {
  if (filters.salesrepresentative) return false;
  if (filters.overseasagent) return false;

  const types = list(filters.jobtype);
  if (types.length && !types.includes(AVIATION_OPERATION)) return false;

  const subTypes = list(filters.subtype);
  if (subTypes.length && !subTypes.includes(AVIATION_SUBTYPE)) return false;

  return true;
};

/** One name, or "Multiple (n)", or ''. Never one of several picked at random. */
const oneOrMany = (names) => {
  const distinct = [...new Set(names.filter(Boolean))];
  if (!distinct.length) return '';
  return distinct.length === 1 ? distinct[0] : `Multiple (${distinct.length})`;
};

/**
 * Shape one flight into an SE_Job-like row.
 *
 * `invoiceShare` maps an invoice id to the fraction of that invoice belonging
 * to THIS flight. It is 1 for the ordinary case. It matters when a shipment
 * too big for one aircraft goes out over several flights: those legs share an
 * AWB and are billed on ONE invoice, so charging its full total to every leg
 * would report the same revenue two or three times over.
 */
const flightRow = (job, invoiceShare = {}) => {
  const lines = job.Aviation_Consignments || [];

  // Dedupe: one invoice usually covers several charges on several AWBs.
  const seen = new Map();
  for (const line of lines) {
    for (const charge of line.Charge_Heads || []) {
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
  }

  const awbs = lines.map((l) => String(l.awb || '').trim()).filter(Boolean);

  return {
    id: job.id,
    jobNo: job.jobNo,
    // The report's Date column, and the range it is filtered by, must be the
    // same date - otherwise a flight selected for September shows an August
    // date and looks like it should not be there. The row therefore reports
    // the FLIGHT date, falling back to when the record was created for a
    // flight that has none.
    createdAt: job.flightDate || job.createdAt,
    operation: AVIATION_OPERATION,
    subType: AVIATION_SUBTYPE,
    jobType: 'Aviation',
    companyId: job.companyId,
    exRate: job.exRate,

    // Route. `fd` is the final destination column; `pol` the port of loading -
    // for a flight, the two airports it flew between.
    fd: job.destination || '',
    pol: job.origin || '',
    eta: job.flightDate || '',
    shipDate: job.departureDate || job.flightDate || '',

    weight: lines.reduce((t, l) => t + num(l.grossWeight), 0),
    vol: lines.reduce((t, l) => t + num(l.volume), 0),
    pcs: lines.reduce((t, l) => t + num(l.pieces), 0),

    // Fields a flight has no equivalent of. Present and empty rather than
    // absent, because the report reads several of them without guarding.
    costCenter: '',
    nomination: '',
    pkgUnit: '',
    customerRef: job.flightNo || '',

    Invoices: [...seen.values()],

    // The AWBs standing in for the house/master bill: an AWB is what a flight's
    // shipment is identified by, and the flight number is what they moved on.
    Bl: { hbl: awbs.join(', '), mbl: job.flightNo || '' },

    Client: { name: oneOrMany(lines.map((l) => l.shipper?.name)) },
    shipper: { name: oneOrMany(lines.map((l) => l.shipper?.name)) },
    consignee: { name: oneOrMany(lines.map((l) => l.consignee?.name)) },
    local_vendor: { name: oneOrMany(lines.map((l) => l.masterAgent?.name)) },
    commodity: { name: oneOrMany(lines.map((l) => l.Commodity?.name)) },

    // An airline flying its own aircraft has none of these.
    overseas_agent: { name: '' },
    shipping_line: { name: '' },
    sales_representator: { name: '' },
    SE_Equipments: [],
  };
};

/**
 * Every invoice's share that belongs to each flight.
 *
 * An aviation invoice's total is the sum of its charges' local_amount (see
 * /makeInvoice), so the share is exact rather than estimated - and it is 1
 * whenever an invoice sits entirely on one flight, which is nearly always.
 */
const invoiceShares = async (jobIds, models) => {
  const { Charge_Head, Aviation_Consignment } = models;

  const charges = await Charge_Head.findAll({
    where: { InvoiceId: { [Op.ne]: null }, AviationConsignmentId: { [Op.ne]: null } },
    attributes: ['InvoiceId', 'local_amount'],
    include: [{
      model: Aviation_Consignment,
      attributes: ['AviationJobId'],
      required: true,
    }],
  });

  const byInvoice = new Map();   // invoiceId -> { total, byJob: Map(jobId -> amount) }
  for (const c of charges) {
    const jobId = c.Aviation_Consignment?.AviationJobId;
    const amount = num(c.local_amount);
    if (!byInvoice.has(c.InvoiceId)) byInvoice.set(c.InvoiceId, { total: 0, byJob: new Map() });
    const entry = byInvoice.get(c.InvoiceId);
    entry.total += amount;
    entry.byJob.set(jobId, (entry.byJob.get(jobId) || 0) + amount);
  }

  // { jobId: { invoiceId: fraction } }
  const shares = {};
  for (const jobId of jobIds) shares[jobId] = {};
  for (const [invoiceId, entry] of byInvoice) {
    for (const [jobId, amount] of entry.byJob) {
      if (!shares[jobId]) continue;
      // A zero-value invoice cannot be apportioned; give the whole of nothing
      // to each leg rather than dividing by zero.
      shares[jobId][invoiceId] = entry.total ? amount / entry.total : 1;
    }
  }
  return shares;
};

/**
 * Aviation rows for the Job Profit/Loss report.
 *
 * Only flights carrying at least one APPROVED invoice come back - the same
 * rule the freight side applies by inner-joining Invoice with approved '1'.
 * A flight with nothing billed against it has no profit or loss to report.
 */
const aviationJobPLRows = async (filters, models) => {
  if (!aviationAppliesTo(filters)) return [];

  const {
    Aviation_Job, Aviation_Consignment, Charge_Head, Invoice,
    Invoice_Transactions, Clients, Commodity,
  } = models;

  const where = {};

  // Same company rules as the freight branch: '4' is the legacy Seanet
  // "companies 1 and 3", 'all' means no company filter.
  // A list is a restricted user's own 'all' (functions/companyAccess).
  const companyIds = reportCompanies(filters.company, filters.allowedCompanies);
  if (companyIds) where.companyId = { [Op.in]: companyIds };

  // Ranged on the FLIGHT DATE, not on when the record was typed. For an
  // airline "September" means the flights that operated in September, and a
  // flight entered in August for a September departure belongs to September.
  //
  // flightDate is a 'YYYY-MM-DD' string, which compares correctly with plain
  // string operators - ISO dates sort lexicographically. The bound is
  // INCLUSIVE of `to`, matching the freight side's `< to + 1 day` on a
  // timestamp.
  if (filters.from || filters.to) {
    const flightRange = {};
    if (filters.from) flightRange[Op.gte] = filters.from;
    if (filters.to) flightRange[Op.lte] = filters.to;

    const createdRange = {};
    if (filters.fromDate) createdRange[Op.gte] = filters.fromDate;
    if (filters.toDate) createdRange[Op.lte] = filters.toDate;

    where[Op.or] = [
      { flightDate: flightRange },
      // A flight with no date recorded would otherwise disappear from every
      // date-ranged report, taking its revenue with it. Falling back to when
      // the record was created keeps it visible and in a sensible period.
      {
        [Op.and]: [
          { [Op.or]: [{ flightDate: null }, { flightDate: '' }] },
          { createdAt: createdRange },
        ],
      },
    ];
  }

  const consignmentWhere = {};
  // The Client filter names a party; on a flight that is an AWB's shipper.
  if (filters.client) consignmentWhere.shipperId = filters.client;

  const jobs = await Aviation_Job.findAll({
    where,
    include: [{
      model: Aviation_Consignment,
      required: true,
      where: Object.keys(consignmentWhere).length ? consignmentWhere : undefined,
      include: [
        { model: Clients, as: 'shipper', attributes: ['id', 'name'], required: false },
        { model: Clients, as: 'consignee', attributes: ['id', 'name'], required: false },
        { model: Clients, as: 'masterAgent', attributes: ['id', 'name'], required: false },
        { model: Commodity, attributes: ['id', 'name'], required: false },
        {
          model: Charge_Head,
          required: true,
          attributes: ['id', 'InvoiceId', 'local_amount'],
          include: [{
            model: Invoice,
            required: true,
            where: { approved: '1' },
            attributes: ['id', 'total', 'payType', 'recieved', 'paid', 'type',
                         'status', 'ex_rate', 'currency'],
            include: [{ model: Invoice_Transactions, required: false }],
          }],
        },
      ],
    }],
  });

  if (!jobs.length) return [];

  const shares = await invoiceShares(jobs.map((j) => j.id), models);
  return jobs.map((j) => flightRow(j, shares[j.id] || {}));
};

module.exports = {
  aviationJobPLRows, aviationAppliesTo, flightRow, oneOrMany,
  AVIATION_OPERATION, AVIATION_SUBTYPE,
};

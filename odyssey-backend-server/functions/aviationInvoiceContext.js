/**
 * Attach flight context to aviation invoices.
 *
 * The invoice-driven reports - Job Balancing, Invoice Balancing - read their
 * job columns off `Invoice.SE_Job`. An aviation invoice has no SE_Job: its
 * charges hang off an AWB (Charge_Heads.AviationConsignmentId), which belongs
 * to a flight. So those rows arrive with every job column blank, and anything
 * dereferencing the job outright throws.
 *
 * This adds an `aviation` block to the rows that need one and CHANGES NOTHING
 * ELSE. A freight invoice comes back exactly as before, with `aviation: null`.
 * That is the whole point: the reports are shared, and the freight paths
 * through them must not move.
 *
 *   invoice.aviation = {
 *     jobId, jobNo, flightNo, flightDate, sector, awbs: ['214-12345678', ...]
 *   }
 *
 * Costs one query per call, regardless of how many invoices there are, and
 * none at all when a month has no aviation invoices in it.
 */

/**
 * @param invoices  Sequelize Invoice instances that already include
 *                  Charge_Head (every caller does).
 * @param models    { Aviation_Consignment, Aviation_Job, Aviation_Carrier }
 */
async function attachAviationContext(invoices, models) {
  const rows = Array.isArray(invoices) ? invoices : [];
  if (!rows.length) return rows;

  const { Aviation_Consignment, Aviation_Job, Aviation_Carrier } = models;

  // Only invoices with no freight job can be aviation ones. Checking this
  // first is what keeps a purely freight month from costing an extra query.
  const candidates = rows.filter((inv) => !inv.SEJobId);
  if (!candidates.length) {
    rows.forEach((inv) => { inv.dataValues.aviation = null; });
    return rows;
  }

  const consignmentIds = new Set();
  const idsByInvoice = new Map();
  for (const inv of candidates) {
    const ids = (inv.Charge_Heads || [])
      .map((c) => c.AviationConsignmentId)
      .filter(Boolean);
    if (!ids.length) continue;
    idsByInvoice.set(inv.id, [...new Set(ids)]);
    ids.forEach((id) => consignmentIds.add(id));
  }

  if (!consignmentIds.size) {
    rows.forEach((inv) => { inv.dataValues.aviation = null; });
    return rows;
  }

  const consignments = await Aviation_Consignment.findAll({
    where: { id: [...consignmentIds] },
    attributes: ['id', 'awb', 'AviationCarrierId'],
    include: [
      {
        model: Aviation_Job,
        attributes: ['id', 'jobNo', 'flightNo', 'flightDate', 'origin', 'destination'],
        required: false,
      },
      { model: Aviation_Carrier, attributes: ['prefix'], required: false },
    ],
  });
  const byConsignment = new Map(consignments.map((c) => [c.id, c]));

  for (const inv of rows) {
    const ids = idsByInvoice.get(inv.id);
    if (!ids) { inv.dataValues.aviation = null; continue; }

    const lines = ids.map((id) => byConsignment.get(id)).filter(Boolean);
    const job = lines.find((l) => l.Aviation_Job)?.Aviation_Job;
    if (!job) { inv.dataValues.aviation = null; continue; }

    inv.dataValues.aviation = {
      jobId: job.id,
      jobNo: job.jobNo,
      flightNo: job.flightNo,
      flightDate: job.flightDate,
      sector: [job.origin, job.destination].filter(Boolean).join(' - '),
      // An invoice can cover several AWBs, and a shipment split across two
      // flights puts the same AWB on more than one - so the list is unique
      // and the report shows what was actually billed.
      awbs: [...new Set(lines.map((l) => {
        const prefix = l.Aviation_Carrier?.prefix;
        return prefix && l.awb ? `${prefix}-${l.awb}` : (l.awb || '');
      }).filter(Boolean))],
    };
  }

  return rows;
}

module.exports = { attachAviationContext };

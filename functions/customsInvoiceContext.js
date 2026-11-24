/**
 * Attach declaration context to customs invoices.
 *
 * The invoice-driven reports - Job Balancing, Invoice Balancing - read their
 * job columns off `Invoice.SE_Job`. A customs invoice has no SE_Job: its
 * charges hang off a goods declaration (Charge_Heads.CustomsJobId). So those
 * rows arrive with every job column blank, and anything dereferencing the job
 * outright throws.
 *
 * This adds a `customs` block to the rows that need one and CHANGES NOTHING
 * ELSE. A freight invoice comes back exactly as before, with `customs: null`.
 * That is the whole point: the reports are shared, and the freight paths
 * through them must not move.
 *
 *   invoice.customs = {
 *     jobId, jobNo, jobDate, gdNumber, gdDate, blNo, direction, transportMode,
 *     clientInvoiceNo    - the client's own invoice (Job Details > Client
 *                          Invoice; clientRef on jobs saved before it had a
 *                          column of its own)
 *   }
 *
 * Costs ONE query per call regardless of how many invoices there are, and none
 * at all when a month has no customs invoices in it.
 *
 * Simpler than the aviation equivalent by one level: a customs charge names
 * its job directly, where an aviation charge names a consignment that names a
 * flight. There is no second lookup and no list to de-duplicate.
 */

/**
 * @param invoices  Sequelize Invoice instances that already include
 *                  Charge_Head (every caller does).
 * @param models    { Customs_Job }
 */
async function attachCustomsContext(invoices, models) {
  const rows = Array.isArray(invoices) ? invoices : [];
  if (!rows.length) return rows;

  const { Customs_Job } = models;

  // Only invoices with no freight job can be customs ones. Checking this first
  // is what keeps a purely freight month from costing an extra query.
  const candidates = rows.filter((inv) => !inv.SEJobId);
  if (!candidates.length) {
    rows.forEach((inv) => { inv.dataValues.customs = null; });
    return rows;
  }

  const jobIds = new Set();
  const idByInvoice = new Map();
  for (const inv of candidates) {
    // An invoice raised from one job's charges names one job. Taking the
    // FIRST rather than asserting there is only one: a payload that reached
    // /makeInvoice with charges from two files would otherwise throw here,
    // in a report, long after the invoice was raised - and reporting one of
    // the two jobs is better than reporting nothing at all.
    const id = (inv.Charge_Heads || [])
      .map((c) => c.CustomsJobId)
      .find(Boolean);
    if (!id) continue;
    idByInvoice.set(inv.id, id);
    jobIds.add(id);
  }

  if (!jobIds.size) {
    rows.forEach((inv) => { inv.dataValues.customs = null; });
    return rows;
  }

  const jobs = await Customs_Job.findAll({
    where: { id: [...jobIds] },
    attributes: ['id', 'jobNo', 'jobDate', 'gdNumber', 'gdDate', 'blNo', 'direction', 'transportMode', 'invoiceNo', 'clientRef'],
  });
  const byId = new Map(jobs.map((j) => [j.id, j]));

  for (const inv of rows) {
    const job = byId.get(idByInvoice.get(inv.id));
    inv.dataValues.customs = job ? {
      jobId: job.id,
      jobNo: job.jobNo,
      jobDate: job.jobDate || '',
      gdNumber: job.gdNumber || '',
      gdDate: job.gdDate || '',
      blNo: job.blNo || '',
      direction: job.direction || '',
      transportMode: job.transportMode || '',
      clientInvoiceNo: job.invoiceNo || job.clientRef || '',
    } : null;
  }

  return rows;
}

module.exports = { attachCustomsContext };

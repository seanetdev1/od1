/**
 * JOB BALANCING > PENDING - the jobs in the period with NO invoice against
 * them (the user, 2026-11-20: "a pending option in job balancing that shows
 * jobs without invoices against them").
 *
 * WHICH INVOICE COUNTS (my calls, unconfirmed):
 *   - Of the side the report is run for: Receivable lists jobs not yet billed
 *     to anyone, Payable jobs with no bill, All jobs with neither.
 *   - APPROVED only, as everything else on the report: a job whose only
 *     invoice is unapproved is still pending - it is not in the books - and
 *     its row names that invoice ("JI-12/27 (unapproved)") so nobody raises
 *     a second one.
 *   - Any invoice type, an agent's included: a job billed to its overseas
 *     agent has been billed.
 *   - Cancelled jobs are left out.
 *
 * The period is the JOB's date (its jobDate, else when it was entered) - a job
 * with no invoice has no invoice date to go by.
 *
 * Freight jobs (SE_Jobs) and goods declarations (Customs_Jobs), whichever the
 * install has; flights are not covered. A row has the shape of the report's
 * invoice rows - an SE_Job, or the `customs` block attachCustomsContext
 * gives - with no invoice and nothing owed, so the report's columns fill in
 * as they do for an invoice.
 */

const { pkDay } = require('./pkDay');

const FREIGHT_TYPES = ['SE', 'SI', 'AE', 'AI'];
const CUSTOMS_TYPE = 'CC';

const given = (v) => v !== undefined && v !== null && v !== '' && v !== 'undefined' && v !== 'null';
// The day in Pakistan - the browser sends an instant (functions/pkDay).
const day = (v) => pkDay(v);
const listOf = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map((s) => String(s).trim()).filter(Boolean);

/** Which job tables the filter asks for - by the Operation Types ticked. */
function wanted({ jobtypes, overseasAgent } = {}) {
  const types = listOf(jobtypes);
  return {
    freightOps: types.length ? types.filter((t) => FREIGHT_TYPES.includes(t)) : FREIGHT_TYPES,
    // A goods declaration has no overseas agent.
    customs: (!types.length || types.includes(CUSTOMS_TYPE)) && !given(overseasAgent),
  };
}

/** A report row for a job with no invoice - see the header. */
function pendingRow({ id, companyId, createdAt, partyName, side, unapproved }, job) {
  return {
    id: `pending-${id}`,
    pending: true,
    // What the Inv. No column reads - the viewer, grid, Excel and print alike.
    invoice_No: unapproved ? `${unapproved} (unapproved)` : 'Not invoiced',
    payType: side || 'All',
    currency: '',
    ex_rate: '1',
    roundOff: '0',
    total: '0',
    paid: '0',
    recieved: '0',
    createdAt,
    party_Name: partyName || '',
    companyId,
    vendorTaxInvoiceNo: '',
    Charge_Heads: [],
    ...job,
  };
}

/**
 * @param db  { sequelize, SE_Job }, plus the SE_Job attributes and include the
 *            report uses, so a pending freight row carries the same fields
 * @param f   { from, to, payType, companies, jobtypes, party, overseasAgent }
 */
async function pendingJobRows(db, f = {}) {
  const { sequelize, SE_Job, seJobAttributes, seJobInclude } = db;
  const from = day(f.from);
  const to = day(f.to);
  if (!from || !to) return [];
  const side = f.payType === 'Recievable' || f.payType === 'Payble' ? f.payType : null;
  const want = wanted(f);
  const repl = { from, to, side };
  const companies = Array.isArray(f.companies) && f.companies.length ? f.companies.map(String) : null;
  if (companies) repl.companies = companies;
  if (given(f.party)) repl.party = String(f.party);
  if (given(f.overseasAgent)) repl.agent = String(f.overseasAgent);
  const sideSql = side ? 'AND i."payType" = :side' : '';
  // The job's date, else the day it was entered - in Pakistan, as the From and
  // To are (createdAt::text is the database session's zone, UTC on the servers).
  const jobDay = (alias) => `coalesce(nullif(left(${alias}."jobDate", 10), ''), to_char(${alias}."createdAt" AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD'))`;
  const rows = [];

  if (want.freightOps.length) {
    repl.ops = want.freightOps;
    const [ids] = await sequelize.query(`
      WITH billed AS (
        SELECT DISTINCT i."SEJobId" AS job FROM "Invoices" i
        WHERE i."SEJobId" IS NOT NULL AND i.approved = '1' ${sideSql}
      ), unapproved AS (
        SELECT i."SEJobId" AS job, string_agg(i."invoice_No", ', ' ORDER BY i.id) AS nos FROM "Invoices" i
        WHERE i."SEJobId" IS NOT NULL AND coalesce(i.approved, '0') <> '1' ${sideSql}
        GROUP BY 1
      )
      SELECT j.id, j."createdAt", j."companyId", c.name AS "partyName", u.nos AS unapproved
      FROM "SE_Jobs" j
      LEFT JOIN billed b ON b.job = j.id
      LEFT JOIN unapproved u ON u.job = j.id
      LEFT JOIN "Clients" c ON c.id = j."ClientId"
      WHERE b.job IS NULL
        AND coalesce(j.canceled, false) = false
        AND ${jobDay('j')} BETWEEN :from AND :to
        AND j.operation IN (:ops)
        ${companies ? 'AND j."companyId"::text IN (:companies)' : ''}
        ${repl.party ? 'AND j."ClientId"::text = :party' : ''}
        ${repl.agent ? 'AND j."overseasAgentId"::text = :agent' : ''}
      ORDER BY ${jobDay('j')}, j.id`, { replacements: repl });
    if (ids.length) {
      const jobs = await SE_Job.findAll({
        where: { id: ids.map((r) => r.id) },
        attributes: [...new Set([...(seJobAttributes || ['id', 'jobNo']), 'createdAt', 'jobDate'])],
        include: seJobInclude,
      });
      const byId = new Map(jobs.map((j) => [j.id, j.get({ plain: true })]));
      for (const r of ids) {
        const job = byId.get(r.id);
        if (job) rows.push(pendingRow({ ...r, side }, { SE_Job: job }));
      }
    }
  }

  if (want.customs) {
    // Worked out once each and joined - a lookup through every charge line
    // per job took CL's copy ~110 s for four months.
    const [jobs] = await sequelize.query(`
      WITH lines AS (
        SELECT DISTINCT ch."CustomsJobId" AS job, i.id, i."invoice_No", i.approved
        FROM "Charge_Heads" ch JOIN "Invoices" i ON i.id = ch."InvoiceId"
        WHERE ch."CustomsJobId" IS NOT NULL ${sideSql}
      ), billed AS (
        SELECT DISTINCT job FROM lines WHERE approved = '1'
      ), unapproved AS (
        SELECT job, string_agg(DISTINCT "invoice_No", ', ') AS nos FROM lines
        WHERE coalesce(approved, '0') <> '1' GROUP BY 1
      )
      SELECT j.id, j."jobNo", j."jobDate", j."gdNumber", j."gdDate", j."blNo", j.direction, j."transportMode",
             j."invoiceNo", j."clientRef", j."createdAt", j."companyId", c.name AS "partyName", u.nos AS unapproved
      FROM "Customs_Jobs" j
      LEFT JOIN billed b ON b.job = j.id
      LEFT JOIN unapproved u ON u.job = j.id
      LEFT JOIN "Clients" c ON c.id = j."clientId"
      WHERE b.job IS NULL
        AND coalesce(j.canceled, false) = false
        AND ${jobDay('j')} BETWEEN :from AND :to
        ${companies ? 'AND j."companyId"::text IN (:companies)' : ''}
        ${repl.party ? 'AND j."clientId"::text = :party' : ''}
      ORDER BY ${jobDay('j')}, j.id`, { replacements: repl });
    for (const j of jobs) {
      rows.push(pendingRow({ ...j, side }, {
        customs: {
          jobId: j.id,
          jobNo: j.jobNo,
          jobDate: j.jobDate || '',
          gdNumber: j.gdNumber || '',
          gdDate: j.gdDate || '',
          blNo: j.blNo || '',
          direction: j.direction || '',
          transportMode: j.transportMode || '',
          clientInvoiceNo: j.invoiceNo || j.clientRef || '',
        },
      }));
    }
  }

  return rows;
}

module.exports = { pendingJobRows, wanted, pendingRow };

/**
 * Invoice migration - Invoice, and the charge lines each invoice carries.
 * Plan, apply, verify.
 *
 * /invoice/uploadbulkInvoices, /invoice/createBulkInvoices and the ledger
 * importer in steps.js are untouched.
 *
 *   POST /invoiceMigration/plan    what would happen, writes nothing
 *   POST /invoiceMigration/apply   one kind, one batch, one transaction
 *   GET  /invoiceMigration/verify  what a row count cannot see
 *
 * 32,251 job-linked invoices across three legacy tables, carrying 102,820 of
 * the 103,112 charge lines. Depends on the Jobs and Charge Lines stages.
 * Opening balances and settlement are out of scope - see the planner header.
 */

const routes = require('express').Router();
const db = require('../../models');
const { SE_Job, Charge_Head, Invoice, Clients, Company, Client_Associations } = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planInvoices, KINDS } = require('../../functions/invoiceMigrationPlan');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;
const MAX_BATCH = 5000;

function readBatch(body) {
  const kind = body?.kind;
  if (!KINDS[kind]) return null;
  if (!Array.isArray(body?.rows)) return null;
  return {
    kind,
    rows: body.rows,
    links: Array.isArray(body.links) ? body.links : [],
    parentKey: typeof body.parentKey === 'string' ? body.parentKey : null,
    currencies: Array.isArray(body.currencies) ? body.currencies : [],
  };
}

/**
 * Everything the planner needs, in four queries.
 *
 * chargeHeadByKey is the expensive one: it is the whole charge-line table,
 * keyed by operation + type + legacy id. It has to be all three, because a
 * legacy charge-line id is only unique within its own source table - the same
 * id exists as a sea-export receivable and an air-export receivable, and they
 * are different money. Charge_Head has no operation column, so the operation
 * comes through the job.
 *
 * THROUGH THE JOB - BUT NOT ONLY SE_Job. This joined SE_Job with
 * `required: true`, an INNER join, and then skipped any row without an
 * operation. A clearing-job charge line has no SE_Job at all: its parent is
 * CustomsJobId. So every one of them was excluded from this index twice over,
 * and no clearance charge line could ever be matched to its invoice - the
 * stage would report success having formed none of its 141,201 links, because
 * a link that finds no head is counted as a miss and never as a failure.
 */
async function buildContext(kind, currencies) {
  const [jobs, heads, parties, companies, associations] = await Promise.all([
    SE_Job.findAll({
      attributes: ['id', 'operation', 'climaxId'],
      where: { climaxId: { [db.Sequelize.Op.ne]: null } },
      raw: true,
    }),
    Charge_Head.findAll({
      // CustomsJobId is selected because it is what says 'LG' - there is no
      // operation column and no SE_Job to read one from.
      attributes: ['id', 'type', 'climaxId', 'CustomsJobId'],
      where: { climaxId: { [db.Sequelize.Op.ne]: null } },
      // LEFT join, not inner: a clearance line has no SE_Job and an inner one
      // drops it. Lines with neither parent are still skipped below.
      include: [{ model: SE_Job, attributes: ['operation'], required: false }],
      raw: true,
    }),
    Clients.findAll({ attributes: ['id', 'name', 'climaxId'], raw: true }),
    Company.findAll({ attributes: ['id', 'climaxId'], raw: true }),
    Client_Associations.findAll({ attributes: ['ClientId', 'ChildAccountId'], raw: true }),
  ]);

  // Each party's ledger account - what an invoice's party_Id must hold. See
  // mapInvoice. A party linked to more than one is left without, rather than
  // guessed at, and falls back like a party with none.
  const accountsOf = new Map();
  for (const a of associations) {
    if (a.ChildAccountId === null || a.ChildAccountId === undefined) continue;
    const k = String(a.ClientId);
    if (!accountsOf.has(k)) accountsOf.set(k, new Set());
    accountsOf.get(k).add(a.ChildAccountId);
  }
  const accountIdOf = (clientId) => {
    const set = accountsOf.get(String(clientId));
    return set && set.size === 1 ? [...set][0] : null;
  };

  const chargeHeadByKey = new Map();
  for (const h of heads) {
    // A line reaches its operation through whichever parent it actually has.
    // 'LG' is the operation the junction columns LGJobChargesRecvId /
    // LGJobChargesPaybId resolve to in LINE_COLUMNS, so the two agree.
    const operation = h['SE_Job.operation'] || (h.CustomsJobId ? 'LG' : null);
    if (!operation) continue;
    chargeHeadByKey.set(`${operation}|${h.type}|${h.climaxId}`, h.id);
  }

  return {
    jobIdByLegacyId: new Map(
      jobs.filter((j) => j.operation).map((j) => [`${j.operation}|${j.climaxId}`, j.id]),
    ),
    chargeHeadByKey,
    parties: new Map(
      parties.filter((p) => p.climaxId !== null && p.climaxId !== undefined)
        .map((p) => [String(p.climaxId), { ...p, accountId: accountIdOf(p.id) }]),
    ),
    companies: new Map(
      companies.filter((c) => c.climaxId !== null && c.climaxId !== undefined)
        .map((c) => [String(c.climaxId), c.id]),
    ),
    currencies: new Map(
      currencies.filter((c) => c && c.Id !== null && c.Id !== undefined)
        .map((c) => [String(c.Id), c.CurrencyCode]),
    ),
  };
}

async function planFor(body) {
  const batch = readBatch(body);
  if (!batch) return null;

  // Scoped by the types this legacy table produces AND by partyType.
  //
  // A legacy invoice id is only unique within its own table, and the opening
  // types are shared: GL_JobInvoice and GL_AgentInvoice both produce
  // 'Opening Invoice'. Scoping on type alone would let opening id 5 from one
  // table mark opening id 5 from the other as already imported - the same
  // collision that silently dropped 38,000 charge lines.
  //
  // partyType is what separates them, one value per legacy table:
  // client for GL_JobInvoice, vendor for GL_JobBill, agent for
  // GL_AgentInvoice.
  const spec = KINDS[batch.kind];
  const existing = await Invoice.findAll({
    attributes: ['climaxId'],
    where: {
      type: { [db.Sequelize.Op.in]: spec.types },
      partyType: spec.partyType,
      climaxId: { [db.Sequelize.Op.ne]: null },
    },
    raw: true,
  });

  return planInvoices(batch.rows, batch.kind, {
    existingClimaxIds: existing.map((i) => i.climaxId),
    links: batch.links,
    parentKey: batch.parentKey,
    ...(await buildContext(batch.kind, batch.currencies)),
  });
}

function summarise(plan) {
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      missingId: plan.problems.missingId,
      missingInvoiceNo: plan.problems.missingInvoiceNo,
      duplicateClimaxIds: plan.problems.duplicateClimaxIds.slice(0, 25),
      orphaned: plan.problems.orphaned.slice(0, 25),
      logisticsInvoices: plan.problems.logisticsInvoices.slice(0, 25),
      mixedSideAgentInvoices: plan.problems.mixedSideAgentInvoices.slice(0, 25),
      agentDirectionConflicts: plan.problems.agentDirectionConflicts.slice(0, 25),
      statusContentMismatch: plan.problems.statusContentMismatch.slice(0, 25),
      contradictoryAmounts: plan.problems.contradictoryAmounts.slice(0, 25),
    },
  };
}

const BAD_BODY = {
  status: 'error',
  result: `Send { kind: <one of ${Object.keys(KINDS).join(' | ')}>, rows: [...], links: [...], parentKey, currencies: [...] }.`,
};

routes.post('/plan', SYSTEM, async (req, res) => {
  try {
    const plan = await planFor(req.body);
    if (!plan) return res.status(400).json(BAD_BODY);
    res.json({ status: 'success', result: summarise(plan) });
  } catch (error) {
    console.error('[invoice migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Point charge lines at the invoice that carries them.
 *
 * One statement per chunk rather than one per line: the alternative is 102,820
 * UPDATEs. Both columns are set together because they are read by different
 * screens - InvoiceId is the association the invoice tab joins on, and
 * invoice_id is the invoice NUMBER, which the job list counts with
 * LIKE '%I%' / LIKE '%B%' to show invoice and bill counts per job.
 *
 * Only rows whose InvoiceId is still null are touched. Two charge lines in
 * this data sit on two invoices at once, and a single FK can only hold one;
 * first-wins with the kinds run in order makes the winner deterministic and
 * matches the precedence the charge-line stage already used for invoiceType.
 * It also means a re-run cannot move a line that is already attached.
 */
async function linkChargeHeads(pairs, transaction) {
  if (!pairs.length) return 0;

  const CHUNK = 500;
  let linked = 0;

  for (let i = 0; i < pairs.length; i += CHUNK) {
    const slice = pairs.slice(i, i + CHUNK);

    const values = slice.map(() => '(?::integer, ?::integer, ?::text)').join(',');
    const replacements = [];
    for (const p of slice) replacements.push(p.headId, p.invoiceId, p.invoice_No);

    const [, meta] = await db.sequelize.query(
      `UPDATE "Charge_Heads" AS ch
          SET "InvoiceId" = v.invoice_id,
              "invoice_id" = v.invoice_no
         FROM (VALUES ${values}) AS v(head_id, invoice_id, invoice_no)
        WHERE ch.id = v.head_id
          AND ch."InvoiceId" IS NULL`,
      { replacements, transaction },
    );

    linked += typeof meta === 'number' ? meta : (meta?.rowCount || 0);
  }

  return linked;
}

routes.post('/apply', SYSTEM, async (req, res) => {
  try {
    const batch = readBatch(req.body);
    if (!batch) return res.status(400).json(BAD_BODY);

    if (batch.rows.length > MAX_BATCH) {
      return res.status(413).json({
        status: 'error',
        result: `Batch of ${batch.rows.length} rows exceeds the ${MAX_BATCH}-row limit.`,
      });
    }

    const plan = await planFor(req.body);
    if (!plan.toCreate.length) {
      return res.json({
        status: 'success',
        result: { ...summarise(plan), created: 0, linked: 0 },
      });
    }

    let linked = 0;

    await db.sequelize.transaction(async (t) => {
      // Invoices and their charge-line links land together. A committed
      // invoice with its lines still detached is the exact state this whole
      // stage exists to remove, so it must not be reachable by a half-failure.
      const CHUNK = 1000;
      const created = [];
      for (let i = 0; i < plan.toCreate.length; i += CHUNK) {
        const made = await Invoice.bulkCreate(plan.toCreate.slice(i, i + CHUNK), {
          transaction: t,
          returning: true,
          // createdAt is the invoice's own date, not now - see the planner.
          silent: true,
          // Same as the jobs stage: these rows are history, dated across five
          // fiscal years (2022-2026), so there is no one year to tag them
          // with. The lock gate leaves records with no FiscalYearId alone
          // precisely because that is what legacy data looks like.
          fiscalYearCheck: false,
        });
        created.push(...made);
      }

      const idByClimaxId = new Map(
        created.map((inv) => [String(inv.climaxId), inv.id]),
      );

      const pairs = [];
      for (const entry of plan.linkPlan) {
        const invoiceId = idByClimaxId.get(entry.climaxId);
        if (invoiceId === undefined) continue;
        for (const headId of entry.chargeHeadIds) {
          pairs.push({ headId, invoiceId, invoice_No: entry.invoice_No });
        }
      }

      linked = await linkChargeHeads(pairs, t);
    });

    res.json({
      status: 'success',
      result: { ...summarise(plan), created: plan.toCreate.length, linked },
    });
  } catch (error) {
    console.error('[invoice migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make.
 *
 * An invoice with no job is money floating free of the shipment that earned
 * it. An invoice whose charge lines never got attached still shows the right
 * count on the invoice list and a zero on the job. A charge line pointing at
 * an invoice that no longer exists breaks the job P&L silently. None of that
 * shows in a count of rows.
 */
routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const [invoices, heads, jobs] = await Promise.all([
      Invoice.findAll({
        attributes: [
          'id', 'type', 'payType', 'invoice_No', 'invoice_Id', 'SEJobId',
          'party_Id', 'currency', 'total', 'climaxId', 'companyId', 'createdAt',
          // `operation` is what tells a clearance invoice apart from a freight
          // one. Without it every customs invoice looks like a job invoice
          // that lost its job.
          'approved', 'partyType', 'operation',
        ],
        where: { climaxId: { [db.Sequelize.Op.ne]: null } },
        raw: true,
      }),
      Charge_Head.findAll({
        attributes: ['id', 'type', 'invoiceType', 'InvoiceId', 'invoice_id', 'climaxId'],
        raw: true,
      }),
      SE_Job.findAll({ attributes: ['id'], raw: true }),
    ]);

    const jobIds = new Set(jobs.map((j) => String(j.id)));
    const invoiceIds = new Set(invoices.map((i) => String(i.id)));

    const byType = {};
    const totalByType = {};
    for (const i of invoices) {
      const k = i.type || '(none)';
      byType[k] = (byType[k] || 0) + 1;
      totalByType[k] = Math.round(((totalByType[k] || 0) + (Number(i.total) || 0)) * 100) / 100;
    }

    // Opening balances have no job by definition, so they are excluded from
    // every job-linkage check below. A JOB invoice with no job is a fault; an
    // opening with no job is what an opening is.
    const OPENING = new Set(['Opening Invoice', 'Opening Bill']);
    const openings = invoices.filter((i) => OPENING.has(i.type));

    // A CUSTOMS invoice is excluded from the job-linkage check for the same
    // reason an opening is, but for the opposite cause: Invoice carries
    // SEJobId and has no customs equivalent, so a clearance invoice reaches
    // its declaration through its CHARGE LINES (Charge_Heads.CustomsJobId,
    // resolved in reverse by functions/customsInvoiceContext).
    //
    // Its null job is correct, not a fault. Checking SEJobId alone reported
    // every one of CargoLinkers' 50,945 clearance invoices as detached the
    // moment the stage succeeded - the same mistake /migration/linkage made
    // about the charge lines themselves.
    const customs = invoices.filter((i) => i.operation === 'LG');
    const jobInvoices = invoices.filter(
      (i) => !OPENING.has(i.type) && i.operation !== 'LG',
    );

    const detached = jobInvoices.filter((i) => !i.SEJobId || !jobIds.has(String(i.SEJobId)));
    // An opening that somehow acquired a job is equally wrong the other way.
    const openingsWithJob = openings.filter((i) => i.SEJobId);
    const withoutParty = invoices.filter((i) => !i.party_Id);
    const withoutCurrency = invoices.filter((i) => !i.currency);
    const withoutSequence = invoices.filter((i) => !i.invoice_Id);
    const withoutCompany = invoices.filter((i) => !i.companyId);

    // An invoice dated the day it was imported is an invoice whose real date
    // was lost. Every ageing bucket and invoice listing orders on createdAt.
    const today = new Date().toISOString().slice(0, 10);
    const datedToday = invoices.filter(
      (i) => i.createdAt && new Date(i.createdAt).toISOString().slice(0, 10) === today,
    );

    // Duplicate legacy ids, scoped the way the import scopes them: the two
    // agent types come from one table and share an id space.
    // Duplicates are scoped the way the import scopes identity: by partyType,
    // which is one value per legacy table. Scoping by type would wrongly pair
    // a client opening with an agent opening that share a legacy id.
    const AGENT = new Set(['Agent Invoice', 'Agent Bill']);
    const seen = new Map();
    for (const i of invoices) {
      const k = `${i.partyType}|${i.climaxId}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);

    // Duplicate invoice numbers - two invoices claiming to be the same
    // document. Every screen that looks an invoice up by number gets one of
    // them arbitrarily.
    const byNo = new Map();
    for (const i of invoices) {
      if (!i.invoice_No) continue;
      byNo.set(i.invoice_No, (byNo.get(i.invoice_No) || 0) + 1);
    }
    const duplicateNumbers = [...byNo.entries()].filter(([, n]) => n > 1).map(([k]) => k);

    // Cancelled invoices import unapproved and carry nothing. A live invoice
    // with no lines is a different thing entirely: a total with no breakdown
    // behind it, which prints as an invoice with an empty charge table.
    const cancelled = invoices.filter((i) => String(i.approved) !== '1');
    const withInvoice = new Set(
      heads.filter((h) => h.InvoiceId).map((h) => String(h.InvoiceId)),
    );
    // Openings carry no charge lines by design and are not counted here.
    const liveWithoutLines = jobInvoices.filter(
      (i) => String(i.approved) === '1' && !withInvoice.has(String(i.id)),
    );
    const liveWithoutLinesValue = Math.round(
      liveWithoutLines.reduce((n, i) => n + (Number(i.total) || 0), 0) * 100,
    ) / 100;

    const migratedHeads = heads.filter((h) => h.climaxId !== null);
    const headsWithInvoice = migratedHeads.filter((h) => h.InvoiceId);
    const headsBroken = headsWithInvoice.filter((h) => !invoiceIds.has(String(h.InvoiceId)));
    const headsWithNumberOnly = migratedHeads.filter((h) => !h.InvoiceId && h.invoice_id);

    // The pair the job P&L matches on. A line saying 'Job Bill' attached to an
    // invoice typed 'Job Invoice' puts cost on the revenue side.
    const invoiceTypeById = new Map(invoices.map((i) => [String(i.id), i.type]));
    const typeMismatch = headsWithInvoice.filter((h) => {
      const t = invoiceTypeById.get(String(h.InvoiceId));
      if (!t || !h.invoiceType) return false;
      if (AGENT.has(t) && AGENT.has(h.invoiceType)) return false;
      return t !== h.invoiceType;
    });

    res.json({
      status: 'success',
      result: {
        invoices: invoices.length,
        byType,
        totalByType,

        // Cutover balances: no job, no charge lines, by design.
        openings: openings.length,
        openingsWithJob: openingsWithJob.length,
      // Clearance invoices, which legitimately carry no job column.
      onCustomsJobs: customs.length,

        // Money with no shipment behind it. Openings excluded - they never
        // had one.
        detached: detached.length,
        withoutParty: withoutParty.length,
        withoutCurrency: withoutCurrency.length,
        withoutCompany: withoutCompany.length,

        // Invisible to /makeInvoiceNew's "what was the last number" query, so
        // the next hand-made invoice can reuse a number already in use.
        withoutSequence: withoutSequence.length,

        datedToday: datedToday.length,

        // Emptied in Climax, kept for their number and their ledger
        // references, imported unapproved so nothing offers them for payment.
        cancelled: cancelled.length,
        // The one that matters: an APPROVED invoice with no charge lines is a
        // total nobody can explain. Its value should be zero.
        liveWithoutLines: liveWithoutLines.length,
        liveWithoutLinesValue,

        duplicateClimaxIds: duplicates.slice(0, 25),
        duplicateClimaxIdCount: duplicates.length,
        duplicateInvoiceNumbers: duplicateNumbers.slice(0, 25),
        duplicateInvoiceNumberCount: duplicateNumbers.length,

        // The link this stage exists to create.
        chargeLines: migratedHeads.length,
        chargeLinesLinked: headsWithInvoice.length,
        chargeLinesUnlinked: migratedHeads.length - headsWithInvoice.length,
        chargeLinesPointingAtNothing: headsBroken.length,
        chargeLinesWithNumberButNoInvoice: headsWithNumberOnly.length,
        chargeLinesTypeMismatch: typeMismatch.length,

        healthy:
          detached.length === 0
          && openingsWithJob.length === 0
          && duplicates.length === 0
          && headsBroken.length === 0
          && typeMismatch.length === 0,

        note:
          'chargeLinesUnlinked counts migrated charge lines with no invoice. It will not reach '
          + 'zero: 292 legacy lines sit on no invoice document at all, and the lines belonging to '
          + 'logistics jobs wait on the lgJobs stage. chargeLinesPointingAtNothing and '
          + 'chargeLinesTypeMismatch must both be zero - the first breaks the invoice tab, the '
          + 'second puts cost on the revenue side of the job P&L. totalByType is there to be '
          + 'reconciled against the legacy totals; a row count cannot tell you the money came '
          + 'across intact.',
      },
    });
  } catch (error) {
    console.error('[invoice migration] verify failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

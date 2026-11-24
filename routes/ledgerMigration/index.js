/**
 * Ledger migration - Vouchers, Voucher_Heads and invoice settlement.
 * Plan, apply, verify.
 *
 * /voucher/ledger.js and importLedger in steps.js are untouched.
 *
 *   POST /ledgerMigration/vouchers/plan     what would happen, writes nothing
 *   POST /ledgerMigration/vouchers/apply    one batch, one transaction
 *   POST /ledgerMigration/settlements/plan
 *   POST /ledgerMigration/settlements/apply
 *   GET  /ledgerMigration/verify            what a row count cannot see
 *
 * 53,129 vouchers with 121,967 heads, then 38,330 settlements. Depends on the
 * accounts, parties and invoices stages.
 */

const routes = require('express').Router();
const db = require('../../models');
const {
  Vouchers, Voucher_Heads, Invoice, Invoice_Transactions,
  Child_Account, Clients, Client_Associations, Company,
} = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const { planVouchers, planSettlements, assignGapNumbers } = require('../../functions/ledgerMigrationPlan');
const { sequenceFromNumber } = require('../../functions/ledgerMapping');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;
const MAX_BATCH = 2000;

const OPENING = new Set(['Opening Invoice', 'Opening Bill']);

/**
 * The chart of accounts and the party behind each account.
 *
 * Child_Account.id IS the legacy GL_COA id, so this is the same chart the
 * legacy voucher lines point at - read from Odyssey rather than shipped
 * alongside, so the two cannot disagree.
 */
async function buildAccountContext() {
  const [accounts, associations, clients] = await Promise.all([
    Child_Account.findAll({
      attributes: ['id', 'title', 'subCategory', 'ChildAccountId'], raw: true,
    }),
    Client_Associations.findAll({ attributes: ['ChildAccountId', 'ClientId'], raw: true }),
    Clients.findAll({ attributes: ['id', 'name'], raw: true }),
  ]);

  const clientById = new Map(clients.map((c) => [String(c.id), c]));

  return {
    accounts: new Map(accounts.map((a) => [String(a.id), {
      id: a.id, title: a.title, subCategory: a.subCategory, parentId: a.ChildAccountId,
    }])),
    partyByAccount: new Map(
      associations
        .filter((a) => a.ChildAccountId !== null && clientById.has(String(a.ClientId)))
        .map((a) => [String(a.ChildAccountId), clientById.get(String(a.ClientId))]),
    ),
  };
}

function readVoucherBatch(body) {
  if (!Array.isArray(body?.rows)) return null;
  return {
    rows: body.rows,
    details: Array.isArray(body.details) ? body.details : [],
    // The detail lines GL_InvAdjustments points at - which vouchers actually
    // settle a document, and so which screen they land on. See
    // resolveVoucherType. An older sender omits it and every voucher in the
    // batch reads as settling nothing, which is the safe direction.
    settledDetailIds: Array.isArray(body.settledDetailIds) ? body.settledDetailIds : [],
    currencies: Array.isArray(body.currencies) ? body.currencies : [],
    voucherTypes: Array.isArray(body.voucherTypes) ? body.voucherTypes : [],
  };
}

async function planVoucherBatch(body) {
  const batch = readVoucherBatch(body);
  if (!batch) return null;

  const [existing, companies, accountContext] = await Promise.all([
    Vouchers.findAll({
      attributes: ['climaxId'],
      where: { climaxId: { [db.Sequelize.Op.ne]: null } },
      raw: true,
    }),
    Company.findAll({ attributes: ['id', 'climaxId'], raw: true }),
    buildAccountContext(),
  ]);

  return planVouchers(batch.rows, {
    existingClimaxIds: existing.map((v) => v.climaxId),
    details: batch.details,
    settledDetailIds: batch.settledDetailIds,
    companies: new Map(
      companies.filter((c) => c.climaxId !== null && c.climaxId !== undefined)
        .map((c) => [String(c.climaxId), c.id]),
    ),
    currencies: new Map(
      batch.currencies.filter((c) => c && c.Id !== null)
        .map((c) => [String(c.Id), c.CurrencyCode]),
    ),
    voucherTypes: new Map(
      batch.voucherTypes.filter((t) => t && t.Id !== null).map((t) => [String(t.Id), t]),
    ),
    ...accountContext,
  });
}

function summariseVouchers(plan) {
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      missingId: plan.problems.missingId,
      // In full, not a sample: the screen sends exactly these back to
      // /vouchers/numberUnnumbered once every numbered voucher is in.
      unnumbered: plan.problems.unnumbered,
      withoutLines: plan.problems.withoutLines.slice(0, 25),
      duplicateClimaxIds: plan.problems.duplicateClimaxIds.slice(0, 25),
      unknownVoucherType: plan.problems.unknownVoucherType.slice(0, 25),
    },
  };
}

/**
 * Write a planned batch: each voucher with its heads, in one transaction.
 * Returns how many heads were written. Shared by /vouchers/apply and
 * /vouchers/numberUnnumbered, so a voucher numbered after the fact is written
 * exactly as every other one was.
 */
async function writeVoucherPlan(plan) {
  let heads = 0;

  await db.sequelize.transaction(async (t) => {
    // A voucher and its heads land together. A committed voucher whose lines
    // failed is an unbalanced entry in the trial balance.
    const CHUNK = 500;
    for (let i = 0; i < plan.toCreate.length; i += CHUNK) {
      const slice = plan.toCreate.slice(i, i + CHUNK);

      const made = await Vouchers.bulkCreate(slice.map((x) => x.voucher), {
        transaction: t,
        returning: true,
        // These carry their own dates and span every fiscal year in the
        // data, exactly like the jobs and invoices stages.
        silent: true,
        fiscalYearCheck: false,
      });

      const idByClimaxId = new Map(made.map((v) => [String(v.climaxId), v.id]));

      const headRows = [];
      for (const entry of slice) {
        const voucherId = idByClimaxId.get(String(entry.voucher.climaxId));
        if (voucherId === undefined) continue;
        for (const h of entry.heads) headRows.push({ ...h, VoucherId: voucherId });
      }

      if (headRows.length) {
        // The model's beforeBulkCreate hook forces amounts to magnitudes.
        await Voucher_Heads.bulkCreate(headRows, { transaction: t, silent: true });
        heads += headRows.length;
      }
    }
  });
  return heads;
}

routes.post('/vouchers/plan', SYSTEM, async (req, res) => {
  try {
    const plan = await planVoucherBatch(req.body);
    if (!plan) return res.status(400).json({ status: 'error', result: 'Send { rows: [...], details: [...] }.' });
    res.json({ status: 'success', result: summariseVouchers(plan) });
  } catch (error) {
    console.error('[ledger migration] voucher plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/vouchers/apply', SYSTEM, async (req, res) => {
  try {
    const batch = readVoucherBatch(req.body);
    if (!batch) return res.status(400).json({ status: 'error', result: 'Send { rows: [...], details: [...] }.' });

    if (batch.rows.length > MAX_BATCH) {
      return res.status(413).json({
        status: 'error',
        result: `Batch of ${batch.rows.length} rows exceeds the ${MAX_BATCH}-row limit.`,
      });
    }

    const plan = await planVoucherBatch(req.body);
    if (!plan.toCreate.length) {
      return res.json({ status: 'success', result: { ...summariseVouchers(plan), created: 0, heads: 0 } });
    }

    const heads = await writeVoucherPlan(plan);

    res.json({
      status: 'success',
      result: { ...summariseVouchers(plan), created: plan.toCreate.length, heads },
    });
  } catch (error) {
    console.error('[ledger migration] voucher apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Number the vouchers Climax never numbered, and import them.
 *
 * The batches skip these (see planVouchers - a batch cannot see the whole
 * sequence). The screen keeps them and sends them here ONCE, after every page,
 * when every numbered voucher is in Odyssey and the gaps are real gaps. Each
 * gets the gap it sits in - see assignGapNumbers - and is then planned and
 * written exactly like any other voucher, so it lands before the settlement
 * phase that may point at its lines.
 *
 * Body: the same shape as /vouchers/apply, holding only the unnumbered rows,
 * plus apply: false for a dry run that reports the numbers and writes nothing.
 */
routes.post('/vouchers/numberUnnumbered', SYSTEM, async (req, res) => {
  try {
    const batch = readVoucherBatch(req.body);
    if (!batch) return res.status(400).json({ status: 'error', result: 'Send { rows: [...], details: [...] }.' });
    const apply = req.body.apply !== false;

    const [existing, companies] = await Promise.all([
      Vouchers.findAll({ attributes: ['CompanyId', 'vType', 'voucher_Id', 'tranDate', 'climaxId'], raw: true }),
      Company.findAll({ attributes: ['id', 'climaxId'], raw: true }),
    ]);
    const imported = new Set(existing.filter((v) => v.climaxId !== null).map((v) => String(v.climaxId)));

    // Only rows that still need it: no usable number, and not already in.
    const rows = batch.rows.filter((r) => !imported.has(String(r.Id))
      && sequenceFromNumber(r.VoucherNo) === null);

    const { assigned, unresolved } = assignGapNumbers(rows, {
      existing,
      companies: new Map(
        companies.filter((c) => c.climaxId !== null && c.climaxId !== undefined)
          .map((c) => [String(c.climaxId), c.id]),
      ),
      voucherTypes: new Map(
        batch.voucherTypes.filter((t) => t && t.Id !== null).map((t) => [String(t.Id), t]),
      ),
    });

    const numberFor = new Map(assigned.map((a) => [String(a.legacyId), a.VoucherNo]));
    const numbered = rows.filter((r) => numberFor.has(String(r.Id)))
      .map((r) => ({ ...r, VoucherNo: numberFor.get(String(r.Id)) }));

    let created = 0;
    let heads = 0;
    if (apply && numbered.length) {
      const plan = await planVoucherBatch({ ...req.body, rows: numbered });
      heads = await writeVoucherPlan(plan);
      created = plan.toCreate.length;
    }

    res.json({
      status: 'success',
      result: { assigned, unresolved, created, heads, alreadyImported: batch.rows.length - rows.length },
    });
  } catch (error) {
    console.error('[ledger migration] numbering unnumbered vouchers failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

function readSettlementBatch(body) {
  if (!Array.isArray(body?.rows)) return null;
  return {
    rows: body.rows,
    invoiceRefs: Array.isArray(body.invoiceRefs) ? body.invoiceRefs : [],
  };
}

/**
 * Settlement context.
 *
 * invoiceByKey is keyed by table + legacy id, matching how the invoice stage
 * imported: climaxId is only unique within its own legacy table, so partyType
 * is what separates a client opening from an agent opening sharing an id.
 */
async function planSettlementBatch(body) {
  const batch = readSettlementBatch(body);
  if (!batch) return null;

  const PARTY_FOR_TABLE = { JobInvoice: 'client', JobBill: 'vendor', AgentInvoice: 'agent' };

  const [existing, invoices, heads] = await Promise.all([
    Invoice_Transactions.findAll({
      attributes: ['climaxId'],
      where: { climaxId: { [db.Sequelize.Op.ne]: null } },
      raw: true,
    }),
    Invoice.findAll({
      attributes: ['id', 'climaxId', 'partyType', 'payType', 'total'],
      where: { climaxId: { [db.Sequelize.Op.ne]: null } },
      raw: true,
    }),
    Voucher_Heads.findAll({
      attributes: ['climaxId', 'VoucherId'],
      where: { climaxId: { [db.Sequelize.Op.ne]: null } },
      raw: true,
    }),
  ]);

  const byPartyType = new Map();
  for (const i of invoices) byPartyType.set(`${i.partyType}|${i.climaxId}`, i);

  const invoiceByKey = new Map();
  for (const [table, partyType] of Object.entries(PARTY_FOR_TABLE)) {
    for (const ref of batch.invoiceRefs) {
      if (ref.table !== table) continue;
      const found = byPartyType.get(`${partyType}|${ref.legacyId}`);
      if (found) invoiceByKey.set(`${table}|${ref.legacyId}`, found);
    }
  }

  return planSettlements(batch.rows, {
    existingClimaxIds: existing.map((x) => x.climaxId),
    invoiceByKey,
    voucherByHead: new Map(heads.map((h) => [String(h.climaxId), h.VoucherId])),
    invoiceRefs: batch.invoiceRefs,
  });
}

function summariseSettlements(plan) {
  return {
    canApply: plan.canApply,
    stats: plan.stats,
    problems: {
      missingId: plan.problems.missingId,
      duplicateClimaxIds: plan.problems.duplicateClimaxIds.slice(0, 25),
      unknownInvoice: plan.problems.unknownInvoice.slice(0, 25),
      unknownVoucher: plan.problems.unknownVoucher.slice(0, 25),
    },
  };
}

routes.post('/settlements/plan', SYSTEM, async (req, res) => {
  try {
    const plan = await planSettlementBatch(req.body);
    if (!plan) return res.status(400).json({ status: 'error', result: 'Send { rows: [...], invoiceRefs: [...] }.' });
    res.json({ status: 'success', result: summariseSettlements(plan) });
  } catch (error) {
    console.error('[ledger migration] settlement plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post('/settlements/apply', SYSTEM, async (req, res) => {
  try {
    const batch = readSettlementBatch(req.body);
    if (!batch) return res.status(400).json({ status: 'error', result: 'Send { rows: [...], invoiceRefs: [...] }.' });

    if (batch.rows.length > MAX_BATCH * 5) {
      return res.status(413).json({
        status: 'error',
        result: `Batch of ${batch.rows.length} rows exceeds the ${MAX_BATCH * 5}-row limit.`,
      });
    }

    const plan = await planSettlementBatch(req.body);
    if (!plan.toCreate.length) {
      return res.json({ status: 'success', result: { ...summariseSettlements(plan), created: 0, invoicesTouched: 0 } });
    }

    await db.sequelize.transaction(async (t) => {
      const CHUNK = 1000;
      for (let i = 0; i < plan.toCreate.length; i += CHUNK) {
        await Invoice_Transactions.bulkCreate(plan.toCreate.slice(i, i + CHUNK), {
          transaction: t, silent: true,
        });
      }

      // Only one side moves per invoice - see the planner header. Done as one
      // statement per chunk rather than one per settlement, and inside the
      // same transaction as the transactions themselves so an invoice can
      // never show a balance no transaction accounts for.
      const rows = plan.applyToInvoice;
      const UCHUNK = 500;
      for (let i = 0; i < rows.length; i += UCHUNK) {
        const slice = rows.slice(i, i + UCHUNK);

        for (const receivable of [true, false]) {
          const side = slice.filter((r) => r.receivable === receivable);
          if (!side.length) continue;
          const column = receivable ? 'recieved' : 'paid';
          const vals = side.map(() => '(?::integer, ?::numeric)').join(',');
          const replacements = [];
          for (const r of side) replacements.push(r.id, r.amount);

          await db.sequelize.query(
            `UPDATE "Invoices" AS i
                SET "${column}" = (COALESCE(NULLIF(i."${column}", '')::numeric, 0) + v.amt)::text
               FROM (VALUES ${vals}) AS v(inv_id, amt)
              WHERE i.id = v.inv_id`,
            { replacements, transaction: t },
          );
        }
      }

      /* WHICH INVOICES EACH VOUCHER SETTLED, on the voucher itself.
       *
       * Payments & Receipts reads `Vouchers.invoices` - a comma-separated list
       * of invoice ids - to show what each row paid off. The migration filled
       * the junction table and left this column empty, so a migrated payment
       * arrived on that screen with no document against it: the money was
       * right, the row simply could not say what it was for.
       *
       * RECOMPUTED FROM Invoice_Transactions rather than accumulated from this
       * batch. Settlements are paged, and one voucher's can straddle two pages
       * - appending per batch would need to know what an earlier page wrote,
       * and re-running would double it. Reading the junction back is idempotent
       * and cannot disagree with itself.
       *
       * Scoped to the vouchers this batch touched, so it stays a small update
       * rather than a rewrite of the whole table on every page. */
      const touched = [...new Set(plan.toCreate.map((x) => x.VoucherId))];
      const VCHUNK = 500;
      for (let i = 0; i < touched.length; i += VCHUNK) {
        await db.sequelize.query(
          `UPDATE "Vouchers" AS v
              SET "invoices" = s.ids
             FROM (
               SELECT "VoucherId" AS vid,
                      string_agg(DISTINCT "InvoiceId"::text, ',') AS ids
                 FROM "Invoice_Transactions"
                WHERE "VoucherId" IN (:ids)
                GROUP BY "VoucherId"
             ) AS s
            WHERE v.id = s.vid`,
          { replacements: { ids: touched.slice(i, i + VCHUNK) }, transaction: t },
        );
      }
    });

    res.json({
      status: 'success',
      result: {
        ...summariseSettlements(plan),
        created: plan.toCreate.length,
        invoicesTouched: plan.applyToInvoice.length,
      },
    });
  } catch (error) {
    console.error('[ledger migration] settlement apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The checks a row count cannot make.
 *
 * A voucher whose heads do not balance is an entry the trial balance cannot
 * reconcile. A settlement pointing at no invoice is money applied to nothing.
 * An invoice settled beyond its own total is a balance nobody can explain.
 */
routes.get('/verify', SYSTEM, async (req, res) => {
  try {
    const [vouchers, heads, transactions, invoices] = await Promise.all([
      Vouchers.findAll({
        attributes: ['id', 'climaxId', 'type', 'vType', 'partyId', 'CompanyId', 'createdAt'],
        raw: true,
      }),
      Voucher_Heads.findAll({
        attributes: ['id', 'climaxId', 'VoucherId', 'ChildAccountId', 'amount', 'defaultAmount', 'type'],
        raw: true,
      }),
      Invoice_Transactions.findAll({
        attributes: ['id', 'climaxId', 'InvoiceId', 'VoucherId', 'amount'], raw: true,
      }),
      Invoice.findAll({
        attributes: ['id', 'type', 'payType', 'total', 'paid', 'recieved', 'climaxId'],
        where: { climaxId: { [db.Sequelize.Op.ne]: null } },
        raw: true,
      }),
    ]);

    const migrated = vouchers.filter((v) => v.climaxId !== null);
    const voucherIds = new Set(vouchers.map((v) => String(v.id)));
    const invoiceIds = new Set(invoices.map((i) => String(i.id)));

    const byType = {};
    for (const v of migrated) byType[v.type || '(none)'] = (byType[v.type || '(none)'] || 0) + 1;

    // Heads whose voucher is gone, and vouchers with no heads at all.
    const headsDetached = heads.filter((h) => !h.VoucherId || !voucherIds.has(String(h.VoucherId)));
    const headsByVoucher = new Map();
    for (const h of heads) {
      const k = String(h.VoucherId);
      if (!headsByVoucher.has(k)) headsByVoucher.set(k, []);
      headsByVoucher.get(k).push(h);
    }
    const vouchersWithoutHeads = migrated.filter((v) => !headsByVoucher.has(String(v.id)));
    const headsWithoutAccount = heads.filter((h) => !h.ChildAccountId);

    // A voucher's debits and credits must be equal. This is the check that
    // catches a mapping error no count would show.
    let unbalanced = 0;
    const unbalancedExamples = [];
    for (const v of migrated) {
      const hs = headsByVoucher.get(String(v.id)) || [];
      if (!hs.length) continue;
      let dr = 0; let cr = 0;
      for (const h of hs) {
        const amt = Number(h.defaultAmount) || 0;
        if (h.type === 'debit') dr += amt; else cr += amt;
      }
      if (Math.abs(dr - cr) > 0.01) {
        unbalanced += 1;
        if (unbalancedExamples.length < 10) {
          unbalancedExamples.push({ climaxId: v.climaxId, debit: dr, credit: cr });
        }
      }
    }

    const txDetached = transactions.filter(
      (x) => !x.InvoiceId || !invoiceIds.has(String(x.InvoiceId)),
    );
    const txWithoutVoucher = transactions.filter(
      (x) => !x.VoucherId || !voucherIds.has(String(x.VoucherId)),
    );

    // Settled beyond the invoice total, and settled invoices generally.
    const num = (x) => Number(x) || 0;
    let overSettled = 0; let settledInvoices = 0; let totalPaid = 0; let totalReceived = 0;
    const overExamples = [];
    for (const i of invoices) {
      const settled = i.payType === 'Payble' ? num(i.paid) : num(i.recieved);
      if (i.payType === 'Payble') totalPaid += num(i.paid); else totalReceived += num(i.recieved);
      if (settled !== 0) settledInvoices += 1;
      if (settled - num(i.total) > 0.01) {
        overSettled += 1;
        if (overExamples.length < 10) {
          overExamples.push({ climaxId: i.climaxId, type: i.type, total: num(i.total), settled });
        }
      }
    }

    // Both sides moved on the same invoice is the old importer's signature.
    const bothSidesMoved = invoices.filter((i) => num(i.paid) !== 0 && num(i.recieved) !== 0).length;

    const seen = new Map();
    for (const v of migrated) seen.set(String(v.climaxId), (seen.get(String(v.climaxId)) || 0) + 1);
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);

    res.json({
      status: 'success',
      result: {
        vouchers: vouchers.length,
        migratedVouchers: migrated.length,
        byType,
        voucherHeads: heads.length,
        transactions: transactions.length,

        // Entries the trial balance cannot reconcile.
        unbalancedVouchers: unbalanced,
        unbalancedExamples,
        vouchersWithoutHeads: vouchersWithoutHeads.length,
        headsDetached: headsDetached.length,
        headsWithoutAccount: headsWithoutAccount.length,

        // Money applied to nothing.
        transactionsWithoutInvoice: txDetached.length,
        transactionsWithoutVoucher: txWithoutVoucher.length,

        settledInvoices,
        unsettledInvoices: invoices.length - settledInvoices,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalReceived: Math.round(totalReceived * 100) / 100,
        overSettled,
        overSettledExamples: overExamples,
        // The old importer incremented paid AND recieved by the same amount on
        // every invoice it settled. A large number here means those rows came
        // from that path.
        bothSidesMoved,

        duplicateClimaxIds: duplicates.slice(0, 25),
        duplicateClimaxIdCount: duplicates.length,

        healthy:
          unbalanced === 0
          && headsDetached.length === 0
          && txDetached.length === 0
          && txWithoutVoucher.length === 0
          && duplicates.length === 0,

        note:
          'unbalancedVouchers must be zero - a voucher whose debits and credits differ is an '
          + 'entry the trial balance cannot reconcile. bothSidesMoved must be zero too: paid and '
          + 'recieved are different sides and only one moves per invoice. overSettled counts '
          + 'invoices settled beyond their own total, which is a real state for an overpayment '
          + 'but should be rare. totalPaid and totalReceived are there to be reconciled against '
          + 'GL_InvoiceBalance.SettledAmount.',
      },
    });
  } catch (error) {
    console.error('[ledger migration] verify failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;

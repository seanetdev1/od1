/**
 * The ledger import: vouchers, voucher heads, invoices and settlement.
 *
 * WHAT THIS REPLACES
 *
 * Five endpoints used to share this work, and three of them wrote the same
 * rows:
 *
 *   /importVouchers      vouchers + heads + invoice transactions, for the
 *                        subset of vouchers that had adjustments
 *   /importV             vouchers + heads AGAIN, for every voucher - with a
 *                        different field mapping (party from the COA account
 *                        rather than the client association, no isPayable, a
 *                        different voucher-type resolution)
 *   /deleteVoucherHeads  despite the name, deletes duplicate VOUCHERS:
 *                          DELETE FROM "Vouchers" v1 USING "Vouchers" v2
 *                           WHERE v1."voucher_Id" = v2."voucher_Id"
 *                             AND v1.id > v2.id
 *                        i.e. it cleans up after the two importers above by
 *                        keeping whichever copy happened to be written first
 *   /importVoucherHeads  voucher heads a THIRD time
 *   /importI             invoices, plus ANOTHER voucher per invoice, colliding
 *                        with the vouchers the two importers already made
 *
 * So a voucher was written up to three times, an arbitrary copy survived a
 * de-duplication pass, and which field mapping won was decided by insertion
 * order. Everything hanging off a voucher - its heads, its invoices, its
 * settlement - inherited that arbitrariness. That is why the links were
 * unreliable, and why the stage took as long as it did.
 *
 * WHAT THIS DOES INSTEAD
 *
 * Every row is written exactly once, by one writer, in dependency order:
 *
 *   phase 1  /importLedger      voucher -> its heads -> the invoices it raised
 *   phase 2  /importSettlements adjustments -> Invoice_Transactions + paid
 *
 * Two phases rather than one because a settlement points at an invoice that
 * may be raised by a voucher later in the run. Splitting on that boundary is
 * the only ordering that lets every link resolve by lookup instead of by hope.
 * Within phase 1 a voucher and everything it owns share one transaction, so a
 * voucher never exists without its heads.
 *
 * Both phases key on climaxId and skip what is already there, so either can be
 * re-run after a partial failure without duplicating.
 */

const { Op } = require('sequelize');
// Legacy-import receivers are migration, which is Seanet's - see
// functions/systemAccess.js.
const { requireSystem: SYSTEM } = require('../../functions/systemAccess');
const moment = require('moment');

const { Vouchers, Voucher_Heads } = require('../../functions/Associations/voucherAssociations');
const { Invoice, Invoice_Transactions } = require('../../functions/Associations/incoiceAssociations');
const { Child_Account } = require('../../functions/Associations/accountAssociations');
const { Clients, Client_Associations } = require('../../functions/Associations/clientAssociation');
const { sequelize } = require('../../models');
const { companyIdFromNumber } = require('../../functions/companyCodes');
const { settlementFor } = require('../../functions/invoiceSettlement');

// Invoice_Transactions gets its foreign keys from associations rather than its
// own model definition, and routes/invoice tests both spellings when reading
// them - so resolve rather than guess, or we write rows the read path cannot
// find.
const TX_INVOICE_FK =
  ['invoiceId', 'InvoiceId'].find((k) => Invoice_Transactions.rawAttributes[k]) || 'InvoiceId';
const TX_VOUCHER_FK =
  ['voucherId', 'VoucherId'].find((k) => Invoice_Transactions.rawAttributes[k]) || 'VoucherId';

// The field mapping lives in functions/ledgerMapping.js - no model imports, so
// the rules two importers used to disagree about can be tested directly.
const {
  resolveVoucherType,
  resolveAccountType,
  isPayableAccount,
  resolveInvoiceMeta,
  sequenceFromNumber,
  partyDetailLine,
  accountIdForLine,
} = require('../../functions/ledgerMapping');

function register(routes) {
  /* ================================================================
     PHASE 1 - vouchers, their heads, and the invoices they raised
     ================================================================ */
  routes.post('/importLedger', SYSTEM, async (req, res) => {
    try {
      const records = Array.isArray(req.body.records) ? req.body.records : [];
      if (!records.length) {
        return res.json({ status: 'success', vouchers: 0, heads: 0, invoices: 0, skipped: 0 });
      }

      // Look-ups built once per request, not once per record. The old importers
      // ran a Company query per voucher AND per invoice.
      // Indexed by id, because Child_Account.id IS the legacy COA id -
      // /importAccount creates them with `id: item.Id`. Matching on title
      // instead went through a Map that silently kept only the last of any
      // duplicated account name.
      const accounts = await Child_Account.findAll({ attributes: ['id', 'title', 'subCategory'], raw: true });
      const accountById = new Map(accounts.map((a) => [String(a.id), a]));

      const associations = await Client_Associations.findAll({
        attributes: ['ChildAccountId', 'ClientId'], raw: true,
      });
      const clientIdByAccount = new Map(associations.map((a) => [a.ChildAccountId, a.ClientId]));

      const clients = await Clients.findAll({ attributes: ['id', 'name'], raw: true });
      const clientById = new Map(clients.map((c) => [c.id, c]));

      const existingVouchers = new Set(
        (await Vouchers.findAll({
          attributes: ['climaxId'], where: { climaxId: { [Op.ne]: null } }, raw: true,
        })).map((v) => String(v.climaxId))
      );
      const existingInvoices = new Set(
        (await Invoice.findAll({
          attributes: ['climaxId'], where: { climaxId: { [Op.ne]: null } }, raw: true,
        })).map((i) => String(i.climaxId))
      );

      /** The party behind a set of voucher detail lines. */
      const partyFor = (details) => {
        const line = partyDetailLine(details);
        const accountId = accountIdForLine(line);
        if (accountId == null) return { account: null, client: null };
        const account = accountById.get(String(accountId));
        if (!account) return { account: null, client: null };
        const clientId = clientIdByAccount.get(account.id);
        return { account, client: clientId ? clientById.get(clientId) || null : null };
      };

      let vouchersCreated = 0, headsCreated = 0, invoicesCreated = 0;
      let skipped = 0, invoicesSkipped = 0;
      const unresolved = { noAccount: 0, noClient: 0, noInvoiceAccount: 0 };
      const failed = [];

      for (const voucher of records) {
        if (voucher?.Id != null && existingVouchers.has(String(voucher.Id))) { skipped++; continue; }

        try {
          const companyId = await companyIdFromNumber(voucher.VoucherNo);
          const details = Array.isArray(voucher.GL_Voucher_Detail) ? voucher.GL_Voucher_Detail : [];
          const leadingDetail = details[0] || {};
          const payable = isPayableAccount(leadingDetail);

          const { account, client } = partyFor(details);
          if (!account) unresolved.noAccount++;
          if (!client) unresolved.noClient++;

          const resolvedType = resolveVoucherType(voucher.GL_VoucherType || {});

          // One transaction for the voucher and everything that hangs off it.
          // A voucher without its heads is not a partial import, it is a
          // corrupt ledger entry - and because the skip guard keys on climaxId,
          // a re-run would step over it and leave it that way permanently.
          await sequelize.transaction(async (t) => {
            const saved = await Vouchers.create({
              voucher_No: sequenceFromNumber(voucher.VoucherNo) || '1',
              voucher_Id: voucher.VoucherNo || '1',
              type: resolvedType.type,
              vType: resolvedType.vType,
              currency: voucher.GL_Currencies?.CurrencyCode ?? 'PKR',
              exRate: voucher.ExchangeRate,
              chequeNo: leadingDetail?.ChequeNumber,
              chequeDate: leadingDetail?.ChequeDate,
              voucherNarration: voucher.Narration,
              costCenter: 'KHI',
              onAccount: payable ? 'vendor' : 'client',
              partyId: client?.id || null,
              partyName: client?.name || null,
              partyType: payable ? 'vendor' : 'client',
              tranDate: voucher.VoucherDate,
              createdBy: voucher.AddLog,
              createdAt: moment(voucher.AddOn),
              updatedAt: voucher.EditOn ? moment(voucher.EditOn) : moment(voucher.AddOn),
              CompanyId: companyId,
              climaxId: voucher.Id,
            }, { transaction: t, silent: true, fiscalYearCheck: false });
            vouchersCreated++;

            for (const vh of details) {
              const headAccountId = accountIdForLine(vh);
              const isCredit = vh?.DebitLC === 0;
              await Voucher_Heads.create({
                defaultAmount: isCredit ? vh?.CreditLC : vh?.DebitLC,
                amount: isCredit ? vh?.CreditVC : vh?.DebitVC,
                type: isCredit ? 'credit' : 'debit',
                narration: vh?.NarrationVD,
                accountType: resolveAccountType(vh?.GL_COA),
                createdAt: saved.createdAt,
                updatedAt: saved.updatedAt,
                VoucherId: saved.id,
                ChildAccountId: headAccountId ?? null,
                climaxId: vh?.Id,
              }, { transaction: t, silent: true });
              headsCreated++;
            }

            /* ---- the invoices this voucher raised ----

              Each legacy invoice points at the voucher DETAIL line that raised
              it (GVDetailId), so an invoice belongs to exactly one voucher. The
              frontend groups them under that voucher, which is what lets the
              invoice take its VoucherId from a row created moments ago in this
              same transaction instead of looking one up - and is why /importI
              no longer needs to create a voucher of its own and collide with
              the ones this import already made.
            */
            for (const I of (voucher.Invoices || [])) {
              if (I?.Id != null && existingInvoices.has(String(I.Id))) { invoicesSkipped++; continue; }

              const { account: invAccount, client: invClient } =
                partyFor(I?.GL_Voucher?.GL_Voucher_Detail || details);

              if (!invAccount) { unresolved.noInvoiceAccount++; continue; }

              const meta = resolveInvoiceMeta(I);
              await Invoice.create({
                invoice_No: I.InvoiceNumber,
                invoice_Id: sequenceFromNumber(I.InvoiceNumber) || '1',
                type: meta.type,
                payType: meta.payType,
                // Opened unsettled; phase 2 applies the adjustments. Anything
                // with no adjustments is genuinely still open.
                status: '1',
                operation: meta.operation,
                currency: I.GL_Currencies?.CurrencyCode ?? 'PKR',
                ex_rate: I.ExchangeRate,
                party_Id: invAccount.id,
                party_Name: invClient?.name || invAccount.title,
                partyType: 'client',
                paid: 0,
                recieved: 0,
                roundOff: '0',
                total: I.InvoiceAmount,
                approved: '1',
                companyId,
                note: I.Remarks,
                VoucherId: saved.id,
                createdAt: moment(I.invoiceDate || voucher.AddOn),
                updatedAt: moment(I.invoiceDate || voucher.AddOn),
                climaxId: I.Id,
              }, { transaction: t, silent: true, fiscalYearCheck: false });

              invoicesCreated++;
              if (I?.Id != null) existingInvoices.add(String(I.Id));
            }
          });

          if (voucher?.Id != null) existingVouchers.add(String(voucher.Id));
        } catch (err) {
          // Recorded, not swallowed. The caller counts these and fails the
          // stage on them rather than reporting a clean run.
          failed.push({ voucherNo: voucher.VoucherNo, error: err?.message || String(err) });
        }
      }

      return res.json({
        status: failed.length ? 'partial' : 'success',
        vouchers: vouchersCreated,
        heads: headsCreated,
        invoices: invoicesCreated,
        skipped,
        invoicesSkipped,
        unresolved,
        failedCount: failed.length,
        failed: failed.slice(0, 20),
      });
    } catch (e) {
      console.error('[importLedger] fatal:', e);
      return res.status(500).json({ status: 'error', result: e.message || String(e) });
    }
  });

  /* ================================================================
     PHASE 2 - settlement

     One record per settled invoice, carrying every adjustment against it, so
     the settled figure is written once from the complete set rather than
     accumulated across batches with += (which is not safe to retry: a batch
     that failed after its update would double-count on the way back through).
     ================================================================ */
  routes.post('/importSettlements', SYSTEM, async (req, res) => {
    try {
      const records = Array.isArray(req.body.records) ? req.body.records : [];
      if (!records.length) {
        return res.json({ status: 'success', settled: 0, transactions: 0, skipped: 0 });
      }

      const climaxIds = records.map((r) => String(r.invoiceClimaxId)).filter(Boolean);
      const invoices = await Invoice.findAll({
        attributes: ['id', 'climaxId', 'total', 'payType'],
        where: { climaxId: { [Op.in]: climaxIds } },
        raw: true,
      });
      const invoiceByClimaxId = new Map(invoices.map((i) => [String(i.climaxId), i]));

      // Every voucher that settled something in this batch, resolved in one go.
      const voucherClimaxIds = [...new Set(
        records.flatMap((r) => (r.adjustments || []).map((a) => a.voucherClimaxId)).filter((x) => x != null)
      )].map(String);
      const vouchers = voucherClimaxIds.length
        ? await Vouchers.findAll({
            attributes: ['id', 'climaxId', 'type'],
            where: { climaxId: { [Op.in]: voucherClimaxIds } },
            raw: true,
          })
        : [];
      const voucherByClimaxId = new Map(vouchers.map((v) => [String(v.climaxId), v.id]));
      const legacyTypeById = new Map(vouchers.map((v) => [v.id, v.type]));
      // Which vouchers this batch proved to be settlements. Phase 1 cannot
      // know: resolveVoucherType's `settlesInvoice` comes from
      // GL_InvAdjustments, which is phase 2's input, so every voucher is
      // written with its legacy type name and corrected here once the
      // adjustment that settles it has actually been recorded.
      const settledVoucherIds = new Set();

      let settled = 0, transactions = 0, skipped = 0;
      const unresolved = { noInvoice: 0, noVoucher: 0 };
      const failed = [];

      for (const record of records) {
        const invoice = invoiceByClimaxId.get(String(record.invoiceClimaxId));
        if (!invoice) { unresolved.noInvoice++; continue; }

        const adjustments = Array.isArray(record.adjustments) ? record.adjustments : [];
        if (!adjustments.length) continue;

        // Held aside rather than added straight to settledVoucherIds: a
        // rolled-back record wrote no Invoice_Transactions row, and retyping
        // on the strength of it would put a voucher on Payments & Receipts
        // with no document behind it.
        const touchedVouchers = [];

        try {
          await sequelize.transaction(async (t) => {
            // Idempotent by replacement: this record carries the complete
            // settlement history for the invoice, so clearing first makes a
            // re-run converge on the same answer instead of doubling it.
            const removed = await Invoice_Transactions.destroy({
              where: { [TX_INVOICE_FK]: invoice.id }, transaction: t,
            });
            if (removed) skipped += removed;

            for (const adj of adjustments) {
              const amount = Number(adj.amount) || 0;
              if (!amount) continue;

              const voucherId = adj.voucherClimaxId != null
                ? voucherByClimaxId.get(String(adj.voucherClimaxId))
                : null;
              if (!voucherId) unresolved.noVoucher++;
              else touchedVouchers.push(voucherId);

              await Invoice_Transactions.create({
                amount: String(amount),
                // The legacy adjustment has no exchange-difference field, so
                // this is recorded as zero rather than invented.
                gainLoss: '0',
                [TX_INVOICE_FK]: invoice.id,
                [TX_VOUCHER_FK]: voucherId || null,
                createdAt: moment(adj.date || undefined),
                updatedAt: moment(adj.date || undefined),
              }, { transaction: t, silent: true });
              transactions++;
            }

            const { paid, recieved, status } = settlementFor(
              adjustments.map((a) => ({ Amount: a.amount })),
              invoice.total,
              invoice.payType === 'Recievable'
            );

            await Invoice.update(
              { paid, recieved, status },
              { where: { id: invoice.id }, transaction: t, silent: true }
            );
            settled++;
          });
          touchedVouchers.forEach((id) => settledVoucherIds.add(id));
        } catch (err) {
          failed.push({ invoiceClimaxId: record.invoiceClimaxId, error: err?.message || String(err) });
        }
      }

      /* ---- retype the vouchers that turned out to settle something ----

        Only `type` moves. resolveVoucherType sets vType to VT.TypeCode on
        both of its branches, so the settled and unsettled paths never
        disagreed about it and BPV/BRV/CPV/CRV stay as they are.

        The PAYMENT/RECEIPT substring test is resolveVoucherType's own
        VOUCHER_TYPE_MAP lookup. DEBIT NOTE and CREDIT NOTE match neither and
        are left alone by design: they are adjustment documents that never
        belong on Payments & Receipts, settled or not.
      */
      const retype = { 'Job Payment': [], 'Job Reciept': [] };
      settledVoucherIds.forEach((id) => {
        const legacy = String(legacyTypeById.get(id) || '').toUpperCase();
        if (legacy === 'JOB PAYMENT' || legacy === 'JOB RECIEPT') return;
        if (legacy.includes('PAYMENT')) retype['Job Payment'].push(id);
        else if (legacy.includes('RECEIPT')) retype['Job Reciept'].push(id);
      });

      let retyped = 0;
      for (const [type, ids] of Object.entries(retype)) {
        if (!ids.length) continue;
        const [, affected] = await Vouchers.update(
          { type },
          { where: { id: { [Op.in]: ids } }, silent: true }
        );
        retyped += affected ?? ids.length;
      }

      return res.json({
        status: failed.length ? 'partial' : 'success',
        settled,
        transactions,
        replaced: skipped,
        retyped,
        unresolved,
        failedCount: failed.length,
        failed: failed.slice(0, 20),
      });
    } catch (e) {
      console.error('[importSettlements] fatal:', e);
      return res.status(500).json({ status: 'error', result: e.message || String(e) });
    }
  });
}

module.exports = { register };

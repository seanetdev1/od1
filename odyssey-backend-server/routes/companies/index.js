const { Op } = require("sequelize");
const routes = require('express').Router();
const {
  Company, BankAccount, Invoice, Vouchers, Office_Vouchers, SE_Job, Manifest, Delivery_Order, AppSetting,
} = require("../../models");
const { requireSystem, isSystem } = require('../../functions/systemAccess');
const { grantsFor } = require('../../functions/permissions/grants');
const separation = require('../../functions/companySeparation');
const { createHistory } = require('../../functions/history');
const {
  BANK_DEFAULTS_KEY, BANK_DEFAULT_KINDS, readBankDefaults, setBankDefault, flagAccounts, withBankDefaults,
} = require('../../functions/bankAccountDefaults');

// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

// Fields a company carries (besides title/short). Pulled from the request body
// in one place so create and edit stay in sync.
const COMPANY_FIELDS = ['logo', 'printLogo', 'address', 'phone', 'email', 'web', 'ntn', 'strn'];
function pickCompanyFields(body) {
  const out = {};
  for (const f of COMPANY_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  return out;
}

routes.get("/getAllCompanies", async(req, res) => {
    try {
      const result = await Company.findAll({
        include: [{ model: BankAccount }],
        order: [['id', 'ASC']],
      });
      // Each account says whether it is this company's client or agent
      // default - see functions/bankAccountDefaults.
      const defaults = await readBankDefaults(AppSetting);
      res.json({status:'success', result: result.map((c) => withBankDefaults(c.get({ plain: true }), defaults))});
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

// The companies the signed-in user may work in - every company unless Seanet
// has restricted them (Employee_Company, functions/companyAccess.js). What the
// header's company picker offers, and so every company list on every screen.
// getAllCompanies stays as it was: it is public, and prints read it.
routes.get("/mine", async (req, res) => {
    try {
      const allowed = isSystem(req) ? null : (await grantsFor(req.user.id)).companies;
      const result = await Company.findAll({
        where: allowed ? { id: [...allowed].map(Number) } : undefined,
        include: [{ model: BankAccount }],
        order: [['id', 'ASC']],
      });
      const defaults = await readBankDefaults(AppSetting);
      res.json({
        status: 'success',
        restricted: Boolean(allowed),
        result: result.map((c) => withBankDefaults(c.get({ plain: true }), defaults)),
      });
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

// Which companies one master record is limited to, where its table is
// separated per company (functions/companySeparation.js). [] = every company.
// ?table=parties|coa|charges|chargeGroups|commodity|vessels&recordId=
routes.get("/visibility", async (req, res) => {
    try {
      const result = await separation.companiesOf(String(req.query.table), req.query.recordId);
      res.json({ status: 'success', result });
    } catch (error) {
      res.status(error.status || 500).json({ status: 'error', result: error.message });
    }
});

// { table, recordId, companyIds } - who may share a record: whoever may edit
// its table (functions/permissions/routeRules.js). A restricted user can share
// only into companies they work in themselves.
routes.post("/visibility", async (req, res) => {
    try {
      const { table, recordId } = req.body || {};
      let companyIds = Array.isArray(req.body?.companyIds) ? req.body.companyIds.map(String) : [];
      const allowed = isSystem(req) ? null : (await grantsFor(req.user.id)).companies;
      if (allowed && companyIds.some((id) => !allowed.has(id))) {
        return res.status(403).json({ status: 'error', result: 'You can only share a record with companies you work in.' });
      }
      if (allowed && companyIds.length === 0) companyIds = [...allowed];  // "every company" is not theirs to grant
      const result = await separation.setCompaniesOf(String(table), recordId, companyIds);
      createHistory(req.user.id, 'Company Separation', 'Share', `${table} ${recordId}: ${result.join(', ') || 'all'}`);
      res.json({ status: 'success', result });
    } catch (error) {
      res.status(error.status || 500).json({ status: 'error', result: error.message });
    }
});

// Create a company (admin). title + short required; everything else optional.
routes.post("/createCompany", SYSTEM, async(req, res) => {
    try {
      const { title, short } = req.body || {};
      if (!title || !title.trim() || !short || !short.trim()) {
        return res.status(400).json({ status: 'error', result: 'Company name and short name are required.' });
      }
      const existing = await Company.findOne({
        where: { [Op.or]: [{ title: title.trim() }, { short: short.trim() }] }
      });
      if (existing) {
        return res.json({ status: 'exists', result: 'A company with that name or short name already exists.' });
      }
      const company = await Company.create({
        title: title.trim(),
        short: short.trim(),
        ...pickCompanyFields(req.body),
      });
      res.json({ status: 'success', result: company });
    }
    catch (error) {
      res.status(500).json({ status: 'error', result: error.message });
    }
});

// Edit a company's details (admin).
routes.post("/editCompany", SYSTEM, async(req, res) => {
    try {
      const { id, title, short } = req.body || {};
      if (!id) return res.status(400).json({ status: 'error', result: 'Company id required.' });
      const company = await Company.findByPk(id);
      if (!company) return res.status(404).json({ status: 'error', result: 'Company not found.' });

      const patch = pickCompanyFields(req.body);
      if (title !== undefined && title.trim()) patch.title = title.trim();
      if (short !== undefined && short.trim()) patch.short = short.trim();
      await company.update(patch);
      res.json({ status: 'success', result: company });
    }
    catch (error) {
      res.status(500).json({ status: 'error', result: error.message });
    }
});

// Delete a company (admin) - additionally gated behind a fixed delete password
// checked here on the server, so the password never ships in the frontend.
// Cascades to the company's bank accounts (see the association).
const DELETE_PASSWORD = '2012242';
routes.post("/deleteCompany", SYSTEM, async(req, res) => {
    try {
      const { id, password } = req.body || {};
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ status: 'error', result: 'Incorrect delete password.' });
      }
      if (!id) return res.status(400).json({ status: 'error', result: 'Company id required.' });

      const company = await Company.findByPk(id);
      if (!company) return res.status(404).json({ status: 'error', result: 'Company not found.' });

      // Refuse to delete a company that still has transactional data against it.
      // Field name/type differs per table: most store companyId as a string,
      // the voucher tables use an integer CompanyId.
      const idStr = String(id);
      const idNum = Number(id);
      const checks = [
        [Invoice,         { companyId: idStr }, 'invoice(s)'],
        [Vouchers,        { CompanyId: idNum }, 'voucher(s)'],
        [Office_Vouchers, { CompanyId: idNum }, 'office voucher(s)'],
        [SE_Job,          { companyId: idStr }, 'sea job(s)'],
        [Manifest,        { companyId: idStr }, 'manifest(s)'],
        [Delivery_Order,  { companyId: idStr }, 'delivery order(s)'],
      ];
      const blocking = [];
      for (const [model, where, label] of checks) {
        const count = await model.count({ where });
        if (count > 0) blocking.push(`${count} ${label}`);
      }
      if (blocking.length) {
        return res.status(409).json({
          status: 'error',
          result: `Cannot delete "${company.title}": it still has ${blocking.join(', ')}. Remove or reassign these first.`,
        });
      }

      await company.destroy(); // bank accounts cascade
      res.json({ status: 'success' });
    }
    catch (error) {
      res.status(500).json({ status: 'error', result: error.message });
    }
});

/* -------------------------------- bank accounts -------------------------------- */

routes.post("/bankAccount/create", SYSTEM, async(req, res) => {
    try {
      const { CompanyId, label, bankName, accountTitle, accountNo, iban, branch, swift } = req.body || {};
      if (!CompanyId) return res.status(400).json({ status: 'error', result: 'CompanyId required.' });
      const acc = await BankAccount.create({ CompanyId, label, bankName, accountTitle, accountNo, iban, branch, swift });
      res.json({ status: 'success', result: acc });
    }
    catch (error) {
      res.status(500).json({ status: 'error', result: error.message });
    }
});

/* Change an account's details in place (the user, 2026-11-02: "I can't edit
 * bank accounts" - delete and add again was the only way, and lost the
 * default). The id stays, so its client / agent default does too; so does its
 * company. Invoices keep no copy of the details - every print, an old
 * invoice's reprint as well, shows the account as it is now. */
const BANK_FIELDS = ['label', 'bankName', 'accountTitle', 'accountNo', 'iban', 'branch', 'swift'];
routes.post("/bankAccount/edit", SYSTEM, async(req, res) => {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ status: 'error', result: 'Bank account id required.' });
      const account = await BankAccount.findByPk(id);
      if (!account) return res.status(404).json({ status: 'error', result: 'Bank account not found.' });

      const patch = {};
      for (const f of BANK_FIELDS) if (req.body[f] !== undefined) patch[f] = req.body[f];
      const after = { ...account.get({ plain: true }), ...patch };
      if (!String(after.bankName || '').trim() && !String(after.iban || '').trim()) {
        return res.status(400).json({ status: 'error', result: 'Enter at least a bank name or IBAN.' });
      }
      await account.update(patch);
      res.json({ status: 'success', result: account });
    }
    catch (error) {
      res.status(500).json({ status: 'error', result: error.message });
    }
});

routes.get("/bankAccount/byCompany/:companyId", async(req, res) => {
    try {
      const result = await BankAccount.findAll({ where: { CompanyId: req.params.companyId }, order: [['id', 'ASC']], raw: true });
      const defaults = await readBankDefaults(AppSetting);
      res.json({ status: 'success', result: flagAccounts(result, defaults, req.params.companyId) });
    }
    catch (error) {
      res.status(500).json({ status: 'error', result: error.message });
    }
});

/**
 * Make an account its company's client default (JI / JB) or agent default
 * (AI / AB). One of each per company; moving one there takes it off the
 * account that had it. See functions/bankAccountDefaults.
 */
routes.post("/bankAccount/setDefault", SYSTEM, async(req, res) => {
    try {
      const { id, kind } = req.body || {};
      if (!BANK_DEFAULT_KINDS.includes(kind)) {
        return res.status(400).json({ status: 'error', result: `Default must be one of: ${BANK_DEFAULT_KINDS.join(', ')}.` });
      }
      const account = id ? await BankAccount.findByPk(id, { attributes: ['id', 'CompanyId'] }) : null;
      if (!account) return res.status(404).json({ status: 'error', result: 'Bank account not found.' });

      const value = JSON.stringify(setBankDefault(
        await readBankDefaults(AppSetting), account.CompanyId, kind, account.id,
      ));
      const existing = await AppSetting.findOne({ where: { key: BANK_DEFAULTS_KEY } });
      if (existing) await existing.update({ value });
      else await AppSetting.create({ key: BANK_DEFAULTS_KEY, value });

      res.json({ status: 'success' });
    }
    catch (error) {
      res.status(500).json({ status: 'error', result: error.message });
    }
});

routes.post("/bankAccount/delete", SYSTEM, async(req, res) => {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ status: 'error', result: 'Bank account id required.' });
      await BankAccount.destroy({ where: { id } });
      res.json({ status: 'success' });
    }
    catch (error) {
      res.status(500).json({ status: 'error', result: error.message });
    }
});

/* ---------------------- MIGRATION: legacy companies ------------------------
 * Imports Gen_SubCompanies from the legacy Climax database.
 *
 * Body: { SubCompanies: [...] } from the legacy /jobs/getSubCompanies endpoint.
 *
 * THIS MUST RUN FIRST. Every legacy job, voucher and invoice is scoped by
 * SubCompanyId; nothing downstream can resolve a CompanyId until these rows
 * exist and carry their climaxId.
 *
 * The legacy database already holds the letterhead - Name, ShortName, Address,
 * Phone, Email, WebSite, NTNNo, SalesTaxNo and both logo images - so a migrated
 * install gets its own branding without anyone re-entering it. That matters now
 * that prints read the Company record rather than hardcoded Seanet/ACS values.
 *
 * NOT imported, because the legacy schema has no such fields: bank accounts.
 * Those were only ever hardcoded in the old frontend. They must be entered in
 * Config > Bank Accounts after the migration or invoices print no bank block.
 *
 * Matched on climaxId, so a partial run can be repeated.
 */
routes.post("/uploadCompanies", SYSTEM, async (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : (req.body?.SubCompanies || []);
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({
      status: 'error',
      result: 'Expected { SubCompanies: [...] } from the legacy /jobs/getSubCompanies endpoint.',
    });
  }

  // Legacy logos are image bytes; Company.logo/printLogo hold data URLs.
  const toDataUrl = (img) => {
    if (!img) return null;
    if (typeof img === 'string') {
      return img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
    }
    // Buffer / { type:'Buffer', data:[...] } as JSON puts it over the wire.
    const buf = Buffer.isBuffer(img)
      ? img
      : (Array.isArray(img?.data) ? Buffer.from(img.data) : null);
    return buf && buf.length ? `data:image/png;base64,${buf.toString('base64')}` : null;
  };

  let created = 0, updated = 0;
  const failed = [];
  const mapping = [];

  try {
    for (const c of rows) {
      if (c?.Id == null) { failed.push({ Id: c?.Id, reason: 'row has no Id' }); continue; }

      const title = (c.Name || c.DisplayName || '').trim();
      const short = (c.ShortName || c.SubCompanyPrefix || '').trim();
      if (!title || !short) {
        // Both are NOT NULL on Company - report rather than fail the whole run.
        failed.push({ Id: c.Id, reason: `legacy row has no ${!title ? 'Name' : 'ShortName'}` });
        continue;
      }

      const values = {
        title,
        short,
        address: c.Address || null,
        phone: c.Phone || null,
        email: c.Email || null,
        web: c.WebSite || null,
        ntn: c.NTNNo || null,
        strn: c.SalesTaxNo || null,
        logo: toDataUrl(c.ImgLogo),
        printLogo: toDataUrl(c.ImgLetterHead) || toDataUrl(c.ImgLogo),
        climaxId: c.Id,
      };

      try {
        const existing = await Company.findOne({ where: { climaxId: c.Id } });
        if (existing) {
          // Don't blank a logo someone uploaded by hand if legacy has none.
          if (!values.logo) delete values.logo;
          if (!values.printLogo) delete values.printLogo;
          await existing.update(values);
          updated += 1;
          mapping.push({ climaxId: c.Id, companyId: existing.id, short: existing.short });
        } else {
          const row = await Company.create(values);
          created += 1;
          mapping.push({ climaxId: c.Id, companyId: row.id, short: row.short });
        }
      } catch (err) {
        failed.push({ Id: c.Id, title, reason: err.message });
      }
    }

    res.json({
      status: failed.length ? 'partial' : 'success',
      result: {
        total: rows.length,
        created,
        updated,
        // The legacy-id -> new-id mapping every later step depends on.
        mapping,
        failed,
        note: 'Bank accounts are NOT in the legacy database. Add them in Config > Bank Accounts before issuing invoices.',
      },
    });
  } catch (error) {
    console.error('uploadCompanies failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

// The rewritten companies migration: plan, apply, verify.
// /uploadCompanies above is untouched. This one reports what a replace would
// destroy before doing it - see routes/companies/companyMigration.js.
routes.use('/', require('./companyMigration'));

module.exports = routes;

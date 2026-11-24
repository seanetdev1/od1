/**
 * Companies migration - plan, apply, verify.
 *
 * /companies/uploadCompanies is left untouched.
 *
 *   POST /companies/migration/plan     what would happen, including what a
 *                                      replace would destroy
 *   POST /companies/migration/apply    import, optionally replacing
 *   GET  /companies/migration/verify   is anything now pointing at nothing
 *
 * WHY THIS ONE NEEDS A PLAN STEP MORE THAN THE OTHERS
 *
 * Companies sit at the top of everything: jobs, invoices, vouchers, bank
 * accounts and employees are all scoped by company. And two of those
 * relationships cascade:
 *
 *   Vouchers.CompanyId      ON DELETE CASCADE
 *   BankAccounts.CompanyId  ON DELETE CASCADE
 *
 * So deleting a company does not fail with a foreign key error - it silently
 * takes every voucher belonging to that company with it. The others
 * (SE_Jobs.companyId, Invoices.companyId, Employees.defaultCompanyId) have no
 * constraint at all, so those rows survive pointing at a company id that no
 * longer exists, which is worse: they look fine until something tries to
 * resolve the company.
 *
 * Nothing here deletes anything unless the caller passes replaceExisting, and
 * the plan reports exactly what that would cost first.
 */

const routes = require('express').Router();
const db = require('../../models');

const { requireSystem } = require('../../functions/systemAccess');
// Seanet's, not the client admin's - see functions/systemAccess.js.
const SYSTEM = requireSystem;

/** Legacy image bytes -> the data URL Company.logo holds. */
function toDataUrl(img) {
  if (!img) return null;
  if (typeof img === 'string') {
    return img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
  }
  const buf = Buffer.isBuffer(img)
    ? img
    : (Array.isArray(img?.data) ? Buffer.from(img.data) : null);
  return buf && buf.length ? `data:image/png;base64,${buf.toString('base64')}` : null;
}

function cleanText(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
}

/** Map one legacy Gen_SubCompanies row onto Company columns. */
function mapCompany(c) {
  return {
    title: cleanText(c.Name) || cleanText(c.DisplayName),
    // The prefix on every job, invoice and voucher number this company issues.
    short: cleanText(c.ShortName) || cleanText(c.SubCompanyPrefix),
    address: cleanText(c.Address),
    phone: cleanText(c.Phone),
    email: cleanText(c.Email),
    web: cleanText(c.WebSite),
    ntn: cleanText(c.NTNNo),
    strn: cleanText(c.SalesTaxNo),
    logo: toDataUrl(c.ImgLogo),
    printLogo: toDataUrl(c.ImgLetterHead) || toDataUrl(c.ImgLogo),
    climaxId: c.Id,
  };
}

/** What is currently attached to each company, including what would cascade. */
async function dependents() {
  const q = async (sql) => {
    try { return (await db.sequelize.query(sql, { type: db.Sequelize.QueryTypes.SELECT })); }
    catch (_) { return []; }   // table may not exist on a partial install
  };

  const [vouchers, bankAccounts, jobs, invoices, employees] = await Promise.all([
    q('SELECT "CompanyId" AS company, COUNT(*)::int AS n FROM "Vouchers" GROUP BY "CompanyId"'),
    q('SELECT "CompanyId" AS company, COUNT(*)::int AS n FROM "BankAccounts" GROUP BY "CompanyId"'),
    q('SELECT "companyId" AS company, COUNT(*)::int AS n FROM "SE_Jobs" GROUP BY "companyId"'),
    q('SELECT "companyId" AS company, COUNT(*)::int AS n FROM "Invoices" GROUP BY "companyId"'),
    q('SELECT "defaultCompanyId" AS company, COUNT(*)::int AS n FROM "Employees" GROUP BY "defaultCompanyId"'),
  ]);

  const total = (rows) => rows.reduce((s, r) => s + Number(r.n || 0), 0);
  return {
    // These vanish with the company - no error, no warning.
    cascades: { vouchers: total(vouchers), bankAccounts: total(bankAccounts) },
    // These survive pointing at nothing.
    orphans: { jobs: total(jobs), invoices: total(invoices), employees: total(employees) },
    byCompany: { vouchers, bankAccounts, jobs, invoices, employees },
  };
}

/**
 * Narrow the dependency counts to a specific set of companies.
 *
 * `dependents()` reports totals across every company; a replace only affects
 * the ones being removed.
 */
function impactOf(deps, companies) {
  const doomed = new Set(companies.map((c) => String(c.id)));
  const at = (rows) => rows
    .filter((r) => r.company !== null && r.company !== undefined && doomed.has(String(r.company)))
    .reduce((n, r) => n + Number(r.n || 0), 0);

  return {
    cascades: {
      vouchers: at(deps.byCompany.vouchers),
      bankAccounts: at(deps.byCompany.bankAccounts),
    },
    orphans: {
      jobs: at(deps.byCompany.jobs),
      invoices: at(deps.byCompany.invoices),
      employees: at(deps.byCompany.employees),
    },
  };
}

function readRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.SubCompanies)) return body.SubCompanies;
  if (Array.isArray(body?.companies)) return body.companies;
  return null;
}

async function buildPlan(rows) {
  const existing = await db.Company.findAll({
    attributes: ['id', 'title', 'short', 'climaxId'], raw: true,
  });
  const byClimaxId = new Map(
    existing.filter((c) => c.climaxId !== null).map((c) => [String(c.climaxId), c])
  );

  const problems = { missingId: 0, missingTitle: [], missingShort: [], duplicateShort: [] };
  const toCreate = [];
  const toUpdate = [];
  const seenShort = new Map();

  for (const row of rows) {
    if (!row || row.Id === null || row.Id === undefined) { problems.missingId += 1; continue; }
    const mapped = mapCompany(row);

    // Both are NOT NULL on Company, and `short` becomes the document prefix -
    // a company without one would produce job numbers beginning "-SEJ-1/26".
    if (!mapped.title) { problems.missingTitle.push(row.Id); continue; }
    if (!mapped.short) { problems.missingShort.push(row.Id); continue; }

    const key = mapped.short.toUpperCase();
    if (seenShort.has(key)) {
      // Two companies sharing a prefix makes their document numbers
      // indistinguishable from each other.
      problems.duplicateShort.push({ short: mapped.short, ids: [seenShort.get(key), row.Id] });
    } else {
      seenShort.set(key, row.Id);
    }

    const match = byClimaxId.get(String(row.Id));
    if (match) toUpdate.push({ id: match.id, ...mapped });
    else toCreate.push(mapped);
  }

  // Companies here that the legacy export does not contain. A replace removes
  // these; without one they stay alongside the imported set.
  const notInLegacy = existing.filter(
    (c) => c.climaxId === null || !rows.some((r) => String(r.Id) === String(c.climaxId))
  );

  return {
    toCreate, toUpdate, notInLegacy, problems,
    stats: {
      source: rows.length,
      toCreate: toCreate.length,
      toUpdate: toUpdate.length,
      existing: existing.length,
      wouldDelete: notInLegacy.length,
    },
    canApply: problems.duplicateShort.length === 0,
  };
}

routes.post('/migration/plan', SYSTEM, async (req, res) => {
  try {
    const rows = readRows(req.body);
    if (!rows) {
      return res.status(400).json({
        status: 'error',
        result: 'Send the legacy Gen_SubCompanies rows as { SubCompanies: [...] }.',
      });
    }

    const plan = await buildPlan(rows);
    const deps = await dependents();

    res.json({
      status: 'success',
      result: {
        canApply: plan.canApply,
        stats: plan.stats,
        problems: plan.problems,
        wouldDelete: plan.notInLegacy.map((c) => ({ id: c.id, title: c.title, short: c.short })),
        // The part worth reading before agreeing to a replace.
        //
        // Scoped to the companies that would ACTUALLY be deleted, not to every
        // company. Reporting a global total here reads as "14 employees will
        // be orphaned" when the real answer may be none of them, and a warning
        // that overstates its case is one people learn to skip.
        replaceImpact: {
          cascadeDeletes: impactOf(deps, plan.notInLegacy).cascades,
          leftPointingAtNothing: impactOf(deps, plan.notInLegacy).orphans,
          note:
            'Vouchers and BankAccounts are ON DELETE CASCADE - deleting a company deletes '
            + 'those rows silently. Jobs, invoices and employees have no constraint, so they '
            + 'survive holding a company id that no longer exists.',
        },
        guidance:
          plan.problems.duplicateShort.length
            ? 'Two legacy companies share a short code. Every job, invoice and voucher number '
              + 'starts with it, so their documents would be indistinguishable. Fix the source.'
            : plan.stats.wouldDelete === 0
            ? 'Nothing would be deleted - every company here is in the legacy export.'
            : `${plan.stats.wouldDelete} existing company/companies are not in the legacy export. `
              + 'They are kept unless you pass replaceExisting, and the impact above is what '
              + 'removing them would cost.',
      },
    });
  } catch (error) {
    console.error('[company migration] plan failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * Import, and optionally remove companies the legacy export does not contain.
 *
 * replaceExisting must be sent explicitly. Deleting a company is not something
 * to arrive at by default, and the cascade means it cannot be undone by
 * re-running the import.
 */
routes.post('/migration/apply', SYSTEM, async (req, res) => {
  try {
    const rows = readRows(req.body);
    if (!rows) {
      return res.status(400).json({
        status: 'error',
        result: 'Send the legacy Gen_SubCompanies rows as { SubCompanies: [...] }.',
      });
    }

    const replaceExisting = req.body?.replaceExisting === true;
    const plan = await buildPlan(rows);

    if (!plan.canApply) {
      return res.status(409).json({
        status: 'error',
        result: { problems: plan.problems, guidance: 'Two legacy companies share a short code.' },
      });
    }

    const before = await dependents();

    // Refuse to cascade away real data on a plain replace.
    //
    // Right now the transactional tables are empty and deleting a company
    // costs nothing. Run the same stage after a job import and it would take
    // every voucher belonging to that company with it, silently, because the
    // constraint is ON DELETE CASCADE. That is not a decision to make by
    // default, so it needs `force` said out loud.
    if (replaceExisting && plan.notInLegacy.length && !req.body?.force) {
      const { vouchers, bankAccounts } = impactOf(before, plan.notInLegacy).cascades;

      if (vouchers > 0 || bankAccounts > 0) {
        return res.status(409).json({
          status: 'error',
          result: {
            guidance:
              `Deleting ${plan.notInLegacy.length} company/companies would cascade and destroy `
              + `${vouchers} voucher(s) and ${bankAccounts} bank account(s). Those rows cannot `
              + 'be recovered by re-running the import. Move them to a company that is staying, '
              + 'or pass force: true if losing them is intended.',
            wouldDelete: plan.notInLegacy.map((c) => ({ id: c.id, title: c.title, short: c.short })),
            cascadeDeletes: { vouchers, bankAccounts },
          },
        });
      }
    }

    let deleted = 0;

    const created = [];
    await db.sequelize.transaction(async (t) => {
      for (const values of plan.toCreate) {
        created.push(await db.Company.create(values, { transaction: t }));
      }
      for (const { id, ...values } of plan.toUpdate) {
        await db.Company.update(values, { where: { id }, transaction: t });
      }

      if (replaceExisting && plan.notInLegacy.length) {
        // Last, and only when asked. Doing it first would mean a failure part
        // way through left the install with no companies at all.
        await db.Company.destroy({
          where: { id: plan.notInLegacy.map((c) => c.id) }, transaction: t,
        });
        deleted = plan.notInLegacy.length;
      }
    });

    const after = await dependents();

    res.json({
      status: 'success',
      result: {
        stats: plan.stats,
        created: plan.toCreate.length,
        updated: plan.toUpdate.length,
        deleted,
        replaceExisting,
        // What the delete actually cost, measured rather than predicted.
        cascadeLoss: {
          vouchers: before.cascades.vouchers - after.cascades.vouchers,
          bankAccounts: before.cascades.bankAccounts - after.cascades.bankAccounts,
        },
        // legacy id -> new id, for anything that needs to remap afterwards.
        mapping: created.map((c) => ({ climaxId: c.climaxId, id: c.id, short: c.short })),
        companiesInTarget: await db.Company.count(),
      },
    });
  } catch (error) {
    console.error('[company migration] apply failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/** Is anything now scoped to a company that no longer exists? */
routes.get('/migration/verify', SYSTEM, async (req, res) => {
  try {
    const companies = await db.Company.findAll({
      attributes: ['id', 'title', 'short', 'climaxId'], raw: true,
    });
    const ids = new Set(companies.map((c) => String(c.id)));
    const deps = await dependents();

    const dangling = [];
    for (const [name, rows] of Object.entries(deps.byCompany)) {
      for (const r of rows) {
        if (r.company === null || r.company === undefined) continue;
        if (!ids.has(String(r.company))) {
          dangling.push({ table: name, companyId: r.company, rows: Number(r.n) });
        }
      }
    }

    // Two companies sharing a prefix makes their paperwork ambiguous.
    const shorts = companies.map((c) => String(c.short || '').toUpperCase());
    const duplicateShorts = [...new Set(shorts.filter((s, i) => s && shorts.indexOf(s) !== i))];

    res.json({
      status: 'success',
      result: {
        companies: companies.length,
        migrated: companies.filter((c) => c.climaxId !== null).length,
        handCreated: companies.filter((c) => c.climaxId === null).length,
        list: companies.map((c) => ({ id: c.id, title: c.title, short: c.short, climaxId: c.climaxId })),
        withoutShortCode: companies.filter((c) => !c.short).length,
        duplicateShorts,
        danglingReferences: dangling,
        healthy: dangling.length === 0 && duplicateShorts.length === 0
          && companies.every((c) => c.short),
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;
module.exports.mapCompany = mapCompany;

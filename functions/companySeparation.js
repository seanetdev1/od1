// PER-COMPANY MASTER DATA - one switch per table, set by Seanet in Config.
//
// An install holds several companies over one set of accounts, parties,
// charges... Switched on for a table, each record of it can be limited to
// some companies (Record_Company rows), and every LIST of that table made
// while working in a company shows only the records it may see - the record's
// companies include it, or the record has none (shared). The legacy Climax
// system worked the same way (Gen_Parties_SubCompanyRight and friends).
//
// HOW: a beforeFind/beforeCount hook on each table's model narrows the query.
// Not route by route: these tables are listed from dozens of places (pickers,
// the job screens' getValues bundles, reports), and a filter applied in each
// would be complete only until the next one was written. The hook applies to
// a query when ALL of these hold:
//   - it runs inside a signed-in request with a company to scope to (the one
//     the request names, else the header's - functions/companyAccess
//     scopeCompany; "all companies" scopes nothing), on a route that is not
//     Seanet-only (migration matches records across the whole install);
//   - the table is switched on;
//   - it is a LIST: a query by primary key is never narrowed, so posting a
//     voucher, printing an invoice or opening history by id still finds a
//     record whatever its companies. Includes (a job's party, an invoice's
//     account) are never narrowed either - Sequelize runs a model's find hooks
//     for the model queried, not the ones it includes.
// And a record CREATED in a company while its table is switched on starts out
// visible to that company only; it can then be shared from its form.
//
// Employees are the exception: "employees in pickers" narrows the staff
// pickers (sales rep, manager...) to the companies on each employee's Works In
// list (Employee_Company), and is applied in those routes - staff records are
// looked up by name in too many places to narrow every query.

const { Op, literal } = require('sequelize');
const { getScopeCompany } = require('./fiscalYearContext');

const SETTING_KEY = 'companySeparation';

// switch -> the model it narrows, and the module whose edit right shares a record
const TABLES = {
  coa: { model: 'Child_Account', label: 'Chart of accounts', module: 'coa' },
  parties: { model: 'Clients', label: 'Parties', module: 'parties' },
  charges: { model: 'Charges', label: 'Charges', module: 'charges' },
  chargeGroups: { model: 'Customs_Charge_Group', label: 'Customs charge groups', module: 'charges' },
  commodity: { model: 'Commodity', label: 'Commodities', module: 'commodity' },
  vessels: { model: 'Vessel', label: 'Vessels & voyages', module: 'vessels' },
  employees: { model: null, label: 'Employees in pickers', module: null },
};
const DEFAULTS = Object.fromEntries(Object.keys(TABLES).map((k) => [k, false]));

let db;
const models = () => (db = db || require('../models'));

// ------------------------------------------------------------ the switches
let cache = { value: null, at: 0 };
const TTL_MS = 10 * 1000;

function normalize(raw) {
  let parsed = {};
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); } catch (_) { parsed = {}; }
  return Object.fromEntries(Object.keys(TABLES).map((k) => [k, parsed[k] === true]));
}

async function readSeparation() {
  if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await models().AppSetting.findOne({ where: { key: SETTING_KEY } });
  cache = { value: row ? normalize(row.value) : { ...DEFAULTS }, at: Date.now() };
  return cache.value;
}

async function writeSeparation(input) {
  const value = normalize(input);
  const { AppSetting } = models();
  const [row, created] = await AppSetting.findOrCreate({ where: { key: SETTING_KEY }, defaults: { value: JSON.stringify(value) } });
  if (!created) await row.update({ value: JSON.stringify(value) });
  cache = { value, at: Date.now() };
  return value;
}

/** The company to scope a table's lists to right now, or null for none. */
async function scopeFor(table) {
  const companyId = getScopeCompany();
  if (!companyId) return null;
  return (await readSeparation())[table] ? companyId : null;
}

// ------------------------------------------------------------ the filter
// Built from a model name (a constant here) and a company id already proven
// an integer - nothing from the request reaches this SQL as text.
function visibleCondition(modelName, alias, companyId) {
  const id = Number(companyId);
  if (!Number.isInteger(id)) throw new Error('company id must be an integer');
  const rec = `"${alias}"."id"::text`;
  return literal(
    `(NOT EXISTS (SELECT 1 FROM "Record_Companies" rc WHERE rc."entity" = '${modelName}' AND rc."recordId" = ${rec})`
    + ` OR EXISTS (SELECT 1 FROM "Record_Companies" rc WHERE rc."entity" = '${modelName}' AND rc."recordId" = ${rec} AND rc."CompanyId" = ${id}))`
  );
}

// A query by primary key is a lookup, not a list - never narrowed.
function isLookupById(where) {
  return Boolean(where && typeof where === 'object' && !Array.isArray(where)
    && Object.prototype.hasOwnProperty.call(where, 'id'));
}

function narrow(model, table) {
  return async (options) => {
    if (isLookupById(options.where)) return;
    const companyId = await scopeFor(table);
    if (!companyId) return;
    const condition = visibleCondition(model.name, model.name, companyId);
    options.where = options.where ? { [Op.and]: [options.where, condition] } : condition;
  };
}

function stamp(model, table) {
  return async (instance, options) => {
    const companyId = await scopeFor(table);
    if (!companyId) return;
    await models().Record_Company.findOrCreate({
      where: { entity: model.name, recordId: String(instance.id), CompanyId: companyId },
      transaction: options?.transaction,
    });
  };
}

let installed = false;
/** Hook every separable table's model. Called once at boot (index.js). */
function installHooks() {
  if (installed) return;
  installed = true;
  const all = models();
  for (const [table, { model: name }] of Object.entries(TABLES)) {
    const model = name && all[name];
    if (!model) continue;
    model.addHook('beforeFind', 'companySeparation', narrow(model, table));
    model.addHook('beforeCount', 'companySeparation', narrow(model, table));
    model.addHook('afterCreate', 'companySeparation', stamp(model, table));
  }
}

// ------------------------------------------------------------ a record's companies
function tableOf(table) {
  const t = TABLES[table];
  if (!t || !t.model) throw Object.assign(new Error(`unknown table "${table}"`), { status: 400 });
  return t;
}

/** The companies a record is limited to; [] = every company. */
async function companiesOf(table, recordId) {
  const { model } = tableOf(table);
  const rows = await models().Record_Company.findAll({
    where: { entity: model, recordId: String(recordId) }, attributes: ['CompanyId'], raw: true,
  });
  return rows.map((r) => r.CompanyId).sort((a, b) => a - b);
}

/** Limit a record to these companies; [] = every company again. */
async function setCompaniesOf(table, recordId, companyIds) {
  const { model } = tableOf(table);
  const ids = [...new Set((companyIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const { Record_Company, sequelize } = models();
  await sequelize.transaction(async (transaction) => {
    await Record_Company.destroy({ where: { entity: model, recordId: String(recordId) }, transaction });
    if (ids.length) {
      await Record_Company.bulkCreate(ids.map((CompanyId) => ({ entity: model, recordId: String(recordId), CompanyId })), { transaction });
    }
  });
  return ids.sort((a, b) => a - b);
}

// ------------------------------------------------------------ staff pickers
/**
 * A where-clause for the staff pickers: when "employees in pickers" is on and
 * the request has a company, only employees who work in it - or who have no
 * Works In list, i.e. every company. {} otherwise.
 */
async function employeePickerWhere() {
  const companyId = await scopeFor('employees');
  if (!companyId) return {};
  return {
    [Op.and]: [literal(
      `(NOT EXISTS (SELECT 1 FROM "Employee_Companies" ec WHERE ec."EmployeeId" = "Employees"."id")`
      + ` OR EXISTS (SELECT 1 FROM "Employee_Companies" ec WHERE ec."EmployeeId" = "Employees"."id" AND ec."CompanyId" = ${Number(companyId)}))`
    )],
  };
}

module.exports = {
  SETTING_KEY,
  TABLES,
  readSeparation,
  writeSeparation,
  installHooks,
  companiesOf,
  setCompaniesOf,
  employeePickerWhere,
  isLookupById,
  _resetCache() { cache = { value: null, at: 0 }; },
};

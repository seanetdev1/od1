const routes = require('express').Router();
// Legacy-import receivers are migration, which is Seanet's - see
// functions/systemAccess.js.
const { requireSystem: SYSTEM, SYSTEM_DESIGNATION } = require('../../functions/systemAccess');
const Sequelize = require('sequelize');
const Op = Sequelize.Op;
const { Access_Levels, Employees } = require("../../functions/Associations/employeeAssociations");
const { sequelize, Employee_Company } = require('../../models');
const History = require('../../models/History');
const { createHistory } = require('../../functions/history');
const requireDesignation = require('../../functions/requireDesignation');
const { isBcryptHash, hashPassword } = require('../../functions/password');
const { representOf } = require('../../functions/employeeMigrationPlan');
const catalog = require('../../functions/permissions/catalog');
const grants = require('../../functions/permissions/grants');
const { employeePickerWhere } = require('../../functions/companySeparation');

// The edit form (Components/Layouts/Setup/Employees/CreateOrEdit.js)
// pre-fills its password field with whatever Employees.password currently
// holds and resubmits it unchanged unless the admin explicitly types a new
// one - since that field now holds a bcrypt hash after the first hash/edit,
// naively re-hashing every submission would hash-of-a-hash the password on
// every unrelated edit and lock the account out. Only hash values that
// aren't already a hash (a freshly typed plaintext password).
const hashIfNeeded = async (pass) => (isBcryptHash(pass) ? pass : hashPassword(pass));

// Viewing the staff list stays with the client's CEO/CFO/admin. Creating and
// editing users - who can sign in, and with what access - is Seanet's on a
// leased install (functions/systemAccess.js); a CEO or CFO used to be able to
// create an admin, or reset the admin's password and sign in as them.
const CEO_CFO_ADMIN = requireDesignation(['CEO', 'CFO', 'admin']);

// The hidden accounts support logins run under. Not staff: never listed,
// never editable, and no one can be given this designation.
const notSystemRow = { [Op.or]: [{ designation: null }, { designation: { [Op.ne]: SYSTEM_DESIGNATION } }] };
const isSystemDesignation = (d) => String(d ?? '').trim().toLowerCase() === SYSTEM_DESIGNATION;

function getAccessLevels(levels, id){
    let levelsList = [];
    (levels || []).forEach(x => {
        levelsList.push({access_name:x, EmployeeId:id} )
    });
    return levelsList
}

// What to store for a user. The permission grid sends `permissions`. Any
// legacy names in it (a user saved without touching the grid) are rewritten
// as the 'perm:' names they stand for - the same expansion the server enforces
// - so a save never changes what someone can do by itself. Then every name is
// checked against the catalog, so nothing the server does not enforce can be
// granted, or smuggled in. Without `permissions`, the old multi-select's
// `accessLevels` as before.
// The companies a user may work in - `companyIds` from the employee form. An
// empty list is every company (functions/companyAccess.js); a form that sends
// no list leaves them as they are.
async function saveCompanies(employeeId, values) {
    if (!Array.isArray(values?.companyIds)) return;
    const ids = [...new Set(values.companyIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    await Employee_Company.destroy({ where: { EmployeeId: employeeId } });
    if (ids.length) await Employee_Company.bulkCreate(ids.map((CompanyId) => ({ EmployeeId: employeeId, CompanyId })));
}

function accessNamesFrom(values) {
    if (!Array.isArray(values?.permissions)) return values?.accessLevels || [];
    const names = grants.toGranularNames(values.permissions.map(String), undefined, { fromGrid: true });
    return [...new Set(names.filter((n) => {
        if (n === 'admin') return true;
        // The marker that the rows are complete as ticked (catalog.js
        // CATALOG_MARKER) - without it, charges unticked in the grid would be
        // carried back in from the job rights.
        if (n === catalog.PERM_PREFIX + catalog.CATALOG_MARKER) return true;
        const m = /^perm:([A-Za-z]+):([a-z]+)$/.exec(n);
        return Boolean(m && catalog.byKey[m[1]]?.actions.includes(m[2]));
    }))];
}

routes.post("/createEmployee", SYSTEM, async(req, res) => {
    try {
        if (isSystemDesignation(req.body.values?.selectDesignation)) {
            return res.status(400).json({ status: 'error', result: 'That designation is reserved.' });
        }
        const result = await Employees.findOne({
            where: {
                [Op.or]: [
                  { code:req.body.values.code },
                  { username:req.body.values.userName }
                ]
              }
        })
        if(result){
            createHistory(req.body.employeeId, 'Employee', 'Create', result.name);
            res.json({status:'exists'});
        }else{
            const result = await Employees.create({
                name:req.body.values.empName,
                fatherName:req.body.values.fatherName,
                email:req.body.values.email,
                username:req.body.values.userName,
                password:await hashIfNeeded(req.body.values.pass),
                contact:req.body.values.phone,
                address:req.body.values.address,
                cnic:req.body.values.cnic,
                designation:req.body.values.selectDesignation,
                department:req.body.values.selectDepart,
                manager:req.body.values.selectManager,
                createdBy:req.body.createdBy,
                date:req.body.values.date,
                bank:req.body.values.bank,
                account_no:req.body.values.accountNo,
                code:req.body.values.code,
                represent:req.body.values.represent,
                defaultCompanyId:req.body.values.defaultCompanyId,
                active:1
            });
            const resultTwo = await Access_Levels.bulkCreate(getAccessLevels(accessNamesFrom(req.body.values), result.id))
            await saveCompanies(result.id, req.body.values);
            createHistory(req.body.employeeId, 'Employee', 'Create', result.name);
            // create() hands back every column it wrote, the new hash included.
            delete result.dataValues.password;
            res.json({status:'success', result:result, resultTwo:resultTwo});
        }
    }
    catch (error) {
        console.error(error)
        res.status(500).json({status:'error', result:error});
    }
});

routes.post("/editEmployee", SYSTEM, async(req, res) => {
    try {
        const target = await Employees.findByPk(req.body.values?.id);
        if (!target || isSystemDesignation(target.designation)) {
            return res.status(404).json({ status: 'error', result: 'Employee not found.' });
        }
        if (isSystemDesignation(req.body.values.selectDesignation)) {
            return res.status(400).json({ status: 'error', result: 'That designation is reserved.' });
        }
        // The list no longer sends password hashes to the browser, so the form
        // has nothing to pre-fill: a blank password now means "unchanged".
        const pass = req.body.values.pass;
        const passwordChange = (typeof pass === 'string' && pass !== '')
            ? { password: await hashIfNeeded(pass) }
            : {};
        await Access_Levels.destroy({where:{EmployeeId:req.body.values.id}})
        const result = await Employees.update({
            name:req.body.values.empName,
            fatherName:req.body.values.fatherName,
            email:req.body.values.email,
            username:req.body.values.userName,
            ...passwordChange,
            contact:req.body.values.phone,
            address:req.body.values.address,
            cnic:req.body.values.cnic,
            designation:req.body.values.selectDesignation,
            department:req.body.values.selectDepart,
            manager:req.body.values.selectManager,
            updatedBy:req.body.updatedBy,
            represent:req.body.values.represent,
            date:req.body.values.date,
            bank:req.body.values.bank,
            account_no:req.body.values.accountNo,
            code:req.body.values.code,
            defaultCompanyId:req.body.values.defaultCompanyId,
            active:1
        }, {where:{id:req.body.values.id}})
        const resultTwo = await Access_Levels.bulkCreate(getAccessLevels(accessNamesFrom(req.body.values), req.body.values.id))
        await saveCompanies(req.body.values.id, req.body.values);
        // Takes effect on their next request, not their next sign-in.
        grants.invalidate(req.body.values.id);
        createHistory(req.body.employeeId, 'Employee', 'Edit', req.body.values.empName);
        res.json({status:'success', result:result, resultTwo:resultTwo});
        
    }
    catch (error) {
        console.error(error)
      res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getEmployees", CEO_CFO_ADMIN, async(req, res) => {
    try {

        const result = await Employees.findAll({
        // Never the password: this list used to carry every user's hash to
        // the browser, where the edit form pre-filled it.
        attributes: { exclude: ['password'] },
        include: [{
            model: Access_Levels,
            attributes: ['id', 'access_name']
        }],
        where: { active: '1', ...notSystemRow }
        });

        // The companies each may work in; [] = every company.
        const rights = await Employee_Company.findAll({ where: { EmployeeId: result.map((e) => e.id) }, raw: true });
        const byEmployee = {};
        rights.forEach((r) => { (byEmployee[r.EmployeeId] = byEmployee[r.EmployeeId] || []).push(r.CompanyId); });
        res.json({status:'success', result: result.map((e) => ({ ...e.get({ plain: true }), companyIds: byEmployee[e.id] || [] }))});
    }
    catch (error) {
        console.error(error)
        res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getEmployeesIdAndName", async(req, res) => {
    try {
        const result = await Employees.findAll({
         // Staff pickers: narrowed to those who work in the request's company
         // when Seanet separates "employees in pickers" (functions/companySeparation).
         where:{active:'1', ...(await employeePickerWhere())},
         attributes:[['id', 'value'], ['name', 'label']]
        })
        res.json({status:'success', result:result});
    }
    catch (error) {
      console.error(error)
      res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getRepresentativeEmployees", async(req, res) => {
    try {
        const inCompany = await employeePickerWhere();
        const Sr = await Employees.findAll({where:{represent: {[Op.substring]: 'sr'}, ...inCompany }, attributes:['id', 'name']});
        const Dr = await Employees.findAll({where:{represent: {[Op.substring]: 'dr'}, ...inCompany }, attributes:['id', 'name']});
        const Ar = await Employees.findAll({where:{represent: {[Op.substring]: 'ar'}, ...inCompany }, attributes:['id', 'name']});
        res.json({status:'success', result:{Sr, Dr, Ar}});
    }
    catch (error) {
        console.error(error)
        res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getManagers", async(req, res) => {
    try {
        const result = await Employees.findAll({where:{designation:'manager', ...(await employeePickerWhere())}})
        res.json({status:'success', result:result});
    }
    catch (error) {
        console.error(error)
        res.status(500).json({status:'error', result:error});
    }
});

routes.get('/allRiders', async(req, res) => {
    try {
      const result =  await Employees.findAll({where : {designation:"rider", ...(await employeePickerWhere()) }})
        res.json({status:'success', result:result});
    }
    catch (error) {
        console.error(error)
        res.status(500).json({status:'error', result:error});
    }
});

/* ------------------------- MIGRATION: employees ---------------------------
 * One-time import of TAP_Employee rows from the legacy Climax database.
 *
 * Body: { Employees: [ ...TAP_Employee rows... ] }
 *
 * Exists because jobs reference their sales rep by the legacy TAP_Employee.Id,
 * and nothing else creates employees with that linkage. Without it a fresh
 * migration has no employee to point a job at, and fixSalesRep had to guess
 * with a hardcoded UUID table.
 *
 * Matched on climaxId, so re-running after a partial or failed migration
 * updates rather than duplicating - the whole run is retryable.
 *
 * Deliberately does NOT set a password or grant access: migrated staff are
 * records to attribute jobs to, not accounts to log in with. Give someone a
 * login through the normal employee screen.
 */
routes.post("/uploadEmployees", SYSTEM, async (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : (req.body?.Employees || []);
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({
      status: 'error',
      result: 'Expected { Employees: [...] } from the legacy /jobs/getEmployees endpoint.',
    });
  }

  const fullName = (e) =>
    [e.EmployeeName, e.Middle, e.LastName]
      .map((x) => (x || '').trim())
      .filter(Boolean)
      .join(' ') || `Employee ${e.Id}`;

  let created = 0, updated = 0;
  const failed = [];

  try {
    for (const e of rows) {
      if (e?.Id == null) { failed.push({ Id: e?.Id, reason: 'row has no Id' }); continue; }

      const values = {
        name: fullName(e),
        fatherName: e.FatherName || null,
        email: e.Email || null,
        contact: e.PhoneNo || null,
        cnic: e.NIC || e.OldNIC || null,
        bank: e.EmployeeBankName || null,
        code: e.EmployeeCode ? String(e.EmployeeCode) : null,
        // IsInactive is the legacy flag; Odyssey stores '1'/'0' as active.
        active: e.IsInactive ? '0' : '1',
        // Sales reps are the ones jobs actually reference.
        // The codes the app reads - see representOf in functions/employeeMigrationPlan.
        represent: representOf(e),
        climaxId: e.Id,
      };

      try {
        const existing = await Employees.findOne({ where: { climaxId: e.Id } });
        if (existing) {
          await existing.update(values);
          updated += 1;
        } else {
          await Employees.create(values);
          created += 1;
        }
      } catch (err) {
        // Keep going and report - a migration that stops on row 12 of 400 is
        // far more painful than one that finishes and hands you the failures.
        failed.push({ Id: e.Id, name: values.name, reason: err.message });
      }
    }

    res.json({
      status: failed.length ? 'partial' : 'success',
      result: { total: rows.length, created, updated, failed },
    });
  } catch (error) {
    console.error('uploadEmployees failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

// The rewritten employees/users migration: plan, apply, verify.
// /uploadEmployees above is untouched. It imported TAP_Employee, which is not
// the staff list - see routes/employees/employeeMigration.js.
routes.use('/', require('./employeeMigration'));

module.exports = routes;